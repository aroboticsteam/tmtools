/** The demo's in-memory "database". Edits made in the UI land here and are gone on reload. */
import type {
  AgendaItem, ApiKey, Automation, AutomationFolder, AutomationRun, AuditLogEntry, ButtonPage, CaptureRecording,
  IntegrationInstance, OverlayInstance, PrompterCue, ReplayState, Room, RolePermission, Script, SystemSetting,
  TeamProfile, TimerInstance, ZerosPreset,
} from '../types/api';
import type { MatchRecordingItem } from '../api/site';
import { AGENDA, EVENT_NAME, FIELD_COUNT, MATCH_DURATION_S, SITE_CONFIG, TEAMS, buildMatches, rankings, type DemoMatch } from './data';

let counter = 1000;
export const uid = (): string => `demo-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const nowIso = (): string => new Date().toISOString();
const ago = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();

export const PLAYED_AT_START = 14;
export const CLIP_URL = `${import.meta.env.BASE_URL}demo/clip.mp4`;

function integration(entity_id: string, domain: string, display_name: string, config: Record<string, unknown>, status = 'CONNECTED', tags: string[] = []): IntegrationInstance {
  return { id: uid(), entity_id, domain, display_name, config, enabled: true, tags, status, created_at: ago(60 * 24 * 5), updated_at: ago(60 * 24) };
}

const matches: DemoMatch[] = buildMatches(PLAYED_AT_START);

const integrations: IntegrationInstance[] = [
  integration('vex_tm.main', 'vex_tm', 'Tournament Manager (demo)', { base_url: 'http://tm.demo.invalid', client_id: 'demo-client', client_secret: '••••••••', api_key: '••••••••', field_set_id: 1 }),
  integration('obs.main', 'obs', 'OBS (stream PC)', { host: '10.0.0.20', port: 4455, password: '••••••••' }),
  integration('atem.main', 'atem', 'ATEM Mini Pro', { ip: '10.0.0.30' }),
  integration('wled.field1', 'wled', 'Field 1 strip', { host: '10.0.0.41', port: 80 }, 'CONNECTED', ['field1']),
  integration('wled.field2', 'wled', 'Field 2 strip', { host: '10.0.0.42', port: 80 }, 'DEGRADED', ['field2']),
  integration('zeros.main', 'zeros', 'ZerOS stage lights', { ip: '10.0.0.50', port: 8000 }),
  integration('ptz.cam1', 'ptz', 'Main PTZ camera', { host: '10.0.0.61', port: 52381, camera_address: 1 }),
  integration('osc.sound', 'osc', 'Sound desk (OSC)', { ip: '10.0.0.70', port: 9000 }),
  integration('artnet.truss', 'artnet', 'Truss DMX', { ip: '10.0.0.80', universe: 0, refresh_hz: 30 }),
  integration('capture.main', 'capture', 'Replay capture', {}),
  integration('spotify.main', 'spotify', 'Match music', {}, 'DISCONNECTED'),
];

/** What each fake device reports from `GET /integrations/{id}/state`. */
const integrationState: Record<string, Record<string, unknown>> = {
  'vex_tm.main': { connected: true, current_field: 1, field_set_id: 1 },
  'obs.main': { connected: true, current_scene: 'Program', scenes: ['Program', 'Replay', 'Results', 'Stage', 'Intermission'], streaming: true, recording: false },
  'atem.main': { connected: true, program: 1, preview: 2 },
  'wled.field1': { connected: true, on: true, brightness: 180, preset: 1 },
  'wled.field2': { connected: false, on: false, brightness: 0, preset: 0 },
  'zeros.main': { connected: true, last_preset: null },
  'ptz.cam1': { connected: true, preset: 1 },
  'osc.sound': { connected: true },
  'artnet.truss': { connected: true },
  'capture.main': { connected: true, agent: { agent_id: 'demo-laptop', state: 'idle' } },
  'spotify.main': { connected: false },
};

const timers: TimerInstance[] = Array.from({ length: FIELD_COUNT }, (_, i) => ({
  id: uid(), entity_id: `timer.field_${i + 1}`, display_name: `Field ${i + 1} timer`, field_set_id: 1, field_id: i + 1, tags: [`field${i + 1}`],
  enabled: true, duration_s: MATCH_DURATION_S, created_at: ago(60 * 24 * 5), updated_at: ago(60 * 24), prompter_token: `demo-token-${i + 1}`,
}));

const cues: PrompterCue[] = timers.flatMap((t, ti) => [
  ['script', 'Welcome to {{field}}! Our next match is about to begin.'],
  ['note', 'Remind the audience about the pit tours at lunch.'],
  ['runsheet', 'Teams to the field, 2 minutes.'],
].map(([type, content], i) => ({ id: uid(), timer_entity_id: t.entity_id, content: content.replace('{{field}}', `Field ${ti + 1}`), type, sort_order: i, is_active: i === 0, created_by: 'Demo admin', created_at: ago(300) })));

const folders: AutomationFolder[] = [
  { id: 'f-match', name: 'Match flow', parent_id: null, created_at: ago(900) },
  { id: 'f-lights', name: 'Lighting', parent_id: null, created_at: ago(900) },
  { id: 'f-health', name: 'Health', parent_id: null, created_at: ago(900) },
];

function auto(alias: string, folder_id: string, trigger: string, action: string, condition: string | null = null, enabled = true): Automation {
  return { id: uid(), folder_id, alias, enabled, trigger_yaml: trigger, condition_yaml: condition, action_yaml: action, last_triggered_at: null, created_at: ago(800), updated_at: ago(300) };
}

const automations: Automation[] = [
  auto('Match start: start the recording', 'f-match',
    '- platform: state\n  event_type: audienceDisplayChanged\n', '- service: capture.start_recording\n  target: capture.main\n  data:\n    field_id: "{{ states(\'vex_tm.main\', \'current_field\') }}"\n',
    '- "{{ trigger.payload.display == \'IN_MATCH\' }}"\n'),
  auto('Match end: stop the recording', 'f-match',
    '- platform: state\n  event_type: matchStopped\n', '- service: capture.stop_recording\n  target: capture.main\n'),
  auto('Countdown: strip goes amber', 'f-match',
    '- platform: state\n  event_type: audienceDisplayChanged\n', '- service: wled.set_color\n  target: wled.field1\n  data:\n    color: "#FFA000"\n',
    '- "{{ trigger.payload.display == \'IN_MATCH\' }}"\n'),
  auto('Match start: strip goes green', 'f-match',
    '- platform: state\n  event_type: matchStarted\n', '- service: wled.set_color\n  target: wled.field1\n  data:\n    color: "#00C040"\n'),
  auto('Match end: strip back to idle', 'f-match',
    '- platform: state\n  event_type: matchStopped\n', '- service: wled.set_preset\n  target: wled.field1\n  data:\n    preset: 1\n'),
  auto('Match start: OBS to the match scene', 'f-match',
    '- platform: state\n  event_type: matchStarted\n', '- service: obs.switch_scene\n  target: obs.main\n  data:\n    scene_name: Program\n'),
  auto('Results graphic: OBS to the results scene', 'f-match',
    '- platform: state\n  event_type: audienceDisplayChanged\n', '- service: obs.switch_scene\n  target: obs.main\n  data:\n    scene_name: Results\n',
    '- "{{ trigger.payload.display == \'RESULTS\' }}"\n'),
  auto('Match start: stage lights to the match look', 'f-lights',
    '- platform: state\n  event_type: matchStarted\n', '- service: zeros.set_preset\n  target: zeros.main\n  data:\n    preset_id: 2\n'),
  auto('Alert when an integration drops', 'f-health',
    '- platform: state\n  event_type: integration_status\n', '- service: persistent_notification.create\n  data:\n    message: "An integration changed state"\n', null, false),
];

const scripts: Script[] = [
  { id: uid(), name: 'Go to results', description: 'Results scene plus the amber strip.', action_yaml: '- service: obs.switch_scene\n  target: obs.main\n  data:\n    scene_name: Results\n- service: wled.set_color\n  target: wled.field1\n  data:\n    color: "#FFA000"\n', created_at: ago(500), updated_at: ago(500) },
  { id: uid(), name: 'House lights up', description: null, action_yaml: '- service: zeros.set_preset\n  target: zeros.main\n  data:\n    preset_id: 1\n', created_at: ago(500), updated_at: ago(500) },
];

const buttonPages: ButtonPage[] = [
  { id: 'bp-1', name: 'Stage', position: 0, columns: 3, buttons: [
    { id: 'b-1', page_id: 'bp-1', label: 'Program scene', color: '#16a34a', position: 0, icon: null, confirm: false, action_yaml: '- service: obs.switch_scene\n  target: obs.main\n  data:\n    scene_name: Program\n' },
    { id: 'b-2', page_id: 'bp-1', label: 'Replay scene', color: '#2563eb', position: 1, icon: null, confirm: false, action_yaml: '- service: obs.switch_scene\n  target: obs.main\n  data:\n    scene_name: Replay\n' },
    { id: 'b-3', page_id: 'bp-1', label: 'Results scene', color: '#9333ea', position: 2, icon: null, confirm: false, action_yaml: '- service: obs.switch_scene\n  target: obs.main\n  data:\n    scene_name: Results\n' },
    { id: 'b-4', page_id: 'bp-1', label: 'Stage lights up', color: '#ca8a04', position: 3, icon: null, confirm: false, action_yaml: '- service: zeros.set_preset\n  target: zeros.main\n  data:\n    preset_id: 1\n' },
    { id: 'b-5', page_id: 'bp-1', label: 'Strip red', color: '#dc2626', position: 4, icon: null, confirm: true, action_yaml: '- service: wled.set_color\n  target: wled.field1\n  data:\n    color: "#FF0000"\n' },
  ] },
  { id: 'bp-2', name: 'Cameras', position: 1, columns: 2, buttons: [
    { id: 'b-6', page_id: 'bp-2', label: 'PTZ home', color: '#475569', position: 0, icon: null, confirm: false, action_yaml: '- service: ptz.home\n  target: ptz.cam1\n' },
    { id: 'b-7', page_id: 'bp-2', label: 'PTZ preset 1', color: '#475569', position: 1, icon: null, confirm: false, action_yaml: '- service: ptz.recall_preset\n  target: ptz.cam1\n  data:\n    preset: 1\n' },
  ] },
];

const overlays: OverlayInstance[] = [
  { id: uid(), entity_id: 'overlay.main_stream', display_name: 'Main stream', field_set_id: 1, tags: [], enabled: true, created_at: ago(900), updated_at: ago(900) },
  { id: uid(), entity_id: 'overlay.field_2', display_name: 'Field 2 feed', field_set_id: 1, tags: ['field2'], enabled: true, created_at: ago(900), updated_at: ago(900) },
];

const rooms: Room[] = [
  { slug: 'hall', name: 'Main hall', stream_url: null, teams: TEAMS.slice(0, 8).map((t) => t.number) },
  { slug: 'pits', name: 'Pits', stream_url: null, teams: TEAMS.slice(8, 16).map((t) => t.number) },
  { slug: 'cafe', name: 'Cafe', stream_url: 'https://example.com/stream', teams: TEAMS.slice(16).map((t) => t.number) },
];

const teams: TeamProfile[] = TEAMS.map((t, i) => ({
  team_number: t.number, pit_location: t.pit, bio: `${t.name} from ${t.organisation}. This is demo data.`, robot_name: t.robot,
  video_360_s3_key: null, video_processing_status: 'NONE', cached_stats: { rank: i + 1, wins: 0, losses: 0 }, extra_notes: i % 5 === 0 ? 'Needs a power strip.' : null,
  website_url: null, logo_s3_key: null, inspection_status: t.inspection, updated_at: ago(120),
}));

const agenda: AgendaItem[] = AGENDA.map((a, i) => ({ id: uid(), scope: a.scope as 'day' | 'finals', start_time: a.start_time, end_time: a.end_time, title: a.title, details: a.details, position: i, announce_lead_minutes: null }));

const zerosPresets: ZerosPreset[] = [
  { id: uid(), integration_id: 'zeros.main', preset_number: 1, preset_name: 'House', description: 'Warm house look' },
  { id: uid(), integration_id: 'zeros.main', preset_number: 2, preset_name: 'Match', description: 'Bright field wash' },
];

const settings: SystemSetting[] = [
  { key: 'site', value: SITE_CONFIG as unknown as Record<string, unknown>, updated_by: 'Demo admin', updated_at: ago(600) },
  { key: 'competition', value: { program: 'VIQRC' }, updated_by: 'Demo admin', updated_at: ago(600) },
  { key: 'notifications', value: { server_url: 'https://ntfy.example.com', topic: 'tmtools-demo', enabled: false, team_alerts_enabled: true, lead_matches_x: 3, lead_minutes_y: 15, scores_enabled: true, late_minutes: 5, agenda_announcements_enabled: true, agenda_lead_minutes: 10, timezone: 'Europe/London' }, updated_by: null, updated_at: ago(600) },
  { key: 'robot_events_api', value: { token: '' }, updated_by: null, updated_at: ago(600) },
  { key: 'predictor', value: { enabled: false }, updated_by: null, updated_at: ago(600) },
  { key: 'overlay', value: {}, updated_by: null, updated_at: ago(600) },
  { key: 's3', value: { endpoint_url: 'https://s3.demo.invalid', bucket: 'tmtools-demo', region: 'us-east-1', access_key: 'demo', secret_key: '••••••••' }, updated_by: null, updated_at: ago(600) },
];

const apiKeys: ApiKey[] = [
  { id: uid(), name: 'Stream Deck', permissions: ['buttons:press', 'buttons:read'], created_by: 'Demo admin', last_used_at: ago(45), created_at: ago(2000), revoked: false },
  { id: uid(), name: 'Capture laptop', permissions: ['capture:upload'], created_by: 'Demo admin', last_used_at: ago(5), created_at: ago(2000), revoked: false },
];

const roles: RolePermission[] = [
  ...['integrations:read', 'timers:read', 'teams:read', 'rooms:read', 'overlays:read', 'buttons:read', 'buttons:press', 'prompter:view', 'prompter:control', 'analysis:view', 'capture:control', 'video:control'].map((permission) => ({ authentik_group: 'tmtools-operator', permission })),
  ...['settings:read', 'integrations:read', 'automations:read', 'timers:read', 'teams:read'].map((permission) => ({ authentik_group: 'tmtools-viewer', permission })),
];

const matchRecordings: MatchRecordingItem[] = [
  { match_key: 'Q1', division: '1', label: 'Q1', url: 'https://example.com/replays/Q1', title: 'Qualification 1' },
];

function recordings(): CaptureRecording[] {
  return matches.slice(0, PLAYED_AT_START).map((m, i) => {
    const started = new Date(Date.now() - (PLAYED_AT_START - i) * 8 * 60_000);
    return {
      id: `rec-${m.n}`, match_key: `1:1:QUAL:1:${m.n}`, match_type: 'QUAL', match_number: String(m.n), teams: [...m.red, ...m.blue],
      alliances: { red: m.red, blue: m.blue }, status: 'READY', started_at: started.toISOString(), stopped_at: new Date(started.getTime() + 68_000).toISOString(),
      duration_s: 68, size_bytes: 41_000_000, error: null,
      moments: i % 2 === 0 ? [
        { id: `mom-${m.n}-1`, number: 1, length_s: 10, status: 'READY', end_offset_ms: 41_000, ready_ms: 2300, requested_at: started.toISOString(), error: null },
        { id: `mom-${m.n}-2`, number: 2, length_s: 5, status: 'READY', end_offset_ms: 55_000, ready_ms: 2100, requested_at: started.toISOString(), error: null },
      ] : [],
    };
  });
}

function auditRows(): AuditLogEntry[] {
  const rows: [string, string, string][] = [
    ['create', 'automation', 'Match start: start the recording'], ['update', 'setting', 'site'], ['create', 'integration', 'obs.main'],
    ['update', 'team', '3037B'], ['create', 'api_key', 'Stream Deck'], ['update', 'integration', 'wled.field1'], ['create', 'room', 'hall'],
  ];
  return rows.map(([action, resource_type, resource_id], i) => ({ id: uid(), user_id: 'Demo admin', action, resource_type, resource_id, changes: null, ip_address: '203.0.113.7', created_at: ago(30 + i * 40) }));
}

export const db = {
  eventName: EVENT_NAME,
  matches,
  played: PLAYED_AT_START,
  integrations,
  integrationState,
  timers,
  cues,
  folders,
  automations,
  runs: [] as AutomationRun[],
  scripts,
  buttonPages,
  overlays,
  rooms,
  teams,
  agenda,
  zerosPresets,
  settings,
  apiKeys,
  roles,
  matchRecordings,
  recordings: recordings(),
  audit: auditRows(),
  replay: { playing: false } as ReplayState,
  debugLog: {} as Record<string, unknown[]>,
  /** Which team numbers each public-site photo exists for: none in the demo. */
  ranks: () => rankings(db.matches),
};
