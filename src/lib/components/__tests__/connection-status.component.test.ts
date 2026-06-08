import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vite-plus/test";
import ConnectionStatus from "../connection-status.svelte";

describe("ConnectionStatus", () => {
  afterEach(() => {
    cleanup();
  });

  describe("connecting state", () => {
    it("displays connecting message when isConnecting is true", () => {
      render(ConnectionStatus, { props: { isConnecting: true, error: null } });

      const element = screen.getByTestId("connection-connecting");
      expect(element).toBeInTheDocument();
      expect(element).toHaveTextContent("Connecting...");
    });

    it("applies correct styling for connecting state", () => {
      render(ConnectionStatus, { props: { isConnecting: true, error: null } });

      const element = screen.getByTestId("connection-connecting");
      expect(element).toHaveClass("text-muted-foreground");
    });

    it("does not display error when connecting", () => {
      render(ConnectionStatus, { props: { isConnecting: true, error: new Error("Test") } });

      expect(screen.queryByTestId("connection-error")).not.toBeInTheDocument();
      expect(screen.getByTestId("connection-connecting")).toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("displays error message when error exists and not connecting", () => {
      const error = new Error("Connection failed");
      render(ConnectionStatus, { props: { isConnecting: false, error } });

      const element = screen.getByTestId("connection-error");
      expect(element).toBeInTheDocument();
      expect(element).toHaveTextContent("Connection error");
    });

    it("shows error details in title attribute", () => {
      const error = new Error("Network timeout");
      render(ConnectionStatus, { props: { isConnecting: false, error } });

      const element = screen.getByTestId("connection-error");
      expect(element).toHaveAttribute("title", "Network timeout");
    });

    it("applies correct styling for error state", () => {
      const error = new Error("Failed");
      render(ConnectionStatus, { props: { isConnecting: false, error } });

      const element = screen.getByTestId("connection-error");
      expect(element).toHaveClass("text-destructive");
    });
  });

  describe("connected state", () => {
    it("renders nothing when connected successfully", () => {
      render(ConnectionStatus, { props: { isConnecting: false, error: null } });

      expect(screen.queryByTestId("connection-connecting")).not.toBeInTheDocument();
      expect(screen.queryByTestId("connection-error")).not.toBeInTheDocument();
    });
  });

  describe("state transitions", () => {
    it("transitions from connecting to connected", async () => {
      const { rerender } = render(ConnectionStatus, {
        props: { isConnecting: true, error: null },
      });

      expect(screen.getByTestId("connection-connecting")).toBeInTheDocument();

      await rerender({ isConnecting: false, error: null });

      expect(screen.queryByTestId("connection-connecting")).not.toBeInTheDocument();
    });

    it("transitions from connecting to error", async () => {
      const { rerender } = render(ConnectionStatus, {
        props: { isConnecting: true, error: null },
      });

      expect(screen.getByTestId("connection-connecting")).toBeInTheDocument();

      await rerender({ isConnecting: false, error: new Error("Failed") });

      expect(screen.queryByTestId("connection-connecting")).not.toBeInTheDocument();
      expect(screen.getByTestId("connection-error")).toBeInTheDocument();
    });
  });
});
