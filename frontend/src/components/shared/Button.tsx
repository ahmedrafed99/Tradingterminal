import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'filled' | 'ghost';
  tone?: 'default' | 'danger';
  size?: 'sm' | 'md';
  fullWidth?: boolean;
}

const SIZE_PADDING = { sm: '6px 12px', md: '8px 16px' } as const;

/**
 * Shared button primitive.
 *
 * variant ghost/default  — transparent bg, border, muted text → hover surface
 * variant ghost/danger   — transparent bg, border, muted text → hover red tint
 * variant filled/default — surface bg, border, text
 * variant filled/danger  — error bg, white text, no border
 */
export function Button({
  variant = 'ghost',
  tone = 'default',
  size = 'sm',
  fullWidth = false,
  className = '',
  style,
  ...props
}: ButtonProps) {
  const isGhost = variant === 'ghost';
  const isDanger = tone === 'danger';

  let variantClass: string;
  let variantStyle: React.CSSProperties;

  if (isGhost) {
    variantStyle = { border: '1px solid var(--color-border)' };
    variantClass = isDanger
      ? 'bg-transparent text-(--color-text-muted) hover:text-(--color-error) hover:bg-red-500/10'
      : 'bg-transparent text-(--color-text-muted) hover:text-(--color-text) hover:bg-(--color-surface)';
  } else if (isDanger) {
    variantStyle = { background: 'var(--color-error)', border: 'none' };
    variantClass = 'text-white';
  } else {
    variantStyle = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' };
    variantClass = 'text-(--color-text)';
  }

  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variantClass}${fullWidth ? ' w-full' : ''}${className ? ` ${className}` : ''}`}
      style={{ padding: SIZE_PADDING[size], fontSize: 'var(--font-size-overlay)', ...variantStyle, ...style }}
      {...props}
    />
  );
}