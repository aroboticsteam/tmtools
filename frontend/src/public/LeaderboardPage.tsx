import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/http';
import { PANELS, schedule } from '../lib/leaderboardSchedule';
import { STATIC_SITE, siteDataUrl } from './siteUrl';
import { usePageChrome } from './usePageChrome';
import './screens.css';

type Row = Record<string, string | number | null | undefined>;
interface Group {
  label: string;
  programme?: string;
  overall: Row[];
  tournament: Row[];
  skills: Row[];
  awards: Row[];
}
interface Data {
  groups: Group[];
  panel_seconds: number;
  programme_seconds: number;
  server_time: number;
}

const n = (v: unknown, d?: number) => (v === null || v === undefined ? '–' : d !== undefined && typeof v === 'number' ? v.toFixed(d) : String(v));
const cell = (v: unknown) => (v === null || v === undefined ? '–' : String(v));

type Col = [string, string, (r: Row) => string];
const COLUMNS: Record<string, Col[]> = {
  overall: [['Rank', 'rank', (r) => cell(r.rank)], ['Team', '', () => ''], ['Qual', 'n', (r) => cell(r.qual_rank)], ['Skills', 'n', (r) => cell(r.skills_rank)], ['Score', 'n', (r) => cell(r.score)]],
  tournament: [['Rank', 'rank', (r) => cell(r.rank)], ['Team', '', () => ''], ['W-L-T', 'n', (r) => `${n(r.wins)}-${n(r.losses)}-${n(r.ties)}`], ['Avg', 'n', (r) => n(r.avg_points, 1)]],
  skills: [['Rank', 'rank', (r) => cell(r.rank)], ['Team', '', () => ''], ['Total', 'n', (r) => n(r.total)], ['Driver', 'n', (r) => n(r.driver)], ['Prog', 'n', (r) => n(r.prog)]],
  awards: [['#', 'rank', (r) => cell(r.rank)], ['Team', '', () => ''], ['Awards', 'n', (r) => n(r.count)], ['Latest', '', (r) => cell(r.latest)]],
};

function numParam(q: URLSearchParams, name: string): number | null {
  const v = parseFloat(q.get(name) ?? '');
  return v > 0 ? v : null;
}

/** Big-screen rotating leaderboards (`/site/leaderboard`), driven by the wall clock. */
export function LeaderboardPage() {
  const [params] = useSearchParams();
  const [title, setTitle] = useState('Leaderboards');
  const [data, setData] = useState<(Data & { offset: number }) | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [stamp, setStamp] = useState(0);
  const limit = numParam(params, 'limit');
  const panelParam = numParam(params, 'panel');
  const programmeParam = numParam(params, 'programme');

  usePageChrome({ title: `${title} – Leaderboards`, body: { background: '#0b0d12', overflow: 'hidden' } });

  useEffect(() => {
    apiFetch<{ title: string }>(siteDataUrl('overview'))
      .then((o) => setTitle(o.title))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let live = true;
    const load = () =>
      apiFetch<Data>(siteDataUrl('leaderboards'), { query: { limit: limit ?? undefined } })
        .then((d) => {
          if (!live) return;
          setData({ ...d, offset: STATIC_SITE ? 0 : d.server_time - Date.now() / 1000 });
          setStamp(Date.now());
          setFailed(false);
        })
        .catch(() => live && setFailed(true));
    void load();
    const id = setInterval(load, 30000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [limit]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  let body;
  let progLabel = '';
  let tabs: number | null = null;
  let progress = 0;
  let fadeKey = '';
  if (!data) {
    body = <div className="empty">{failed ? 'Could not load the leaderboards. Retrying…' : 'Loading…'}</div>;
  } else if (!data.groups.length) {
    body = <div className="empty">Nothing to show yet.</div>;
  } else {
    const s = schedule(now / 1000 + data.offset, data.groups.length, panelParam ?? data.panel_seconds, programmeParam ?? data.programme_seconds);
    const group = data.groups[s.group];
    const key = PANELS[s.panel][0];
    const rows = group[key as keyof Group] as Row[];
    const cols = COLUMNS[key];
    tabs = s.panel;
    progress = s.progress;
    fadeKey = `${s.group}:${key}:${stamp}`;
    progLabel = data.groups.length > 1 || group.programme ? group.label : '';
    body = rows?.length ? (
      <table>
        <thead>
          <tr>{cols.map(([h, cls]) => <th key={h} className={cls === 'n' ? 'n' : ''}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map(([h, cls, f]) => (
                <td key={h} className={cls}>
                  {h === 'Team' ? (
                    <>
                      {cell(r.team)}
                      {r.team_name ? <span className="name">{String(r.team_name)}</span> : null}
                    </>
                  ) : (
                    f(r)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <div className="empty">Nothing to show yet.</div>
    );
  }

  return (
    <div className="pub-screen lb-page">
      <header>
        <h1>{title}</h1>
        <div id="prog" className="prog">{progLabel}</div>
      </header>
      <div id="tabs" className="tabs">{tabs !== null ? PANELS.map((p, i) => <span key={p[0]} className={i === tabs ? 'on' : ''}>{p[1]}</span>) : null}</div>
      <div className="bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      <main key={fadeKey} className="fade">{body}</main>
    </div>
  );
}
