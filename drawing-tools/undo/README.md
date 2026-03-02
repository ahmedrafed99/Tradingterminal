# Drawing Undo (Ctrl+Z)

Undo stack for drawing mutations — lets users revert accidental moves, additions, and deletions with Ctrl+Z.

---

## Architecture

```
Store Layer     DrawingsState slice (extended)
                    drawingUndoStack: UndoEntry[]   (ephemeral, not persisted)
                    undoDrawing()                    (pops stack, reverses action)

                Existing actions modified to push undo entries:
                    addDrawing()    → pushes { type: 'add', drawingId }
                    updateDrawing() → pushes { type: 'update', drawingId, previous }
                    removeDrawing() → pushes { type: 'remove', drawing }

Keyboard        CandlestickChart.tsx onKeyDown handler
                    Ctrl+Z → store.undoDrawing()
```

No new components or files — only modifications to existing store slice and keyboard handler.

---

## Undo Entry Types

```ts
type UndoEntry =
  | { type: 'add'; drawingId: string }
  | { type: 'update'; drawingId: string; previous: Partial<Drawing> }
  | { type: 'remove'; drawing: Drawing };
```

| Original action | What gets pushed | How undo reverses it |
|---|---|---|
| `addDrawing(d)` | `{ type: 'add', drawingId: d.id }` | Removes the drawing by id |
| `updateDrawing(id, patch)` | `{ type: 'update', drawingId: id, previous }` | Restores the previous field values (snapshot of patched keys before mutation) |
| `removeDrawing(id)` | `{ type: 'remove', drawing }` | Re-adds the full drawing object |

---

## Store Changes

File: `frontend/src/store/useStore.ts`

### Interface additions to DrawingsState

```ts
interface DrawingsState {
  // ... existing fields ...
  drawingUndoStack: UndoEntry[];
  updateDrawing: (id: string, patch: Partial<Drawing>, skipUndo?: boolean) => void;
  pushDrawingUndo: (entry: UndoEntry) => void;
  undoDrawing: () => void;
}
```

### Implementation

**`addDrawing`** — pushes undo entry after adding.

**`updateDrawing(id, patch, skipUndo?)`** — when `skipUndo` is falsy (default), snapshots the current values of patched keys and pushes an undo entry. When `skipUndo` is `true`, only mutates the drawing (used during drag/resize mousemove to avoid flooding the stack).

**`removeDrawing`** — saves the full drawing before deleting, pushes undo entry.

**`pushDrawingUndo(entry)`** — manually pushes a single undo entry. Used on drag/resize mouseup to record the pre-drag state as one undoable action.

**`undoDrawing`** — pops the latest entry and reverses it (remove for add, restore previous for update, re-add for remove).

### Drag/resize: skipUndo + pushDrawingUndo pattern

During drag-to-move and oval resize, `updateDrawing` fires on every mousemove (dozens of times per drag). Without `skipUndo`, Ctrl+Z would only undo one pixel of movement at a time.

**Solution**: All mousemove `updateDrawing` calls pass `skipUndo: true`. On mouseup (drag end), a single undo entry is pushed via `pushDrawingUndo()` with the original position captured at mousedown. This gives one-step undo for the entire drag.

Applies to: hline drag, oval drag, arrowpath drag, arrowpath node drag, oval resize.

Escape-revert calls (which restore original position during a drag) also use `skipUndo: true` since they're reverting, not creating new undoable actions.

### Stack limit

`.slice(-50)` caps the stack at 50 entries. Oldest entries are discarded first.

### Persistence

`drawingUndoStack` is **not persisted** to localStorage. Resets on page reload.

---

## Keyboard Handler

File: `frontend/src/components/chart/CandlestickChart.tsx`

Added to the existing `onKeyDown` handler (which already handles Escape and Delete/Backspace):

```ts
if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
  if (e.defaultPrevented) return; // already handled by another chart instance
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  e.preventDefault();
  useStore.getState().undoDrawing();
}
```

- `e.metaKey` covers Cmd+Z on Mac
- `e.preventDefault()` stops browser's native undo from firing
- `e.defaultPrevented` guard prevents double-fire in dual chart mode (both charts register `onKeyDown` on `window` — the first handler calls `preventDefault()`, the second sees it and skips)
- Guards against firing while typing in input fields (same pattern as Delete/Backspace)

---

## Interactions

| Shortcut | Action |
|---|---|
| `Ctrl+Z` / `Cmd+Z` | Undo last drawing mutation |

Undoable operations:
- Place a horizontal line → Ctrl+Z removes it
- Place an oval → Ctrl+Z removes it
- Place an arrow path → Ctrl+Z removes it
- Drag-move a drawing → Ctrl+Z restores original position (full drag, not per-pixel)
- Resize an oval → Ctrl+Z restores original size
- Drag an arrow path node → Ctrl+Z restores original node position
- Edit color/stroke/text via toolbar → Ctrl+Z restores previous style
- Delete a drawing → Ctrl+Z brings it back

---

## Modified Files

| File | Changes |
|---|---|
| `frontend/src/store/useStore.ts` | `UndoEntry` type, `drawingUndoStack` state, `skipUndo` param on `updateDrawing`, new `pushDrawingUndo` and `undoDrawing` actions |
| `frontend/src/components/chart/CandlestickChart.tsx` | Ctrl+Z in `onKeyDown` with dual-chart guard, `skipUndo: true` on all drag/resize mousemove calls, `pushDrawingUndo` on drag/resize mouseup, `skipUndo: true` on Escape-revert calls |
