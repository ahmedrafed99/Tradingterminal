# CLAUDE.md
be concise when talking.
don't mention technicalities (including code) unless user asks you

### When the user asks about a feature
read root readme.md file and use quick lookup table.

### When editing a component
read `.claude/components.json` first — use it to locate relevant files instead of re-exploring the codebase. After editing, update the component's entry if description, keywords, or notes changed.

### When creating a new UI component or reuse one  (modal, popover, menu, button, form, etc.)
refer to design-system.html

### After making code changes
don't commit unless user tests
if a feature changes, always update its relevant documentation

# when debugging
don't log in console, log into a file. use `debugLog.log(tag, data)` from `src/utils/debugLog.ts` — auto-sends to the backend which writes to `log/debug-YYYY-MM-DD.log`. No setup needed.

## Architecture principles
always look for modularity, nothing is to be harcoded.

### Buttons
never create a raw `<button>` or a new button file. use `shared/Button.tsx`.
- variants: `ghost` | `filled` | `toolbar` | `tab` (with `active` prop)
- tones: `default` | `danger`

### Modals
use `shared/Modal.tsx`. pass `title` prop to get the standard header + X button for free — don't build a header div manually inside the modal.

### Icons
import from `components/icons/` (`XIcon`, `ChevronDown`, `ChevronRight`, `ChevronUp`).
inline SVGs only for one-off decorative icons local to a single component.
when the same SVG appears in 2+ places, extract it to `components/icons/`.
icon shape: `{ size?: number; className?: string }` — `stroke="currentColor"`, no hardcoded colors.

### Form controls
use `shared/Checkbox.tsx` and `shared/Toggle.tsx` — never `<input type="checkbox">` or a hand-rolled toggle div.

### Hover state
use CSS / Tailwind `hover:` classes. never `onMouseEnter`/`onMouseLeave` to swap inline styles.

## Zustand store versioning
`STORE_VERSION` constant in `frontend/src/store/useStore.ts` controls persist compatibility.
- Pre-commit hook (`.git/hooks/pre-commit`) auto-bumps it whenever any file in `frontend/src/store/` is staged — no manual edits needed.
- If persisted version > `STORE_VERSION`, state resets to defaults (protects against reverting to old commits with "future" state).
- Only bump manually if you need to force a reset without touching store files.
