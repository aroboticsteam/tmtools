import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/http';
import type {
  TeamChecklistItem,
  TeamProfile,
  TeamProfileUpdate,
} from '../types/api';

export function useTeams(enabled = true) {
  return useQuery({ enabled, queryKey: ['teams'], queryFn: () => apiFetch<TeamProfile[]>('/api/v1/teams') });
}

export function useTeamChecklist(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['teams', 'checklist'],
    queryFn: () => apiFetch<TeamChecklistItem[]>('/api/v1/teams/checklist'),
  });
}

export function useTeam(number: string | null) {
  return useQuery({
    queryKey: ['teams', number],
    queryFn: () => apiFetch<TeamProfile>(`/api/v1/teams/${encodeURIComponent(number!)}`),
    enabled: Boolean(number),
  });
}

export function useUpdateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ number, body }: { number: string; body: TeamProfileUpdate }) =>
      apiFetch<TeamProfile>(`/api/v1/teams/${encodeURIComponent(number)}`, { method: 'PUT', body }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['teams', vars.number] });
      qc.invalidateQueries({ queryKey: ['teams', 'checklist'] });
    },
  });
}

export function useUploadTeamLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ number, file }: { number: string; file: File }) => {
      const form = new FormData();
      form.set('file', file);
      return apiFetch<TeamProfile>(`/api/v1/teams/${encodeURIComponent(number)}/logo`, { method: 'POST', formData: form });
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['teams', vars.number] });
    },
  });
}

export function useDeleteTeamLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (number: string) =>
      apiFetch<TeamProfile>(`/api/v1/teams/${encodeURIComponent(number)}/logo`, { method: 'DELETE' }),
    onSuccess: (_d, number) => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['teams', number] });
    },
  });
}
