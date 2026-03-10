import { useEffect, type RefObject } from 'react';

/**
 * Close a dropdown/popover when the user clicks outside the container element.
 * Attaches a mousedown listener only while `open` is true.
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, ref, onClose]);
}
