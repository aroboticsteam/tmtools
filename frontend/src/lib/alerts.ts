import { useMemo } from 'react';
import { useWsStore } from '../stores/ws';
import { useUiStore } from '../stores/ui';

export interface StaffAlert {
  key: string;
  title: string;
  text: string;
  timestamp: number;
  tone: 'warn' | 'danger' | 'info';
}

/** Alerts derived from the live event stream (this session): integrations
 * going down and failed automations. */
export function useAlerts(): { alerts: StaffAlert[]; unread: number; markRead: () => void } {
  const events = useWsStore((s) => s.recentEvents);
  const seenAt = useUiStore((s) => s.alertsSeenAt);
  const markRead = useUiStore((s) => s.markAlertsRead);
  const alerts = useMemo(() => {
    const out: StaffAlert[] = [];
    events.forEach((e, i) => {
      if (e.type === 'integration_status') {
        const status = String(e.payload.status ?? '');
        if (status && status !== 'CONNECTED') {
          out.push({
            key: `${e.timestamp}-${i}`,
            title: `${e.entity_id} ${status.toLowerCase()}`,
            text: status === 'DEGRADED' ? 'The integration is answering slowly or partly.' : 'The integration stopped answering.',
            timestamp: e.timestamp,
            tone: status === 'DEGRADED' ? 'warn' : 'danger',
          });
        }
      } else if (e.type === 'automation_executed' && String(e.payload.status ?? 'success') !== 'success') {
        out.push({
          key: `${e.timestamp}-${i}`,
          title: 'An automation failed',
          text: String(e.payload.error ?? e.entity_id),
          timestamp: e.timestamp,
          tone: 'danger',
        });
      }
    });
    return out;
  }, [events]);
  const unread = alerts.filter((a) => a.timestamp > seenAt).length;
  return { alerts, unread, markRead: () => markRead(Math.max(Date.now() / 1000, ...alerts.map((a) => a.timestamp))) };
}

export function timeAgo(tsSeconds: number): string {
  const s = Math.max(0, Math.round(Date.now() / 1000 - tsSeconds));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  return `${Math.floor(s / 86400)} days ago`;
}
