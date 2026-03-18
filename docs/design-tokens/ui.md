# Layout Tokens

> **One file to rule them all:** `frontend/src/constants/layout.ts`

This document defines strict rules for how font family, z-index, box shadows, border radii, and transition durations are used in this project. Every developer must follow these rules. No exceptions.

---

## The Golden Rule

**Never hardcode a font-family string, z-index number, box-shadow value, or border-radius number in a component file.**

All layout tokens come from `constants/layout.ts` (JS) or `tokens.css` (CSS transitions). If the value you need doesn't exist as a token, you either:
1. Use the closest existing token, or
2. Add a new token to `layout.ts` / `tokens.css` (and get it reviewed)

---

## Architecture

```
layout.ts  ──────────────────────────────  THE source of truth (JS tokens)
    │
    ├──► Inline styles     fontFamily: FONT_FAMILY
    ├──► Inline styles     zIndex: Z.DROPDOWN
    ├──► Inline styles     boxShadow: SHADOW.LG
    ├──► Inline styles     borderRadius: RADIUS.XL
    └──► Canvas/ctx code   ctx.font = `12px ${FONT_FAMILY}`

tokens.css  ─────────────────────────────  THE source of truth (CSS transitions)
    │
    ├──► Inline styles     transition: 'opacity var(--transition-fast)'
    └──► cssText strings   transition:opacity var(--transition-fast)
```

- **`frontend/src/constants/layout.ts`** — Exports `FONT_FAMILY`, `Z`, `SHADOW`, and `RADIUS`. This is the only place these values are defined.
- **`frontend/src/styles/tokens.css`** — Defines `--transition-fast`, `--transition-normal`, and `--transition-slow` alongside color tokens. These are CSS custom properties on `:root`.

---

## How to Use

### Font Family

```tsx
// Inline style
style={{ fontFamily: FONT_FAMILY }}

// Canvas context
ctx.font = `12px ${FONT_FAMILY}`;

// In a cssText string (imperative DOM)
el.style.cssText = `font-family:${FONT_FAMILY};`;
```

### Z-Index

```tsx
// Inline style — always use Z.* instead of a raw number
style={{ zIndex: Z.DROPDOWN }}

// Never do this:
style={{ zIndex: 50 }}        // BAD
className="z-50"              // BAD
```

### Box Shadow

```tsx
// Inline style
style={{ boxShadow: SHADOW.LG }}

// Ring helper for selected swatches
style={{ boxShadow: isSelected ? SHADOW.ring('var(--color-surface)') : 'none' }}

// In a template literal (CSS-in-JS)
`box-shadow: ${SHADOW.LG};`
```

### Border Radius

```tsx
// Inline style
style={{ borderRadius: RADIUS.XL }}

// Circle
style={{ borderRadius: RADIUS.CIRCLE }}

// Compound values (per-corner) — acceptable as raw strings
style={{ borderRadius: '2px 0 0 2px' }}

// Dynamic values — acceptable as expressions
style={{ borderRadius: strokeWidth / 2 }}
```

### Transition Durations

```tsx
// Inline style — reference the CSS custom property
style={{ transition: 'opacity var(--transition-fast)' }}
style={{ transition: 'background var(--transition-normal) ease' }}

// In a cssText string
el.style.cssText = 'transition:opacity var(--transition-fast);';
```

---

## Token Reference

### Font Family

| Token | Value |
|-------|-------|
| `FONT_FAMILY` | `-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif` |

One font stack for the entire app — components, canvas primitives, imperative DOM.

### Z-Index Stack

| Token | Value | Usage |
|-------|-------|-------|
| `Z.HEADER` | `10` | Sticky table headers, loading/error overlays, instrument label, FPS counter |
| `Z.OVERLAY` | `20` | Overlay containers (chart overlay wrapper) |
| `Z.TOOLBAR` | `30` | Drawing toolbar, quick-order box, scroll-to-latest button |
| `Z.TOOLBAR_EDIT` | `40` | Drawing edit toolbar (must sit above drawing toolbar) |
| `Z.DROPDOWN` | `50` | All dropdowns, popovers, modals, selects, color pickers |
| `Z.TOAST` | `100` | Toast notifications, top-level color popovers in modals |

Layers are intentionally spaced to allow future additions without renumbering.

