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
  children: React.ReactNode;
}

/**
 * Shared dropdown panel shell.
 *
 * Handles positioning + standard styling only.
 * Caller is responsible for:
 *   - `open` state
 *   - wrapper div with `position: relative`
 *   - `useClickOutside(wrapperRef, open, close)` for dismiss
 *
 * @example
 * <div ref={ref} className="relative">
 *   <button onClick={() => setOpen(o => !o)}>Open</button>
 *   {open && (
 *     <Dropdown minWidth={200}>
 *       <div style={{ padding: 6 }}>...</div>
 *     </Dropdown>
 *   )}
 * </div>
 */
export function Dropdown({
  align = 'left',
  offset = 4,
  minWidth,
  className = '',
  style,
  children,
}: DropdownProps) {
  return (
    <div
      className={`absolute top-full bg-(--color-surface) border border-(--color-border) rounded-lg ${align === 'right' ? 'right-0' : 'left-0'} ${className}`}
      style={{
        marginTop: offset,
        zIndex: Z.DROPDOWN,
        boxShadow: SHADOW.LG,
        minWidth,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
