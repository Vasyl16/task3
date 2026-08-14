import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { ToastContext, type ToastInput } from './toast-context';

interface ToastItem extends ToastInput {
  id: string;
}

const AUTO_DISMISS_MS = 6000;

// A small stack of transient, self-dismissing banners — for events the
// user should notice regardless of which page they're on (see
// entities/notification/ui/notification-toaster.tsx), as opposed to
// Alert/ErrorAlert, which are inline and tied to a specific form/page's
// own state.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (toast: ToastInput) => {
      nextId.current += 1;
      const id = `toast-${nextId.current}`;
      setToasts((current) => [...current, { ...toast, id }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="ui-toast-viewport" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`ui-toast ui-toast--${toast.variant ?? 'info'}`}
          >
            <div className="ui-toast__body">
              <p className="ui-toast__title">{toast.title}</p>
              {toast.description && (
                <p className="ui-toast__description">{toast.description}</p>
              )}
            </div>
            <button
              type="button"
              className="ui-toast__dismiss"
              aria-label="Dismiss notification"
              onClick={() => dismiss(toast.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
