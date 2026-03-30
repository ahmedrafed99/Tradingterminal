# Design Tokens

Single source of truth for all visual design values in this project. Two rule sets:

| Document | Covers | Source of truth |
|----------|--------|-----------------|
| [colors.md](colors.md) | Color palette, hex values, CSS custom properties | `frontend/src/styles/tokens.css` |
| [ui.md](ui.md) | Font family, font sizes, z-index stack, box shadows, border radii, transition durations | `frontend/src/constants/layout.ts` + `tokens.css` |

See also:
- [refactor.md](refactor.md) — Color refactor history
- Live theme editor: run `npm run dev` and open `/theme-editor.html`
