/**
 * Header overlays: keyword picker and rotation-list management panel.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import type { RotatedEntry } from "./feed-state.ts";
import { isEn, PRESET_PACKS, useT, type PresetPack } from "./i18n.ts";
import { ACCENT } from "./common.tsx";

/** ⚙ panel: manage the rotation list (region label + query per row). */
export function RotationPanel(props: {
  list: RotatedEntry[];
  onChange: (list: RotatedEntry[]) => void;
  onReset: () => void;
  onClose: () => void;
}): ReactNode {
  const t = useT();
  const [region, setRegion] = useState("");
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const isEnLocale = isEn();
  const add = (): void => {
    const q = query.trim();
    if (q === "") return;
    props.onChange([
      ...props.list,
      {
        query: q,
        region: region.trim() === "" ? t("panel.custom") : region.trim(),
      },
    ]);
    setRegion("");
    setQuery("");
  };
  const flash = (msg: string): void => {
    setToast(msg);
    window.setTimeout(() => {
      setToast(null);
    }, 1800);
  };
  /** Append a preset pack (dedup by query). */
  const appendPack = (pack: PresetPack): void => {
    const seen = new Set(props.list.map((e) => e.query));
    const fresh = pack.entries.filter((e) => !seen.has(e.query));
    if (fresh.length === 0) {
      flash(t("panel.imported", 0));
      return;
    }
    props.onChange([...props.list, ...fresh]);
    flash(t("panel.imported", fresh.length));
  };
  return (
    <div
      style={{
        background: "#15151a",
        borderBottom: "1px solid #222",
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: "#aaa",
        }}
      >
        <span>{t("panel.title")}</span>
        <button
          type="button"
          onClick={props.onReset}
          style={{
            background: "none",
            border: "none",
            color: "#888",
            fontSize: 10,
            cursor: "pointer",
          }}
        >
          {t("panel.reset")}
        </button>
        <span style={{ flex: 1 }} />
        {toast !== null && <span style={{ fontSize: 10, color: "#8be08b" }}>{toast}</span>}
        <button
          type="button"
          onClick={props.onClose}
          style={{
            background: "none",
            border: "none",
            color: "#888",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>
      {/* Preset packs: one click replaces the list; ＋ appends (dedup). */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 10, color: "#777" }}>{t("panel.presets")}</span>
        {PRESET_PACKS.map((pack) => (
          <span
            key={pack.id}
            style={{
              display: "inline-flex",
              border: "1px solid #2c3a4c",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              title={pack.entries.map((e) => e.query).join(" · ")}
              onClick={() => {
                props.onChange([...pack.entries]);
                flash(t("panel.imported", pack.entries.length));
              }}
              style={{
                background: "#1a2532",
                border: "none",
                color: "#9cc3e5",
                fontSize: 10,
                padding: "3px 8px",
                cursor: "pointer",
              }}
            >
              {isEnLocale ? pack.name.en : pack.name.zh}
            </button>
            <button
              type="button"
              title={t("panel.append")}
              onClick={() => {
                appendPack(pack);
              }}
              style={{
                background: "#16202b",
                border: "none",
                color: "#5d84a3",
                fontSize: 10,
                padding: "3px 6px",
                cursor: "pointer",
              }}
            >
              ＋
            </button>
          </span>
        ))}
      </div>
      {props.list.map((entry, i) => (
        <div key={`${i}:${entry.query}`} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            value={entry.region}
            onChange={(e) => {
              const next = [...props.list];
              next[i] = { ...entry, region: e.target.value };
              props.onChange(next);
            }}
            style={{
              width: 86,
              background: "#1c1c1f",
              border: "1px solid #2c2c30",
              borderRadius: 6,
              color: "#ffd7a1",
              fontSize: 10,
              padding: "3px 6px",
              outline: "none",
            }}
          />
          <input
            value={entry.query}
            onChange={(e) => {
              const next = [...props.list];
              next[i] = { ...entry, query: e.target.value };
              props.onChange(next);
            }}
            style={{
              flex: 1,
              minWidth: 0,
              background: "#1c1c1f",
              border: "1px solid #2c2c30",
              borderRadius: 6,
              color: "#eee",
              fontSize: 10,
              padding: "3px 6px",
              outline: "none",
            }}
          />
          <button
            type="button"
            title={t("panel.up")}
            onClick={() => {
              if (i === 0) return;
              const next = [...props.list];
              [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
              props.onChange(next);
            }}
            style={{
              background: "none",
              border: "none",
              color: "#666",
              fontSize: 10,
              cursor: "pointer",
            }}
          >
            ↑
          </button>
          <button
            type="button"
            title={t("panel.del")}
            onClick={() => {
              props.onChange(props.list.filter((_, j) => j !== i));
            }}
            style={{
              background: "none",
              border: "none",
              color: "#a66",
              fontSize: 10,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          value={region}
          onChange={(e) => {
            setRegion(e.target.value);
          }}
          placeholder={t("panel.region")}
          style={{
            width: 86,
            background: "#111418",
            border: "1px dashed #2c2c30",
            borderRadius: 6,
            color: "#ffd7a1",
            fontSize: 10,
            padding: "3px 6px",
            outline: "none",
          }}
        />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder={t("panel.query")}
          style={{
            flex: 1,
            minWidth: 0,
            background: "#111418",
            border: "1px dashed #2c2c30",
            borderRadius: 6,
            color: "#eee",
            fontSize: 10,
            padding: "3px 6px",
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={add}
          style={{
            background: "#1c1c1f",
            border: "1px solid #2c2c30",
            color: ACCENT,
            borderRadius: 6,
            fontSize: 10,
            padding: "3px 10px",
            cursor: "pointer",
          }}
        >
          {t("panel.add")}
        </button>
      </div>
    </div>
  );
}
/** Keyword picker: the current source's rotation list as clickable chips —
 *  one click selects the keyword and reloads the feed under it. */
export function KeywordPicker(props: {
  entries: RotatedEntry[];
  active: string;
  onPick: (query: string) => void;
  onClose: () => void;
}): ReactNode {
  const t = useT();
  return (
    <div
      style={{
        background: "#15151a",
        borderBottom: "1px solid #222",
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: "#aaa",
        }}
      >
        <span>{t("header.pickKeyword")}</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={props.onClose}
          style={{
            background: "none",
            border: "none",
            color: "#888",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {props.entries.map((entry) => {
          const isActive = entry.query === props.active;
          return (
            <button
              key={entry.query}
              type="button"
              title={entry.region}
              onClick={() => {
                props.onPick(entry.query);
              }}
              style={{
                background: isActive ? ACCENT : "#1c2230",
                border: `1px solid ${isActive ? ACCENT : "#2c3a4c"}`,
                color: isActive ? "#fff" : "#cfe3f5",
                borderRadius: 999,
                fontSize: 11,
                padding: "4px 12px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {entry.query}
            </button>
          );
        })}
      </div>
    </div>
  );
}
