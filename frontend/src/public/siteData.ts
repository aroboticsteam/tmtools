import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/http';
import { siteDataUrl } from './siteUrl';

// Shapes of `/api/v1/public/site/*` (backend/routers/public_site.py). Loose on purpose: the
// backend adds fields freely and the page only reads what it shows.

export interface SiteMatch {
  label: string;
  division?: string | number;
  programme?: string | null;
  scheduled_at: number | null;
  red: string[];
  blue: string[];
  score: number[] | null;
  recording_url?: string | null;
}
export interface SiteRank {
  rank: number;
  division?: string | number;
  team: string;
  team_name?: string | null;
  wins?: number | null;
  losses?: number | null;
  ties?: number | null;
  avg_points?: number | null;
  high_score?: number | null;
}
export interface SiteSkill {
  rank: number;
  tie?: boolean;
  division?: string | number;
  team: string;
  team_name?: string | null;
  total?: number | null;
  driver?: number | null;
  prog?: number | null;
  driver_attempts?: number | null;
  prog_attempts?: number | null;
}
export interface AgendaEntry {
  scope: string;
  start_time: string;
  end_time?: string | null;
  title: string;
  details?: string | null;
}
export interface SiteEvent {
  divisions: Record<string, { programme?: string }>;
  agenda: AgendaEntry[];
  matches: SiteMatch[];
  rankings: SiteRank[];
  skills: SiteSkill[];
}
export interface SiteOverview {
  title: string;
  presented_by?: string | null;
  theme?: { dark?: Record<string, string>; light?: Record<string, string> } | null;
  hero?: { image_url?: string | null } | null;
  map?: { image_url?: string; rooms?: { name: string; x: number; y: number; description?: string; teams?: string[] }[] } | null;
  sponsors?: { name?: string | null; logo_url?: string | null; url?: string | null }[];
  next_competition?: {
    name?: string;
    date?: string;
    location?: string;
    days_until?: number | null;
    description?: string;
    teams?: string[];
    url?: string;
    registration_url?: string;
  } | null;
}
export interface SiteTeamSummary {
  team_number: string;
  team_name?: string | null;
  organisation?: string | null;
  division?: string | number | null;
  qual_rank: number | null;
  skills_rank: number | null;
  pit_location?: string | null;
}
export interface SiteTeam {
  team_number: string;
  team_name?: string | null;
  logo_url?: string | null;
  website_url?: string | null;
  programme?: string | null;
  organisation?: string | null;
  location?: string | null;
  robot_name?: string | null;
  division?: string | number | null;
  pit_location?: string | null;
  current: Record<string, number | null | undefined>;
  season: {
    events_attended?: number | null;
    awards?: number | null;
    world_skills_rank?: number | null;
    previous_rankings?: Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    award_list?: Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  downloads?: Record<string, { url?: string; name?: string } | undefined>;
  photos?: Record<string, string | undefined>;
  schedule: SiteMatch[];
}
export interface Livestream {
  name: string;
  stream_url: string;
}

export function useSiteQuery<T>(path: string, options: { refetchMs?: number; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['public-site-page', path],
    queryFn: () => apiFetch<T>(siteDataUrl(path)),
    refetchInterval: options.refetchMs,
    enabled: options.enabled ?? true,
    retry: 2,
  });
}
