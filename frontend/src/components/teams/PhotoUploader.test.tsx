import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoUploader } from './PhotoUploader';

let canUpload = true;
const mutate = vi.fn();

vi.mock('../../hooks/usePermission', () => ({ usePermission: () => canUpload }));
vi.mock('../../api/settings', () => ({ useSettings: () => ({ data: [] }) }));
vi.mock('../../api/photos', () => ({
  PHOTO_KIND_LABEL: { bot_photo: 'Robot photo', team_photo: 'Team photo' },
  useTeamPhotos: () => ({ data: { photos: { bot_photo: { status: 'DONE', error: null }, team_photo: { status: 'NONE', error: null } } } }),
  useUploadPhoto: () => ({ mutate, isPending: false }),
}));
vi.mock('../../stores/ui', () => ({ useUiStore: (sel: (s: { pushToast: () => void }) => unknown) => sel({ pushToast: vi.fn() }) }));
vi.mock('./ChromaKeyPreview', () => ({ ChromaKeyPreview: ({ file }: { file: File | null }) => <div>{file ? `preview ${file.name}` : 'no file'}</div> }));

const renderIt = () =>
  render(
    <MemoryRouter>
      <PhotoUploader teamNumber="1234A" />
    </MemoryRouter>,
  );

describe('PhotoUploader (file fallback, no in-browser camera)', () => {
  beforeEach(() => {
    canUpload = true;
    mutate.mockReset();
  });

  it('offers a normal file picker restricted to images plus a phone-camera input', () => {
    renderIt();
    const picker = screen.getByLabelText('Choose photo file');
    expect(picker).toHaveAttribute('accept', expect.stringContaining('.png'));
    expect(picker).not.toHaveAttribute('capture');
    const cam = screen.getByLabelText('Take photo with device camera');
    expect(cam).toHaveAttribute('accept', 'image/*');
    expect(cam).toHaveAttribute('capture', 'environment');
    expect(screen.getByRole('link', { name: 'Photo Booth' })).toHaveAttribute('href', '/record');
  });

  it('previews a chosen file and uploads it as the selected kind', () => {
    renderIt();
    const file = new File(['x'], 'bot.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Choose photo file'), { target: { files: [file] } });
    expect(screen.getByText('preview bot.jpg')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Photo kind'), { target: { value: 'team_photo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Process & Upload' }));
    expect(mutate.mock.calls[0][0]).toMatchObject({ number: '1234A', kind: 'team_photo', file, keyColour: '#00B140' });
  });

  it('hides the upload controls without the permission but still shows status', () => {
    canUpload = false;
    renderIt();
    expect(screen.queryByLabelText('Choose photo file')).not.toBeInTheDocument();
    expect(screen.getByText('Robot photo')).toBeInTheDocument();
  });
});
