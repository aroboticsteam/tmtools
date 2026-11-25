import { useCallback, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { usePageChrome } from './usePageChrome';
import { usePublicSocket } from './usePublicSocket';
import './overlay.css';

interface ReplayMessage {
  type?: string;
  url?: string;
  rate?: number | string;
  value?: number | string;
  loop?: boolean;
  paused?: boolean;
  label?: string;
}

/**
 * Replay player (`/replay/{entity_id}`): an OBS browser source, 1920x1080. The
 * analysis deck's "send to program" tells the server which video to play; the
 * server pushes it here over `/ws/replay/{entity_id}`. No auth: the URL is only
 * ever pasted into OBS. When nothing is playing the page is fully transparent.
 */
export function ReplayPage() {
  const { entityId = '' } = useParams();
  const [params] = useSearchParams();
  const showLabel = params.get('label') === '1';
  const video = useRef<HTMLVideoElement>(null);
  const label = useRef<HTMLDivElement>(null);
  const rate = useRef(0.5);

  usePageChrome({
    title: 'TMTools Replay',
    body: { background: 'transparent', overflow: 'hidden', margin: '0', width: '1920px', height: '1080px' },
  });

  const handle = useCallback(
    (msg: unknown) => {
      const v = video.current;
      const l = label.current;
      const m = msg as ReplayMessage | null;
      if (!v || !l || !m || typeof m !== 'object') return;
      switch (m.type) {
        case 'play': {
          if (!m.url) return;
          rate.current = Number(m.rate) || 0.5;
          v.loop = !!m.loop;
          v.src = m.url;
          v.load();
          v.playbackRate = rate.current;
          v.classList.add('on');
          if (showLabel && m.label) {
            l.textContent = m.label;
            l.classList.add('on');
          }
          const p = m.paused ? null : v.play();
          if (p && p.catch) p.catch(() => undefined);
          break;
        }
        case 'pause':
          v.pause();
          break;
        case 'resume':
          v.play().catch(() => undefined);
          break;
        case 'restart':
          v.currentTime = 0;
          v.play().catch(() => undefined);
          break;
        case 'rate':
          rate.current = Number(m.value) || rate.current;
          v.playbackRate = rate.current;
          break;
        case 'seek':
          v.currentTime = Math.max(0, Number(m.value) || 0);
          break;
        case 'stop':
          v.pause();
          v.classList.remove('on');
          l.classList.remove('on');
          // Drop the source once the fade has finished so nothing keeps buffering.
          window.setTimeout(() => {
            if (!v.classList.contains('on')) {
              v.removeAttribute('src');
              v.load();
            }
          }, 300);
          break;
        default:
          break;
      }
    },
    [showLabel],
  );

  // The browser resets playbackRate when the source changes; keep it applied.
  useEffect(() => {
    const v = video.current;
    if (!v) return undefined;
    const apply = () => {
      if (v.playbackRate !== rate.current) v.playbackRate = rate.current;
    };
    v.addEventListener('loadedmetadata', apply);
    v.addEventListener('playing', apply);
    return () => {
      v.removeEventListener('loadedmetadata', apply);
      v.removeEventListener('playing', apply);
    };
  }, []);

  usePublicSocket(`/ws/replay/${encodeURIComponent(entityId)}`, handle);

  return (
    <div className="obs-stage replay-stage" id="stage">
      <video id="player" ref={video} playsInline preload="auto" />
      <div id="label" ref={label} />
    </div>
  );
}
