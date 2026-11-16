import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommsPage } from './Comms';
import { useUiStore } from '../stores/ui';

const m = {
  rotate: vi.fn(),
  setPin: vi.fn(),
  unsecure: vi.fn(),
  reorder: vi.fn(),
  importAgenda: vi.fn(),
  delStation: vi.fn(),
};
const noop = { mutate: vi.fn(), isPending: false };

const stations = [
  { slug: 'emcee-1', name: 'Main emcee', role: 'emcee', secured: false, has_pin: false, connected: true, last_seen: Date.now() / 1000 },
  { slug: 'cam-1', name: 'Camera 1', role: 'camera', secured: true, has_pin: true, connected: false, last_seen: Date.now() / 1000 - 600 },
  { slug: 'fm-1', name: 'Floor', role: 'floor_manager', secured: false, has_pin: false, connected: false, last_seen: null },
];
const agenda = [
  { id: 'a1', scope: 'day', start_time: '09:00', end_time: null, title: 'Doors', details: null, position: 0, announce_lead_minutes: null },
  { id: 'a2', scope: 'day', start_time: '10:00', end_time: null, title: 'Opening', details: null, position: 1, announce_lead_minutes: null },
  { id: 'a3', scope: 'day', start_time: '12:00', end_time: null, title: 'Lunch', details: null, position: 2, announce_lead_minutes: null },
];

vi.mock('../api/comms', () => ({
  useStations: () => ({ data: stations }),
  usePresets: () => ({ data: [] }),
  useInbox: () => ({ data: [] }),
  useAgenda: () => ({ data: agenda }),
  useAckMessage: () => noop,
  useSendMessage: () => noop,
  usePushScreen: () => noop,
  useTimerControl: () => noop,
  useSaveStation: () => noop,
  useSavePreset: () => noop,
  useSaveAgendaItem: () => noop,
  useDeletePreset: () => noop,
  useDeleteAgendaItem: () => noop,
  useDeleteStation: () => ({ mutate: m.delStation }),
  useRotateLink: () => ({ mutate: m.rotate }),
  useSetPin: () => ({ mutate: m.setPin }),
  useUnsecureStation: () => ({ mutate: m.unsecure }),
  useReorderAgenda: () => ({ mutate: m.reorder }),
  useImportAgenda: () => ({ mutate: m.importAgenda, isPending: false }),
  fetchStationLink: vi.fn().mockResolvedValue({ access_key: 'k', path: '/station/cam-1?k=k' }),
}));

const timers = [
  { entity_id: 'timer.field1', display_name: 'Field 1 timer', field_set_id: 1, field_id: 1, duration_s: 60, tags: [], prompter_token: 'tok123' },
];
const t = {
  start: vi.fn(),
  stop: vi.fn(),
  reset: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
};
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

