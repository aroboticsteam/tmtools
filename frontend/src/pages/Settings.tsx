import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import {
  useApiKeys,
  useCreateApiKey,
  usePermissionCatalog,
  useRevokeApiKey,
  useSettings,
  useUpdateSettings,
} from '../api/settings';
import { usePermission } from '../hooks/usePermission';
import { useUiStore } from '../stores/ui';
import { ALL_PERMISSIONS } from '../stores/auth';
import { PageHeader, Section } from '../components/ui/Card';
import { Tabs } from '../components/ui/Tabs';
import { Check } from '../components/ui/Layouts';
import { DataTable } from '../components/ui/DataTable';
import { EmptyState } from '../components/ui/EmptyState';
import { KeyRound } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input, Label, Select } from '../components/ui/Input';
import { MatchRecordingsCard } from '../components/site/MatchRecordingsCard';
import { SiteConfigEditor } from '../components/site/SiteConfigEditor';
import { siteProblems, tidySite, type SiteConfig } from '../lib/siteConfig';
import { Modal } from '../components/ui/Modal';
import { Toggle } from '../components/ui/Toggle';
import { CopyButton } from '../components/ui/CopyButton';

type SettingsTab = 'general' | 'site' | 'storage' | 'roles' | 'keys';
const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'site', label: 'Event site' },
  { id: 'storage', label: 'Storage' },
  { id: 'roles', label: 'Roles' },
  { id: 'keys', label: 'API keys' },
];

