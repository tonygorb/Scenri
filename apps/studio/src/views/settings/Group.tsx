import type { ReactNode } from 'react';

export function Group({ title, sub, children }: { title?: string; sub?: string; children: ReactNode }) {
  return (
    <section className="sc-set-sec">
      {(title || sub) && (
        <div className="sc-set-sech">
          {title && <h3>{title}</h3>}
          {sub && <p>{sub}</p>}
        </div>
      )}
      <div className="sc-set-card">{children}</div>
    </section>
  );
}
