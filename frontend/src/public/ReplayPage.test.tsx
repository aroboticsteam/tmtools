import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayPage } from './ReplayPage';
import { installFakeSocket, lastSocket } from './testSocket';

let video: HTMLVideoElement;
const handle = (msg: unknown) => act(() => lastSocket().deliver(msg));

beforeEach(() => {
  installFakeSocket();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  render(
    <MemoryRouter initialEntries={['/replay/main?label=1']}>
      <Routes>
        <Route path="/replay/:entityId" element={<ReplayPage />} />
      </Routes>
    </MemoryRouter>,
  );
  video = document.getElementById('player') as HTMLVideoElement;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('replay player', () => {
  it('connects to the replay channel for its id', () => {
    expect(lastSocket().url).toContain('/ws/replay/main');
  });

  it('plays a url at the requested rate, shows the caption, and ignores play without url', () => {
    handle({ type: 'play' });
    expect(video.classList.contains('on')).toBe(false);
    handle({ type: 'play', url: 'http://s3/x.mp4', label: 'Q 7 · moment 1', rate: 0.25, loop: true });
    expect(video.getAttribute('src')).toBe('http://s3/x.mp4');
    expect(video.playbackRate).toBe(0.25);
    expect(video.loop).toBe(true);
    expect(video.classList.contains('on')).toBe(true);
    expect(document.getElementById('label')?.textContent).toBe('Q 7 · moment 1');
    expect(video.play).toHaveBeenCalled();
  });

  it('starts paused when told to, and handles pause/resume/rate/seek/restart', () => {
    handle({ type: 'play', url: 'http://s3/x.mp4', paused: true });
    expect(video.play).not.toHaveBeenCalled();
    handle({ type: 'resume' });
    expect(video.play).toHaveBeenCalledTimes(1);
    handle({ type: 'pause' });
    expect(video.pause).toHaveBeenCalled();
    handle({ type: 'rate', value: 0.75 });
    expect(video.playbackRate).toBe(0.75);
    handle({ type: 'seek', value: 4 });
    expect(video.currentTime).toBe(4);
    handle({ type: 'restart' });
    expect(video.currentTime).toBe(0);
  });

  it('stop hides the video and ignores junk messages', () => {
    handle({ type: 'play', url: 'http://s3/x.mp4' });
    handle(null);
    handle({ type: 'nonsense' });
    handle({ type: 'stop' });
    expect(video.classList.contains('on')).toBe(false);
    expect(document.getElementById('label')?.classList.contains('on')).toBe(false);
  });
});
