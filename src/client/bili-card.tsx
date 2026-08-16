/**
 * Native-video playback card for Bilibili shorts.
 */
import { useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode, SyntheticEvent } from "react";
import type { BiliShort } from "../bilibili-shorts.ts";
import { useNineBySixteen } from "./card-timers.ts";
import { fetchBiliPlay } from "./feed-state.ts";
import { useT } from "./i18n.ts";
import { PlayGlyph, proxyUrl, TitleBar } from "./common.tsx";

/** One full-height 9:16 bilibili shorts card: NATIVE <video> playback —
 *  mp4 through the host proxy, real ended/error events (no iframe, no
 *  postMessage, no watchdog). Streams resolve lazily when the card mounts,
 *  with candidate fallthrough on playback errors. */
export function BiliCard(props: {
  short: BiliShort;
  visible: boolean;
  muted: boolean;
  onEnded: () => void;
  autoSkipRef: { current: number };
}): ReactNode {
  const { short } = props;
  const t = useT();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const box = useNineBySixteen(cardRef);
  const [urls, setUrls] = useState<string[] | undefined>(undefined);
  const [candidate, setCandidate] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const startedRef = useRef(false);

  // Lazy stream resolution (idempotent via attempt key).
  const playKey = `${short.bvid}:${attempt}`;
  useEffect(() => {
    let disposed = false;
    setUrls(undefined);
    setCandidate(0);
    setFailed(false);
    setPlaying(false);
    startedRef.current = false;
    void fetchBiliPlay(short.bvid, short.cid)
      .then((u) => {
        if (!disposed) setUrls(u);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
    };
  }, [playKey, short.bvid, short.cid]);

  // Playback conductor: exactly this card plays while visible.
  useEffect(() => {
    const v = videoRef.current;
    if (v === null) return;
    if (props.visible) {
      v.muted = props.muted;
      try {
        void Promise.resolve(v.play()).catch(() => undefined);
      } catch {
        /* autoplay refused */
      }
    } else {
      v.pause();
    }
  }, [urls, candidate, props.visible, props.muted]);

  const exhausted = urls !== undefined && candidate >= urls.length;
  const src =
    !exhausted && urls !== undefined ? proxyUrl(urls[candidate] ?? urls[0] ?? "") : undefined;

  const durationLabel =
    short.durationSec > 0
      ? `${Math.floor(short.durationSec / 60)}:${String(short.durationSec % 60).padStart(2, "0")}`
      : "";

  return (
    <div ref={cardRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {/* Cover underlay until the stream is ready; REMOVED once ready (an
          opacity-0 overlay would still swallow the video's pause clicks). */}
      {short.coverUrl !== "" && src === undefined && (
        <img
          src={proxyUrl(short.coverUrl.replace(/^http:/, "https:"))}
          alt=""
          onError={(e: SyntheticEvent<HTMLImageElement>) => {
            e.currentTarget.style.display = "none";
          }}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}
      {src !== undefined && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#000",
          }}
        >
          <video
            ref={videoRef}
            src={src}
            playsInline
            style={{
              ...(box !== null
                ? { width: box.w, height: box.h }
                : { width: "100%", height: "100%" }),
              objectFit: "contain",
              background: "#000",
              display: "block",
              maxWidth: "100%",
              maxHeight: "100%",
            }}
            onClick={(e: MouseEvent<HTMLVideoElement>) => {
              const el = e.currentTarget;
              if (el.paused) {
                try {
                  void Promise.resolve(el.play()).catch(() => undefined);
                } catch {
                  /* refused */
                }
              } else el.pause();
            }}
            onPlay={() => {
              startedRef.current = true;
              setPlaying(true);
            }}
            onPause={() => {
              setPlaying(false);
            }}
            onEnded={props.onEnded}
            onError={() => {
              // Candidate fallthrough; deterministic exhaustion keeps the
              // retry overlay (auto-advance only for mid-play failures).
              if (candidate + 1 < (urls?.length ?? 0)) setCandidate(candidate + 1);
              else if (startedRef.current && props.autoSkipRef.current < 3) {
                props.autoSkipRef.current += 1;
                props.onEnded();
              } else setFailed(true);
            }}
          />
        </div>
      )}
      {urls === undefined && !failed && (
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
          <PlayGlyph size={20} /> 取流中…
        </div>
      )}
      {failed && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            color: "#bbb",
            fontSize: 12,
          }}
        >
          <span>{t("card.failed.bili")}</span>
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              setAttempt((a) => a + 1);
            }}
            style={{
              background: "#00a1d6",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "6px 18px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            重试
          </button>
        </div>
      )}
      {!playing && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 60,
            background: "linear-gradient(transparent, rgba(0,0,0,.6))",
            pointerEvents: "none",
          }}
        />
      )}
      {/* Title bar: shows until playback starts, then fades (hover re-shows). */}
      <TitleBar
        title={short.title}
        author={`${short.authorName} · B站竖屏`}
        playing={playing}
        extra={durationLabel}
      />
    </div>
  );
}
