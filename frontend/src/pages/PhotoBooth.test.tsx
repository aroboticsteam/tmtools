import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoBoothPage } from './PhotoBooth';

let canUpload = true;
const mutate = vi.fn();
const pushToast = vi.fn();

vi.mock('../hooks/usePermission', () => ({ usePermission: () => canUpload }));
vi.mock('../api/teams', () => ({ useTeams: () => ({ data: [{ team_number: '1234A' }] }) }));
vi.mock('../api/settings', () => ({ useSettings: () => ({ data: [] }) }));
vi.mock('../api/photos', () => ({
  PHOTO_KIND_LABEL: { bot_photo: 'Robot photo', team_photo: 'Team photo' },
  useTeamPhotos: () => ({ data: undefined }),
  useUploadPhoto: () => ({ mutate, isPending: false }),
}));
vi.mock('../stores/ui', () => ({ useUiStore: (sel: (s: { pushToast: typeof pushToast }) => unknown) => sel({ pushToast }) }));
vi.mock('../components/teams/ChromaKeyPreview', () => ({ ChromaKeyPreview: () => <div>keyed preview</div> }));

function installCamera(available: boolean) {
  const stop = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: available
      ? {
          getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }),
          enumerateDevices: vi.fn().mockResolvedValue([{ kind: 'videoinput', deviceId: 'cam1', label: 'Capture card' }]),
        }
      : undefined,
  });
}

beforeEach(() => {
  canUpload = true;
  mutate.mockReset();
  pushToast.mockReset();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 1920 });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 1080 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
    cb(new Blob(['jpeg-bytes'], { type: 'image/jpeg' }));
  });
  URL.createObjectURL = vi.fn(() => 'blob:photo');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PhotoBoothPage', () => {
  it('disables taking a photo without the upload permission and explains why', async () => {
    canUpload = false;
    installCamera(true);
    render(<PhotoBoothPage />);
    expect(screen.getByText(/need the video upload permission/)).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('21549A'), '1234A');
    expect(screen.getByRole('button', { name: /Take photo/ })).toBeDisabled();
  });

  it('counts down, snaps a square still, and uploads it with the chosen kind', async () => {
    installCamera(true);
    render(<PhotoBoothPage />);
    const take = screen.getByRole('button', { name: /Take photo/ });
    expect(take).toBeDisabled(); // no team yet
    fireEvent.change(screen.getByPlaceholderText('21549A'), { target: { value: '1234a' } });
    fireEvent.change(screen.getByLabelText('Photo kind'), { target: { value: 'team_photo' } });
    await waitFor(() => expect(take).toBeEnabled());

    vi.useFakeTimers();
    fireEvent.click(take);
    expect(screen.getByText('3')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText('keyed preview')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Upload photo/ }));
    expect(mutate).toHaveBeenCalledTimes(1);
    const args = mutate.mock.calls[0][0];
    expect(args).toMatchObject({ number: '1234A', kind: 'team_photo', keyColour: '#00B140' });
    expect(args.file).toBeInstanceOf(File);
    expect(args.file.name).toBe('1234A-team_photo.jpg');
    expect(args.file.type).toBe('image/jpeg');
  });

  it('retake returns to the live camera without uploading', async () => {
    installCamera(true);
    render(<PhotoBoothPage />);
    fireEvent.change(screen.getByPlaceholderText('21549A'), { target: { value: '1234A' } });
    const take = screen.getByRole('button', { name: /Take photo/ });
    await waitFor(() => expect(take).toBeEnabled());
    vi.useFakeTimers();
    fireEvent.click(take);
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    fireEvent.click(screen.getByRole('button', { name: /Retake/ }));
    expect(screen.getByRole('button', { name: /Take photo/ })).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('shows an error and the file-upload hint when the camera is unavailable', async () => {
    installCamera(false);
    render(<PhotoBoothPage />);
    expect(await screen.findByText(/no camera access/)).toBeInTheDocument();
    expect(screen.getByText(/Add a photo from a file/)).toBeInTheDocument();
  });
});
