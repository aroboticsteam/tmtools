import { Link } from 'react-router-dom';
import { Clapperboard, MonitorPlay, Plus, Users2, Workflow, Check, X, MessageSquare, Zap } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useIntegrations } from '../api/integrations';
import { useTeamChecklist } from '../api/teams';
import { useCaptureRecordings } from '../api/capture';
import { useAutomations } from '../api/automations';
import { useFieldRows, useFieldSeed } from '../lib/fields';
import { timeAgo } from '../lib/alerts';
import { useWsStore } from '../stores/ws';
import { usePermission } from '../hooks/usePermission';
import { PageHeader, Section } from '../components/ui/Card';
import { StatCard } from '../components/ui/StatCard';
import { Badge, StatusBadge, type Tone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { DataTable } from '../components/ui/DataTable';
import { EmptyState } from '../components/ui/EmptyState';
import type { EventBusMessage } from '../types/api';

const FIELD_TONE: Record<string, Tone> = { live: 'live', queued: 'neutral', idle: 'neutral' };

function describe(e: EventBusMessage): { icon: typeof Check; text: string } | null {
  switch (e.type) {
    case 'matchStarted': return { icon: MonitorPlay, text: `Match started on field ${String(e.payload.fieldID ?? '?')}` };
    case 'matchStopped': return { icon: Check, text: `Match stopped on field ${String(e.payload.fieldID ?? '?')}` };
    case 'fieldMatchAssigned': return { icon: MonitorPlay, text: `Match ${String(e.payload.matchNum ?? '')} assigned to field ${String(e.payload.fieldID ?? '?')}` };
    case 'automation_executed': {
      const ok = String(e.payload.status ?? 'success') === 'success';
      return { icon: ok ? Zap : X, text: `Automation ${ok ? 'ran' : 'failed'}: ${String(e.payload.alias ?? e.entity_id)}` };
    }
    case 'integration_status': return { icon: Zap, text: `${e.entity_id} is ${String(e.payload.status ?? '').toLowerCase()}` };
    case 'notification': return { icon: MessageSquare, text: String(e.payload.title ?? 'Notification sent') };
    default: return null;
  }
}

/** Overview of the whole event: key numbers, fields, activity and integrations. */
export function DashboardPage() {
  useWebSocket('/ws/events');
  useFieldSeed();
  const canAutomate = usePermission('automations:edit');
  const { data: integrations = [], isLoading } = useIntegrations();
  const { data: checklist = [] } = useTeamChecklist();
  const { data: recordings = [] } = useCaptureRecordings({ limit: 300 });
  const { data: automations = [] } = useAutomations();
  const fields = useFieldRows();
  const events = useWsStore((s) => s.recentEvents);
  const statuses = useWsStore((s) => s.integrationStatuses);

  const done = checklist.filter((c) => c.complete).length;
  const live = fields.filter((f) => f.status === 'live').length;
  const moments = recordings.reduce((n, r) => n + r.moments.length, 0);
  const enabled = automations.filter((a) => a.enabled).length;
  const activity = events.map((e) => ({ e, d: describe(e) })).filter((x) => x.d).slice(0, 6);
  const lastEvent = (id: string) => events.find((e) => e.entity_id === id)?.timestamp;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Everything happening at the event, at a glance."
        action={
          canAutomate && (
            <Link to="/automations/new">
              <Button variant="primary"><Plus size={16} /> New automation</Button>
            </Link>
          )
        }
      />
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
          <StatCard icon={Users2} label="Teams ready" value={checklist.length ? `${done} / ${checklist.length}` : '—'} hint={checklist.length ? `${checklist.length - done} checklists still open` : 'No teams yet'} />
          <StatCard icon={MonitorPlay} label="Fields live" value={fields.length ? `${live} / ${fields.length}` : '—'} hint={fields.length ? `${fields.filter((f) => f.status === 'queued').length} queued` : 'Waiting for a match'} />
          <StatCard icon={Clapperboard} label="Recordings" value={recordings.length} hint={`${moments} moments marked`} />
          <StatCard icon={Workflow} label="Automations on" value={`${enabled} / ${automations.length}`} hint={automations.length - enabled ? `${automations.length - enabled} disabled` : 'All enabled'} />
        </div>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <Section title="Fields" action={<Link to="/match-control" className="text-[13px] font-medium text-vmd-textStrong hover:underline">Open match control</Link>}>
            {fields.length === 0 ? (
              <EmptyState icon={MonitorPlay} title="No field activity yet">Fields appear once Tournament Manager assigns a match.</EmptyState>
            ) : (
              fields.map((f) => (
                <div key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-neutral-100 px-4 py-3.5 last:border-b-0">
                  <div className="w-16 font-semibold text-vmd-textStrong">Field {f.id}</div>
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="font-medium text-vmd-textStrong">{f.match}</div>
                    <div className="truncate text-[13px] text-vmd-textSubtle">Red {f.red.join(', ') || '—'}   Blue {f.blue.join(', ') || '—'}</div>
                  </div>
                  <Badge tone={FIELD_TONE[f.status]}>{f.statusLabel}</Badge>
                </div>
              ))
            )}
          </Section>

          <Section title="Activity">
            {activity.length === 0 ? (
              <EmptyState title="Nothing yet">Events show up here as they happen.</EmptyState>
            ) : (
              activity.map(({ e, d }, i) => {
                const Icon = d!.icon;
                return (
                  <div key={`${e.timestamp}-${i}`} className="flex items-start gap-3 border-b border-neutral-100 px-4 py-3 last:border-b-0">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600"><Icon size={14} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-vmd-text">{d!.text}</div>
                      <div className="text-xs text-vmd-textSubtle">{timeAgo(e.timestamp)}</div>
                    </div>
                  </div>
                );
              })
            )}
          </Section>
        </div>

        <Section title="Integrations" action={<Link to="/integrations" className="text-[13px] font-medium text-vmd-textStrong hover:underline">Manage</Link>}>
          {isLoading ? (
            <p className="px-4 py-6 text-sm text-vmd-textSubtle">Loading…</p>
          ) : (
            <DataTable
              minWidth={520}
              rows={integrations}
              rowKey={(i) => i.entity_id}
              empty={<EmptyState title="No integrations yet">Add one from the Integrations page.</EmptyState>}
              columns={[
                { key: 'name', header: 'Name', width: '2fr', render: (i) => <span className="font-medium text-vmd-textStrong">{i.display_name}</span> },
                { key: 'type', header: 'Type', render: (i) => <span className="text-vmd-textMuted">{i.domain}</span> },
                { key: 'status', header: 'Status', render: (i) => <StatusBadge status={statuses[i.entity_id] ?? i.status} /> },
                { key: 'last', header: 'Last event', render: (i) => { const t = lastEvent(i.entity_id); return <span className="text-[13px] text-vmd-textSubtle">{t ? timeAgo(t) : '—'}</span>; } },
              ]}
            />
          )}
        </Section>
      </div>
    </div>
  );
}
