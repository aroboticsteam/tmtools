import {
  Clapperboard, DoorOpen, FileCode2, LayoutDashboard, LayoutGrid, Timer, MonitorPlay,
  Plug, Presentation, ScrollText, Settings as SettingsIcon, ShieldCheck, Camera, Users2, Workflow,
  Bug, Activity,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Permission needed to see the item. */
  permission?: string;
  /** Shows a red dot while a match is running. */
  live?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/** Single source for the sidebar, the phone drawer, breadcrumbs and Ctrl K. */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Event',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/match-control', label: 'Match control', icon: MonitorPlay, live: true },
      { to: '/analysis', label: 'Analysis desk', icon: Clapperboard, permission: 'analysis:view' },
      { to: '/teams', label: 'Teams', icon: Users2 },
      { to: '/rooms', label: 'Rooms', icon: DoorOpen },
      { to: '/timers', label: 'Timers', icon: Timer },
    ],
  },
  {
    title: 'Production',
    items: [
      { to: '/overlays', label: 'Overlays', icon: Presentation },
      { to: '/buttons', label: 'Button pages', icon: LayoutGrid },
      { to: '/record', label: 'Photo booth', icon: Camera },
    ],
  },
  {
    title: 'Automation',
    items: [
      { to: '/integrations', label: 'Integrations', icon: Plug },
      { to: '/automations', label: 'Automations', icon: Workflow },
      { to: '/scripts', label: 'Scripts', icon: FileCode2 },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/users', label: 'Users and roles', icon: ShieldCheck },
      { to: '/audit', label: 'Audit log', icon: ScrollText },
      { to: '/settings', label: 'Settings', icon: SettingsIcon },
      { to: '/debug/integration-log', label: 'Integration log', icon: Bug, permission: 'settings:edit' },
      { to: '/debug/event-bus', label: 'Live event bus', icon: Activity, permission: 'settings:edit' },
    ],
  },
];

/** Phone bottom tabs; the last one ("More") opens the drawer. */
export const PHONE_TABS = ['/', '/match-control', '/analysis', '/timers'] as const;

export function isActivePath(pathname: string, to: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);
}

/** Group and item for a path, for the breadcrumb ("Event > Teams"). */
export function locate(pathname: string): { section: string; item: NavItem | null } {
  for (const g of NAV_GROUPS) {
    const item = g.items.find((i) => isActivePath(pathname, i.to));
    if (item) return { section: g.title, item };
  }
  return { section: 'TMTools', item: null };
}
