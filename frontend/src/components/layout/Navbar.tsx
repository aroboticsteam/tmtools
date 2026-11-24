import {
  LayoutDashboard, MonitorPlay, Plug, Workflow, FileCode2, Presentation, Users2, ScrollText,
  Settings as SettingsIcon, ShieldCheck, LayoutGrid, Camera, Radio, LogOut, Bug, Activity,
  DoorOpen, Menu, X, Clapperboard,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { logout } from '../../api/auth';
import { useAuthStore } from '../../stores/auth';
import { usePermission } from '../../hooks/usePermission';
import { StaffAlerts } from './StaffAlerts';

interface NavItem { to: string; label: string; icon: LucideIcon }
interface NavGroup { label: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  { label: 'Production', items: [
    { to: '/match-control', label: 'Match control', icon: MonitorPlay },
    { to: '/overlays', label: 'Overlays', icon: Presentation },
    { to: '/buttons', label: 'Button pages', icon: LayoutGrid },
    { to: '/comms', label: 'Comms', icon: Radio },
  ] },
  { label: 'Video', items: [
    { to: '/record', label: 'Photo booth', icon: Camera },
    { to: '/analysis', label: 'Analysis', icon: Clapperboard },
  ] },
  { label: 'Event', items: [
    { to: '/teams', label: 'Teams', icon: Users2 },
    { to: '/rooms', label: 'Rooms', icon: DoorOpen },
  ] },
  { label: 'Automation', items: [
    { to: '/integrations', label: 'Integrations', icon: Plug },
    { to: '/automations', label: 'Automations', icon: Workflow },
    { to: '/scripts', label: 'Scripts', icon: FileCode2 },
  ] },
  { label: 'Admin', items: [
    { to: '/settings', label: 'Settings', icon: SettingsIcon },
    { to: '/users', label: 'Users & roles', icon: ShieldCheck },
    { to: '/audit', label: 'Audit log', icon: ScrollText },
  ] },
];

const DEBUG_ITEMS: NavItem[] = [
  { to: '/debug/integration-log', label: 'Integration log', icon: Bug },
  { to: '/debug/event-bus', label: 'Live event bus', icon: Activity },
];

const HOME: NavItem = { to: '/', label: 'Dashboard', icon: LayoutDashboard };

/** Bottom tab bar entries on phones; everything else is under "More". */
const TABS: NavItem[] = [
  HOME,
  { to: '/match-control', label: 'Match', icon: MonitorPlay },
  { to: '/analysis', label: 'Analysis', icon: Clapperboard },
  { to: '/integrations', label: 'Integrations', icon: Plug },
];

function useNavGroups(): NavGroup[] {
  const canViewDebug = usePermission('settings:edit');
  const canViewAnalysis = usePermission('analysis:view');
  return [
    ...NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter(({ to }) => to !== '/analysis' || canViewAnalysis),
    })).filter((g) => g.items.length > 0),
    ...(canViewDebug ? [{ label: 'Debug', items: DEBUG_ITEMS }] : []),
  ];
}

function linkClass(isActive: boolean) {
  return `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm ${
    isActive ? 'bg-neutral-100 font-semibold text-vmd-textStrong' : 'text-vmd-textMuted hover:bg-neutral-50 hover:text-vmd-textStrong'
  }`;
}

function NavList({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      <NavLink to={HOME.to} end onClick={onNavigate} className={({ isActive }) => linkClass(isActive)}>
        <HOME.icon size={18} /> {HOME.label}
      </NavLink>
      {groups.map((g) => (
        <div key={g.label}>
          <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-vmd-textSubtle">{g.label}</div>
          <div className="flex flex-col gap-0.5">
            {g.items.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} onClick={onNavigate} className={({ isActive }) => linkClass(isActive)}>
                <Icon size={18} /> {label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function AccountRow() {
  const subject = useAuthStore((s) => s.subject);
  const clearAuth = useAuthStore((s) => s.clear);
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      clearAuth();
      window.location.href = '/admin_login';
    },
  });
  return (
    <div className="flex items-center justify-between gap-2 border-t border-vmd-border pt-3">
      <span className="truncate text-[13px] text-vmd-textSubtle">{subject ?? ''}</span>
      <button
        type="button"
        onClick={() => logoutMutation.mutate()}
        className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] text-vmd-textMuted hover:bg-neutral-100"
      >
        <LogOut size={16} /> Log out
      </button>
    </div>
  );
}

/** Desktop: fixed sidebar. Phones: top bar + drawer + bottom tabs. */
export function AppNav() {
  const groups = useNavGroups();
  const [drawer, setDrawer] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setDrawer(false), [pathname]);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col gap-4 overflow-y-auto border-r border-vmd-border bg-white p-3 lg:flex">
        <div className="flex items-center justify-between px-2.5 pt-1">
          <span className="text-[15px] font-semibold tracking-tight text-vmd-textStrong">TMTools</span>
        </div>
        <div className="flex-1"><NavList groups={groups} /></div>
        <StaffAlerts />
        <AccountRow />
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-vmd-border bg-white px-3 lg:hidden">
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setDrawer(true)}
          className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-neutral-100"
        >
          <Menu size={22} />
        </button>
        <span className="flex-1 text-[15px] font-semibold text-vmd-textStrong">TMTools</span>
        <StaffAlerts compact />
      </header>

      {drawer && (
        <div className="fixed inset-0 z-[90] lg:hidden" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-neutral-900/45" />
          <div
            role="dialog"
            aria-label="Menu"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-4 overflow-y-auto bg-white p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-2.5 pt-1">
              <span className="text-[15px] font-semibold text-vmd-textStrong">TMTools</span>
              <button type="button" aria-label="Close menu" onClick={() => setDrawer(false)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-neutral-100">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1"><NavList groups={groups} onNavigate={() => setDrawer(false)} /></div>
            <AccountRow />
          </div>
        </div>
      )}

      <nav
        aria-label="Quick"
        className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-vmd-border bg-white lg:hidden"
      >
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${isActive ? 'font-semibold text-vmd-textStrong' : 'text-vmd-textSubtle'}`
            }
          >
            <Icon size={20} /> {label}
          </NavLink>
        ))}
        <button type="button" onClick={() => setDrawer(true)} className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-vmd-textSubtle">
          <Menu size={20} /> More
        </button>
      </nav>
    </>
  );
}
