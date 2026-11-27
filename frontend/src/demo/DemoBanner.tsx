import { useState } from 'react';

/** Always-visible notice on the Pages demo: it is a simulation and nothing is saved. */
export function DemoBanner() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div
      role="status"
      className="fixed bottom-3 left-1/2 z-50 flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-100 px-4 py-2 text-sm text-amber-950 shadow-lg dark:bg-amber-950 dark:text-amber-100"
    >
      <span>
        <strong>Demo.</strong> Made-up event, simulated devices, nothing is saved. Reload to reset.{' '}
        <a className="underline" href="https://github.com/aroboticsteam/tmtools" target="_blank" rel="noreferrer">
          Source
        </a>
      </span>
      <button type="button" aria-label="Dismiss" className="font-bold" onClick={() => setOpen(false)}>
        ×
      </button>
    </div>
  );
}
