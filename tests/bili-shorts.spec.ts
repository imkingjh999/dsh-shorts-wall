import { describe, expect, it } from "vitest";
import { BiliShortsFeed, parseDurationText, stripTitleHtml } from "../src/bilibili-shorts.ts";

const SEARCH_PAGE = {
  code: 0,
  data: {
    result: [
      {
        bvid: "BV1H5gs6KE12",
        title: '想欣赏<em class="keyword">妾身</em>的舞姿吗？',
        author: "UP甲",
        duration: "0:19",
        pic: "http://i0.hdslb.com/bfs/archive/a.jpg",
      },
      {
        bvid: "BV1nEgo6XEjr",
        title: "夜店热舞",
        author: "UP乙",
        duration: "1:36",
        pic: "//i0.hdslb.com/bfs/archive/b.jpg",
      },
      {
        bvid: "av12345",
        title: "非BV结果应被丢弃",
        author: "x",
        duration: "0:10",
        pic: "",
      },
    ],
  },
};
const VIEW_PORTRAIT = {
  code: 0,
  data: { cid: 111, dimension: { width: 1080, height: 1920 } },
};
const VIEW_LANDSCAPE = {
  code: 0,
  data: { cid: 222, dimension: { width: 1920, height: 1080 } },
};
const PLAY = {
  code: 0,
  data: { durl: [{ url: "https://upos-sz-estgcos.bilivideo.com/x.mp4" }] },
};

function jsonRes(obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("bilibili-shorts", () => {
  it("parses helpers", () => {
    expect(stripTitleHtml('想欣赏<em class="keyword">妾身</em>的舞姿')).toBe("想欣赏妾身的舞姿");
    expect(parseDurationText("1:36")).toBe(96);
    expect(parseDurationText(undefined)).toBe(0);
  });

  it("searches, portrait-preflights, and drops non-BV / landscape entries", async () => {
    const views: string[] = [];
    const fetchMock = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/wbi/search/type")) return jsonRes(SEARCH_PAGE);
      if (url.includes("/view?bvid=BV1H5gs6KE12")) {
        views.push("portrait");
        return jsonRes(VIEW_PORTRAIT);
      }
      if (url.includes("/view?bvid=BV1nEgo6XEjr")) {
        views.push("landscape");
        return jsonRes(VIEW_LANDSCAPE);
      }
      if (url.includes("/playurl")) return jsonRes(PLAY);
      return new Response("nf", { status: 404 });
    }) as unknown as typeof fetch;
    const feed = new BiliShortsFeed(fetchMock);
    const { items, hasMore } = await feed.page("美女 舞蹈", 1);
    // landscape entry dropped, non-BV dropped, only the portrait one survives
    expect(items.length).toBe(1);
    expect(items[0]).toMatchObject({
      bvid: "BV1H5gs6KE12",
      cid: 111,
      durationSec: 19,
    });
    expect(items[0]!.title).toBe("想欣赏妾身的舞姿吗？");
    expect(hasMore).toBe(false); // fewer results than pagesize
    expect(views.sort()).toEqual(["landscape", "portrait"]);
  });

  it("resolves mp4 play urls", async () => {
    const fetchMock = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/playurl")) return jsonRes(PLAY);
      return new Response("nf", { status: 404 });
    }) as unknown as typeof fetch;
    const feed = new BiliShortsFeed(fetchMock);
    expect(await feed.play("BV1H5gs6KE12", 111)).toEqual([
      "https://upos-sz-estgcos.bilivideo.com/x.mp4",
    ]);
  });

  it("surfaces friendly errors", async () => {
    const dead = (async () => {
      throw new Error("net");
    }) as unknown as typeof fetch;
    const feed = new BiliShortsFeed(dead);
    await expect(feed.page("x", 1)).rejects.toThrow(/连不上 B 站/);
    await expect(new BiliShortsFeed(dead).play("BV1x", 1)).rejects.toThrow(/连不上 B 站/);
  });
});
