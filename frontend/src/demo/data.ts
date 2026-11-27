/**
 * The made-up event the GitHub Pages demo runs on: 24 teams, 36 qualification matches over 3 fields,
 * rankings, skills and an agenda. Everything here is generated deterministically (seeded) so the demo
 * looks the same on every load. None of it is real.
 */

export const EVENT_NAME = 'Demo Open 2026';
export const PROGRAMME = 'IQ';
export const FIELD_COUNT = 3;
export const MATCH_DURATION_S = 60;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = [
  'Gear Gremlins', 'Bolt Brigade', 'Pixel Pistons', 'Circuit Sparks', 'Torque Titans', 'Servo Squad',
  'Axle Attack', 'Byte Bots', 'Lever Legends', 'Rotor Rangers', 'Chassis Crew', 'Volt Vikings',
  'Sprocket Society', 'Cog Commanders', 'Widget Wizards', 'Lambda Lifters', 'Piston Pirates', 'Relay Rockets',
  'Ratchet Rebels', 'Pulley Pros', 'Fuse Force', 'Alloy Aces', 'Beacon Builders', 'Nova Mechanics',
];
const ORGS = [
  'Northfield Academy', 'Riverside School', 'Oakwood College', 'St. Anne\'s Grammar', 'Highgate High', 'Maple Park Primary',
  'Westbrook Technical', 'Kingsley School', 'Harbour Academy', 'Elmstead College', 'Brightwater School', 'Stonebridge High',
];
const PLACES = ['Leeds, UK', 'Bristol, UK', 'Glasgow, UK', 'Cardiff, UK', 'Belfast, UK', 'Norwich, UK', 'York, UK', 'Exeter, UK'];
const ROBOTS = ['Wombat', 'Kestrel', 'Otter', 'Falcon', 'Badger', 'Lynx', 'Heron', 'Stoat', 'Marten', 'Osprey', 'Pike', 'Merlin'];

export interface DemoTeam {
  number: string;
  name: string;
  organisation: string;
  location: string;
  robot: string;
  pit: string;
  inspection: 'NOT_STARTED' | 'IN_PROGRESS' | 'PASSED';
}

export const TEAMS: DemoTeam[] = NAMES.map((name, i) => ({
  number: `${3000 + i * 37}${'ABCDE'[i % 5]}`,
  name,
  organisation: ORGS[i % ORGS.length],
  location: PLACES[i % PLACES.length],
  robot: `${ROBOTS[i % ROBOTS.length]} ${i + 1}`,
  pit: `Pit ${i + 1}`,
  inspection: i % 7 === 0 ? 'IN_PROGRESS' : i % 11 === 0 ? 'NOT_STARTED' : 'PASSED',
}));

export interface DemoMatch {
  n: number;
  label: string;
  field: number;
  scheduled_at: number;
  red: string[];
  blue: string[];
  score: [number, number] | null;
}

