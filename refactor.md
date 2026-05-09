# Refactor Plan

## Shared UI Primitives

### Problem
New UI components (popovers, buttons) get added with no shared shell — each one invents its own padding, margin, border-radius, and hover handling from scratch. Result: visually inconsistent UI across 60+ components.

### Root cause
`shared/` has a `Modal` primitive but nothing for popovers or buttons. So every context menu, dropdown, and button re-implements the same shell and interactive styles differently.

### Missing primitives

#### 1. `shared/Popover.tsx`
The shell used by all floating overlays (context menus, color pickers, dropdowns).  
Standardizes: `bg-(--color-panel)`, `border-(--color-border)`, `SHADOW.XL`, `rounded-lg`, `py-1`.

#### 2. `shared/MenuItem.tsx`
A single row inside a popover/menu.  
Standardizes: `px-3 py-2`, `hover:bg-(--color-surface)`, `text-xs`, icon+label layout, `cursor-default`.

#### 3. `shared/Button.tsx`
Button with variants:
- `ghost` — transparent bg, optional border, `hover:bg-(--color-surface)`
- `primary` — filled `bg-(--color-accent)`, white text
- `danger` — filled `bg-(--color-error)`, white text
- `icon` — square, no label, `p-1.5`

Standardizes: padding (sm/md/lg), font-size `text-xs`, `rounded`, `transition-colors`, `disabled:opacity-50 disabled:cursor-not-allowed`.

### Components to migrate after primitives are built

| Component | Uses |
|---|---|
| `ChartContextMenu` | Popover shell + MenuItem |
| `ChartTimeScaleContextMenu` | Popover shell + MenuItem |
| `ColorPopover` | Popover shell |
| `InstrumentSelectorPopover` | Popover shell |
| `LockoutButton` | Popover shell + Button (ghost, danger) |
| `DatePresetSelector` | Popover shell + MenuItem |
| `ChartToolbar` | Button (icon, ghost) |
| `DrawingEditToolbar` | Button (icon) |
| `BuySellButtons` | Button (primary) |
| `ConditionModal` | Button (primary, ghost) |
| `BracketSettingsModal` | Button (primary, ghost) |