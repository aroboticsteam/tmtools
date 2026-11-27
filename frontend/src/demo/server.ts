/** The demo's fake REST API: a route table over the in-memory `db`. Unknown routes warn in the console and 404. */
import { ApiError } from '../lib/http';
import type { RequestOptions } from '../lib/http';
import type { AuditLogEntry, TeamChecklistItem, TimerInstance } from '../types/api';
import { PERMISSION_CATALOG, INTEGRATION_SCHEMAS } from './catalog';
import { MATCH_DURATION_S, PROGRAMME, SITE_CONFIG, TEAMS, skills } from './data';
import {
  callService, captureStatus, execAutomation, fieldSnapshot, markMoment, replayControl, replayPlay, roomNotice, runActions,
  resetField, showTeam, startField, stopCurrentRecording, stopField,
} from './sim';
import { CLIP_URL, db, nowIso, uid } from './state';
import * as yaml from 'js-yaml';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
interface Req {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Any;
}
type Handler = (r: Req) => unknown;
interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  h: Handler;
}
const routes: Route[] = [];

function route(method: string, pattern: string, h: Handler): void {
  const keys: string[] = [];
  const src = pattern.replace(/:([a-zA-Z_]+)/g, (_m, k: string) => {
    keys.push(k);
    return '([^/]+)';
  });
  routes.push({ method, re: new RegExp(`^${src}$`), keys, h });
}
const get = (p: string, h: Handler) => route('GET', p, h);
const post = (p: string, h: Handler) => route('POST', p, h);
const put = (p: string, h: Handler) => route('PUT', p, h);
const del = (p: string, h: Handler) => route('DELETE', p, h);

const notFound = (what: string): never => {
  throw new ApiError(404, `${what} not found`, { detail: `${what} not found` });
};
const find = <T>(list: T[], pred: (x: T) => boolean, what: string): T => list.find(pred) ?? notFound(what);
const remove = <T>(list: T[], pred: (x: T) => boolean): void => {
  const i = list.findIndex(pred);
  if (i >= 0) list.splice(i, 1);
};
const touch = <T extends { updated_at?: string }>(x: T): T => {
  if ('updated_at' in x) x.updated_at = nowIso();
  return x;
};
const audit = (action: string, resource_type: string, resource_id: string): void => {
  db.audit.unshift({ id: uid(), user_id: 'Demo admin', action, resource_type, resource_id, changes: null, ip_address: '203.0.113.7', created_at: nowIso() });
};
const reorder = <T extends { id: string; position: number }>(list: T[], ids: string[]): void => {
  ids.forEach((id, i) => {
    const x = list.find((y) => y.id === id);
    if (x) x.position = i;
  });
};
const teamName = (n: string): string => TEAMS.find((t) => t.number === n)?.name ?? n;

// ── auth, health, status ──────────────────────────────────────────────────

get('/api/v1/auth/whoami', () => ({ authenticated: true, subject: 'Demo admin', is_admin_local: true, permissions: PERMISSION_CATALOG.permissions.map((p) => p.name) }));
post('/auth/logout', () => undefined);
get('/readyz', () => ({ status: 'ok', db: true, redis: true }));
get('/api/v1/status', () => ({
  leader: { is_leader: true, leader_address: 'demo' },
  integrations: db.integrations.map((i) => ({ entity_id: i.entity_id, status: i.status, last_event_at: Date.now() / 1000 })),
}));
get('/api/v1/fields/state', () => fieldSnapshot());

// ── integrations ──────────────────────────────────────────────────────────

