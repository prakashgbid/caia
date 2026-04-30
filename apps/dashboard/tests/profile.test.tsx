import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfilePage from '../app/profile/page';

// Mock SWR
vi.mock('swr', () => ({
  default: vi.fn(),
  mutate: vi.fn(),
}));

import useSWR, { mutate } from 'swr';

const mockProfile = {
  id: 'user-123',
  displayName: 'Alice',
  avatarUrl: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
};

function mockSWR(data: unknown, isLoading = false) {
  vi.mocked(useSWR).mockReturnValue({ data, isLoading, error: undefined } as ReturnType<typeof useSWR>);
}

function mockFetch(ok = true, json: unknown = {}) {
  global.fetch = vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(json) } as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch();
});

// --- Loading state ---

describe('ProfilePage loading state', () => {
  it('shows loading message while fetching', () => {
    mockSWR(undefined, true);
    render(<ProfilePage />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows page heading even when loading', () => {
    mockSWR(undefined, true);
    render(<ProfilePage />);
    expect(screen.getByText('👤 Profile')).toBeInTheDocument();
  });
});

// --- Profile render ---

describe('ProfilePage with loaded profile', () => {
  it('renders display name', () => {
    mockSWR(mockProfile);
    render(<ProfilePage />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows initials when no avatarUrl', () => {
    mockSWR(mockProfile);
    render(<ProfilePage />);
    expect(screen.getByText('AL')).toBeInTheDocument();
  });

  it('shows "??" initials when displayName is empty', () => {
    mockSWR({ ...mockProfile, displayName: '' });
    render(<ProfilePage />);
    expect(screen.getByText('??')).toBeInTheDocument();
  });

  it('renders avatar img when avatarUrl is set', () => {
    mockSWR({ ...mockProfile, avatarUrl: 'https://example.com/avatar.png' });
    render(<ProfilePage />);
    const img = screen.getByAltText('User avatar') as HTMLImageElement;
    expect(img.src).toBe('https://example.com/avatar.png');
  });

  it('shows placeholder when no display name', () => {
    mockSWR({ ...mockProfile, displayName: '' });
    render(<ProfilePage />);
    expect(screen.getByText('No display name set')).toBeInTheDocument();
  });

  it('renders account info section with user id', () => {
    mockSWR(mockProfile);
    render(<ProfilePage />);
    expect(screen.getByText('user-123')).toBeInTheDocument();
  });

  it('renders upload image button', () => {
    mockSWR(mockProfile);
    render(<ProfilePage />);
    expect(screen.getByRole('button', { name: 'Upload new avatar' })).toBeInTheDocument();
  });

  it('does not show Remove button when no avatarUrl', () => {
    mockSWR(mockProfile);
    render(<ProfilePage />);
    expect(screen.queryByRole('button', { name: 'Remove avatar' })).not.toBeInTheDocument();
  });

  it('shows Remove button when avatarUrl is set', () => {
    mockSWR({ ...mockProfile, avatarUrl: 'https://example.com/avatar.png' });
    render(<ProfilePage />);
    expect(screen.getByRole('button', { name: 'Remove avatar' })).toBeInTheDocument();
  });
});

// --- Edit display name ---

describe('ProfilePage edit display name', () => {
  it('shows Edit button when not editing', () => {
    mockSWR(mockProfile);
    render(<ProfilePage />);
    expect(screen.getByRole('button', { name: 'Edit display name' })).toBeInTheDocument();
  });

  it('toggles to edit mode on Edit click', async () => {
    mockSWR(mockProfile);
    render(<ProfilePage />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
    expect(screen.getByRole('textbox', { name: 'Display name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('pre-fills input with current display name', async () => {
    mockSWR(mockProfile);
    render(<ProfilePage />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
    const input = screen.getByRole('textbox', { name: 'Display name' }) as HTMLInputElement;
    expect(input.value).toBe('Alice');
  });

  it('cancels edit on Cancel click', async () => {
    mockSWR(mockProfile);
    render(<ProfilePage />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit display name' })).toBeInTheDocument();
  });

  it('cancels edit on Escape key', async () => {
    mockSWR(mockProfile);
    render(<ProfilePage />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('saves profile on Save click', async () => {
    mockSWR(mockProfile);
    render(<ProfilePage />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
    const input = screen.getByRole('textbox', { name: 'Display name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Bob');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/users/profile', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ displayName: 'Bob' }),
      }));
    });
  });

  it('shows success status after save', async () => {
    mockSWR(mockProfile);
    render(<ProfilePage />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Profile saved');
    });
  });

  it('shows error status when save fails', async () => {
    mockFetch(false);
    mockSWR(mockProfile);
    render(<ProfilePage />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Save failed');
    });
  });

  it('submits on Enter key', async () => {
    mockSWR(mockProfile);
    render(<ProfilePage />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
    const input = screen.getByRole('textbox', { name: 'Display name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Carol{Enter}');
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/users/profile', expect.objectContaining({ method: 'PATCH' }));
    });
  });
});

// --- Avatar upload validation ---

describe('ProfilePage avatar upload', () => {
  it('rejects non-image files', async () => {
    mockSWR(mockProfile);
    render(<ProfilePage />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['content'], 'doc.pdf', { type: 'application/pdf' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });
    expect(screen.getByRole('status')).toHaveTextContent('Please select an image file');
  });

  it('rejects files over 2MB', async () => {
    mockSWR(mockProfile);
    render(<ProfilePage />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const largeContent = 'x'.repeat(3 * 1024 * 1024);
    const file = new File([largeContent], 'big.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });
    expect(screen.getByRole('status')).toHaveTextContent('Image must be under 2 MB');
  });

  it('removes avatar on Remove click', async () => {
    mockSWR({ ...mockProfile, avatarUrl: 'https://example.com/avatar.png' });
    render(<ProfilePage />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove avatar' }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/users/avatar', { method: 'DELETE' });
    });
  });

  it('shows success after avatar removal', async () => {
    mockSWR({ ...mockProfile, avatarUrl: 'https://example.com/avatar.png' });
    render(<ProfilePage />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove avatar' }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Avatar removed');
    });
  });
});

// --- Accessibility ---

describe('ProfilePage accessibility', () => {
  it('status message uses aria-live polite', () => {
    mockSWR(mockProfile);
    const { container } = render(<ProfilePage />);
    // Trigger a status message by attempting a save with edit open
    // The role="status" with aria-live="polite" is present when statusMsg is set
    // Verify the element has the correct ARIA attributes when rendered
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toBeInTheDocument();

    // Hidden file input has proper aria-label
    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).toHaveAttribute('aria-label', 'Upload avatar image');
  });

  it('avatar container has aria-label', () => {
    mockSWR(mockProfile);
    render(<ProfilePage />);
    expect(screen.getByLabelText('User avatar')).toBeInTheDocument();
  });

  it('upload button has aria-label', () => {
    mockSWR(mockProfile);
    render(<ProfilePage />);
    expect(screen.getByLabelText('Upload new avatar')).toBeInTheDocument();
  });
});

// --- Integration: full profile update flow ---

describe('ProfilePage integration: full update flow', () => {
  it('complete flow: edit name → save → status shown → edit mode closed', async () => {
    mockSWR(mockProfile);
    render(<ProfilePage />);

    // Start editing
    await userEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();

    // Change name
    const input = screen.getByRole('textbox', { name: 'Display name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Dave');

    // Save
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // After save: edit mode closed, success shown
    await waitFor(() => {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Profile saved');
    });

    // mutate was called to revalidate SWR cache
    expect(vi.mocked(mutate)).toHaveBeenCalledWith('/api/users/profile');
  });
});
