import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Megaphone } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePermission } from '../../hooks/usePermission';
import { StaffPushToggle, useStaffPush } from './StaffPushToggle';

/** Always-visible "Staff alerts" button with a small panel: turn push on or
 * off for this device and (with `notifications:broadcast`) send a broadcast. */
export function StaffAlerts({ compact = false }: { compact?: boolean }) {
  const { supported, enabled } = useStaffPush();
  const canBroadcast = usePermission('notifications:broadcast');
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

  if (!supported && !canBroadcast) return null;
  const Icon = enabled ? Bell : BellOff;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 rounded-lg border border-vmd-border bg-white text-sm font-medium text-vmd-text hover:bg-neutral-50 ${
          compact ? 'h-10 w-10 justify-center' : 'h-9 px-3'
        }`}
        aria-label="Staff alerts"
      >
        <span className="relative">
          <Icon size={18} />
          {enabled && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-green-600" />}
        </span>
        {!compact && 'Staff alerts'}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Staff alerts"
          className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-vmd-border bg-white p-4"
        >
          <h3 className="mb-3 text-sm font-semibold text-vmd-textStrong">Staff alerts</h3>
          <p className="mb-3 text-[13px] text-vmd-textSubtle">
            System alerts (integration down, leader failover) and staff broadcasts arrive as push notifications.
          </p>
          <StaffPushToggle />
          {canBroadcast && (
            <Link
              to="/rooms"
              onClick={() => setOpen(false)}
              className="mt-3 flex h-9 items-center justify-center gap-2 rounded-lg border border-vmd-border text-sm font-medium text-vmd-text hover:bg-neutral-50"
            >
              <Megaphone size={16} /> Send a broadcast
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
