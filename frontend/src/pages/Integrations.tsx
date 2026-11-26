import { useMemo, useState } from 'react';
import { Activity, Camera, Lightbulb, Monitor, Music, Network, Plug, Plus, Radio, Zap, type LucideIcon } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket';
import { usePermission } from '../hooks/usePermission';
import {
  useCallIntegrationService,
  useDeleteIntegration,
  useIntegrationSchemas,
  useIntegrations,
  useTestIntegrationConnection,
  useUpdateIntegration,
} from '../api/integrations';
import { useUiStore } from '../stores/ui';
import { useWsStore } from '../stores/ws';
import { timeAgo } from '../lib/alerts';
import { PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/Badge';
import { Toggle } from '../components/ui/Toggle';
import { FilterChips } from '../components/ui/FilterChips';
import { DetailPanel } from '../components/ui/Layouts';
import { EmptyState } from '../components/ui/EmptyState';
import { TagsEditor } from '../components/integrations/TagsEditor';
import { AddIntegrationModal } from '../components/integrations/AddIntegrationModal';
import { SpotifyAuthButton } from '../components/integrations/SpotifyAuthButton';
import { ZerosPresetsSection } from '../components/integrations/ZerosPresetsSection';
import type { IntegrationInstance } from '../types/api';

const CATEGORY: Record<string, string> = {
  obs: 'Video', atem: 'Video', ptz: 'Video', camera: 'Video',
  zeros: 'Lighting', wled: 'Lighting', artnet: 'Lighting',
  spotify: 'Audio', mumble: 'Audio',
  capture: 'Capture', vex_tm: 'Event',
};
const ICON: Record<string, LucideIcon> = {
  obs: Monitor, atem: Monitor, ptz: Camera, zeros: Zap, wled: Lightbulb, spotify: Music,
  capture: Camera, vex_tm: Activity, mumble: Radio,
};
const categoryOf = (domain: string) => CATEGORY[domain] ?? 'Other';

export function IntegrationsPage() {
  useWebSocket('/ws/events');
  const { data: integrations = [], isLoading } = useIntegrations();
  const { data: schemas } = useIntegrationSchemas();
  const statuses = useWsStore((s) => s.integrationStatuses);
  const events = useWsStore((s) => s.recentEvents);
  const updateIntegration = useUpdateIntegration();
  const canEdit = usePermission('integrations:edit');
  const [filter, setFilter] = useState('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<IntegrationInstance | null>(null);

  const categories = useMemo(() => ['All', ...new Set(integrations.map((i) => categoryOf(i.domain)))], [integrations]);
  const shown = integrations.filter((i) => filter === 'All' || categoryOf(i.domain) === filter);
  const selected = integrations.find((i) => i.entity_id === selectedId) ?? null;

  return (
    <div>
      <PageHeader
        title="Integrations"
        subtitle="The devices and services TMTools talks to."
        action={
          canEdit && (
            <Button variant="primary" onClick={() => { setEditing(null); setModalOpen(true); }}>
              <Plus size={16} /> Add integration
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <FilterChips
            options={categories.map((c) => ({ id: c, label: c === 'All' ? `All ${integrations.length}` : c }))}
            value={filter}
            onChange={setFilter}
          />
          {isLoading && <p className="text-sm text-vmd-textSubtle">Loading…</p>}
          {!isLoading && shown.length === 0 && <EmptyState icon={Plug} title="No integrations yet">Add one to connect a device or service.</EmptyState>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {shown.map((it) => {
              const Icon = ICON[it.domain] ?? Network;
              const status = statuses[it.entity_id] ?? it.status;
              const last = events.find((e) => e.entity_id === it.entity_id)?.timestamp;
              const sel = it.entity_id === selectedId;
              return (
                <section
                  key={it.entity_id}
                  className={`flex cursor-pointer flex-col gap-3 rounded-xl border bg-white p-4 ${sel ? 'border-neutral-900' : 'border-vmd-border hover:border-neutral-400'}`}
                  onClick={() => setSelectedId(it.entity_id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700"><Icon size={18} /></span>
                      <div className="min-w-0">
                        <button type="button" className="block max-w-full truncate text-left font-semibold text-vmd-textStrong" onClick={() => setSelectedId(it.entity_id)}>{it.display_name}</button>
                        <div className="truncate text-xs text-vmd-textSubtle">{it.entity_id}</div>
                      </div>
                    </div>
                    {it.enabled ? <StatusBadge status={status} /> : <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">Disabled</span>}
                  </div>
                  <div className="text-[13px] text-vmd-textMuted">{schemas?.[it.domain]?.description ?? categoryOf(it.domain)}</div>
                  <div className="mt-auto flex items-center justify-between">
                    <span className="text-xs text-vmd-textSubtle">{last ? `Event ${timeAgo(last)}` : 'No events yet'}</span>
                    <span onClick={(e) => e.stopPropagation()}>
                      <Toggle
                        checked={it.enabled}
                        disabled={!canEdit}
                        label={`Enable ${it.display_name}`}
                        onChange={(enabled) => updateIntegration.mutate({ entityId: it.entity_id, body: { enabled } })}
                      />
                    </span>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
        {selected && (
          <Detail
            key={selected.entity_id}
            integration={selected}
            canEdit={canEdit}
            onClose={() => setSelectedId(null)}
            onEdit={() => { setEditing(selected); setModalOpen(true); }}
            onDeleted={() => setSelectedId(null)}
          />
        )}
      </div>
      <AddIntegrationModal open={modalOpen} onClose={() => { setModalOpen(false); setEditing(null); }} editing={editing} />
    </div>
  );
}

function Detail({ integration, canEdit, onClose, onEdit, onDeleted }: { integration: IntegrationInstance; canEdit: boolean; onClose: () => void; onEdit: () => void; onDeleted: () => void }) {
  const { data: schemas } = useIntegrationSchemas();
  const updateIntegration = useUpdateIntegration();
  const deleteIntegration = useDeleteIntegration();
  const testConnection = useTestIntegrationConnection();
  const callService = useCallIntegrationService();
  const pushToast = useUiStore((s) => s.pushToast);
  const schema = schemas?.[integration.domain];
  const fields = Object.entries(schema?.config_schema ?? {});
  const services = Object.entries(schema?.services ?? {}).filter(([, s]) => !Object.values(s.fields ?? {}).some((f) => f.required));

  function remove() {
    if (!window.confirm(`Delete integration "${integration.display_name}" (${integration.entity_id})?`)) return;
    deleteIntegration.mutate(integration.entity_id, {
      onSuccess: () => { pushToast('Deleted', 'success'); onDeleted(); },
      onError: (err) => pushToast(err instanceof Error ? err.message : 'Failed to delete', 'error'),
    });
  }

  return (
    <DetailPanel
      title={integration.display_name}
      subtitle={integration.entity_id}
      onClose={onClose}
      footer={
        canEdit ? (
          <>
            <button type="button" onClick={remove} className="h-8 rounded-lg border border-red-200 bg-white px-3 text-[13px] font-medium text-vmd-danger hover:bg-red-50">Delete</button>
            <Button size="sm" variant="primary" onClick={onEdit}>Edit settings</Button>
          </>
        ) : undefined
      }
    >
      {fields.length === 0 ? (
        <p className="text-sm text-vmd-textSubtle">No settings for this integration.</p>
      ) : (
        fields.map(([key, f]) => (
          <div key={key}>
            <div className="mb-1 text-[13px] font-medium text-neutral-700">{f.label ?? key}</div>
            <div className="flex h-9 items-center rounded-lg border border-vmd-border bg-neutral-50 px-3 text-sm text-vmd-text">
              {f.secret ? '••••••••••' : String(integration.config[key] ?? '—')}
            </div>
          </div>
        ))
      )}
      <div>
        <div className="mb-1.5 text-[13px] font-medium text-neutral-700">Tags</div>
        <TagsEditor tags={integration.tags} disabled={!canEdit} onChange={(tags) => updateIntegration.mutate({ entityId: integration.entity_id, body: { tags } })} />
      </div>
      <div>
        <div className="mb-1.5 text-[13px] font-medium text-neutral-700">Try a service</div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={testConnection.isPending}
            onClick={() =>
              testConnection.mutate(integration.entity_id, {
                onSuccess: (r) => pushToast(r.message ?? r.detail ?? (r.ok ? 'Connection OK' : 'Connection failed'), r.ok ? 'success' : 'error'),
                onError: (err) => pushToast(err instanceof Error ? err.message : 'Test failed', 'error'),
              })
            }
          >
            Test connection
          </Button>
          {services.slice(0, 6).map(([name, s]) => (
            <Button
              key={name}
              size="sm"
              title={s.description}
              disabled={!canEdit || callService.isPending}
              onClick={() =>
                callService.mutate({ entityId: integration.entity_id, service: name }, {
                  onSuccess: () => pushToast(`${name} sent`, 'success'),
                  onError: (err) => pushToast(err instanceof Error ? err.message : 'Service call failed', 'error'),
                })
              }
            >
              {name.replace(/_/g, ' ')}
            </Button>
          ))}
        </div>
      </div>
      {integration.domain === 'spotify' && <SpotifyAuthButton integration={integration} />}
      {integration.domain === 'zeros' && <ZerosPresetsSection integration={integration} />}
    </DetailPanel>
  );
}
