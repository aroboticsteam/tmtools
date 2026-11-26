import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, apiFetch } from '../lib/http';
import { usePageChrome } from './usePageChrome';

interface Entry {
  entity_id: string;
  display_name: string;
  link: string;
}

/** Token-gated listing of every active teleprompter (`/prompter?token=...`). */
export function PrompterIndexPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePageChrome({ title: 'TMTools Teleprompter Index', body: { background: '#111' } });

  useEffect(() => {
    let live = true;
    apiFetch<Entry[]>('/api/v1/public/prompter-index', { query: { token } })
      .then((r) => live && setRows(r))
      .catch((e) => live && setError(e instanceof ApiError && e.status === 403 ? 'Invalid or missing prompter index token' : 'Could not load the index'));
    return () => {
      live = false;
    };
  }, [token]);

  return (
    <div style={{ minHeight: '100vh', background: '#111', color: '#eee', padding: '2rem', fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Teleprompter Index</h1>
      {error ? <p role="alert" style={{ color: '#888' }}>{error}</p> : null}
      {rows && !rows.length ? <p style={{ color: '#888' }}>No active timer instances.</p> : null}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {(rows ?? []).map((r) => (
          <li key={r.entity_id} style={{ padding: '.5rem 0', borderBottom: '1px solid #333' }}>
            <a href={r.link} style={{ color: '#6cf', fontSize: '1.05rem' }}>{r.display_name}</a>{' '}
            <span style={{ color: '#888', fontSize: '.85rem' }}>({r.entity_id})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
