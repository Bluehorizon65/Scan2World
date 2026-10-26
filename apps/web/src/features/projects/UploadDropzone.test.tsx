import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import { UploadDropzone } from './UploadDropzone';

afterEach(() => vi.restoreAllMocks());

const file = (name: string, bytes: number, type: string) => new File([new Uint8Array(bytes)], name, { type });

describe('UploadDropzone', () => {
  it('rejects oversized and unsupported files before uploading anything', async () => {
    const send = vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => {});
    renderWithProviders(<UploadDropzone projectId="p1" maxFileBytes={100} />);
    const input = screen.getByLabelText('Photo files');
    await userEvent.upload(input, [file('big.jpg', 500, 'image/jpeg'), file('notes.heic', 10, 'image/heic')], { applyAccept: false });
    expect(screen.getByText(/big\.jpg is larger than/)).toBeInTheDocument();
    expect(screen.getByText(/notes\.heic is not a JPEG, PNG or WebP image/)).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it('queues accepted files and shows per-file progress', async () => {
    const send = vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => {});
    renderWithProviders(<UploadDropzone projectId="p1" maxFileBytes={1000} />);
    await userEvent.upload(screen.getByLabelText('Photo files'), [file('a.jpg', 10, 'image/jpeg'), file('b.png', 10, 'image/png')]);
    expect(await screen.findByText('a.jpg')).toBeInTheDocument();
    expect(screen.getByText('b.png')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
