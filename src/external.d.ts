/** Minimal test/build-time declarations for untyped runtime imports. */

declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: Record<string, unknown>);
    readonly window: Window & typeof globalThis;
  }
}

declare module "react-dom/client" {
  import type { ReactNode } from "react";

  export interface Root {
    render(node: ReactNode): void;
    unmount(): void;
  }

  export function createRoot(container: Element | DocumentFragment): Root;
}
