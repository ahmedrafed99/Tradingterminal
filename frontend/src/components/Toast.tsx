import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import type { ToastItem } from '../store/useStore';
import { RADIUS, Z, SHADOW } from '../constants/layout';

const ACCENT: Record<ToastItem['kind'], string> = {
  error: 'var(--color-sell)',
  warning: 'var(--color-warning)',
  success: 'var(--color-buy)',
  info: 'var(--color-accent)',
};

function ToastEntry({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (toast.duration === null) return;
    const remaining = toast.duration - (Date.now() - toast.createdAt);
    if (remaining <= 0) {
      onDismiss();
      return;
    }
    timerRef.current = setTimeout(() => setExiting(true), remaining);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast, onDismiss]);

  useEffect(() => {
    if (!exiting) return;
    const t = setTimeout(onDismiss, 150);
    return () => clearTimeout(t);
  }, [exiting, onDismiss]);

  function handleDismiss() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setExiting(true);
  }

  return (
    <div
      className={exiting ? 'animate-toast-out' : 'animate-toast-in'}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: RADIUS.XL,
        boxShadow: SHADOW.XL,
        borderLeft: `4px solid ${ACCENT[toast.kind]}`,
        padding: '10px 12px',
        display: 'flex',
        gap: 8,
        pointerEvents: 'auto',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="text-xs font-semibold text-(--color-text)">{toast.title}</div>
        {toast.detail && (
          <div
            className="text-[11px] text-(--color-text-muted)"
            style={{
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {toast.detail}
          </div>
        )}
      </div>
      <button
        onClick={handleDismiss}
        className="text-(--color-text-muted) hover:text-(--color-text) transition-colors"
        style={{ alignSelf: 'flex-start', fontSize: 14, lineHeight: 1, background: 'none', border: 'none', cursor: 'pointer' }}
      >
        &#x2715;
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed"
      style={{ bottom: 16, right: 16, width: 320, pointerEvents: 'none', zIndex: Z.TOAST }}
    >
      <div className="flex flex-col" style={{ gap: 8 }}>
        {toasts.map((t) => (
          <ToastEntry key={t.id} toast={t} onDismiss={() => dismissToast(t.id)} />
        ))}
      </div>
    </div>
  );
}
