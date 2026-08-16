/**
 * Global keyboard shortcuts. Match physical keys so non-English keyboard
 * layouts still trigger the same Alt-combos.
 */
interface HotkeyEvent {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  key: string;
  code: string;
}

function isAltCombo(e: HotkeyEvent, code: string, key: string): boolean {
  const expected = key.toLowerCase();
  return (
    e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    (e.code === code || e.key.toLowerCase() === expected)
  );
}

/** Boss key: Alt/Option + S. */
export function isBossKey(e: HotkeyEvent): boolean {
  return isAltCombo(e, "KeyS", "s");
}

/** Mute toggle: Alt/Option + M. */
export function isMuteKey(e: HotkeyEvent): boolean {
  return isAltCombo(e, "KeyM", "m");
}
