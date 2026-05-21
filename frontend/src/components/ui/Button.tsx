/**
 * Button — shared button primitive.
 *
 * All hover states use onMouseEnter/onMouseLeave (inline styles, no Tailwind).
 * All colors from CSS variables. All radius from RADIUS constants.
 *
 * Variants:
 *   primary  — light bg (label-close), used for Ok / Confirm actions
 *   secondary — surface bg + border, used for Cancel
 *   accent   — blue accent, used for primary CTA
 *   danger   — red destructive action
 *   toolbar  — pill button for toolbars/headers
 *   ghost    — no bg/border, text only, subtle hover
 *
 * Usage:
 *   <Button variant="primary" onClick={save}>Save</Button>
 *   <Button variant="secondary" onClick={close}>Cancel</Button>
 *   <Button variant="accent" onClick={submit}>Submit</Button>
 *   <Button variant="danger" onClick={del}>Delete</Button>
 *   <Button variant="toolbar" onClick={open}>Open <ChevronDown size={12} /></Button>
 */

import { forwardRef, useState } from 'react';
import { RADIUS } from '../../constants/layout';

type Variant = 'primary' | 'secondary' | 'accent' | 'danger' | 'toolbar' | 'ghost';
type Size = 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

type StylePair = { base: React.CSSProperties; hover: React.CSSProperties };

const STYLES: Record<Variant, StylePair> = {
  primary: {
    base: {
      background: 'var(--color-label-close)',
      color: 'var(--color-label-text)',
      border: 'none',
    },
    hover: { background: 'var(--color-label-close-hover)' },
  },
  secondary: {
    base: {
      background: 'var(--color-surface)',
      color: 'var(--color-text)',
      border: '1px solid var(--color-border)',
    },
    hover: { background: 'var(--color-hover-toolbar)' },
  },
  accent: {
    base: {
      background: 'var(--color-accent)',
      color: '#fff',
      border: 'none',
    },
    hover: { background: 'var(--color-accent-hover)' },
  },
  danger: {
    base: {
      background: 'rgba(242, 54, 69, 0.15)',
      color: 'var(--color-error)',
      border: '1px solid var(--color-error)',
    },
    hover: { background: 'rgba(242, 54, 69, 0.25)' },
  },
  toolbar: {
    base: {
      background: 'var(--color-input)',
      color: 'var(--color-text)',
      border: '1px solid var(--color-border)',
    },
    hover: { background: 'var(--color-border)' },
  },
  ghost: {
    base: {
      background: 'transparent',
      color: 'var(--color-text-muted)',
      border: 'none',
    },
    hover: { background: 'var(--color-hover-row)', color: 'var(--color-text)' },
  },
};

const SIZE_STYLES: Record<Size, React.CSSProperties> = {
  sm: { fontSize: 12, padding: '5px 10px', borderRadius: RADIUS.MD },
  md: { fontSize: 13, padding: '5px 16px', borderRadius: RADIUS.MD },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', style, disabled, children, ...rest },
  ref,
) {
  const [hovered, setHovered] = useState(false);
  const { base, hover } = STYLES[variant];

  return (
    <button
      ref={ref}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: `background var(--transition-fast), color var(--transition-fast)`,
        ...SIZE_STYLES[size],
        ...base,
        ...(hovered && !disabled ? hover : {}),
        ...style,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...rest}
    >
      {children}
    </button>
  );
});
