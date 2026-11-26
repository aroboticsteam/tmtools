/** Pure helpers for the OBS team overlay (`public/OverlayPage.tsx`). */

// Country name -> ISO 3166 alpha-2 code. Shown as an image from flagcdn.com when
// reachable, else as the white code badge (so an offline stream still reads correctly).
const ISO: Record<string, string> = {
  'united kingdom': 'gb', uk: 'gb', 'u.k.': 'gb', 'great britain': 'gb', gb: 'gb', england: 'gb', scotland: 'gb', wales: 'gb', 'northern ireland': 'gb',
  turkey: 'tr', 'türkiye': 'tr', turkiye: 'tr', 'united states': 'us', usa: 'us', 'united states of america': 'us', canada: 'ca', mexico: 'mx',
  china: 'cn', 'hong kong': 'hk', taiwan: 'tw', japan: 'jp', 'south korea': 'kr', korea: 'kr', india: 'in', australia: 'au', 'new zealand': 'nz',
  singapore: 'sg', malaysia: 'my', thailand: 'th', philippines: 'ph', indonesia: 'id', vietnam: 'vn', 'saudi arabia': 'sa',
  'united arab emirates': 'ae', uae: 'ae', qatar: 'qa', egypt: 'eg', 'south africa': 'za', brazil: 'br', chile: 'cl', colombia: 'co',
  argentina: 'ar', ireland: 'ie', france: 'fr', germany: 'de', spain: 'es', italy: 'it', portugal: 'pt', netherlands: 'nl',
  belgium: 'be', switzerland: 'ch', austria: 'at', poland: 'pl', 'czech republic': 'cz', czechia: 'cz', sweden: 'se', norway: 'no',
  denmark: 'dk', finland: 'fi', greece: 'gr', romania: 'ro', bulgaria: 'bg', hungary: 'hu', ukraine: 'ua', israel: 'il', jordan: 'jo',
  kuwait: 'kw', bahrain: 'bh', oman: 'om', pakistan: 'pk', 'sri lanka': 'lk', bangladesh: 'bd', nepal: 'np', kazakhstan: 'kz',
};

export function isoFor(country: unknown): string {
  const c = String(country ?? '').trim().toLowerCase();
  if (/^[a-z]{2}$/.test(c) && c !== 'uk') return c;
  return ISO[c] || '';
}

export function flagFor(country: unknown): string {
  return isoFor(country).toUpperCase();
}

const ROUNDS: Record<string, string> = { QUAL: 'Q', PRACTICE: 'P', PRAC: 'P', R16: 'R16', QF: 'QF', SF: 'SF', F: 'F', FINAL: 'F', FINALS: 'F', SKILLS: 'S' };

export function bannerText(payload: { round?: string; matchNum?: number | string | null } | null | undefined): string {
  const round = String(payload?.round ?? '').toUpperCase();
  const num = payload?.matchNum;
  const prefix = ROUNDS[round] || round.slice(0, 3);
  return [prefix, num != null ? num : ''].filter((x) => x !== '').join(' ');
}

export type RawTeam = string | { team_number?: string; number?: string; team_name?: string; name?: string; rank?: number; bot_url?: string; team_url?: string };

export function teamNumberOf(t: RawTeam | null | undefined): string {
  return typeof t === 'string' ? t : (t && (t.team_number || t.number)) || '';
}

export interface FeedTeam {
  team_name?: string | null;
  organisation?: string | null;
  location?: string | null;
  country?: string | null;
  qual_rank?: number | null;
  bot_url?: string | null;
  team_url?: string | null;
  robot_name?: string | null;
}

export interface OverlayTeam {
  team_number: string;
  team_name: string | null;
  organisation: string | null;
  location: string | null;
  country: string | null;
  rank: number | null;
  bot_url: string | null;
  team_url: string | null;
  robot_name: string | null;
}

/** Merges the match payload's team entry (string or enriched object) with the public overlay feed's display info. */
export function normalizeTeam(team: RawTeam | null | undefined, feed: Record<string, FeedTeam> | undefined): OverlayTeam {
  const obj = typeof team === 'string' ? { team_number: team } : team || {};
  const number = (obj as { team_number?: string }).team_number || (obj as { number?: string }).number || '';
  const info = (feed && feed[number]) || {};
  const o = obj as { team_name?: string; name?: string; rank?: number; bot_url?: string; team_url?: string };
  return {
    team_number: number,
    team_name: info.team_name || o.team_name || o.name || null,
    organisation: info.organisation || null,
    location: info.location || null,
    country: info.country || null,
    rank: (info.qual_rank != null ? info.qual_rank : o.rank) || null,
    bot_url: info.bot_url || o.bot_url || null,
    team_url: info.team_url || o.team_url || null,
    robot_name: info.robot_name || null,
  };
}

export interface MatchPayload {
  round?: string;
  matchNum?: number | string | null;
  redTeams?: RawTeam[];
  blueTeams?: RawTeam[];
}

export type Layout =
  | { mode: 'iq'; teams: OverlayTeam[]; payload: MatchPayload }
  | { mode: 'vrc'; red: OverlayTeam[]; blue: OverlayTeam[]; payload: MatchPayload }
  | { mode: 'finals'; team: OverlayTeam };
