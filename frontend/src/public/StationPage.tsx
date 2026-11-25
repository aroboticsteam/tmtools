import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { CRITICAL_SECONDS, WARN_SECONDS, currentAgendaIndex, fmtClock } from '../lib/stationClock';
import { usePageChrome } from './usePageChrome';
import { usePublicSocket } from './usePublicSocket';
import './screens.css';

const LABELS: Record<string, string> = {
  messages: 'Messages',
  countdown: 'Next match',
  display: 'Screens',
  timer: 'Timer',
  agenda_day: 'Day agenda',
  agenda_finals: 'Finals agenda',
};

const DISPLAYS: [string, string][] = [
  ['MATCH_RESULTS', 'Results'], ['RANKINGS', 'Rankings'], ['SKILLS_RANKINGS', 'Skills rankings'], ['SCHEDULE', 'Schedule'],
  ['MATCH_PREVIEW', 'Match preview'], ['IN_MATCH', 'In match'], ['ALLIANCE_SELECTION', 'Alliance selection'],
  ['ELIMINATION_BRACKET', 'Elimination bracket'], ['SKILLS', 'Skills'], ['SEASON', 'Season'], ['LOGO', 'Logo'], ['BLANK', 'Blank'],
];

interface TimerState {
  entity_id: string;
  label?: string;
  phase: string;
  running?: boolean;
  elapsed: number;
  duration_s: number;
}
interface Station {
  name: string;
  screen: string;
  screens: string[];
  timer?: TimerState | null;
  server_time?: number;
  last_message?: { id: string; text: string; sent_at: number } | null;
}
interface Msg { id?: string; text: string; flash: boolean; sent_at: number }
interface TeamInfo { team_number: string; team_name?: string; organisation?: string; location?: string; qual_rank?: number | null; skills_rank?: number | null }
interface NextMatch { available: boolean; label: string; division?: string; scheduled_at?: number | null; red: TeamInfo[]; blue: TeamInfo[] }
interface AgendaItem { start_time: string; end_time?: string | null; title: string; details?: string | null }

class StationError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(String(status));
    this.status = status;
    this.detail = detail;
  }
}

