# CLAUDE.md

## Documentation-First Workflow

All feature documentation lives in `docs/`. Before modifying or discussing any feature, **read `README.md` (root)** first — it contains a folder map and quick lookup table that points to the correct doc.

### When the user asks about a feature

1. Open `README.md` at the project root
2. Use the **Quick Lookup** table to find the relevant `docs/` subfolder
3. Read that folder's `README.md` for full context
4. For frontend implementation details (store slices, service signatures, component internals), also read `docs/frontend/README.md`

### After making code changes

If a code change affects behavior documented in any feature doc, prompt the user:

> "This change affects [feature]. Want me to update `docs/[feature]/README.md` to reflect the new behavior?"

Do not silently skip documentation updates — the docs are how future sessions recover context.

## Visual Design System

All colors are defined in **`frontend/src/styles/tokens.css`** as CSS custom properties. This is the single source of truth. See `docs/color-palette-rules/README.md` for the full token reference and developer rules.

**Never write a hardcoded hex color in a component file.** Use tokens:
- Tailwind: `bg-(--color-surface)`, `text-(--color-text-muted)`, `border-(--color-border)`
- Inline: `var(--color-surface)`
- Canvas: `import { COLOR_SURFACE } from 'constants/colors'` (reads from CSS vars at runtime)

### Rules

1. **Transitions everywhere** — Every interactive state change (hover, focus, active, open/close) must be animated. Use `transition-colors` (Tailwind) or `transition: background var(--transition-fast)` (inline). Dropdowns and popovers should fade/slide in, never pop instantly.
2. **Borders are always `--color-border`** — Use `border-(--color-border)`. One border color. Opacity modifiers (e.g. `border-(--color-border)/60`) are allowed for subtlety.
3. **Disabled state is always `disabled:opacity-50`** — Not 30, not 40. One value.
4. **Modal backdrop is `bg-black/60`** — Consistent dimming across all modals.
5. **Modal panel background** — Use `bg-black` or `bg-(--color-surface)` depending on context. `bg-black` for full-bleed modals (e.g. screenshot preview), `bg-(--color-surface)` for floating panels/dialogs.
6. **Input/control background is `bg-(--color-input)`** — Not `#0a0a0a`, not `#000`.
7. **Hover backgrounds** — Use `hover:bg-(--color-hover-row)` for list rows/dropdowns, `hover:bg-(--color-hover-toolbar)` for toolbar icon buttons. Never use JS `onMouseEnter`/`onMouseLeave` for hover styling — use Tailwind `hover:` classes.
8. **Section labels** — Use the `SECTION_LABEL` constant from `constants/styles.ts`, or `text-[10px] uppercase tracking-wider text-(--color-text-muted)`.
9. **No new colors** — If a design needs a color not in `tokens.css`, add a new token there with a semantic name. Don't add one-off hex values to component files.

## Performance Rules

1. **Never use bare `useStore()`** — Always pass a selector or `useShallow`. Bare calls subscribe to the entire Zustand store and re-render on every state change (including ~60/sec price ticks). See `docs/frontend/README.md` → "Store subscription rules" for correct patterns.
2. **Throttle high-frequency callbacks** — SignalR quote/trade handlers fire 100+ times/sec. Any work triggered by these (chart updates, DOM writes, store updates) must be batched via `requestAnimationFrame` so it runs at most once per frame.
3. **Avoid `getBoundingClientRect()` in mousemove handlers** — It forces synchronous DOM layout reflow. If needed, RAF-throttle the handler so it runs at most once per frame.

## Tailwind Gotcha

Tailwind JIT sometimes fails to generate utility classes (especially spacing like `px-*`, `py-*`, `gap-*`) when they haven't been used elsewhere in the project. If a Tailwind class doesn't take effect, **use inline `style={{ ... }}` instead**. This has been confirmed multiple times in this codebase.
