/**
 * Playback cards: the YouTube iframe card and the Bilibili native-video card.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { BiliShort } from "../bilibili-shorts.ts";
import type { YtVideo } from "../youtube.ts";
import { useCoverLift, useNineBySixteen, useTitleAutoHide } from "./card-timers.ts";
import { useYtEmbedEvents } from "./embed-events.ts";
import { fetchBiliPlay } from "./feed-state.ts";
import { useT } from "./i18n.ts";
import { ACCENT, PlayGlyph, proxyUrl, TitleBar, WheelVeil } from "./common.tsx";

/** One full-height 9:16 shorts card: plain iframe + event hook wiring. */
export function ShortsCard(props: {
  video: YtVideo;
  visible: boolean;
  muted: boolean;
  onEnded: () => void;
  autoSkipRef: { current: number };
  onAliveChange: (alive: boolean) => void;
  onOutcome: (ok: boolean) => void;
}): ReactNode {
  const { video } = props;
  const t = useT();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hovered, setHovered] = useState(false);

  const videoKey = `${video.videoId}:${attempt}`;

  // Error classification: deterministic per-video codes and mid-play errors
  // auto-advance (budgeted); load-phase failures keep the retry overlay.
  // The classification needs events.started, so the advance/fail plumbing
  // below reads it through a ref bridged out of the hook.
  const startedRef = useRef(false);
  const advanceRef = useRef((): void => undefined);
  const handleError = useCallback(
    (code: number): void => {
      props.onOutcome(false);
      const perVideo = code === 2 || code === 5 || code === 100 || code === 101 || code === 150;
      if ((perVideo || startedRef.current) && props.autoSkipRef.current < 3) {
        props.autoSkipRef.current += 1;
        advanceRef.current();
        return;
      }
      setFailed(true);
    },
    [props.autoSkipRef, props.onOutcome],
  );

  const events = useYtEmbedEvents(iframeRef, videoKey, {
    onEnded: props.onEnded,
    onError: handleError,
    onAliveChange: props.onAliveChange,
  });
  startedRef.current = events.started;
  advanceRef.current = events.advance;
  // Report playback outcome for YT-down detection (playing = alive).
  useEffect(() => {
    if (events.playing) props.onOutcome(true);
  }, [events.playing]);

  const box = useNineBySixteen(cardRef);
  const coverLifted = useCoverLift(videoKey, events.playing);
  const titleVisible = useTitleAutoHide(videoKey);

  // Keep the embed's mute in sync (re-fired when the iframe swaps).
  useEffect(() => {
    events.setMuted(props.muted);
  }, [props.muted, box, attempt, events]);

  return (
    <div
      ref={cardRef}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
      style={{ position: "absolute", inset: 0, overflow: "hidden" }}
    >
      {/* Vertical thumbnail underlay (until the player covers it) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <img
          src={proxyUrl(video.thumbUrl)}
          alt=""
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
          style={{
            height: "100%",
            maxWidth: "100%",
            objectFit: "cover",
            opacity: failed ? 0.25 : 1,
          }}
        />
      </div>

      {/* The 9:16 player box, centered — the iframe fills it exactly. */}
      {box !== null && !failed && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: box.w,
            height: box.h,
            transform: "translate(-50%, -50%)",
          }}
        >
          {!coverLifted && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 2,
                background: "#000",
                pointerEvents: "none",
              }}
            >
              <img
                src={proxyUrl(video.thumbUrl)}
                alt=""
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </div>
          )}
          <iframe
            key={videoKey}
            ref={iframeRef}
            src={`https://www.youtube.com/embed/${video.videoId}?autoplay=1&mute=${props.muted ? 1 : 0}&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`}
            title={video.title}
            allow="autoplay; encrypted-media; picture-in-picture"
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              display: "block",
            }}
          />
          <WheelVeil
            onLift={() => {
              window.setTimeout(() => {
                setHovered(false);
              }, 6000);
            }}
            onCover={() => {
              // Returning the veil must also return keyboard focus to the
              // host page: while the cross-origin YouTube iframe owns focus,
              // parent-window key handlers (including Alt+S) never fire.
              iframeRef.current?.blur();
              window.focus();
            }}
          />
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
          <span>{t("card.failed.yt")}</span>
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              setAttempt((a) => a + 1);
            }}
            style={{
              background: ACCENT,
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

      {/* Title bar: auto-hides 2s after mount; hover re-shows. The veil's
          lift-gesture also re-shows it (player control = want context). */}
      {(hovered || titleVisible) && (
        <div
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
            {video.title}
          </div>
          <div style={{ fontSize: 10, color: "#999", marginTop: 3 }}>
            {video.authorName} · YouTube Shorts
          </div>
        </div>
      )}
    </div>
  );
}
