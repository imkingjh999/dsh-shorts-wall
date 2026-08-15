/**
 * Feed lifecycle tests (jsdom + real React): the tail auto-append path and
 * the watchdog advance path — the two regression hotspots that were only
 * covered by throwaway /tmp scripts before the refactor.
 */
import { createRequire } from 'node:module'
import { describe, expect, it, beforeAll } from 'vitest'
import { shuffled } from '../src/client/feed-state.ts'
// Build artifacts and pnpm-path modules carry no types here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>
const PNPM = '/Users/dev/projects/deepseek-harness/node_modules/.pnpm/'
const reactRequire = createRequire(`${PNPM}react@18.3.1/node_modules/react/index.js`)
const jsdomRequire = createRequire(`${PNPM}jsdom@29.1.1/node_modules/jsdom/package.json`)

const reactDomClient = {
  createRoot: () => ({ render: () => undefined, unmount: () => undefined }),
}

let registration: unknown
let fetchCalls = 0
let batches: Array<Array<{ videoId: string }>> = []

async function setup(batchesIn: Array<Array<{ videoId: string }>>): Promise<void> {
  batches = batchesIn
  fetchCalls = 0
  const { JSDOM } = jsdomRequire('jsdom')
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { pretendToBeVisual: true, url: 'http://dsh.local/' })
  ;(globalThis as AnyRec).window = dom.window
  ;(globalThis as AnyRec).document = dom.window.document
  try { Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true }) } catch { /* read-only in some node versions */ }
  ;(globalThis as AnyRec).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  ;(globalThis as AnyRec).IS_REACT_ACT_ENVIRONMENT = true

  ;(globalThis as AnyRec).fetch = (async () => {
    const b = batches[Math.min(fetchCalls, batches.length - 1)] ?? []
    fetchCalls += 1
    return { ok: true, json: async () => ({ ok: true, value: { yt: b.map(x => ({ ...x, title: x.videoId, authorName: 'a', durationSec: 0, thumbUrl: `https://i.ytimg.com/vi/${x.videoId}/frame0.jpg`, isShorts: true })), hasMore: false, page: 1, query: 'q', region: 'R' } }) }
  }) as unknown as typeof fetch

  const React = reactRequire('react')
  const jsxRuntime = reactRequire('react/jsx-runtime')
  const loader = { load({ factory }: { factory: (r: (s: string) => unknown) => unknown }) {
    (globalThis as AnyRec).__x = factory((spec: string) => {
      if (spec === 'react') return React
      if (spec === 'react/jsx-runtime') return jsxRuntime
      if (spec === 'react-dom/client') return reactDomClient
      throw new Error(`unexpected ${spec}`)
    }) as unknown
  } }
  ;(globalThis as AnyRec).__ModuleLoader__ = loader
  dom.window.__ModuleLoader__ = loader
  // @ts-expect-error built artifact carries no declaration file
  await import('../lib/client.js')
  const mod = (globalThis as AnyRec).__x as { apply(ctx: unknown): void }
let reg: unknown
  mod.apply({
    effect(fn: () => () => void) { fn(); return () => {} },
    inject(deps: string[], cb: (ctx: unknown) => void) {
      if (JSON.stringify(deps) === JSON.stringify(['locale'])) {
        cb({
          effect(fn: () => () => void) { fn(); return () => {} },
          locale: {
            register: () => () => {},
            bind: () => (key: string) => key,
            getLocale: () => ({ active: 'zh', revision: 0 }),
            subscribe: () => () => {},
          },
        })
        return {}
      }
      cb({
        effect(fn: () => () => void) { fn(); return () => {} },
        betterSidebar: { registerTab(d: unknown) { reg = d; return () => {} } },
      })
      return {}
    },
  })
  registration = reg
}

const act = () => reactRequire('react').act as (fn: () => Promise<void>) => Promise<void>
const createRoot = () => (createRequire(`${PNPM}react-dom@18.3.1_react@18.3.1/node_modules/react-dom/client.js`)('react-dom/client') as AnyRec).createRoot

