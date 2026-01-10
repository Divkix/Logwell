/**
 * Source location information captured from stack trace
 */
export interface SourceLocation {
  sourceFile: string;
  lineNumber: number;
}

/**
 * V8 format regex (Node.js, Bun, Chrome):
 * "    at functionName (/path/to/file.ts:42:15)"
 * "    at /path/to/file.ts:42:15"
 * "    at async functionName (/path/to/file.ts:42:15)"
 *
 * Captures:
 * - Group 1: file path (including protocols like webpack://, file://, http://)
 * - Group 2: line number
 */
const V8_REGEX = /^\s*at\s+(?:async\s+)?(?:\S+\s+)?\(?(.+):(\d+):\d+\)?$/;

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

  // Try V8 format first (most common in Node.js/Bun)
  let match = V8_REGEX.exec(frameLine);
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

  // Try SpiderMonkey/JSC format
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

  const lines = stack.split('\n');

  // Skip the "Error" message line and internal frames
  // Frame 0: captureSourceLocation
  // Frame 1+: caller frames based on skipFrames
  const targetFrameIndex = 1 + skipFrames + 1; // +1 for "Error" line, +1 for this function

  const targetFrame = lines[targetFrameIndex];
  if (targetFrame === undefined) {
    return undefined;
  }

  return parseStackFrame(targetFrame);
}
