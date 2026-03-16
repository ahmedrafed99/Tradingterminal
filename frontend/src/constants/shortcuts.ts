// ---------------------------------------------------------------------------
// Keyboard shortcut registry — central definition of all configurable shortcuts
// ---------------------------------------------------------------------------

export interface KeyCombo {
  key: string;       // KeyboardEvent.key value, e.g. 'z', 'Escape', 'Delete'
  ctrl?: boolean;    // Ctrl on Windows, Cmd on Mac
  shift?: boolean;
  alt?: boolean;
}

export interface ShortcutDef {
  id: string;
  label: string;
  category: string;
  defaults: KeyCombo[];
  rebindable: boolean;  // false = display-only (mouse modifiers etc.)
}

// ---------------------------------------------------------------------------
// Default shortcut definitions
// ---------------------------------------------------------------------------
export const SHORTCUT_DEFS: ShortcutDef[] = [
  { id: 'drawing.cancel',   label: 'Cancel / Deselect',   category: 'Drawing', defaults: [{ key: 'Escape' }], rebindable: true },
  { id: 'drawing.delete',   label: 'Delete selected',     category: 'Drawing', defaults: [{ key: 'Delete' }, { key: 'Backspace' }], rebindable: true },
  { id: 'drawing.undo',     label: 'Undo',                category: 'Drawing', defaults: [{ key: 'z', ctrl: true }], rebindable: true },
  { id: 'drawing.ctrlDrag', label: 'Multi-select (drag)', category: 'Drawing', defaults: [{ key: 'Ctrl+Drag' }], rebindable: false },
  { id: 'drawing.ctrlSnap', label: 'Horizontal snap',     category: 'Drawing', defaults: [{ key: 'Ctrl+Hold' }], rebindable: false },
  { id: 'drawing.shiftRuler', label: 'Quick ruler (drag)', category: 'Drawing', defaults: [{ key: 'Shift+Drag' }], rebindable: false },
];

/** Default combos keyed by shortcut ID */
export const DEFAULT_SHORTCUTS: Record<string, KeyCombo[]> = Object.fromEntries(
  SHORTCUT_DEFS.map((d) => [d.id, d.defaults]),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a keyboard event matches any of the given key combos */
export function matchesShortcut(e: KeyboardEvent, combos: KeyCombo[]): boolean {
  for (const c of combos) {
    const wantCtrl = c.ctrl ?? false;
    const wantShift = c.shift ?? false;
    const wantAlt = c.alt ?? false;
    const hasCtrl = e.ctrlKey || e.metaKey;

    if (
      e.key.toLowerCase() === c.key.toLowerCase() &&
      hasCtrl === wantCtrl &&
      e.shiftKey === wantShift &&
      e.altKey === wantAlt
    ) {
      return true;
    }
  }
  return false;
}

/** Merge custom shortcuts over defaults */
export function getEffectiveShortcuts(custom: Record<string, KeyCombo[]>): Record<string, KeyCombo[]> {
  const result: Record<string, KeyCombo[]> = { ...DEFAULT_SHORTCUTS };
  for (const [id, combos] of Object.entries(custom)) {
    if (combos.length > 0) result[id] = combos;
  }
  return result;
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

/** Format a key combo for display, e.g. "Ctrl+Z", "Esc" */
export function formatKeyCombo(combo: KeyCombo): string {
  const parts: string[] = [];
  if (combo.ctrl) parts.push(IS_MAC ? 'Cmd' : 'Ctrl');
  if (combo.alt) parts.push(IS_MAC ? 'Option' : 'Alt');
  if (combo.shift) parts.push('Shift');

  // Friendly key names
  let keyName = combo.key;
  if (keyName === 'Escape') keyName = 'Esc';
  else if (keyName === 'Delete') keyName = 'Del';
  else if (keyName === 'ArrowUp') keyName = '\u2191';
  else if (keyName === 'ArrowDown') keyName = '\u2193';
  else if (keyName === 'ArrowLeft') keyName = '\u2190';
  else if (keyName === 'ArrowRight') keyName = '\u2192';
  else if (keyName === ' ') keyName = 'Space';
  else if (keyName.length === 1) keyName = keyName.toUpperCase();

  parts.push(keyName);
  return parts.join('+');
}
