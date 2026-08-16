/**
 * dsh-shorts-wall host entry: wires the feed resolvers into the JSON API and
 * media-proxy routes. HTTP fencing and route implementations live in
 * `src/server/` so each module stays focused and reviewable.
 */
import { BiliShortsFeed } from "./bilibili-shorts.ts";
import { YtFeed } from "./youtube.ts";
import { createApiHandler } from "./server/api.ts";
import {
  createTunnel,
  detectProxyUrl,
  isTunnelHost,
  isTrustedRequest,
  type HostContext,
  type PluginConfig,
  type RouteHandler,
} from "./server/http.ts";
import { createProxyHandler } from "./server/media-proxy.ts";

/** Plugin identity for cordis.yml rows. */
export const name = "dsh-shorts-wall";

/** Services required before mounting: webserver routes and trusted hosts. */
export const inject = ["webServer", "webRuntime"];

export type { YtVideo } from "./youtube.ts";

/** Host plugin body: register the API and media routes. */
export function apply(ctx: HostContext, config?: PluginConfig): void {
  const rawConfig = (config ?? {}) as Partial<PluginConfig>;
  const extraAllowSuffixes = Array.isArray(rawConfig.extraAllowSuffixes)
    ? rawConfig.extraAllowSuffixes.filter((s): s is string => typeof s === "string")
    : [];
  const fence = (req: Parameters<typeof isTrustedRequest>[0]): boolean =>
    isTrustedRequest(req, ctx.webRuntime.trustedHosts);

  const tunnel = createTunnel(detectProxyUrl(rawConfig.resolveProxyUrl));
  const scrapeFetch = ((
    url: string,
    init?: { headers?: Record<string, string>; redirect?: "follow" | "manual"; signal?: AbortSignal },
  ) =>
    tunnel !== undefined && isTunnelHost(url)
      ? tunnel(url, init)
      : fetch(url, init)) as unknown as typeof fetch;

  const apiHandler: RouteHandler = createApiHandler({
    fence,
    ytFeed: new YtFeed(scrapeFetch),
    biliShorts: new BiliShortsFeed(scrapeFetch),
  });
  const proxyHandler: RouteHandler = createProxyHandler({
    fence,
    extraAllowSuffixes,
    tunnel,
  });

  for (const [path, handler, label] of [
    ["/bilibili/api", apiHandler, "shorts-wall: /bilibili/api compat routes"],
    ["/shorts/api", apiHandler, "shorts-wall: /shorts/api routes"],
    ["/bilibili/proxy", proxyHandler, "shorts-wall: /bilibili/proxy compat routes"],
    ["/shorts/proxy", proxyHandler, "shorts-wall: /shorts/proxy media route"],
  ] as const) {
    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: "prefix",
          path,
          handler,
        }),
      label,
    );
  }
}
