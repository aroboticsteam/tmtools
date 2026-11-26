import { useCallback } from 'react';
import { useAuthStore } from '../stores/auth';

/** Returns a checker, for filtering lists by permission. Stable between renders
 * until the principal changes. */
export function useCan(): (permission?: string) => boolean {
  const isAdminLocal = useAuthStore((s) => s.isAdminLocal);
  const permissions = useAuthStore((s) => s.permissions);
  return useCallback(
    (permission?: string) => !permission || isAdminLocal || permissions.has('*') || permissions.has(permission),
    [isAdminLocal, permissions],
  );
}
