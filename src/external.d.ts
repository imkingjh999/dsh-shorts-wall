/** Local ambient declarations for host-provided Node, React, and test APIs. */

declare var process: {
  env: Record<string, string | undefined>;
};

interface Buffer extends Uint8Array {
  toString(encoding?: string): string;
  readonly byteLength: number;
}

declare var Buffer: {
  alloc(size: number): Buffer;
  from(input: string | ArrayBuffer | ArrayBufferView): Buffer;
  concat(chunks: readonly Buffer[]): Buffer;
};

interface EventEmitterLike {
  on(event: string, listener: (...args: unknown[]) => void): EventEmitterLike;
  once(event: string, listener: (...args: unknown[]) => void): EventEmitterLike;
  removeEventListener(event: string, listener: (...args: unknown[]) => void): EventEmitterLike;
}

declare module "node:http" {
  export interface IncomingMessage extends EventEmitterLike, AsyncIterable<string | Buffer> {
    url?: string;
    method?: string;
    statusCode?: number;
    headers: Record<string, string | string[] | undefined>;
    on(event: "data", listener: (chunk: Buffer | string) => void): this;
    on(event: "end", listener: () => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
  }

  export interface ServerResponse extends EventEmitterLike {
    headersSent: boolean;
    writeHead(status: number, headers?: Record<string, string | number>): ServerResponse;
    end(data?: string | Buffer | Uint8Array): void;
    destroy(error?: Error): void;
  }

  export interface ClientRequest extends EventEmitterLike {
    destroy(error?: Error): void;
    end(): void;
    on(event: "timeout", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(
      event: "connect",
      listener: (response: IncomingMessage, socket: { destroy(error?: Error): void }) => void,
    ): this;
  }

  export function request(
    options: unknown,
    callback?: (response: IncomingMessage) => void,
  ): ClientRequest;
}

declare module "node:https" {
  export function request(
    options: unknown,
    callback?: (response: import("node:http").IncomingMessage) => void,
  ): import("node:http").ClientRequest;
  export type RequestOptions = Record<string, unknown>;
}

declare module "node:stream" {
  export class Readable {
    static fromWeb(stream: unknown): Readable;
  }
}

declare module "node:stream/promises" {
  export function pipeline(source: unknown, destination: unknown): Promise<void>;
}

declare module "node:module" {
  export function createRequire(filename: string): NodeRequire;
  interface NodeRequire {
    (id: string): unknown;
    resolve(id: string, options?: { paths?: string[] }): string;
  }
}

declare module "react" {
  export type DependencyList = readonly unknown[];
  export type ReactNode = unknown;
  export type CSSProperties = Record<string, unknown>;
  export type SetStateAction<S> = S | ((previous: S) => S);
  export type Dispatch<A> = (action: A) => void;
  export type RefObject<T> = { current: T | null };

  export interface SyntheticEvent<T = Element> {
    preventDefault(): void;
    stopPropagation(): void;
    currentTarget: T;
    target: EventTarget;
    clientX: number;
    clientY: number;
  }

  export type MouseEvent<T = Element> = SyntheticEvent<T>;
  export interface KeyboardEvent<T = Element> extends SyntheticEvent<T> {
    key: string;
  }
  export interface WheelEvent<T = Element> extends SyntheticEvent<T> {
    deltaY: number;
  }

  export function useCallback<T>(callback: T, deps: DependencyList): T;
  export function useEffect(
    effect: () => void | (() => void),
    deps?: DependencyList,
  ): void;
  export function useRef<T>(initial: T): { current: T };
  export function useState<S>(
    initialState: S | (() => S),
  ): [S, Dispatch<SetStateAction<S>>];
  export function act(effect: () => void | Promise<void>): Promise<void>;

  export namespace React {
    type RefObject<T> = RefObject<T>;
    type MouseEvent<T = Element> = MouseEvent<T>;
    type KeyboardEvent<T = Element> = KeyboardEvent<T>;
    type WheelEvent<T = Element> = WheelEvent<T>;
  }
}

declare namespace React {
  type RefObject<T> = import("react").RefObject<T>;
  type MouseEvent<T = Element> = import("react").MouseEvent<T>;
}

declare module "react/jsx-runtime" {
  export type JSXElement = unknown;
  export function jsx(type: unknown, props: unknown, key?: unknown): JSXElement;
  export function jsxs(type: unknown, props: unknown, key?: unknown): JSXElement;
  export const Fragment: unique symbol;
}

declare namespace JSX {
  type Element = unknown;
  interface IntrinsicAttributes {
    key?: string;
  }
  interface IntrinsicElements {
    [elementName: string]: any;
  }
  interface ElementChildrenAttribute {
    children: any;
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

declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: Record<string, unknown>);
    readonly window: Window & typeof globalThis;
  }
}
