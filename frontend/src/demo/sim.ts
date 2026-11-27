/**
 * The demo's live behaviour: a match simulator for each field, fake integrations that react to service calls,
 * and an automations runtime that runs the (editable) automations against those fake integrations, so
 * the whole loop (TM event -> automation -> OBS/WLED/recording) works with no backend.
 */
import * as yaml from 'js-yaml';
import { queryClient } from '../api/queryClient';
import type { AutomationRun, Automation, CaptureRecording, FieldStateSnapshot, PrompterCue } from '../types/api';
import { audience, emit, fieldEvents, onEvent, publish, reportReplayStatus, setSocketHandlers, startRelay } from './bus';
import { FIELD_COUNT, MATCH_DURATION_S, scoreFor, type DemoMatch } from './data';
import { CLIP_URL, db, nowIso, uid } from './state';

const VEX = 'vex_tm.main';
const COUNTDOWN_S = 3;
const RESULTS_S = 16;

export const timerEntity = (field: number): string => `timer.field_${field}`;
const fieldOfTimer = (entity: string): number => db.timers.find((t) => t.entity_id === entity)?.field_id ?? 1;
const fieldTag = (field: number): string[] => [`field${field}`];

type Stage = 'idle' | 'assigned' | 'countdown' | 'running' | 'results';
interface FieldSim {
  id: number;
  match: DemoMatch | null;
  stage: Stage;
  /** Seconds spent in this stage (idle starts negative to stagger the fields). */
  t: number;
  aborted: boolean;
}
const fields: FieldSim[] = Array.from({ length: FIELD_COUNT }, (_, i) => ({ id: i + 1, match: null, stage: 'idle' as Stage, t: -i * 18, aborted: false }));
const sim = (field: number): FieldSim | undefined => fields.find((f) => f.id === field);

// ── payload helpers ───────────────────────────────────────────────────────

function matchPayload(f: FieldSim): Record<string, unknown> {
  const m = f.match!;
  return { fieldID: f.id, divisionId: 1, matchNum: m.n, round: 'QUAL', redTeams: m.red, blueTeams: m.blue, high_potential: false };
}

function timerPayload(f: FieldSim): Record<string, unknown> {
  switch (f.stage) {
    case 'countdown':
      return { phase: 'countdown', running: true, elapsed: f.t, remaining: Math.max(0, COUNTDOWN_S - f.t), duration: MATCH_DURATION_S };
    case 'running':
      return { phase: 'match_running', running: true, elapsed: f.t, remaining: Math.max(0, MATCH_DURATION_S - f.t), duration: MATCH_DURATION_S };
    case 'results':
      return { phase: f.aborted ? 'idle' : 'finished', running: false, elapsed: f.aborted ? 0 : MATCH_DURATION_S, remaining: 0, duration: MATCH_DURATION_S };
    default:
      return { phase: 'idle', running: false, elapsed: 0, remaining: MATCH_DURATION_S, duration: MATCH_DURATION_S };
  }
}

function cuesPayload(entity: string): { active: PrompterCue | null; next: PrompterCue | null } {
  const rows = db.cues.filter((c) => c.timer_entity_id === entity).sort((a, b) => a.sort_order - b.sort_order);
  const at = rows.findIndex((c) => c.is_active);
  return { active: at >= 0 ? rows[at] : null, next: at >= 0 ? rows[at + 1] ?? null : rows[0] ?? null };
}

/** The overlays that follow a field: those tagged `fieldN`, else field 1. */
function overlaysOfField(field: number): string[] {
  return db.overlays.filter((o) => (o.tags.find((t) => /^field\d+$/.test(t)) ?? 'field1') === `field${field}`).map((o) => o.entity_id);
}

function announceTimer(f: FieldSim, type = 'timer_state'): void {
  const entity = timerEntity(f.id);
  const payload = timerPayload(f);
  emit(type, entity, payload, fieldTag(f.id));
  publish('prompter', entity, { type, payload, timestamp: Date.now() / 1000 });
}

function announceMatchToPages(f: FieldSim): void {
  const payload = matchPayload(f);
  const entity = timerEntity(f.id);
  emit('upcoming_match', entity, payload, fieldTag(f.id));
  publish('prompter', entity, { type: 'upcoming_match', payload, timestamp: Date.now() / 1000 });
  for (const o of overlaysOfField(f.id)) publish('overlay', o, { type: 'upcoming_match', payload, timestamp: Date.now() / 1000 });
  const cues = cuesPayload(entity);
  emit('cues', entity, cues as unknown as Record<string, unknown>, fieldTag(f.id));
  publish('prompter', entity, { type: 'cues', payload: cues, timestamp: Date.now() / 1000 });
}

