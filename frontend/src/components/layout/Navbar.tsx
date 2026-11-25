import { useEffect, useState } from 'react';
import { LogOut, Menu, MoreHorizontal, Workflow, X } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { logout } from '../../api/auth';
import { useAuthStore } from '../../stores/auth';
import { usePermission } from '../../hooks/usePermission';
import { useAnyFieldLive } from '../../lib/fields';
import { NAV_GROUPS, PHONE_TABS, isActivePath, locate, type NavGroup } from '../../lib/nav';
import { StaffAlerts } from './StaffAlerts';

function useVisibleGroups(): NavGroup[] {
  const canEdit = usePermission('settings:edit');
  const canAnalyse = usePermission('analysis:view');
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) =>
      i.permission === 'settings:edit' ? canEdit : i.permission === 'analysis:view' ? canAnalyse : true,
    ),
  })).filter((g) => g.items.length > 0);
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-900 text-white">
        <Workflow size={16} />
      </div>
      <span className="text-[15px] font-semibold tracking-tight text-vmd-textStrong">TMTools</span>
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const groups = useVisibleGroups();
  const live = useAnyFieldLive();
  const { pathname } = useLocation();
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {groups.map((g) => (
        <div key={g.title} className="flex flex-col gap-0.5">
          <div className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-vmd-textSubtle">{g.title}</div>
          {g.items.map(({ to, label, icon: Icon, live: hasLive }) => {
            const active = isActivePath(pathname, to);
            return (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-sm ${
                  active ? 'bg-neutral-100 font-medium text-vmd-textStrong' : 'text-neutral-600 hover:bg-neutral-50 hover:text-vmd-textStrong'
                }`}
              >
                <Icon size={18} />
                <span className="flex-1">{label}</span>
                {hasLive && live && <span className="h-1.5 w-1.5 rounded-full bg-red-600" aria-label="Match running" />}
              </NavLink>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function AccountRow() {
  const subject = useAuthStore((s) => s.subject);
  const isAdmin = useAuthStore((s) => s.isAdminLocal);
  const clearAuth = useAuthStore((s) => s.clear);
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      clearAuth();
      window.location.href = '/admin_login';
    },
  });
  const name = subject ?? 'Signed in';
  const initials = name.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
  return (
    <div className="border-t border-vmd-border pt-3">
      <div className="flex items-center gap-2.5 px-1">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-vmd-border bg-neutral-100 text-xs font-semibold text-vmd-textMuted">
          {initials}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-medium text-vmd-textStrong">{name}</div>
          <div className="text-xs text-vmd-textSubtle">{isAdmin ? 'Admin' : 'Staff'}</div>
        </div>
        <button
          type="button"
          aria-label="Log out"
          title="Log out"
          onClick={() => logoutMutation.mutate()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-vmd-textSubtle hover:bg-neutral-100 hover:text-vmd-textStrong"
        >
          <LogOut size={16} />
        </button>
      </div>
    </div>
  );
}

/** Desktop sidebar; phone top bar + drawer + bottom tabs. */
export function AppNav() {
  const [drawer, setDrawer] = useState(false);
  const { pathname } = useLocation();
  const groups = useVisibleGroups();
  useEffect(() => setDrawer(false), [pathname]);
  const { item } = locate(pathname);
  const allItems = groups.flatMap((g) => g.items);
  const tabs = PHONE_TABS.map((to) => allItems.find((i) => i.to === to)).filter((i) => !!i);
  const shortLabel: Record<string, string> = { '/': 'Home', '/match-control': 'Match', '/analysis': 'Analysis', '/comms': 'Comms' };

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col gap-5 overflow-y-auto border-r border-vmd-border bg-white p-3 lg:flex">
        <div className="pt-1"><Brand /></div>
        <div className="flex-1"><NavList /></div>
        <AccountRow />
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-vmd-border bg-white px-2 lg:hidden">
        <button type="button" aria-label="Open menu" onClick={() => setDrawer(true)} className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-800 hover:bg-neutral-100">
          <Menu size={22} />
        </button>
        <div className="min-w-0 flex-1 truncate text-base font-semibold text-vmd-textStrong">{item?.label ?? 'TMTools'}</div>
        <StaffAlerts compact />
      </header>

      {drawer && (
        <div className="fixed inset-0 z-[90] lg:hidden" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-neutral-900/45" />
          <div role="dialog" aria-label="Menu" className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col gap-5 overflow-y-auto bg-white p-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pt-1">
              <Brand />
              <button type="button" aria-label="Close menu" onClick={() => setDrawer(false)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-neutral-100">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1"><NavList onNavigate={() => setDrawer(false)} /></div>
            <AccountRow />
          </div>
        </div>
      )}

      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-vmd-border bg-white lg:hidden">
        {tabs.map((t) => {
          if (!t) return null;
          const TabIcon = t.icon;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/'}
              className={({ isActive }) => `flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${isActive ? 'font-semibold text-vmd-textStrong' : 'text-vmd-textSubtle'}`}
            >
              <TabIcon size={20} />
              {shortLabel[t.to] ?? t.label}
            </NavLink>
          );
        })}
        <button type="button" onClick={() => setDrawer(true)} className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-vmd-textSubtle">
          <MoreHorizontal size={20} />
          More
        </button>
      </nav>
    </>
  );
}
