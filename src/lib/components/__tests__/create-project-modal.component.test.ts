/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import CreateProjectModal from "../create-project-modal.svelte";

describe("CreateProjectModal", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows validation error for empty name", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(CreateProjectModal, { props: { open: true, onCreate, onClose } });

    const submitButton = screen.getByRole("button", { name: "Create" });
    await user.click(submitButton);

    const error = screen.getByTestId("error-message");
    expect(error).toBeInTheDocument();
    expect(error).toHaveTextContent(/cannot be empty/i);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("shows validation error for whitespace-only name", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(CreateProjectModal, { props: { open: true, onCreate } });

    const input = screen.getByLabelText("Name");
    await user.clear(input);
    await user.type(input, "   ");
    await user.click(screen.getByRole("button", { name: "Create" }));

    const error = screen.getByTestId("error-message");
    expect(error).toBeInTheDocument();
    expect(error).toHaveTextContent(/cannot be empty/i);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("shows validation error for invalid characters", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(CreateProjectModal, { props: { open: true, onCreate } });

    const input = screen.getByLabelText("Name");
    await user.clear(input);
    await user.type(input, "my project!");
    await user.click(screen.getByRole("button", { name: "Create" }));

    const error = screen.getByTestId("error-message");
    expect(error).toBeInTheDocument();
    expect(error).toHaveTextContent(/alphanumeric/i);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("shows validation error for name exceeding 50 characters", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(CreateProjectModal, { props: { open: true, onCreate } });

    const input = screen.getByLabelText("Name");
    await user.clear(input);
    await user.type(input, "a".repeat(51));
    await user.click(screen.getByRole("button", { name: "Create" }));

    const error = screen.getByTestId("error-message");
    expect(error).toBeInTheDocument();
    expect(error).toHaveTextContent(/cannot exceed 50/i);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("calls onCreate with trimmed name for valid input", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(CreateProjectModal, { props: { open: true, onCreate, onClose } });

    const input = screen.getByLabelText("Name");
    await user.clear(input);
    await user.type(input, "my-valid-project");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith("my-valid-project");
  });

  it("calls onClose when modal is closed via backdrop", async () => {
    const onClose = vi.fn();
    render(CreateProjectModal, { props: { open: true, onClose } });

    const backdrop = screen.getByTestId("modal-overlay");
    await user.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    render(CreateProjectModal, { props: { open: true, onClose } });

    const closeButton = screen.getByTestId("close-button");
    await user.click(closeButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render when open is false", () => {
    render(CreateProjectModal, { props: { open: false } });

    expect(screen.queryByTestId("modal-content")).not.toBeInTheDocument();
    expect(screen.queryByTestId("modal-overlay")).not.toBeInTheDocument();
  });
});
