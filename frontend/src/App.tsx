import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { queryClient } from './api/queryClient';
import { router } from './router';
import { CornerLogo } from './components/layout/CornerLogo';
import { DemoBanner } from './demo/DemoBanner';
import { DEMO } from './lib/demo';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <CornerLogo />
      {DEMO && <DemoBanner />}
    </QueryClientProvider>
  );
}
