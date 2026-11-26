import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/http';
import type { AgendaImportResult, AgendaItem } from '../types/api';

// The paths and permission keys keep their historical `comms` names.
const BASE = '/api/v1/comms/agenda';

function useInvalidating<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['agenda'] }) });
}

export const useAgenda = () => useQuery({ queryKey: ['agenda'], queryFn: () => apiFetch<AgendaItem[]>(BASE) });

type AgendaBody = Omit<AgendaItem, 'id' | 'position'> & { position?: number };
export const useSaveAgendaItem = () =>
  useInvalidating(({ id, body }: { id?: string; body: AgendaBody }) =>
    id ? apiFetch<AgendaItem>(`${BASE}/${id}`, { method: 'PUT', body }) : apiFetch<AgendaItem>(BASE, { method: 'POST', body }),
  );
export const useDeleteAgendaItem = () => useInvalidating((id: string) => apiFetch<void>(`${BASE}/${id}`, { method: 'DELETE' }));
export const useReorderAgenda = () =>
  useInvalidating(({ scope, ids }: { scope: 'day' | 'finals'; ids: string[] }) => apiFetch<void>(`${BASE}/order`, { method: 'PUT', body: { scope, ids } }));
export const useImportAgenda = () =>
  useInvalidating((body: { scope: 'day' | 'finals'; text: string; replace: boolean; dry_run: boolean }) =>
    apiFetch<AgendaImportResult>(`${BASE}/import`, { method: 'POST', body }),
  );
