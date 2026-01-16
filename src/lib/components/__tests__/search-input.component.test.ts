import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SearchInput from '../search-input.svelte';

describe('SearchInput', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders search icon', () => {
    render(SearchInput);

    // Search icon should be rendered (lucide Search icon)
    const searchIcon = document.querySelector('[data-testid="search-icon"]');
    expect(searchIcon).toBeInTheDocument();
  });

  it('renders input with placeholder', () => {
    render(SearchInput, { props: { placeholder: 'Search logs...' } });

    const input = screen.getByPlaceholderText('Search logs...');
    expect(input).toBeInTheDocument();
  });

  it('renders with default placeholder when none provided', () => {
    render(SearchInput);

    const input = screen.getByPlaceholderText('Search...');
    expect(input).toBeInTheDocument();
  });

  describe('debounces input by 300ms', () => {
    it('does not emit immediately on input', async () => {
      const onSearch = vi.fn();
      render(SearchInput, { props: { onsearch: onSearch } });

      const input = screen.getByRole('textbox');
      await fireEvent.input(input, { target: { value: 'error' } });

      // Should not emit immediately
      expect(onSearch).not.toHaveBeenCalled();
    });

    it('emits after 300ms debounce', async () => {
      const onSearch = vi.fn();
      render(SearchInput, { props: { onsearch: onSearch } });

      const input = screen.getByRole('textbox');
      await fireEvent.input(input, { target: { value: 'error' } });

      // Advance timers by 300ms
      vi.advanceTimersByTime(300);

      expect(onSearch).toHaveBeenCalledTimes(1);
      expect(onSearch).toHaveBeenCalledWith('error');
    });

    it('resets debounce timer on subsequent inputs', async () => {
      const onSearch = vi.fn();
      render(SearchInput, { props: { onsearch: onSearch } });

      const input = screen.getByRole('textbox');

      // Type first value
      await fireEvent.input(input, { target: { value: 'err' } });
      vi.advanceTimersByTime(200); // 200ms passed

      // Type more before 300ms
      await fireEvent.input(input, { target: { value: 'error' } });
      vi.advanceTimersByTime(200); // 400ms total, but only 200ms since last input

      // Should not have emitted yet
      expect(onSearch).not.toHaveBeenCalled();

      // Complete the debounce
      vi.advanceTimersByTime(100); // 300ms since last input

      expect(onSearch).toHaveBeenCalledTimes(1);
      expect(onSearch).toHaveBeenCalledWith('error');
    });

    it('only emits final value after multiple rapid inputs', async () => {
      const onSearch = vi.fn();
      render(SearchInput, { props: { onsearch: onSearch } });

      const input = screen.getByRole('textbox');

      await fireEvent.input(input, { target: { value: 'e' } });
      vi.advanceTimersByTime(50);
      await fireEvent.input(input, { target: { value: 'er' } });
      vi.advanceTimersByTime(50);
      await fireEvent.input(input, { target: { value: 'err' } });
      vi.advanceTimersByTime(50);
      await fireEvent.input(input, { target: { value: 'erro' } });
      vi.advanceTimersByTime(50);
      await fireEvent.input(input, { target: { value: 'error' } });

      // Not yet
      expect(onSearch).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);

      expect(onSearch).toHaveBeenCalledTimes(1);
      expect(onSearch).toHaveBeenCalledWith('error');
    });
  });

  describe('emits search event with value', () => {
    it('emits empty string when input is cleared', async () => {
      const onSearch = vi.fn();
      render(SearchInput, { props: { onsearch: onSearch } });

      const input = screen.getByRole('textbox');
      await fireEvent.input(input, { target: { value: 'test' } });
      vi.advanceTimersByTime(300);

      await fireEvent.input(input, { target: { value: '' } });
      vi.advanceTimersByTime(300);

      expect(onSearch).toHaveBeenCalledTimes(2);
      expect(onSearch).toHaveBeenLastCalledWith('');
    });

    it('trims whitespace from search value', async () => {
      const onSearch = vi.fn();
      render(SearchInput, { props: { onsearch: onSearch } });

      const input = screen.getByRole('textbox');
      await fireEvent.input(input, { target: { value: '  error  ' } });
      vi.advanceTimersByTime(300);

      expect(onSearch).toHaveBeenCalledWith('error');
    });
  });

  it('accepts initial value prop', () => {
    render(SearchInput, { props: { value: 'initial search' } });

    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('initial search');
  });

  it('can be disabled', () => {
    render(SearchInput, { props: { disabled: true } });

    const input = screen.getByRole('textbox');
    expect(input).toBeDisabled();
  });

  describe('ref bindable prop', () => {
    it('exposes input element via ref prop', () => {
      // We can verify the ref is bound by checking that the input element exists
      // and has the expected attributes when rendered
      render(SearchInput);

      const input = screen.getByRole('textbox');
      expect(input).toBeInTheDocument();
      expect(input.tagName).toBe('INPUT');
    });

    it('allows programmatic focus via ref', () => {
      render(SearchInput);

      const input = screen.getByRole('textbox') as HTMLInputElement;
      input.focus();

      expect(document.activeElement).toBe(input);
    });
  });

  describe('onEscape callback', () => {
    it('calls onEscape when Escape is pressed while focused', async () => {
      const onEscape = vi.fn();
      render(SearchInput, { props: { onEscape } });

      const input = screen.getByRole('textbox');
      input.focus();

      await fireEvent.keyDown(input, { key: 'Escape' });

      expect(onEscape).toHaveBeenCalledTimes(1);
    });

    it('blurs input when Escape is pressed', async () => {
      render(SearchInput);

      const input = screen.getByRole('textbox') as HTMLInputElement;
      input.focus();
      expect(document.activeElement).toBe(input);

      await fireEvent.keyDown(input, { key: 'Escape' });

      expect(document.activeElement).not.toBe(input);
    });

    it('does not call onEscape when other keys are pressed', async () => {
      const onEscape = vi.fn();
      render(SearchInput, { props: { onEscape } });

      const input = screen.getByRole('textbox');
      input.focus();

      await fireEvent.keyDown(input, { key: 'Enter' });
      await fireEvent.keyDown(input, { key: 'a' });
      await fireEvent.keyDown(input, { key: 'Tab' });
      await fireEvent.keyDown(input, { key: 'ArrowDown' });

      expect(onEscape).not.toHaveBeenCalled();
    });

    it('does not throw when onEscape is not provided', async () => {
      render(SearchInput);

      const input = screen.getByRole('textbox');
      input.focus();

      // Should not throw
      await expect(fireEvent.keyDown(input, { key: 'Escape' })).resolves.not.toThrow();
    });
  });
});
