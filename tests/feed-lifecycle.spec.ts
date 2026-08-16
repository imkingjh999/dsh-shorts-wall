/**
 * Feed lifecycle tests (jsdom + real React): the tail auto-append path and
 * the watchdog advance path — the two regression hotspots that were only
 * covered by throwaway /tmp scripts before the refactor.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { act } from "react";
import { apply } from "../src/client/index.tsx";
import { shuffled } from "../src/client/feed-state.ts";

type AnyRec = Record<string, any>;

let fetchCalls = 0;
let batches: Array<Array<{ videoId: string }>> = [];

beforeAll(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://dsh.local/",
  });
  (globalThis as AnyRec).window = dom.window;
  (globalThis as AnyRec).document = dom.window.document;
  try {
    Object.defineProperty(globalThis, "navigator", {
      value: dom.window.navigator,
      configurable: true,
    });
  } catch {
    /* read-only in some node versions */
  }
  (globalThis as AnyRec).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (globalThis as AnyRec).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as AnyRec).fetch = (async () => {
    const batch = batches[Math.min(fetchCalls, batches.length - 1)] ?? [];
    fetchCalls += 1;
    return {
      ok: true,
      json: async () => ({
        ok: true,
        value: {
          yt: batch.map((x) => ({
            ...x,
            title: x.videoId,
            authorName: "a",
            durationSec: 0,
            thumbUrl: `https://i.ytimg.com/vi/${x.videoId}/frame0.jpg`,
            isShorts: true,
          })),
          hasMore: false,
          page: 1,
          query: "q",
          region: "R",
        },
      }),
    };
  }) as unknown as typeof fetch;

  apply({
    effect(fn: () => () => void) {
      fn();
      return () => {};
    },
    inject(_deps: string[], callback: (ctx: unknown) => void) {
      callback({
        effect(fn: () => () => void) {
          fn();
          return () => {};
        },
        locale: {
          register: () => () => {},
          bind: () => (key: string) => key,
          getLocale: () => ({ active: "zh", revision: 0 }),
          subscribe: () => () => {},
        },
      });
      return {};
    },
  } as unknown as Parameters<typeof apply>[0]);
});

describe("shuffled", () => {
  it("permutes without losing or duplicating items", () => {
    const input = Array.from({ length: 40 }, (_, i) => i);
    for (let round = 0; round < 20; round++) {
      const out = shuffled(input);
      expect(out.length).toBe(40);
      expect(new Set(out)).toEqual(new Set(input));
    }
    expect(shuffled([])).toEqual([]);
  });
});

describe("feed lifecycle (jsdom)", () => {
  beforeAll(() => {
    batches = [
      Array.from({ length: 3 }, (_, i) => ({ videoId: `p1_${i}` })),
      Array.from({ length: 3 }, (_, i) => ({ videoId: `p2_${i}` })),
    ];
    fetchCalls = 0;
  });

  it("mounts docked by default and loads page 1", async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    const toggle = document.querySelector("[data-shell-mode-toggle]");
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect(fetchCalls).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).toContain("1/3");
  });

  it("auto-appends the next batch when the tail is reached via manual next", async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    const click = async (): Promise<void> => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        (b.title ?? "").includes("下一条"),
      );
      if (btn === undefined) throw new Error("next button missing");
      await act(async () => {
        btn.click();
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 60));
      });
    };
    await click();
    await click(); // 1 → 2 → 3 (tail)
    expect(document.body.textContent).toContain("3/3");
    await click(); // at tail → loadMore fires
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    expect(fetchCalls).toBeGreaterThanOrEqual(2);
    expect(document.body.textContent).toContain("/6"); // appended batch grew the list
  });

  it("preset pack replaces the rotation list from the ⚙ panel", async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    const click = (el: Element): void => {
      el.dispatchEvent(
        new (globalThis as AnyRec).window.MouseEvent("click", {
          bubbles: true,
        }),
      );
    };
    const find = (txt: string): Element | undefined =>
      [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(txt));
    await act(async () => {
      const gear = find("关键词") ?? find("⚙");
      if (gear !== undefined) click(gear);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    await act(async () => {
      const beach = find("沙滩") ?? find("Beach");
      if (beach !== undefined) click(beach);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    const rows = [...document.querySelectorAll("input")]
      .map((i) => i.value)
      .filter((v) => v.includes("bikini"));
    expect(rows.length).toBeGreaterThan(0);
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("restores the previous docked layout after boss-key minimize", async () => {
    const click = (el: Element): void => {
      el.dispatchEvent(
        new (globalThis as AnyRec).window.MouseEvent("click", { bubbles: true }),
      );
    };
    const byTitle = (txt: string): HTMLButtonElement | undefined =>
      [...document.querySelectorAll("button")].find((b) =>
        (b.title ?? "").includes(txt),
      ) as HTMLButtonElement | undefined;
    const wait = async (): Promise<void> => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 60));
      });
    };
    const toggle = (): HTMLButtonElement => {
      const el = document.querySelector<HTMLButtonElement>("[data-shell-mode-toggle]");
      if (el === null) throw new Error("mode toggle missing");
      return el;
    };
    const isFloating = (): boolean => toggle().getAttribute("aria-checked") === "true";
    const setFloating = async (next: boolean): Promise<void> => {
      if (isFloating() === next) return;
      await act(async () => {
        click(toggle());
      });
      await wait();
    };

    await setFloating(true);
    await setFloating(false);

    const minimize = byTitle("最小化");
    if (minimize === undefined) throw new Error("minimize button missing");
    await act(async () => {
      click(minimize);
    });
    await wait();

    const launcher = byTitle("打开 Shorts");
    if (launcher === undefined) throw new Error("launcher missing");
    await act(async () => {
      click(launcher);
    });
    await wait();

    expect(isFloating()).toBe(false);
  });

  it("toggles mute with Alt+M using a physical key match", async () => {
    const headerText = () => document.body.textContent ?? "";
    const before = headerText().includes("已静音");
    const event = new (globalThis as AnyRec).window.KeyboardEvent("keydown", {
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      // macOS Option+M produces "µ"; the physical code must still match.
      key: "µ",
      code: "KeyM",
      bubbles: true,
    });
    await act(async () => {
      (globalThis as AnyRec).window.dispatchEvent(event);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    const after = headerText().includes("已静音");
    expect(after).toBe(!before);
  });

  it("shares one size between float and dock and exposes four resize corners", async () => {
    const click = (el: Element): void => {
      el.dispatchEvent(
        new (globalThis as AnyRec).window.MouseEvent("click", { bubbles: true }),
      );
    };
    const wait = async (): Promise<void> => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 40));
      });
    };
    const panel = (): HTMLElement => {
      const el = document.querySelector<HTMLElement>("[data-shell-panel]");
      if (el === null) throw new Error("shell panel missing");
      return el;
    };
    const toggle = (): HTMLButtonElement => {
      const el = document.querySelector<HTMLButtonElement>("[data-shell-mode-toggle]");
      if (el === null) throw new Error("mode toggle missing");
      return el;
    };
    const isFloating = (): boolean => toggle().getAttribute("aria-checked") === "true";
    const setFloating = async (next: boolean): Promise<void> => {
      if (isFloating() === next) return;
      await act(async () => {
        click(toggle());
      });
      await wait();
    };

    await setFloating(true);
    const floatWidth = panel().style.width;
    await setFloating(false);

    expect(panel().style.width).toBe(floatWidth);
    expect(document.querySelectorAll("[data-resize-corner]")).toHaveLength(4);
  });
});
