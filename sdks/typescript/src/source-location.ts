/**
 * Source location information captured from stack trace
 */
export interface SourceLocation {
  sourceFile: string;
  lineNumber: number;
}

/**
 * V8 format with parentheses (Node.js, Bun, Chrome):
 * Handles all named function variants including:
 * - "    at functionName (/path/to/file.ts:42:15)"
 * - "    at async functionName (/path/to/file.ts:42:15)"
 * - "    at new ClassName (/path/to/file.ts:42:15)"
 * - "    at Object.method [as alias] (/path/to/file.ts:42:15)"
 *
 * Captures:
 * - Group 1: file path (including protocols like webpack://, file://, http://)
 * - Group 2: line number
 */
const V8_PAREN_REGEX = /\((.+):(\d+):\d+\)\s*$/;

/**
 * V8 format without parentheses (anonymous functions):
 * "    at /path/to/file.ts:42:15"
 *
 * Captures:
 * - Group 1: file path
 * - Group 2: line number
 */
const V8_BARE_REGEX = /^\s*at\s+(.+):(\d+):\d+$/;

/**
 * SpiderMonkey/JSC format regex (Firefox, Safari):
 * "functionName@/path/to/file.ts:42:15"
 * "@/path/to/file.ts:42:15"
 *
 * Captures:
 * - Group 1: file path
 * - Group 2: line number
 */
const SPIDERMONKEY_REGEX = /^[^@]*@(.+):(\d+):\d+$/;

/**
 * Parses a single stack frame line to extract source location.
 *
 * Supports:
 * - V8 format (Node.js, Bun, Chrome)
 * - SpiderMonkey format (Firefox)
 * - JSC format (Safari)
 * - Windows paths (C:\, UNC paths)
 * - Bundler paths (webpack://, file://, http://, https://)
 *
 * @param frameLine - Single line from Error.stack
 * @returns Source location or undefined if parsing fails
 */
export function parseStackFrame(frameLine: string): SourceLocation | undefined {
  if (!frameLine) {
    return undefined;
  }

  // Try V8 format with parentheses first (most common, handles all edge cases)
  let match = V8_PAREN_REGEX.exec(frameLine);
  if (match) {
    const sourceFile = match[1];
    const lineStr = match[2];
    if (sourceFile && lineStr) {
      const lineNumber = parseInt(lineStr, 10);
      if (!Number.isNaN(lineNumber)) {
        return { sourceFile, lineNumber };
      }
    }
  }

  // Try V8 format without parentheses (anonymous functions)
  match = V8_BARE_REGEX.exec(frameLine);
  if (match) {
    const sourceFile = match[1];
    const lineStr = match[2];
    if (sourceFile && lineStr) {
      const lineNumber = parseInt(lineStr, 10);
      if (!Number.isNaN(lineNumber)) {
        return { sourceFile, lineNumber };
      }
    }
  }

  // Try SpiderMonkey/JSC format (Firefox/Safari)
  match = SPIDERMONKEY_REGEX.exec(frameLine);
  if (match) {
    const sourceFile = match[1];
    const lineStr = match[2];
    if (sourceFile && lineStr) {
      const lineNumber = parseInt(lineStr, 10);
      if (!Number.isNaN(lineNumber)) {
        return { sourceFile, lineNumber };
      }
    }
  }

  return undefined;
}

/**
 * Captures the source location of the caller by parsing the stack trace.
 *
 * @param skipFrames - Number of stack frames to skip (0 = immediate caller)
 * @returns Source location or undefined if capture fails
 *
 * @example
 * // In a logging function that calls this
 * function log(message: string) {
 *   const location = captureSourceLocation(1); // Skip log() frame
 *   // location.sourceFile = file where log() was called
 * }
 */
export function captureSourceLocation(skipFrames: number): SourceLocation | undefined {
  const error = new Error();
  const stack = error.stack;

  if (!stack) {
    return undefined;
  }

  const lines = stack.split("\n");

  // Detect stack format:
  // - V8 (Node/Bun/Chrome): Has "Error" header line, frames start with "at"
  // - SpiderMonkey/JSC (Firefox/Safari): No header, frames contain "@"
  const firstLine = lines[0] || "";
  const hasErrorHeader = !firstLine.includes("@") && !/^\s*at\s/.test(firstLine);

  // Calculate target frame index:
  // Skip: header (if present) + captureSourceLocation frame + skipFrames
  const headerOffset = hasErrorHeader ? 1 : 0;
  const targetFrameIndex = headerOffset + 1 + skipFrames;

  const targetFrame = lines[targetFrameIndex];
  if (targetFrame === undefined) {
    return undefined;
  }

  return parseStackFrame(targetFrame);
}
