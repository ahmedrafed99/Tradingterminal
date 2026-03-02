import { useStore } from '../store/useStore';

const DEFAULT_DURATIONS = {
  error: 8000,
  warning: 6000,
  success: 3000,
  info: 4000,
} as const;

/**
 * Show a toast notification from anywhere (React components or plain services).
 * Pass `duration: null` for toasts that require manual dismissal.
 */
export function showToast(
  kind: 'error' | 'warning' | 'success' | 'info',
  title: string,
  detail?: string,
  duration?: number | null,
) {
  useStore.getState().addToast({
    kind,
    title,
    detail,
    duration: duration !== undefined ? duration : DEFAULT_DURATIONS[kind],
  });
}

/** Extract a user-friendly message from an unknown error value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}
