import type { HTMLAttributes, ReactNode } from 'react';

/** Flat white surface with a thin border. */
export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`vmd-card ${className}`} {...props} />;
}

/** A card with a titled header row and an optional right-hand action, body flush. */
export function Section({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-xl border border-vmd-border bg-white ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-vmd-border px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-vmd-textStrong">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-vmd-textSubtle">{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export { PageHeader } from './PageHeader';
