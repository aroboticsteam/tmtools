import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgendaPage } from './Agenda';
import { useUiStore } from '../stores/ui';

const m = { reorder: vi.fn(), importAgenda: vi.fn() };
const noop = { mutate: vi.fn(), isPending: false };
const perms = vi.hoisted(() => ({ denied: new Set<string>() }));
const agenda = [
  { id: 'a1', scope: 'day', start_time: '09:00', end_time: null, title: 'Doors', details: null, position: 0, announce_lead_minutes: null },
  { id: 'a2', scope: 'day', start_time: '10:00', end_time: null, title: 'Opening', details: null, position: 1, announce_lead_minutes: null },
  { id: 'a3', scope: 'day', start_time: '12:00', end_time: null, title: 'Lunch', details: null, position: 2, announce_lead_minutes: null },
];

vi.mock('../api/agenda', () => ({
  useAgenda: () => ({ data: agenda }),
  useSaveAgendaItem: () => noop,
  useDeleteAgendaItem: () => noop,
  useReorderAgenda: () => ({ mutate: m.reorder }),
  useImportAgenda: () => ({ mutate: m.importAgenda, isPending: false }),
}));
vi.mock('../hooks/usePermission', () => ({ usePermission: (p: string) => !perms.denied.has(p) }));

describe('AgendaPage', () => {
  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    perms.denied.clear();
    useUiStore.setState({ toasts: [] } as never);
  });

  it('lists the agenda', () => {
    render(<AgendaPage />);
    expect(screen.getByRole('heading', { name: 'Agenda' })).toBeInTheDocument();
    expect(screen.getAllByTestId('agenda-row')).toHaveLength(3);
  });

  it('hides editing without comms:manage', () => {
    perms.denied.add('comms:manage');
    render(<AgendaPage />);
    expect(screen.queryByRole('button', { name: /Add item/ })).not.toBeInTheDocument();
  });

  it('shows no agenda without comms:read', () => {
    perms.denied.add('comms:read');
    render(<AgendaPage />);
    expect(screen.queryByTestId('agenda-row')).not.toBeInTheDocument();
  });

  it('reorders the agenda by dragging a row', () => {
    render(<AgendaPage />);
    const rows = screen.getAllByTestId('agenda-row');
    expect(rows).toHaveLength(3);
    fireEvent.dragStart(rows[2]);
    fireEvent.dragOver(rows[0]);
    fireEvent.drop(rows[0]);
    expect(m.reorder).toHaveBeenCalledWith({ scope: 'day', ids: ['a3', 'a1', 'a2'] }, expect.anything());
  });

  it('checks then imports pasted agenda text, surfacing line errors', async () => {
    const user = userEvent.setup();
    render(<AgendaPage />);
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
});
