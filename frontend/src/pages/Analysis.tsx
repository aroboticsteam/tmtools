import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, Send, Undo2, Zap } from 'lucide-react';
import {
  useCaptureRecordings,
  useCaptureStatus,
  useMarkMoment,
  useReplayControl,
  useReplayPlay,
  useReplayState,
} from '../api/capture';
import { useCallIntegrationService, useIntegrations, useIntegrationState } from '../api/integrations';
import { useTeams } from '../api/teams';
import { usePermission } from '../hooks/usePermission';
import { useCan } from '../hooks/useCan';
import { useUiStore } from '../stores/ui';
import { useWsStore } from '../stores/ws';
import { useWebSocket } from '../hooks/useWebSocket';
import { useFieldSeed } from '../lib/fields';
import {
  DEFAULT_SETUP,
  MARK_LENGTHS,
  SPEEDS,
  findByNumber,
  loadSetup,
  momentPlayable,
  orderRecordings,
  pendingFromFields,
  recordingLabel,
  saveSetup,
  stepMatch,
  type DeskSetup,
} from '../lib/analysis';
import { Button } from '../components/ui/Button';
import { Card, PageHeader, Section } from '../components/ui/Card';
import { Badge, Chip } from '../components/ui/Badge';
import { SplitLayout } from '../components/ui/Layouts';
import { EmptyState } from '../components/ui/EmptyState';
import { Segmented, Tabs } from '../components/ui/Tabs';
import { MatchPlayer, type SeekRequest } from '../components/analysis/MatchPlayer';
import { Input, Label, Select } from '../components/ui/Input';
import type { CaptureRecording, ReplayAction, ReplayState } from '../types/api';

type Tab = 'stats' | 'match';

export function AnalysisPage() {
  const canView = usePermission('analysis:view');
  if (!canView) return <p className="text-sm text-vmd-textSubtle">You do not have access to the analysis desk.</p>;
  return <AnalysisDesk />;
}

