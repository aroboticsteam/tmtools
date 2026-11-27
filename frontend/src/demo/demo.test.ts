import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/http';
import type { Automation, IntegrationInstance, TriggerResponse } from '../types/api';
import { demoFetch } from './server';
import { db } from './state';

describe('demo fake API', () => {
  it('signs in as an admin with every permission', async () => {
    const me = await demoFetch<{ authenticated: boolean; permissions: string[] }>('/api/v1/auth/whoami');
    expect(me.authenticated).toBe(true);
    expect(me.permissions).toContain('settings:edit');
  });

  it('answers unknown routes with a 404 ApiError', async () => {
    await expect(demoFetch('/api/v1/nope')).rejects.toBeInstanceOf(ApiError);
  });

  it('serves the public site from the same matches the admin sees', async () => {
    const event = await demoFetch<{ matches: { score: number[] | null }[]; rankings: unknown[] }>('/api/v1/public/site/event');
    expect(event.matches).toHaveLength(db.matches.length);
    expect(event.matches.filter((m) => m.score).length).toBe(db.matches.filter((m) => m.score).length);
    expect(event.rankings).toHaveLength(24);
  });

  it('keeps edits in memory and returns copies', async () => {
    const before = await demoFetch<IntegrationInstance[]>('/api/v1/integrations');
    before[0].display_name = 'mutated locally';
    const after = await demoFetch<IntegrationInstance[]>('/api/v1/integrations');
    expect(after[0].display_name).not.toBe('mutated locally');
  });

  it('calls a fake integration service and changes its state', async () => {
    await demoFetch('/api/v1/integrations/obs.main/service/switch_scene', { method: 'POST', body: { scene_name: 'Replay' } });
    const st = await demoFetch<{ state: { current_scene: string } }>('/api/v1/integrations/obs.main/state');
    expect(st.state.current_scene).toBe('Replay');
  });

  it('refuses a call to a disconnected integration', async () => {
    await expect(demoFetch('/api/v1/integrations/spotify.main/service/pause', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 502 });
  });

  it('runs an automation and records the run', async () => {
    const autos = await demoFetch<Automation[]>('/api/v1/automations');
    const a = autos.find((x) => x.alias === 'Match end: strip back to idle')!;
    const res = await demoFetch<TriggerResponse>(`/api/v1/automations/${a.id}/trigger`, { method: 'POST' });
    expect(res.status).toBe('success');
    expect(db.integrationState['wled.field1'].preset).toBe(1);
    const runs = await demoFetch<unknown[]>(`/api/v1/automations/${a.id}/runs`);
    expect(runs.length).toBeGreaterThan(0);
  });

  it('checks a prompter token', async () => {
    await expect(demoFetch('/api/v1/public/prompter/timer.field_1', { query: { token: 'wrong' } })).rejects.toMatchObject({ status: 403 });
    await expect(demoFetch('/api/v1/public/prompter/timer.field_1', { query: { token: 'demo-token-1' } })).resolves.toBeTruthy();
  });
});
