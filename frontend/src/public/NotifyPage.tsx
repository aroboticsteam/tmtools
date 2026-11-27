import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/http';
import { themeCss } from './SitePage';
import { useSiteQuery } from './siteData';
import type { SiteOverview } from './siteData';
import { usePageChrome } from './usePageChrome';
import './site.css';

const STORE = 'tmtools-notify';
const CATEGORIES: [string, string][] = [
  ['arrival', 'Upcoming matches'],
  ['late', 'Late warnings'],
  ['score', 'Match scores'],
  ['announcement', 'Event announcements (lunch, finals…)'],
];

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface PushStatus {
  subscribed: boolean;
  teams: string[];
  categories: string[] | null;
}

const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone =
  (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Public "follow any teams" page (`/notify`): Web Push subscription for spectators. */
export function NotifyPage() {
  // Same look as /site: its colours come from the `site` setting's theme.
  const overview = useSiteQuery<SiteOverview>('overview');
  const siteTitle = overview.data?.title || 'Competition';
  const css = useMemo(() => themeCss(overview.data?.theme), [overview.data?.theme]);
  usePageChrome({
    title: 'Match alerts',
    themeColor: overview.data?.theme?.dark?.primary || '#171717',
    manifest: `${import.meta.env.BASE_URL}notify.webmanifest`,
    meta: { 'apple-mobile-web-app-capable': 'yes', 'mobile-web-app-capable': 'yes' },
  });

  const [allTeams, setAllTeams] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<Set<string>>(new Set(CATEGORIES.map((c) => c[0])));
  const [filter, setFilter] = useState('');
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);
  const [reg, setReg] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const teams = await apiFetch<{ team_number: string }[]>('/api/v1/public/site/teams');
        if (!live) return;
        setAllTeams(
          teams.map((t) => t.team_number).filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        );
      } catch (e) {
        if (live) setMsg({ text: `Could not load the team list: ${errorText(e)}`, err: true });
        return;
      }
      if (!supported) {
        if (live && !(isIos && !standalone)) setMsg({ text: "This browser can't receive notifications. Try Chrome, Safari, Edge or Firefox.", err: true });
        return;
      }
      if (!live) return;
      try {
        const saved = JSON.parse(localStorage.getItem(STORE) || '[]') as string[];
        setSelected(new Set(saved));
      } catch {
        /* storage blocked */
      }
      setReady(true);
      try {
        const r = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
        await navigator.serviceWorker.ready;
        if (!live) return;
        setReg(r);
        const existing = await r.pushManager.getSubscription();
        if (existing) {
          const st = await apiFetch<PushStatus>('/api/v1/public/push/status', { method: 'POST', body: { endpoint: existing.endpoint } });
          if (live && st.subscribed) {
            setSubscribed(true);
            setSelected(new Set(st.teams));
            if (st.categories) setCategories(new Set(st.categories));
          }
        }
      } catch (e) {
        if (live) setMsg({ text: `Could not set up notifications: ${errorText(e)}`, err: true });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const shown = useMemo(() => {
    const q = filter.trim().toUpperCase();
    return allTeams.filter((t) => !q || t.includes(q));
  }, [allTeams, filter]);

  const toggleTeam = (t: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  const toggleCategory = (c: string) =>
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  async function subscribe() {
    if (!reg) return;
    setBusy(true);
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser/site settings and try again.');
      const { public_key } = await apiFetch<{ public_key: string }>('/api/v1/public/push/vapid-key');
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(public_key) });
      const teams = [...selected];
      await apiFetch('/api/v1/public/push/subscribe', {
        method: 'POST',
        body: { endpoint: sub.endpoint, keys: sub.toJSON().keys, teams, categories: [...categories] },
      });
      setSubscribed(true);
      try {
        localStorage.setItem(STORE, JSON.stringify(teams));
      } catch {
        /* storage blocked */
      }
      setMsg({ text: `You're all set — alerts on for: ${teams.join(', ')}`, err: false });
    } catch (e) {
      setMsg({ text: errorText(e), err: true });
    }
    setBusy(false);
  }

  async function unsubscribe() {
    if (!reg) return;
    try {
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await apiFetch('/api/v1/public/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      setSelected(new Set());
      try {
        localStorage.removeItem(STORE);
      } catch {
        /* storage blocked */
      }
      setMsg({ text: 'Notifications turned off.', err: false });
    } catch (e) {
      setMsg({ text: errorText(e), err: true });
    }
  }

  return (
    <div className="pubsite notify-page">
      {css ? <style>{css}</style> : null}
      <header>
        <div className="bar">
          <h1>{siteTitle}</h1>
          <nav>
            <Link to="/site">Site</Link>
            <Link to="/notify" className="active">Alerts</Link>
          </nav>
        </div>
      </header>
      <main>
        <h2>Match alerts</h2>
        <p className="muted">Pick any team(s) and get a notification before each match and when scores are posted.</p>
        {msg ? <div className={`msg${msg.err ? ' err' : ''}`} role={msg.err ? 'alert' : 'status'}>{msg.text}</div> : null}
        {isIos && !standalone ? (
          <div className="msg">
            <b>One more step on iPhone/iPad:</b> tap the Share button, choose <b>Add to Home Screen</b>, then open this page from
            the new icon to turn notifications on. (iOS only allows alerts for installed web apps.)
          </div>
        ) : null}
        {ready ? (
          <section className="card">
            <input type="search" placeholder="Search teams…" autoComplete="off" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="list">
              {shown.map((t) => (
                <label key={t} className="row">
                  <input type="checkbox" checked={selected.has(t)} onChange={() => toggleTeam(t)} />
                  {t}
                </label>
              ))}
            </div>
            <div className="count">{selected.size} selected</div>
            <fieldset>
              <legend className="count">Notify me about</legend>
              {CATEGORIES.map(([key, label]) => (
                <label key={key} className="row">
                  <input type="checkbox" checked={categories.has(key)} onChange={() => toggleCategory(key)} /> {label}
                </label>
              ))}
            </fieldset>
            <button type="button" className="wide" disabled={busy || selected.size === 0 || !reg} onClick={subscribe}>
              {subscribed ? 'Update my teams' : 'Turn on notifications'}
            </button>
            {subscribed ? (
              <button type="button" className="wide secondary" onClick={unsubscribe}>
                Turn off notifications
              </button>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
