import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store/useStore';
import { useClickOutside } from '../hooks/useClickOutside';
import { getNextSessionStartMs } from '../utils/marketHours';
import { showToast } from '../utils/toast';
import api from '../services/api';
import { FONT_SIZE, SHADOW, Z } from '../constants/layout';
import { SpinnerInput } from './SpinnerInput';
import { MenuItem } from './shared/MenuItem';
import { Button } from './shared/Button';

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function LockIcon({ size = 26 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width={size} height={size} shapeRendering="geometricPrecision" fill="currentColor" fillRule="evenodd">
      <path d="M14 6a3 3 0 0 0-3 3v3h6V9a3 3 0 0 0-3-3zm4 6V9a4 4 0 0 0-8 0v3H8.5A2.5 2.5 0 0 0 6 14.5v7A2.5 2.5 0 0 0 8.5 24h11a2.5 2.5 0 0 0 2.5-2.5v-7a2.5 2.5 0 0 0-2.5-2.5H18zm-5 5a1 1 0 1 1 2 0v2a1 1 0 1 1-2 0v-2zm-6-2.5c0-.83.67-1.5 1.5-1.5h11c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5h-11A1.5 1.5 0 0 1 7 21.5v-7z" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCountdown(expiryMs: number): string {
  const remaining = Math.max(0, expiryMs - Date.now());
  const totalSec = Math.floor(remaining / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTime(ms: number): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
    hour12: true,
  }).format(new Date(ms)) + ' ET';
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step = 'menu' | 'confirm' | 'custom';

interface DurationOption {
  label: string;
  getExpiryMs: () => number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LockoutButton() {
  const { activeAccountId, lockouts, setLockout, isLockedOut } = useStore(
    useShallow((s) => ({
      activeAccountId: s.activeAccountId,
      lockouts: s.lockouts,
      setLockout: s.setLockout,
      isLockedOut: s.isLockedOut,
    })),
  );

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('menu');
  const [pending, setPending] = useState<{ label: string; expiryMs: number } | null>(null);
  const [customHours, setCustomHours] = useState(0);
  const [customMinutes, setCustomMinutes] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [tick, setTick] = useState(0);

  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const locked = isLockedOut(activeAccountId);
  const expiryMs = activeAccountId ? (lockouts[activeAccountId] ?? null) : null;

  // Tick every second while locked (drives countdown + expired-lockout self-clear)
  useEffect(() => {
    if (!locked && !open) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [locked, open]);

  // Suppress unused-var warning — tick read indirectly via formatCountdown re-calls
  void tick;

  const closePopover = useCallback(() => {
    setOpen(false);
    setStep('menu');
    setPending(null);
    setCustomHours(0);
    setCustomMinutes(0);
  }, []);

  useClickOutside(popoverRef, open, closePopover);

  const durationOptions: DurationOption[] = [
    { label: '1 hour', getExpiryMs: () => Date.now() + 60 * 60 * 1000 },
    { label: '4 hours', getExpiryMs: () => Date.now() + 4 * 60 * 60 * 1000 },
    { label: 'End of session', getExpiryMs: () => getNextSessionStartMs() },
    { label: 'Custom…', getExpiryMs: () => 0 },
  ];

  function handleOptionClick(opt: DurationOption) {
    if (opt.label === 'Custom…') {
      setStep('custom');
      return;
    }
    // Compute expiry at click time per advisor guidance
    setPending({ label: opt.label, expiryMs: opt.getExpiryMs() });
    setStep('confirm');
  }

  function handleCustomContinue() {
    const totalMs = (customHours * 60 + customMinutes) * 60 * 1000;
    if (totalMs <= 0) return;
    setPending({ label: 'Custom', expiryMs: Date.now() + totalMs });
    setStep('confirm');
  }

  async function handleConfirm() {
    if (!pending || !activeAccountId) return;
    setSubmitting(true);

    // Optimistic: set local state before network (exchange may already be locked
    // even if response is lost in transit)
    setLockout(activeAccountId, pending.expiryMs);

    try {
      await api.post('/lockout/add', {
        tradingAccountId: activeAccountId,
        expiresAt: new Date(pending.expiryMs).toISOString(),
      });
      showToast('success', 'Account locked', `Locked until ${formatTime(pending.expiryMs)}`);
      closePopover();
    } catch (err: unknown) {
      // Rollback local state on definitive failure
      setLockout(activeAccountId, 0);
      const msg = err instanceof Error ? err.message : 'Lockout request failed';
      showToast('error', 'Lockout failed', msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (!activeAccountId) return null;

  // ---------------------------------------------------------------------------
  // Locked state — just show icon + countdown, not clickable
  // ---------------------------------------------------------------------------
  if (locked && expiryMs) {
    return (
      <div
        title={`Locked until ${formatTime(expiryMs)}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--color-warning)',
          cursor: 'default',
          userSelect: 'none',
          lineHeight: 1,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, transform: 'translateY(-2px)' }}>
          <LockIcon size={26} />
        </span>
        <span style={{ fontSize: FONT_SIZE.BASE, lineHeight: 1 }}>
          Locked-out: {formatCountdown(expiryMs)}
        </span>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Unlocked state — button + popover
  // ---------------------------------------------------------------------------
  return (
    <div ref={popoverRef} style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        onClick={() => { setOpen((o) => !o); setStep('menu'); }}
        className="flex items-center gap-1 rounded text-(--color-text) hover:text-(--color-error) hover:bg-red-500/10 transition-colors"
        style={{ padding: '3px 6px', transition: 'color var(--transition-fast), background var(--transition-fast)' }}
        title="Lock account"
      >
        <span style={{ display: 'flex', transform: 'translateY(-2px)' }}>
          <LockIcon size={26} />
        </span>
      </button>

      {open && (
        <div
          className="bg-(--color-surface) border border-(--color-border) rounded-lg"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: Z.DROPDOWN,
            width: 200,
            overflow: 'hidden',
            boxShadow: SHADOW.LG,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 12px 8px',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            {step !== 'menu' && (
              <button
                onClick={() => { setStep('menu'); setPending(null); }}
                className="text-(--color-text-muted) hover:text-white transition-colors"
                style={{ display: 'flex', alignItems: 'center', marginRight: 2 }}
              >
                <ChevronLeftIcon />
              </button>
            )}
            <span style={{ fontSize: FONT_SIZE.OVERLAY, fontWeight: 600, color: 'var(--color-text)' }}>
              Lock account
            </span>
          </div>

          {/* Step: menu */}
          {step === 'menu' && (
            <div style={{ padding: '4px 0' }}>
              {durationOptions.map((opt) => (
                <MenuItem key={opt.label} onClick={() => handleOptionClick(opt)}>
                  {opt.label}
                </MenuItem>
              ))}
            </div>
          )}

          {/* Step: custom duration */}
          {step === 'custom' && (
            <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Hours</label>
                  <SpinnerInput value={customHours} onChange={setCustomHours} min={0} max={23} step={1} height={28} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Minutes</label>
                  <SpinnerInput value={customMinutes} onChange={setCustomMinutes} min={0} max={59} step={5} height={28} />
                </div>
              </div>
              <Button
                variant="filled"
                tone="default"
                fullWidth
                style={{ marginTop: 2, fontWeight: 600 }}
                onClick={handleCustomContinue}
                disabled={customHours * 60 + customMinutes <= 0}
              >
                Continue
              </Button>
            </div>
          )}

          {/* Step: confirm */}
          {step === 'confirm' && pending && (
            <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Lock until</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
                  {formatTime(pending.expiryMs)}
                </span>
              </div>
              <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
                This cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button
                  variant="ghost"
                  tone="default"
                  style={{ flex: 1 }}
                  onClick={closePopover}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  variant="filled"
                  tone="danger"
                  style={{ flex: 1, fontWeight: 600, opacity: submitting ? 0.6 : 1 }}
                  onClick={handleConfirm}
                  disabled={submitting}
                >
                  {submitting ? '…' : 'Lock'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
