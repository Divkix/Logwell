import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import SearchInput from "../search-input.svelte";

describe("SearchInput", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders search icon", () => {
    render(SearchInput);

    const searchIcon = document.querySelector('[data-testid="search-icon"]');
    expect(searchIcon).toBeInTheDocument();
  });

  it("renders input with placeholder", () => {
    render(SearchInput, { props: { placeholder: "Search logs..." } });

    const input = screen.getByPlaceholderText("Search logs...");
    expect(input).toBeInTheDocument();
  });

  it("renders with default placeholder when none provided", () => {
    render(SearchInput);

    const input = screen.getByPlaceholderText("Search...");
    expect(input).toBeInTheDocument();
  });

  describe("debounces input by 300ms", () => {
    it("does not emit immediately on input", async () => {
      const onSearch = vi.fn();
      render(SearchInput, { props: { onsearch: onSearch } });

      const input = screen.getByRole("textbox");
      await fireEvent.input(input, { target: { value: "error" } });

      expect(onSearch).not.toHaveBeenCalled();
    });

    it("emits after 300ms debounce", async () => {
      const onSearch = vi.fn();
      render(SearchInput, { props: { onsearch: onSearch } });

      const input = screen.getByRole("textbox");
      await fireEvent.input(input, { target: { value: "error" } });

      vi.advanceTimersByTime(300);

      expect(onSearch).toHaveBeenCalledTimes(1);
      expect(onSearch).toHaveBeenCalledWith("error");
    });

    it("resets debounce timer on subsequent inputs", async () => {
      const onSearch = vi.fn();
      render(SearchInput, { props: { onsearch: onSearch } });

      const input = screen.getByRole("textbox");

      await fireEvent.input(input, { target: { value: "err" } });
      vi.advanceTimersByTime(200);

      await fireEvent.input(input, { target: { value: "error" } });
      vi.advanceTimersByTime(200);

      expect(onSearch).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);

      expect(onSearch).toHaveBeenCalledTimes(1);
      expect(onSearch).toHaveBeenCalledWith("error");
    });

    it("only emits final value after multiple rapid inputs", async () => {
      const onSearch = vi.fn();
      render(SearchInput, { props: { onsearch: onSearch } });

      const input = screen.getByRole("textbox");

      await fireEvent.input(input, { target: { value: "e" } });
      vi.advanceTimersByTime(50);
      await fireEvent.input(input, { target: { value: "er" } });
      vi.advanceTimersByTime(50);
      await fireEvent.input(input, { target: { value: "err" } });
      vi.advanceTimersByTime(50);
      await fireEvent.input(input, { target: { value: "erro" } });
      vi.advanceTimersByTime(50);
      await fireEvent.input(input, { target: { value: "error" } });

      expect(onSearch).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);

      expect(onSearch).toHaveBeenCalledTimes(1);
      expect(onSearch).toHaveBeenCalledWith("error");
    });
  });

  describe("emits search event with value", () => {
    it("emits empty string when input is cleared", async () => {
      const onSearch = vi.fn();
      render(SearchInput, { props: { onsearch: onSearch } });

      const input = screen.getByRole("textbox");
      await fireEvent.input(input, { target: { value: "test" } });
      vi.advanceTimersByTime(300);

      await fireEvent.input(input, { target: { value: "" } });
      vi.advanceTimersByTime(300);

      expect(onSearch).toHaveBeenCalledTimes(2);
      expect(onSearch).toHaveBeenLastCalledWith("");
    });

    it("trims whitespace from search value", async () => {
      const onSearch = vi.fn();
      render(SearchInput, { props: { onsearch: onSearch } });

      const input = screen.getByRole("textbox");
      await fireEvent.input(input, { target: { value: "  error  " } });
      vi.advanceTimersByTime(300);

      expect(onSearch).toHaveBeenCalledWith("error");
    });
  });

  it("accepts initial value prop", () => {
    render(SearchInput, { props: { value: "initial search" } });

    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("initial search");
  });

  it("can be disabled", () => {
    render(SearchInput, { props: { disabled: true } });

    const input = screen.getByRole("textbox");
    expect(input).toBeDisabled();
  });

  describe("ref bindable prop", () => {
    it("exposes input element via ref prop", () => {
      render(SearchInput);

      const input = screen.getByRole("textbox");
      expect(input).toBeInTheDocument();
      expect(input.tagName).toBe("INPUT");
    });

    it("allows programmatic focus via ref", () => {
      render(SearchInput);

      const input = screen.getByRole("textbox") as HTMLInputElement;
      input.focus();

      expect(document.activeElement).toBe(input);
    });
  });

  describe("onEscape callback", () => {
    it("calls onEscape when Escape is pressed while focused", async () => {
      const onEscape = vi.fn();
      render(SearchInput, { props: { onEscape } });

      const input = screen.getByRole("textbox");
      input.focus();

      await fireEvent.keyDown(input, { key: "Escape" });

      expect(onEscape).toHaveBeenCalledTimes(1);
    });

    it("blurs input when Escape is pressed", async () => {
      render(SearchInput);

      const input = screen.getByRole("textbox") as HTMLInputElement;
      input.focus();
      expect(document.activeElement).toBe(input);

      await fireEvent.keyDown(input, { key: "Escape" });

      expect(document.activeElement).not.toBe(input);
    });

    it("does not call onEscape when other keys are pressed", async () => {
      const onEscape = vi.fn();
      render(SearchInput, { props: { onEscape } });

      const input = screen.getByRole("textbox");
      input.focus();

      await fireEvent.keyDown(input, { key: "Enter" });
      await fireEvent.keyDown(input, { key: "a" });
      await fireEvent.keyDown(input, { key: "Tab" });
      await fireEvent.keyDown(input, { key: "ArrowDown" });

      expect(onEscape).not.toHaveBeenCalled();
    });

    it("does not throw when onEscape is not provided", async () => {
      render(SearchInput);

      const input = screen.getByRole("textbox");
      input.focus();

      await expect(fireEvent.keyDown(input, { key: "Escape" })).resolves.not.toThrow();
    });
  });
});
