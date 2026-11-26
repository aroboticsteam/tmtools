import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/http';
import { bannerText, isoFor, normalizeTeam, teamNumberOf } from '../lib/overlayEngine';
import type { FeedTeam, Layout, MatchPayload, OverlayTeam } from '../lib/overlayEngine';
import { usePageChrome } from './usePageChrome';
import { usePublicSocket } from './usePublicSocket';
import './overlay.css';

interface Feed {
  show_robot_name?: boolean;
  teams?: Record<string, FeedTeam>;
}

function Flag({ country }: { country: string | null }) {
  const code = isoFor(country);
  const [broken, setBroken] = useState(false);
  if (!code) return null;
  return (
    <div className="flag">
      {broken ? code.toUpperCase() : <img alt={code.toUpperCase()} src={`https://flagcdn.com/h40/${code}.png`} onError={() => setBroken(true)} />}
    </div>
  );
}

function Clip({ url, fallback, className }: { url: string | null; fallback: string | null; className: string }) {
  return (
    <div className={`clip ${className}`}>
      {url ? <img src={url} alt="" /> : fallback ? <div className="placeholder">{fallback}</div> : null}
    </div>
  );
}

function Cell({ t, side, panel, iq, top, robotName }: { t: OverlayTeam; side: 'left' | 'right'; panel: string; iq?: boolean; top: number; robotName: boolean }) {
  const style = { top, [side === 'right' ? 'right' : 'left']: 38 } as React.CSSProperties;
  return (
    <div className={`cell ${side}${iq ? ' iq' : ''}`} style={style}>
      <div className={`panel ${panel}${side === 'left' && iq ? ' left' : ''}`} />
      <div className="label">
        <div className="number">{t.team_number}</div>
        {t.team_name ? <div className="name">{t.team_name}</div> : null}
        {robotName && t.robot_name ? <div className="robot">{`🤖 ${t.robot_name}`}</div> : null}
      </div>
      <Clip url={t.bot_url} fallback={t.team_number} className="bot" />
      <Flag country={t.country} />
    </div>
  );
}

function Banner({ payload }: { payload: MatchPayload }) {
  const text = bannerText(payload);
  return text ? <div className="banner">{text}</div> : null;
}

/**
 * Team overlay (`/overlay/{entity_id}`): an OBS browser source, fixed 1920x1080,
 * fully transparent. Driven by `/ws/overlay/{entity_id}`; there is no auth ("security by
 * obscurity of the entity_id"), and nothing at all is drawn when there is no match data.
 */
