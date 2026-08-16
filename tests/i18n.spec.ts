import { describe, expect, it } from "vitest";
import { LOCALES, PRESET_PACKS, tr } from "../src/client/i18n.ts";

describe("i18n", () => {
  it("zh and en dictionaries share the exact same key set", () => {
    const zhKeys = Object.keys(LOCALES["zh"]!).sort();
    const enKeys = Object.keys(LOCALES["en"]!).sort();
    expect(enKeys).toEqual(zhKeys);
    expect(zhKeys.length).toBeGreaterThan(25);
  });

  it("every entry is non-empty in both languages", () => {
    for (const [id, dict] of Object.entries(LOCALES)) {
      for (const [k, v] of Object.entries(dict)) {
        expect(`${id}:${k}`, v.trim()).not.toBe("");
      }
    }
  });

  it("preset packs: unique ids, non-empty bilingual names, 3+ valid entries each", async () => {
    const ids = new Set<string>();
    for (const pack of PRESET_PACKS) {
      expect(ids.has(pack.id), `duplicate pack id ${pack.id}`).toBe(false);
      ids.add(pack.id);
      expect(pack.name.zh.trim() !== "" && pack.name.en.trim() !== "").toBe(true);
      expect(pack.entries.length).toBeGreaterThanOrEqual(3);
      for (const e of pack.entries) {
        expect(e.query.trim()).not.toBe("");
        expect(e.region.trim()).not.toBe("");
      }
    }
  });

  it("tr formats {0} placeholders and falls back without a service", () => {
    expect(tr("header.regionTip", "bikini")).toBe("当前批次关键词：bikini");
    expect(tr("nonexistent.key")).toBe("nonexistent.key");
  });
});
