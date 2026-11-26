import type { ReactNode } from 'react';
import { AppNav } from './Navbar';
import { ReconnectingBanner } from '../ws/ReconnectingBanner';
import { RedisWarningBanner } from './RedisWarningBanner';
import { ToastContainer } from '../ui/ToastContainer';

export function PageLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-vmd-bg lg:pl-60">
      <AppNav />
      <ReconnectingBanner />
      <RedisWarningBanner />
      <main className="mx-auto max-w-[1200px] px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">{children}</main>
      <ToastContainer />
    </div>
  );
}
