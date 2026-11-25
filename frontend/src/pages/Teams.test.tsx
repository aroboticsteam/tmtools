import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TeamsPage } from './Teams';

const teams = [
  { team_number: '1234A', robot_name: 'Bolt', pit_location: null },
  { team_number: '5678B', robot_name: 'Zip', pit_location: null },
];
const checklist = [
  { team_number: '1234A', inspection: 'PASSED', bot_photo: true, team_photo: true, done: 3, total: 3, complete: true },
  { team_number: '5678B', inspection: 'NOT_STARTED', bot_photo: false, team_photo: false, done: 0, total: 3, complete: false },
];

vi.mock('../api/teams', () => ({
  useTeams: () => ({ data: teams, isLoading: false }),
  useTeamChecklist: () => ({ data: checklist }),
  useUpdateTeam: () => ({ mutateAsync: vi.fn() }),
}));

describe('TeamsPage checklist', () => {
  it('summarises how many teams are complete and shows per-team state', () => {
    render(
      <MemoryRouter>
        <TeamsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Checklist done')).toBeInTheDocument();
    expect(screen.getByLabelText('Checklist for 1234A')).toHaveTextContent('3/3');
    expect(screen.getByLabelText('Checklist for 5678B')).toHaveTextContent('0/3');
    expect(screen.getByText('Not started')).toBeInTheDocument();
  });

  it('filters to incomplete teams', async () => {
    render(
      <MemoryRouter>
        <TeamsPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Checklist open' }));
    expect(screen.queryByText('1234A')).not.toBeInTheDocument();
    expect(screen.getByText('5678B')).toBeInTheDocument();
  });
});
