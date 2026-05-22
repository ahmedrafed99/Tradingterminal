import { RADIUS } from '../../constants/layout';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * Shared checkbox primitive.
 * Custom-styled (not native input) — white fill + black checkmark when checked.
 * Renders as a label row when `label` is provided, or a bare box when omitted.
 */
export function Checkbox({ checked, onChange, label, disabled = false, className = '' }: CheckboxProps) {
  const box = (
    <span
      onClick={() => { if (!disabled) onChange(!checked); }}
      style={{
        width: 16,
        height: 16,
        borderRadius: RADIUS.MD,
        border: '1px solid var(--color-border)',
        background: checked ? '#ffffff' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background var(--transition-fast)',
        flexShrink: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {checked && (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 5.5l2 2L8 3" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );

  if (!label) return box;

  return (
    <label
      className={`flex items-center gap-2 cursor-pointer select-none text-sm text-(--color-text)${disabled ? ' opacity-50 cursor-not-allowed' : ''}${className ? ` ${className}` : ''}`}
      onClick={(e) => {
        e.preventDefault();
        if (!disabled) onChange(!checked);
      }}
    >
      {box}
      {label}
    </label>
  );
}
