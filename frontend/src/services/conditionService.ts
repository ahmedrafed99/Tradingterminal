import axios from 'axios';

// ---------------------------------------------------------------------------
// Types (mirrors backend condition.ts)
// ---------------------------------------------------------------------------

export type ConditionType = 'closes_above' | 'closes_below';
export type ConditionStatus = 'armed' | 'triggered' | 'failed' | 'expired' | 'paused';

export interface ConditionBracket {
  enabled: boolean;
  sl?: { points: number };
  tp?: { points: number; size?: number }[];
}

export interface Condition {
  id: string;
  contractId: string;
  contractTickSize: number;
  conditionType: ConditionType;
  triggerPrice: number;
  timeframe: string;
  orderSide: 'buy' | 'sell';
  orderType: 'market' | 'limit';
  orderPrice?: number;
  orderSize: number;
  accountId: number;
  bracket?: ConditionBracket;
  expiresAt?: string;
  label?: string;
  status: ConditionStatus;
  createdAt: string;
  updatedAt: string;
  triggeredAt?: string;
  errorMessage?: string;
}

export type CreateConditionInput = Omit<
  Condition,
  'id' | 'status' | 'createdAt' | 'updatedAt' | 'triggeredAt' | 'errorMessage'
>;

export type PatchConditionInput = Partial<CreateConditionInput>;

// ---------------------------------------------------------------------------
// API client — talks to the condition server (separate URL)
// ---------------------------------------------------------------------------

function getApi(baseUrl: string) {
  const api = axios.create({ baseURL: baseUrl.replace(/\/+$/, ''), timeout: 30_000 });
  // Retry once on network error (Render cold-start returns no CORS headers)
  api.interceptors.response.use(undefined, async (err) => {
    const cfg = err.config;
    if (!cfg._retried && (!err.response || err.message === 'Network Error')) {
      cfg._retried = true;
      await new Promise((r) => setTimeout(r, 2000));
      return api.request(cfg);
    }
    return Promise.reject(err);
  });
  return api;
}

let getAllInflight: Promise<Condition[]> | null = null;

export const conditionService = {
  async getAll(baseUrl: string): Promise<Condition[]> {
    if (getAllInflight) return getAllInflight;
    getAllInflight = getApi(baseUrl)
      .get('/conditions')
      .then(({ data }) => data)
      .finally(() => { getAllInflight = null; });
    return getAllInflight;
  },

  async create(baseUrl: string, input: CreateConditionInput): Promise<Condition> {
    const { data } = await getApi(baseUrl).post('/conditions', input);
    return data;
  },

  async update(baseUrl: string, id: string, patch: PatchConditionInput): Promise<Condition> {
    const { data } = await getApi(baseUrl).patch(`/conditions/${id}`, patch);
    return data;
  },

  async pause(baseUrl: string, id: string): Promise<Condition> {
    const { data } = await getApi(baseUrl).post(`/conditions/${id}/pause`);
    return data;
  },

  async resume(baseUrl: string, id: string): Promise<Condition> {
    const { data } = await getApi(baseUrl).post(`/conditions/${id}/resume`);
    return data;
  },

  async remove(baseUrl: string, id: string): Promise<void> {
    await getApi(baseUrl).delete(`/conditions/${id}`);
  },

  /** Open an SSE connection. Returns the EventSource so the caller can close it. */
  subscribe(
    baseUrl: string,
    handlers: {
      onSnapshot?: (conditions: Condition[]) => void;
      onTriggered?: (condition: Condition) => void;
      onFailed?: (condition: Condition) => void;
      onExpired?: (condition: Condition) => void;
    },
  ): EventSource {
    const es = new EventSource(`${baseUrl}/conditions/events`);

    es.addEventListener('snapshot', (e) => {
      handlers.onSnapshot?.(JSON.parse(e.data));
    });
    es.addEventListener('triggered', (e) => {
      handlers.onTriggered?.(JSON.parse(e.data));
    });
    es.addEventListener('failed', (e) => {
      handlers.onFailed?.(JSON.parse(e.data));
    });
    es.addEventListener('expired', (e) => {
      handlers.onExpired?.(JSON.parse(e.data));
    });

    return es;
  },
};
