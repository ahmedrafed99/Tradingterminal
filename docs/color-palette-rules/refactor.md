# Design Token Centralization — Refactor Plan

## Problem

Color values are scattered across ~15-20 component files as hardcoded hex strings in three forms:
- Inline `style={{}}` objects (e.g. `background: '#1f1f1f'`)
- Tailwind arbitrary classes (e.g. `bg-[#1e222d]`, `border-[#2a2e39]`)
- Constants in `styles.ts` and `chartSettingsSlice.ts`

No single source of truth exists. Changing a token (e.g. separator color) requires find-and-replace across the entire codebase.

## Goal

Centralize all design tokens into CSS custom properties on `:root`, so every component reads from one place. Optionally, make the `docs/color-palette-rules/index.html` page interactive — edit a color there, and it propagates to the app.

---

## Phase 1 — CSS Variables Layer (lightweight)

**Scope:** ~2-3 new/modified files. No component refactor yet.

1. Create `frontend/src/styles/tokens.css` defining all tokens as CSS custom properties:
   ```css
   :root {
     /* Backgrounds */
     --bg-modal-settings: #1f1f1f;
     --bg-popover: #131722;
     --bg-modal-standard: #1e222d;
     --bg-input: #111;
     --bg-fullbleed: #000;
     --bg-hover: #2a2e39;

     /* Borders */
     --border-outer: #2a2e39;
     --border-internal: #4a4a4a;
     --border-control: #4a4a4a;

     /* Text */
     --text-heading: #fff;
     --text-primary: #d1d4dc;
     --text-secondary: #9598a1;
     --text-muted: #787b86;
     --text-placeholder: #434651;

     /* Accents */
     --accent-blue-primary: #1e3a8a;
     --accent-blue-primary-hover: #1e2f6a;
     --accent-blue-bright: #2962ff;
     --accent-blue-bright-hover: #1e4fcc;
     --accent-buy: #1b6b4a;
     --accent-sell: #8b2232;
     --accent-gold: #f0a830;

     /* Controls */
     --control-swatch-size: 28px;
     --control-swatch-radius: 4px;
     --control-dropdown-height: 28px;
     --checkbox-size: 16px;
     --checkbox-radius: 3px;

     /* Transitions */
     --transition-duration: 0.15s;
     --disabled-opacity: 0.5;
   }
   ```

2. Import `tokens.css` in the app entry point (`main.tsx` or `index.css`).

3. Update `frontend/src/constants/styles.ts` to reference the variables:
   ```ts
   // Before: bg-[#111] border-[#2a2e39]
   // After:  uses var() in inline styles, or Tailwind theme extension
   ```

**Result:** Tokens exist in one file but most components still use hardcoded values. This is the foundation.

---

## Phase 2 — Component Migration

**Scope:** ~15-20 component files. Can be done incrementally.

For each component, replace hardcoded hex values with `var(--token-name)`:

### Inline styles
```tsx
// Before
style={{ background: '#1f1f1f', border: '1px solid #4a4a4a' }}

// After
style={{ background: 'var(--bg-modal-settings)', border: '1px solid var(--border-internal)' }}
```

### Tailwind classes
Option A — extend `tailwind.config.ts` to map tokens:
```ts
theme: {
  extend: {
    colors: {
      'modal-settings': 'var(--bg-modal-settings)',
      'border-outer': 'var(--border-outer)',
      // ...
    }
  }
}
```
Then use `bg-modal-settings` instead of `bg-[#1f1f1f]`.

Option B — leave Tailwind arbitrary values but point them at variables: `bg-[var(--bg-modal-settings)]`. Less clean but zero config.

### Files to migrate (priority order)
1. `constants/styles.ts` — INPUT_BASE, INPUT_DARK, INPUT_SURFACE, SECTION_LABEL
2. `shared/Modal.tsx` — backdrop color
3. `chart/ChartSettingsModal.tsx` — all inline colors
4. `chart/ChartSettingsButton.tsx` — popover colors
5. `chart/ColorPopover.tsx` — swatch borders, bg
6. `SettingsModal.tsx` — panel bg, borders, button colors
7. `bottom-panel/ConditionModal.tsx` — all inline colors
8. `order-panel/BracketSettingsModal.tsx` — panel bg, borders
9. `InstrumentSelectorPopover.tsx` — popover bg, borders
10. `order-panel/BuySellButtons.tsx` — buy/sell accent colors
11. `shared/TabButton.tsx` — active underline color
12. `Toast.tsx` — bg, border, accent colors

---

## Phase 3 — Interactive Editor (optional)

**Scope:** Update `docs/color-palette-rules/index.html` only.

1. Add `<input type="color">` pickers next to each swatch in the HTML reference page
2. On change, write updated values to a `tokens.json` file (via a tiny local dev server or file:// API)
3. Add a build step or Vite plugin that reads `tokens.json` and generates `tokens.css`
4. Hot reload picks up the CSS change → app updates live

**Alternative (simpler):** Skip the JSON round-trip. Just edit `tokens.css` directly — since all components read from `var()`, changes propagate on save via Vite HMR. The HTML page stays read-only as a reference.

---

## Effort Estimate

| Phase | Files | Complexity |
|-------|-------|------------|
| Phase 1 — CSS variables file | 2-3 | Low |
| Phase 2 — Component migration | 15-20 | Medium (mechanical, can be incremental) |
| Phase 3 — Interactive editor | 1 + build config | Low-Medium |
