import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Log } from '$lib/server/db/schema';
import LogDetailModal from '../log-detail-modal.svelte';

// Mock clipboard API
const mockClipboard = {
  writeText: vi.fn().mockResolvedValue(undefined),
};
Object.assign(navigator, { clipboard: mockClipboard });

// Mock formatFullDate utility
vi.mock('$lib/utils/format', () => ({
  formatFullDate: vi.fn((date: Date) => {
    return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
  }),
}));

describe('LogDetailModal', () => {
  const baseLog: Log = {
    id: 'log_123',
    projectId: 'proj_456',
    incidentId: null,
    fingerprint: null,
    serviceName: null,
    level: 'info',
    message: 'User logged in successfully',
    metadata: { userId: 'user_789', action: 'login', details: { ip: '192.168.1.1' } },
    timeUnixNano: null,
    observedTimeUnixNano: null,
    severityNumber: null,
    severityText: null,
    body: null,
    droppedAttributesCount: null,
    flags: null,
    traceId: null,
    spanId: null,
    resourceAttributes: null,
    resourceDroppedAttributesCount: null,
    resourceSchemaUrl: null,
    scopeName: null,
    scopeVersion: null,
    scopeAttributes: null,
    scopeDroppedAttributesCount: null,
    scopeSchemaUrl: null,
    sourceFile: 'auth.ts',
    lineNumber: 42,
    requestId: 'req_abc',
    userId: 'user_789',
    ipAddress: '192.168.1.1',
    timestamp: new Date('2024-01-15T14:30:45.123Z'),
    search: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('displays all log fields', () => {
    it('displays log ID', () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      expect(screen.getByText('log_123')).toBeInTheDocument();
    });

    it('displays log level with badge', () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      expect(screen.getByText('INFO')).toBeInTheDocument();
    });

    it('displays log message', () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      expect(screen.getByText('User logged in successfully')).toBeInTheDocument();
    });

    it('displays source file and line number', () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      expect(screen.getByText('auth.ts:42')).toBeInTheDocument();
    });

    it('displays request ID', () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      expect(screen.getByText('req_abc')).toBeInTheDocument();
    });

    it('displays user ID', () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      expect(screen.getByText('user_789')).toBeInTheDocument();
    });

    it('displays IP address', () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
    });

    it('shows N/A for missing optional fields', () => {
      const logWithMissingFields: Log = {
        ...baseLog,
        sourceFile: null,
        lineNumber: null,
        requestId: null,
        userId: null,
        ipAddress: null,
      };
      render(LogDetailModal, { props: { log: logWithMissingFields, open: true } });

      const naElements = screen.getAllByText('N/A');
      expect(naElements.length).toBeGreaterThanOrEqual(4);
    });

    it('does not render when open is false', () => {
      render(LogDetailModal, { props: { log: baseLog, open: false } });

      expect(screen.queryByText('log_123')).not.toBeInTheDocument();
    });
  });

  describe('formats timestamp as full date', () => {
    it('displays timestamp in full date format', () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      // The mocked formatFullDate returns ISO format
      expect(screen.getByText(/2024-01-15 14:30:45\.123 UTC/)).toBeInTheDocument();
    });

    it('displays label for timestamp field', () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      expect(screen.getByText('Timestamp')).toBeInTheDocument();
    });

    it('handles null timestamp gracefully', () => {
      const logWithNullTimestamp = { ...baseLog, timestamp: null };
      render(LogDetailModal, { props: { log: logWithNullTimestamp, open: true } });

      expect(screen.getByText('N/A')).toBeInTheDocument();
    });
  });

  describe('pretty-prints metadata JSON', () => {
    it('displays metadata in formatted JSON', () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      // Check for JSON structure with indentation
      const metadataElement = screen.getByTestId('log-metadata');
      expect(metadataElement).toBeInTheDocument();
      expect(metadataElement.textContent).toContain('"userId"');
      expect(metadataElement.textContent).toContain('"action"');
    });

    it('formats nested JSON objects correctly', () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      const metadataElement = screen.getByTestId('log-metadata');
      expect(metadataElement.textContent).toContain('"details"');
      expect(metadataElement.textContent).toContain('"ip"');
    });

    it('shows N/A for null metadata', () => {
      const logWithNullMetadata = { ...baseLog, metadata: null };
      render(LogDetailModal, { props: { log: logWithNullMetadata, open: true } });

      const metadataSection = screen.getByTestId('metadata-section');
      expect(metadataSection).toHaveTextContent('N/A');
    });

    it('handles empty object metadata', () => {
      const logWithEmptyMetadata = { ...baseLog, metadata: {} };
      render(LogDetailModal, { props: { log: logWithEmptyMetadata, open: true } });

      const metadataElement = screen.getByTestId('log-metadata');
      expect(metadataElement.textContent).toContain('{}');
    });
  });

  describe('copy buttons copy values to clipboard', () => {
    it('copies log ID when copy button is clicked', async () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      const copyIdButton = screen.getByTestId('copy-id-button');
      await fireEvent.click(copyIdButton);

      expect(mockClipboard.writeText).toHaveBeenCalledWith('log_123');
    });

    it('copies message when copy button is clicked', async () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      const copyMessageButton = screen.getByTestId('copy-message-button');
      await fireEvent.click(copyMessageButton);

      expect(mockClipboard.writeText).toHaveBeenCalledWith('User logged in successfully');
    });

    it('copies metadata JSON when copy button is clicked', async () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      const copyMetadataButton = screen.getByTestId('copy-metadata-button');
      await fireEvent.click(copyMetadataButton);

      expect(mockClipboard.writeText).toHaveBeenCalledWith(
        JSON.stringify(baseLog.metadata, null, 2),
      );
    });

    it('copies request ID when available', async () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      const copyRequestIdButton = screen.getByTestId('copy-request-id-button');
      await fireEvent.click(copyRequestIdButton);

      expect(mockClipboard.writeText).toHaveBeenCalledWith('req_abc');
    });

    it('does not show copy button for null metadata', () => {
      const logWithNullMetadata = { ...baseLog, metadata: null };
      render(LogDetailModal, { props: { log: logWithNullMetadata, open: true } });

      expect(screen.queryByTestId('copy-metadata-button')).not.toBeInTheDocument();
    });
  });

  describe('closes on Escape key', () => {
    it('calls onClose when Escape key is pressed', async () => {
      const onClose = vi.fn();
      render(LogDetailModal, { props: { log: baseLog, open: true, onClose } });

      await fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose for other keys', async () => {
      const onClose = vi.fn();
      render(LogDetailModal, { props: { log: baseLog, open: true, onClose } });

      await fireEvent.keyDown(document, { key: 'Enter' });

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('closes on overlay click', () => {
    it('calls onClose when overlay is clicked', async () => {
      const onClose = vi.fn();
      render(LogDetailModal, { props: { log: baseLog, open: true, onClose } });

      const overlay = screen.getByTestId('modal-overlay');
      await fireEvent.click(overlay);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose when content is clicked', async () => {
      const onClose = vi.fn();
      render(LogDetailModal, { props: { log: baseLog, open: true, onClose } });

      const content = screen.getByTestId('modal-content');
      await fireEvent.click(content);

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('close button', () => {
    it('renders close button', () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      expect(screen.getByTestId('close-button')).toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', async () => {
      const onClose = vi.fn();
      render(LogDetailModal, { props: { log: baseLog, open: true, onClose } });

      const closeButton = screen.getByTestId('close-button');
      await fireEvent.click(closeButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('accessibility', () => {
    it('has appropriate dialog role', () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('has appropriate aria-labelledby', () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-labelledby');
    });

    it('close button has accessible label', () => {
      render(LogDetailModal, { props: { log: baseLog, open: true } });

      const closeButton = screen.getByTestId('close-button');
      expect(closeButton).toHaveAccessibleName(/close/i);
    });
  });
});
