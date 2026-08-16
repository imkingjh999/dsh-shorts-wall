/**
 * Player-event plumbing for the plain-iframe YouTube Shorts player.
 *
 * Everything that talks to the embed lives here: the retried "listening"
 * handshake, the state/time poll loop, playback-event distribution
 * (play/pause/end/error), the playback watchdog (advance when no life
 * evidence arrives — dead-channel environments never send events), and the
 * mute command. Extracted from ShortsCard so the card stays a thin render.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const YT_ORIGIN = "https://www.youtube.com";
/** No life evidence within this window (once armed) → dead → advance. */
const WATCHDOG_MS = 4000;
const WATCHDOG_CHECK_MS = 1500;
/** Boot grace: iframe load + handshake time before "never started" counts. */
const BOOT_GRACE_MS = 12_000;

export interface EmbedEvents {
  /** PLAYING seen at least once (load-phase failures vs mid-play). */
  readonly started: boolean;
  /** Playback is live right now (drives the cover). */
  readonly playing: boolean;
  /** Advance to the next short (end / loop-completion / watchdog). */
  readonly advance: () => void;
  /** A player error arrived (classification handled by the caller). */
  readonly fail: (code: number) => void;
  /** The postMessage channel answered at least once. */
  readonly alive: boolean;
  /** Send a mute/unMute command to the live iframe. */
  readonly setMuted: (muted: boolean) => void;
}

/** One postMessage helper bound to an iframe ref. */
function posterOf(
  ref: React.RefObject<HTMLIFrameElement | null>,
): (obj: Record<string, unknown>) => void {
  return (obj) => {
    ref.current?.contentWindow?.postMessage(JSON.stringify(obj), YT_ORIGIN);
  };
}

/**
 * Wire player events for one embedded short.
 *
 * @param iframeRef - the live iframe (events route to whichever frame this
 *   points at, so the hook survives iframe swaps inside the same card).
 * @param videoKey - changes when the video (or retry attempt) changes; the
 *   whole event pipeline resets.
 * @param handlers - advance/fail callbacks (latest-callers win; the hook
 *   reads them through refs so identity churn never rebinds listeners).
 */
export function useYtEmbedEvents(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  videoKey: string,
  handlers: {
    onEnded: () => void;
    onError: (code: number) => void;
    onAliveChange?: (alive: boolean) => void;
  },
): EmbedEvents {
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [alive, setAlive] = useState(false);

  // Latest-callback refs: the card's handlers change identity across
  // renders; listeners must not rebind (and handshakes must not restart)
  // because of it.
  const endedRef = useRef(handlers.onEnded);
  endedRef.current = handlers.onEnded;
  const errorRef = useRef(handlers.onError);
  errorRef.current = handlers.onError;
  const aliveRef = useRef(handlers.onAliveChange);
  aliveRef.current = handlers.onAliveChange;

  /** One advance per window: concurrent end-signals (watchdog + a late end
   *  event for the same video) must not double-fire, and the guard re-arms
   *  so the NEXT video's signals flow normally. */
  const advancedUntilRef = useRef(0);
  const advance = useCallback((): void => {
    if (Date.now() < advancedUntilRef.current) return;
    advancedUntilRef.current = Date.now() + 800;
    endedRef.current();
  }, []);

  /** Last "the player is demonstrably alive" timestamp (watchdog feed). */
  const lastLifeRef = useRef(Date.now());

  useEffect(() => {
    // Reset per video/attempt.
    setStarted(false);
    setPlaying(false);
    setAlive(false);
    advancedUntilRef.current = 0;
    lastLifeRef.current = Date.now();

    const post = posterOf(iframeRef);
    const applyState = (state: number): void => {
      if (state === 0) {
        setPlaying(false);
        advance();
      } // ENDED
      if (state === 1) {
        // PLAYING
        setStarted(true);
        setPlaying(true);
        lastLifeRef.current = Date.now();
      }
      if (state === 2) setPlaying(false); // PAUSED
    };

    const onMessage = (e: MessageEvent): void => {
      if (e.origin !== YT_ORIGIN || typeof e.data !== "string") return;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(e.data) as Record<string, unknown>;
      } catch {
        return;
      }
      if (data["event"] === undefined) return;
      armed = true; // the channel just proved alive: mid-feed death detection ON
      if (!alive) setAlive(true);
      aliveRef.current?.(true);
      if (data["event"] === "onStateChange") applyState(Number(data["info"]));
      if (data["event"] === "onError") errorRef.current(Number(data["info"]));
      if (data["event"] === "infoDelivery") {
        const info = data["info"] as Record<string, unknown> | undefined;
        if (info === undefined) return;
        if (typeof info["playerState"] === "number") applyState(info["playerState"]);
        if (typeof info["currentTime"] === "number") {
          lastLifeRef.current = Date.now(); // any time report = player alive
        }
      }
    };
    window.addEventListener("message", onMessage);

    // Handshake for the card's whole life (cheap: 1 msg/s): a late embed
    // load or a channel that opens seconds in still gets events flowing.
    const shake = window.setInterval(() => {
      post({ event: "listening", id: 1, channel: "widget" });
    }, 1000);

    // Poll loop keeps end/loop detection alive without unsolicited events.
    const poll = window.setInterval(() => {
      post({ event: "command", func: "getPlayerState", args: [] });
      post({ event: "command", func: "getCurrentTime", args: [] });
    }, 900);

    // Watchdog: armed only after the channel proved alive at least once
    // (first PLAYING/time event). Rationale: embeds take 3–8s to boot
    // (iframe load + handshake) during which NO life evidence exists — an
    // unarmed-from-mount watchdog advanced through every video before the
    // first could even start (the runaway-auto-next bug). Once armed, no
    // life within the window = the video died mid-feed → advance (budget
    // untouched: channel-dead videos all look lifeless, error accounting
    // stalled the feed historically).
    let armed = false;
    const watchdog = window.setInterval(() => {
      if (!armed) {
        // Boot grace: iframe load + handshake can take seconds. The mount
        // timestamp itself counts as life until BOOT_GRACE elapses.
        if (Date.now() - lastLifeRef.current < BOOT_GRACE_MS) return;
        // Past grace with zero events ever: this video never started —
        // advance ONCE to try the next (autoplay may have been blocked),
        // but do not re-arm: if the next is equally silent, stop churning
        // (let the user click) rather than looping the whole list.
        armed = true;
        window.clearInterval(watchdog);
        advance();
        return;
      }
      if (Date.now() - lastLifeRef.current > WATCHDOG_MS) advance();
    }, WATCHDOG_CHECK_MS);

    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(shake);
      window.clearInterval(poll);
      window.clearInterval(watchdog);
      aliveRef.current?.(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- videoKey owns the lifecycle; handler identities ride refs
  }, [videoKey, advance, iframeRef]);

  /** Send a mute/unMute command (re-fired by the caller on iframe swaps). */
  const setMuted = useCallback(
    (muted: boolean): void => {
      posterOf(iframeRef)({
        event: "command",
        func: muted ? "mute" : "unMute",
        args: [],
      });
    },
    [iframeRef],
  );

  return { started, playing, alive, advance, fail: handlers.onError, setMuted };
}