function settingValue(settings: { key: string; value: Record<string, unknown> }[] | undefined, key: string): Record<string, unknown> {
  return settings?.find((s) => s.key === key)?.value ?? {};
}

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('general');
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const canEdit = usePermission('settings:edit');
  const pushToast = useUiStore((s) => s.pushToast);

  const s3 = settingValue(settings, 's3');
  const robotEvents = settingValue(settings, 'robot_events_api');
  const competition = settingValue(settings, 'competition');
  const predictor = settingValue(settings, 'predictor');
  const chromaKey = settingValue(settings, 'chroma_key_defaults');
  // The backend reads/seeds this under `notifications` (backend/core/ntfy.py,
  // migration c3d4e5f6a7b8) — it holds the ntfy keys plus the team-alert
  // knobs (migration e1f2a3b4c5d6). PUT replaces the whole value, so `save()`
  // spreads the existing object to keep keys this page doesn't edit.
  const notifications = settingValue(settings, 'notifications');
  const site = settingValue(settings, 'site');
  const overlaySettings = settingValue(settings, 'overlay');

  const [s3Endpoint, setS3Endpoint] = useState('');
  const [s3PublicEndpoint, setS3PublicEndpoint] = useState('');
  const [s3Bucket, setS3Bucket] = useState('');
  const [s3AccessKey, setS3AccessKey] = useState('');
  const [s3SecretKey, setS3SecretKey] = useState('');
  const [s3Region, setS3Region] = useState('');
  const [program, setProgram] = useState('V5RC');
  const [reToken, setReToken] = useState('');
  const [threshold, setThreshold] = useState(15);
  const [ckColour, setCkColour] = useState('#00B140');
  const [ckSimilarity, setCkSimilarity] = useState(0.1);
  const [ckBlend, setCkBlend] = useState(0.05);
  const [ntfyServerUrl, setNtfyServerUrl] = useState('');
  const [ntfyTopic, setNtfyTopic] = useState('');
  const [ntfyEnabled, setNtfyEnabled] = useState(false);
  // The site form edits a draft; it is only saved once something changed.
  const [siteDraft, setSiteDraft] = useState<SiteConfig>({});
  const [siteDirty, setSiteDirty] = useState(false);
  const [teamAlerts, setTeamAlerts] = useState(true);
  const [leadMatches, setLeadMatches] = useState(3);
  const [leadMinutes, setLeadMinutes] = useState(15);
  const [scoresEnabled, setScoresEnabled] = useState(true);
  const [scoresExcluded, setScoresExcluded] = useState('F');
  const [showRobotName, setShowRobotName] = useState(false);
  const [lateMinutes, setLateMinutes] = useState(5);
  const [agendaEnabled, setAgendaEnabled] = useState(true);
  const [agendaLead, setAgendaLead] = useState(10);
  const [eventTimezone, setEventTimezone] = useState('UTC');

  useEffect(() => {
    setS3Endpoint(String(s3.endpoint_url ?? ''));
    setS3PublicEndpoint(String(s3.public_endpoint_url ?? ''));
    setS3Bucket(String(s3.bucket ?? ''));
    setS3AccessKey(String(s3.access_key ?? ''));
    setS3SecretKey(String(s3.secret_key ?? ''));
    setS3Region(String(s3.region ?? ''));
    setProgram(competition.program === 'VIQRC' ? 'VIQRC' : 'V5RC');
    setReToken(String(robotEvents.token ?? ''));
    setThreshold(Number(predictor.high_potential_threshold_pct ?? 15));
    setCkColour(String(chromaKey.colour ?? '#00B140'));
    setCkSimilarity(Number(chromaKey.similarity ?? 0.1));
    setCkBlend(Number(chromaKey.blend ?? 0.05));
    setNtfyServerUrl(String(notifications.server_url ?? ''));
    setNtfyTopic(String(notifications.topic ?? ''));
    setNtfyEnabled(Boolean(notifications.enabled ?? false));
    setSiteDraft(site as SiteConfig);
    setSiteDirty(false);
    setTeamAlerts(Boolean(notifications.team_alerts_enabled ?? true));
    setLeadMatches(Number(notifications.lead_matches_x ?? 3));
    setLeadMinutes(Number(notifications.lead_minutes_y ?? 15));
    setScoresEnabled(Boolean(notifications.scores_enabled ?? true));
    setShowRobotName(Boolean(overlaySettings.show_robot_name ?? false));
    setLateMinutes(Number(notifications.late_minutes ?? 5));
    setAgendaEnabled(Boolean(notifications.agenda_announcements_enabled ?? true));
    setAgendaLead(Number(notifications.agenda_lead_minutes ?? 10));
    setEventTimezone(String(notifications.timezone ?? 'UTC'));
    setScoresExcluded(
      Array.isArray(notifications.scores_excluded_rounds) ? notifications.scores_excluded_rounds.join(', ') : 'F',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  function save() {
    let siteValue: Record<string, unknown> | null = null;
    if (siteDirty) {
      const problems = siteProblems(siteDraft);
      if (problems.length) {
        pushToast(`Public site settings: ${problems[0]}`, 'error');
        return;
      }
      siteValue = tidySite(siteDraft);
    }
    updateSettings.mutate(
      {
        ...(siteValue ? { site: { value: siteValue } } : {}),
        s3: {
          value: {
            endpoint_url: s3Endpoint,
            public_endpoint_url: s3PublicEndpoint,
            bucket: s3Bucket,
            access_key: s3AccessKey,
            secret_key: s3SecretKey,
            region: s3Region,
          },
        },
        competition: { value: { program } },
        robot_events_api: { value: { token: reToken } },
        predictor: { value: { high_potential_threshold_pct: threshold } },
        chroma_key_defaults: { value: { colour: ckColour, similarity: ckSimilarity, blend: ckBlend } },
        overlay: { value: { ...overlaySettings, show_robot_name: showRobotName } },
        notifications: {
          value: {
            ...notifications,
            server_url: ntfyServerUrl,
            topic: ntfyTopic,
            enabled: ntfyEnabled,
            team_alerts_enabled: teamAlerts,
            lead_matches_x: Math.max(0, Math.min(20, Math.round(leadMatches) || 0)),
            lead_minutes_y: Math.max(0, Math.min(120, Math.round(leadMinutes) || 0)),
            scores_enabled: scoresEnabled,
            late_minutes: Math.max(0, Math.min(60, Math.round(lateMinutes) || 0)),
            agenda_announcements_enabled: agendaEnabled,
            agenda_lead_minutes: Math.max(0, Math.min(240, Math.round(agendaLead) || 0)),
            timezone: eventTimezone.trim() || 'UTC',
            scores_excluded_rounds: scoresExcluded
              .split(/[\s,;]+/)
              .map((r) => r.trim().toUpperCase())
              .filter(Boolean),
          },
        },
      },
      {
        onSuccess: () => pushToast('Settings saved', 'success'),
        onError: (err) => pushToast(err instanceof Error ? err.message : 'Save failed', 'error'),
      },
    );
  }

  const saveBar = canEdit && (
    <div className="flex justify-end">
      <Button variant="primary" onClick={save} disabled={updateSettings.isPending}>
        Save settings
      </Button>
    </div>
  );

  const row = (label: string, control: ReactNode, hint?: ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-neutral-100 px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1 basis-56">
        <div className="text-sm font-medium text-vmd-textStrong">{label}</div>
        {hint && <div className="text-xs text-vmd-textSubtle">{hint}</div>}
      </div>
      <div className="w-full sm:w-72">{control}</div>
    </div>
  );
  const switchRow = (label: string, value: boolean, set: (v: boolean) => void, hint?: ReactNode) =>
    row(label, <div className="flex sm:justify-end"><Toggle checked={value} onChange={set} disabled={!canEdit} label={label} /></div>, hint);
  const numRow = (label: string, value: number, set: (v: number) => void, max: number) =>
    row(label, <Input type="number" min={0} max={max} value={value} onChange={(e) => set(Number(e.target.value))} disabled={!canEdit} aria-label={label} />);

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Event, storage, access and API keys."
        action={<Link to="/audit"><Button>Audit log</Button></Link>}
      />
      <div className="-mt-6 mb-6 -mx-4 border-b border-vmd-border bg-white px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <Tabs tabs={SETTINGS_TABS.filter((t) => canEdit || (t.id !== 'roles' && t.id !== 'keys'))} active={tab} onChange={setTab} />
      </div>

      {tab === 'general' && (
        <div className="flex flex-col gap-4">
          <Section title="Competition" description="Which VEX program this event runs.">
            {row('VEX program', (
              <Select id="competition-program" aria-label="VEX program" value={program} onChange={(e) => setProgram(e.target.value)} disabled={!canEdit}>
                <option value="V5RC">V5RC (VEX V5 Robotics Competition)</option>
                <option value="VIQRC">VIQRC (VEX IQ Robotics Competition)</option>
              </Select>
            ))}
            {row('Robot Events API token', <Input type="password" value={reToken} onChange={(e) => setReToken(e.target.value)} disabled={!canEdit} aria-label="Robot Events API token" />)}
            {row(`High-potential threshold (${threshold}%)`, <input type="range" min={0} max={100} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} disabled={!canEdit} className="w-full" aria-label="High-potential threshold" />, 'AI predictor: matches above this are flagged.')}
          </Section>
          <Section title="Chroma key defaults" description="Used when a team photo is keyed.">
            {row('Colour', <input type="color" value={ckColour} onChange={(e) => setCkColour(e.target.value)} disabled={!canEdit} className="h-9 w-full rounded-lg border border-vmd-border bg-white" aria-label="Chroma key colour" />)}
            {row(`Similarity (${ckSimilarity.toFixed(2)})`, <input type="range" min={0} max={1} step={0.01} value={ckSimilarity} onChange={(e) => setCkSimilarity(Number(e.target.value))} disabled={!canEdit} className="w-full" aria-label="Similarity" />)}
            {row(`Blend (${ckBlend.toFixed(2)})`, <input type="range" min={0} max={1} step={0.01} value={ckBlend} onChange={(e) => setCkBlend(Number(e.target.value))} disabled={!canEdit} className="w-full" aria-label="Blend" />)}
          </Section>
          <Section title="Stream overlay">
            {switchRow('Show robot names on the overlay', showRobotName, setShowRobotName, <>Off by default: robot names need VEX Events approval before they go on stream. Overlay pages also accept <code>?robot_name=1</code>.</>)}
          </Section>
          <Section title="Team alerts" description="Room displays and phones.">
            {switchRow('Enabled', teamAlerts, setTeamAlerts)}
            {numRow('Alert when N matches away (0 = off)', leadMatches, setLeadMatches, 20)}
            {numRow('Alert N minutes before (0 = off)', leadMinutes, setLeadMinutes, 120)}
            {numRow('Late warning after N minutes overdue (0 = off)', lateMinutes, setLateMinutes, 60)}
            {switchRow('Announce agenda items (lunch, finals…) to all rooms', agendaEnabled, setAgendaEnabled)}
            {numRow('Default announcement lead (minutes)', agendaLead, setAgendaLead, 240)}
            {row('Event timezone', <Input value={eventTimezone} onChange={(e) => setEventTimezone(e.target.value)} disabled={!canEdit} aria-label="Event timezone" />, 'IANA name, e.g. Europe/London')}
            {switchRow('Send match scores once submitted', scoresEnabled, setScoresEnabled)}
            {row('Rounds without score alerts', <Input placeholder="F" value={scoresExcluded} onChange={(e) => setScoresExcluded(e.target.value)} disabled={!canEdit} aria-label="Rounds without score alerts" />, <>TM round codes: finals are <code>F</code>; others <code>QUAL</code>, <code>R16</code>, <code>QF</code>, <code>SF</code>.</>)}
          </Section>
          <Section title="Staff alerts (ntfy)" description="Fires on integration degraded, leader failover, automation retry-exhaustion and video processing failure.">
            {switchRow('Enabled', ntfyEnabled, setNtfyEnabled)}
            {row('Server URL', <Input placeholder="https://ntfy.sh" value={ntfyServerUrl} onChange={(e) => setNtfyServerUrl(e.target.value)} disabled={!canEdit} aria-label="ntfy server URL" />)}
            {row('Topic', <Input value={ntfyTopic} onChange={(e) => setNtfyTopic(e.target.value)} disabled={!canEdit} aria-label="ntfy topic" />)}
          </Section>
          {saveBar}
        </div>
      )}

      {tab === 'site' && (
        <div className="flex flex-col gap-4">
          <Section title="Public website" description="The competitor-facing site at /site.">
            <div className="p-4">
              <SiteConfigEditor
                value={siteDraft}
                onChange={(next) => {
                  setSiteDraft(next);
                  setSiteDirty(true);
                }}
                disabled={!canEdit}
              />
            </div>
          </Section>
          <MatchRecordingsCard canEdit={canEdit} />
          <Section title="Download public site" description="A static zip for Cloudflare Pages. Download after the final match so it holds the final results.">
            <div className="p-4">
              {canEdit ? (
                <a
                  href="/api/v1/site/export.zip"
                  download="competition-site.zip"
                  className="inline-flex h-9 items-center rounded-lg border border-neutral-900 bg-neutral-900 px-3.5 text-sm font-medium text-white hover:bg-neutral-700"
                >
                  Download site (.zip)
                </a>
              ) : (
                <p className="text-sm text-vmd-textMuted">You need permission to edit settings to download it.</p>
              )}
            </div>
          </Section>
          {saveBar}
        </div>
      )}

      {tab === 'storage' && (
        <div className="flex flex-col gap-4">
          <Section title="S3 media storage" description="Where recordings, photos and team videos are kept.">
            {row('Endpoint URL', <Input value={s3Endpoint} onChange={(e) => setS3Endpoint(e.target.value)} disabled={!canEdit} aria-label="Endpoint URL" />)}
            {row('Public endpoint URL (optional)', <Input placeholder="Defaults to Endpoint URL" value={s3PublicEndpoint} onChange={(e) => setS3PublicEndpoint(e.target.value)} disabled={!canEdit} aria-label="Public endpoint URL" />, 'Only used to sign presigned video URLs. Set it if the Endpoint URL is an internal hostname a browser cannot resolve.')}
            {row('Bucket', <Input value={s3Bucket} onChange={(e) => setS3Bucket(e.target.value)} disabled={!canEdit} aria-label="Bucket" />)}
            {row('Access key', <Input value={s3AccessKey} onChange={(e) => setS3AccessKey(e.target.value)} disabled={!canEdit} aria-label="Access key" />)}
            {row('Secret key', <Input type="password" value={s3SecretKey} onChange={(e) => setS3SecretKey(e.target.value)} disabled={!canEdit} aria-label="Secret key" />)}
            {row('Region', <Input value={s3Region} onChange={(e) => setS3Region(e.target.value)} disabled={!canEdit} aria-label="Region" />)}
          </Section>
          {saveBar}
        </div>
      )}

      {tab === 'roles' && canEdit && (
        <Section title="Roles" description="Which role can do what is managed on the Users and roles page.">
          <div className="p-4">
            <Link to="/users"><Button>Open users and roles</Button></Link>
          </div>
        </Section>
      )}

      {tab === 'keys' && canEdit && (
        <div className="flex flex-col gap-4">
          <ApiKeysSection canEdit={canEdit} />
          <TeleprompterIndexSection canEdit={canEdit} />
        </div>
      )}
    </div>
  );
}

