import { AlertTriangle, RotateCw } from 'lucide-react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { Button } from '../ui/Button';

/** Shown when a page throws while rendering or a route fails to load. Inside
 * the app shell it replaces only the page, so navigation keeps working. */
export function RouteError() {
  const error = useRouteError();
  const notFound = error === undefined || (isRouteErrorResponse(error) && error.status === 404);
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error';

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-20 text-center" role="alert">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-700">
        <AlertTriangle size={20} />
      </span>
      <h1 className="text-lg font-semibold text-vmd-textStrong">{notFound ? 'Page not found' : 'Something went wrong on this page'}</h1>
      <p className="text-sm text-vmd-textSubtle">
        {notFound ? 'That page does not exist.' : 'The rest of the app is still working. Try again, or go back to the dashboard.'}
      </p>
      {!notFound && <code className="max-w-full break-words rounded-lg bg-neutral-100 px-3 py-2 text-xs text-vmd-textMuted">{detail}</code>}
      <div className="mt-2 flex gap-2">
        {!notFound && (
          <Button onClick={() => window.location.reload()}>
            <RotateCw size={16} /> Reload page
          </Button>
        )}
        <Link to="/"><Button variant="primary">Dashboard</Button></Link>
      </div>
    </div>
  );
}
