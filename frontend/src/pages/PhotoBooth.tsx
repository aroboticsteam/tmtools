import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, Upload } from 'lucide-react';
import { useTeams } from '../api/teams';
import { PHOTO_KIND_LABEL, useTeamPhotos, useUploadPhoto } from '../api/photos';
import { useSettings } from '../api/settings';
import { usePermission } from '../hooks/usePermission';
import { useUiStore } from '../stores/ui';
import { ChromaKeyPreview } from '../components/teams/ChromaKeyPreview';
import { StatusBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, PageHeader } from '../components/ui/Card';
import { Input, Label, Select } from '../components/ui/Input';
import {
  PHOTO_COUNTDOWN_SECONDS,
  PHOTO_MIME,
  PHOTO_QUALITY,
  isValidTeamNumber,
  photoFileName,
  photoSize,
  squareCrop,
} from '../lib/recorder';
import type { PhotoKind } from '../types/api';

type Phase = 'idle' | 'countdown' | 'review';

const FALLBACK_KEY = { colour: '#00B140', similarity: 0.1, blend: 0.05 };

/** Takes a square still from a webcam / capture card straight in the browser,
 * then uploads it for chroma keying. Two photos per team: the bot and the team.
 * Flow: pick team + kind + camera -> countdown -> snap -> review (keyed preview,
 * retake) -> upload. */