/** Local 09:00 today, in epoch seconds: the schedule is always "today". */
export function eventStart(): number {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export function buildMatches(played: number): DemoMatch[] {
  const r = rng(42);
  const start = eventStart();
  const out: DemoMatch[] = [];
  let n = 1;
  for (let round = 0; round < 6; round++) {
    const order = TEAMS.map((t) => t.number)
      .map((num) => ({ num, k: r() }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.num);
    for (let m = 0; m < 6; m++) {
      const [a, b, c, d] = order.slice(m * 4, m * 4 + 4);
      out.push({
        n,
        label: `Q${n}`,
        field: ((n - 1) % FIELD_COUNT) + 1,
        scheduled_at: start + Math.floor((n - 1) / FIELD_COUNT) * 8 * 60,
        red: [a, b],
        blue: [c, d],
        score: null,
      });
      n++;
    }
  }
  const s = rng(7);
  for (const m of out.slice(0, played)) m.score = scoreFor(s);
  return out;
}

export function scoreFor(next: () => number = Math.random): [number, number] {
  return [Math.round(30 + next() * 90), Math.round(30 + next() * 90)];
}

export interface RankRow {
  rank: number;
  team: string;
  team_name: string;
  wins: number;
  losses: number;
  ties: number;
  avg_points: number;
  high_score: number;
}

/** Rankings from the matches played so far: wins first, then average points. */
export function rankings(matches: DemoMatch[]): RankRow[] {
  const rows = new Map<string, RankRow & { total: number; played: number }>();
  for (const t of TEAMS) rows.set(t.number, { rank: 0, team: t.number, team_name: t.name, wins: 0, losses: 0, ties: 0, avg_points: 0, high_score: 0, total: 0, played: 0 });
  for (const m of matches) {
    if (!m.score) continue;
    const [rs, bs] = m.score;
    for (const [teams, mine, theirs] of [[m.red, rs, bs], [m.blue, bs, rs]] as const) {
      for (const num of teams) {
        const row = rows.get(num)!;
        row.played++;
        row.total += mine;
        row.high_score = Math.max(row.high_score, mine);
        if (mine > theirs) row.wins++;
        else if (mine < theirs) row.losses++;
        else row.ties++;
      }
    }
  }
  const list = [...rows.values()].map((r) => ({ ...r, avg_points: r.played ? Math.round((r.total / r.played) * 10) / 10 : 0 }));
  list.sort((a, b) => b.wins - a.wins || b.ties - a.ties || b.avg_points - a.avg_points || a.team.localeCompare(b.team));
  return list.map(({ total: _t, played: _p, ...r }, i) => ({ ...r, rank: i + 1 }));
}

export interface SkillRow {
  rank: number;
  team: string;
  team_name: string;
  total: number;
  driver: number;
  prog: number;
  driver_attempts: number;
  prog_attempts: number;
}

export function skills(): SkillRow[] {
  const r = rng(99);
  const rows = TEAMS.map((t) => {
    const driver = Math.round(10 + r() * 50);
    const prog = Math.round(5 + r() * 45);
    return { rank: 0, team: t.number, team_name: t.name, total: driver + prog, driver, prog, driver_attempts: 2, prog_attempts: 2 };
  });
  rows.sort((a, b) => b.total - a.total);
  return rows.map((x, i) => ({ ...x, rank: i + 1 }));
}

export const AGENDA = [
  { scope: 'day', start_time: '08:00', end_time: '09:00', title: 'Doors open and team check-in', details: 'Pick up your team pack at registration.' },
  { scope: 'day', start_time: '09:00', end_time: '09:30', title: 'Opening ceremony', details: null },
  { scope: 'day', start_time: '09:30', end_time: '12:30', title: 'Qualification matches', details: 'Fields 1 to 3.' },
  { scope: 'day', start_time: '12:30', end_time: '13:15', title: 'Lunch', details: null },
  { scope: 'day', start_time: '13:15', end_time: '14:30', title: 'Skills runs', details: 'Driver and programming skills.' },
  { scope: 'finals', start_time: '14:45', end_time: '15:30', title: 'Finals', details: 'Top teams play on the main field.' },
  { scope: 'finals', start_time: '15:45', end_time: '16:15', title: 'Awards ceremony', details: null },
];

export const SITE_CONFIG = {
  title: EVENT_NAME,
  presented_by: 'The TMTools demo',
  next_competition: {
    name: 'Demo Regional Championship',
    date: new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    location: 'Anytown Sports Hall',
    description: 'The next event on the calendar. This is demo data.',
    url: 'https://github.com/aroboticsteam/tmtools',
  },
  sponsors: [{ name: 'Acme Robotics' }, { name: 'Globex Components' }, { name: 'Initech Education' }],
  map: { rooms: [
    { name: 'Main hall', x: 50, y: 45, description: 'Fields 1 to 3 and the stage.', teams: [] as string[] },
    { name: 'Pits', x: 20, y: 70, description: 'Team pits and inspection.', teams: [] as string[] },
    { name: 'Cafe', x: 80, y: 20, description: 'Food and drink.', teams: [] as string[] },
  ] },
  recording_url_template: 'https://example.com/replays/{match}',
};
