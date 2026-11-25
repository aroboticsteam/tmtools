import { WifiOff } from 'lucide-react';
import { useUiStore } from '../../stores/ui';

/** Plan Appendix A.14: shown wherever `useWebSocket` is mounted (this
 * component is rendered once in `PageLayout` since `useUiStore`'s
 * `reconnecting` flag is shared/global — every page that opens a socket
 * sets/clears the same flag). */
export function ReconnectingBanner() {
  const reconnecting = useUiStore((s) => s.reconnecting);
  if (!reconnecting) return null;

  return (
    <div role="status" className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 lg:fixed lg:bottom-4 lg:right-4 lg:z-[190] lg:mx-0 lg:mt-0 lg:shadow-md">
      <WifiOff size={16} className="animate-pulse" />
      Reconnecting…
    </div>
  );
}
