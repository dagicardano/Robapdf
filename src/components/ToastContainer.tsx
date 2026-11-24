import React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2 pointer-events-none"
    >
      {toasts.map((t) => {
        const icon =
          t.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : t.type === 'error' ? (
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          ) : (
            <Info className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          );

        return (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <span className="mt-0.5">{icon}</span>
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss notification"
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
