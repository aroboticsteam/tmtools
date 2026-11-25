import type { ReactNode } from 'react';
import { X } from 'lucide-react';

/** Main column (2fr) and aside (1fr); stacks on narrow screens. */
export function SplitLayout({ main, aside }: { main: ReactNode; aside?: ReactNode }) {
  return (
    <div className={`grid grid-cols-1 items-start gap-4 ${aside ? 'xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]' : ''}`}>
      <div className="flex min-w-0 flex-col gap-4">{main}</div>
      {aside && <div className="flex min-w-0 flex-col gap-4">{aside}</div>}
    </div>
  );
}

/** Side panel with a title, optional subtitle and close button. */
export function DetailPanel({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <aside className="overflow-hidden rounded-xl border border-vmd-border bg-white">
      <header className="flex items-start justify-between gap-2 border-b border-vmd-border px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-vmd-textStrong">{title}</h2>
          {subtitle && <div className="truncate text-xs text-vmd-textSubtle">{subtitle}</div>}
        </div>
        {onClose && (
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-vmd-textSubtle hover:bg-neutral-100">
            <X size={16} />
          </button>
        )}
      </header>
      <div className="flex flex-col gap-4 p-4">{children}</div>
      {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-vmd-border bg-neutral-50 px-4 py-3">{footer}</footer>}
    </aside>
  );
}

export function ProgressBar({ value, max, tone = 'dark' }: { value: number; max: number; tone?: 'dark' | 'ok' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1 w-full rounded-full bg-neutral-200" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <div className={`h-full rounded-full ${tone === 'ok' ? 'bg-green-600' : 'bg-neutral-900'}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Checkbox drawn like the mockup (16px, black when on). */
export function Check({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-2.5 rounded-lg border border-vmd-border p-2.5 ${disabled ? 'opacity-50' : 'cursor-pointer hover:bg-neutral-50'}`}>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-400 bg-white'} peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-neutral-900`} aria-hidden="true">
        {checked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-vmd-textStrong">{label}</span>
        {description && <span className="block text-xs text-vmd-textSubtle">{description}</span>}
      </span>
    </label>
  );
}
