import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/http';
import type { PhotoKind, PhotoUploadAccepted, TeamPhotos } from '../types/api';

export function useTeamPhotos(number: string | null) {
  return useQuery({
    queryKey: ['teams', number, 'photos'],
    queryFn: () => apiFetch<TeamPhotos>(`/api/v1/teams/${encodeURIComponent(number!)}/photos`),
    enabled: !!number,
    // Keying runs in the background after upload: poll until both photos settle.
    refetchInterval: (query) => {
      const photos = query.state.data?.photos;
      return photos && Object.values(photos).some((p) => p.status === 'PROCESSING') ? 2000 : false;
    },
  });
}

export function useUploadPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      number,
      kind,
      file,
      keyColour,
      similarity,
      blend,
    }: {
      number: string;
      kind: PhotoKind;
      file: File;
      keyColour: string;
      similarity: number;
      blend: number;
    }) => {
      const form = new FormData();
      form.set('file', file);
      form.set('key_colour', keyColour);
      form.set('similarity', String(similarity));
      form.set('blend', String(blend));
      return apiFetch<PhotoUploadAccepted>(`/api/v1/teams/${encodeURIComponent(number)}/photos/${kind}`, {
        method: 'POST',
        formData: form,
      });
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['teams', vars.number, 'photos'] });
      qc.invalidateQueries({ queryKey: ['teams', 'checklist'] });
    },
  });
}

export const PHOTO_KIND_LABEL: Record<PhotoKind, string> = { bot_photo: 'Robot photo', team_photo: 'Team photo' };
