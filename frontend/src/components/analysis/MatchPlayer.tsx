import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Repeat, RotateCcw, Rewind, FastForward } from 'lucide-react';
import { useRecordingUrl } from '../../api/capture';
import { SPEEDS } from '../../lib/analysis';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Tabs';
import type { CaptureRecording } from '../../types/api';

/** Seek request from outside (a moment's Preview button). `n` changes on every request so the same time can repeat. */
export interface SeekRequest {
  t: number;
  n: number;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Where a moment sits on the match timeline: the clip is the `length_s` before its end offset. */
export function momentSpan(m: { end_offset_ms: number | null; length_s: number }, total: number): { start: number; end: number } | null {
  if (m.end_offset_ms == null || total <= 0) return null;
  const end = Math.min(total, m.end_offset_ms / 1000);
  return { start: Math.max(0, end - m.length_s), end };
}

/** Plays the whole recorded match in the page, with the cut moments marked on the scrubber. */
export function MatchPlayer({
  recording,
  seek,
}: {
  recording: CaptureRecording | null;
  seek: SeekRequest | null;
}) {
  const [speed, setSpeed] = useState<number>(1);
  const ready = recording?.status === 'READY';
  const { data: link, isError, refetch } = useRecordingUrl(recording?.id ?? null, ready);
  const video = useRef<HTMLVideoElement | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(recording?.duration_s ?? 0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [failed, setFailed] = useState(false);

  // A different match (or a fresh link) starts from the top.
  useEffect(() => {
    setTime(0);
    setPlaying(false);
    setFailed(false);
    setDuration(recording?.duration_s ?? 0);
  }, [recording?.id, recording?.duration_s]);

  useEffect(() => {
    if (video.current) video.current.playbackRate = speed;
  }, [speed, link?.url]);

  useEffect(() => {
    const el = video.current;
    if (!seek || !el) return;
    el.currentTime = seek.t;
    void el.play().catch(() => undefined);
  }, [seek]);

  const toggle = () => {
    const el = video.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  };
  const jump = (to: number) => {
    const el = video.current;
    if (el) el.currentTime = Math.min(Math.max(0, to), duration || el.duration || to);
  };

  let overlay: string | null = null;
  if (!recording) overlay = 'Pick a match to watch it';
  else if (recording.status === 'QUEUED') overlay = 'On a field, waiting to start. The video appears here once it is recorded.';
  else if (recording.status === 'RECORDING') overlay = 'Recording now. The full video is ready once the match ends.';
  else if (recording.status === 'STOPPED') overlay = 'Processing the match video…';
  else if (recording.status === 'ERROR') overlay = recording.error ?? 'This recording failed';
  else if (isError || failed) overlay = 'Could not load the video';
  else if (!link) overlay = 'Loading the video…';

  const live = !!link && ready && !overlay;

  return (
    <section aria-label="Match video" className="overflow-hidden rounded-xl border border-vmd-border bg-white">
      <div className="relative aspect-video bg-black">
        {ready && link && (
          <video
            ref={video}
            src={link.url}
            preload="metadata"
            playsInline
            loop={loop}
            className="h-full w-full"
            data-testid="match-video"
            onClick={toggle}
            onLoadedMetadata={(e) => {
              setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : recording?.duration_s ?? 0);
              e.currentTarget.playbackRate = speed;
            }}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => setFailed(true)}
          />
        )}
        {overlay && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-white/80">
            <span>{overlay}</span>
            {(isError || failed) && ready && (
              <Button size="sm" onClick={() => { setFailed(false); void refetch(); }}>Try again</Button>
            )}
          </div>
        )}
        {recording && (
          <div className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-0.5 text-xs text-white">
            {recording.match_type} {recording.match_number}
          </div>
        )}
      </div>

      <div className="px-4 pt-3">
        <div className="relative h-6">
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-neutral-200">
            <div className="h-full rounded-full bg-neutral-900" style={{ width: duration ? `${(time / duration) * 100}%` : 0 }} />
            {recording?.moments.map((m) => {
              const span = momentSpan(m, duration);
              if (!span) return null;
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-label={`Jump to moment ${m.number}`}
                  title={`Moment ${m.number}`}
                  disabled={!live}
                  onClick={() => jump(span.start)}
                  className="absolute top-1/2 h-3.5 -translate-y-1/2 rounded-sm bg-red-600/80 hover:bg-red-600"
                  style={{ left: `${(span.start / duration) * 100}%`, width: `max(6px, ${((span.end - span.start) / duration) * 100}%)` }}
                />
              );
            })}
          </div>
          <input
            type="range"
            aria-label="Seek"
            min={0}
            max={duration || 1}
            step={0.1}
            value={Math.min(time, duration || 1)}
            disabled={!live}
            onChange={(e) => jump(Number(e.target.value))}
            className="absolute inset-0 h-6 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          />
        </div>
        <div className="mt-1 flex justify-between text-xs tabular-nums text-vmd-textSubtle">
          <span>{formatClock(time)}</span>
          <span>{duration ? formatClock(duration) : '--:--'}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 p-3">
        <Button disabled={!live} onClick={toggle} aria-label={playing ? 'Pause video' : 'Play video'}>
          {playing ? <Pause size={16} /> : <Play size={16} />} {playing ? 'Pause' : 'Play'}
        </Button>
        <Button disabled={!live} aria-label="Back 5 seconds" onClick={() => jump(time - 5)}><Rewind size={16} /> 5 s</Button>
        <Button disabled={!live} aria-label="Forward 5 seconds" onClick={() => jump(time + 5)}><FastForward size={16} /> 5 s</Button>
        <Button disabled={!live} aria-pressed={loop} onClick={() => setLoop((v) => !v)} className={loop ? 'border-neutral-900' : ''}>
          <Repeat size={16} /> Loop
        </Button>
        <Button disabled={!live} aria-label="Restart video" onClick={() => jump(0)}><RotateCcw size={16} /></Button>
        <div className="ml-auto">
          <Segmented options={SPEEDS.map((s) => ({ id: String(s), label: `${s}×` }))} value={String(speed)} onChange={(id) => setSpeed(Number(id))} />
        </div>
      </div>
    </section>
  );
}
