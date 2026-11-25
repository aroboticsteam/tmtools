import { useState } from 'react';
import { Monitor, MonitorPlay, RotateCcw, Square, Play, Video } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useIntegrations, useCallIntegrationService, useIntegrationState } from '../api/integrations';
import { useCaptureStatus } from '../api/capture';
import { useFieldRows, useFieldSeed } from '../lib/fields';
import { recordingLabel } from '../lib/analysis';
import { useWsStore } from '../stores/ws';
import { usePermission } from '../hooks/usePermission';
import { useUiStore } from '../stores/ui';
import { PageHeader, Section } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge, StatusBadge, type Tone } from '../components/ui/Badge';
import { Input, Select } from '../components/ui/Input';
import { EmptyState } from '../components/ui/EmptyState';
import { timeAgo } from '../lib/alerts';
import type { IntegrationInstance } from '../types/api';

/** VEX TM's known audience-display modes. `backend/modules/integrations/
 * vex_tm/services.yaml`'s `set_audience_display` service declares `display`
 * as a required string with no enum/allowed-values list, so this is the
 * standard VEX TM display-mode set used as a reasonable default (finding
 * 3.5 in AUDIT_FINDINGS.md). */
const AUDIENCE_DISPLAY_MODES = [
  'BLANK',
  'LOGO',
  'SCHEDULE',
  'RANKINGS',
  'RANKINGS_SKILLS',
  'MATCH_PREVIEW',
  'IN_MATCH',
  'MATCH_RESULTS',
  'SEASON',
  'SKILLS',
  'SKILLS_RANKINGS',
  'ALLIANCE_SELECTION',
  'ELIMINATION_BRACKET',
] as const;

/** Plan §12/§5.16 Match Control, merged with the former Field Monitor page:
 * per `vex_tm.*` instance, manual override buttons
 * (`POST /api/v1/integrations/{entity_id}/service/{service}`, exactly the
 * service names in backend/modules/integrations/vex_tm/services.yaml)
 * followed by a live card per known field.
 *
 * The backend models one `vex_tm` instance = one field set (plan Appendix
 * B.5) with fields identified only by `fieldID` inside event payloads —
 * there's no `/api/v1/fields` listing endpoint, so the field cards show
 * any fieldID that has appeared in a `fieldMatchAssigned`/`upcoming_match`
 * WS event — this session's live ones plus the server-side snapshot
 * (`GET /api/v1/fields/state`, recorded by the leader in Redis) loaded on
 * mount and again after every WebSocket reconnect, so a page opened
 * mid-match shows each field's current state straight away. A field that has
 * never had an event still doesn't appear (there's no static field topology
 * endpoint to seed an empty list from). */
const TONE: Record<string, Tone> = { live: 'live', countdown: 'warn', queued: 'neutral', idle: 'neutral' };

