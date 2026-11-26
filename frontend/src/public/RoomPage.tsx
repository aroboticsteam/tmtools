import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, apiFetch } from '../lib/http';
import { usePageChrome } from './usePageChrome';
import { usePublicSocket } from './usePublicSocket';
import './screens.css';

interface RoomInfo {
  name: string;
  teams: string[];
  stream_url: string | null;
}

interface Notice {
  id?: string;
  title: string;
  message: string;
  modal?: boolean;
  duration?: number;
}

/** Public room display (`/room/{slug}`): livestream embed plus live notices from `/ws/room/{slug}`. */
export function RoomPage() {
  const { slug = '' } = useParams();
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const [toasts, setToasts] = useState<(Notice & { key: number })[]>([]);
  const [modal, setModal] = useState<Notice | null>(null);
  const seen = useRef(new Set<string>());
  const modalTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nextKey = useRef(0);

  usePageChrome({ title: room?.name ?? 'Room display', body: { background: '#0f1115' } });

  useEffect(() => {
    let live = true;
    const load = () =>
      apiFetch<RoomInfo>(`/api/v1/public/rooms/${encodeURIComponent(slug)}`)
        .then((r) => live && (setRoom(r), setMissing(false)))
        .catch((e) => {
          if (live && e instanceof ApiError && e.status === 404) setMissing(true);
        });
    void load();
    const id = setInterval(load, 60000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [slug]);

  const hideModal = useCallback(() => {
    clearTimeout(modalTimer.current);
    setModal(null);
  }, []);

  const onMessage = useCallback(
    (raw: unknown) => {
      const m = raw as Notice & { type?: string };
      if (m?.type !== 'notice') return;
      if (m.id) {
        if (seen.current.has(m.id)) return;
        seen.current.add(m.id);
      }
      if (m.modal) {
        setModal(m);
        clearTimeout(modalTimer.current);
        modalTimer.current = setTimeout(hideModal, Math.max(10, m.duration || 60) * 1000);
      } else {
        const key = nextKey.current++;
        setToasts((t) => [...t, { ...m, key }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.key !== key)), Math.max(5, m.duration || 30) * 1000);
      }
    },
    [hideModal],
  );

  const { status } = usePublicSocket(missing ? null : `/ws/room/${encodeURIComponent(slug)}`, onMessage, { ping: true });
  useEffect(() => () => clearTimeout(modalTimer.current), []);

  if (missing) return <div className="pub-screen room-page"><div className="notfound">Room not found.</div></div>;

  return (
    <div className="pub-screen room-page">
      <header>
        <h1>{room?.name ?? 'Room'}</h1>
        <div className="teams">
          {(room?.teams ?? []).map((t) => (
            <span key={t} className="chip">{t}</span>
          ))}
        </div>
      </header>
      <main>
        {room?.stream_url ? (
          <div className="video">
            <iframe
              key={room.stream_url}
              title="Livestream"
              src={room.stream_url}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>
        ) : null}
      </main>
      <div className="room-toasts">
        {toasts.map((t) => (
          <div key={t.key} className="room-toast">
            <b>{t.title}</b>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
      {modal ? (
        <div className="room-modal">
          <div className="box">
            <h2>{modal.title}</h2>
            <p>{modal.message}</p>
            <button type="button" onClick={hideModal}>Dismiss</button>
          </div>
        </div>
      ) : null}
      <div className="status">{status === 'live' ? 'live' : status === 'connecting' ? 'connecting…' : 'reconnecting…'}</div>
    </div>
  );
}
