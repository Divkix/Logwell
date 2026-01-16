import { FORM_ELEMENTS, SHORTCUTS, shouldBlockShortcut } from './keyboard';

/**
 * Helper to create a mock KeyboardEvent with customizable properties.
 * Uses plain object instead of document.createElement since unit tests
 * run in Node.js environment without DOM.
 */
function createMockKeyboardEvent(options: {
  targetTagName?: string;
  isComposing?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}): KeyboardEvent {
  const {
    targetTagName = 'DIV',
    isComposing = false,
    ctrlKey = false,
    altKey = false,
    metaKey = false,
  } = options;

  // Create a plain object that mimics HTMLElement with tagName property
  const target = { tagName: targetTagName };

  return {
    target,
    isComposing,
    ctrlKey,
    altKey,
    metaKey,
  } as unknown as KeyboardEvent;
}

describe('shouldBlockShortcut', () => {
  describe('returns true for form elements', () => {
    it('blocks shortcuts when target is INPUT element', () => {
      const event = createMockKeyboardEvent({ targetTagName: 'INPUT' });
      expect(shouldBlockShortcut(event)).toBe(true);
    });

    it('blocks shortcuts when target is TEXTAREA element', () => {
      const event = createMockKeyboardEvent({ targetTagName: 'TEXTAREA' });
      expect(shouldBlockShortcut(event)).toBe(true);
    });

    it('blocks shortcuts when target is SELECT element', () => {
      const event = createMockKeyboardEvent({ targetTagName: 'SELECT' });
      expect(shouldBlockShortcut(event)).toBe(true);
    });
  });

  describe('returns true for IME composition', () => {
    it('blocks shortcuts when event.isComposing is true', () => {
      const event = createMockKeyboardEvent({ isComposing: true });
      expect(shouldBlockShortcut(event)).toBe(true);
    });
  });

  describe('returns true for modifier keys', () => {
    it('blocks shortcuts when ctrlKey is pressed', () => {
      const event = createMockKeyboardEvent({ ctrlKey: true });
      expect(shouldBlockShortcut(event)).toBe(true);
    });

    it('blocks shortcuts when altKey is pressed', () => {
      const event = createMockKeyboardEvent({ altKey: true });
      expect(shouldBlockShortcut(event)).toBe(true);
    });

    it('blocks shortcuts when metaKey is pressed', () => {
      const event = createMockKeyboardEvent({ metaKey: true });
      expect(shouldBlockShortcut(event)).toBe(true);
    });

    it('blocks shortcuts when multiple modifier keys are pressed', () => {
      const event = createMockKeyboardEvent({ ctrlKey: true, altKey: true });
      expect(shouldBlockShortcut(event)).toBe(true);
    });
  });

  describe('returns false for regular elements without modifiers', () => {
    it('allows shortcuts for regular DIV target', () => {
      const event = createMockKeyboardEvent({ targetTagName: 'DIV' });
      expect(shouldBlockShortcut(event)).toBe(false);
    });

    it('allows shortcuts for TABLE target', () => {
      const event = createMockKeyboardEvent({ targetTagName: 'TABLE' });
      expect(shouldBlockShortcut(event)).toBe(false);
    });

    it('allows shortcuts for BUTTON target', () => {
      const event = createMockKeyboardEvent({ targetTagName: 'BUTTON' });
      expect(shouldBlockShortcut(event)).toBe(false);
    });

    it('allows shortcuts for BODY target', () => {
      const event = createMockKeyboardEvent({ targetTagName: 'BODY' });
      expect(shouldBlockShortcut(event)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles null target gracefully', () => {
      const event = {
        target: null,
        isComposing: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      } as unknown as KeyboardEvent;
      expect(shouldBlockShortcut(event)).toBe(false);
    });
  });
});

describe('FORM_ELEMENTS', () => {
  it('contains INPUT, TEXTAREA, and SELECT', () => {
    expect(FORM_ELEMENTS).toContain('INPUT');
    expect(FORM_ELEMENTS).toContain('TEXTAREA');
    expect(FORM_ELEMENTS).toContain('SELECT');
  });

  it('has exactly 3 elements', () => {
    expect(FORM_ELEMENTS).toHaveLength(3);
  });
});

describe('SHORTCUTS', () => {
  it('is an array', () => {
    expect(Array.isArray(SHORTCUTS)).toBe(true);
  });

  it('contains navigation shortcuts (j, k, Enter)', () => {
    const keys = SHORTCUTS.map((s) => s.key);
    expect(keys).toContain('j');
    expect(keys).toContain('k');
    expect(keys).toContain('Enter');
  });

  it('contains search shortcuts (/, Esc)', () => {
    const keys = SHORTCUTS.map((s) => s.key);
    expect(keys).toContain('/');
    expect(keys).toContain('Esc');
  });

  it('contains other shortcuts (l, ?)', () => {
    const keys = SHORTCUTS.map((s) => s.key);
    expect(keys).toContain('l');
    expect(keys).toContain('?');
  });

  it('all shortcuts have required properties', () => {
    for (const shortcut of SHORTCUTS) {
      expect(shortcut).toHaveProperty('key');
      expect(shortcut).toHaveProperty('description');
      expect(shortcut).toHaveProperty('group');
      expect(typeof shortcut.key).toBe('string');
      expect(typeof shortcut.description).toBe('string');
      expect(['navigation', 'search', 'other']).toContain(shortcut.group);
    }
  });

  it('has shortcuts in expected groups', () => {
    const navigationShortcuts = SHORTCUTS.filter((s) => s.group === 'navigation');
    const searchShortcuts = SHORTCUTS.filter((s) => s.group === 'search');
    const otherShortcuts = SHORTCUTS.filter((s) => s.group === 'other');

    expect(navigationShortcuts.length).toBeGreaterThan(0);
    expect(searchShortcuts.length).toBeGreaterThan(0);
    expect(otherShortcuts.length).toBeGreaterThan(0);
  });
});
