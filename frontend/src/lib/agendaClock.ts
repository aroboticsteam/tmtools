export function fmtClock(total: number): string {
  const neg = total < 0;
  const a = Math.abs(Math.floor(total));
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const sec = a % 60;
  return `${neg ? '-' : ''}${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec).padStart(2, '0')}`;
}

/** Index of the latest agenda item that has started and not yet ended, else -1. */
export function currentAgendaIndex(items: { start_time: string; end_time?: string | null }[], now = new Date()): number {
  const mins = now.getHours() * 60 + now.getMinutes();
  let cur = -1;
  items.forEach((it, i) => {
    const [sh, sm] = it.start_time.split(':').map(Number);
    const start = sh * 60 + sm;
    let end: number | null = null;
    if (it.end_time) {
      const [eh, em] = it.end_time.split(':').map(Number);
      end = eh * 60 + em;
    }
    if (start <= mins && (end === null || mins < end)) cur = i;
  });
  return cur;
}

export const WARN_SECONDS = 120;
export const CRITICAL_SECONDS = 30;