get('/api/v1/integrations', () => db.integrations);
get('/api/v1/integrations/schemas', () => INTEGRATION_SCHEMAS);
post('/api/v1/integrations', ({ body }) => {
  const inst = { id: uid(), entity_id: body.entity_id, domain: body.domain, display_name: body.display_name ?? body.entity_id, config: body.config ?? {}, enabled: body.enabled ?? true, tags: body.tags ?? [], status: 'CONNECTED', created_at: nowIso(), updated_at: nowIso() };
  db.integrations.push(inst);
  db.integrationState[inst.entity_id] = { connected: true };
  audit('create', 'integration', inst.entity_id);
  return inst;
});
put('/api/v1/integrations/:id', ({ params, body }) => {
  const inst = find(db.integrations, (i) => i.entity_id === params.id, 'Integration');
  Object.assign(inst, body);
  audit('update', 'integration', inst.entity_id);
  return touch(inst);
});
del('/api/v1/integrations/:id', ({ params }) => {
  remove(db.integrations, (i) => i.entity_id === params.id);
  audit('delete', 'integration', params.id);
});
post('/api/v1/integrations/:id/test', ({ params }) => {
  const inst = find(db.integrations, (i) => i.entity_id === params.id, 'Integration');
  return inst.status === 'DISCONNECTED' ? { ok: false, message: 'Could not connect (demo: this integration is set to be offline)' } : { ok: true, message: 'Connected (simulated)' };
});
get('/api/v1/integrations/:id/state', ({ params }) => {
  const inst = find(db.integrations, (i) => i.entity_id === params.id, 'Integration');
  return { entity_id: inst.entity_id, status: inst.status, state: db.integrationState[inst.entity_id] ?? {} };
});
post('/api/v1/integrations/:id/service/:service', async ({ params, body }) => {
  const inst = find(db.integrations, (i) => i.entity_id === params.id, 'Integration');
  try {
    return await callService(`${inst.domain}.${params.service}`, inst.entity_id, body ?? {});
  } catch (e) {
    throw new ApiError(502, e instanceof Error ? e.message : String(e), { detail: e instanceof Error ? e.message : String(e) });
  }
});
post('/api/v1/integrations/:id/oauth_token', ({ params }) => {
  const inst = find(db.integrations, (i) => i.entity_id === params.id, 'Integration');
  inst.status = 'CONNECTED';
  return { ok: true };
});
get('/api/v1/integrations/:id/spotify/library', () => ({ playlists: [], tracks: [], devices: [] }));
get('/api/v1/zeros/presets', () => db.zerosPresets);
post('/api/v1/zeros/presets', ({ body }) => {
  const p = { id: uid(), description: null, ...body };
  db.zerosPresets.push(p);
  return p;
});
del('/api/v1/zeros/presets/:id', ({ params }) => remove(db.zerosPresets, (p) => p.id === params.id));
get('/api/v1/debug/integrations/:id/log', ({ params }) => db.debugLog[params.id] ?? []);

// ── automations + scripts + buttons ───────────────────────────────────────

