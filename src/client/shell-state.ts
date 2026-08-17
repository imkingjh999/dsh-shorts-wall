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
  /** Viewport position shared by floating and docked modes. */
  x: number;
  y: number;
  /** Shell size shared by floating and docked modes. */
  sizeW: number;
  sizeH: number;
}

const DEFAULT_W = 420;
const DEFAULT_H = 760;

function viewportSize(): { width: number; height: number } {
  return {
    width: typeof window === "undefined" ? 1280 : window.innerWidth,
    height: typeof window === "undefined" ? 800 : window.innerHeight,
  };
}

/** A docked-first default: near the right edge, vertically centered. */
export function defaultShell(): ShellState {
  const { width, height } = viewportSize();
  return {
    mode: "stick",
    restoreMode: "stick",
    restoreStuckOpen: true,
    x: Math.max(12, Math.round(width - DEFAULT_W - 12)),
    y: Math.max(12, Math.round((height - DEFAULT_H) / 2)),
    sizeW: DEFAULT_W,
    sizeH: DEFAULT_H,
  };
}

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
    if (raw === null) return defaultShell();

    const parsed = JSON.parse(raw) as Partial<ShellState> & { stickY?: unknown };
    const mode =
      parsed.mode === "stick" || parsed.mode === "closed" || parsed.mode === "float"
        ? parsed.mode
        : "stick";
    const savedRestore =
      parsed.restoreMode === "stick" || parsed.restoreMode === "float"
        ? parsed.restoreMode
        : "stick";
    const sizeW =
      typeof parsed.sizeW === "number" && parsed.sizeW >= MIN_SHELL_W
        ? parsed.sizeW
        : DEFAULT_W;
    const sizeH =
      typeof parsed.sizeH === "number" && parsed.sizeH >= MIN_SHELL_H
        ? parsed.sizeH
        : DEFAULT_H;
    const { width, height } = viewportSize();
    const legacyDefaultPosition = parsed.x === 0 && parsed.y === 0;
    const legacyStickTop = typeof parsed.stickY === "number" && parsed.stickY >= 0
      ? parsed.stickY
      : null;
    // v1.0.3 and earlier stored (0, 0) as "use the mode preset". Translate
    // that once into the preset's real viewport coordinates so upgrading does
    // not move a window before the first toggle.
    const layoutMode = mode === "closed" ? savedRestore : mode;
    const legacyX = layoutMode === "float"
      ? Math.max(12, Math.round(width - sizeW - 24))
      : Math.max(12, Math.round(width - sizeW - 12));
    const legacyFloatTop = Math.min(
      72,
      Math.max(0, height - sizeH),
    );

    return {
      mode,
      restoreMode: mode === "closed" ? savedRestore : mode,
      restoreStuckOpen:
        typeof parsed.restoreStuckOpen === "boolean" ? parsed.restoreStuckOpen : true,
      x: typeof parsed.x === "number" && !legacyDefaultPosition
        ? parsed.x
        : legacyX,
      y: typeof parsed.y === "number" && !legacyDefaultPosition
        ? parsed.y
        : layoutMode === "float"
          ? legacyFloatTop
          : legacyStickTop ?? Math.max(12, Math.round((height - sizeH) / 2)),
      sizeW,
      sizeH,
    };
  } catch {
    return defaultShell();
  }
}

export function saveShell(st: ShellState): void {
  try {
    localStorage.setItem(SHELL_LS, JSON.stringify(st));
  } catch {
    /* optional */
  }
}
