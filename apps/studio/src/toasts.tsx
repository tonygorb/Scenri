import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { CheckCircle, WarningCircle, X } from '@phosphor-icons/react';

export interface ToastInput {
  kind: 'success' | 'error';
  title: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
}
interface ToastItem extends ToastInput {
  id: number;
}

const Ctx = createContext<{ push: (t: ToastInput) => void }>({ push: () => {} });
export const useToasts = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: ToastInput) => {
      const id = nextId.current++;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      window.setTimeout(() => dismiss(id), t.kind === 'error' ? 9000 : 5000);
    },
    [dismiss],
  );

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="sc-toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="sc-toast">
            {t.kind === 'success' ? (
              <CheckCircle className="sc-toast-ok" size={17} weight="fill" />
            ) : (
              <WarningCircle className="sc-toast-err" size={17} weight="fill" />
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <b>{t.title}</b>
              {t.detail && <small>{t.detail.slice(0, 140)}</small>}
              {t.action && (
                <button
                  type="button"
                  className="sc-toast-act"
                  onClick={() => {
                    t.action!.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button type="button" className="sc-toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
