# CLAUDE.md
be concise when talking.
don't mention technicalities (including code) unless user asks you

### When the user asks about a feature
read root readme.md file and use quick lookup table.

### After making code changes
don't commit unless user tests
if a feature changes, always update its relevant documentation

# when debugging
don't log in console, log into a file. use `debugLog.log(tag, data)` from `src/utils/debugLog.ts` — auto-writes to `debug-YYYY-MM-DD.log` in the configured log directory.

## Architecture principles
always look for modularity, nothing is to be harcoded.
