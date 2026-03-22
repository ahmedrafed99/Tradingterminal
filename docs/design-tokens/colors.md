# Color Palette Rules

> **One file to rule them all:** `frontend/src/styles/tokens.css`

This document defines strict rules for how colors are used in this project. Every developer must follow these rules. No exceptions.

---

## The Golden Rule

**Never write a hardcoded hex color value in a component file.**

All colors come from `tokens.css`. If the color you need doesn't exist as a token, you either:
1. Use the closest existing token, or
2. Add a new token to `tokens.css` (and get it reviewed)

---

## Architecture

```
tokens.css  ──────────────────────────────  THE source of truth
    │
    ├──► Tailwind classes    bg-(--color-surface)
    ├──► Inline styles       var(--color-surface)
    └──► colors.ts ─────►   Canvas/ctx code imports COLOR_SURFACE
```

- **`frontend/src/styles/tokens.css`** — CSS custom properties on `:root`. This is the only place color values are defined.
- **`frontend/src/constants/colors.ts`** — Reads from CSS variables at runtime via `getComputedStyle`. Used by canvas/ctx code that can't resolve `var()`. **Never edit hex values in this file** — it auto-reads from `tokens.css`.
- **`frontend/src/constants/styles.ts`** — Reusable Tailwind class strings. References CSS variables, not hex values.

---

## How to Use Colors

### In Tailwind classes (most common)
```tsx
// Background
className="bg-(--color-surface)"

// Text
className="text-(--color-text-muted)"

// Border
className="border-(--color-border)"

// With opacity modifier
className="bg-(--color-surface)/50"

// With state prefix
className="hover:bg-(--color-hover-toolbar)"
```

### In inline styles
```tsx
style={{ background: 'var(--color-surface)', color: 'var(--color-text-muted)' }}
```

### In canvas/ctx code
```ts
import { COLOR_SURFACE, COLOR_TEXT_MUTED } from '../../constants/colors';

ctx.fillStyle = COLOR_SURFACE;
ctx.strokeStyle = COLOR_TEXT_MUTED;
```

---

## Token Reference

### Backgrounds
| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg` | `#131722` | Page background, chart canvas |
| `--color-panel` | `#000000` | Panel backgrounds — order panel, top bar, bottom panel, toolbars, dropdowns |
| `--color-surface` | `#111111` | Modal panels, hover rows, card backgrounds |
| `--color-input` | `#111111` | Text inputs, search fields, spinners |
| `--color-hover-row` | `#1e222d` | Dropdown item / list row hover |
| `--color-hover-toolbar` | `#363a45` | Toolbar icon button hover |
| `--color-table-stripe` | `#0d1117` | Alternating table row (use with `/40` opacity) |

### Text
| Token | Value | Usage |
|-------|-------|-------|
| `--color-text` | `#d1d4dc` | Primary body text |
| `--color-text-bright` | `#ffffff` | Active/selected text, modal titles, emphasis on dark backgrounds |
| `--color-text-muted` | `#787b86` | Section labels, secondary info, icon strokes |
| `--color-text-dim` | `#434651` | Placeholders, empty states, disabled text |
| `--color-text-medium` | `#9598a1` | Field labels, supporting descriptions |

### Borders
| Token | Value | Usage |
|-------|-------|-------|
| `--color-border` | `#2a2e39` | All borders — modal edges, dividers, table borders |
| `--color-separator` | `#000000` | Bottom panel resize handle / separator bar |
| `--color-focus-ring` | `#1a3a6e` | Focus ring on inputs and controls |

### Accents
| Token | Value | Usage |
|-------|-------|-------|
| `--color-accent` | `#2962ff` | Primary interactive — checkboxes, connect button, focus rings |
| `--color-accent-hover` | `#1e4fcc` | Accent hover state |
| `--color-accent-text` | `#5b8def` | Ghost button text, soft accent links on dark backgrounds |
| `--color-warning` | `#f0a830` | Active instrument, warning toasts, selected highlights |
| `--color-error` | `#f23645` | Error toasts, validation, delete hovers |

### Trade Direction
| Token | Value | Usage |
|-------|-------|-------|
| `--color-buy` | `#26a69a` | Positive P&L, BUY labels |
| `--color-sell` | `#ef5350` | Negative P&L, SELL labels |
| `--color-btn-buy` | `#1b6b4a` | Buy button background |
| `--color-btn-buy-hover` | `#22835b` | Buy button hover |
| `--color-btn-sell` | `#8b2232` | Sell button background |
| `--color-btn-sell-hover` | `#a62a3d` | Sell button hover |