const fmtTime = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** iPad station page (`/station/{slug}`): messages, next-match countdown, screens, timer, agendas. */
export function StationPage() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const key = params.get('k') || '';
  const tokenStore = `station-token-${slug}`;
  const [token, setToken] = useState(() => {
    try {
      return sessionStorage.getItem(tokenStore) || '';
    } catch {
      return '';
    }
  });
  const [gate, setGate] = useState<'pin' | 'key' | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [station, setStation] = useState<Station | null>(null);
  const [screen, setScreen] = useState('messages');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [flashing, setFlashing] = useState<string | null>(null);
  const [next, setNext] = useState<NextMatch | null>(null);
  const [agenda, setAgenda] = useState<Record<string, AgendaItem[]>>({});
  const [timer, setTimerState] = useState<TimerState | null>(null);
  const [timerAt, setTimerAt] = useState(0);
  const [offset, setOffset] = useState(0);
  const [display, setDisplay] = useState('');
  const [displayStatus, setDisplayStatus] = useState('');
  const [, setTick] = useState(0);
  const stationRef = useRef<Station | null>(null);
  stationRef.current = station;
  const screenRef = useRef(screen);
  screenRef.current = screen;

  usePageChrome({
    title: station?.name ?? 'Station',
    body: { background: '#0f1115' },
    meta: { 'apple-mobile-web-app-capable': 'yes' },
  });

  const base = `/api/v1/public/stations/${encodeURIComponent(slug)}`;
  const headers = useCallback(
    (extra?: Record<string, string>) => {
      const h: Record<string, string> = { ...(extra ?? {}) };
      if (key) h['X-Station-Key'] = key;
      if (token) h['X-Station-Token'] = token;
      return h;
    },
    [key, token],
  );
  const api = useCallback(
    async <T,>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
      const res = await fetch(base + path, {
        method: init.method,
        headers: headers(init.body !== undefined ? { 'content-type': 'application/json' } : undefined),
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      if (res.ok) return (res.status === 204 ? null : await res.json()) as T;
      const b = (await res.json().catch(() => ({}))) as { detail?: unknown };
      throw new StationError(res.status, b?.detail);
    },
    [base, headers],
  );

  const handleAuthError = useCallback(
    (e: unknown): boolean => {
      if (e instanceof StationError && e.status === 401) {
        if (e.detail === 'pin') {
          setToken('');
          try {
            sessionStorage.removeItem(tokenStore);
          } catch {
            /* storage blocked */
          }
        }
        setGate(e.detail === 'pin' ? 'pin' : 'key');
        return true;
      }
      return false;
    },
    [tokenStore],
  );

  const loadNext = useCallback(() => {
    api<NextMatch>('/next-match').then(setNext).catch(() => undefined);
  }, [api]);
  const loadAgenda = useCallback(
    (scope: string) => {
      api<AgendaItem[]>(`/agenda?scope=${scope}`).then((a) => setAgenda((prev) => ({ ...prev, [scope]: a }))).catch(() => undefined);
    },
    [api],
  );

  const goScreen = useCallback(
    (s: string, st?: Station | null) => {
      const available = st ?? stationRef.current;
      if (!available || !available.screens.includes(s)) return;
      setScreen(s);
      if (s === 'countdown') loadNext();
      if (s === 'agenda_day') loadAgenda('day');
      if (s === 'agenda_finals') loadAgenda('finals');
    },
    [loadNext, loadAgenda],
  );

  const setTimer = useCallback((t: TimerState | null | undefined, serverTime?: number) => {
    if (!t) return;
    setTimerState((prev) => (prev && prev.entity_id === t.entity_id && !t.label ? { ...t, label: prev.label } : t));
    if (serverTime) setOffset(serverTime - Date.now() / 1000);
    setTimerAt(serverTime || Date.now() / 1000 + offset);
  }, [offset]);

  const load = useCallback(async () => {
    const st = await api<Station>('');
    setStation(st);
    setTimerState(st.timer ?? null);
    if (st.server_time) {
      setOffset(st.server_time - Date.now() / 1000);
      setTimerAt(st.server_time);
    }
    if (st.last_message) {
      const lm = st.last_message;
      setMessages((prev) => (prev.length ? prev : [{ id: lm.id, text: lm.text, flash: false, sent_at: lm.sent_at }]));
    }
    goScreen(st.screen, st);
  }, [api, goScreen]);

  // Initial load (and again after unlocking with a PIN).
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let live = true;
    load().then(() => live && setGate(null)).catch((e) => {
      if (!live) return;
      if (!handleAuthError(e)) setUnknown(true);
    });
    return () => {
      live = false;
    };
  }, [load, handleAuthError, reloadKey]);

  const onMessage = useCallback(
    (raw: unknown) => {
      const m = raw as { type?: string; id?: string; text?: string; flash?: boolean; sent_at?: number; screen?: string; timer?: TimerState; server_time?: number };
      if (m.type === 'message') {
        setMessages((prev) => {
          if (m.id && prev.some((x) => x.id === m.id)) return prev;
          return [{ id: m.id, text: m.text ?? '', flash: !!m.flash, sent_at: m.sent_at ?? Date.now() / 1000 }, ...prev];
        });
        if (m.flash) setFlashing(m.id ?? null);
        setScreen('messages'); // a new message always takes the screen
      } else if (m.type === 'screen' && m.screen) goScreen(m.screen);
      else if (m.type === 'timer') setTimer(m.timer, m.server_time);
    },
    [goScreen, setTimer],
  );

  const blocked = gate !== null || unknown;
  const auth = (key ? `?k=${encodeURIComponent(key)}` : '') + (token ? `${key ? '&' : '?'}t=${encodeURIComponent(token)}` : '');
  const { status } = usePublicSocket(blocked || !station ? null : `/ws/station/${encodeURIComponent(slug)}${auth}`, onMessage, {
    ping: true,
    onOpen: () => undefined,
  });

  // Re-sync state after a reconnect.
  const wasLive = useRef(false);
  useEffect(() => {
    if (status === 'live' && wasLive.current) load().catch(handleAuthError);
    if (status === 'live') wasLive.current = true;
  }, [status, load, handleAuthError]);

  useEffect(() => {
    const clock = setInterval(() => setTick((t) => t + 1), 250);
    const timerSync = setInterval(() => {
      if (screenRef.current === 'timer') api<Station>('').then((st) => st.timer && setTimer(st.timer, st.server_time)).catch(() => undefined);
    }, 5000);
    const slow = setInterval(() => {
      if (screenRef.current === 'countdown') loadNext();
    }, 30000);
    return () => {
      clearInterval(clock);
      clearInterval(timerSync);
      clearInterval(slow);
    };
  }, [api, setTimer, loadNext]);

  if (gate === 'pin') {
    return (
      <div className="pub-screen station-page">
        <main>
          <PinGate
            slug={slug}
            headers={headers}
            onUnlocked={(t) => {
              setToken(t);
              try {
                sessionStorage.setItem(tokenStore, t);
              } catch {
                /* storage blocked */
              }
              setReloadKey((k) => k + 1);
            }}
          />
        </main>
      </div>
    );
  }
  if (gate === 'key') {
    return (
      <div className="pub-screen station-page">
        <main>
          <div className="gate"><p>This station link is no longer valid. Ask the desk for a new one.</p></div>
        </main>
      </div>
    );
  }

  const latest = messages[0];
  const elapsed = (() => {
    if (!timer) return null;
    const since = timer.running ? Math.max(0, Date.now() / 1000 + offset - timerAt) : 0;
    return timer.elapsed + since;
  })();

  return (
    <div className="pub-screen station-page">
      <header>
        <h1>{station?.name ?? 'Station'}</h1>
        <span className="status" id="status">{status === 'live' ? 'live' : status === 'connecting' ? 'connecting…' : 'reconnecting…'}</span>
      </header>
      <nav>
        {station?.screens.map((s) => (
          <button key={s} type="button" className={s === screen ? 'active' : ''} onClick={() => goScreen(s)}>
            {LABELS[s] || s}
          </button>
        ))}
      </nav>
      <main>
        {unknown ? <div className="empty">Unknown station</div> : null}
        {!unknown && screen === 'messages' ? (
          <>
            {latest ? (
              <>
                <MessageBox m={latest} big flashing={flashing === latest.id} />
                {flashing && flashing === latest.id ? (
                  <button type="button" className="ack" onClick={() => setFlashing(null)}>Got it</button>
                ) : null}
                {messages.length > 1 ? (
                  <div className="history">
                    {messages.slice(1, 15).map((m, i) => <MessageBox key={m.id ?? i} m={m} />)}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="empty">No messages yet</div>
            )}
            <Compose send={(text) => api('/messages', { method: 'POST', body: { text } })} />
          </>
        ) : null}
        {!unknown && screen === 'countdown' ? <Countdown next={next} /> : null}
        {!unknown && screen === 'display' ? (
          <>
            <div className="label">Audience screens</div>
            <div className="dgrid">
              {DISPLAYS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={display === id ? 'active' : ''}
                  onClick={() => {
                    setDisplayStatus('Switching…');
                    api('/audience-display', { method: 'POST', body: { display: id } })
                      .then(() => {
                        setDisplay(id);
                        setDisplayStatus(`Showing: ${label}`);
                      })
                      .catch((e: StationError) =>
                        setDisplayStatus(e.status === 503 ? 'Tournament Manager is not connected' : e.status === 429 ? 'Slow down a moment' : 'Could not change the screen'),
                      );
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="dstatus">{displayStatus}</div>
          </>
        ) : null}
        {!unknown && screen === 'timer' ? <TimerScreen timer={timer} elapsed={elapsed} /> : null}
        {!unknown && screen.startsWith('agenda_') ? <Agenda items={agenda[screen === 'agenda_day' ? 'day' : 'finals']} /> : null}
      </main>
    </div>
  );
}

function MessageBox({ m, big, flashing }: { m: Msg; big?: boolean; flashing?: boolean }) {
  return (
    <div className={`msg${m.flash && big && flashing ? ' flash' : ''}`}>
      <div className="text">{m.text}</div>
      <div className="when">{fmtTime(m.sent_at)}</div>
    </div>
  );
}

function Compose({ send }: { send: (text: string) => Promise<unknown> }) {
  const [text, setText] = useState('');
  const [label, setLabel] = useState('Send');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try {
      await send(t);
      setText('');
      setLabel('Sent ✓');
    } catch {
      setLabel('Failed – retry');
    }
    setTimeout(() => {
      setBusy(false);
      setLabel('Send');
    }, 1500);
  };
  return (
    <form className="compose" onSubmit={submit}>
      <input placeholder="Message the desk…" maxLength={500} enterKeyHint="send" value={text} onChange={(e) => setText(e.target.value)} />
      <button type="submit" disabled={busy}>{label}</button>
    </form>
  );
}

function TeamCard({ t, cls }: { t: TeamInfo; cls: string }) {
  const meta = [t.organisation, t.location].filter(Boolean).join(' · ');
  return (
    <div className={`team ${cls}`}>
      <div className="num">{(t.qual_rank != null ? `#${t.qual_rank}  ` : '') + t.team_number}</div>
      {t.team_name ? <div>{t.team_name}</div> : null}
      {meta ? <div className="meta">{meta}</div> : null}
      {t.skills_rank != null ? <div className="meta">Skills rank {t.skills_rank}</div> : null}
    </div>
  );
}

function Countdown({ next }: { next: NextMatch | null }) {
  if (!next || !next.available) return <div className="empty">No upcoming match</div>;
  let clock = '--:--';
  let late = false;
  if (next.scheduled_at) {
    const secs = Math.round(next.scheduled_at - Date.now() / 1000);
    late = secs < 0;
    const a = Math.abs(secs);
    const h = Math.floor(a / 3600);
    const m = Math.floor((a % 3600) / 60);
    clock = `${late ? '-' : ''}${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(a % 60).padStart(2, '0')}`;
  }
  return (
    <div className="count">
      <div className="label">
        {next.label}
        {next.division ? `  ·  Division ${next.division}` : ''}
        {next.scheduled_at ? `  ·  ${fmtTime(next.scheduled_at)}` : ''}
      </div>
      <div className={`clock${late ? ' late' : ''}`} id="clock">{clock}</div>
      <div className="teams">
        {next.red.map((t) => <TeamCard key={`r${t.team_number}`} t={t} cls="red" />)}
        {next.blue.map((t) => <TeamCard key={`b${t.team_number}`} t={t} cls="blue" />)}
      </div>
    </div>
  );
}

function TimerScreen({ timer, elapsed }: { timer: TimerState | null; elapsed: number | null }) {
  if (!timer || elapsed === null) return <div className="empty">No timer selected</div>;
  let cls = 'neutral';
  let shown: number;
  let text = '';
  if (timer.phase === 'countdown') {
    shown = Math.max(0, timer.duration_s - elapsed);
    cls = shown <= CRITICAL_SECONDS ? 'red' : shown <= WARN_SECONDS ? 'amber' : 'green';
  } else if (timer.phase === 'match_running') {
    shown = elapsed;
    cls = 'green';
    text = 'Match in progress';
  } else if (timer.phase === 'match_complete') {
    shown = elapsed;
    text = 'Match complete';
  } else {
    shown = timer.duration_s;
    text = 'Ready';
  }
  return (
    <div className="timer">
      <div className="tlabel">{timer.label || ''}</div>
      <div className={`tclock ${cls}`} id="tclock">{fmtClock(shown)}</div>
      <div className="tstate">{text}</div>
    </div>
  );
}

function Agenda({ items }: { items?: AgendaItem[] }) {
  const currentRef = useRef<HTMLDivElement | null>(null);
  const cur = items ? currentAgendaIndex(items) : -1;
  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: 'center' });
  }, [cur, items]);
  if (!items) return <div className="empty">Loading…</div>;
  if (!items.length) return <div className="empty">No agenda items yet</div>;
  return (
    <div className="agenda">
      {items.map((it, i) => (
        <div key={i} ref={i === cur ? currentRef : undefined} className={`row${i === cur ? ' current' : ''}`}>
          <div className="t">{it.start_time + (it.end_time ? `–${it.end_time}` : '')}</div>
          <div>
            <span>{it.title}</span>
            {it.details ? <span className="d">{it.details}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function PinGate({ slug, headers, onUnlocked }: { slug: string; headers: (extra?: Record<string, string>) => Record<string, string>; onUnlocked: (token: string) => void }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await fetch(`/api/v1/public/stations/${encodeURIComponent(slug)}/unlock`, {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ pin }),
      });
      const b = (await r.json().catch(() => ({}))) as { token?: string };
      if (r.ok && b.token) {
        onUnlocked(b.token);
        return;
      }
      setErr(r.status === 429 ? 'Too many wrong PINs. Wait a few minutes.' : 'Wrong PIN');
      setPin('');
    } catch {
      setErr('Could not reach the server');
    }
    setBusy(false);
  };
  return (
    <div className="gate">
      <p>Enter the station PIN</p>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        autoFocus
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <div className="err">{err}</div>
      <button type="button" disabled={busy} onClick={submit}>Unlock</button>
    </div>
  );
}
