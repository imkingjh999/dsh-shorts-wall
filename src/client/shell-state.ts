/**
 * Persisted state for the floating-window shell.
 */
const SHELL_LS = "dsh-shorts-wall:shell";

export interface ShellState {
  mode: "float" | "stick" | "closed";
  /** Mode to return to when the boss key/launcher restores a minimized shell. */
  restoreMode: Exclude<ShellState["mode"], "closed">;
  /** Whether a restored stick shell should open its overlay or stay as the rail. */
  restoreStuckOpen: boolean;
  x: number;
  y: number;
  /** Shell size shared by floating and docked modes. */
  sizeW: number;
  sizeH: number;
  /** Docked overlay top position; null centers it vertically. */
  stickY: number | null;
}

export const SHELL_DEFAULT: ShellState = {
  mode: "stick",
  restoreMode: "stick",
  restoreStuckOpen: true,
  x: 0,
  y: 0,
  sizeW: 420,
  sizeH: 760,
  stickY: null,
};

export const MIN_SHELL_W = 300;
export const MIN_SHELL_H = 400;
export type ResizeCorner = "nw" | "ne" | "sw" | "se";

export interface ResizeStart {
  corner: ResizeCorner;
  pointerX: number;
  pointerY: number;
  width: number;
  height: number;
  x: number;
  y: number;
  isFloat: boolean;
}

export const RESIZE_CURSORS: Record<ResizeCorner, string> = {
  nw: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  se: "nwse-resize",
};

export function loadShell(): ShellState {
  try {
    const raw = localStorage.getItem(SHELL_LS);
    if (raw === null) return { ...SHELL_DEFAULT };
    const parsed = JSON.parse(raw) as Partial<ShellState>;
    const mode =
      parsed.mode === "stick" || parsed.mode === "closed" || parsed.mode === "float"
        ? parsed.mode
        : "stick";
    const savedRestore =
      parsed.restoreMode === "stick" || parsed.restoreMode === "float"
        ? parsed.restoreMode
        : "stick";
    return {
      mode,
      restoreMode: mode === "closed" ? savedRestore : mode,
      restoreStuckOpen:
        typeof parsed.restoreStuckOpen === "boolean" ? parsed.restoreStuckOpen : true,
      x: typeof parsed.x === "number" ? parsed.x : 0,
      y: typeof parsed.y === "number" ? parsed.y : 0,
      sizeW:
        typeof parsed.sizeW === "number" && parsed.sizeW >= MIN_SHELL_W
          ? parsed.sizeW
          : SHELL_DEFAULT.sizeW,
      sizeH:
        typeof parsed.sizeH === "number" && parsed.sizeH >= MIN_SHELL_H
          ? parsed.sizeH
          : SHELL_DEFAULT.sizeH,
      stickY: typeof parsed.stickY === "number" && parsed.stickY >= 0 ? parsed.stickY : null,
    };
  } catch {
    return { ...SHELL_DEFAULT };
  }
}

export function saveShell(st: ShellState): void {
  try {
    localStorage.setItem(SHELL_LS, JSON.stringify(st));
  } catch {
    /* optional */
  }
}
