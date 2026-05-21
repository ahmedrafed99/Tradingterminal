/**
 * Modal — accessible dialog primitive built on Radix Dialog.
 *
 * Radix handles: focus trap, Escape-to-close, portal rendering.
 * You handle: zero styling guesswork — all spacing/colors from tokens.
 *
 * Usage:
 *   <Modal open={open} onClose={close} title="Settings">
 *     <div style={{ padding: '16px' }}>…content…</div>
 *   </Modal>
 *
 *   // Custom footer:
 *   <Modal … footer={<MyFooter />}>…</Modal>
 *
 *   // No footer at all:
 *   <Modal … hideFooter>…</Modal>
 */

import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { RADIUS, SHADOW, Z } from '../../constants/layout';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: number;
  minHeight?: number;
  /** Fully custom footer — replaces the default Cancel / Confirm row */
  footer?: React.ReactNode;
  /** Called when the default Confirm button is clicked */
  onConfirm?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  hideFooter?: boolean;
}

// ── small internal hover button ───────────────────────────────────────────────
function HoverButton({
  onClick,
  style,
  hoverStyle,
  children,
  ...rest
}: {
  onClick?: () => void;
  style: React.CSSProperties;
  hoverStyle: React.CSSProperties;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      style={{ ...style, ...(hovered ? hoverStyle : {}) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function Modal({
  open,
  onClose,
  title,
  children,
  width = 440,
  minHeight,
  footer,
  onConfirm,
  confirmLabel = 'Ok',
  cancelLabel = 'Cancel',
  hideFooter = false,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        {/* Backdrop */}
        <Dialog.Overlay
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--color-backdrop)',
            zIndex: Z.MODAL - 1,
          }}
        />

        {/* Shell */}
        <Dialog.Content
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width,
            minHeight,
            zIndex: Z.MODAL,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: RADIUS.XL,
            boxShadow: SHADOW.XXL,
            display: 'flex',
            flexDirection: 'column',
            outline: 'none',
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 16px 10px',
            }}
          >
            <Dialog.Title
              style={{
                flex: 1,
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--color-text)',
                margin: 0,
              }}
            >
              {title}
            </Dialog.Title>

            <Dialog.Close asChild>
              <HoverButton
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 22,
                  borderRadius: RADIUS.MD,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: 'var(--color-text-muted)',
                  flexShrink: 0,
                  transition: `background var(--transition-fast), color var(--transition-fast)`,
                }}
                hoverStyle={{
                  background: 'var(--color-hover-row)',
                  color: 'var(--color-text)',
                }}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                >
                  <line x1="1" y1="1" x2="9" y2="9" />
                  <line x1="9" y1="1" x2="1" y2="9" />
                </svg>
              </HoverButton>
            </Dialog.Close>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '0 5%' }} />

          {/* Body */}
          {children}

          {/* Footer */}
          {!hideFooter && (
            <>
              <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '0 5%' }} />
              <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                {footer ?? (
                  <>
                    <HoverButton
                      onClick={onClose}
                      style={{
                        fontSize: 13,
                        padding: '5px 16px',
                        background: 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text)',
                        borderRadius: RADIUS.MD,
                        cursor: 'pointer',
                        transition: `background var(--transition-fast)`,
                      }}
                      hoverStyle={{ background: 'var(--color-hover-toolbar)' }}
                    >
                      {cancelLabel}
                    </HoverButton>
                    <HoverButton
                      onClick={onConfirm ?? onClose}
                      style={{
                        fontSize: 13,
                        padding: '5px 16px',
                        background: 'var(--color-label-close)',
                        color: 'var(--color-label-text)',
                        border: 'none',
                        borderRadius: RADIUS.MD,
                        cursor: 'pointer',
                        transition: `background var(--transition-fast)`,
                      }}
                      hoverStyle={{ background: 'var(--color-label-close-hover)' }}
                    >
                      {confirmLabel}
                    </HoverButton>
                  </>
                )}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
