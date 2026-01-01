import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TimeRangePicker from '../time-range-picker.svelte';

describe('TimeRangePicker', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('renders 15m, 1h, 24h, 7d options', () => {
    it('renders 15m option', () => {
      render(TimeRangePicker);

      expect(screen.getByRole('button', { name: /15 minutes/i })).toBeInTheDocument();
    });

    it('renders 1h option', () => {
      render(TimeRangePicker);

      expect(screen.getByRole('button', { name: /last hour/i })).toBeInTheDocument();
    });

    it('renders 24h option', () => {
      render(TimeRangePicker);

      expect(screen.getByRole('button', { name: /24 hours/i })).toBeInTheDocument();
    });

    it('renders 7d option', () => {
      render(TimeRangePicker);

      expect(screen.getByRole('button', { name: /7 days/i })).toBeInTheDocument();
    });

    it('renders all options in correct order', () => {
      render(TimeRangePicker);

      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(4);
      expect(buttons[0]).toHaveTextContent('15m');
      expect(buttons[1]).toHaveTextContent('1h');
      expect(buttons[2]).toHaveTextContent('24h');
      expect(buttons[3]).toHaveTextContent('7d');
    });
  });

  describe('highlights selected range', () => {
    it('highlights 15m when selected', () => {
      render(TimeRangePicker, { props: { value: '15m' } });

      const button = screen.getByRole('button', { name: /15 minutes/i });
      expect(button).toHaveAttribute('data-selected', 'true');
      expect(button).toHaveAttribute('aria-pressed', 'true');
    });

    it('highlights 1h when selected', () => {
      render(TimeRangePicker, { props: { value: '1h' } });

      const button = screen.getByRole('button', { name: /last hour/i });
      expect(button).toHaveAttribute('data-selected', 'true');
      expect(button).toHaveAttribute('aria-pressed', 'true');
    });

    it('highlights 24h when selected', () => {
      render(TimeRangePicker, { props: { value: '24h' } });

      const button = screen.getByRole('button', { name: /24 hours/i });
      expect(button).toHaveAttribute('data-selected', 'true');
      expect(button).toHaveAttribute('aria-pressed', 'true');
    });

    it('highlights 7d when selected', () => {
      render(TimeRangePicker, { props: { value: '7d' } });

      const button = screen.getByRole('button', { name: /7 days/i });
      expect(button).toHaveAttribute('data-selected', 'true');
      expect(button).toHaveAttribute('aria-pressed', 'true');
    });

    it('does not highlight unselected options', () => {
      render(TimeRangePicker, { props: { value: '1h' } });

      expect(screen.getByRole('button', { name: /15 minutes/i })).not.toHaveAttribute(
        'data-selected',
        'true',
      );
      expect(screen.getByRole('button', { name: /24 hours/i })).not.toHaveAttribute(
        'data-selected',
        'true',
      );
      expect(screen.getByRole('button', { name: /7 days/i })).not.toHaveAttribute(
        'data-selected',
        'true',
      );
    });

    it('defaults to 1h when no value provided', () => {
      render(TimeRangePicker);

      const button = screen.getByRole('button', { name: /last hour/i });
      expect(button).toHaveAttribute('data-selected', 'true');
      expect(button).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('emits change event with range value', () => {
    it('emits change event when clicking 15m', async () => {
      const onchange = vi.fn();
      render(TimeRangePicker, { props: { onchange } });

      const button = screen.getByRole('button', { name: /15 minutes/i });
      await fireEvent.click(button);

      expect(onchange).toHaveBeenCalledTimes(1);
      expect(onchange).toHaveBeenCalledWith('15m');
    });

    it('emits change event when clicking 1h', async () => {
      const onchange = vi.fn();
      render(TimeRangePicker, { props: { value: '15m', onchange } });

      const button = screen.getByRole('button', { name: /last hour/i });
      await fireEvent.click(button);

      expect(onchange).toHaveBeenCalledTimes(1);
      expect(onchange).toHaveBeenCalledWith('1h');
    });

    it('emits change event when clicking 24h', async () => {
      const onchange = vi.fn();
      render(TimeRangePicker, { props: { onchange } });

      const button = screen.getByRole('button', { name: /24 hours/i });
      await fireEvent.click(button);

      expect(onchange).toHaveBeenCalledTimes(1);
      expect(onchange).toHaveBeenCalledWith('24h');
    });

    it('emits change event when clicking 7d', async () => {
      const onchange = vi.fn();
      render(TimeRangePicker, { props: { onchange } });

      const button = screen.getByRole('button', { name: /7 days/i });
      await fireEvent.click(button);

      expect(onchange).toHaveBeenCalledTimes(1);
      expect(onchange).toHaveBeenCalledWith('7d');
    });

    it('does not emit change event when clicking already selected option', async () => {
      const onchange = vi.fn();
      render(TimeRangePicker, { props: { value: '1h', onchange } });

      const button = screen.getByRole('button', { name: /last hour/i });
      await fireEvent.click(button);

      expect(onchange).not.toHaveBeenCalled();
    });
  });

  it('can be disabled', () => {
    render(TimeRangePicker, { props: { disabled: true } });

    const buttons = screen.getAllByRole('button');
    for (const button of buttons) {
      expect(button).toBeDisabled();
    }
  });
});
