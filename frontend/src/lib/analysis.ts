import type { CaptureRecording } from '../types/api';
import type { UpcomingMatchPayload } from '../stores/ws';

/** Per-browser desk setup (which OBS/WLED instances, scene, key bindings). */
export interface DeskSetup {
  replayId: string;
  obsEntity: string;
  replayScene: string;
  programScene: string;
  wledEntity: string;
  /** Key → seconds. Defaults give one-handed marking during a match. */
  keys: Record<string, number>;
}

export const DEFAULT_SETUP: DeskSetup = {
  replayId: 'main',
  obsEntity: '',
  replayScene: 'Replay',
  programScene: '',
  wledEntity: '',
  keys: { '1': 3, '2': 5, '3': 10 },
};

export const MARK_LENGTHS = [3, 5, 10] as const;
export const SPEEDS = [0.25, 0.5, 0.75, 1] as const;
const STORAGE_KEY = 'analysis-desk-setup';

export function loadSetup(): DeskSetup {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETUP;
    const parsed = JSON.parse(raw) as Partial<DeskSetup>;
    return { ...DEFAULT_SETUP, ...parsed, keys: { ...DEFAULT_SETUP.keys, ...(parsed.keys ?? {}) } };
  } catch {
    return DEFAULT_SETUP;
  }
}

export function saveSetup(setup: DeskSetup): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(setup));
  } catch {
    /* storage unavailable: setup just isn't remembered */
  }
}

export function recordingLabel(r: Pick<CaptureRecording, 'match_type' | 'match_number'>): string {
  const type = r.match_type === 'QUAL' ? 'Q' : r.match_type;
  return `${type} ${r.match_number}`;
}

export function momentLabel(r: Pick<CaptureRecording, 'match_type' | 'match_number'>, n: number): string {
  return `${recordingLabel(r)} · moment ${n}`;
}

/** A match TM has put on a field that has no recording yet, shown in the desk as a QUEUED entry so it can be
 * picked (and its teams seen) before the recording starts. It is replaced by the real recording once that exists. */
export function pendingFromFields(
  currentMatches: Record<string, UpcomingMatchPayload>,
  recordings: Pick<CaptureRecording, 'match_type' | 'match_number'>[],
): CaptureRecording[] {
  const out: CaptureRecording[] = [];
  for (const [field, m] of Object.entries(currentMatches)) {
    if (field.includes('.') || m.matchNum === undefined || m.matchNum === null) continue;
    const type = String(m.round ?? 'QUAL').trim().toUpperCase() || 'QUAL';
    const number = String(m.matchNum);
    if (recordings.some((r) => r.match_type.toUpperCase() === type && r.match_number === number)) continue;
    const red = m.redTeams ?? [];
    const blue = m.blueTeams ?? [];
    out.push({
      id: `field-${field}`,
      match_key: `field:${field}:${type}:${number}`,
      match_type: type,
      match_number: number,
      teams: [...red, ...blue],
      alliances: { red, blue, field },
      status: 'QUEUED',
      // Sorts after every real recording (their started_at is a date), then by match number. A letter, as localeCompare ranks punctuation first.
      started_at: `zz${number.padStart(6, "0")}`,
      stopped_at: null,
      duration_s: null,
      size_bytes: null,
      error: null,
      moments: [],
    });
  }
  return out;
}

/** Recordings ordered oldest → newest, the order the arrows step through. */
export function orderRecordings(list: CaptureRecording[]): CaptureRecording[] {
  return [...list].sort((a, b) => a.started_at.localeCompare(b.started_at));
}

export function stepMatch(ordered: CaptureRecording[], currentId: string | null, delta: -1 | 1): CaptureRecording | null {
  if (ordered.length === 0) return null;
  const idx = ordered.findIndex((r) => r.id === currentId);
  if (idx === -1) return delta === 1 ? ordered[0] : ordered[ordered.length - 1];
  return ordered[Math.min(ordered.length - 1, Math.max(0, idx + delta))];
}

export function findByNumber(ordered: CaptureRecording[], query: string): CaptureRecording | null {
  const q = query.trim().toUpperCase().replace(/^Q\s*/, '');
  if (!q) return null;
  return [...ordered].reverse().find((r) => r.match_number.toUpperCase() === q) ?? null;
}

/** Whether the clip can be sent to program yet. */
export function momentPlayable(status: string): boolean {
  return status === 'READY';
}
