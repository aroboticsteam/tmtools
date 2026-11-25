import { Lock } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useCan } from '../../hooks/useCan';
import { requiredPermission } from '../../lib/nav';
import { Button } from '../ui/Button';

/** Wraps every page route. A page the principal cannot read renders this
 * notice instead of mounting, so its queries never fire and 403s never
 * surface as broken or blank screens. */
export function NoAccess({ permission }: { permission?: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-20 text-center" role="status">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-700">
        <Lock size={20} />
      </span>
      <h1 className="text-lg font-semibold text-vmd-textStrong">You don't have access to this page</h1>
      <p className="text-sm text-vmd-textSubtle">
        Your role doesn't include it. Ask an admin to grant access if you need it.
      </p>
      {permission && <code className="rounded-lg bg-neutral-100 px-3 py-2 text-xs text-vmd-textMuted">{permission}</code>}
      <Link to="/" className="mt-2"><Button variant="primary">Back to dashboard</Button></Link>
    </div>
  );
}

export function AccessGuard() {
  const { pathname } = useLocation();
  const can = useCan();
  const needed = requiredPermission(pathname);
  if (!can(needed)) return <NoAccess permission={needed} />;
  return <Outlet />;
}
