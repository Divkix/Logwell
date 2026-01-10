import { describe, expect, it } from 'vitest';
import { captureSourceLocation, parseStackFrame } from '../../src/source-location';

describe('parseStackFrame', () => {
  describe('V8 format (Node/Bun/Chrome)', () => {
    it('parses stack frame with function name', () => {
      const frame = '    at myFunction (/Users/dev/app/src/index.ts:42:15)';
      const result = parseStackFrame(frame);
      expect(result).toEqual({
        sourceFile: '/Users/dev/app/src/index.ts',
        lineNumber: 42,
      });
    });

    it('parses stack frame without function name (anonymous)', () => {
      const frame = '    at /Users/dev/app/src/index.ts:42:15';
      const result = parseStackFrame(frame);
      expect(result).toEqual({
        sourceFile: '/Users/dev/app/src/index.ts',
        lineNumber: 42,
      });
    });

    it('parses stack frame with method name', () => {
      const frame = '    at Object.myMethod (/Users/dev/app/src/utils.ts:100:5)';
      const result = parseStackFrame(frame);
      expect(result).toEqual({
        sourceFile: '/Users/dev/app/src/utils.ts',
        lineNumber: 100,
      });
    });

    it('parses stack frame with async function', () => {
      const frame = '    at async handleRequest (/Users/dev/app/src/handler.ts:25:10)';
      const result = parseStackFrame(frame);
      expect(result).toEqual({
        sourceFile: '/Users/dev/app/src/handler.ts',
        lineNumber: 25,
      });
    });
  });

  describe('SpiderMonkey/JSC format (Firefox/Safari)', () => {
    it('parses stack frame with function name', () => {
      const frame = 'myFunction@/Users/dev/app/src/index.ts:42:15';
      const result = parseStackFrame(frame);
      expect(result).toEqual({
        sourceFile: '/Users/dev/app/src/index.ts',
        lineNumber: 42,
      });
    });

    it('parses stack frame with anonymous function', () => {
      const frame = '@/Users/dev/app/src/index.ts:42:15';
      const result = parseStackFrame(frame);
      expect(result).toEqual({
        sourceFile: '/Users/dev/app/src/index.ts',
        lineNumber: 42,
      });
    });
  });

  describe('Windows paths', () => {
    it('parses Windows path with drive letter', () => {
      const frame = '    at myFunction (C:\\Users\\dev\\app\\src\\index.ts:42:15)';
      const result = parseStackFrame(frame);
      expect(result).toEqual({
        sourceFile: 'C:\\Users\\dev\\app\\src\\index.ts',
        lineNumber: 42,
      });
    });

    it('parses Windows UNC path', () => {
      const frame = '    at myFunction (\\\\server\\share\\src\\index.ts:42:15)';
      const result = parseStackFrame(frame);
      expect(result).toEqual({
        sourceFile: '\\\\server\\share\\src\\index.ts',
        lineNumber: 42,
      });
    });
  });

  describe('bundler paths', () => {
    it('parses webpack bundled path', () => {
      const frame = '    at myFunction (webpack:///src/index.ts:42:15)';
      const result = parseStackFrame(frame);
      expect(result).toEqual({
        sourceFile: 'webpack:///src/index.ts',
        lineNumber: 42,
      });
    });

    it('parses file:// protocol path', () => {
      const frame = '    at myFunction (file:///Users/dev/app/src/index.ts:42:15)';
      const result = parseStackFrame(frame);
      expect(result).toEqual({
        sourceFile: 'file:///Users/dev/app/src/index.ts',
        lineNumber: 42,
      });
    });

    it('parses http/https paths', () => {
      const frame = '    at myFunction (https://cdn.example.com/bundle.js:1:2345)';
      const result = parseStackFrame(frame);
      expect(result).toEqual({
        sourceFile: 'https://cdn.example.com/bundle.js',
        lineNumber: 1,
      });
    });
  });

  describe('invalid input', () => {
    it('returns undefined for empty string', () => {
      expect(parseStackFrame('')).toBeUndefined();
    });

    it('returns undefined for random garbage', () => {
      expect(parseStackFrame('random garbage')).toBeUndefined();
    });

    it('returns undefined for Error message line', () => {
      expect(parseStackFrame('Error: something went wrong')).toBeUndefined();
    });

    it('returns undefined for stack frame without line number', () => {
      expect(parseStackFrame('    at myFunction (/path/to/file.ts)')).toBeUndefined();
    });
  });
});

describe('captureSourceLocation', () => {
  it('captures source location from current call site', () => {
    const result = captureSourceLocation(0);
    expect(result).toBeDefined();
    expect(result?.sourceFile).toContain('source-location.unit.test.ts');
    expect(typeof result?.lineNumber).toBe('number');
    expect(result?.lineNumber).toBeGreaterThan(0);
  });

  it('skips correct number of frames', () => {
    function wrapper() {
      return captureSourceLocation(1); // Skip wrapper, get caller
    }
    const result = wrapper();
    expect(result).toBeDefined();
    expect(result?.sourceFile).toContain('source-location.unit.test.ts');
  });

  it('skips multiple frames correctly', () => {
    function innerWrapper() {
      return captureSourceLocation(2); // Skip innerWrapper and outerWrapper
    }
    function outerWrapper() {
      return innerWrapper();
    }
    const result = outerWrapper();
    expect(result).toBeDefined();
    expect(result?.sourceFile).toContain('source-location.unit.test.ts');
  });

  it('returns undefined when skipFrames exceeds stack depth', () => {
    const result = captureSourceLocation(1000);
    expect(result).toBeUndefined();
  });
});