### Box Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `SHADOW.SM` | `0 1px 3px rgba(0,0,0,0.4)` | Subtle elevation — slider thumbs, small controls |
| `SHADOW.MD` | `0 4px 12px rgba(0,0,0,0.5)` | Medium elevation — settings dropdown |
| `SHADOW.LG` | `0 4px 16px rgba(0,0,0,0.4)` | Standard dropdown — toolbar menus, selects, account dropdown |
| `SHADOW.XL` | `0 4px 24px rgba(0,0,0,0.5)` | Large dropdown — instrument selector, toast, chart toolbar menus |
| `SHADOW.XXL` | `0 8px 32px rgba(0,0,0,0.6), ...` | Heavy elevation — camera menu, large floating panels |
| `SHADOW.HERO` | `0 24px 80px rgba(0,0,0,0.6), ...` | Hero element — screenshot preview modal |
| `SHADOW.ring(color)` | `0 0 0 1px <color>` | Selection ring — active color swatch outline |

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `RADIUS.XS` | `1` | Hairline rounding — alignment grid lines |
| `RADIUS.SM` | `2` | Minimal rounding — badges, color swatches, small chips |
| `RADIUS.MD` | `3` | Default rounding — checkboxes, color palette buttons, swatch grids |
| `RADIUS.LG` | `4` | Standard rounding — buttons, inputs, dropdown menus, key badges |
| `RADIUS.XL` | `8` | Large rounding — sliders, select controls, toast, drawing toolbars |
| `RADIUS.PILL` | `9` | Pill shape — toggle switch track |
| `RADIUS.CIRCLE` | `'50%'` | Circle — toggle thumb, color picker remove button, point indicators |

### Transition Durations (CSS tokens)

| Token | Value | Usage |
|-------|-------|-------|
| `--transition-fast` | `0.15s` | Most interactions — hover color, opacity fade, border-color, dropdown appear |
| `--transition-normal` | `0.2s` | Medium interactions — scroll button fade, icon opacity, stroke transitions |
| `--transition-slow` | `0.25s` | Deliberate transitions — crosshair border, modal entrance |

---

## Rules for Developers

### 1. No raw z-index numbers
Never write `zIndex: 50` or `z-50`. Always use `Z.DROPDOWN` (or the appropriate layer). If you need a new layer, add it to `layout.ts` with a value that fits between existing layers.

### 2. No raw shadow strings
Never write `boxShadow: '0 4px 16px rgba(0,0,0,0.4)'`. Use `SHADOW.LG`. If you need a different shadow, add a new token.

### 3. No raw border-radius numbers
Never write `borderRadius: 4`. Use `RADIUS.LG`. Exceptions: compound values (`'2px 0 0 2px'`) and dynamic calculations (`strokeWidth / 2`).

### 4. No copy-pasted font-family strings
Never write the font stack inline. Import `FONT_FAMILY` from `constants/layout`.

### 5. No hardcoded transition durations
Never write `transition: 'opacity 0.15s'`. Use `transition: 'opacity var(--transition-fast)'`. The only exceptions are long-running animations (`1s`, `1.2s`) like recording pulses.

### 6. Adding a new token
1. Add the constant to `layout.ts` under the appropriate section (or add a CSS variable to `tokens.css` for transitions)
2. Use a semantic name that describes the purpose, not the value
3. Update this document's token reference table

### 7. Changing an existing token
Edit the value in `layout.ts` (or `tokens.css`). Everything updates automatically — all imports resolve to the new value.

---

## Acceptable Exceptions

These are the only cases where raw values are allowed:

1. **Compound border-radius** — Per-corner values like `'2px 0 0 2px'` that can't be expressed as a single token
2. **Dynamic border-radius** — Calculated values like `strokeWidth / 2` that depend on runtime data
3. **Long-running animations** — Pulse/recording animations (`1s`, `1.2s`) that don't fit the interaction duration scale
4. **CSS keyframe animations in `index.css`** — Durations in `@keyframes` and animation class definitions are co-located with their keyframes for readability
5. **Tailwind `rounded-lg`** — Tailwind border-radius classes in `className` strings (e.g. in `INPUT_BASE`) are acceptable since they use Tailwind's built-in scale

Everything else must use a token.

---

## File Quick Reference

| I need to... | File |
|---|---|
| See all layout tokens | `frontend/src/constants/layout.ts` |
| See transition duration tokens | `frontend/src/styles/tokens.css` |
| Use font, z-index, shadow, or radius in a component | `import { FONT_FAMILY, Z, SHADOW, RADIUS } from 'constants/layout'` |
| See color tokens (separate system) | `docs/design-tokens/colors.md` |
| See reusable Tailwind class strings | `frontend/src/constants/styles.ts` |
