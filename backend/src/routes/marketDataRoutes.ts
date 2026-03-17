import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateQuery } from '../validate';
import { withConnection, getAdapter } from '../middleware/withConnection';

const router = Router();

const RetrieveBarsSchema = z.object({
  contractId: z.string().min(1),
  live: z.boolean().default(false),
  unit: z.number().int().positive(),
  unitNumber: z.number().int().positive(),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  limit: z.number().int().positive().max(50000).optional(),
  includePartialBar: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Quarterly futures contract rollover helpers
// Quarterly months: H (Mar), M (Jun), U (Sep), Z (Dec)
// ---------------------------------------------------------------------------

const QUARTERLY_MONTHS = ['H', 'M', 'U', 'Z'] as const;

/** Given a contract ID like CON.F.US.ENQ.M26, return the previous quarterly
 *  contract ID (CON.F.US.ENQ.H26). Returns null for non-futures IDs. */
function getPreviousContractId(contractId: string): string | null {
  const match = contractId.match(/^(CON\.F\.US\.[^.]+\.)([HMUZ])(\d{2})$/);
  if (!match) return null;

  const prefix = match[1];       // CON.F.US.ENQ.
  const monthCode = match[2];    // M
  let year = parseInt(match[3]); // 26

  const idx = QUARTERLY_MONTHS.indexOf(monthCode as typeof QUARTERLY_MONTHS[number]);
  if (idx < 0) return null;

  let prevIdx = idx - 1;
  if (prevIdx < 0) {
    prevIdx = QUARTERLY_MONTHS.length - 1; // wrap to Z
    year -= 1;
  }

  if (year < 0) return null;
  return `${prefix}${QUARTERLY_MONTHS[prevIdx]}${String(year).padStart(2, '0')}`;
}

// POST /market/bars — fetches from current contract, backfills from previous
// contracts if the current one doesn't cover the full requested time range
router.post('/bars', validateBody(RetrieveBarsSchema), withConnection(async (req, res) => {
  const adapter = getAdapter();
  const { contractId, startTime, limit } = req.body;
  const requestedStart = new Date(startTime).getTime();

  // Fetch from the current (active) contract
  const data = await adapter.marketData.retrieveBars(req.body) as {
    bars?: Array<{ t: string; o: number; h: number; l: number; c: number; v: number }>;
    success: boolean;
  };

  let allBars = data.bars ?? [];
  const maxBars = limit ?? 20000;

  // If bars don't reach back to startTime and we haven't hit the limit,
  // fetch from previous contract(s) to fill the gap
  if (allBars.length > 0 && allBars.length < maxBars) {
    // API returns descending (newest first) — oldest bar is the last element
    const oldestBarTime = new Date(allBars[allBars.length - 1].t).getTime();

    if (oldestBarTime > requestedStart) {
      let prevId = getPreviousContractId(contractId);
      let remaining = maxBars - allBars.length;
      let gapEnd = new Date(oldestBarTime - 60000).toISOString(); // 1 min before oldest

      // Walk back through at most 2 previous contracts
      for (let i = 0; i < 2 && prevId && remaining > 0; i++) {
        try {
          const prevData = await adapter.marketData.retrieveBars({
            ...req.body,
            contractId: prevId,
            endTime: gapEnd,
            limit: remaining,
          }) as typeof data;

          const prevBars = prevData.bars ?? [];
          if (prevBars.length === 0) break;

          allBars = allBars.concat(prevBars);
          remaining -= prevBars.length;

          // Move gap end further back if we still need more
          const prevOldest = new Date(prevBars[prevBars.length - 1].t).getTime();
          if (prevOldest <= requestedStart) break;
          gapEnd = new Date(prevOldest - 60000).toISOString();
          prevId = getPreviousContractId(prevId);
        } catch {
          break; // Previous contract may not exist in API
        }
      }
    }
  }

  res.json({ ...data, bars: allBars });
}));

// GET /market/contracts/search?q=NQ
const ContractSearchQuery = z.object({
  q: z.string().optional().default(''),
  live: z.enum(['true', 'false']).optional().default('false'),
});

router.get('/contracts/search', validateQuery(ContractSearchQuery), withConnection(async (req, res) => {
  const live = req.query['live'] === 'true';
  const data = await getAdapter().marketData.searchContracts(
    (req.query['q'] as string) ?? '',
    live,
  );
  res.json(data);
}));

// GET /market/contracts/available?live=false
router.get('/contracts/available', withConnection(async (req, res) => {
  const live = req.query['live'] === 'true';
  const data = await getAdapter().marketData.availableContracts(live);
  res.json(data);
}));

// GET /market/contracts/:id?live=false
router.get('/contracts/:id', withConnection(async (req, res) => {
  const live = req.query['live'] === 'true';
  const data = await getAdapter().marketData.searchContractById(req.params.id, live);
  res.json(data);
}));

export default router;