export function OverlayPage() {
  const { entityId = '' } = useParams();
  const [params] = useSearchParams();
  const forcedMode = params.get('mode');
  const robotParam = params.get('robot_name') === '1';
  const teamParam = params.get('team');

  const [layout, setLayout] = useState<Layout | null>(null);
  const [visible, setVisible] = useState(false);
  const [robotName, setRobotName] = useState(false);
  const lastMatch = useRef<MatchPayload | null>(null); // so a cleared spotlight can return to the match
  const spotlight = useRef<string | null>(null);
  const lastApplied = useRef<Record<string, number>>({});
  const fade = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showRobot = useRef(false);

  usePageChrome({ title: 'TMTools Overlay', body: { background: 'transparent', overflow: 'hidden', width: '1920px', height: '1080px' } });

  const fetchFeed = useCallback(async (numbers: string[]): Promise<Record<string, FeedTeam>> => {
    if (!numbers.length) return {};
    try {
      const data = await apiFetch<Feed>(`/api/v1/public/overlay/teams?teams=${encodeURIComponent(numbers.join(','))}`);
      showRobot.current = !!data?.show_robot_name || robotParam;
      setRobotName(showRobot.current);
      return data?.teams || {};
    } catch {
      return {}; // no feed -> placeholders, never throws
    }
  }, [robotParam]);

  const clearGrid = useCallback(() => {
    setVisible(false);
    clearTimeout(fade.current);
    fade.current = setTimeout(() => setLayout(null), 500);
  }, []);

  const show = useCallback((next: Layout) => {
    clearTimeout(fade.current);
    setLayout(next);
    setVisible(false);
    fade.current = setTimeout(() => setVisible(true), 16);
  }, []);

  const renderMatch = useCallback(
    async (payload: MatchPayload | null): Promise<void> => {
      lastMatch.current = payload;
      if (spotlight.current) return; // spotlight wins until cleared
      if (!payload) return clearGrid();
      const redRaw = payload.redTeams || [];
      const blueRaw = payload.blueTeams || [];
      const numbers = [...redRaw, ...blueRaw].map(teamNumberOf).filter(Boolean);
      if (!numbers.length) return clearGrid();
      const feed = await fetchFeed(numbers);
      if (spotlight.current || lastMatch.current !== payload) return; // state moved on while fetching
      const red = redRaw.map((t) => normalizeTeam(t, feed));
      const blue = blueRaw.map((t) => normalizeTeam(t, feed));
      const count = red.length + blue.length;
      if (forcedMode === 'iq' || (forcedMode !== 'vrc' && count === 2)) show({ mode: 'iq', teams: [...red, ...blue], payload });
      else show({ mode: 'vrc', red, blue, payload });
    },
    [clearGrid, fetchFeed, forcedMode, show],
  );

  const setSpotlight = useCallback(
    async (number: string | null | undefined): Promise<void> => {
      spotlight.current = number ? String(number).toUpperCase() : null;
      const team = spotlight.current;
      if (team) {
        const feed = await fetchFeed([team]);
        if (spotlight.current !== team) return; // superseded while loading
        show({ mode: 'finals', team: normalizeTeam(team, feed) });
        return;
      }
      const payload = lastMatch.current;
      lastMatch.current = null;
      return renderMatch(payload);
    },
    [fetchFeed, renderMatch, show],
  );

  // On (re)connect the server replays what this overlay was last showing (a reload must not blank it). That
  // snapshot can overlap a live event, so per message type only ever move forward: anything not newer than
  // what is already on screen (an older message, or the same one delivered twice) is dropped.
  const handleMessage = useCallback(
    (raw: unknown) => {
      const msg = raw as { type?: string; timestamp?: number; payload?: Record<string, unknown> } | null;
      if (!msg || typeof msg !== 'object') return;
      const payload = (msg.payload || msg) as Record<string, unknown>;
      if (typeof msg.timestamp === 'number' && msg.type) {
        const prev = lastApplied.current[msg.type];
        if (prev !== undefined && msg.timestamp <= prev) return;
        lastApplied.current[msg.type] = msg.timestamp;
      }
      switch (msg.type) {
        case 'upcoming_match':
          void renderMatch(payload as MatchPayload);
          break;
        case 'match_cleared':
          void renderMatch(null);
          break;
        case 'show_team':
          void setSpotlight(payload?.team as string | undefined);
          break;
        default:
          break; // forward-compatible: ignore unknown message types
      }
    },
    [renderMatch, setSpotlight],
  );

  usePublicSocket(`/ws/overlay/${encodeURIComponent(entityId)}`, handleMessage);

  useEffect(() => {
    if (teamParam) void setSpotlight(teamParam); // static spotlight, e.g. for testing in OBS
    return () => clearTimeout(fade.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamParam]);

  let content: ReactNode = null;
  if (layout?.mode === 'iq') {
    content = (
      <>
        <Banner payload={layout.payload} />
        {layout.teams.slice(0, 2).map((t, i) => (
          <Cell key={t.team_number + i} t={t} side={i === 0 ? 'left' : 'right'} panel="blue" iq top={508} robotName={robotName} />
        ))}
      </>
    );
  } else if (layout?.mode === 'vrc') {
    const tops = [216, 648];
    content = (
      <>
        <Banner payload={layout.payload} />
        {layout.red.slice(0, 2).map((t, i) => <Cell key={`r${i}`} t={t} side="left" panel="red" top={tops[i]} robotName={robotName} />)}
        {layout.blue.slice(0, 2).map((t, i) => <Cell key={`b${i}`} t={t} side="right" panel="blue" top={tops[i]} robotName={robotName} />)}
        <div className="vs">VS</div>
      </>
    );
  } else if (layout?.mode === 'finals') {
    const t = layout.team;
    content = (
      <>
        <Clip url={t.bot_url} fallback={t.team_number} className="bot" />
        <div className="bar">
          <div className="number">{t.team_number}</div>
          {t.team_name ? <div className="name">{t.team_name}</div> : null}
          {robotName && t.robot_name ? <div className="robot">{`🤖 ${t.robot_name}`}</div> : null}
          <Flag country={t.country} />
        </div>
        <Clip url={t.team_url} fallback={null} className="teamvid" />
      </>
    );
  }

  return (
    <div className="obs-stage overlay-stage" id="stage">
      <div id="grid" className={`${layout ? `mode-${layout.mode}` : ''}${visible ? ' visible' : ''}`}>
        {content}
      </div>
    </div>
  );
}
