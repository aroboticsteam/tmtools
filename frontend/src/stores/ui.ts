import { create } from 'zustand';

import { applyTheme, initialTheme, type Theme } from '../lib/theme';

export interface Toast {
  id: number;
  message: string;
  variant: 'success' | 'error' | 'info';
}

let toastCounter = 0;

export interface UiState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  /** True while any mounted useWebSocket instance is reconnecting. */
  reconnecting: boolean;
  setReconnecting: (value: boolean) => void;
  /** Alerts older than this (unix seconds) count as read. */
  alertsSeenAt: number;
  markAlertsRead: (at: number) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toasts: Toast[];
  pushToast: (message: string, variant?: Toast['variant']) => void;
  dismissToast: (id: number) => void;
}

/** How long a toast stays on screen before dismissing itself. */
export const TOAST_DURATION_MS = 5000;

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  reconnecting: false,
  setReconnecting: (value) => set({ reconnecting: value }),
  alertsSeenAt: 0,
  markAlertsRead: (at) => set({ alertsSeenAt: at }),
  theme: initialTheme(),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  toasts: [],
  pushToast: (message, variant = 'info') => {
    const id = ++toastCounter;
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }));
    // Harmless if the user already clicked it away: filtering by id is a no-op.
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), TOAST_DURATION_MS);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
