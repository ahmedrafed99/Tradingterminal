# CLAUDE.md
be concise when talking.
don't mention technicalities (including code) unless user asks you

### When the user asks about a feature
read root readme.md file and use quick lookup table.

### After making code changes
don't commit unless user tests
if a feature changes, always update its relevant documentation

# when debugging
don't log in console, log into a file. use `debugLog.log(tag, data)` from `src/utils/debugLog.ts` — auto-sends to the backend which writes to `log/debug-YYYY-MM-DD.log`. No setup needed.

## Architecture principles
always look for modularity, nothing is to be harcoded.

## Zustand store versioning
`STORE_VERSION` constant in `frontend/src/store/useStore.ts` controls persist compatibility.
- Pre-commit hook (`.git/hooks/pre-commit`) auto-bumps it whenever any file in `frontend/src/store/` is staged — no manual edits needed.
- If persisted version > `STORE_VERSION`, state resets to defaults (protects against reverting to old commits with "future" state).
- Only bump manually if you need to force a reset without touching store files.
