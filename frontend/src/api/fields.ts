import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/http';
import type { FieldStateSnapshot } from '../types/api';

/** Last known state of every field (recorded server-side, so it survives reloads and other devices). */
export function useFieldState() {
  return useQuery({
    queryKey: ['fields', 'state'],
    queryFn: () => apiFetch<FieldStateSnapshot>('/api/v1/fields/state'),
  });
}
