# CLAUDE.md
be concise when talking.
don't mention technicalities (including code) unless user asks you

### When the user asks about a feature
read root readme.md file and use quick lookup table.

### When editing a component
read `.claude/components.json` first — use it to locate relevant files instead of re-exploring the codebase. After editing, update the component's entry if description, keywords, or notes changed.

### When creating a new UI component (modal, popover, menu, button, form, etc.)
**Always compose from the ui primitives first** — `frontend/src/components/ui/`:
- `Modal` — accessible dialog with focus trap, backdrop, header/footer. Use instead of a raw `div` overlay.
- `Button` — all variants (primary, secondary, accent, danger, toolbar, ghost). Never style raw `<button>` manually.
- `Menu` / `MenuItem` / `MenuContent` — dropdown menus with keyboard nav. Never hand-roll click-outside + positioning.

These primitives use Radix UI for behavior and inline styles + CSS variables for visuals — exactly matching the design system.

Only reach for raw markup when the primitive genuinely doesn't fit. When you do, read at least one existing similar component from the codebase.

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
