// Platform differences (Windows vs macOS) for labels shown in the UI.
export const IS_MAC = /Mac/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent);
// "Ctrl+Shift+E" → "⇧⌘E" on macOS
export function keyLabel(k) {
  if (!IS_MAC || !k) return k;
  return k.replace(/Ctrl\+Alt\+/g, '⌥⌘').replace(/Ctrl\+Shift\+/g, '⇧⌘').replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧')
    .replace(/\bCtrl\b/g, '⌘').replace(/\bAlt\b/g, '⌥').replace(/\bDel\b/, '⌫').replace(/\bDelete\b/, '⌫');
}
export const REVEAL_LABEL = IS_MAC ? 'Show in Finder' : 'Show in Explorer';
