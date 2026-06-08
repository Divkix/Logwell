import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function loadJournalEntries(): JournalEntry[] {
  const journalPath = path.resolve(process.cwd(), "drizzle/meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as {
    entries: JournalEntry[];
  };
  return [...journal.entries].sort((a, b) => a.idx - b.idx);
}

describe("drizzle migration journal", () => {
  it("has strictly increasing `when` timestamps in `idx` order", () => {
    const entries = loadJournalEntries();
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1]!;
      const curr = entries[i]!;
      expect(
        curr.when > prev.when,
        `Migration "${curr.tag}" (when=${curr.when}) must have a 'when' strictly greater than the preceding migration "${prev.tag}" (when=${prev.when}). drizzle-kit skips entries whose timestamp is not greater than the latest applied migration.`,
      ).toBe(true);
    }
  });

  it("has contiguous `idx` values with no gaps or duplicates", () => {
    const entries = loadJournalEntries();
    entries.forEach((entry, position) => {
      expect(
        entry.idx,
        `Migration "${entry.tag}" has idx=${entry.idx} but is at sorted position ${position}; idx values must be contiguous and unique.`,
      ).toBe(position);
    });
  });
});
