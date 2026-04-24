import { createContext, useContext, useState, useCallback } from 'react';
import { X } from 'lucide-react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const toast = useCallback(({ title, description, variant }) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, title, description, variant }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`rounded-lg border px-4 py-3 shadow-lg animate-in ${
              t.variant === 'destructive'
                ? 'bg-red-950 border-red-800 text-red-200'
                : 'bg-[#1a1a1a] border-[#333] text-white'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                {t.title && <div className="font-semibold text-sm">{t.title}</div>}
                {t.description && <div className="text-xs text-gray-400 mt-0.5">{t.description}</div>}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-gray-500 hover:text-white">
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
