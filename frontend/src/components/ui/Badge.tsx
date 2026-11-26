import type { ReactNode } from 'react';

export type Tone = 'ok' | 'warn' | 'danger' | 'live' | 'neutral';

const TONES: Record<Tone, { box: string; dot: string }> = {
  ok: { box: 'bg-green-50 text-green-800', dot: 'bg-green-600' },
  warn: { box: 'bg-amber-50 text-amber-800', dot: 'bg-amber-600' },
  danger: { box: 'bg-red-50 text-red-800', dot: 'bg-red-600' },
  live: { box: 'bg-red-50 text-red-800', dot: 'bg-red-600 animate-pulse' },
  neutral: { box: 'bg-neutral-100 text-neutral-700', dot: 'bg-neutral-400' },
};

/** Pill with a status dot. */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const t = TONES[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${t.box}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  CONNECTED: 'ok',
  DEGRADED: 'warn',
  DISCONNECTED: 'danger',
};

/** Integration status (CONNECTED / DEGRADED / DISCONNECTED). */
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}

/** Plain tag without a dot. */
export function Chip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`vmd-chip text-vmd-text ${className}`}>{children}</span>;
}
