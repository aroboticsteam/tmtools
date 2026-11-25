import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ApiError, apiFetch } from '../lib/http';
import { formatAwards, formatClock, normalizePrompterTeam, renderMarkdown } from '../lib/miniMarkdown';
import { usePageChrome } from './usePageChrome';
import { usePublicSocket } from './usePublicSocket';
import './prompter.css';

const PHASES: Record<string, string> = { idle: 'Idle', countdown: 'Countdown', match_running: 'Match Running', match_complete: 'Match Complete' };

interface TimerPayload {
  phase?: string;
  remaining?: number;
  elapsed?: number;
}
interface Cue {
  content: string;
}
interface MatchPayload {
  matchNum?: number | string;
  round?: string;
  redTeams?: unknown[];
  blueTeams?: unknown[];
  teams?: unknown[];
  high_potential?: boolean;
}

function TeamCard({ team, alliance }: { team: unknown; alliance: string }) {
  const t = normalizePrompterTeam(team);
  const awards = formatAwards(t.awards);
  return (
    <div className={`team-card${alliance ? ` ${alliance}` : ''}`}>
      <div className="tc-number">{t.team_number}</div>
      {t.team_name ? <div className="tc-name">{t.team_name}</div> : null}
      {t.robot_name ? <div className="tc-robot"><strong>Robot:</strong> {t.robot_name}</div> : null}
      {t.rank != null ? <div className="tc-rank"><strong>Rank:</strong> {t.rank}</div> : null}
      {awards ? <div className="tc-awards">{awards}</div> : null}
    </div>
  );
}

/**
 * EMCEE teleprompter (`/prompter/{entity_id}?token=...`), an iPad-friendly full-screen page
 * driven by `/ws/prompter/{entity_id}`. The HMAC token is checked up front through the public
 * API so a stale link fails loudly; the WebSocket re-validates it at upgrade time.
 */
export function PrompterPage() {
  const { entityId = '' } = useParams();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [linkError, setLinkError] = useState<string | null>(null);
  const [timer, setTimer] = useState<TimerPayload | null>(null);
  const [active, setActive] = useState<Cue | null>(null);
  const [nextCue, setNextCue] = useState<Cue | null>(null);
  const [match, setMatch] = useState<MatchPayload | null>(null);
  const [startError, setStartError] = useState('');
  const [starting, setStarting] = useState(false);

  usePageChrome({
    title: 'TMTools Teleprompter',
    body: { background: '#000', overflow: 'hidden' },
    meta: { viewport: 'width=device-width, initial-scale=1.0, maximum-scale=1, user-scalable=no' },
  });

  useEffect(() => {
    let live = true;
    apiFetch(`/api/v1/public/prompter/${encodeURIComponent(entityId)}`, { query: { token } })
      .then(() => live && setLinkError(null))
      .catch((e) => {
        if (!live || !(e instanceof ApiError)) return;
        if (e.status === 403) setLinkError('Invalid or expired teleprompter token');
        else if (e.status === 404) setLinkError('Unknown teleprompter');
      });
    return () => {
      live = false;
    };
  }, [entityId, token]);

  const onMessage = useCallback((raw: unknown) => {
    const msg = raw as { type?: string; payload?: Record<string, unknown> } | null;
    if (!msg || typeof msg !== 'object') return;
    const payload = (msg.payload || msg) as Record<string, unknown>;
    switch (msg.type) {
      case 'error': {
        // The server refused the last request (e.g. start_countdown without prompter:control).
        let detail = (msg.payload && ((msg.payload.detail as string) || (msg.payload.error as string))) || 'The server refused the request';
        if (msg.payload && msg.payload.error === 'forbidden') {
          detail += '. Sign in to the admin UI on this device with a prompter:control role, then reload.';
        }
        setStartError(detail);
        setStarting(false);
        break;
      }
      case 'timer_state':
      case 'timer_started':
      case 'timer_milestone':
      case 'timer_finished':
      case 'timer_stopped':
        setTimer(payload as TimerPayload);
        setStarting(false);
        break;
      case 'cues':
        setActive((payload.active as Cue) || null);
        setNextCue((payload.next as Cue) || null);
        break;
      case 'upcoming_match':
      case 'match_prediction':
        setMatch(payload as MatchPayload);
        break;
      default:
        break; // forward-compatible: ignore unknown message types
    }
  }, []);

  const qs = token ? `?token=${encodeURIComponent(token)}` : '';
  const { status, send } = usePublicSocket(linkError ? null : `/ws/prompter/${encodeURIComponent(entityId)}${qs}`, onMessage);

  if (linkError) return <div className="prompter-page"><div className="gate" role="alert">{linkError}</div></div>;

  const phase = timer?.phase || 'idle';
  const remaining = timer?.remaining ?? 0;
  const clockClass =
    phase === 'countdown' ? (remaining <= 3 ? 'danger' : remaining <= 10 ? 'warning' : '') : phase === 'match_running' ? 'running' : '';
  const startDisabled = phase === 'countdown' || phase === 'match_running' || starting;

  const red = match?.redTeams || [];
  const blue = match?.blueTeams || [];
  const hasAlliances = red.length > 0 || blue.length > 0;
  const title = (() => {
    if (!match) return 'No match queued';
    const parts: string[] = [];
    if (match.matchNum) parts.push(`Match ${match.matchNum}`);
    if (match.round) parts.push(match.round);
    return parts.length ? parts.join(' — ') : 'Upcoming match';
  })();

  return (
    <div className="prompter-page">
      {status === 'reconnecting' ? <div className="banner">Reconnecting…</div> : null}
      <section className="panel countdown">
        <div className="phase">{PHASES[phase] || phase}</div>
        <div className={`clock ${clockClass}`}>{timer ? formatClock(phase === 'countdown' ? timer.remaining : timer.elapsed) : '--:--'}</div>
        <button
          type="button"
          className="start"
          disabled={startDisabled}
          onClick={() => {
            if (!send({ type: 'start_countdown', entity_id: entityId })) return;
            setStarting(true);
            setStartError('');
          }}
        >
          Start Countdown
        </button>
        <div className="start-error" role="alert">{startError}</div>
      </section>
      <section className="panel cues">
        <div className="active-cue" dangerouslySetInnerHTML={{ __html: active ? renderMarkdown(active.content) : 'Waiting for cues…' }} />
        {nextCue ? (
          <>
            <div className="next-label">Next</div>
            <div className="next-cue" dangerouslySetInnerHTML={{ __html: renderMarkdown(nextCue.content) }} />
          </>
        ) : null}
      </section>
      <section className="panel match">
        <div className="match-head">
          <div className="match-title">{title}</div>
          {match?.high_potential ? <div className="match-flag">⚡ High-potential match</div> : null}
        </div>
        <div className="match-teams">
          {hasAlliances ? (
            <>
              {red.map((t, i) => <TeamCard key={`r${i}`} team={t} alliance="alliance-red" />)}
              {blue.map((t, i) => <TeamCard key={`b${i}`} team={t} alliance="alliance-blue" />)}
            </>
          ) : (
            (match?.teams || []).map((t, i) => <TeamCard key={i} team={t} alliance="" />)
          )}
        </div>
      </section>
    </div>
  );
}
