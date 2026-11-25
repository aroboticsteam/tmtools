import { ImageOff } from 'lucide-react';
import { PHOTO_KIND_LABEL, useTeamPhotoUrls, useTeamPhotos } from '../../api/photos';
import { Section } from '../ui/Card';
import type { PhotoKind } from '../../types/api';

const KINDS: PhotoKind[] = ['bot_photo', 'team_photo'];

/** The robot photo and the team photo, side by side (keyed PNGs on a checkerboard). */
export function TeamPhotosPanel({ teamNumber }: { teamNumber: string }) {
  const { data: status } = useTeamPhotos(teamNumber);
  const version = KINDS.map((k) => `${status?.photos[k]?.status ?? ''}:${status?.photos[k]?.processed_s3_key ?? ''}`).join('|');
  const { data: urls } = useTeamPhotoUrls(teamNumber, version);

  return (
    <Section title="Photos" description="What the stream overlay and public team page show.">
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
        {KINDS.map((kind) => {
          const url = urls?.[kind];
          const st = status?.photos[kind]?.status;
          return (
            <figure key={kind} className="flex flex-col gap-2">
              <div
                className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-vmd-border"
                style={{ backgroundImage: 'conic-gradient(#f5f5f5 25%, #ffffff 0 50%, #f5f5f5 0 75%, #ffffff 0)', backgroundSize: '16px 16px' }}
              >
                {url ? (
                  <img src={url} alt={`${PHOTO_KIND_LABEL[kind]} for team ${teamNumber}`} className="h-full w-full object-contain" />
                ) : (
                  <div className="flex flex-col items-center gap-1 bg-white/80 px-3 py-2 text-center text-[13px] text-vmd-textSubtle">
                    <ImageOff size={20} aria-hidden="true" />
                    {st === 'PROCESSING' ? 'Processing…' : st === 'FAILED' ? 'Processing failed' : 'No photo yet'}
                  </div>
                )}
              </div>
              <figcaption className="flex items-center justify-between text-[13px]">
                <span className="font-medium text-vmd-textStrong">{PHOTO_KIND_LABEL[kind]}</span>
                {url && <a href={url} target="_blank" rel="noreferrer" className="text-vmd-textSubtle hover:text-vmd-textStrong hover:underline">Open full size</a>}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </Section>
  );
}