/** Appendix B.4 / AUDIT_FINDINGS.md 1.3: the `/prompter` bare index route is
 * gated on a `prompter_index_token` system setting. This section shows the
 * current token with copy-to-clipboard, and a "Regenerate" button that
 * writes a freshly-generated token through the same generic
 * `PUT /api/v1/settings` mechanism every other section uses — there's no
 * dedicated rotation endpoint, but the generic settings PUT already
 * supports replacing the value, which is all rotation requires. Written
 * defensively since the `prompter_index_token` backend key is landing in
 * parallel and may not exist yet. */
function TeleprompterIndexSection({ canEdit }: { canEdit: boolean }) {
  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();
  const pushToast = useUiStore((s) => s.pushToast);

  const tokenValue = settingValue(settings, 'prompter_index_token');
  const token = String(tokenValue.token ?? '');

  function regenerate() {
    const fresh =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().replace(/-/g, '')
        : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    updateSettings.mutate(
      { prompter_index_token: { value: { token: fresh } } },
      {
        onSuccess: () => pushToast('Teleprompter index token regenerated', 'success'),
        onError: (err) => pushToast(err instanceof Error ? err.message : 'Regenerate failed', 'error'),
      },
    );
  }

  return (
    <Section title="Teleprompter index" description="Gates the bare /prompter page that lists all active timer instances.">
      <div className="p-4">
        {isLoading ? (
          <p className="text-sm text-vmd-textSubtle">Loading…</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <code className="vmd-code-block break-all text-xs">{token || '(not set)'}</code>
            {token && <CopyButton value={token} />}
            {canEdit && (
              <Button variant="ghost" onClick={regenerate} disabled={updateSettings.isPending}>
                <RefreshCw size={14} /> Regenerate
              </Button>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

function ApiKeysSection({ canEdit }: { canEdit: boolean }) {
  const { data: keys = [] } = useApiKeys();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const { data: catalog } = usePermissionCatalog();
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  function togglePermission(p: string) {
    setPermissions((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  function close() {
    setModalOpen(false);
    setCreatedKey(null);
    setPreset(null);
  }

  function handleCreate() {
    createKey.mutate(
      { name, permissions },
      {
        onSuccess: (res) => {
          setCreatedKey(res.raw_key);
          setName('');
          setPermissions([]);
        },
      },
    );
  }

  const groups = catalog
    ? [...new Set(catalog.permissions.map((p) => p.group))].map((group) => ({ group, items: catalog.permissions.filter((p) => p.group === group) }))
    : [{ group: 'All', items: ALL_PERMISSIONS.map((p) => ({ name: p, group: 'All', description: '' })) }];

  return (
    <>
      <Section
        title="API keys"
        description="Keys let other tools and the capture agent talk to this server. A key is shown once, when you create it."
        action={
          canEdit && (
            <Button variant="primary" onClick={() => setModalOpen(true)}>
              <Plus size={16} /> New API key
            </Button>
          )
        }
      >
        <DataTable
          minWidth={620}
          rows={keys}
          rowKey={(k) => k.id}
          empty={<EmptyState icon={KeyRound} title="No API keys yet">Create one for the capture agent or another tool.</EmptyState>}
          columns={[
            { key: 'name', header: 'Name', width: '1.2fr', render: (k) => <span className="font-medium text-vmd-textStrong">{k.name}{k.revoked && <span className="ml-2 text-xs font-normal text-vmd-textSubtle">Revoked</span>}</span> },
            { key: 'perms', header: 'Permissions', width: '2fr', render: (k) => <span className="text-[13px] text-vmd-textMuted">{k.permissions.join(', ') || '(none)'}</span> },
            { key: 'used', header: 'Last used', width: '1fr', render: (k) => <span className="text-[13px] text-vmd-textMuted">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'Never'}</span> },
            { key: 'act', header: '', width: '80px', render: (k) => canEdit && !k.revoked ? <button type="button" onClick={() => revokeKey.mutate(k.id)} className="h-7 rounded-lg border border-vmd-border px-2.5 text-[13px] font-medium text-vmd-text hover:bg-neutral-50">Revoke</button> : null },
          ]}
        />
      </Section>

      <Modal open={modalOpen} onClose={close} title="New API key" wide>
        {createdKey ? (
          <div>
            <p className="mb-2 text-sm text-vmd-danger">This key is shown only once. Copy it now. It cannot be retrieved again.</p>
            <p className="vmd-code-block break-all text-xs">{createdKey}</p>
            <div className="mt-3 flex justify-end gap-2">
              <CopyButton value={createdKey} />
              <Button variant="primary" onClick={close}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="-mt-2 text-[13px] text-vmd-textSubtle">Start from a preset, then adjust.</p>
            {catalog && catalog.presets.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-neutral-700">Preset</span>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
                  {catalog.presets.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={preset === p.id}
                      onClick={() => {
                        setPreset(p.id);
                        setPermissions(p.permissions);
                        setName(p.label);
                      }}
                      className={`flex flex-col rounded-lg border px-3 py-2.5 text-left ${preset === p.id ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-vmd-border bg-white text-vmd-text hover:bg-neutral-50'}`}
                    >
                      <span className="text-[13px] font-medium">{p.label}</span>
                      <span className={`text-xs ${preset === p.id ? 'text-white/70' : 'text-vmd-textSubtle'}`}>{p.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <Label htmlFor="api-key-name">Name</Label>
              <Input id="api-key-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-3">
              <span className="text-[13px] font-medium text-neutral-700">Permissions</span>
              {groups.map(({ group, items }) => (
                <div key={group}>
                  <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-vmd-textSubtle">{group}</div>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
                    {items.map((p) => (
                      <Check key={p.name} checked={permissions.includes(p.name)} onChange={() => togglePermission(p.name)} label={p.name} description={p.description || undefined} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="-mx-5 -mb-5 flex justify-end gap-2 border-t border-vmd-border bg-neutral-50 px-5 py-3">
              <Button onClick={close}>Cancel</Button>
              <Button variant="primary" onClick={handleCreate} disabled={!name || createKey.isPending}>
                Create key
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
