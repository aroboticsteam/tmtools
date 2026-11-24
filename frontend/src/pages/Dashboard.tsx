import { Database, Plug, Server, Zap } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useIntegrations } from '../api/integrations';
import { useReadyz } from '../api/health';
import { useClusterStatus } from '../api/status';
import { PageHeader, Section } from '../components/ui/Card';
import { StatCard } from '../components/ui/StatCard';
import { EmptyState } from '../components/ui/EmptyState';
import { TelemetryCard } from '../components/integrations/TelemetryCard';
import { LiveEventFeed } from '../components/ws/LiveEventFeed';
import { StatusBadge } from '../components/ui/Badge';

/** Overview: key health numbers, integration telemetry and the live event feed. */
export function DashboardPage() {
  useWebSocket('/ws/events');
  const { data: integrations, isLoading } = useIntegrations();
  const { data: ready } = useReadyz();
  const { data: status, isError: statusError } = useClusterStatus();

  const entries = status?.integrations ?? [];
  const connected = entries.filter((e) => e.status === 'CONNECTED').length;
  const leader =
    status?.leader?.is_leader === undefined ? 'Unknown' : status.leader.is_leader ? 'This node' : (status.leader.leader_address ?? 'Another node');

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Live health, telemetry and events" />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={Plug}
          label="Integrations"
          value={entries.length ? `${connected}/${entries.length}` : (integrations?.length ?? '—')}
          hint={entries.length ? 'connected' : undefined}
        />
        <StatCard icon={Database} label="Postgres" value={ready ? (ready.db ? 'Up' : 'Down') : '—'} />
        <StatCard icon={Zap} label="Redis" value={ready ? (ready.redis ? 'Up' : 'Down') : '—'} />
        <StatCard icon={Server} label="Leader" value={leader} hint={statusError ? 'Cluster status unavailable' : undefined} />
      </div>

      {entries.length > 0 && (
        <Section title="Integration health" className="mb-6">
          <div className="flex flex-wrap gap-x-5 gap-y-2 p-4">
            {entries.map((entry, i) => (
              <span key={entry.entity_id ?? i} className="flex items-center gap-2">
                <StatusBadge status={entry.status ?? 'DISCONNECTED'} />
                <span className="text-xs text-vmd-textSubtle">{entry.entity_id ?? '—'}</span>
              </span>
            ))}
          </div>
        </Section>
      )}

      <h2 className="mb-3 text-[15px] font-semibold text-vmd-textStrong">Telemetry</h2>
      {isLoading && <p className="text-sm text-vmd-textSubtle">Loading integrations…</p>}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {integrations?.map((integration) => (
          <TelemetryCard key={integration.entity_id} integration={integration} />
        ))}
      </div>
      {integrations && integrations.length === 0 && (
        <EmptyState icon={Plug} title="No integrations yet">Add one from the Integrations page.</EmptyState>
      )}

      <Section title="Recent events">
        <div className="p-4">
          <LiveEventFeed limit={50} />
        </div>
      </Section>
    </div>
  );
}
