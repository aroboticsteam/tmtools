import { useEffect, useRef, useState } from 'react';
import { Bell, Megaphone } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePermission } from '../../hooks/usePermission';
import { timeAgo, useAlerts } from '../../lib/alerts';
import { StaffPushToggle, useStaffPush } from './StaffPushToggle';

const DOT: Record<string, string> = { warn: 'bg-amber-600', danger: 'bg-red-600', info: 'bg-neutral-900' };

/** The always-visible Staff alerts button and its panel. */
export function StaffAlerts({ compact = false }: { compact?: boolean }) {
  const { supported } = useStaffPush();
  const canBroadcast = usePermission('notifications:broadcast');
  const { alerts, unread, markRead } = useAlerts();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const badge =
    unread > 0 ? (
      <span
        className={`flex items-center justify-center rounded-full bg-red-600 font-semibold text-white ${
          compact ? 'absolute right-1 top-1 h-4 min-w-4 px-1 text-[10px]' : 'h-[18px] min-w-[18px] px-1 text-[11px]'
        }`}
      >
        {unread}
      </span>
    ) : null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread ? `Staff alerts, ${unread} unread` : 'Staff alerts'}
        onClick={() => setOpen((o) => !o)}
        className={
          compact
            ? 'relative flex h-10 w-10 items-center justify-center rounded-lg text-neutral-800 hover:bg-neutral-100'
            : 'flex h-9 items-center gap-2 rounded-lg border border-vmd-border bg-white px-3 text-sm font-medium text-neutral-800 hover:bg-neutral-50'
        }
      >
        <Bell size={18} />
        {!compact && 'Staff alerts'}
        {badge}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Staff alerts"
          className="fixed inset-x-3 top-16 z-[80] overflow-hidden rounded-xl border border-vmd-border bg-white sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[400px]"
        >
          <header className="flex items-center justify-between border-b border-vmd-border px-4 py-3">
            <h2 className="text-[15px] font-semibold text-vmd-textStrong">Staff alerts</h2>
            <button type="button" onClick={markRead} className="text-[13px] text-vmd-textSubtle hover:text-vmd-textStrong">
              Mark all read
            </button>
          </header>
          {supported && (
            <div className="border-b border-vmd-border bg-neutral-50 px-4 py-3">
              <StaffPushToggle />
              <p className="mt-1 text-xs text-vmd-textSubtle">Get a push notification even when the tab is closed</p>
            </div>
          )}
          <div className="max-h-[320px] overflow-y-auto">
            {alerts.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-vmd-textSubtle">No alerts this session.</p>
            ) : (
              alerts.slice(0, 20).map((a) => (
                <div key={a.key} className="flex gap-3 border-b border-neutral-100 px-4 py-3 last:border-b-0">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[a.tone]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-vmd-textStrong">{a.title}</div>
                    <div className="text-[13px] text-vmd-textMuted">{a.text}</div>
                    <div className="mt-0.5 text-xs text-vmd-textSubtle">{timeAgo(a.timestamp)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
          {canBroadcast && (
            <footer className="flex gap-2 border-t border-vmd-border bg-neutral-50 p-3">
              <Link
                to="/rooms"
                onClick={() => setOpen(false)}
                className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-neutral-900 bg-neutral-900 text-sm font-medium text-white hover:bg-neutral-700"
              >
                <Megaphone size={16} /> Send broadcast
              </Link>
              <Link
                to="/teams"
                onClick={() => setOpen(false)}
                className="flex h-9 items-center justify-center rounded-lg border border-vmd-border bg-white px-3 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
              >
                Alert teams
              </Link>
            </footer>
          )}
        </div>
      )}
    </div>
  );
}