function AnalysisDesk() {
  const canControl = usePermission('capture:control');
  const [tab, setTab] = useState<Tab>('match');
  const [setup, setSetup] = useState<DeskSetup>(() => loadSetup());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Which match the operator picked, so the choice survives a queued entry turning into its real recording.
  const [auto, setAuto] = useState(false); // the current pick was made by the desk, not the operator
  const [pickedMatch, setPickedMatch] = useState<{ type: string; number: string } | null>(null);
  const { data: recordings = [] } = useCaptureRecordings({ limit: 300 });
  // Matches TM has put on a field show up here straight away, before anything is recorded.
  useWebSocket('/ws/events');
  useFieldSeed(useCan()('integrations:read'));
  const currentMatches = useWsStore((s) => s.currentMatches);
  const ordered = useMemo(
    () => orderRecordings([...recordings, ...pendingFromFields(currentMatches, recordings)]),
    [recordings, currentMatches],
  );

  const updateSetup = (patch: Partial<DeskSetup>) => {
    const next = { ...setup, ...patch };
    setSetup(next);
    saveSetup(next);
  };

  // Follow the live recording unless the operator has picked another match.
  const { data: status } = useCaptureStatus();
  const liveId = status?.recording?.id ?? null;
  useEffect(() => {
    if (liveId && (!selectedId || auto)) {
      setSelectedId(liveId);
      const live = status?.recording;
      setPickedMatch(live ? { type: live.match_type, number: live.match_number } : null);
    }
  }, [liveId, selectedId, auto, status?.recording]);
  const selected =
    ordered.find((r) => r.id === selectedId) ??
    (pickedMatch ? ordered.find((r) => r.match_type === pickedMatch.type && r.match_number === pickedMatch.number) : null) ??
    null;
  const select = (id: string | null) => {
    setSelectedId(id);
    setAuto(false);
    const r = ordered.find((x) => x.id === id);
    setPickedMatch(r ? { type: r.match_type, number: r.match_number } : null);
  };
  // With nothing picked and nothing recording, show the first match waiting on a field.
  useEffect(() => {
    if (!selectedId && !liveId) {
      const next = ordered.find((r) => r.status === 'QUEUED');
      if (next) {
        setSelectedId(next.id);
        setPickedMatch({ type: next.match_type, number: next.match_number });
        setAuto(true);
      }
    }
  }, [ordered, selectedId, liveId]);

  return (
    <div>
      <PageHeader title="Analysis desk" subtitle="Pick a match, review the clip, send it to program." />
      <div className="mb-4">
        <Tabs
          tabs={[
            { id: 'match' as Tab, label: 'Match' },
            { id: 'stats' as Tab, label: 'Stats' },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>
      <div>
        {tab === 'stats' ? (
          <StatsTab recording={selected} />
        ) : (
          <MatchTab
            ordered={ordered}
            onSelect={select}
            recording={selected}
            setup={setup}
            onSetup={updateSetup}
            canControl={canControl}
            agentConnected={!!status?.connected}
            recordingNow={status?.recording ?? null}
          />
        )}
      </div>
    </div>
  );
}

function clock(sec: number | null | undefined): string {
  const t = Math.max(0, Math.floor(sec ?? 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** What is on program right now: the clip, a live progress bar and position reported by the replay page itself. */
function OnProgram({ replay, replayId, speed, canControl, onControl }: {
  replay: ReplayState;
  replayId: string;
  speed: number;
  canControl: boolean;
  onControl: (body: { action: ReplayAction; value?: number }) => void;
}) {
  const live = useWsStore((s) => s.replayStatus[replayId]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const offline = !live || !live.player;
  const stalled = !!live && live.player && !live.paused && !live.ended && now - live.at > 3000;
  // The page's own report wins while it is fresh; a silent or missing page falls back to what was last commanded.
  const fresh = !!live && live.player && now - live.at < 3000;
  const paused = fresh ? !!live.paused : !!replay.paused;
  const duration = live?.duration ?? 0;
  const position = live?.position ?? 0;
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  const state = live?.ended ? 'Finished' : paused ? 'Paused' : 'Playing';
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-vmd-border bg-white p-3 text-sm" aria-label="On program" data-testid="on-program">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-vmd-textMuted">
          On program: <span className="font-medium text-vmd-textStrong">{replay.label ?? 'Replay'}</span>
          <span className="mx-2" data-testid="on-program-state">{offline ? 'Waiting for the replay page' : stalled ? 'Stalled' : state}</span>
          at {live?.rate ?? replay.rate ?? speed}×
        </span>
        <Button disabled={!canControl} onClick={() => onControl({ action: paused ? 'resume' : 'pause' })}>
          {paused ? <Play size={16} /> : <Pause size={16} />}
          {paused ? 'Resume' : 'Pause'}
        </Button>
        <Button disabled={!canControl} onClick={() => onControl({ action: 'restart' })}>
          <RotateCcw size={16} /> Restart
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <div className="h-full bg-neutral-800" style={{ width: `${pct}%` }} />
        </div>
        <span className="tabular-nums text-xs text-vmd-textMuted" data-testid="on-program-time">{clock(position)} / {clock(duration)}</span>
      </div>
      {offline && <p className="text-xs text-vmd-textSubtle">No replay page is connected. Add <code>/replay/{replayId}</code> as a browser source (or open it) to see it play.</p>}
    </div>
  );
}

function StatsTab({ recording }: { recording: CaptureRecording | null }) {
  const { data: teams = [] } = useTeams(useCan()('teams:read'));
  if (!recording) return <EmptyState title="No match selected">Pick a match on the Match tab to see its teams.</EmptyState>;
  // Stats only: we never show predicted scores or win probabilities here.
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {recording.teams.map((number) => {
        const team = teams.find((t) => t.team_number.toUpperCase() === number.toUpperCase());
        const stats = team?.cached_stats ?? {};
        return (
          <Card key={number} aria-label={`Stats for ${number}`}>
            <h2 className="text-lg font-semibold text-vmd-textStrong">{number}</h2>
            <p className="mb-2 text-sm text-vmd-textMuted">{team?.robot_name ?? 'No robot name'}</p>
            {Object.keys(stats).length === 0 ? (
              <p className="text-sm text-vmd-textSubtle">No cached stats yet.</p>
            ) : (
              <dl className="grid grid-cols-2 gap-1 text-sm">
                {Object.entries(stats).map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-vmd-textMuted">{key}</dt>
                    <dd className="text-right text-vmd-text">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function MatchPicker({
  ordered,
  selected,
  onSelect,
}: {
  ordered: CaptureRecording[];
  selected: CaptureRecording | null;
  onSelect: (id: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const go = (r: CaptureRecording | null) => r && onSelect(r.id);
  return (
    <Section title="Match">
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Button aria-label="Previous match" onClick={() => go(stepMatch(ordered, selected?.id ?? null, -1))}>
            <ChevronLeft size={16} />
          </Button>
          <span className="min-w-0 flex-1 text-center text-lg font-semibold text-vmd-textStrong" data-testid="current-match">
            {selected ? recordingLabel(selected) : 'No match'}
          </span>
          <Button aria-label="Next match" onClick={() => go(stepMatch(ordered, selected?.id ?? null, 1))}>
            <ChevronRight size={16} />
          </Button>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go(findByNumber(ordered, query));
          }}
        >
          <Input aria-label="Go to match number" placeholder="Match #" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button type="submit">Go</Button>
        </form>
        {selected && (
          <div className="flex flex-wrap gap-1">
            {selected.status === 'QUEUED' && <Chip>Field {String((selected.alliances as { field?: unknown } | null)?.field ?? '?')}</Chip>}
            {selected.teams.map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

const MOMENT_STATUS: Record<string, { tone: 'ok' | 'warn' | 'danger'; label: string }> = {
  READY: { tone: 'ok', label: 'Ready' },
  ERROR: { tone: 'danger', label: 'Failed' },
};

function MatchTab({
  ordered,
  onSelect,
  recording,
  setup,
  onSetup,
  canControl,
  agentConnected,
  recordingNow,
}: {
  ordered: CaptureRecording[];
  onSelect: (id: string | null) => void;
  recording: CaptureRecording | null;
  setup: DeskSetup;
  onSetup: (patch: Partial<DeskSetup>) => void;
  canControl: boolean;
  agentConnected: boolean;
  recordingNow: CaptureRecording | null;
}) {
  const pushToast = useUiStore((s) => s.pushToast);
  const mark = useMarkMoment();
  const play = useReplayPlay(setup.replayId);
  const control = useReplayControl(setup.replayId);
  const { data: replay } = useReplayState(setup.replayId);
  const callService = useCallIntegrationService();
  const { data: integrations = [] } = useIntegrations(useCan()('integrations:read'));
  const obsList = integrations.filter((i) => i.domain === 'obs');
  const wledList = integrations.filter((i) => i.domain === 'wled');
  const [speed, setSpeed] = useState<number>(0.5); // speed for replays sent to program
  const isRecording = !!recordingNow;

  // Use the only OBS / WLED instance without making the operator pick it.
  const obsEntity = setup.obsEntity || (obsList.length === 1 ? obsList[0].entity_id : '');
  const wledEntity = setup.wledEntity || (wledList.length === 1 ? wledList[0].entity_id : '');
  const { data: obsState } = useIntegrationState(obsEntity || null);
  const onAir = typeof obsState?.state?.current_scene === 'string' ? (obsState.state.current_scene as string) : null;
  // The scene that was on air before the last replay, so "Back to program" returns to it.
  const [returnScene, setReturnScene] = useState<string | null>(null);

  const doMark = (seconds: number) =>
    mark.mutate(seconds, {
      onSuccess: () => pushToast(`Saved the last ${seconds} seconds`, 'success'),
      onError: (err) => pushToast(err instanceof Error ? err.message : 'Could not cut the clip', 'error'),
    });

  // Keyboard marks (ignored while typing in a field).
  useEffect(() => {
    if (!canControl) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
      const seconds = setup.keys[e.key];
      if (seconds) {
        e.preventDefault();
        mark.mutate(seconds, {
          onSuccess: () => pushToast(`Saved the last ${seconds} seconds`, 'success'),
          onError: (err) => pushToast(err instanceof Error ? err.message : 'Could not cut the clip', 'error'),
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canControl, setup.keys]);

  // A refused or failed OBS scene switch (e.g. the role lacks `video:control`) must not look like a dead button.
  const switchScene = (scene: string) => {
    if (!obsEntity) return;
    callService.mutate(
      { entityId: obsEntity, service: 'switch_scene', data: { scene_name: scene } },
      {
        onSuccess: () => pushToast(`OBS is now showing "${scene}"`, 'success'),
        onError: (err) =>
          pushToast(`Could not switch OBS to "${scene}": ${err instanceof Error ? err.message : 'unknown error'}`, 'error'),
      },
    );
  };

  const sendToProgram = (kind: 'moment' | 'recording', id: string) => {
    play.mutate(
      { kind, id, rate: speed },
      {
        onSuccess: () => {
          if (obsEntity && setup.replayScene) {
            if (onAir && onAir !== setup.replayScene) setReturnScene(onAir);
            switchScene(setup.replayScene);
          }
        },
        onError: (err) => pushToast(err instanceof Error ? err.message : 'Could not send to program', 'error'),
      },
    );
  };

  const backToProgram = () => {
    control.mutate({ action: 'stop' });
    const target = returnScene ?? (setup.programScene || null);
    if (obsEntity && target) {
      switchScene(target);
      setReturnScene(null);
    } else if (obsEntity) {
      pushToast('No program scene to return to. Set one under Setup.', 'error');
    }
  };

  const flashLed = () => {
    if (!wledEntity) return;
    callService.mutate(
      { entityId: wledEntity, service: 'flash', data: {} },
      { onError: (err) => pushToast(`LED flash failed: ${err instanceof Error ? err.message : 'unknown error'}`, 'error') },
    );
  };

  const speedOptions = SPEEDS.map((s) => ({ id: String(s), label: `${s}×` }));

  const cutPanel = (
    <section aria-label="Cut a clip from live" className="overflow-hidden rounded-xl border-2 border-neutral-900 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 pt-4">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${isRecording ? 'animate-pulse bg-red-600' : 'bg-neutral-300'}`} />
          <h2 className="text-[15px] font-semibold text-vmd-textStrong">Cut a clip from live</h2>
        </div>
        <span className="text-[13px] text-vmd-textSubtle">
          {isRecording ? `Saves the last few seconds of ${recordingLabel(recordingNow!)} and adds it to this match` : agentConnected ? 'Waiting for a match to start recording' : 'Capture agent offline'}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 px-3 pb-3 sm:gap-3 sm:px-4 sm:pb-4">
        {MARK_LENGTHS.map((s) => (
          <button
            key={s}
            type="button"
            aria-label={`Cut last ${s} seconds`}
            disabled={!canControl || !isRecording || mark.isPending}
            onClick={() => doMark(s)}
            className="flex h-[72px] items-center justify-between rounded-[10px] border border-neutral-900 bg-neutral-900 px-3 text-left sm:px-4 text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span>
              <span className="block text-2xl font-semibold leading-[30px] tracking-tight sm:text-[26px]">{s} s</span>
              <span className="block text-[11px] opacity-70 sm:text-xs">Last {s} s</span>
            </span>
            <kbd className="hidden h-6 w-6 sm:flex items-center justify-center rounded-md border border-white/40 text-xs">{Object.entries(setup.keys).find(([, v]) => v === s)?.[0] ?? ''}</kbd>
          </button>
        ))}
      </div>
    </section>
  );

  const [seek, setSeek] = useState<SeekRequest | null>(null);
  const player = (
    <>
      <MatchPlayer recording={recording} seek={seek} />
      {replay?.playing && <OnProgram replay={replay} replayId={setup.replayId} speed={speed} canControl={canControl} onControl={(body) => control.mutate(body)} />}
    </>
  );

  const moments = (
    <Section
      title="Moments in this match"
      action={
        <div aria-label="Program speed" title="Speed when sent to program">
          <Segmented
            options={speedOptions}
            value={String(speed)}
            onChange={(id) => {
              const s = Number(id);
              setSpeed(s);
              if (replay?.playing) control.mutate({ action: 'rate', value: s });
            }}
          />
        </div>
      }
    >
      {!recording || recording.moments.length === 0 ? (
        <EmptyState title="No moments yet">Cut a clip above and it shows up here.</EmptyState>
      ) : (
        <ul>
          {recording.moments.map((m) => {
            const st = MOMENT_STATUS[m.status] ?? { tone: 'warn' as const, label: 'Uploading…' };
            return (
              <li key={m.id} aria-label={`Moment ${m.number}`} className="flex flex-wrap items-center gap-3 border-b border-neutral-100 px-4 py-3 last:border-b-0">
                <div className="h-10 w-[72px] shrink-0 rounded-md bg-neutral-800" aria-hidden="true" />
                <div className="min-w-0 flex-1 basis-32">
                  <div className="font-medium text-vmd-textStrong">Moment {m.number}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-vmd-textSubtle">
                    <span>{m.length_s} s clip</span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                </div>
                {recording && recording.status === 'READY' && m.end_offset_ms != null && (
                  <Button
                    aria-label={`Preview moment ${m.number}`}
                    onClick={() => setSeek((prev) => ({ t: Math.max(0, m.end_offset_ms! / 1000 - m.length_s), n: (prev?.n ?? 0) + 1 }))}
                  >
                    <Play size={14} /> Preview
                  </Button>
                )}
                <Button
                  variant="primary"
                  className="w-full sm:w-auto"
                  disabled={!canControl || !momentPlayable(m.status) || play.isPending}
                  onClick={() => sendToProgram('moment', m.id)}
                  aria-label={`Send moment ${m.number} to program`}
                >
                  <Send size={14} /> Send to program
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {recording && recording.status === 'READY' && (
        <div className="border-t border-vmd-border p-3">
          <Button disabled={!canControl || play.isPending} onClick={() => sendToProgram('recording', recording.id)}>
            Send full match to program
          </Button>
        </div>
      )}
    </Section>
  );

  const aside = (
    <>
      <MatchPicker ordered={ordered} selected={recording} onSelect={onSelect} />
      <Section title="Program" action={obsEntity ? <Badge tone="ok">OBS connected</Badge> : <Badge tone="neutral">No OBS</Badge>}>
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-vmd-textSubtle">On air now</span>
            <span className="font-semibold text-vmd-textStrong">{onAir ?? '—'}</span>
          </div>
          <Button variant="primary" size="lg" disabled={!canControl} onClick={backToProgram}>
            <Undo2 size={18} /> Back to program
          </Button>
        </div>
      </Section>
      {wledEntity && (
        <Section title="Quick actions">
          <div className="flex flex-col gap-2 p-3">
            <Button className="justify-start" disabled={!canControl} onClick={flashLed}>
              <Zap size={16} /> Flash the LEDs
            </Button>
          </div>
        </Section>
      )}
      <details className="rounded-xl border border-vmd-border bg-white">
        <summary className="cursor-pointer px-4 py-3.5 text-[15px] font-semibold text-vmd-textStrong">Setup</summary>
        <div className="grid grid-cols-1 gap-3 border-t border-vmd-border p-4">
          <div>
            <Label>Replay player id</Label>
            <Input aria-label="Replay player id" value={setup.replayId} onChange={(e) => onSetup({ replayId: e.target.value.trim() || DEFAULT_SETUP.replayId })} />
          </div>
          <div>
            <Label>OBS instance</Label>
            <Select aria-label="OBS instance" value={obsEntity} onChange={(e) => onSetup({ obsEntity: e.target.value })}>
              <option value="">None</option>
              {obsList.map((i) => (<option key={i.entity_id} value={i.entity_id}>{i.display_name}</option>))}
            </Select>
          </div>
          <div>
            <Label>Replay scene</Label>
            <Input aria-label="Replay scene" value={setup.replayScene} onChange={(e) => onSetup({ replayScene: e.target.value })} />
          </div>
          <div>
            <Label>Fallback program scene</Label>
            <Input aria-label="Program scene" placeholder="Used if the previous scene is unknown" value={setup.programScene} onChange={(e) => onSetup({ programScene: e.target.value })} />
          </div>
          <div>
            <Label>WLED instance</Label>
            <Select aria-label="WLED instance" value={wledEntity} onChange={(e) => onSetup({ wledEntity: e.target.value })}>
              <option value="">None</option>
              {wledList.map((i) => (<option key={i.entity_id} value={i.entity_id}>{i.display_name}</option>))}
            </Select>
          </div>
          <p className="text-xs text-vmd-textSubtle">
            Add <code>/replay/{setup.replayId}</code> as a 1920×1080 browser source in the replay scene.
          </p>
        </div>
      </details>
    </>
  );

  return <SplitLayout main={<>{cutPanel}{player}{moments}</>} aside={aside} />;
}