// ── the field state machine ───────────────────────────────────────────────

function nextMatch(field: number): DemoMatch | null {
  const taken = new Set(fields.map((x) => x.match?.n));
  return db.matches.find((m) => !m.score && m.field === field && !taken.has(m.n)) ?? null;
}

function assign(f: FieldSim): void {
  const m = nextMatch(f.id);
  if (!m) return;
  f.match = m;
  f.stage = 'assigned';
  f.t = 0;
  f.aborted = false;
  emit('fieldMatchAssigned', VEX, matchPayload(f), fieldTag(f.id));
  announceMatchToPages(f);
  announceTimer(f);
}

function beginCountdown(f: FieldSim): void {
  if (!f.match) return;
  emit('audienceDisplayChanged', VEX, { fieldID: f.id, display: 'IN_MATCH' }, fieldTag(f.id));
  f.stage = 'countdown';
  f.t = 0;
  announceTimer(f);
}

function beginMatch(f: FieldSim): void {
  f.stage = 'running';
  f.t = 0;
  emit('matchStarted', VEX, { fieldID: f.id, matchNum: f.match?.n }, fieldTag(f.id));
  announceTimer(f, 'timer_started');
}

function endMatch(f: FieldSim, aborted: boolean): void {
  f.aborted = aborted;
  announceTimer(f, aborted ? 'timer_stopped' : 'timer_finished');
  emit('matchStopped', VEX, { fieldID: f.id, matchNum: f.match?.n }, fieldTag(f.id));
  f.stage = 'results';
  f.t = 0;
}

function clearField(f: FieldSim): void {
  f.stage = 'idle';
  f.t = 0;
  f.match = null;
  f.aborted = false;
  announceTimer(f);
  for (const o of overlaysOfField(f.id)) publish('overlay', o, { type: 'match_cleared', payload: {}, timestamp: Date.now() / 1000 });
}

function tick(): void {
  for (const f of fields) {
    f.t += 1;
    switch (f.stage) {
      case 'idle':
        if (f.t >= 1) assign(f);
        break;
      case 'assigned':
        if (f.t >= 10) beginCountdown(f);
        break;
      case 'countdown':
        announceTimer(f);
        if (f.t >= COUNTDOWN_S) beginMatch(f);
        break;
      case 'running':
        announceTimer(f);
        if (f.t >= MATCH_DURATION_S) endMatch(f, false);
        break;
      case 'results':
        if (f.t === 3 && !f.aborted && f.match) {
          const score = scoreFor();
          f.match.score = score;
          db.played += 1;
          emit('scoreUpdated', VEX, { fieldID: f.id, matchNum: f.match.n, red: score[0], blue: score[1] }, fieldTag(f.id));
          emit('audienceDisplayChanged', VEX, { fieldID: f.id, display: 'RESULTS' }, fieldTag(f.id));
        }
        if (f.t >= RESULTS_S) clearField(f);
        break;
    }
  }
}

export function startField(field: number): void {
  const f = sim(field);
  if (!f) return;
  if (f.stage === 'idle') assign(f);
  if (f.stage === 'assigned') beginCountdown(f);
}
export function stopField(field: number): void {
  const f = sim(field);
  if (f && (f.stage === 'countdown' || f.stage === 'running')) endMatch(f, true);
}
export function resetField(field: number): void {
  const f = sim(field);
  if (!f) return;
  if (f.stage === 'countdown' || f.stage === 'running') endMatch(f, true);
  clearField(f);
  f.t = -2;
}
export function queueNextMatch(field: number): void {
  const f = sim(field);
  if (f && f.stage === 'idle') assign(f);
}

export function fieldSnapshot(): FieldStateSnapshot {
  const matches: FieldStateSnapshot['matches'] = {};
  for (const f of fields) {
    if (f.match) matches[String(f.id)] = { type: 'fieldMatchAssigned', entity_id: VEX, timestamp: Date.now() / 1000, payload: matchPayload(f) };
  }
  return { matches, events: { ...fieldEvents }, audience: { ...audience } };
}

export function timerLive(entity: string): Record<string, unknown> {
  const f = sim(fieldOfTimer(entity));
  return f ? timerPayload(f) : {};
}

// ── fake integrations ─────────────────────────────────────────────────────

function logCall(entity: string, type: string, payload: Record<string, unknown>): void {
  const log = (db.debugLog[entity] ??= []);
  log.unshift({ timestamp: Date.now() / 1000, type, payload });
  log.length = Math.min(log.length, 100);
}

