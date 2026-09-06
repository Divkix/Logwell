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

  it("debounces input and emits only the final value", async () => {
    const onSearch = vi.fn();
    render(SearchInput, { props: { onsearch: onSearch } });
    const input = screen.getByRole("textbox");

    await fireEvent.input(input, { target: { value: "err" } });
    vi.advanceTimersByTime(200);
    await fireEvent.input(input, { target: { value: "error" } });
    expect(onSearch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith("error");
  });

  it("trims whitespace and emits empty string on clear", async () => {
    const onSearch = vi.fn();
    render(SearchInput, { props: { onsearch: onSearch } });
    const input = screen.getByRole("textbox");

    await fireEvent.input(input, { target: { value: "  error  " } });
    vi.advanceTimersByTime(300);
    expect(onSearch).toHaveBeenCalledWith("error");

    await fireEvent.input(input, { target: { value: "" } });
    vi.advanceTimersByTime(300);
    expect(onSearch).toHaveBeenLastCalledWith("");
  });

  it("calls onEscape and blurs on Escape, ignoring other keys", async () => {
    const onEscape = vi.fn();
    render(SearchInput, { props: { onEscape } });
    const input = screen.getByRole("textbox") as HTMLInputElement;
    input.focus();

    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onEscape).not.toHaveBeenCalled();

    await fireEvent.keyDown(input, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(input);
  });

  it("does not throw on Escape without a handler", async () => {
    render(SearchInput);
    const input = screen.getByRole("textbox");
    input.focus();
    await expect(fireEvent.keyDown(input, { key: "Escape" })).resolves.not.toThrow();
  });
});
