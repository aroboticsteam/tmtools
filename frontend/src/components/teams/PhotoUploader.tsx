import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChromaKeyPreview } from './ChromaKeyPreview';
import { PHOTO_KIND_LABEL, useTeamPhotos, useUploadPhoto } from '../../api/photos';
import { useSettings } from '../../api/settings';
import { usePermission } from '../../hooks/usePermission';
import { useUiStore } from '../../stores/ui';
import { StatusBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Input, Label, Select } from '../ui/Input';
import type { PhotoKind } from '../../types/api';

const FALLBACK_CHROMA_KEY_DEFAULTS = { colour: '#00B140', similarity: 0.1, blend: 0.05 };
const ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';

/** Adds the bot photo / team photo for one team: choose a file (or, on a phone,
 * open the camera via the `capture` input), preview the chroma key live, then
 * upload for server-side keying. The in-browser camera lives on `/record`. */
export function PhotoUploader({ teamNumber }: { teamNumber: string }) {
  const canUpload = usePermission('video:upload');
  const upload = useUploadPhoto();
  const { data: photos } = useTeamPhotos(teamNumber);
  // Seed the sliders from Settings -> "Chroma Key Defaults" (system_settings `chroma_key_defaults`).
  const { data: settings } = useSettings();
  const chromaKeyDefaults = settings?.find((s) => s.key === 'chroma_key_defaults')?.value;
  const pushToast = useUiStore((s) => s.pushToast);

  const [kind, setKind] = useState<PhotoKind>('bot_photo');
  const [file, setFile] = useState<File | null>(null);
  const [keyColour, setKeyColour] = useState(FALLBACK_CHROMA_KEY_DEFAULTS.colour);
  const [similarity, setSimilarity] = useState(FALLBACK_CHROMA_KEY_DEFAULTS.similarity);
  const [blend, setBlend] = useState(FALLBACK_CHROMA_KEY_DEFAULTS.blend);

  useEffect(() => {
    if (!chromaKeyDefaults) return;
    setKeyColour(String(chromaKeyDefaults.colour ?? FALLBACK_CHROMA_KEY_DEFAULTS.colour));
    setSimilarity(Number(chromaKeyDefaults.similarity ?? FALLBACK_CHROMA_KEY_DEFAULTS.similarity));
    setBlend(Number(chromaKeyDefaults.blend ?? FALLBACK_CHROMA_KEY_DEFAULTS.blend));
  }, [chromaKeyDefaults]);

  function handleUpload() {
    if (!file) return;
    upload.mutate(
      { number: teamNumber, kind, file, keyColour, similarity, blend },
      {
        onSuccess: () => {
          pushToast(`${PHOTO_KIND_LABEL[kind]} accepted — processing…`, 'success');
          setFile(null);
        },
        onError: (err) => pushToast(err instanceof Error ? err.message : 'Upload failed', 'error'),
      },
    );
  }

  return (
    <div className="space-y-3">
      <ChromaKeyPreview file={file} params={{ keyColour, similarity, blend }} />

      {canUpload && (
        <>
          <div>
            <Label>Photo</Label>
            <Select value={kind} onChange={(e) => setKind(e.target.value as PhotoKind)} aria-label="Photo kind">
              <option value="bot_photo">{PHOTO_KIND_LABEL.bot_photo}</option>
              <option value="team_photo">{PHOTO_KIND_LABEL.team_photo}</option>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Choose a photo (.jpg / .png / .webp)</Label>
              <Input
                type="file"
                accept={ACCEPT}
                aria-label="Choose photo file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div>
              <Label>Or take one with this device&apos;s camera</Label>
              <Input
                type="file"
                accept="image/*"
                capture="environment"
                aria-label="Take photo with device camera"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label>Key Colour</Label>
              <input
                type="color"
                value={keyColour}
                onChange={(e) => setKeyColour(e.target.value)}
                className="h-9 w-full rounded-lg border border-vmd-border bg-vmd-elevated"
              />
            </div>
            <div>
              <Label>Similarity ({similarity.toFixed(2)})</Label>
              <input type="range" min={0} max={1} step={0.01} value={similarity} onChange={(e) => setSimilarity(Number(e.target.value))} className="w-full" />
            </div>
            <div>
              <Label>Blend ({blend.toFixed(2)})</Label>
              <input type="range" min={0} max={1} step={0.01} value={blend} onChange={(e) => setBlend(Number(e.target.value))} className="w-full" />
            </div>
          </div>
          <Button variant="primary" onClick={handleUpload} disabled={!file || upload.isPending}>
            {upload.isPending ? 'Uploading…' : 'Process & Upload'}
          </Button>
          <p className="text-xs text-vmd-textSubtle">
            On a laptop with a camera or capture card, use the{' '}
            <Link className="underline" to="/record">
              Photo Booth
            </Link>{' '}
            instead (live preview, countdown, retake).
          </p>
        </>
      )}

      {photos && (
        <div className="space-y-1 text-sm">
          {(Object.keys(PHOTO_KIND_LABEL) as PhotoKind[]).map((k) => (
            <div key={k} className="flex items-center justify-between">
              <span className="text-vmd-textMuted">{PHOTO_KIND_LABEL[k]}</span>
              <span title={photos.photos[k]?.error ?? undefined}>
                <StatusBadge status={photos.photos[k]?.status ?? 'NONE'} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
