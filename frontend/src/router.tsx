import { createBrowserRouter, Navigate } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import { STATIC_SITE } from './public/siteUrl';
import { AccessGuard } from './components/layout/AccessGuard';
import { RouteError } from './components/layout/RouteError';
import { ProtectedLayout } from './components/layout/ProtectedLayout';
import { AdminLoginPage } from './pages/AdminLogin';
import { SpotifyCallbackPage } from './pages/SpotifyCallback';
import { DashboardPage } from './pages/Dashboard';
import { MatchControlPage } from './pages/MatchControl';
import { IntegrationsPage } from './pages/Integrations';
import { AutomationsPage } from './pages/Automations';
import { AutomationEditorPage } from './pages/AutomationEditor';
import { ScriptsPage } from './pages/Scripts';
import { OverlaysPage } from './pages/Overlays';
import { TeamsPage } from './pages/Teams';
import { TeamDetailPage } from './pages/TeamDetail';
import { RoomsPage } from './pages/Rooms';
import { ButtonPagesPage } from './pages/ButtonPages';
import { AnalysisPage } from './pages/Analysis';
import { PhotoBoothPage } from './pages/PhotoBooth';
import { TimersPage } from './pages/Timers';
import { AuditLogPage } from './pages/AuditLog';
import { SettingsPage } from './pages/Settings';
import { UsersPage } from './pages/Users';
import { DebugIntegrationLogPage } from './pages/DebugIntegrationLog';
import { DebugEventBusPage } from './pages/DebugEventBus';

// Public and OBS pages (no sign-in, no admin shell). Lazy so the admin bundle
// does not carry them and they load only on their own URLs.
const publicRoute = (path: string, load: () => Promise<{ Component: React.ComponentType }>): RouteObject => ({
  path,
  lazy: load,
  errorElement: <RouteError />,
});

const publicRoutes: RouteObject[] = [
  publicRoute('/site', async () => ({ Component: (await import('./public/SitePage')).SitePage })),
  publicRoute('/site/leaderboard', async () => ({ Component: (await import('./public/LeaderboardPage')).LeaderboardPage })),
  publicRoute('/notify', async () => ({ Component: (await import('./public/NotifyPage')).NotifyPage })),
  publicRoute('/room/:slug', async () => ({ Component: (await import('./public/RoomPage')).RoomPage })),
  publicRoute('/station/:slug', async () => ({ Component: (await import('./public/StationPage')).StationPage })),
  publicRoute('/prompter', async () => ({ Component: (await import('./public/PrompterIndexPage')).PrompterIndexPage })),
  publicRoute('/prompter/:entityId', async () => ({ Component: (await import('./public/PrompterPage')).PrompterPage })),
  publicRoute('/overlay/:entityId', async () => ({ Component: (await import('./public/OverlayPage')).OverlayPage })),
  publicRoute('/replay/:entityId', async () => ({ Component: (await import('./public/ReplayPage')).ReplayPage })),
];

// createBrowserRouter with nested routes (plan Appendix B.2). The public
// pages above sit outside ProtectedLayout, so they never ask for a login.
// The exported static copy of the public site only has these routes (see public/siteUrl.ts).
const staticSiteRoutes: RouteObject[] = [
  publicRoute('/', async () => ({ Component: (await import('./public/SitePage')).SitePage })),
  publicRoute('/site', async () => ({ Component: (await import('./public/SitePage')).SitePage })),
  publicRoute('/site/leaderboard', async () => ({ Component: (await import('./public/LeaderboardPage')).LeaderboardPage })),
  publicRoute('*', async () => ({ Component: (await import('./public/SitePage')).SitePage })),
];

export const router = createBrowserRouter(STATIC_SITE ? staticSiteRoutes : [
  ...publicRoutes,
  { path: '/admin_login', element: <AdminLoginPage />, errorElement: <RouteError /> },
  { path: '/integrations/spotify/callback', element: <SpotifyCallbackPage /> },
  {
    path: '/',
    element: <ProtectedLayout />,
    errorElement: <RouteError />,
    children: [
      {
        element: <AccessGuard />,
        errorElement: <RouteError />,
        children: [
      { index: true, element: <DashboardPage /> },
      // Field Monitor was merged into Match Control; keep old links working.
      { path: 'fields', element: <Navigate to="/match-control" replace /> },
      { path: 'match-control', element: <MatchControlPage /> },
      { path: 'integrations', element: <IntegrationsPage /> },
      { path: 'automations', element: <AutomationsPage /> },
      { path: 'automations/new', element: <AutomationEditorPage /> },
      { path: 'automations/:id', element: <AutomationEditorPage /> },
      { path: 'scripts', element: <ScriptsPage /> },
      { path: 'overlays', element: <OverlaysPage /> },
      { path: 'teams', element: <TeamsPage /> },
      { path: 'teams/:number', element: <TeamDetailPage /> },
      { path: 'rooms', element: <RoomsPage /> },
      { path: 'buttons', element: <ButtonPagesPage /> },
      { path: 'analysis', element: <AnalysisPage /> },
      { path: 'record', element: <PhotoBoothPage /> },
      { path: 'timers', element: <TimersPage /> },
      // The Comms page was removed; old bookmarks land on Timers.
      { path: 'comms', element: <Navigate to="/timers" replace /> },
      { path: 'audit', element: <AuditLogPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'users', element: <UsersPage /> },
      { path: 'debug/integration-log', element: <DebugIntegrationLogPage /> },
      { path: 'debug/event-bus', element: <DebugEventBusPage /> },
      { path: '*', element: <RouteError /> },
        ],
      },
    ],
  },
]);
