/**
 * Feed viewport: header controls plus the currently visible shorts card.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  WheelEvent,
} from "react";
import { useRotation, useShotsFeed } from "./feed-state.ts";
import { isMuteKey } from "./hotkeys.ts";
import { useT } from "./i18n.ts";
import {
  ACCENT,
  BUILD_TAG,
  FeedEmpty,
  FeedLoading,
  MUTE_KEY,
  WHEEL_COOLDOWN_MS,
} from "./common.tsx";
import { ShortsCard } from "./cards.tsx";
import { BiliCard } from "./bili-card.tsx";
import { KeywordPicker, RotationPanel } from "./panels.tsx";

/** The tab root: header + one full-height shorts card. */
export function ShortsFeed({ visible }: { visible: boolean }): ReactNode {
  const t = useT();
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem(MUTE_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const toggleMute = useCallback((): void => {
    setMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      } catch {
        /* optional */
      }
      return next;
    });
  }, []);

  // Alt/Option + M toggles sound globally, matching the Alt+S boss key style.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!isMuteKey(e)) return;
      e.preventDefault();
      toggleMute();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [toggleMute]);

  const { rotation, biliRotation, commit, commitBili, reset, resetBili } = useRotation();
  const feed = useShotsFeed(rotation, biliRotation);
  const [panelOpen, setPanelOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [switchToast, setSwitchToast] = useState<string | null>(null);
  const flashToast = useCallback((msg: string): void => {
    setSwitchToast(msg);
    window.setTimeout(() => {
      setSwitchToast(null);
    }, 2000);
  }, []);
  const [alive, setAlive] = useState(false);
  const lastWheelRef = useRef(0);

  const current = feed.items[feed.idx];
  const loadingInitial = feed.items.length === 0 && feed.busy;
  // The card key must be the item id (bilibili and youtube ids differ in shape).
  const card =
    current === undefined ? null : current.kind === "bili" ? (
      <BiliCard
        key={current.id}
        short={current.bili!}
        visible={visible}
        muted={muted}
        onEnded={feed.next}
        autoSkipRef={feed.autoSkipRef}
      />
    ) : (
      <ShortsCard
        key={current.id}
        video={current.yt!}
        visible={visible}
        muted={muted}
        onEnded={feed.next}
        autoSkipRef={feed.autoSkipRef}
        onAliveChange={setAlive}
        onOutcome={feed.noteYtOutcome}
      />
    );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#000",
        color: "#fff",
        fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
        minWidth: 0,
        position: "relative",
      }}
      tabIndex={0}
      onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (e.key === "ArrowDown" || e.key === "j") {
          e.preventDefault();
          feed.next();
        }
        if (e.key === "ArrowUp" || e.key === "k") {
          e.preventDefault();
          feed.prev();
        }
      }}
    >
      {/* Header: keyword box, counter, sound, nav */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "7px 10px",
          background: "#111",
          borderBottom: "1px solid #222",
          alignItems: "center",
        }}
      >
        <span
          title={`${t("header.build")} ${BUILD_TAG}`}
          style={{
            fontSize: 9,
            color: "#555",
            border: "1px solid #333",
            borderRadius: 6,
            padding: "0 5px",
          }}
        >
          {BUILD_TAG}
        </span>
        <button
          type="button"
          onClick={() => {
            if (feed.source !== "youtube") flashToast(t("header.switching"));
            feed.setSource("youtube");
          }}
          style={{
            background: feed.source === "youtube" ? ACCENT : "none",
            border: `1px solid ${feed.source === "youtube" ? ACCENT : "#2c2c30"}`,
            color: feed.source === "youtube" ? "#fff" : "#888",
            borderRadius: 999,
            fontSize: 10,
            padding: "2px 9px",
            cursor: "pointer",
          }}
        >
          YT
        </button>
        <button
          type="button"
          onClick={() => {
            if (feed.source !== "bilibili") flashToast(t("header.switching"));
            feed.setSource("bilibili");
          }}
          style={{
            background: feed.source === "bilibili" ? "#00a1d6" : "none",
            border: `1px solid ${feed.source === "bilibili" ? "#00a1d6" : "#2c2c30"}`,
            color: feed.source === "bilibili" ? "#fff" : "#888",
            borderRadius: 999,
            fontSize: 10,
            padding: "2px 9px",
            cursor: "pointer",
          }}
        >
          B站
        </button>
        {feed.source === "youtube" && (
          <span
            title={alive ? t("header.alive") : t("header.dead")}
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: alive ? "#2ecc71" : "#777",
              display: "inline-block",
              cursor: "help",
            }}
          />
        )}
        {/* Active keyword chip: shows the selected keyword; click opens the picker */}
        <button
          type="button"
          title={t("header.keywordTip")}
          onClick={() => {
            setPickerOpen((o) => !o);
          }}
          style={{
            background: "#1c2230",
            border: `1px solid ${pickerOpen ? ACCENT : "#2c3a4c"}`,
            color: "#cfe3f5",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 12px",
            cursor: "pointer",
            whiteSpace: "nowrap",
            maxWidth: 150,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {feed.activeQuery === "" ? t("header.pickKeyword") : feed.activeQuery}
        </button>
        <button
          type="button"
          title={t("header.nextTitle")}
          onClick={() => {
            flashToast(t("header.switchingBatch"));
            feed.refreshVideos();
          }}
          style={{
            background: "#1c1c1f",
            border: "1px solid #2c2c30",
            color: ACCENT,
            borderRadius: 8,
            fontSize: 11,
            padding: "4px 9px",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {t("header.next")}
        </button>
        <button
          type="button"
          title={t("header.muteKeyTip")}
          onClick={toggleMute}
          style={{
            background: muted ? "#1c1c1f" : ACCENT,
            border: `1px solid ${muted ? "#2c2c30" : ACCENT}`,
            color: muted ? "#aaa" : "#fff",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 10px",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {muted ? t("header.soundOff") : t("header.soundOn")}
        </button>
        <button
          type="button"
          title={t("header.gear")}
          onClick={() => {
            setPanelOpen((o) => !o);
          }}
          style={{
            background: panelOpen ? ACCENT : "#1c1c1f",
            border: `1px solid ${panelOpen ? ACCENT : "#2c2c30"}`,
            color: panelOpen ? "#fff" : "#ccc",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 10px",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {t("header.keywords")}
        </button>
        <button
          type="button"
          title={t("header.prev")}
          onClick={feed.prev}
          style={{
            background: "none",
            border: "none",
            color: "#aaa",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          ‹
        </button>
        <button
          type="button"
          title={t("header.nextVideo")}
          onClick={feed.next}
          style={{
            background: "none",
            border: "none",
            color: "#aaa",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          ›
        </button>
        <button
          type="button"
          title={t("header.random")}
          onClick={() => {
            feed.jumpRandom();
          }}
          style={{
            background: "none",
            border: "none",
            color: "#aaa",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          🎲
        </button>
        <span style={{ fontSize: 10, color: "#666" }}>
          {feed.items.length > 0 ? `${feed.idx + 1}/${feed.items.length}` : ""}
        </span>
      </div>
      {switchToast !== null && (
        <div
          style={{
            position: "absolute",
            top: 42,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(30,30,34,.94)",
            border: "1px solid #2c3a4c",
            borderRadius: 10,
            fontSize: 11,
            color: "#cfe3f5",
            padding: "5px 14px",
            pointerEvents: "none",
            zIndex: 30,
          }}
        >
          {switchToast}
        </div>
      )}
      {pickerOpen && (
        <KeywordPicker
          entries={feed.source === "bilibili" ? biliRotation : rotation}
          active={feed.activeQuery}
          onPick={(q) => {
            setPickerOpen(false);
            feed.selectQuery(q);
          }}
          onClose={() => {
            setPickerOpen(false);
          }}
        />
      )}
      {panelOpen &&
        (feed.source === "bilibili" ? (
          <RotationPanel
            list={biliRotation}
            onChange={commitBili}
            onReset={resetBili}
            onClose={() => {
              setPanelOpen(false);
            }}
          />
        ) : (
          <RotationPanel
            list={rotation}
            onChange={commit}
            onReset={reset}
            onClose={() => {
              setPanelOpen(false);
            }}
          />
        ))}
      {feed.ytDown && feed.source === "youtube" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            background: "#3a2a14",
            color: "#ffd7a1",
            fontSize: 11,
            borderBottom: "1px solid #4a3a20",
          }}
        >
          <span style={{ flex: 1 }}>{t("err.ytDown")}</span>
          <button
            type="button"
            onClick={() => {
              feed.setSource("bilibili");
            }}
            style={{
              background: "#00a1d6",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 11,
              padding: "4px 12px",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {t("err.ytDownSwitch")}
          </button>
        </div>
      )}
      {feed.error !== null && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            padding: "5px 10px",
            background: "#3a1418",
            color: "#ffb4bc",
            fontSize: 11,
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {feed.error}
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => {
                void feed.reload(feed.mode === "rotate" ? null : feed.activeQuery);
              }}
              style={{
                background: "none",
                border: "none",
                color: "#ffb4bc",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              {t("err.retry")}
            </button>
            <button
              type="button"
              onClick={feed.dismissError}
              style={{
                background: "none",
                border: "none",
                color: "#ffb4bc",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              ✕
            </button>
          </span>
        </div>
      )}

      {/* Body: the current short, 9:16 locked */}
      <div
        style={{ flex: 1, minHeight: 0, position: "relative" }}
        onWheel={(e: WheelEvent<HTMLDivElement>) => {
          if (Math.abs(e.deltaY) < 12) return;
          const now = Date.now();
          if (now - lastWheelRef.current < WHEEL_COOLDOWN_MS) return;
          lastWheelRef.current = now;
          if (e.deltaY > 0) feed.next();
          else feed.prev();
        }}
      >
        {loadingInitial ? (
          <FeedLoading label={t("common.loading")} />
        ) : current === undefined ? (
          <FeedEmpty
            label={t("empty.none")}
            retryLabel={t("err.retry")}
            onRetry={() => {
              void feed.reload(null);
            }}
          />
        ) : (
          card
        )}
      </div>
    </div>
  );
}
