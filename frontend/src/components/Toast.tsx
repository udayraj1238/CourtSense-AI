import React, { useState, useCallback, useRef } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  exiting?: boolean;
}

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
  warning: '⚠',
};

/* ===== Toast Container Component ===== */
interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => (
  <div className="toast-container" aria-live="polite" aria-atomic="false">
    {toasts.map((t) => (
      <div
        key={t.id}
        className={`toast toast-${t.type}${t.exiting ? ' exiting' : ''}`}
        onClick={() => onDismiss(t.id)}
        role="alert"
      >
        <span className="toast-icon">{ICONS[t.type]}</span>
        <span>{t.message}</span>
      </div>
    ))}
  </div>
);

/* ===== useToast Hook ===== */
let nextId = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    // Mark as exiting for animation
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    const existing = timers.current.get(id);
    if (existing) clearTimeout(existing);
    // Remove after animation
    const rm = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      timers.current.delete(id);
    }, 400);
    timers.current.set(id, rm);
  }, []);

  const addToast = useCallback((message: string, type: ToastType = 'info', duration = 4000) => {
    const id = ++nextId;
    setToasts(prev => [...prev.slice(-4), { id, message, type }]); // max 5 at once
    const timer = setTimeout(() => dismiss(id), duration);
    timers.current.set(id, timer);
    return id;
  }, [dismiss]);

  return { toasts, addToast, dismiss };
}
