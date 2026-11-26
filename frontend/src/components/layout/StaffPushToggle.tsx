import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { usePermission } from '../../hooks/usePermission';
import { currentStaffSubscription, disableStaffPush, enableStaffPush, pushSupported } from '../../lib/push';
import { useUiStore } from '../../stores/ui';
import { Toggle } from '../ui/Toggle';

/** State + actions for this browser's staff Web Push subscription. */
export function useStaffPush() {
  const allowed = usePermission('notifications:receive');
  const pushToast = useUiStore((s) => s.pushToast);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const supported = allowed && pushSupported();

  useEffect(() => {
    if (!supported) return;
    currentStaffSubscription()
      .then((sub) => setEnabled(sub !== null && Notification.permission === 'granted'))
      .catch(() => setEnabled(false));
  }, [supported]);

  async function set(next: boolean) {
    setBusy(true);
    try {
      if (next) {
        await enableStaffPush(null);
        setEnabled(true);
        pushToast('Push alerts turned on for this browser', 'success');
      } else {
        await disableStaffPush();
        setEnabled(false);
        pushToast('Push alerts turned off for this browser', 'info');
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not change push alerts', 'error');
    } finally {
      setBusy(false);
    }
  }

  return { supported, enabled, busy, set };
}

/** Switch row used inside the Staff alerts panel. */
export function StaffPushToggle() {
  const { supported, enabled, busy, set } = useStaffPush();
  if (!supported) {
    return <p className="text-[13px] text-vmd-textSubtle">Push alerts are not available in this browser.</p>;
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm text-vmd-text">
        {enabled ? <Bell size={16} className="text-vmd-success" /> : <BellOff size={16} className="text-vmd-textSubtle" />}
        Push alerts on this device
      </div>
      <Toggle checked={enabled} disabled={busy} onChange={set} label="Push alerts on this device" />
    </div>
  );
}
