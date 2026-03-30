# Design Token Centralization — Complete

## What was done

Migrated ~672 hardcoded hex color values across ~65 files to a centralized token system.

### Single source of truth
`frontend/src/styles/tokens.css` — CSS custom properties on `:root`. This is the only file where color hex values are defined. `constants/colors.ts` reads from these CSS variables at runtime via `getComputedStyle`, so canvas/JS code stays in sync automatically.

### Architecture
```
tokens.css (edit colors here)
    │
    ├──► Tailwind     bg-(--color-surface)
    ├──► Inline       var(--color-surface)
    └──► colors.ts    getComputedStyle reads --color-surface
            └──► Canvas   ctx.fillStyle = COLOR_SURFACE
```

### Usage patterns
| Context | Syntax |
|---------|--------|
| Tailwind class | `bg-(--color-surface)` |
| Tailwind + opacity | `bg-(--color-surface)/50` |
| Tailwind + state | `hover:bg-(--color-hover-toolbar)` |
| Inline style | `var(--color-surface)` |
| Canvas/ctx | `import { COLOR_SURFACE } from 'constants/colors'` |

### Changing a color
Edit the hex value in `tokens.css`. That's it. Vite HMR updates Tailwind + inline styles. Canvas code picks up the change on next page load (reads via `getComputedStyle` at module init).

### Adding a new color
1. Add `--color-new-name: #hex;` to `tokens.css`
2. Done — `colors.ts` auto-reads it, Tailwind can reference it immediately

### Rules
See `docs/shared/design-tokens/colors.md` for the full developer ruleset.
