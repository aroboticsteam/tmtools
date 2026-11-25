import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useInRouterContext, useLocation } from 'react-router-dom';
import { locate } from '../../lib/nav';
import { StaffAlerts } from '../layout/StaffAlerts';
import { PageSearch } from '../layout/CommandPalette';

function Breadcrumb({ title }: { title: string }) {
  const { section } = locate(useLocation().pathname);
  return (
    <div className="mb-1 hidden items-center gap-1 text-xs text-vmd-textSubtle sm:flex">
      <span>{section}</span>
      <ChevronRight size={12} aria-hidden="true" />
      <span className="text-vmd-textMuted">{title}</span>
    </div>
  );
}

/** Full-width white bar at the top of every page: breadcrumb, title,
 * description, then search, Staff alerts and the page's own actions. */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  // The breadcrumb, search and alerts need the router; a bare render (tests, previews) skips them.
  const inRouter = useInRouterContext();
  return (
    <div className={`${action ? 'max-lg:mb-4 max-lg:border-b-0 max-lg:bg-transparent max-lg:!py-0' : 'max-lg:hidden'} -mx-4 -mt-5 mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-vmd-border bg-white px-4 py-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:-mt-8 lg:px-8 lg:py-5`}>
      <div className="hidden min-w-0 flex-1 basis-72 lg:block">
        {inRouter && <Breadcrumb title={title} />}
        <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-vmd-textStrong">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-vmd-textSubtle">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {inRouter && <PageSearch />}
        {inRouter && (
          <div className="hidden lg:block">
            <StaffAlerts />
          </div>
        )}
        {action}
      </div>
    </div>
  );
}
