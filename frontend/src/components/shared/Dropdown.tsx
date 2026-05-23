import { forwardRef } from 'react';
import { Z } from '../../constants/layout';
import { SHADOW } from '../../constants/layout';

interface DropdownProps {
  /** Horizontal anchor. default: 'left' */
  align?: 'left' | 'right';
  /** Gap between trigger bottom and panel top (px). default: 4 */
  offset?: number;
  /** Min width (px). */
  minWidth?: number;
  /** Extra className on the panel div */
  className?: string;
  /** Extra inline styles on the panel div */
  style?: React.CSSProperties;
  /** Click handler on the panel (e.g. stopPropagation) */
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  children: React.ReactNode;
}

/**
 * Shared dropdown panel shell.
 *
 * Handles positioning, standard styling, and 13px font baseline.
 * Caller is responsible for:
 *   - `open` state
 *   - wrapper div with `position: relative`
 *   - `useClickOutside(ref, open, close)` for dismiss (pass ref via forwardRef)
 *
 * @example
 * <div className="relative">
 *   <button onClick={() => setOpen(o => !o)}>Open</button>
 *   {open && (
 *     <Dropdown ref={ref} minWidth={200}>
 *       <div style={{ padding: 6 }}>...</div>
 *     </Dropdown>
 *   )}
 * </div>
 */
export const Dropdown = forwardRef<HTMLDivElement, DropdownProps>(function Dropdown({
  align = 'left',
  offset = 4,
  minWidth,
  className = '',
  style,
  onClick,
  children,
}, ref) {
  return (
    <div
      ref={ref}
      className={`absolute top-full bg-(--color-surface) border border-(--color-border) rounded-lg ${align === 'right' ? 'right-0' : 'left-0'} ${className}`}
      style={{
        marginTop: offset,
        zIndex: Z.DROPDOWN,
        boxShadow: SHADOW.LG,
        fontSize: 13,
        minWidth,
        ...style,
      }}
      onClick={onClick}
    >
      {children}
    </div>
  );
});