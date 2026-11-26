import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AccessGuard } from './AccessGuard';
import { requiredPermission, NAV_GROUPS } from '../../lib/nav';
import { useAuthStore } from '../../stores/auth';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AccessGuard />}>
          <Route path="/teams/:n" element={<div>team page</div>} />
          <Route path="/settings" element={<div>settings page</div>} />
          <Route path="/" element={<div>dashboard</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function as(permissions: string[], isAdminLocal = false) {
  useAuthStore.setState({ permissions: new Set(permissions), isAdminLocal });
}

describe('AccessGuard', () => {
  beforeEach(() => as([]));

  it('renders the page when the permission is held', () => {
    as(['teams:read']);
    renderAt('/teams/12');
    expect(screen.getByText('team page')).toBeInTheDocument();
  });

  it('shows a no-access notice instead of mounting the page', () => {
    as(['teams:read']);
    renderAt('/settings');
    expect(screen.queryByText('settings page')).not.toBeInTheDocument();
    expect(screen.getByText(/don't have access/i)).toBeInTheDocument();
  });

  it('lets the dashboard through for everyone and admins through everywhere', () => {
    renderAt('/');
    expect(screen.getByText('dashboard')).toBeInTheDocument();
    as([], true);
    renderAt('/settings');
    expect(screen.getByText('settings page')).toBeInTheDocument();
  });

  it('every nav item except the dashboard declares a permission, and children inherit', () => {
    for (const i of NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.to !== '/')) {
      expect(i.permission, i.to).toBeTruthy();
    }
    expect(requiredPermission('/teams/12')).toBe('teams:read');
    expect(requiredPermission('/automations/new')).toBe('automations:read');
  });
});