### Chart Lines
| Token | Value | Usage |
|-------|-------|-------|
| `--color-line-buy` | `#00c805` | Green order/position line |
| `--color-line-buy-hover` | `#00a004` | Green line hover |
| `--color-line-sell` | `#ff0000` | Red order/position line |
| `--color-line-sell-hover` | `#cc0000` | Red line hover |

### Label System (chart overlays)
| Token | Value | Usage |
|-------|-------|-------|
| `--color-label-bg` | `#cac9cb` | Neutral label background |
| `--color-label-text` | `#000000` | Label text (dark on light) |
| `--color-label-close` | `#e0e0e0` | Close (X) button background |
| `--color-label-close-hover` | `#b8b8b8` | Close (X) button hover (darkened) |
| `--color-handle-stroke` | `#4a90d9` | Drawing selection handle border (all renderers) |

---

## Rules for Developers

### 1. No new hex values
If you need a color, check the token table above. If nothing fits, propose a new token in `tokens.css` with a semantic name and get it reviewed. Do not add one-off `#hex` values.

### 2. Borders are always `--color-border`
One border color. No `#222`, no `#333`, no `#4a4a4a`. Use `--color-border` with optional opacity modifier (`/60`, `/50`).

### 3. Disabled state is always `opacity-50`
Not 30, not 40. `disabled:opacity-50`.

### 4. Modal backdrop is `bg-black/60`
Consistent dimming across all modals.

### 5. Transitions everywhere
Every interactive state change (hover, focus, active, open/close) must be animated. Use `transition-colors` (Tailwind) or `transition: background var(--transition-fast)` (inline).

### 6. Never use JS hover handlers for color changes
Use Tailwind `hover:` classes, not `onMouseEnter`/`onMouseLeave` with `setState`. The only exception is canvas code.

### 7. Adding a new color
1. Add the CSS variable to `tokens.css` under the appropriate section with a semantic name
2. That's it — `colors.ts` auto-reads it, Tailwind can reference it immediately

### 8. Changing an existing color
Edit the value in `tokens.css`. Everything updates automatically:
- Tailwind classes via Vite HMR
- Inline styles via CSS variable resolution
- Canvas code via `colors.ts` which reads from `getComputedStyle`

---

## Acceptable Exceptions

These are the only cases where raw hex values are allowed:

1. **`chartSettingsSlice.ts`** — User-configurable chart colors persisted to localStorage. These are intentionally mutable per-user.
2. **`ColorPopover.tsx` palette arrays** — Selectable colors for drawings. These are a UI feature, not design tokens.
3. **Canvas drawing defaults** (`#ffffff`, `#000000` for contrast) — Canvas text needs concrete colors for readability calculations.
4. **Alpha variants** (`#00000080`) — When you need hex+alpha notation for canvas or special cases.
5. **Chart-specific one-offs** (`#0097a6`, `#d32f2f`) — Unique chart indicator colors with no broader UI usage.

Everything else must use a token.

---

## Theme Editor (developer tool)

A live theme editor is available at `/theme-editor.html` when running the Vite dev server.

**Features:**
- Card-based sidebar (400px) with color tokens grouped by category — click any swatch to open a color picker
- **Typography card** — large "Aa" hero preview, editable font-family, and a font-size scale with live sample text at each tier
- **Component Preview card** — live mini-previews of Buy/Sell buttons, inputs, and text hierarchy that update in real-time
- Live preview via iframe — changes update instantly in the preview
- **Inspect Mode** — hover over any element in the preview to see which color and typography tokens control it, click to edit matched tokens in-place
- **Apply to File** — writes changes directly to `tokens.css` via a Vite dev server plugin (`POST /__theme-write`). Vite HMR picks up the change and hot-reloads the app automatically

**How to use:**
1. Start the dev server (`npm run dev`)
2. Open `http://localhost:5173/theme-editor.html`
3. Edit colors, font family, or font sizes in the sidebar cards — or use Inspect Mode to find and change specific element tokens
4. Click "Apply to File" to persist changes to `tokens.css`

> **Note:** Canvas-rendered elements (chart primitives using `colors.ts`) read CSS variables at module init time. After applying file changes, a full page reload may be needed for canvas colors to update.

---

## File Quick Reference

| I need to... | File |
|---|---|
| See all available tokens | `frontend/src/styles/tokens.css` |
| Use a color in canvas/ctx | `import { COLOR_* } from 'constants/colors'` |
| Use a reusable Tailwind pattern | `import { SECTION_LABEL, INPUT_DARK, ... } from 'constants/styles'` |
| See the visual palette reference | `docs/design-tokens/index.html` |
| Live-edit tokens with preview | `/theme-editor.html` (dev server) |
