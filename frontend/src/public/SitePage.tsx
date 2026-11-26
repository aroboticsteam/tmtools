import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { currentAgendaIndex } from '../lib/agendaClock';
import { usePageChrome } from './usePageChrome';
import { useSiteQuery } from './siteData';
import { STATIC_SITE } from './siteUrl';
import type { Livestream, SiteEvent, SiteMatch, SiteOverview, SiteRank, SiteSkill, SiteTeam, SiteTeamSummary } from './siteData';
import './site.css';

const NAV: [string, string][] = [['home', 'Home'], ['event', 'Event'], ['teams', 'Teams'], ['live', 'Livestreams'], ['map', 'Map']];

const num = (v: unknown, d?: number): string | number =>
  v === null || v === undefined ? '–' : d !== undefined && typeof v === 'number' ? v.toFixed(d) : (v as string | number);
const fmtTime = (ts: number | null) => (ts ? new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–');
const isIq = (m: SiteMatch) => m.programme === 'iq' || (!m.programme && m.red.length <= 1 && m.blue.length <= 1);

/** Colour overrides from the `site` setting: {dark: {token: '#hex'}, light: {...}}; tokens are CSS variable names. */
export function themeCss(theme: SiteOverview['theme']): string {
  if (!theme) return '';
  const block = (vals?: Record<string, string>) => {
    const decls = Object.entries(vals ?? {})
      .map(([k, v]) => `--${k}:${v};`)
      .join('');
    return decls ? `.pubsite{${decls}}` : '';
  };
  return block(theme.dark) + (theme.light ? `@media (prefers-color-scheme: light){${block(theme.light)}}` : '');
}

function TeamLink({ n }: { n: string }) {
  return <a href={`#team/${encodeURIComponent(n)}`}>{n}</a>;
}
function TeamLabel({ r }: { r: { team: string; team_name?: string | null } }) {
  return (
    <span>
      <TeamLink n={r.team} />
      {r.team_name ? <span className="muted">{`  ${r.team_name}`}</span> : null}
    </span>
  );
}
function Teams({ list, sep, selfNumber, cls }: { list: string[]; sep: string; selfNumber?: string | null; cls?: string }) {
  return (
    <span className={cls}>
      {list.map((n, i) => (
        <span key={n + i}>
          {i ? sep : null}
          {selfNumber && n === selfNumber ? <b>{n}</b> : <TeamLink n={n} />}
        </span>
      ))}
    </span>
  );
}

interface Row {
  cells: ReactNode[];
  cls?: string;
}
function PubTable({ heads, rows, empty, noMax }: { heads: string[]; rows: Row[]; empty: string; noMax?: boolean }) {
  if (!rows.length) return <div className="empty">{empty}</div>;
  return (
    <div className="scroll" style={noMax ? { maxHeight: 'none' } : undefined}>
      <table>
        <thead>
          <tr>{heads.map((h, i) => <th key={i}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.cls}>
              {r.cells.map((c, j) => (
                <td key={j} className={typeof c === 'number' ? 'n' : undefined}>
                  {c === null || c === undefined ? '–' : c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatchTable({ matches, selfNumber, empty }: { matches: SiteMatch[]; selfNumber?: string | null; empty: string }) {
  const iq = matches.length > 0 && matches.every(isIq);
  const heads = iq ? ['Match', 'Time', 'Teams', 'Score', ''] : ['Match', 'Time', 'Red', 'Blue', 'Score', ''];
  const rows = matches.map((m): Row => {
    const score = m.score ? (iq ? String(m.score[0]) : `${m.score[0]} – ${m.score[1]}`) : '';
    const label = m.recording_url ? (
      <a href={m.recording_url} target="_blank" rel="noopener" title={`Watch ${m.label}`}>{m.label}</a>
    ) : (
      m.label
    );
    const watch = m.recording_url ? <a href={m.recording_url} target="_blank" rel="noopener">▶ Watch</a> : '';
    if (iq) return { cells: [label, fmtTime(m.scheduled_at), <Teams key="t" list={[...m.red, ...m.blue]} sep=" & " selfNumber={selfNumber} />, score, watch] };
    return {
      cells: [label, fmtTime(m.scheduled_at), <Teams key="r" list={m.red} sep=", " selfNumber={selfNumber} cls="red" />, <Teams key="b" list={m.blue} sep=", " selfNumber={selfNumber} cls="blue" />, score, watch],
    };
  });
  return <PubTable heads={heads} rows={rows} empty={empty} />;
}

function RankTable({ d, rows, empty, noMax }: { d: SiteEvent; rows: SiteRank[]; empty: string; noMax?: boolean }) {
  const wlt = rows.some((r) => d.divisions[r.division as string]?.programme === 'vrc');
  const heads = ['Rank', 'Team', ...(wlt ? ['W-L-T'] : []), 'Avg pts', 'High'];
  return (
    <PubTable
      heads={heads}
      empty={empty}
      noMax={noMax}
      rows={rows.map((r) => ({
        cls: r.rank <= 3 ? 'top' : '',
        cells: [r.rank, <TeamLabel key="t" r={r} />, ...(wlt ? [`${num(r.wins)}-${num(r.losses)}-${num(r.ties)}`] : []), num(r.avg_points, 1), num(r.high_score)],
      }))}
    />
  );
}

function SkillsTable({ rows, empty, noMax }: { rows: SiteSkill[]; empty: string; noMax?: boolean }) {
  return (
    <PubTable
      heads={['Rank', 'Team', 'Total', 'Driver', 'Prog', 'Attempts D/P']}
      empty={empty}
      noMax={noMax}
      rows={rows.map((r) => ({
        cls: r.rank <= 3 ? 'top' : '',
        cells: [`${r.rank}${r.tie ? '=' : ''}`, <TeamLabel key="t" r={r} />, num(r.total), num(r.driver), num(r.prog), `${num(r.driver_attempts)}/${num(r.prog_attempts)}`],
      }))}
    />
  );
}

function Loading({ error }: { error: boolean }) {
  return <p className="empty">{error ? 'Could not load this page. Retrying…' : 'Loading…'}</p>;
}

// ── Home ──────────────────────────────────────────────────────────────

function StatStrip({ d }: { d: SiteEvent }) {
  const teams = new Set<string>();
  let played = 0;
  (d.matches || []).forEach((m) => {
    [...m.red, ...m.blue].forEach((n) => teams.add(n));
    if (m.score) played++;
  });
  (d.rankings || []).forEach((r) => teams.add(r.team));
  const total = (d.matches || []).length;
  const stats: [number, string][] = [];
  if (teams.size) stats.push([teams.size, 'Teams']);
  if (total) stats.push([played, 'Matches played'], [total - played, 'Matches to go']);
  return (
    <div className="strip">
      {stats.map(([v, label]) => (
        <div key={label} className="stat"><b>{v}</b><span>{label}</span></div>
      ))}
    </div>
  );
}

function Home({ o, d }: { o: SiteOverview; d: SiteEvent }) {
  const [tab, setTab] = useState<'rank' | 'skills'>('rank');
  const img = o.hero?.image_url;
  const top = <T extends { rank: number; division?: string | number; team: string }>(rows: T[]) =>
    rows
      .slice()
      .sort((a, b) => a.rank - b.rank || (String(a.division) < String(b.division) ? -1 : 1) || (a.team < b.team ? -1 : 1))
      .slice(0, 50);
  const nc = o.next_competition;
  let when = '';
  if (nc?.name) {
    when = [nc.date, nc.location].filter(Boolean).join('  ·  ');
    if (nc.days_until !== null && nc.days_until !== undefined && nc.days_until >= 0) {
      when += (when ? '  ·  ' : '') + (nc.days_until === 0 ? 'today' : `${nc.days_until} day${nc.days_until === 1 ? '' : 's'} left`);
    }
  }
  const links: [string, string][] = [
    ['#event', 'Agenda, matches & rankings'], ['#teams', 'Team profiles'], ['#live', 'Livestreams'], ['#map', 'Event map'],
    ...(STATIC_SITE ? [] : [['/notify', 'Get match alerts on your phone'] as [string, string]]),
  ];
  return (
    <div>
      <section
        className={`hero${img ? ' has-img' : ''}`}
        style={img ? { backgroundImage: `url("${String(img).replace(/"/g, '%22')}")` } : undefined}
      >
        {o.presented_by ? <div className="kick">{o.presented_by}</div> : null}
        <h1>{`Welcome to ${o.title}`}</h1>
        <div className="rule" />
        <div className="hint">↓ Live standings</div>
      </section>
      <StatStrip d={d} />
      <section className="section">
        <div className="tabs">
          {([['rank', 'Top 50 qualification rankings'], ['skills', 'Top 50 skills']] as const).map(([k, label]) => (
            <button key={k} type="button" className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        <div>
          {tab === 'rank' ? (
            <RankTable d={d} rows={top(d.rankings)} empty="Rankings will appear once qualification matches are played." noMax />
          ) : (
            <SkillsTable rows={top(d.skills)} empty="No skills scores yet." noMax />
          )}
        </div>
      </section>
      <a href="#event" style={{ display: 'inline-block', marginTop: '.6rem' }}>Full event page →</a>
      {nc?.name ? (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <b>{`Next competition: ${nc.name}`}</b>
          {when ? <div className="muted">{when}</div> : null}
          {nc.description ? <div>{nc.description}</div> : null}
          {nc.teams?.length ? <div className="muted">{`Teams attending: ${nc.teams.join(', ')}`}</div> : null}
          {([[nc.url, 'Event page'], [nc.registration_url, 'Register']] as const).map(([href, label]) =>
            href ? <a key={label} href={href} target="_blank" rel="noopener" style={{ marginRight: '1rem' }}>{label}</a> : null,
          )}
        </div>
      ) : null}
      <div className="grid" style={{ marginTop: '1rem' }}>
        {links.map(([href, label]) =>
          href.startsWith('/') ? (
            <Link key={href} to={href} className="card linkcard">{label}</Link>
          ) : (
            <a key={href} href={href} className="card linkcard">{label}</a>
          ),
        )}
      </div>
      {o.sponsors?.length ? (
        <>
          <h2>Our sponsors</h2>
          <div className="spons">
            {o.sponsors.map((s, i) => {
              const inner = s.logo_url ? <img src={s.logo_url} alt={s.name || ''} /> : <span>{s.name}</span>;
              return s.url && /^https?:\/\//.test(s.url) ? (
                <a key={i} href={s.url} target="_blank" rel="noopener">{inner}</a>
              ) : (
                <span key={i} style={{ display: 'contents' }}>{inner}</span>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ── Event ─────────────────────────────────────────────────────────────

interface EvState {
  tab: string;
  prog: string;
  div: string;
}

function EventView({ d, state, setState }: { d: SiteEvent; state: EvState; setState: (s: EvState) => void }) {
  const progs = [...new Set(Object.values(d.divisions).map((x) => x.programme).filter(Boolean))] as string[];
  const divs = Object.keys(d.divisions).filter((k) => !state.prog || d.divisions[k].programme === state.prog);
  const inScope = (division: string | number | undefined) =>
    (!state.div || String(division) === state.div) && (!state.prog || !d.divisions[division as string] || d.divisions[division as string].programme === state.prog);
  const select = (label: string, opts: [string, string][], field: 'prog' | 'div') => (
    <>
      <span className="muted">{label}</span>
      <select aria-label={label} value={state[field]} onChange={(e) => setState({ ...state, [field]: e.target.value })}>
        {opts.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </>
  );
  return (
    <div>
      <div className="tools">
        {progs.length > 1 ? select('Programme', [['', 'All'], ...progs.map((p): [string, string] => [p, p === 'iq' ? 'VIQRC' : 'V5RC'])], 'prog') : null}
        {divs.length > 1 ? select('Division', [['', 'All'], ...divs.map((k): [string, string] => [k, `Division ${k}`])], 'div') : null}
      </div>
      <div className="tabs">
        {([['agenda', 'Agenda'], ['matches', 'Matches'], ['rank', 'Qualification rankings'], ['skills', 'Skills rankings']] as const).map(([k, label]) => (
          <button key={k} type="button" className={state.tab === k ? 'active' : ''} onClick={() => setState({ ...state, tab: k })}>{label}</button>
        ))}
      </div>
      {state.tab === 'agenda' ? (
        <>
          {(['day', 'finals'] as const).map((scope) => {
            const items = d.agenda.filter((a) => a.scope === scope);
            if (!items.length) return null;
            const cur = scope === 'day' ? currentAgendaIndex(items) : -1;
            return (
              <div key={scope}>
                <h2>{scope === 'day' ? 'Day agenda' : 'Finals agenda'}</h2>
                <PubTable
                  heads={['Time', 'Item']}
                  empty=""
                  rows={items.map((a, i) => ({
                    cls: i === cur ? 'row-cur' : '',
                    cells: [
                      a.start_time + (a.end_time ? `–${a.end_time}` : ''),
                      <span key="t">{a.title}{a.details ? <div className="muted">{a.details}</div> : null}</span>,
                    ],
                  }))}
                />
              </div>
            );
          })}
          {!d.agenda.length ? <div className="empty">No agenda published yet.</div> : null}
        </>
      ) : null}
      {state.tab === 'matches' ? <MatchTable matches={d.matches.filter((m) => inScope(m.division))} empty="No matches scheduled yet." /> : null}
      {state.tab === 'rank' ? <RankTable d={d} rows={d.rankings.filter((r) => inScope(r.division))} empty="Rankings will appear once qualification matches are played." /> : null}
      {state.tab === 'skills' ? <SkillsTable rows={d.skills.filter((r) => inScope(r.division))} empty="No skills scores yet." /> : null}
    </div>
  );
}

// ── Teams ─────────────────────────────────────────────────────────────

function TeamsView({ list, state, setState }: { list: SiteTeamSummary[]; state: { q: string; sort: string }; setState: (s: { q: string; sort: string }) => void }) {
  const rows = useMemo(() => {
    const needle = state.q.trim().toLowerCase();
    const key = (t: SiteTeamSummary): [boolean, string | number] => {
      switch (state.sort) {
        case 'qual': return [t.qual_rank === null, t.qual_rank as number];
        case 'skills': return [t.skills_rank === null, t.skills_rank as number];
        case 'org': return [!t.organisation, (t.organisation || '').toLowerCase()];
        case 'division': return [t.division === null || t.division === undefined, String(t.division)];
        default: return [false, t.team_number];
      }
    };
    return list
      .filter((t) => !needle || [t.team_number, t.team_name, t.organisation].join(' ').toLowerCase().includes(needle))
      .sort((a, b) => {
        const x = key(a);
        const y = key(b);
        return Number(x[0]) - Number(y[0]) || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0) || (a.team_number < b.team_number ? -1 : 1);
      });
  }, [list, state]);
  return (
    <div>
      <div className="tools">
        <input aria-label="Search teams" placeholder="Search team, name or school" value={state.q} onChange={(e) => setState({ ...state, q: e.target.value })} />
        <select aria-label="Sort teams" value={state.sort} onChange={(e) => setState({ ...state, sort: e.target.value })}>
          {[['number', 'Sort: team number'], ['qual', 'Sort: qualification rank'], ['skills', 'Sort: skills rank'], ['org', 'Sort: organisation'], ['division', 'Sort: division']].map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>
      <div className="grid">
        {rows.map((t) => (
          <a key={t.team_number} className="card teamcard" href={`#team/${encodeURIComponent(t.team_number)}`}>
            <b>{t.team_number}</b>
            {t.team_name ? <div>{t.team_name}</div> : null}
            {t.organisation ? <div className="muted">{t.organisation}</div> : null}
            <div className="muted">{`Qual #${num(t.qual_rank)}  ·  Skills #${num(t.skills_rank)}`}</div>
          </a>
        ))}
        {!rows.length ? <div className="empty">No teams found.</div> : null}
      </div>
    </div>
  );
}

function Kv({ title, pairs }: { title: string; pairs: [string, unknown][] }) {
  return (
    <div className="card">
      <b>{title}</b>
      <dl className="kv" style={{ marginTop: '.5rem' }}>
        {pairs.map(([k, v]) => (
          <span key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v === null || v === undefined || v === '' ? '–' : String(v)}</dd>
          </span>
        ))}
      </dl>
    </div>
  );
}

function SeasonHistory({ t }: { t: SiteTeam }) {
  const prev = t.season.previous_rankings || [];
  const awards = t.season.award_list || [];
  if (!prev.length && !awards.length) return null;
  const events: { name: string; results: Record<string, any>[]; awards: string[] }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const byName: Record<string, (typeof events)[number]> = {};
  const slot = (name: string) => {
    if (!byName[name]) {
      byName[name] = { name, results: [], awards: [] };
      events.push(byName[name]);
    }
    return byName[name];
  };
  const evName = (r: Record<string, any>) => (r.event && r.event.name) || r.event_name || 'Event'; // eslint-disable-line @typescript-eslint/no-explicit-any
  prev.forEach((r) => slot(evName(r)).results.push(r));
  awards.forEach((a) => {
    const title = a.title || a.name;
    if (title) slot(evName(a)).awards.push(title);
  });
  return (
    <>
      <h2>Season history</h2>
      <div className="hist">
        {events.map((e) => {
          const ev0 = e.results[0]?.event;
          const start = ev0 && typeof ev0.start === 'string' ? ev0.start.slice(0, 10) : '';
          return (
            <div className="card" key={e.name}>
              <h3>{e.name}</h3>
              {start ? <div className="when">{start}</div> : null}
              {e.results.map((r, i) => {
                const avg = r.average_points !== undefined ? r.average_points : r.avgPoints;
                const tiles: [string, unknown][] = [['Qualification rank', r.rank]];
                if (typeof avg === 'number') tiles.push(['Average score', avg.toFixed(1)]);
                tiles.push(['High score', r.high_score !== undefined ? r.high_score : r.highScore]);
                if (t.programme !== 'iq' && r.wins !== undefined && r.wins !== null) tiles.push(['Record (W-L-T)', `${r.wins}-${r.losses || 0}-${r.ties || 0}`]);
                tiles.push(['Finals ranking', r.finals_rank]);
                const shown = tiles.filter(([, v]) => v !== undefined && v !== null && v !== '');
                return shown.length ? (
                  <div className="tiles" key={i}>
                    {shown.map(([label, v]) => <div className="tile" key={label}><b>{String(v)}</b><span>{label}</span></div>)}
                  </div>
                ) : null;
              })}
              {e.awards.length ? <div className="chips">{e.awards.map((a, i) => <span className="chip" key={i}>{`🏆 ${a}`}</span>)}</div> : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

function TeamView({ t }: { t: SiteTeam }) {
  const c = t.current;
  const keys: [string, unknown][] = [['Qualification rank', c.qual_rank], ['Skills rank', c.skills_rank], ['Average points', num(c.avg_points, 1)], ['Highest score', c.high_score]];
  const curRows: [string, unknown][] = [
    ['Qualification rank', c.qual_rank], ['Average points', num(c.avg_points, 1)], ['Highest score', c.high_score], ['Skills rank', c.skills_rank],
    ['Skills total', c.skills_total], ['Driver / Prog', `${num(c.skills_driver)} / ${num(c.skills_prog)}`],
    ['Attempts (D/P)', `${num(c.skills_driver_attempts)} / ${num(c.skills_prog_attempts)}`],
  ];
  if (t.programme !== 'iq' && c.wins !== null && c.wins !== undefined) curRows.splice(1, 0, ['Record (W-L-T)', `${c.wins}-${c.losses}-${c.ties}`]);
  const dls = t.downloads || {};
  const photos = t.photos || {};
  const kinds = ([['bot', 'Robot photo'], ['team', 'Team photo']] as const).filter(([k]) => dls[k]?.url || photos[k]);
  return (
    <div>
      <a href="#teams">← All teams</a>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '.8rem' }}>
        {t.logo_url ? <img src={t.logo_url} alt="" style={{ maxHeight: 56, borderRadius: 8 }} /> : null}
        <span>{t.team_number + (t.team_name ? ` — ${t.team_name}` : '')}</span>
      </h2>
      {t.website_url ? (
        <a href={t.website_url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginBottom: '.8rem' }}>
          {t.website_url.replace(/^https?:\/\//, '')}
        </a>
      ) : null}
      {keys.some(([, v]) => v !== null && v !== undefined && v !== '–') ? (
        <div className="strip">
          {keys.filter(([, v]) => v !== null && v !== undefined && v !== '–').map(([label, v]) => (
            <div className="stat" key={label}><b>{String(v)}</b><span>{label}</span></div>
          ))}
        </div>
      ) : null}
      <div className="grid">
        <Kv title="General" pairs={[['Organisation', t.organisation], ['Location', t.location], ['Robot name', t.robot_name], ['Division', t.division], ['Pit', t.pit_location]]} />
        <Kv title="Current competition" pairs={curRows} />
        <Kv title="Season" pairs={[['Events attended', t.season.events_attended], ['Awards', t.season.awards], ['Skills rank (season)', t.season.world_skills_rank]]} />
      </div>
      {kinds.length ? (
        <>
          <h2>Photos</h2>
          <div className="vids">
            {kinds.map(([k, label]) => {
              const dl = dls[k];
              const photo = photos[k];
              const src = photo || dl?.url;
              return (
                <div className="card" key={k}>
                  <b>{label}</b>
                  {src ? <img src={src} alt={label} loading="lazy" style={{ marginTop: '.6rem' }} /> : null}
                  {dl?.url ? (
                    <a className="btn" href={dl.url} download={dl.name || ''}>{`⬇ Download ${label.toLowerCase()}`}</a>
                  ) : (
                    <a className="btn" href={photo} download={`${t.team_number}-${k}.png`}>{`⬇ Download ${label.toLowerCase()}`}</a>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : null}
      <h2>Schedule</h2>
      <MatchTable matches={t.schedule} selfNumber={t.team_number} empty="No matches scheduled yet." />
      <SeasonHistory t={t} />
    </div>
  );
}

// ── Livestreams / Map ─────────────────────────────────────────────────

function LiveView({ list }: { list: Livestream[] }) {
  if (!list.length) return <div className="empty">No livestreams are configured yet.</div>;
  return (
    <div>
      {list.map((r) => (
        <div key={r.name}>
          <h2>{r.name}</h2>
          <div className="frame">
            <iframe title={r.name} src={r.stream_url} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
          </div>
        </div>
      ))}
    </div>
  );
}

function MapView({ o, list, onPop }: { o: SiteOverview; list: SiteTeamSummary[]; onPop: (title: string, body: ReactNode) => void }) {
  const [zoom, setZoom] = useState(1);
  const m = o.map;
  if (!m || !m.image_url) return <div className="empty">The event map has not been published yet.</div>;
  const setZ = (z: number) => setZoom(Math.max(1, Math.min(4, z)));
  return (
    <div>
      <div className="tools">
        <button type="button" aria-label="Zoom out" onClick={() => setZ(zoom - 0.5)}>−</button>
        <button type="button" aria-label="Zoom in" onClick={() => setZ(zoom + 0.5)}>+</button>
        <span className="muted">Zoom in and tap a room for details</span>
      </div>
      <div className="map">
        <div className="inner" style={{ width: `${zoom * 100}%` }}>
          <img src={m.image_url} alt="Event map" />
          {(m.rooms || []).map((r) => (
            <button
              key={r.name}
              type="button"
              className="pin"
              style={{ left: `${r.x}%`, top: `${r.y}%` }}
              onClick={() => {
                const inRoom = list.filter((t) => (r.teams || []).includes(t.team_number) || (t.pit_location && t.pit_location === r.name));
                onPop(
                  r.name,
                  <>
                    {r.description ? <div>{r.description}</div> : null}
                    {inRoom.map((t) => (
                      <div key={t.team_number}>
                        <TeamLink n={t.team_number} />
                        {t.team_name ? `  ${t.team_name}` : ''}
                      </div>
                    ))}
                    {!r.description && !inRoom.length ? <div className="muted">Nothing listed for this room.</div> : null}
                  </>,
                );
              }}
            >
              {r.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────

/**
 * Team-facing public website (`/site`): one page, hash-routed (`#event`, `#teams`, `#team/<n>`,
 * `#live`, `#map`), fed by `/api/v1/public/site/*`. No sign-in and no admin shell.
 */
export function SitePage() {
  const { hash } = useLocation();
  const route = hash.replace(/^#/, '') || 'home';
  const [page, ...rest] = route.split('/');
  const teamNumber = rest.length ? decodeURIComponent(rest.join('/')) : '';

  const overview = useSiteQuery<SiteOverview>('overview');
  const eventQ = useSiteQuery<SiteEvent>('event', { enabled: page === 'home' || page === 'event', refetchMs: page === 'event' ? 30000 : undefined });
  const teamsQ = useSiteQuery<SiteTeamSummary[]>('teams', { enabled: page === 'teams' || page === 'map' });
  const teamQ = useSiteQuery<SiteTeam>(`teams/${encodeURIComponent(teamNumber)}`, { enabled: page === 'team' && !!teamNumber });
  const liveQ = useSiteQuery<Livestream[]>('livestreams', { enabled: page === 'live' });

  const [evState, setEvState] = useState<EvState>({ tab: 'agenda', prog: '', div: '' });
  const [teamState, setTeamState] = useState({ sort: 'number', q: '' });
  const [pop, setPop] = useState<{ title: string; body: ReactNode } | null>(null);

  const o = overview.data;
  const darkPrimary = o?.theme?.dark?.primary;
  usePageChrome({ title: o?.title || 'Competition', themeColor: darkPrimary || '#171717' });
  const css = useMemo(() => themeCss(o?.theme), [o?.theme]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  const activeNav = page === 'team' ? 'teams' : page;
  let view: ReactNode;
  if (page === 'home') {
    view = overview.data && eventQ.data ? <Home o={overview.data} d={eventQ.data} /> : <Loading error={overview.isError || eventQ.isError} />;
  } else if (page === 'event') {
    view = eventQ.data ? <EventView d={eventQ.data} state={evState} setState={setEvState} /> : <Loading error={eventQ.isError} />;
  } else if (page === 'teams') {
    view = teamsQ.data ? <TeamsView list={teamsQ.data} state={teamState} setState={setTeamState} /> : <Loading error={teamsQ.isError} />;
  } else if (page === 'team' && teamNumber) {
    view = teamQ.data ? <TeamView t={teamQ.data} /> : <Loading error={teamQ.isError} />;
  } else if (page === 'live') {
    view = liveQ.data ? <LiveView list={liveQ.data} /> : <Loading error={liveQ.isError} />;
  } else if (page === 'map') {
    view = overview.data && teamsQ.data ? <MapView o={overview.data} list={teamsQ.data} onPop={(title, body) => setPop({ title, body })} /> : <Loading error={overview.isError || teamsQ.isError} />;
  } else {
    view = <div className="empty">Page not found.</div>;
  }

  return (
    <div className="pubsite">
      {css ? <style>{css}</style> : null}
      <header>
        <div className="bar">
          <h1 id="title">{o?.title || 'Competition'}</h1>
          <nav id="nav">
            {NAV.map(([k, label]) => (
              <a key={k} href={`#${k}`} className={activeNav === k ? 'active' : ''}>{label}</a>
            ))}
            {STATIC_SITE ? null : <Link to="/notify">Alerts</Link>}
          </nav>
        </div>
      </header>
      <main id="view">{view}</main>
      {pop ? (
        <div id="pop" style={{ display: 'flex' }} onClick={(e) => e.target === e.currentTarget && setPop(null)}>
          <div className="box" id="popbox">
            <h2>{pop.title}</h2>
            {pop.body}
            <button type="button" style={{ marginTop: '1rem' }} onClick={() => setPop(null)}>Close</button>
          </div>
        </div>
      ) : null}
      <footer id="foot">{o?.presented_by ? `Presented by ${o.presented_by}` : null}</footer>
    </div>
  );
}