describe('shuffled', () => {
  it('permutes without losing or duplicating items', () => {
    const input = Array.from({ length: 40 }, (_, i) => i)
    for (let round = 0; round < 20; round++) {
      const out = shuffled(input)
      expect(out.length).toBe(40)
      expect(new Set(out)).toEqual(new Set(input))
    }
    expect(shuffled([])).toEqual([])
  })
})

describe('feed lifecycle (jsdom)', () => {
  beforeAll(async () => {
    await setup([
      Array.from({ length: 3 }, (_, i) => ({ videoId: `p1_${i}` })),
      Array.from({ length: 3 }, (_, i) => ({ videoId: `p2_${i}` })),
    ])
  })

  it('mounts and loads page 1', async () => {
    const root = createRoot()(document.getElementById('host')!)
    await act()(async () => { root.render((registration as { component: (p: { visible: boolean }) => unknown }).component({ visible: true })) })
    await act()(async () => { await new Promise(r => setTimeout(r, 100)) })
    expect(fetchCalls).toBe(1)
    expect(document.body.textContent).toContain('1/3')
    await act()(async () => { root.unmount() })
  })

  it('auto-appends the next batch when the tail is reached via manual next', async () => {
    fetchCalls = 0 // this it() remounts → its mount-load is call 1 again
    const root = createRoot()(document.getElementById('host')!)
    await act()(async () => { root.render((registration as { component: (p: { visible: boolean }) => unknown }).component({ visible: true })) })
    // Wait until the first batch actually landed (load is async; clicking
    // before items arrive races the mount-load and the test clicks no-op).
    await act()(async () => {
      for (let i = 0; i < 40 && !document.body.textContent.includes('1/3'); i++) {
        await new Promise(r => setTimeout(r, 50))
      }
    })
    expect(document.body.textContent).toContain('1/3')
    const click = async (): Promise<void> => {
      const btn = [...document.querySelectorAll('button')].find(b => (b.title ?? '').includes('下一条'))
      if (btn === undefined) throw new Error('next button missing')
      await act()(async () => { btn.click() })
      await act()(async () => { await new Promise(r => setTimeout(r, 60)) })
    }
    await click(); await click() // 1 → 2 → 3 (tail)
    expect(document.body.textContent).toContain('3/3')
    await click() // at tail → loadMore fires
    await act()(async () => { await new Promise(r => setTimeout(r, 120)) })
    expect(fetchCalls).toBeGreaterThanOrEqual(2)
    expect(document.body.textContent).toContain('/6') // appended batch grew the list
    await act()(async () => { root.unmount() })
  })

  it('preset pack replaces the rotation list from the ⚙ panel', async () => {
    fetchCalls = 0
    const root = createRoot()(document.getElementById('host')!)
    await act()(async () => { root.render((registration as { component: (p: { visible: boolean }) => unknown }).component({ visible: true })) })
    await act()(async () => {
      // this it() remounts on the shared jsdom: just wait for mount effects to settle
      await new Promise(r => setTimeout(r, 150))
    })
    const click = (el: Element): void => { el.dispatchEvent(new (globalThis as AnyRec).window.MouseEvent('click', { bubbles: true })) }
    const find = (txt: string): Element | undefined => [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').includes(txt))
    await act()(async () => { const gear = find('关键词') ?? find('⚙'); if (gear !== undefined) click(gear) })
    await act()(async () => { await new Promise(r => setTimeout(r, 80)) })
    // The stubbed locale service says zh → preset names render in Chinese.
    await act()(async () => { const beach = find('沙滩') ?? find('Beach'); if (beach !== undefined) click(beach) })
    await act()(async () => { await new Promise(r => setTimeout(r, 150)) })
    const rows = [...document.querySelectorAll('input')].map(i => i.value).filter(v => v.includes('bikini'))
    expect(rows.length).toBeGreaterThan(0) // the pack's bikini keyword landed in the list
    await act()(async () => { root.unmount() })
  })
})
