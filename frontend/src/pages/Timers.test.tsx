import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TimersPage } from './Timers';

const timers = [
  { entity_id: 'timer.field1', display_name: 'Field 1 timer', field_set_id: 1, field_id: 1, duration_s: 60, tags: [], prompter_token: 'tok123' },
];
const t = { start: vi.fn(), stop: vi.fn(), reset: vi.fn(), update: vi.fn(), del: vi.fn() };
const perms = vi.hoisted(() => ({ denied: new Set<string>() }));

vi.mock('../api/timers', () => ({
  useTimers: () => ({ data: timers, isLoading: false }),
  useStartTimer: () => ({ mutate: t.start }),
  useStopTimer: () => ({ mutate: t.stop }),
  useResetTimer: () => ({ mutate: t.reset }),
  useUpdateTimer: () => ({ mutate: t.update, isPending: false }),
  useDeleteTimer: () => ({ mutate: t.del }),
  useCreateTimer: () => ({ mutate: vi.fn(), isPending: false }),
  useCues: () => ({ data: [] }),
  useCreateCue: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateCue: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteCue: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useWebSocket', () => ({ useWebSocket: vi.fn() }));
vi.mock('../hooks/usePermission', () => ({ usePermission: (p: string) => !perms.denied.has(p) }));

const renderPage = () => render(<MemoryRouter><TimersPage /></MemoryRouter>);

describe('TimersPage', () => {
  beforeEach(() => {
    Object.values(t).forEach((fn) => fn.mockReset());
    perms.denied.clear();
  });

  it('lists timers with their teleprompter link', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Timers' })).toBeInTheDocument();
    const section = screen.getByTestId('timers-section');
    expect(within(section).getByText('Field 1 timer')).toBeInTheDocument();
    expect(within(section).getByText(/\/prompter\/timer\.field1\?token=tok123/)).toBeInTheDocument();
  });

  it('drives a timer and regenerates its prompter token', async () => {
    const user = userEvent.setup();
    renderPage();
    const section = screen.getByTestId('timers-section');
    await user.click(within(section).getByRole('button', { name: /Start/ }));
    expect(t.start).toHaveBeenCalledWith('timer.field1');
    await user.click(within(section).getByRole('button', { name: /Stop/ }));
    expect(t.stop).toHaveBeenCalledWith('timer.field1');
    await user.click(within(section).getByRole('button', { name: /Regenerate token/ }));
    expect(t.update).toHaveBeenCalledWith({ entityId: 'timer.field1', body: { regenerate_token: true } }, expect.anything());
    await user.click(within(section).getByRole('button', { name: 'Manage cues' }));
    expect(within(section).getByRole('button', { name: 'Hide cues' })).toBeInTheDocument();
  });

  it('opens the timer editor from New timer', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /New timer/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('hides everything without timers:read and the controls without the other permissions', () => {
    perms.denied.add('timers:read');
    const { unmount } = renderPage();
    expect(screen.queryByTestId('timers-section')).not.toBeInTheDocument();
    unmount();
    perms.denied.clear();
    perms.denied.add('prompter:control');
    perms.denied.add('timers:edit');
    renderPage();
    const section = screen.getByTestId('timers-section');
    expect(within(section).queryByRole('button', { name: /Start/ })).not.toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: /Regenerate token/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New timer/i })).not.toBeInTheDocument();
  });
});
