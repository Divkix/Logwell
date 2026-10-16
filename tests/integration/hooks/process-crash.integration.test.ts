import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vite-plus/test";

// Runs a real Node process (via tsx, as scripts/ do) that registers reportFatalError the way
// hooks.server.ts does, then faults: the log line must carry an error ID and the process must
// still die with exit code 1 rather than keep serving in an unknown state.
function crash(fault: string) {
  const script = `
    import { reportFatalError } from "#lib/server/error-handler.js";
    process.on("uncaughtExceptionMonitor", (error, origin) => void reportFatalError(error, origin));
    setTimeout(() => console.log("still running"), 200);
    ${fault}
  `;

  return spawnSync("node_modules/.bin/tsx", ["-e", script], { encoding: "utf8", timeout: 20_000 });
}

describe("process-level fault reporting", () => {
  it.each([
    ["unhandledRejection", `Promise.reject(new Error("boom"));`],
    ["uncaughtException", `setTimeout(() => { throw new Error("boom"); });`],
  ])("logs a %s with an error ID, then exits 1", (origin, fault) => {
    const result = crash(fault);

    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("still running");
    expect(result.stderr).toMatch(new RegExp(`\\[FATAL\\] [\\w-]{12} \\| ${origin} \\| boom`));
  });
});