export function captureStatus(): { connected: boolean; agent: Record<string, unknown> | null; recording: CaptureRecording | null } {
  const rec = db.recordings.find((r) => r.status === 'RECORDING') ?? null;
  return { connected: true, agent: { agent_id: 'demo-laptop', state: rec ? 'recording' : 'idle' }, recording: rec };
}

function startRecording(fieldId: number): Record<string, unknown> {
  if (db.recordings.some((r) => r.status === 'RECORDING')) return { ok: true, already_recording: true };
  const m = sim(fieldId)?.match ?? sim(1)?.match ?? db.matches[db.played] ?? db.matches[0];
  const rec: CaptureRecording = {
    id: `rec-${uid()}`, match_key: `1:1:QUAL:1:${m.n}`, match_type: 'QUAL', match_number: String(m.n), teams: [...m.red, ...m.blue],
    alliances: { red: m.red, blue: m.blue }, status: 'RECORDING', started_at: nowIso(), stopped_at: null, duration_s: null, size_bytes: null, error: null, moments: [],
  };
  db.recordings.unshift(rec);
  void queryClient.invalidateQueries({ queryKey: ['capture'] });
  return { ok: true, recording_id: rec.id };
}

function stopRecording(): Record<string, unknown> {
  const rec = db.recordings.find((r) => r.status === 'RECORDING');
  if (!rec) return { ok: true, recording: false };
  rec.status = 'STOPPED';
  rec.stopped_at = nowIso();
  rec.duration_s = Math.max(1, Math.round((Date.parse(rec.stopped_at) - Date.parse(rec.started_at)) / 1000));
  setTimeout(() => {
    rec.status = 'READY';
    rec.size_bytes = rec.duration_s! * 600_000;
    void queryClient.invalidateQueries({ queryKey: ['capture'] });
  }, 2500);
  void queryClient.invalidateQueries({ queryKey: ['capture'] });
  return { ok: true, recording_id: rec.id };
}

export function markMoment(lengthS: number): void {
  const rec = db.recordings.find((r) => r.status === 'RECORDING');
  if (!rec) throw Object.assign(new Error('Not recording'), { status: 409 });
  const moment: (typeof rec.moments)[number] = { id: `mom-${uid()}`, number: rec.moments.length + 1, length_s: lengthS, status: 'PROCESSING', end_offset_ms: Date.now() - Date.parse(rec.started_at), ready_ms: null, requested_at: nowIso(), error: null };
  rec.moments.push(moment);
  setTimeout(() => {
    moment.status = 'READY';
    moment.ready_ms = 1800;
    void queryClient.invalidateQueries({ queryKey: ['capture'] });
  }, 1800);
}
export { stopRecording as stopCurrentRecording };

export async function callService(service: string, target: string | undefined, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const [domain, name] = service.split('.');
  const entity = target ?? db.integrations.find((i) => i.domain === domain)?.entity_id;
  const inst = db.integrations.find((i) => i.entity_id === entity);
  if (!inst) throw new Error(`No integration "${target ?? domain}"`);
  if (inst.domain !== domain) throw new Error(`${inst.entity_id} is a ${inst.domain} integration, not ${domain}`);
  if (!inst.enabled) throw new Error(`${inst.display_name} is disabled`);
  if (inst.status === 'DISCONNECTED') throw new Error(`${inst.display_name} is not connected`);
  logCall(inst.entity_id, 'service_call', { service, ...data });
  const st = (db.integrationState[inst.entity_id] ??= {});
  const num = (v: unknown): number | undefined => (v === undefined || v === '' ? undefined : Number(v));
  switch (`${domain}.${name}`) {
    case 'obs.switch_scene':
      st.current_scene = String(data.scene_name ?? data.scene);
      break;
    case 'wled.set_power':
      st.on = data.on === undefined ? true : data.on === true || data.on === 'true';
      break;
    case 'wled.set_brightness':
      st.brightness = num(data.brightness);
      st.on = true;
      break;
    case 'wled.set_color':
      st.color = data.color;
      st.on = true;
      break;
    case 'wled.set_preset':
      st.preset = num(data.preset);
      break;
    case 'zeros.set_preset':
      st.last_preset = data.preset_id ?? data.preset_name ?? null;
      break;
    case 'atem.switch_input':
      st.program = num(data.input_index);
      break;
    case 'atem.set_preview':
      st.preview = num(data.input_index);
      break;
    case 'ptz.recall_preset':
      st.preset = num(data.preset);
      break;
    case 'ptz.home':
      st.preset = 0;
      break;
    case 'capture.start_recording':
      return startRecording(Number(data.field_id) || Number(states(VEX, 'current_field')) || 1);
    case 'capture.stop_recording':
      return stopRecording();
    case 'capture.mark_moment':
      markMoment(num(data.seconds) ?? 10);
      break;
    case 'vex_tm.start_match':
      startField(Number(states(VEX, 'current_field')) || 1);
      break;
    case 'vex_tm.end_early':
    case 'vex_tm.abort':
      stopField(Number(states(VEX, 'current_field')) || 1);
      break;
    case 'vex_tm.reset':
      resetField(Number(states(VEX, 'current_field')) || 1);
      break;
    case 'vex_tm.queue_next_match':
      queueNextMatch(Number(states(VEX, 'current_field')) || 1);
      break;
    case 'vex_tm.set_audience_display':
      emit('audienceDisplayChanged', VEX, { fieldID: Number(states(VEX, 'current_field')) || 1, display: String(data.display) });
      break;
    default:
      break; // osc, artnet, spotify, the rest of the services: accepted and logged
  }
  return { ok: true };
}