export function PhotoBoothPage() {
  const canUpload = usePermission('video:upload');
  const { data: teams } = useTeams();
  const { data: settings } = useSettings();
  const pushToast = useUiStore((s) => s.pushToast);
  const upload = useUploadPhoto();
  const keyDefaults = settings?.find((s) => s.key === 'chroma_key_defaults')?.value;
  const key = {
    keyColour: String(keyDefaults?.colour ?? FALLBACK_KEY.colour),
    similarity: Number(keyDefaults?.similarity ?? FALLBACK_KEY.similarity),
    blend: Number(keyDefaults?.blend ?? FALLBACK_KEY.blend),
  };

  const [team, setTeam] = useState('');
  const [kind, setKind] = useState<PhotoKind>('bot_photo');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [countdown, setCountdown] = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  const validTeam = isValidTeamNumber(team);
  const number = team.trim().toUpperCase();
  const { data: photos } = useTeamPhotos(validTeam ? number : null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(
    async (id: string) => {
      stopCamera();
      setCameraError(null);
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera access (https is required)');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            ...(id ? { deviceId: { exact: id } } : {}),
            width: { ideal: 4096 },
            height: { ideal: 2160 },
          },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'));
      } catch (err) {
        setCameraError(err instanceof Error ? err.message : 'Could not access the camera');
      }
    },
    [stopCamera],
  );

  useEffect(() => {
    if (phase !== 'review') void startCamera(deviceId);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  useEffect(
    () => () => {
      stopCamera();
      if (timerRef.current != null) window.clearInterval(timerRef.current);
    },
    [stopCamera],
  );

  /** Crops the live frame to a centred square at the camera's own resolution (capped) and keeps it as a JPEG. */
  function snap() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setCameraError('The camera is not ready yet');
      setPhase('idle');
      return;
    }
    const size = photoSize(video.videoWidth, video.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const { sx, sy, size: src } = squareCrop(video.videoWidth, video.videoHeight);
    canvas.getContext('2d')?.drawImage(video, sx, sy, src, src, 0, 0, size, size);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          pushToast('Could not capture the photo', 'error');
          setPhase('idle');
          return;
        }
        const file = new File([blob], photoFileName(number, kind), { type: PHOTO_MIME });
        setPhoto({ file, url: URL.createObjectURL(file) });
        setPhase('review');
        stopCamera();
      },
      PHOTO_MIME,
      PHOTO_QUALITY,
    );
  }

  function startCountdown() {
    setPhase('countdown');
    let remaining = PHOTO_COUNTDOWN_SECONDS;
    setCountdown(remaining);
    timerRef.current = window.setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining > 0) return;
      if (timerRef.current != null) window.clearInterval(timerRef.current);
      timerRef.current = null;
      snap();
    }, 1000);
  }

  function retake() {
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
    setPhase('idle');
    void startCamera(deviceId);
  }

  function submit() {
    if (!photo || !validTeam) return;
    upload.mutate(
      { number, kind, file: photo.file, keyColour: key.keyColour, similarity: key.similarity, blend: key.blend },
      {
        onSuccess: () => {
          pushToast(`${number} ${PHOTO_KIND_LABEL[kind].toLowerCase()} uploaded — keying in progress`, 'success');
          retake();
        },
        onError: (err) => pushToast(err instanceof Error ? err.message : 'Upload failed', 'error'),
      },
    );
  }

  const busy = phase === 'countdown';

  return (
    <div>
      <PageHeader
        title="Photo booth"
        subtitle="Take a square photo of a bot or team in front of the green screen. It's keyed to a transparent PNG for the stream graphics."
      />
      {!canUpload && <p className="mb-3 text-sm text-vmd-danger">You need the video upload permission to take photos.</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <div className="relative mx-auto aspect-square w-full max-w-xl overflow-hidden rounded-xl bg-black">
            {/* The live camera is always mounted (object-cover = the same centred square that gets snapped). */}
            <video
              ref={videoRef}
              className={`h-full w-full object-cover ${phase === 'review' ? 'hidden' : ''}`}
              playsInline
              muted
            />
            {phase === 'review' && photo && <ChromaKeyPreview file={photo.file} params={key} />}
            {phase === 'countdown' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-8xl font-bold text-white">
                {countdown}
              </div>
            )}
          </div>
          {cameraError && <p className="mt-2 text-sm text-vmd-danger">{cameraError}</p>}
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {phase === 'review' ? (
              <>
                <Button variant="secondary" onClick={retake}>
                  <RefreshCw size={14} /> Retake
                </Button>
                <Button variant="primary" onClick={submit} disabled={!validTeam || !canUpload || upload.isPending}>
                  <Upload size={14} /> {upload.isPending ? 'Uploading…' : 'Upload photo'}
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={startCountdown} disabled={!validTeam || !canUpload || !!cameraError || busy}>
                <Camera size={14} /> Take photo
              </Button>
            )}
          </div>
          {cameraError && canUpload && (
            <p className="mt-2 text-center text-xs text-vmd-textSubtle">
              No camera? Add a photo from a file on the team&apos;s page instead (Teams, then the team, then Robot &amp; Team Photos).
            </p>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="space-y-3">
              <div>
                <Label>Team number</Label>
                <Input list="booth-teams" value={team} onChange={(e) => setTeam(e.target.value.toUpperCase())} placeholder="21549A" disabled={busy} />
                <datalist id="booth-teams">
                  {(teams ?? []).map((t) => (
                    <option key={t.team_number} value={t.team_number} />
                  ))}
                </datalist>
              </div>
              <div>
                <Label>Photo</Label>
                <Select value={kind} onChange={(e) => setKind(e.target.value as PhotoKind)} disabled={busy || phase === 'review'} aria-label="Photo kind">
                  <option value="bot_photo">{PHOTO_KIND_LABEL.bot_photo} (in front of green screen)</option>
                  <option value="team_photo">{PHOTO_KIND_LABEL.team_photo} (in front of green screen)</option>
                </Select>
              </div>
              <div>
                <Label>Camera</Label>
                <Select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={busy || phase === 'review'}>
                  <option value="">Default camera</option>
                  {devices.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `Camera ${i + 1}`}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </Card>
          {validTeam && (
            <Card>
              <p className="mb-2 text-sm font-medium text-vmd-textStrong">{number} photos</p>
              {(Object.keys(PHOTO_KIND_LABEL) as PhotoKind[]).map((k) => {
                const p = photos?.photos[k];
                return (
                  <div key={k} className="flex items-center justify-between py-1 text-sm">
                    <span className="text-vmd-textMuted">{PHOTO_KIND_LABEL[k]}</span>
                    <span title={p?.error ?? undefined}>
                      <StatusBadge status={p?.status ?? 'NONE'} />
                    </span>
                  </div>
                );
              })}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
