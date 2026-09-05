import type { LogLevel } from "$lib/server/db/schema";

export function getLevelColor(level: LogLevel): string {
  switch (level) {
    case "debug":
      return "hsl(215, 15%, 50%)";
    case "info":
      return "hsl(210, 100%, 50%)";
    case "warn":
      return "hsl(45, 100%, 50%)";
    case "error":
      return "hsl(0, 85%, 55%)";
    case "fatal":
      return "hsl(270, 70%, 55%)";
  }
}

export function getLevelBgClass(level: LogLevel): string {
  switch (level) {
    case "debug":
      return "bg-slate-500/20";
    case "info":
      return "bg-blue-500/20";
    case "warn":
      return "bg-amber-500/20";
    case "error":
      return "bg-red-500/20";
    case "fatal":
      return "bg-purple-500/20";
  }
}
