import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MatchPlayer, formatClock, momentSpan } from './MatchPlayer';
import type { CaptureRecording } from '../../types/api';

vi.mock('../../api/capture', () => ({
  useRecordingUrl: (_id: string | null, enabled: boolean) => ({
    data: enabled ? { url: 'http://media.test/m.mp4', label: 'Q 4' } : undefined,
    isError: false,
    refetch: vi.fn(),
  }),
}));

const rec = (over: Partial<CaptureRecording> = {}): CaptureRecording => ({
  id: 'r1', match_key: 'k', match_type: 'QUAL', match_number: '4', teams: [], alliances: null, status: 'READY',
  started_at: '', stopped_at: null, duration_s: 60, size_bytes: 1, error: null,
  moments: [{ id: 'm1', number: 1, length_s: 5, status: 'READY', end_offset_ms: 30000, ready_ms: 1, requested_at: '', error: null }],
  ...over,
});

describe('MatchPlayer', () => {
  it('plays the full match video and marks the moment on the scrubber', () => {
    render(<MatchPlayer recording={rec()} seek={null} />);
    expect(screen.getByTestId('match-video')).toHaveAttribute('src', 'http://media.test/m.mp4');
    expect(screen.getByLabelText('Jump to moment 1')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Play video' })).toBeEnabled();
  });

  it('says so instead of showing a broken player while the match is still recording', () => {
    render(<MatchPlayer recording={rec({ status: 'RECORDING' })} seek={null} />);
    expect(screen.queryByTestId('match-video')).not.toBeInTheDocument();
    expect(screen.getByText(/ready once the match ends/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play video' })).toBeDisabled();
  });

  it('asks for a match when none is picked', () => {
    render(<MatchPlayer recording={null} seek={null} />);
    expect(screen.getByText(/pick a match/i)).toBeInTheDocument();
  });

  it('places a moment as the clip length before its end offset', () => {
    expect(momentSpan({ end_offset_ms: 30000, length_s: 5 }, 60)).toEqual({ start: 25, end: 30 });
    expect(momentSpan({ end_offset_ms: 2000, length_s: 5 }, 60)).toEqual({ start: 0, end: 2 });
    expect(momentSpan({ end_offset_ms: null, length_s: 5 }, 60)).toBeNull();
    expect(formatClock(75)).toBe('1:15');
  });
});