get('/api/v1/automations/folders', () => db.folders);
post('/api/v1/automations/folders', ({ body }) => {
  const f = { id: uid(), parent_id: null, created_at: nowIso(), ...body };
  db.folders.push(f);
  return f;
});
put('/api/v1/automations/folders/:id', ({ params, body }) => Object.assign(find(db.folders, (f) => f.id === params.id, 'Folder'), body));
del('/api/v1/automations/folders/:id', ({ params }) => {
  remove(db.folders, (f) => f.id === params.id);
  for (const a of db.automations) if (a.folder_id === params.id) a.folder_id = null;
});
post('/api/v1/automations/validate', ({ body }) => {
  const errors: string[] = [];
  for (const [label, text] of [['trigger', body.trigger_yaml], ['condition', body.condition_yaml], ['action', body.action_yaml]] as const) {
    if (!text) continue;
    try {
      yaml.load(text);
    } catch (e) {
      errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { valid: errors.length === 0, errors };
});
get('/api/v1/automations', () => db.automations);
post('/api/v1/automations', ({ body }) => {
  const a = { id: uid(), folder_id: null, enabled: true, condition_yaml: null, last_triggered_at: null, created_at: nowIso(), updated_at: nowIso(), ...body };
  db.automations.push(a);
  audit('create', 'automation', a.alias);
  return a;
});
post('/api/v1/automations/:id/trigger', async ({ params }) => {
  const a = find(db.automations, (x) => x.id === params.id, 'Automation');
  const r = await execAutomation(a, { trigger: { event_type: 'manual', entity_id: '', payload: {} } });
  return { automation_id: a.id, status: r.status, failed_action_index: r.failed_action_index, error: r.error, actions_executed: r.actions_executed };
});
get('/api/v1/automations/:id/runs', ({ params }) => db.runs.filter((r) => r.automation_id === params.id).slice(0, 50));
put('/api/v1/automations/:id', ({ params, body }) => touch(Object.assign(find(db.automations, (a) => a.id === params.id, 'Automation'), body)));
del('/api/v1/automations/:id', ({ params }) => remove(db.automations, (a) => a.id === params.id));

get('/api/v1/scripts', () => db.scripts);
post('/api/v1/scripts', ({ body }) => {
  const s = { id: uid(), description: null, created_at: nowIso(), updated_at: nowIso(), ...body };
  db.scripts.push(s);
  return s;
});
put('/api/v1/scripts/:id', ({ params, body }) => touch(Object.assign(find(db.scripts, (s) => s.id === params.id, 'Script'), body)));
del('/api/v1/scripts/:id', ({ params }) => remove(db.scripts, (s) => s.id === params.id));

get('/api/v1/button-pages', () => db.buttonPages);
put('/api/v1/button-pages/order', ({ body }) => body.ids.forEach((id: string, i: number) => { const p = db.buttonPages.find((x) => x.id === id); if (p) p.position = i; }));
put('/api/v1/button-pages/buttons/:id', ({ params, body }) => {
  for (const p of db.buttonPages) {
    const b = p.buttons.find((x) => x.id === params.id);
    if (b) return Object.assign(b, body);
  }
  return notFound('Button');
});
del('/api/v1/button-pages/buttons/:id', ({ params }) => { for (const p of db.buttonPages) remove(p.buttons, (b) => b.id === params.id); });
post('/api/v1/button-pages/buttons/:id/press', async ({ params }) => {
  const b = db.buttonPages.flatMap((p) => p.buttons).find((x) => x.id === params.id) ?? notFound('Button');
  const r = await runActions(b.action_yaml, { trigger: { event_type: 'button', entity_id: '', payload: {} } });
  return { status: r.status, error: r.error, failed_action_index: r.failed_action_index, actions_executed: r.actions_executed };
});
put('/api/v1/button-pages/:pageId/buttons/order', ({ params, body }) => {
  const p = find(db.buttonPages, (x) => x.id === params.pageId, 'Page');
  body.ids.forEach((id: string, i: number) => { const b = p.buttons.find((x) => x.id === id); if (b) b.position = i; });
});
post('/api/v1/button-pages/:pageId/buttons', ({ params, body }) => {
  const p = find(db.buttonPages, (x) => x.id === params.pageId, 'Page');
  const b = { id: uid(), page_id: p.id, position: p.buttons.length, icon: null, confirm: false, ...body };
  p.buttons.push(b);
  return b;
});
post('/api/v1/button-pages', ({ body }) => {
  const p = { id: uid(), position: db.buttonPages.length, columns: 3, buttons: [], ...body };
  db.buttonPages.push(p);
  return p;
});
put('/api/v1/button-pages/:id', ({ params, body }) => Object.assign(find(db.buttonPages, (p) => p.id === params.id, 'Page'), body));
del('/api/v1/button-pages/:id', ({ params }) => remove(db.buttonPages, (p) => p.id === params.id));

// ── capture + replay ──────────────────────────────────────────────────────

get('/api/v1/capture/status', () => captureStatus());
get('/api/v1/capture/recordings', ({ query }) => {
  const team = query.get('team');
  const type = query.get('match_type');
  const limit = Number(query.get('limit')) || 100;
  return db.recordings.filter((r) => (!team || r.teams.includes(team)) && (!type || r.match_type === type)).slice(0, limit);
});
post('/api/v1/capture/recordings/stop', () => stopCurrentRecording());
post('/api/v1/capture/moments', ({ body }) => {
  try {
    markMoment(Number(body.length_s) || 10);
  } catch (e) {
    throw new ApiError(409, 'Not recording', { detail: e instanceof Error ? e.message : 'Not recording' });
  }
  return { ok: true };
});
get('/api/v1/capture/recordings/:id/url', ({ params }) => {
  const r = find(db.recordings, (x) => x.id === params.id, 'Recording');
  return { url: CLIP_URL, label: `Q${r.match_number}` };
});
get('/api/v1/capture/replay/:id', () => db.replay);
post('/api/v1/capture/replay/:id/play', ({ params, body }) => { replayPlay(params.id, body); return { ok: true }; });
post('/api/v1/capture/replay/:id/control', ({ params, body }) => { replayControl(params.id, body); return { ok: true }; });

// ── timers, overlays, rooms ───────────────────────────────────────────────

get('/api/v1/timers', () => db.timers);
post('/api/v1/timers', ({ body }) => {
  const t: TimerInstance = { id: uid(), tags: [], enabled: true, duration_s: MATCH_DURATION_S, field_set_id: 1, field_id: 1, created_at: nowIso(), updated_at: nowIso(), prompter_token: `demo-token-${uid()}`, ...body };
  db.timers.push(t);
  return t;
});
const timerField = (id: string): number => find(db.timers, (t) => t.entity_id === id, 'Timer').field_id;
post('/api/v1/timers/:id/start', ({ params }) => { startField(timerField(params.id)); return { ok: true }; });
post('/api/v1/timers/:id/stop', ({ params }) => { stopField(timerField(params.id)); return { ok: true }; });
post('/api/v1/timers/:id/reset', ({ params }) => { resetField(timerField(params.id)); return { ok: true }; });
get('/api/v1/timers/:id/cues', ({ params }) => db.cues.filter((c) => c.timer_entity_id === params.id).sort((a, b) => a.sort_order - b.sort_order));
post('/api/v1/timers/:id/cues', ({ params, body }) => {
  const c = { id: uid(), timer_entity_id: params.id, type: 'script', sort_order: db.cues.length, is_active: false, created_by: 'Demo admin', created_at: nowIso(), ...body };
  db.cues.push(c);
  return c;
});
put('/api/v1/timers/:id/cues/:cue', ({ params, body }) => Object.assign(find(db.cues, (c) => c.id === params.cue, 'Cue'), body));
del('/api/v1/timers/:id/cues/:cue', ({ params }) => remove(db.cues, (c) => c.id === params.cue));
put('/api/v1/timers/:id', ({ params, body }) => touch(Object.assign(find(db.timers, (t) => t.entity_id === params.id, 'Timer'), body)));
del('/api/v1/timers/:id', ({ params }) => remove(db.timers, (t) => t.entity_id === params.id));

get('/api/v1/overlays', () => db.overlays);
post('/api/v1/overlays', ({ body }) => {
  const o = { id: uid(), tags: [], enabled: true, field_set_id: 1, created_at: nowIso(), updated_at: nowIso(), ...body };
  db.overlays.push(o);
  return o;
});
get('/api/v1/overlays/:id/preview', ({ params }) => {
  const snap = fieldSnapshot();
  const first = Object.values(snap.matches)[0];
  return { entity_id: params.id, match: first ? first.payload : null, teams: first ? [...(first.payload.redTeams as string[]), ...(first.payload.blueTeams as string[])] : [] };
});
post('/api/v1/overlays/:id/show-team', ({ params, body }) => { showTeam(params.id, body.team); });
put('/api/v1/overlays/:id', ({ params, body }) => touch(Object.assign(find(db.overlays, (o) => o.entity_id === params.id, 'Overlay'), body)));
del('/api/v1/overlays/:id', ({ params }) => remove(db.overlays, (o) => o.entity_id === params.id));

get('/api/v1/rooms', () => db.rooms);
post('/api/v1/rooms', ({ body }) => { db.rooms.push(body); return body; });
put('/api/v1/rooms/:slug', ({ params, body }) => Object.assign(find(db.rooms, (r) => r.slug === params.slug, 'Room'), body));
del('/api/v1/rooms/:slug', ({ params }) => remove(db.rooms, (r) => r.slug === params.slug));

// ── teams ─────────────────────────────────────────────────────────────────

get('/api/v1/teams', () => db.teams);
get('/api/v1/teams/checklist', () =>
  db.teams.map((t, i): TeamChecklistItem => {
    const bot = i % 3 !== 0;
    const team = i % 4 !== 0;
    const done = [t.inspection_status === 'PASSED', bot, team].filter(Boolean).length;
    return { team_number: t.team_number, inspection: t.inspection_status, bot_photo: bot, team_photo: team, done, total: 3, complete: done === 3 };
  }),
);
get('/api/v1/teams/batch/photos', ({ query }) => ({ photos: Object.fromEntries((query.get('teams') ?? '').split(',').filter(Boolean).map((n) => [n, {}])) }));
get('/api/v1/teams/:n/photos', ({ params }) => ({
  team_number: params.n,
  photos: {
    bot_photo: { team_number: params.n, kind: 'bot_photo', status: 'NONE', processed_s3_key: null, error: null },
    team_photo: { team_number: params.n, kind: 'team_photo', status: 'NONE', processed_s3_key: null, error: null },
  },
}));
post('/api/v1/teams/:n/photos/:kind', ({ params }) => ({ team_number: params.n, kind: params.kind, status: 'PROCESSING' }));
post('/api/v1/teams/:n/logo', ({ params }) => find(db.teams, (t) => t.team_number === params.n, 'Team'));
del('/api/v1/teams/:n/logo', ({ params }) => find(db.teams, (t) => t.team_number === params.n, 'Team'));
get('/api/v1/teams/:n', ({ params }) => find(db.teams, (t) => t.team_number === params.n, 'Team'));
put('/api/v1/teams/:n', ({ params, body }) => {
  const t = find(db.teams, (x) => x.team_number === params.n, 'Team');
  Object.assign(t, body);
  audit('update', 'team', t.team_number);
  return touch(t);
});

// ── agenda, settings, keys, roles, audit, site ────────────────────────────

const AG = '/api/v1/comms/agenda';
get(AG, () => [...db.agenda].sort((a, b) => a.position - b.position));
put(`${AG}/order`, ({ body }) => reorder(db.agenda.filter((a) => a.scope === body.scope), body.ids));
post(`${AG}/import`, ({ body }) => {
  const items: { start_time: string; end_time: string | null; title: string; details: string | null }[] = [];
  const errors: { line: number; error: string }[] = [];
  String(body.text ?? '').split('\n').forEach((line: string, i: number) => {
    if (!line.trim()) return;
    const m = /^\s*(\d{1,2}:\d{2})\s*(?:-\s*(\d{1,2}:\d{2}))?\s*[|,-]?\s*(.+)$/.exec(line);
    if (!m) errors.push({ line: i + 1, error: 'Expected "HH:MM - HH:MM title"' });
    else items.push({ start_time: m[1], end_time: m[2] ?? null, title: m[3].trim(), details: null });
  });
  if (!body.dry_run) {
    if (body.replace) db.agenda = db.agenda.filter((a) => a.scope !== body.scope);
    for (const it of items) db.agenda.push({ id: uid(), scope: body.scope, position: db.agenda.length, announce_lead_minutes: null, ...it });
  }
  return { created: body.dry_run ? 0 : items.length, errors, items };
});
post(AG, ({ body }) => {
  const a = { id: uid(), position: db.agenda.length, announce_lead_minutes: null, end_time: null, details: null, ...body };
  db.agenda.push(a);
  return a;
});
put(`${AG}/:id`, ({ params, body }) => Object.assign(find(db.agenda, (a) => a.id === params.id, 'Agenda item'), body));
del(`${AG}/:id`, ({ params }) => remove(db.agenda, (a) => a.id === params.id));

get('/api/v1/permissions', () => PERMISSION_CATALOG);
get('/api/v1/settings', () => db.settings);
put('/api/v1/settings', ({ body }) => {
  for (const [key, { value }] of Object.entries(body as Record<string, { value: Record<string, unknown> }>)) {
    const s = db.settings.find((x) => x.key === key);
    if (s) Object.assign(s, { value, updated_by: 'Demo admin', updated_at: nowIso() });
    else db.settings.push({ key, value, updated_by: 'Demo admin', updated_at: nowIso() });
  }
  return db.settings;
});
get('/api/v1/api-keys', () => db.apiKeys);
post('/api/v1/api-keys', ({ body }) => {
  const k = { id: uid(), created_by: 'Demo admin', last_used_at: null, created_at: nowIso(), revoked: false, ...body };
  db.apiKeys.push(k);
  return { ...k, raw_key: 'demo_NOT_A_REAL_KEY' };
});
del('/api/v1/api-keys/:id', ({ params }) => remove(db.apiKeys, (k) => k.id === params.id));
get('/api/v1/users/roles', () => db.roles);
put('/api/v1/users/roles', ({ body }) => { db.roles = body; return db.roles; });
get('/api/v1/audit', ({ query }) => {
  const user = query.get('user');
  const action = query.get('action');
  const type = query.get('resource_type');
  const rows = db.audit.filter((r: AuditLogEntry) => (!user || (r.user_id ?? '').includes(user)) && (!action || r.action === action) && (!type || r.resource_type === type));
  const off = Number(query.get('offset')) || 0;
  return rows.slice(off, off + (Number(query.get('limit')) || 50));
});

get('/api/v1/match-recordings', () => db.matchRecordings);
put('/api/v1/match-recordings', ({ body }) => {
  const key = `${body.division}:${body.label}`;
  const row = { match_key: key, title: null, ...body };
  remove(db.matchRecordings, (r) => r.match_key === key || (r.division === body.division && r.label === body.label));
  db.matchRecordings.push(row);
  return row;
});
post('/api/v1/match-recordings/import', ({ body }) => {
  let saved = 0;
  const errors: { line: number; error: string }[] = [];
  String(body.text ?? '').split('\n').forEach((line: string, i: number) => {
    if (!line.trim()) return;
    const [label, url] = line.split(/[\s,]+/);
    if (!label || !/^https?:\/\//.test(url ?? '')) return void errors.push({ line: i + 1, error: 'Expected "Q1 https://..."' });
    db.matchRecordings.push({ match_key: `1:${label}`, division: '1', label, url, title: null });
    saved++;
  });
  return { saved, errors };
});
del('/api/v1/match-recordings/:key', ({ params }) => remove(db.matchRecordings, (r) => r.match_key === decodeURIComponent(params.key)));
post('/api/v1/site/images', ({ body }) => {
  const file = body as FormData;
  const f = file.get('file') as File | null;
  return { key: `demo/${uid()}`, url: f ? URL.createObjectURL(f) : null };
});

// ── notifications ─────────────────────────────────────────────────────────

get('/api/v1/notifications/stats', () => ({ push_configured: false, team_subscriptions: 0, staff_subscriptions: 0, subscriptions_by_room: {} }));
post('/api/v1/notifications/broadcast', ({ body }) => ({ rooms: roomNotice(body.rooms, { title: body.title, message: body.message, modal: !!body.modal }), pushed: 0 }));
post('/api/v1/notifications/team-alert', ({ body }) => {
  const reasons: Record<string, string> = { pit_admin: 'Please come to the pit admin desk.', lost_and_found: 'We have found something of yours.' };
  const message = body.message || reasons[body.reason] || 'Please see an organiser.';
  const rooms = db.rooms.filter((r) => r.teams.some((t) => body.teams.includes(t)));
  for (const r of rooms) roomNotice([r.slug], { title: `Team ${body.teams.join(', ')}`, message, modal: false });
  const reached = new Set(rooms.flatMap((r) => r.teams));
  return { rooms: rooms.length, pushed: 0, unreached_teams: body.teams.filter((t: string) => !reached.has(t)) };
});
post('/api/v1/notifications/test', () => ({ rooms: 0, pushed: 0 }));
post('/api/v1/notifications/staff/subscribe', () => undefined);
post('/api/v1/notifications/staff/unsubscribe', () => undefined);
get('/api/v1/public/push/vapid-key', () => ({ public_key: 'demo' }));
post('/api/v1/public/push/status', () => ({ subscribed: false, teams: [], categories: null }));
post('/api/v1/public/push/subscribe', () => undefined);
post('/api/v1/public/push/unsubscribe', () => undefined);

// ── public site + OBS/room/prompter feeds ─────────────────────────────────

const siteSetting = (): typeof SITE_CONFIG => {
  const s = db.settings.find((x) => x.key === 'site')?.value as typeof SITE_CONFIG | undefined;
  return s ?? SITE_CONFIG;
};
const recordingFor = (label: string): string | null => db.matchRecordings.find((r) => r.label === label)?.url ?? null;
const siteMatches = () => db.matches.map((m) => ({
  label: m.label, division: '1', programme: PROGRAMME, scheduled_at: m.scheduled_at, red: m.red, blue: m.blue, score: m.score ? [m.score[0], m.score[1]] : null, recording_url: recordingFor(m.label),
}));

get('/api/v1/public/site/overview', () => {
  const s = siteSetting();
  const next = s.next_competition;
  const days = next?.date ? Math.ceil((Date.parse(next.date) - Date.now()) / 86_400_000) : null;
  return { ...s, theme: null, hero: { image_url: null }, map: s.map ? { ...s.map, image_url: undefined } : null, next_competition: next ? { ...next, days_until: days } : null };
});
get('/api/v1/public/site/event', () => ({
  divisions: { '1': { programme: PROGRAMME } },
  agenda: db.agenda.map((a) => ({ scope: a.scope, start_time: a.start_time, end_time: a.end_time, title: a.title, details: a.details })),
  matches: siteMatches(),
  rankings: db.ranks().map((r) => ({ ...r, division: '1' })),
  skills: skills().map((s) => ({ ...s, division: '1' })),
}));
get('/api/v1/public/site/teams', () => {
  const ranks = new Map(db.ranks().map((r) => [r.team, r.rank]));
  const sk = new Map(skills().map((r) => [r.team, r.rank]));
  return TEAMS.map((t) => ({ team_number: t.number, team_name: t.name, organisation: t.organisation, division: '1', qual_rank: ranks.get(t.number) ?? null, skills_rank: sk.get(t.number) ?? null, pit_location: t.pit }));
});
get('/api/v1/public/site/teams/:n', ({ params }) => {
  const t = TEAMS.find((x) => x.number === params.n) ?? notFound('Team');
  const rank = db.ranks().find((r) => r.team === t.number);
  const sk = skills().find((r) => r.team === t.number);
  return {
    team_number: t.number, team_name: t.name, logo_url: null, website_url: null, programme: PROGRAMME, organisation: t.organisation, location: t.location, robot_name: t.robot, division: '1', pit_location: t.pit,
    current: { qual_rank: rank?.rank ?? null, wins: rank?.wins ?? 0, losses: rank?.losses ?? 0, ties: rank?.ties ?? 0, skills_rank: sk?.rank ?? null, skills_total: sk?.total ?? null },
    season: { events_attended: 3, awards: 1, world_skills_rank: 40 + (rank?.rank ?? 0), previous_rankings: [], award_list: [] },
    downloads: {}, photos: {},
    schedule: siteMatches().filter((m) => m.red.includes(t.number) || m.blue.includes(t.number)),
  };
});
get('/api/v1/public/site/livestreams', () => db.rooms.filter((r) => r.stream_url).map((r) => ({ name: r.name, stream_url: r.stream_url })));
get('/api/v1/public/rooms/:slug', ({ params }) => {
  const r = find(db.rooms, (x) => x.slug === params.slug, 'Room');
  return { name: r.name, teams: r.teams, stream_url: r.stream_url };
});
get('/api/v1/public/prompter/:id', ({ params, query }) => {
  const t = find(db.timers, (x) => x.entity_id === params.id, 'Timer');
  if (query.get('token') !== t.prompter_token) throw new ApiError(403, 'Invalid token', { detail: 'Invalid token' });
  return { entity_id: t.entity_id, display_name: t.display_name };
});
get('/api/v1/public/prompter-index', ({ query }) => {
  if (!db.timers.some((t) => t.prompter_token === query.get('token'))) throw new ApiError(403, 'Invalid token', { detail: 'Invalid token' });
  return db.timers.map((t) => ({ entity_id: t.entity_id, display_name: t.display_name, link: `${import.meta.env.BASE_URL}prompter/${t.entity_id}?token=${t.prompter_token}` }));
});
get('/api/v1/public/overlay/teams', ({ query }) => {
  const ranks = new Map(db.ranks().map((r) => [r.team, r.rank]));
  const teams: Record<string, unknown> = {};
  for (const n of (query.get('teams') ?? '').split(',').filter(Boolean)) {
    const t = TEAMS.find((x) => x.number === n);
    teams[n] = { team_name: t?.name ?? teamName(n), organisation: t?.organisation ?? null, location: t?.location ?? null, country: 'GB', qual_rank: ranks.get(n) ?? null, bot_url: null, team_url: null, robot_name: t?.robot ?? null };
  }
  return { show_robot_name: false, teams };
});

// ── dispatch ──────────────────────────────────────────────────────────────

export async function demoFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(path, 'http://demo.invalid');
  for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const method = options.method ?? 'GET';
  const pathname = url.pathname;
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(pathname);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    const result = await r.h({ params, query: url.searchParams, body: options.formData ?? options.body ?? {} });
    // Responses are cloned so a page can never mutate the db through a cached query result.
    return (result === undefined ? undefined : structuredCloneSafe(result)) as T;
  }
  console.warn(`[demo] no fake endpoint for ${method} ${pathname}`);
  throw new ApiError(404, 'Not available in the demo', { detail: 'Not available in the demo' });
}

function structuredCloneSafe<T>(v: T): T {
  try {
    return JSON.parse(JSON.stringify(v)) as T;
  } catch {
    return v;
  }
}
