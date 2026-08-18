import type { ReactNode } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import { useShape, type SectionMode, type Shape } from './useShape.js';

export function Group({
  name,
  count,
  mode,
  onToggle,
  action,
  children,
}: {
  name: string;
  count?: number;
  mode: SectionMode;
  onToggle: () => void;
  action?: ReactNode;
  children: (shape: Shape) => ReactNode;
}) {
  const want: Shape = mode === 'open' || mode === 'result' ? 'open' : 'compact';
  const shape = useShape(want);
  return (
    <div className="sc-agroup" data-mode={mode}>
      <div className="sc-agroup-h">
        <button type="button" className="sc-agroup-t" aria-expanded={mode === 'open'} onClick={onToggle}>
          <b>{name}</b>
          {count !== undefined && count > 0 && <span className="sc-agroup-n">{count}</span>}
          <CaretDown size={11} className="sc-agroup-caret" aria-hidden="true" />
        </button>
        {action}
      </div>
      <div className="sc-agroup-body">
        <div className="sc-agroup-content" data-fading={shape !== want || undefined}>
          {children(shape)}
        </div>
      </div>
    </div>
  );
}
