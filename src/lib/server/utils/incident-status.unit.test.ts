import { describe, expect, it } from "vite-plus/test";
import { getIncidentStatus } from "./incidents";

describe("incident status helpers", () => {
  it.each([
    ["2026-02-12T11:31:00.000Z", "open", "within threshold"],
    ["2026-02-12T11:30:00.000Z", "open", "exactly at threshold boundary"],
    ["2026-02-12T11:29:59.000Z", "resolved", "past threshold"],
  ])("lastSeen %s is %s (%s)", (lastSeen, expected) => {
    expect(getIncidentStatus(new Date(lastSeen), new Date("2026-02-12T12:00:00.000Z"), 30)).toBe(
      expected,
    );
  });
});
