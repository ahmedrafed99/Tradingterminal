export interface ToastItem {
  id: string;
  kind: 'error' | 'warning' | 'success' | 'info';
  title: string;
  detail?: string;
  /** Auto-dismiss duration in ms. null = manual dismiss only */
  duration: number | null;
  createdAt: number;
}

export interface ToastSlice {
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, 'id' | 'createdAt'>) => void;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
}

type Set = {
  (partial: Partial<ToastSlice>): void;
  (fn: (s: ToastSlice) => Partial<ToastSlice>): void;
};

export const createToastSlice = (set: Set): ToastSlice => ({
  toasts: [] as ToastItem[],
  addToast: (toast) =>
    set((s) => ({
      toasts: [
        ...s.toasts,
        {
          ...toast,
          id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          createdAt: Date.now(),
        },
      ].slice(-10),
    })),
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clearToasts: () => set({ toasts: [] }),
});
