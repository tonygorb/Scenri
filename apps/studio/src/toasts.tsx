import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { CheckCircle, WarningCircle, X } from '@phosphor-icons/react';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastInput {
  kind: 'success' | 'error';
  title: string;
  detail?: string;
  /** One action, the original shape. Kept so no existing caller changes. */
  action?: ToastAction;
  /**
   * Two, at most — "what did I just make" usually has exactly two honest
   * answers (go look at it, use it), and a third would turn a notice into a
   * menu you have to read.
   */
  actions?: ToastAction[];
}
interface ToastItem extends ToastInput {
  id: number;
}

const Ctx = createContext<{ push: (t: ToastInput) => void }>({ push: () => {} });
export const useToasts = () => useContext(Ctx);

/** How many can stack before the oldest expendable one is dropped. */
const MAX = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: ToastInput) => {
      const id = nextId.current++;
      setItems((xs) => {
        const next = [...xs, { ...t, id }];
        if (next.length <= MAX) return next;
        /*
         * Over the cap something has to go, and it must not be a failure.
         * Trimming the oldest regardless meant four ordinary successes could
         * silently destroy an unread error — and, worse, take an Undo with it,
         * so the way back from an accident vanished because four other things
         * happened afterwards. Successes are the ones that expire on their own.
         */
        const trimmed = [...next];
        while (trimmed.length > MAX) {
          const victim = trimmed.findIndex((x) => x.kind !== 'error' && !x.action && !x.actions?.length);
          trimmed.splice(victim === -1 ? 0 : victim, 1);
        }
        return trimmed;
      });
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
              {(t.actions?.length ? t.actions : t.action ? [t.action] : []).slice(0, 2).map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className="sc-toast-act"
                  onClick={() => {
                    a.onClick();
                    dismiss(t.id);
                  }}
                >
                  {a.label}
                </button>
              ))}
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