// ── automations runtime ───────────────────────────────────────────────────

interface Ctx {
  trigger: { event_type: string; entity_id: string; payload: Record<string, unknown> };
}

function states(entity: string, attr?: string): unknown {
  const s = db.integrationState[entity];
  return attr ? s?.[attr] : s;
}

function evalExpr(expr: string, ctx: Ctx): unknown {
  try {
    // The expressions are the demo user's own `{{ }}` templates, evaluated in their own browser tab.
    return new Function('trigger', 'states', `"use strict"; return (${expr});`)(ctx.trigger, states);
  } catch {
    return undefined;
  }
}

function render(value: unknown, ctx: Ctx): unknown {
  if (typeof value === 'string') {
    const whole = /^\s*\{\{([\s\S]*)\}\}\s*$/.exec(value);
    if (whole) return evalExpr(whole[1], ctx);
    return value.replace(/\{\{([\s\S]+?)\}\}/g, (_m, e: string) => String(evalExpr(e, ctx) ?? ''));
  }
  if (Array.isArray(value)) return value.map((v) => render(v, ctx));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, render(v, ctx)]));
  return value;
}

function loadList(text: string | null): Record<string, unknown>[] {
  if (!text) return [];
  try {
    const v = yaml.load(text);
    const list = Array.isArray(v) ? v : v ? [v] : [];
    return list.map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : { condition: x }));
  } catch {
    return [];
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface ActionResult {
  status: 'success' | 'failed';
  failed_action_index: number | null;
  error: string | null;
  actions_executed: number;
}

/** Run an action list: services, `delay:` and `script:` steps. Stops at the first failure like the real engine. */
export async function runActions(actionYaml: string, ctx: Ctx, depth = 0): Promise<ActionResult> {
  const actions = loadList(actionYaml);
  let done = 0;
  for (let i = 0; i < actions.length; i++) {
    const a = render(actions[i], ctx) as Record<string, unknown>;
    try {
      if (a.delay !== undefined) {
        await sleep(Math.min(5000, Number(a.delay) * (Number(a.delay) > 100 ? 1 : 1000) || 0));
      } else if (typeof a.script === 'string') {
        const s = db.scripts.find((x) => x.id === a.script || x.name === a.script);
        if (!s) throw new Error(`Unknown script ${a.script}`);
        if (depth > 3) throw new Error('Scripts nested too deeply');
        const r = await runActions(s.action_yaml, ctx, depth + 1);
        if (r.status === 'failed') throw new Error(r.error ?? 'script failed');
      } else if (typeof a.service === 'string') {
        if (!a.service.startsWith('persistent_notification.')) {
          await callService(a.service, typeof a.target === 'string' ? a.target : undefined, (a.data as Record<string, unknown>) ?? {});
        }
      } else {
        throw new Error('Unknown action');
      }
      done += 1;
    } catch (e) {
      return { status: 'failed', failed_action_index: i, error: e instanceof Error ? e.message : String(e), actions_executed: done };
    }
  }
  return { status: 'success', failed_action_index: null, error: null, actions_executed: done };
}

export async function execAutomation(a: Automation, ctx: Ctx): Promise<ActionResult> {
  const result = await runActions(a.action_yaml, ctx);
  const run: AutomationRun = {
    id: uid(), automation_id: a.id, triggered_at: nowIso(), trigger_event: ctx.trigger as unknown as Record<string, unknown>,
    status: result.status, failed_action_index: result.failed_action_index, error: result.error, created_at: nowIso(),
  };
  db.runs.unshift(run);
  a.last_triggered_at = run.triggered_at;
  emit('automation_executed', a.id, { automation_id: a.id, alias: a.alias, status: result.status });
  void queryClient.invalidateQueries({ queryKey: ['automations'] });
  return result;
}

function onBusEvent(msg: { type: string; entity_id: string; entity_tags: string[]; payload: Record<string, unknown> }): void {
  if (msg.type === 'automation_executed') return;
  const fid = msg.payload.fieldID;
  if (fid !== undefined && fid !== null) (db.integrationState[VEX] ??= {}).current_field = Number(fid);
  const ctx: Ctx = { trigger: { event_type: msg.type, entity_id: msg.entity_id, payload: msg.payload } };
  for (const a of db.automations) {
    if (!a.enabled) continue;
    const hit = loadList(a.trigger_yaml).some(
      (t) => t.platform === 'state' && t.event_type === msg.type && (!t.entity_id || t.entity_id === msg.entity_id) && (!t.tag || msg.entity_tags.includes(String(t.tag))),
    );
    if (!hit) continue;
    const ok = loadList(a.condition_yaml).every((c) => {
      const v = render(c.condition ?? c.value_template ?? c, ctx);
      return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
    });
    if (ok) void execAutomation(a, ctx);
  }
}

// ── replay + public sockets ───────────────────────────────────────────────

export function replayPlay(replayId: string, body: { kind: 'moment' | 'recording'; id: string; rate?: number; loop?: boolean }): void {
  let label = 'Replay';
  for (const r of db.recordings) {
    if (body.kind === 'recording' && r.id === body.id) label = `Q${r.match_number}`;
    const mom = r.moments.find((m) => m.id === body.id);
    if (body.kind === 'moment' && mom) label = `Q${r.match_number} moment ${mom.number}`;
  }
  const rate = body.rate ?? 0.5;
  db.replay = { playing: true, paused: false, rate, label, loop: !!body.loop };
  publish('replay', replayId, { type: 'play', url: CLIP_URL, rate, loop: !!body.loop, label, paused: false });
}

export function replayControl(replayId: string, body: { action: string; value?: number }): void {
  const r = db.replay;
  if (body.action === 'pause') r.paused = true;
  if (body.action === 'resume' || body.action === 'restart') r.paused = false;
  if (body.action === 'rate' && body.value) r.rate = body.value;
  if (body.action === 'stop') db.replay = { playing: false };
  publish('replay', replayId, { type: body.action, value: body.value });
}

export function roomNotice(rooms: string[] | null, notice: { title: string; message: string; modal: boolean }): number {
  const targets = db.rooms.filter((r) => !rooms || rooms.includes(r.slug));
  for (const r of targets) publish('room', r.slug, { type: 'notice', id: uid(), duration: 30, ...notice });
  return targets.length;
}

export function showTeam(overlayEntity: string, team: string): void {
  publish('overlay', overlayEntity, { type: 'show_team', payload: { team }, timestamp: Date.now() / 1000 });
}

setSocketHandlers(
  (kind, id, deliver) => {
    const ts = Date.now() / 1000;
    if (kind === 'prompter') {
      const f = sim(fieldOfTimer(id));
      if (!f) return;
      deliver({ type: 'timer_state', payload: timerPayload(f), timestamp: ts });
      deliver({ type: 'cues', payload: cuesPayload(id), timestamp: ts });
      if (f.match) deliver({ type: 'upcoming_match', payload: matchPayload(f), timestamp: ts });
    } else if (kind === 'overlay') {
      const f = fields.find((x) => overlaysOfField(x.id).includes(id) && x.match && x.stage !== 'idle');
      if (f) deliver({ type: 'upcoming_match', payload: matchPayload(f), timestamp: ts });
    } else if (kind === 'replay' && db.replay.playing) {
      deliver({ type: 'play', url: CLIP_URL, rate: db.replay.rate ?? 0.5, loop: !!db.replay.loop, label: db.replay.label ?? '', paused: !!db.replay.paused });
    }
  },
  (kind, id, data) => {
    const m = data as { type?: string } & Record<string, unknown>;
    if (kind === 'prompter' && m?.type === 'start_countdown') startField(fieldOfTimer(id));
    if (kind === 'replay' && m?.type === 'status') {
      const { type: _t, ...rest } = m;
      reportReplayStatus(id, { ...rest, player: true });
    }
  },
);

let started = false;
export function startSimulation(): void {
  if (started) return;
  started = true;
  startRelay();
  onEvent(onBusEvent);
  setInterval(tick, 1000);
}
