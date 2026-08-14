import { createContext } from 'react';

export interface ToastInput {
  title: string;
  description?: string;
  variant?: 'info' | 'success' | 'danger';
}

export interface ToastContextValue {
  show: (toast: ToastInput) => void;
}

// Separate module from ToastProvider on purpose: a file that exports
// both a component and a non-component breaks React Fast Refresh (see
// features/auth/model/auth-context.ts for the identical reasoning).
export const ToastContext = createContext<ToastContextValue | null>(null);