describe('CommsPage desk console', () => {
  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    Object.values(t).forEach((fn) => fn.mockReset());
    perms.denied.clear();
    useUiStore.setState({ toasts: [] } as never);
  });

  it('shows presence and security state per station', () => {
    render(<CommsPage />);
    const rows = screen.getAllByTestId('station-row');
    expect(within(rows[0]).getByTestId('presence')).toHaveAttribute('data-connected', 'true');
    expect(within(rows[0]).getByText(/Connected/)).toBeInTheDocument();
    expect(within(rows[1]).getByTestId('presence')).toHaveAttribute('data-connected', 'false');
    expect(within(rows[1]).getByText(/Key \+ PIN/)).toBeInTheDocument();
    expect(within(rows[1]).getByText(/Seen 10 min ago/)).toBeInTheDocument();
    expect(within(rows[2]).getByText(/Never opened/)).toBeInTheDocument();
    expect(within(rows[2]).getByRole('button', { name: /Secure/ })).toBeInTheDocument();
    expect(within(rows[1]).getByRole('button', { name: /Rotate/ })).toBeInTheDocument();
  });

  it('rotates a link after confirmation only', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<CommsPage />);
    const row = screen.getAllByTestId('station-row')[1];

    confirmSpy.mockReturnValueOnce(false);
    await user.click(within(row).getByRole('button', { name: /Rotate/ }));
    expect(m.rotate).not.toHaveBeenCalled();

    confirmSpy.mockReturnValueOnce(true);
    await user.click(within(row).getByRole('button', { name: /Rotate/ }));
    expect(m.rotate).toHaveBeenCalledWith('cam-1', expect.anything());
    confirmSpy.mockRestore();
  });

  it('validates and sends a PIN (empty removes it)', async () => {
    const user = userEvent.setup();
    const promptSpy = vi.spyOn(window, 'prompt');
    render(<CommsPage />);
    const pinButton = () => within(screen.getAllByTestId('station-row')[0]).getByTitle('Set or remove the PIN');

    promptSpy.mockReturnValueOnce('12ab');
    await user.click(pinButton());
    expect(m.setPin).not.toHaveBeenCalled();
    expect(useUiStore.getState().toasts.some((t) => /4 to 8 digits/.test(t.message))).toBe(true);

    promptSpy.mockReturnValueOnce('4821');
    await user.click(pinButton());
    expect(m.setPin).toHaveBeenLastCalledWith({ slug: 'emcee-1', pin: '4821' }, expect.anything());

    promptSpy.mockReturnValueOnce('');
    await user.click(pinButton());
    expect(m.setPin).toHaveBeenLastCalledWith({ slug: 'emcee-1', pin: null }, expect.anything());

    promptSpy.mockReturnValueOnce(null); // cancelled
    await user.click(pinButton());
    expect(m.setPin).toHaveBeenCalledTimes(2);
    promptSpy.mockRestore();
  });

  it('reorders the agenda by dragging a row', () => {
    render(<CommsPage />);
    const rows = screen.getAllByTestId('agenda-row');
    expect(rows).toHaveLength(3);
    fireEvent.dragStart(rows[2]);
    fireEvent.dragOver(rows[0]);
    fireEvent.drop(rows[0]);
    expect(m.reorder).toHaveBeenCalledWith({ scope: 'day', ids: ['a3', 'a1', 'a2'] }, expect.anything());
  });

  it('checks then imports pasted agenda text, surfacing line errors', async () => {
    const user = userEvent.setup();
    render(<CommsPage />);
    await user.click(screen.getByRole('button', { name: /Import/ }));
    const box = screen.getByLabelText('Agenda text');
    await user.click(box);
    await user.paste('09:00 Doors\nnope');

    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(m.importAgenda).toHaveBeenLastCalledWith({ scope: 'day', text: '09:00 Doors\nnope', replace: false, dry_run: true }, expect.anything());
    const { onSuccess } = m.importAgenda.mock.calls[0][1];
    onSuccess({ created: 0, items: [], errors: [{ line: 2, error: "Expected 'HH:MM[-HH:MM] Title'" }] });
    expect(await screen.findByTestId('import-errors')).toHaveTextContent('Line 2');

    await user.click(screen.getAllByRole('button', { name: 'Import' }).at(-1)!); // the modal's submit, after the card's opener
    expect(m.importAgenda).toHaveBeenLastCalledWith(expect.objectContaining({ dry_run: false }), expect.anything());
  });

  it('is one page: timer-teleprompter instances above the station comms', () => {
    render(<CommsPage />);
    expect(screen.getByRole('heading', { name: 'Comms' })).toBeInTheDocument();
    expect(screen.queryByText('Timer-Teleprompter')).not.toBeInTheDocument();
    const timersSection = screen.getByTestId('timers-section');
    expect(within(timersSection).getByText('Field 1 timer')).toBeInTheDocument();
    expect(within(timersSection).getByText(/\/prompter\/timer\.field1\?token=tok123/)).toBeInTheDocument();
    expect(screen.getAllByTestId('station-row')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /New Timer/ })).toBeInTheDocument();
    const before = screen.getByTestId('timers-section').compareDocumentPosition(screen.getAllByTestId('station-row')[0]);
    expect(before & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // stations come after the timers
  });

  it('drives a timer and regenerates its prompter token from the page', async () => {
    const user = userEvent.setup();
    render(<CommsPage />);
    const section = screen.getByTestId('timers-section');
    await user.click(within(section).getByRole('button', { name: 'Start' }));
    expect(t.start).toHaveBeenCalledWith('timer.field1');
    await user.click(within(section).getByRole('button', { name: 'Stop' }));
    expect(t.stop).toHaveBeenCalledWith('timer.field1');
    await user.click(within(section).getByRole('button', { name: /Regenerate token/ }));
    expect(t.update).toHaveBeenCalledWith({ entityId: 'timer.field1', body: { regenerate_token: true } }, expect.anything());
    await user.click(within(section).getByRole('button', { name: 'Manage cues' }));
    expect(within(section).getByRole('button', { name: 'Hide cues' })).toBeInTheDocument();
  });

  it('opens the timer editor from New Timer', async () => {
    const user = userEvent.setup();
    render(<CommsPage />);
    await user.click(screen.getByRole('button', { name: /New Timer/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('hides the timer section and controls without timers:read / timers:edit / prompter:control', () => {
    perms.denied.add('timers:read');
    perms.denied.add('timers:edit');
    const { unmount } = render(<CommsPage />);
    expect(screen.queryByTestId('timers-section')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New Timer/ })).not.toBeInTheDocument();
    expect(screen.getAllByTestId('station-row')).toHaveLength(3); // the comms half is unaffected
    unmount();

    perms.denied.clear();
    perms.denied.add('prompter:control');
    perms.denied.add('timers:edit');
    render(<CommsPage />);
    const section = screen.getByTestId('timers-section');
    expect(within(section).queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: /Regenerate token/ })).not.toBeInTheDocument();
    expect(within(section).getByText('Field 1 timer')).toBeInTheDocument();
  });
});
