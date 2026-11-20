import { describe, expect, it } from 'vitest';
import { MAX_PHOTO_EDGE, isValidTeamNumber, photoFileName, photoSize, squareCrop } from './recorder';

describe('photo booth helpers', () => {
  it('crops the largest centred square', () => {
    expect(squareCrop(1920, 1080)).toEqual({ sx: 420, sy: 0, size: 1080 });
    expect(squareCrop(600, 800)).toEqual({ sx: 0, sy: 100, size: 600 });
  });
  it('uses the camera short edge, capped', () => {
    expect(photoSize(1920, 1080)).toBe(1080);
    expect(photoSize(6000, 4000)).toBe(MAX_PHOTO_EDGE);
    expect(photoSize(0, 0)).toBe(1);
  });
  it('names files and validates team numbers', () => {
    expect(photoFileName('1234A', 'bot_photo')).toBe('1234A-bot_photo.jpg');
    expect(isValidTeamNumber(' 1234A ')).toBe(true);
    expect(isValidTeamNumber('12 34')).toBe(false);
  });
});