/** Run each field: the match, alliances, start/stop, and what the room is doing. */
export function MatchControlPage() {
  useWebSocket('/ws/events');
  useFieldSeed();
  const { data: integrations = [] } = useIntegrations();
  const tm = integrations.filter((i) => i.domain === 'vex_tm');
  const obs = integrations.find((i) => i.domain === 'obs');
  const fields = useFieldRows();
  const events = useWsStore((s) => s.recentEvents);
  const { data: capture } = useCaptureStatus();
  const { data: obsState } = useIntegrationState(obs?.entity_id ?? null);
  const scene = typeof obsState?.state?.current_scene === 'string' ? (obsState.state.current_scene as string) : null;
  const log = events.filter((e) => e.type === 'automation_executed').slice(0, 8);

  return (
    <div>
      <PageHeader title="Match control" subtitle="Run each field: audience display, scenes and recording." />
      {tm.length === 0 && <EmptyState title="No Tournament Manager connected">Add a vex_tm integration to control fields.</EmptyState>}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {tm.length > 0 && fields.length === 0 && <EmptyState icon={MonitorPlay} title="No field activity yet">Fields appear once Tournament Manager assigns a match.</EmptyState>}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
            {fields.map((f) => {
              return (
                <Section key={f.id} title={`Field ${f.id}`} action={<Badge tone={TONE[f.status]}>{f.statusLabel}</Badge>}>
                  <div className="flex flex-col gap-4 p-4">
                    <div className="text-center">
                      <div className="text-[13px] text-vmd-textSubtle">Current match</div>
                      <div className="text-4xl font-semibold tracking-tight text-vmd-textStrong">{f.match}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                        <div className="text-[11px] font-medium text-red-700">RED</div>
                        <div className="font-medium text-vmd-textStrong">{f.red.join('  ') || '—'}</div>
                      </div>
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                        <div className="text-[11px] font-medium text-blue-700">BLUE</div>
                        <div className="font-medium text-vmd-textStrong">{f.blue.join('  ') || '—'}</div>
                      </div>
                    </div>
                    {tm[0] && <FieldButtons instance={tm[0]} />}
                    <div className="flex flex-col divide-y divide-neutral-100 text-sm">
                      <Row icon={MonitorPlay} label="OBS scene" value={scene ?? '—'} />
                      <Row icon={Video} label="Recording" value={capture?.recording ? recordingLabel(capture.recording) : 'Not recording'} />
                    </div>
                  </div>
                </Section>
              );
            })}
          </div>
          <Section title="What the automations just did">
            {log.length === 0 ? (
              <p className="px-4 py-6 text-sm text-vmd-textSubtle">Nothing yet this session.</p>
            ) : (
              log.map((e, i) => {
                const ok = String(e.payload.status ?? 'success') === 'success';
                return (
                  <div key={`${e.timestamp}-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-neutral-100 px-4 py-3 text-sm last:border-b-0">
                    <span className="w-24 text-xs text-vmd-textSubtle">{timeAgo(e.timestamp)}</span>
                    <span className="min-w-0 flex-1 basis-60 text-vmd-text">{String(e.payload.alias ?? e.entity_id)}</span>
                    <Badge tone={ok ? 'ok' : 'danger'}>{ok ? 'Done' : 'Failed'}</Badge>
                  </div>
                );
              })
            )}
          </Section>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {tm.map((instance) => (
            <Controls key={instance.entity_id} instance={instance} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof Monitor; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 py-2">
      <Icon size={16} className="text-vmd-textSubtle" aria-hidden="true" />
      <span className="flex-1 text-vmd-textMuted">{label}</span>
      <span className="font-medium text-vmd-textStrong">{value}</span>
    </div>
  );
}

function useFire(instance: IntegrationInstance) {
  const pushToast = useUiStore((s) => s.pushToast);
  const callService = useCallIntegrationService();
  return {
    pending: callService.isPending,
    fire: (service: string, data?: Record<string, unknown>) =>
      callService.mutate(
        { entityId: instance.entity_id, service, data },
        {
          onSuccess: () => pushToast(`${service} sent to ${instance.entity_id}`, 'success'),
          onError: (err) => pushToast(err instanceof Error ? err.message : 'Service call failed', 'error'),
        },
      ),
  };
}

/** Start / Stop / Reset. Tournament Manager commands apply to the whole field set. */
function FieldButtons({ instance }: { instance: IntegrationInstance }) {
  const canControl = usePermission('tm:control');
  const { fire, pending } = useFire(instance);
  return (
    <div className="flex gap-2">
      <Button variant="primary" className="flex-1" disabled={!canControl || pending} onClick={() => fire('start_match')}><Play size={14} /> Start</Button>
      <Button className="flex-1" disabled={!canControl || pending} onClick={() => fire('end_early')}><Square size={14} /> Stop</Button>
      <Button aria-label="Reset" title="Reset" disabled={!canControl || pending} onClick={() => fire('reset')}><RotateCcw size={14} /></Button>
    </div>
  );
}

/** Queue, abort, skills and audience display for one Tournament Manager instance. */
function Controls({ instance }: { instance: IntegrationInstance }) {
  const canControl = usePermission('tm:control');
  const { fire, pending } = useFire(instance);
  const [skillsId, setSkillsId] = useState('');
  const [display, setDisplay] = useState('');
  // Whatever TM last set it to; TM sends audienceDisplayChanged whoever changed it (this page or TM itself).
  const current = useWsStore((s) => s.audienceDisplays[instance.entity_id]);
  return (
    <Section title={instance.display_name} description={instance.entity_id} action={<StatusBadge status={instance.status} />}>
      <div className="flex flex-col gap-4 p-4">
        {!canControl && <p className="text-xs text-vmd-textSubtle">You lack the <code>tm:control</code> permission, so controls are read-only.</p>}
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={!canControl || pending} onClick={() => fire('queue_prev_match')}>Queue prev</Button>
          <Button disabled={!canControl || pending} onClick={() => fire('queue_next_match')}>Queue next</Button>
          <Button variant="danger" className="col-span-2" disabled={!canControl || pending} onClick={() => fire('abort')}>Abort match</Button>
        </div>
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-neutral-700">Skills run</div>
          <div className="flex gap-2">
            <Input type="number" min={1} step={1} placeholder="Skills ID" aria-label="Skills ID" value={skillsId} onChange={(e) => setSkillsId(e.target.value)} />
            <Button disabled={!canControl || !skillsId || pending} onClick={() => fire('queue_skills', { skills_id: Number(skillsId) })}>Queue</Button>
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[13px] font-medium text-neutral-700">
            <span>Audience display</span>
            <span className="text-xs font-normal text-vmd-textSubtle">Showing <span className="font-medium text-vmd-textStrong" data-testid="audience-current">{current ?? 'unknown'}</span></span>
          </div>
          <div className="flex gap-2">
            <Select aria-label="Audience display" value={display || current || ''} onChange={(e) => setDisplay(e.target.value)}>
              <option value="">Choose…</option>
              {current && !(AUDIENCE_DISPLAY_MODES as readonly string[]).includes(current) && <option value={current}>{current}</option>}
              {AUDIENCE_DISPLAY_MODES.map((m) => (<option key={m} value={m}>{m}</option>))}
            </Select>
            <Button disabled={!canControl || !display || display === current || pending} onClick={() => { fire('set_audience_display', { display }); setDisplay(''); }}>Set</Button>
          </div>
        </div>
      </div>
    </Section>
  );
}
