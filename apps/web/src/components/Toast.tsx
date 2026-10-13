import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type Notify = (message: string) => void;

const ToastContext = createContext<Notify>(() => undefined);

/** Mensagens de sucesso anunciadas numa região `role="status"`. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const notify = useCallback<Notify>((text) => {
    setMessage(text);
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => {
      setMessage(null);
    }, 6000);
    return () => {
      clearTimeout(timer);
    };
  }, [message]);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {message && <p className="toast">{message}</p>}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook do mesmo contexto
export function useToast(): Notify {
  return useContext(ToastContext);
}
