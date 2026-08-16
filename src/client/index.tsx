/**
 * dsh-shorts-wall client entry: mounts the persistent「Shorts」floating
 * window and attaches the optional host locale service.
 */
import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import type { LocaleService } from "./i18n.ts";
import { attachLocale } from "./i18n.ts";
import { FloatingShell } from "./shell.tsx";

interface ClientContext {
  effect(callback: () => () => void, label?: string): () => void;
  inject(dependencies: string[], callback: (ctx: InjectedContext) => void): unknown;
}

interface InjectedContext {
  effect(callback: () => () => void, label?: string): () => void;
  locale?: LocaleService;
}

export function apply(ctx: ClientContext): void {
  ctx.inject(["locale"], (lctx) => {
    if (lctx.locale === undefined) return;
    lctx.effect(() => attachLocale(lctx.locale as LocaleService), "shorts-wall: attach locale");
  });

  ctx.effect(() => {
    const host = document.createElement("div");
    host.setAttribute("data-dsh-shorts-wall", "");
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(<FloatingShell />);
    return () => {
      try {
        root.unmount();
      } catch {
        /* already gone */
      }
      host.remove();
    };
  }, "shorts-wall: floating window");
}
