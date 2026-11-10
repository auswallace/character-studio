'use client';

import { createContext, useContext, useState, useCallback, useRef } from 'react';

interface Toast {
  id: string;
  message: string;
  type: 'error' | 'success' | 'info';
}

interface ToastContextValue {
  addToast: (message: string, type?: Toast['type']) => void;
}

const ToastContext = createContext<ToastContextValue>({ addToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const addToast = useCallback((message: string, type: Toast['type'] = 'error') => {
    const id = `toast-${++counterRef.current}`;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);

  const colors = {
    error: { bg: '#FFFFFF', border: 'rgba(239,68,68,0.3)', text: '#EF4444', icon: '#EF4444' },
    success: { bg: '#FFFFFF', border: 'rgba(16,185,129,0.3)', text: '#10B981', icon: '#10B981' },
    info: { bg: '#FFFFFF', border: 'rgba(59,130,246,0.3)', text: '#3B82F6', icon: '#3B82F6' },
  };

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 380 }}>
        {toasts.map(toast => (
          <div
            key={toast.id}
            style={{
              background: colors[toast.type].bg,
              border: `1px solid ${colors[toast.type].border}`,
              color: colors[toast.type].text,
              padding: '10px 16px',
              borderRadius: 20,
              fontSize: 13,
              fontWeight: 500,
              backdropFilter: 'blur(12px)',
              boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
              animation: 'toast-in 0.2s ease-out',
              cursor: 'pointer',
            }}
            onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
          >
            {toast.message}
          </div>
        ))}
      </div>
      <style>{`@keyframes toast-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </ToastContext.Provider>
  );
}
