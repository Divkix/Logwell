import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TimeRangePicker from '../time-range-picker.svelte';

const TIME_RANGES = [
  { value: '15m', label: /15 minutes/i, initialValue: '1h' },
  { value: '1h', label: /last hour/i, initialValue: '15m' },
  { value: '24h', label: /24 hours/i, initialValue: '1h' },
  { value: '7d', label: /7 days/i, initialValue: '1h' },
] as const;

describe('TimeRangePicker', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('renders 15m, 1h, 24h, 7d options', () => {
    it.each(TIME_RANGES)('renders $value option', ({ label }) => {
      render(TimeRangePicker);

      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
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
    it.each(TIME_RANGES)('highlights $value when selected', ({ value, label }) => {
      render(TimeRangePicker, { props: { value } });

      const button = screen.getByRole('button', { name: label });
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
    it.each(TIME_RANGES)('emits change event when clicking $value', async ({
      value,
      label,
      initialValue,
    }) => {
      const onchange = vi.fn();
      render(TimeRangePicker, { props: { value: initialValue, onchange } });

      const button = screen.getByRole('button', { name: label });
      await fireEvent.click(button);

      expect(onchange).toHaveBeenCalledTimes(1);
      expect(onchange).toHaveBeenCalledWith(value);
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
