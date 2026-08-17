/**
 * Persistent floating-window shell. One React subtree is re-styled across
 * float/stick/closed modes so playback never remounts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { ACCENT, PlayGlyph } from "./common.tsx";
import { ShortsFeed } from "./feed-view.tsx";
import { isBossKey } from "./hotkeys.ts";
import {
  loadShell,
  MIN_SHELL_H,
  MIN_SHELL_W,
  RESIZE_CURSORS,
  saveShell,
  type ResizeCorner,
  type ResizeStart,
  type ShellState,
} from "./shell-state.ts";
import { useT } from "./i18n.ts";

export function FloatingShell(): ReactNode {
  const t = useT();
  const [shell, setShell] = useState<ShellState>(loadShell);
  const [stuckOpen, setStuckOpen] = useState(true);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = useRef<ResizeStart | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const minimized = shell.mode === "closed";
  const stick = shell.mode === "stick";
  const float = shell.mode === "float";

  const update = useCallback((patch: Partial<ShellState>): void => {
    setShell((prev) => {
      const next = { ...prev, ...patch };
      saveShell(next);
      return next;
    });
  }, []);

  /** Remember the live layout, then hide the shell. */
  const minimize = useCallback((): void => {
    const wasStick = shell.mode === "stick";
    update({
      mode: "closed",
      restoreMode: wasStick ? "stick" : "float",
      restoreStuckOpen: wasStick ? stuckOpen : true,
    });
    if (wasStick) setStuckOpen(false);
  }, [shell.mode, stuckOpen, update]);

  /** Restore the layout that was live before minimization (float or stick). */
  const restore = useCallback((): void => {
    update({ mode: shell.restoreMode });
    setStuckOpen(shell.restoreMode === "stick" && shell.restoreStuckOpen);
  }, [shell.restoreMode, shell.restoreStuckOpen, update]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isBossKey(e)) {
        e.preventDefault();
        if (minimized) restore();
        else minimize();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [minimized, minimize, restore]);

  const onMove = (e: MouseEvent): void => {
    const drag = dragRef.current;
    if (drag !== null) {
      const maxX = window.innerWidth - 120;
      const maxY = window.innerHeight - 60;
      update({
        x: Math.min(Math.max(e.clientX - drag.dx, 0), maxX),
        y: Math.min(Math.max(e.clientY - drag.dy, 0), maxY),
      });
      if (e.clientX > window.innerWidth - 24) {
        dragRef.current = null;
        update({ mode: "stick" });
        setStuckOpen(true);
      }
      return;
    }

    const resize = resizeRef.current;
    if (resize === null) return;

    const maxWidth = Math.max(MIN_SHELL_W, window.innerWidth - 24);
    const maxHeight = Math.max(MIN_SHELL_H, window.innerHeight - 24);
    const dx = e.clientX - resize.pointerX;
    const dy = e.clientY - resize.pointerY;
    const growsLeft = resize.corner === "nw" || resize.corner === "sw";
    const growsUp = resize.corner === "nw" || resize.corner === "ne";
    const width = Math.min(
      maxWidth,
      Math.max(MIN_SHELL_W, resize.width + (growsLeft ? -dx : dx)),
    );
    const height = Math.min(
      maxHeight,
      Math.max(MIN_SHELL_H, resize.height + (growsUp ? -dy : dy)),
    );

    // Both modes share one viewport rectangle: resizing anchors the opposite
    // corner/edge exactly as a floating window does, so toggling the mode
    // never repositions the panel.
    const right = resize.x + resize.width;
    const bottom = resize.y + resize.height;
    const x = growsLeft ? right - width : resize.x;
    const y = growsUp ? bottom - height : resize.y;
    update({
      sizeW: width,
      sizeH: height,
      x: Math.min(Math.max(x, 0), Math.max(0, window.innerWidth - width)),
      y: Math.min(Math.max(y, 0), Math.max(0, window.innerHeight - height)),
    });
  };

  const onUp = (): void => {
    dragRef.current = null;
    resizeRef.current = null;
  };

  useEffect(() => {
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // Handlers read mutable refs; update is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update]);

  const startResizeEvent = useCallback(
    (e: ReactMouseEvent, corner: ResizeCorner): void => {
      e.preventDefault();
      e.stopPropagation();
      const el = shellRef.current;
      if (el === null) return;
      resizeRef.current = {
        corner,
        pointerX: e.clientX,
        pointerY: e.clientY,
        width: el.offsetWidth,
        height: el.offsetHeight,
      x: el.offsetLeft,
      y: el.offsetTop,
    };
  }, []);

  const panelW = Math.max(MIN_SHELL_W, Math.min(shell.sizeW, window.innerWidth - 24));
  const panelH = Math.max(MIN_SHELL_H, Math.min(shell.sizeH, window.innerHeight - 24));
  const safeLeft = Math.min(
    Math.max(shell.x, 0),
    Math.max(0, window.innerWidth - panelW),
  );
  const safeTop = Math.min(
    Math.max(shell.y, 0),
    Math.max(0, window.innerHeight - panelH),
  );
  const panelStyle: CSSProperties = minimized
    ? {
        position: "fixed",
        right: -9999,
        bottom: -9999,
        visibility: "hidden",
        pointerEvents: "none",
      }
    : {
        position: "fixed",
        left: safeLeft,
        top: safeTop,
        width: panelW,
        height: panelH,
        zIndex: 2147483000,
        background: "#000",
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 24px 80px rgba(0,0,0,.8)",
        display: "flex",
        flexDirection: "column",
        ...(stick
          ? {
              visibility: stuckOpen ? "visible" : "hidden",
              pointerEvents: stuckOpen ? "auto" : "none",
            }
          : {}),
      };
  const feedNode = (
    <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
      <ShortsFeed visible={!minimized} />
    </div>
  );

  return (
    <>
      {minimized && (
        <button
          type="button"
          title={`${t("shell.open")} (Alt+S)`}
          onClick={restore}
          style={{
            position: "fixed",
            right: 18,
            bottom: 18,
            zIndex: 2147483000,
            width: 44,
            height: 44,
            borderRadius: 999,
            background: ACCENT,
            color: "#fff",
            border: "none",
            cursor: "pointer",
            boxShadow: "0 8px 30px rgba(0,0,0,.5)",
          }}
        >
          <PlayGlyph size={20} />
        </button>
      )}
      {stick && !stuckOpen && (
        <button
          type="button"
          title={`${t("shell.expand")} (Alt+S 最小化)`}
          onClick={() => {
            setStuckOpen(true);
          }}
          style={{
            position: "fixed",
            right: 0,
            top: "40%",
            zIndex: 2147483000,
            writingMode: "vertical-rl",
            padding: "14px 8px",
            background: ACCENT,
            color: "#fff",
            border: "none",
            borderRadius: "10px 0 0 10px",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 2,
          }}
        >
          Shorts
        </button>
      )}
      <div ref={shellRef} data-shell-panel="" style={panelStyle}>
        <div
          onMouseDown={
            float
              ? (e: ReactMouseEvent<HTMLDivElement>) => {
                  if ((e.target as HTMLElement).closest("button") !== null) return;
                  dragRef.current = {
                    dx: e.clientX - (shellRef.current?.offsetLeft ?? 0),
                    dy: e.clientY - (shellRef.current?.offsetTop ?? 0),
                  };
                }
              : undefined
          }
          onDoubleClick={
            float
              ? () => {
                  update({ mode: "stick" });
                  setStuckOpen(true);
                }
              : undefined
          }
          style={{ cursor: float ? "grab" : "default", userSelect: "none" }}
        >
          <ShellBar
            t={t}
            floating={float}
            onFloatingChange={(next) => {
              // Float and dock are behavior modes, not layout presets: keep
              // the shared viewport position and size exactly where they are.
              update({ mode: next ? "float" : "stick" });
              setStuckOpen(true);
            }}
          />
        </div>
        {feedNode}
        {!minimized && (
          <button
            type="button"
            title={t("shell.minimize")}
            data-shell-minimize=""
            onClick={minimize}
            style={{
              position: "absolute",
              right: 12,
              bottom: 34,
              zIndex: 30,
              background: "rgba(20, 20, 24, 0.86)",
              color: "#ddd",
              border: "1px solid #333",
              borderRadius: 999,
              fontSize: 10,
              lineHeight: 1,
              padding: "5px 10px",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {t("shell.minimizeText")}
          </button>
        )}
        {!minimized &&
          (["nw", "ne", "sw", "se"] as const).map((corner) => (
            <div
              key={corner}
              data-resize-corner={corner}
              aria-hidden="true"
              onMouseDown={(e: ReactMouseEvent<HTMLDivElement>) => {
                startResizeEvent(e, corner);
              }}
              style={{
                position: "absolute",
                top: corner.startsWith("n") ? 0 : undefined,
                bottom: corner.startsWith("s") ? 0 : undefined,
                left: corner.endsWith("w") ? 0 : undefined,
                right: corner.endsWith("e") ? 0 : undefined,
                width: 24,
                height: 24,
                zIndex: 20,
                cursor: RESIZE_CURSORS[corner],
                touchAction: "none",
                background: "transparent",
              }}
            />
          ))}
      </div>
    </>
  );
}

function ShellBar(props: {
  t: (k: string) => string;
  floating: boolean;
  onFloatingChange: (next: boolean) => void;
}): ReactNode {
  const { t } = props;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "6px 10px",
        background: "#14141a",
        borderBottom: "1px solid #222",
        cursor: "inherit",
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, color: ACCENT }}>Shorts</span>
      <span style={{ fontSize: 10, color: "#aaa", whiteSpace: "nowrap" }}>
        {t("shell.floatText")}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={props.floating}
        data-shell-mode-toggle=""
        title={t("shell.modeToggleTip")}
        onClick={() => {
          props.onFloatingChange(!props.floating);
        }}
        style={{
          position: "relative",
          width: 32,
          height: 18,
          flex: "0 0 auto",
          background: props.floating ? ACCENT : "#2c2c34",
          border: "1px solid " + (props.floating ? ACCENT : "#3c3c44"),
          borderRadius: 999,
          cursor: "pointer",
          padding: 0,
          transition: "background 120ms ease, border-color 120ms ease",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 2,
            left: props.floating ? 16 : 2,
            width: 12,
            height: 12,
            borderRadius: 999,
            background: "#fff",
            boxShadow: "0 1px 3px rgba(0,0,0,.45)",
            transition: "left 120ms ease",
          }}
        />
      </button>
      <span
        title={t("shell.bossKeyTip")}
        style={{
          flex: 1,
          fontSize: 10,
          color: "#777",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          textAlign: "right",
        }}
      >
        {t("shell.bossKey")}
      </span>
    </div>
  );
}
