/**
 * Shared presentation primitives and constants for the shorts wall client.
 */
import { useEffect, useState } from "react";
import type {
  CSSProperties,
  ReactNode,
  SyntheticEvent,
  WheelEvent,
} from "react";

export const ACCENT = "#ff2d55";
export const WHEEL_COOLDOWN_MS = 380;
export const MUTE_KEY = "dsh-bilibili-sidebar:muted";
export const BUILD_TAG = "v1.0.3";

/** Wrap an upstream URL through the host media proxy. */
export function proxyUrl(upstream: string): string {
  return `/bilibili/proxy?u=${encodeURIComponent(upstream)}`;
}

/**
 * Cover image: the host media proxy first, then the direct upstream URL as a
 * one-shot fallback — the browser's own network (system proxy on the desktop
 * side) may egress where the WSL/host tunnel cannot. Hides itself only when
 * both paths fail.
 */
export function ThumbImg(props: { src: string; style?: CSSProperties }): ReactNode {
  const [direct, setDirect] = useState(false);
  return (
    <img
      src={direct ? props.src : proxyUrl(props.src)}
      alt=""
      onError={(e: SyntheticEvent<HTMLImageElement>) => {
        if (!direct && props.src.startsWith("https://")) {
          setDirect(true);
          return;
        }
        e.currentTarget.style.display = "none";
      }}
      style={props.style}
    />
  );
}
/** Play glyph for the tab icon and loading states. */
export function PlayGlyph({ size }: { size: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8 5.2v13.6a.8.8 0 0 0 1.23.67l9.2-6.8a.8.8 0 0 0 0-1.34l-9.2-6.8A.8.8 0 0 0 8 5.2z"
        fill={ACCENT}
      />
    </svg>
  );
}
/** Transparent veil over the iframe: wheel-catcher + click-to-reveal. */
export function WheelVeil(props: {
  onLift: () => void;
  onCover?: () => void;
}): ReactNode {
  const [lifted, setLifted] = useState(false);
  return (
    <div
      onWheel={(e: WheelEvent<HTMLDivElement>) => {
        e.preventDefault();
      }}
      onClick={() => {
        setLifted(true);
        props.onLift();
        window.setTimeout(() => {
          setLifted(false);
          props.onCover?.();
        }, 6000);
      }}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 4,
        background: lifted ? "transparent" : "rgba(0,0,0,0.001)",
        cursor: "pointer",
        pointerEvents: lifted ? "none" : "auto",
      }}
    />
  );
}
/** Shared bottom title bar (auto-hides once playing; hover re-shows). */
export function TitleBar(props: {
  title: string;
  author: string;
  playing: boolean;
  extra?: string;
}): ReactNode {
  const [visible, setVisible] = useState(true);
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (!props.playing) {
      setVisible(true);
      return;
    }
    const t = window.setTimeout(() => {
      setVisible(false);
    }, 1500);
    return () => {
      window.clearTimeout(t);
    };
  }, [props.playing]);
  return (
    <div
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        padding: "36px 12px 12px",
        background: "linear-gradient(transparent, rgba(0,0,0,.78))",
        pointerEvents: "none",
      }}
    >
      {(hovered || visible) && (
        <>
          <div
            style={{
              fontSize: 12,
              color: "#eee",
              lineHeight: 1.5,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {props.title}
          </div>
          <div style={{ fontSize: 10, color: "#999", marginTop: 3 }}>
            {props.author}
            {props.extra !== undefined && props.extra !== "" ? ` · ${props.extra}` : ""}
          </div>
        </>
      )}
    </div>
  );
}


export function FeedLoading({ label }: { label: string }): ReactNode {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        color: "#888",
        fontSize: 12,
      }}
    >
      <PlayGlyph size={22} /> {label}
    </div>
  );
}

export function FeedEmpty(props: {
  label: string;
  retryLabel: string;
  onRetry: () => void;
}): ReactNode {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        color: "#888",
        fontSize: 12,
      }}
    >
      <span>{props.label}</span>
      <button
        type="button"
        onClick={props.onRetry}
        style={{
          background: "none",
          border: `1px solid ${ACCENT}`,
          color: ACCENT,
          borderRadius: 10,
          fontSize: 12,
          padding: "6px 18px",
          cursor: "pointer",
        }}
      >
        {props.retryLabel}
      </button>
    </div>
  );
}
