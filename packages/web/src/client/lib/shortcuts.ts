import { formatForDisplay } from '@tanstack/react-hotkeys';

export type ShortcutHint = {
  id: string;
  label: string;
  /** Hotkey string for formatForDisplay, or a literal key label when null. */
  hotkey: string | null;
  /** Used when hotkey is null (e.g. Escape, `/`). */
  keys?: string[];
  scope: 'common' | 'ee';
};

export const APP_SHORTCUTS: ShortcutHint[] = [
  { id: 'search', label: 'Search Plans', hotkey: null, keys: ['/'], scope: 'common' },
  { id: 'sidebar', label: 'Toggle Sidebar', hotkey: 'Mod+B', scope: 'common' },
  { id: 'outline', label: 'Toggle Outline', hotkey: 'Mod+Shift+O', scope: 'common' },
  { id: 'palette', label: 'Command Palette', hotkey: 'Mod+K', scope: 'ee' },
  { id: 'chart', label: 'Toggle Tech Chart', hotkey: 'Mod+Shift+G', scope: 'ee' },
  { id: 'comment', label: 'Submit Comment', hotkey: 'Mod+Enter', scope: 'ee' },
  { id: 'escape', label: 'Close / Cancel', hotkey: null, keys: ['Esc'], scope: 'common' },
];

export function getAppShortcuts(options?: { ee?: boolean }): ShortcutHint[] {
  const includeEe = options?.ee ?? false;
  return APP_SHORTCUTS.filter((shortcut) => includeEe || shortcut.scope === 'common');
}

/** Platform-aware key tokens for a shortcut (e.g. ["Ctrl", "B"] or ["⌘", "B"]). */
export function shortcutDisplayKeys(shortcut: ShortcutHint): string[] {
  if (shortcut.hotkey) {
    const formatted = formatForDisplay(shortcut.hotkey);
    // formatForDisplay may return "Ctrl+B" or "⌘B" depending on platform/version
    if (formatted.includes('+')) {
      return formatted.split('+').filter(Boolean);
    }
    // Mac-style glyphs are often concatenated without separators
    const macParts = formatted.match(/⌘|⇧|⌥|⌃|↵|Esc|Del|Tab|⏎|[A-Za-z0-9/]+/g);
    if (macParts && macParts.length > 1) return macParts;
    return [formatted];
  }
  return shortcut.keys ?? [];
}
