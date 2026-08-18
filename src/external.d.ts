/**
 * Local ambient declarations for host-provided Node APIs. React/react-dom
 * types now resolve from @types/react (single universe, shared with
 * dsh-float-window); the old loose stubs merged with the real declarations
 * and poisoned JSX checking, so they are gone.
 */

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

/** jsdom ships no bundled declarations; keep the minimal test-surface stub. */
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: Record<string, unknown>);
    readonly window: Window & typeof globalThis;
  }
}
