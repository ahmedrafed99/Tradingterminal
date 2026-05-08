1. **No hardcoded hex** — Use CSS custom properties: Tailwind (`bg-(--color-surface)`), inline (`var(--color-surface)`), or canvas (`import { COLOR_SURFACE } from 'constants/colors'`).
2. **Transitions everywhere** — Every interactive state change (hover, focus, active, open/close) must be animated. Use `transition-colors` (Tailwind) or `transition: background var(--transition-fast)` (inline).
3. **No new colors** — Add a new token to `tokens.css` with a semantic name instead.
4. **No JS hover handlers** — Use Tailwind `hover:` classes, not `onMouseEnter`/`onMouseLeave` with `setState`.

See `docs/shared/design-tokens/` for the full rule set (borders, disabled state, modal backdrop, input backgrounds, section labels).

## Tailwind Gotcha

Tailwind JIT sometimes fails to generate utility classes (especially spacing like `px-*`, `py-*`, `gap-*`) when they haven't been used elsewhere in the project. If a Tailwind class doesn't take effect, **use inline `style={{ ... }}` instead**. This has been confirmed multiple times in this codebase.