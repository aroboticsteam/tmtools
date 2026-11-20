/** Pure helpers for the in-browser photo booth. */

/** Longest edge of a snapped still (the camera's own resolution is used up to this). */
export const MAX_PHOTO_EDGE = 2000;
export const PHOTO_COUNTDOWN_SECONDS = 3;
export const PHOTO_MIME = 'image/jpeg';
export const PHOTO_QUALITY = 0.92;

/** Largest centred square inside a `width` x `height` frame, as a source rect. */
export function squareCrop(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.max(0, Math.min(width, height));
  return { sx: Math.floor((width - size) / 2), sy: Math.floor((height - size) / 2), size };
}

/** Side length of the square still: the camera's short edge, capped. */
export function photoSize(width: number, height: number): number {
  return Math.max(1, Math.min(MAX_PHOTO_EDGE, width, height));
}

export function photoFileName(team: string, kind: string): string {
  return `${team}-${kind}.jpg`;
}

export function isValidTeamNumber(value: string): boolean {
  return /^[A-Za-z0-9]{1,20}$/.test(value.trim());
}
