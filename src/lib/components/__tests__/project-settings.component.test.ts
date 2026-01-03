import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '$lib/server/db/schema';
import ProjectSettings from '../project-settings.svelte';

// Mock clipboard API
const mockClipboard = {
  writeText: vi.fn().mockResolvedValue(undefined),
};
Object.assign(navigator, { clipboard: mockClipboard });

describe('ProjectSettings', () => {
  const baseProject: Project = {
    id: 'proj_123',
    name: 'my-backend',
    apiKey: 'svl_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456',
    createdAt: new Date('2024-01-10T10:00:00Z'),
    updatedAt: new Date('2024-01-15T14:00:00Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('displays API key', () => {
    it('displays the full API key', () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      expect(screen.getByTestId('api-key-display')).toHaveTextContent(
        'svl_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456',
      );
    });

    it('displays API Key section label', () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      expect(screen.getByText('API Key')).toBeInTheDocument();
    });

    it('does not render when open is false', () => {
      render(ProjectSettings, { props: { project: baseProject, open: false } });

      expect(screen.queryByTestId('api-key-display')).not.toBeInTheDocument();
    });
  });

  describe('copy button copies API key', () => {
    it('renders copy button', () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      expect(screen.getByTestId('copy-api-key-button')).toBeInTheDocument();
    });

    it('copies API key when copy button is clicked', async () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      const copyButton = screen.getByTestId('copy-api-key-button');
      await fireEvent.click(copyButton);

      expect(mockClipboard.writeText).toHaveBeenCalledWith('svl_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456');
    });

    it('copy button has accessible label', () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      const copyButton = screen.getByTestId('copy-api-key-button');
      expect(copyButton).toHaveAccessibleName(/copy/i);
    });
  });

  describe('regenerate button triggers confirmation', () => {
    it('renders regenerate button', () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      expect(screen.getByTestId('regenerate-button')).toBeInTheDocument();
    });

    it('shows confirmation dialog when regenerate button is clicked', async () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      const regenerateButton = screen.getByTestId('regenerate-button');
      await fireEvent.click(regenerateButton);

      expect(screen.getByTestId('regenerate-confirm-dialog')).toBeInTheDocument();
    });

    it('confirmation dialog has warning message', async () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      const regenerateButton = screen.getByTestId('regenerate-button');
      await fireEvent.click(regenerateButton);

      expect(screen.getByText(/invalidate/i)).toBeInTheDocument();
    });

    it('calls onRegenerate when confirmation is accepted', async () => {
      const onRegenerate = vi.fn();
      render(ProjectSettings, {
        props: { project: baseProject, open: true, onRegenerate },
      });

      const regenerateButton = screen.getByTestId('regenerate-button');
      await fireEvent.click(regenerateButton);

      const confirmButton = screen.getByTestId('confirm-regenerate-button');
      await fireEvent.click(confirmButton);

      expect(onRegenerate).toHaveBeenCalledTimes(1);
    });

    it('does not call onRegenerate when confirmation is cancelled', async () => {
      const onRegenerate = vi.fn();
      render(ProjectSettings, {
        props: { project: baseProject, open: true, onRegenerate },
      });

      const regenerateButton = screen.getByTestId('regenerate-button');
      await fireEvent.click(regenerateButton);

      const cancelButton = screen.getByTestId('cancel-regenerate-button');
      await fireEvent.click(cancelButton);

      expect(onRegenerate).not.toHaveBeenCalled();
    });
  });

  describe('delete requires typing project name', () => {
    it('renders delete button in danger zone', () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      expect(screen.getByTestId('delete-project-button')).toBeInTheDocument();
    });

    it('displays danger zone section', () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      expect(screen.getByText('Danger Zone')).toBeInTheDocument();
    });

    it('shows delete confirmation dialog when delete button is clicked', async () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      const deleteButton = screen.getByTestId('delete-project-button');
      await fireEvent.click(deleteButton);

      expect(screen.getByTestId('delete-confirm-dialog')).toBeInTheDocument();
    });

    it('shows project name input in delete confirmation', async () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      const deleteButton = screen.getByTestId('delete-project-button');
      await fireEvent.click(deleteButton);

      expect(screen.getByTestId('delete-confirm-input')).toBeInTheDocument();
    });

    it('displays instruction to type project name', async () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      const deleteButton = screen.getByTestId('delete-project-button');
      await fireEvent.click(deleteButton);

      const instruction = screen.getByTestId('delete-instruction');
      expect(instruction).toBeInTheDocument();
      expect(instruction.textContent).toMatch(/type.*my-backend.*to confirm/i);
    });

    it('confirm delete button is disabled when project name is not typed', async () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      const deleteButton = screen.getByTestId('delete-project-button');
      await fireEvent.click(deleteButton);

      const confirmDeleteButton = screen.getByTestId('confirm-delete-button');
      expect(confirmDeleteButton).toBeDisabled();
    });

    it('confirm delete button is enabled when project name is typed correctly', async () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      const deleteButton = screen.getByTestId('delete-project-button');
      await fireEvent.click(deleteButton);

      const input = screen.getByTestId('delete-confirm-input');
      await fireEvent.input(input, { target: { value: 'my-backend' } });

      const confirmDeleteButton = screen.getByTestId('confirm-delete-button');
      expect(confirmDeleteButton).not.toBeDisabled();
    });

    it('confirm delete button remains disabled for partial match', async () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      const deleteButton = screen.getByTestId('delete-project-button');
      await fireEvent.click(deleteButton);

      const input = screen.getByTestId('delete-confirm-input');
      await fireEvent.input(input, { target: { value: 'my-back' } });

      const confirmDeleteButton = screen.getByTestId('confirm-delete-button');
      expect(confirmDeleteButton).toBeDisabled();
    });

    it('calls onDelete when project name is typed and confirm is clicked', async () => {
      const onDelete = vi.fn();
      render(ProjectSettings, {
        props: { project: baseProject, open: true, onDelete },
      });

      const deleteButton = screen.getByTestId('delete-project-button');
      await fireEvent.click(deleteButton);

      const input = screen.getByTestId('delete-confirm-input');
      await fireEvent.input(input, { target: { value: 'my-backend' } });

      const confirmDeleteButton = screen.getByTestId('confirm-delete-button');
      await fireEvent.click(confirmDeleteButton);

      expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it('does not call onDelete when confirmation is cancelled', async () => {
      const onDelete = vi.fn();
      render(ProjectSettings, {
        props: { project: baseProject, open: true, onDelete },
      });

      const deleteButton = screen.getByTestId('delete-project-button');
      await fireEvent.click(deleteButton);

      const cancelButton = screen.getByTestId('cancel-delete-button');
      await fireEvent.click(cancelButton);

      expect(onDelete).not.toHaveBeenCalled();
    });
  });

  describe('shows usage example with curl', () => {
    it('displays usage example section', () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      expect(screen.getByText('OTLP/HTTP Example')).toBeInTheDocument();
    });

    it('displays curl command', () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      const curlExample = screen.getByTestId('curl-example');
      expect(curlExample).toBeInTheDocument();
      expect(curlExample).toHaveTextContent(/curl/);
    });

    it('curl example includes API key', () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      const curlExample = screen.getByTestId('curl-example');
      expect(curlExample).toHaveTextContent(/svl_aBcD/);
    });

    it('curl example includes Authorization header', () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      const curlExample = screen.getByTestId('curl-example');
      expect(curlExample).toHaveTextContent(/Authorization.*Bearer/);
    });

    it('curl example includes correct endpoint', () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      const curlExample = screen.getByTestId('curl-example');
      expect(curlExample).toHaveTextContent(/\/v1\/logs/);
    });

    it('curl example includes Content-Type header', () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      const curlExample = screen.getByTestId('curl-example');
      expect(curlExample).toHaveTextContent(/Content-Type.*application\/json/);
    });

    it('curl example includes sample JSON body', () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      const curlExample = screen.getByTestId('curl-example');
      expect(curlExample).toHaveTextContent(/resourceLogs/);
      expect(curlExample).toHaveTextContent(/logRecords/);
    });
  });

  describe('modal behavior', () => {
    it('calls onClose when close button is clicked', async () => {
      const onClose = vi.fn();
      render(ProjectSettings, {
        props: { project: baseProject, open: true, onClose },
      });

      const closeButton = screen.getByTestId('close-button');
      await fireEvent.click(closeButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when Escape key is pressed', async () => {
      const onClose = vi.fn();
      render(ProjectSettings, {
        props: { project: baseProject, open: true, onClose },
      });

      await fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when overlay is clicked', async () => {
      const onClose = vi.fn();
      render(ProjectSettings, {
        props: { project: baseProject, open: true, onClose },
      });

      const overlay = screen.getByTestId('modal-overlay');
      await fireEvent.click(overlay);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose when modal content is clicked', async () => {
      const onClose = vi.fn();
      render(ProjectSettings, {
        props: { project: baseProject, open: true, onClose },
      });

      const content = screen.getByTestId('modal-content');
      await fireEvent.click(content);

      expect(onClose).not.toHaveBeenCalled();
    });

    it('displays project name in title', () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      expect(screen.getByText('Project Settings')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has appropriate dialog role', () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('close button has accessible label', () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      const closeButton = screen.getByTestId('close-button');
      expect(closeButton).toHaveAccessibleName(/close/i);
    });

    it('delete button has destructive styling indication', () => {
      render(ProjectSettings, { props: { project: baseProject, open: true } });

      const deleteButton = screen.getByTestId('delete-project-button');
      expect(deleteButton).toHaveTextContent(/delete/i);
    });
  });
});
