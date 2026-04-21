# CLAUDE.md

## Documentation-First Workflow

All feature documentation lives in `docs/`. Before modifying or discussing any feature, **read `README.md` (root)** first — it contains a folder map and quick lookup table that points to the correct doc.

### When the user asks about a feature

1. Open `README.md` at the project root
2. Use the **Quick Lookup** table to find the relevant `docs/` subfolder
3. Read that folder's `README.md` for full context
4. For frontend implementation details (store slices, service signatures, component internals), also read `docs/shared/frontend/README.md`

### After making code changes

If a code change affects behavior documented in any feature doc, prompt the user:

> "This change affects [feature]. Want me to update `docs/[feature]/README.md` to reflect the new behavior?"

Do not silently skip documentation updates — the docs are how future sessions recover context.

## Visual Design System

All colors are defined in **`frontend/src/styles/tokens.css`** as CSS custom properties. This is the single source of truth. See `docs/shared/design-tokens/colors.md` for the full token reference and developer rules, and `docs/shared/design-tokens/ui.md` for font family, z-index, shadows, radii, and transitions.

### Rules

1. **No hardcoded hex** — Use CSS custom properties: Tailwind (`bg-(--color-surface)`), inline (`var(--color-surface)`), or canvas (`import { COLOR_SURFACE } from 'constants/colors'`).
2. **Transitions everywhere** — Every interactive state change (hover, focus, active, open/close) must be animated. Use `transition-colors` (Tailwind) or `transition: background var(--transition-fast)` (inline).
3. **No new colors** — Add a new token to `tokens.css` with a semantic name instead.
4. **No JS hover handlers** — Use Tailwind `hover:` classes, not `onMouseEnter`/`onMouseLeave` with `setState`.

See `docs/shared/design-tokens/` for the full rule set (borders, disabled state, modal backdrop, input backgrounds, section labels).

## Performance Rules

1. **Never use bare `useStore()`** — Always pass a selector or `useShallow`. Bare calls subscribe to the entire Zustand store and re-render on every state change (including ~60/sec price ticks). See `docs/shared/frontend/README.md` → "Store subscription rules" for correct patterns.
2. **Throttle high-frequency callbacks** — SignalR quote/trade handlers fire 100+ times/sec. Any work triggered by these (chart updates, DOM writes, store updates) must be batched via `requestAnimationFrame` so it runs at most once per frame.
3. **Avoid `getBoundingClientRect()` in mousemove handlers** — It forces synchronous DOM layout reflow. If needed, RAF-throttle the handler so it runs at most once per frame.

## Tailwind Gotcha

Tailwind JIT sometimes fails to generate utility classes (especially spacing like `px-*`, `py-*`, `gap-*`) when they haven't been used elsewhere in the project. If a Tailwind class doesn't take effect, **use inline `style={{ ... }}` instead**. This has been confirmed multiple times in this codebase.

## Code Style/Architecture principles
Prefer reusing existing components over creating new abstractions. For order lines, SL/TP markers, and toolbars, check for existing implementations first.
