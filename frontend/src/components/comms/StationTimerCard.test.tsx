import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StationTimerCard } from './StationTimerCard';
import { useUiStore } from '../../stores/ui';
import { useWsStore } from '../../stores/ws';

const mutate = vi.fn();
const data = vi.hoisted(() => ({
  timers: [
    { entity_id: 'timer.field1', display_name: 'Field 1', duration_s: 120 },
    { entity_id: 'timer.finals', display_name: 'Finals break', duration_s: 300 },
  ] as { entity_id: string; display_name: string; duration_s: number }[],
}));
vi.mock('../../api/comms', () => ({ usePushScreen: () => ({ mutate, isPending: false }) }));
vi.mock('../../api/timers', () => ({ useTimers: () => ({ data: data.timers }) }));

describe('StationTimerCard', () => {
  beforeEach(() => {
    mutate.mockClear();
    data.timers.splice(0, data.timers.length,
      { entity_id: 'timer.field1', display_name: 'Field 1', duration_s: 120 },
      { entity_id: 'timer.finals', display_name: 'Finals break', duration_s: 300 },
    );
    useUiStore.setState({ toasts: [] } as never);
    useWsStore.setState({ timerStates: {} } as never);
  });

  it('shows the chosen timer instance on the selected audience', async () => {
    const user = userEvent.setup();
    render(<StationTimerCard audience={{ roles: ['emcee'] }} />);
    await user.selectOptions(screen.getByLabelText('Timer to show'), 'timer.finals');
    await user.click(screen.getByRole('button', { name: /Show on stations/ }));
    expect(mutate.mock.calls[0][0]).toEqual({ roles: ['emcee'], screen: 'timer', timer: 'timer.finals' });
  });

  it('defaults to the first timer and covers all stations when no audience is chosen', async () => {
    const user = userEvent.setup();
    render(<StationTimerCard audience={{}} />);
    await user.click(screen.getByRole('button', { name: /Show on stations/ }));
    expect(mutate.mock.calls[0][0]).toEqual({ screen: 'timer', timer: 'timer.field1' });
  });

  it('shows the selected timer’s live state', () => {
    useWsStore.setState({ timerStates: { 'timer.field1': { phase: 'countdown', running: true, remaining: 87 } } } as never);
    render(<StationTimerCard audience={{}} />);
    expect(screen.getByText(/countdown · remaining 87/)).toBeInTheDocument();
  });

  it('explains what to do when there are no timers yet, and offers no button', () => {
    data.timers.splice(0);
    render(<StationTimerCard audience={{}} />);
    expect(screen.getByText(/Create a timer under Timers/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show on stations/ })).not.toBeInTheDocument();
  });

  it('has no start/pause/stop of its own: timers are driven where they are managed', () => {
    render(<StationTimerCard audience={{}} />);
    for (const name of [/^start$/i, /pause/i, /resume/i, /stop/i, /\+1 min/i]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });
});
