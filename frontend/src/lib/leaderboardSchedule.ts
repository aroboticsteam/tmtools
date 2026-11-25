export const PANELS: [string, string][] = [
  ['overall', 'Overall'],
  ['tournament', 'Tournament'],
  ['skills', 'Skills'],
  ['awards', 'Awards'],
];

/**
 * The leaderboard rotation is a pure function of the wall clock, so several
 * screens stay in step and a reload doesn't restart the cycle.
 */
export function schedule(now: number, groupCount: number, panelSeconds: number, programmeSeconds: number) {
  const span = groupCount > 1 ? programmeSeconds : panelSeconds * PANELS.length;
  const inSpan = now % span;
  const group = groupCount > 1 ? Math.floor(now / programmeSeconds) % groupCount : 0;
  const panel = Math.floor(inSpan / panelSeconds) % PANELS.length;
  return { group, panel, progress: (inSpan % panelSeconds) / panelSeconds };
}
