import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SHORTCUTS } from '$lib/utils/keyboard';
import KeyboardHelpModal from '../keyboard-help-modal.svelte';

describe('KeyboardHelpModal', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders when open=true', () => {
      render(KeyboardHelpModal, { props: { open: true } });

      expect(screen.getByTestId('keyboard-help-modal')).toBeInTheDocument();
    });

    it('does not render when open=false', () => {
      render(KeyboardHelpModal, { props: { open: false } });

      expect(screen.queryByTestId('keyboard-help-modal')).not.toBeInTheDocument();
    });

    it('renders modal title', () => {
      render(KeyboardHelpModal, { props: { open: true } });

      expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
    });
  });

  describe('displays all shortcuts from SHORTCUTS array', () => {
    it('displays all shortcut keys', () => {
      render(KeyboardHelpModal, { props: { open: true } });

      for (const shortcut of SHORTCUTS) {
        // Check that the key is displayed (as kbd element text)
        expect(screen.getByText(shortcut.key)).toBeInTheDocument();
      }
    });

    it('displays all shortcut descriptions', () => {
      render(KeyboardHelpModal, { props: { open: true } });

      for (const shortcut of SHORTCUTS) {
        expect(screen.getByText(shortcut.description)).toBeInTheDocument();
      }
    });

    it('displays navigation group header', () => {
      render(KeyboardHelpModal, { props: { open: true } });

      expect(screen.getByText('Navigation')).toBeInTheDocument();
    });

    it('displays search group header', () => {
      render(KeyboardHelpModal, { props: { open: true } });

      expect(screen.getByText('Search & Filters')).toBeInTheDocument();
    });

    it('displays other group header', () => {
      render(KeyboardHelpModal, { props: { open: true } });

      expect(screen.getByText('Other')).toBeInTheDocument();
    });
  });

  describe('calls onClose when Escape pressed', () => {
    it('calls onClose when Escape key is pressed', async () => {
      const onClose = vi.fn();
      render(KeyboardHelpModal, { props: { open: true, onClose } });

      await fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose for other keys', async () => {
      const onClose = vi.fn();
      render(KeyboardHelpModal, { props: { open: true, onClose } });

      await fireEvent.keyDown(document, { key: 'Enter' });
      await fireEvent.keyDown(document, { key: 'a' });
      await fireEvent.keyDown(document, { key: 'Tab' });

      expect(onClose).not.toHaveBeenCalled();
    });

    it('does not throw when onClose is not provided', async () => {
      render(KeyboardHelpModal, { props: { open: true } });

      // Should not throw
      await expect(fireEvent.keyDown(document, { key: 'Escape' })).resolves.not.toThrow();
    });
  });

  describe('calls onClose when backdrop clicked', () => {
    it('calls onClose when backdrop overlay is clicked', async () => {
      const onClose = vi.fn();
      render(KeyboardHelpModal, { props: { open: true, onClose } });

      const overlay = screen.getByTestId('modal-overlay');
      await fireEvent.click(overlay);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose when modal content is clicked', async () => {
      const onClose = vi.fn();
      render(KeyboardHelpModal, { props: { open: true, onClose } });

      const modal = screen.getByTestId('keyboard-help-modal');
      await fireEvent.click(modal);

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('close button', () => {
    it('renders close button', () => {
      render(KeyboardHelpModal, { props: { open: true } });

      expect(screen.getByTestId('close-button')).toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', async () => {
      const onClose = vi.fn();
      render(KeyboardHelpModal, { props: { open: true, onClose } });

      const closeButton = screen.getByTestId('close-button');
      await fireEvent.click(closeButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('accessibility', () => {
    it('has appropriate dialog role', () => {
      render(KeyboardHelpModal, { props: { open: true } });

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('has aria-modal attribute', () => {
      render(KeyboardHelpModal, { props: { open: true } });

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it('has aria-labelledby pointing to title', () => {
      render(KeyboardHelpModal, { props: { open: true } });

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-labelledby', 'keyboard-help-title');
    });

    it('close button has accessible label', () => {
      render(KeyboardHelpModal, { props: { open: true } });

      const closeButton = screen.getByTestId('close-button');
      expect(closeButton).toHaveAccessibleName(/close/i);
    });

    it('shortcut keys have aria-labels', () => {
      render(KeyboardHelpModal, { props: { open: true } });

      // Query directly for kbd elements since they don't have a standard ARIA role
      const allKbds = document.querySelectorAll('kbd');
      expect(allKbds.length).toBe(SHORTCUTS.length);
      for (const kbd of allKbds) {
        expect(kbd).toHaveAttribute('aria-label');
      }
    });
  });
});
