interface ToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * Shared toggle (on/off switch) primitive.
 * Accent-colored when on, border-colored when off.
 * Renders as a label row when `label` is provided, or a bare switch when omitted.
 */
export function Toggle({ value, onChange, label, disabled = false, className = '' }: ToggleProps) {
  const track = (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => { if (!disabled) onChange(!value); }}
      style={{
        width: 32,
        height: 18,
        borderRadius: 9,
        border: 'none',
        background: value ? 'var(--color-accent)' : 'var(--color-border)',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background var(--transition-fast)',
        flexShrink: 0,
        padding: 0,
        outline: 'none',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: value ? 14 : 2,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left var(--transition-fast)',
        }}
      />
    </button>
  );

  if (!label) return track;

  return (
    <label
      className={`flex items-center justify-between gap-3 cursor-pointer select-none text-sm text-(--color-text)${disabled ? ' opacity-50 cursor-not-allowed' : ''}${className ? ` ${className}` : ''}`}
      onClick={(e) => {
        e.preventDefault();
        if (!disabled) onChange(!value);
      }}
    >
      <span>{label}</span>
      {track}
    </label>
  );
}
