/**
 * jsdom end-to-end render test of the built client bundle: mounts the real
 * component tree in a DOM, lets effects run (feed fetch → prepare → play
 * fetch), and asserts the video element receives a proxied src — the exact
 * flow that used to strand cards at「取播放地址中」.
 */
import { createRequire } from 'node:module'
const PNPM = '/Users/dev/projects/deepseek-harness/node_modules/.pnpm/'
const jsdomRequire = createRequire(`${PNPM}jsdom@29.1.1/node_modules/jsdom/package.json`)
const reactRequire = createRequire(`${PNPM}react@18.3.1/node_modules/react/index.js`)
const React = reactRequire('react')
const { act } = reactRequire('react')
const { createRoot } = createRequire(`${PNPM}react-dom@18.3.1_react@18.3.1/node_modules/react-dom/client.js`)('react-dom/client')
const jsxRuntime = reactRequire('react/jsx-runtime')

const { JSDOM } = jsdomRequire('jsdom')
const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { pretendToBeVisual: true, url: 'http://dsh.local/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
try { globalThis.navigator = dom.window.navigator } catch { /* node 22+: read-only global, jsdom's is already wired via window */ }
globalThis.ResizeObserver = class {
  constructor(cb) { this.cb = cb }
  observe(el) { queueMicrotask(() => this.cb([{ target: el }], this)) }
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver = class {
  constructor(cb) { this.cb = cb }
  observe(el) {
    // Immediately report every card as 100% visible: drives activeIdx=0.
    queueMicrotask(() => this.cb([{ isIntersecting: true, intersectionRatio: 1, target: el }]))
  }
  unobserve() {}
  disconnect() {}
};
// React 18 act() environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const YT_ITEM = {
  videoId: 'ulE0bTmrKOk', title: '端到端 Shorts 标题', authorName: '90万次观看',
  durationSec: 0, thumbUrl: 'https://i.ytimg.com/vi/ulE0bTmrKOk/frame0.jpg', isShorts: true,
}
const calls = []
globalThis.fetch = async (url) => {
  calls.push(String(url))
  if (String(url).includes('/shorts/api/feed')) {
    return { ok: true, json: async () => ({ ok: true, value: { yt: [YT_ITEM], hasMore: false, page: 1, query: '美女 跳舞' } }) }
  }
  throw new Error(`unexpected fetch ${url}`)
}

const reactDomClient = {
  createRoot: () => ({ render: () => undefined, unmount: () => undefined }),
}
let registration = null
const moduleLoader = {
  load({ id, factory }) {
    if (id !== 'dsh-shorts-wall') throw new Error(`unexpected bundle id ${id}`)
    const exports = factory((spec) => {
      if (spec === 'react') return React
      if (spec === 'react/jsx-runtime') return jsxRuntime
      if (spec === 'react-dom/client') return reactDomClient
      throw new Error(`unexpected require "${spec}"`)
    })
    globalThis.__x = exports
  },
}
globalThis.__ModuleLoader__ = moduleLoader
dom.window.__ModuleLoader__ = moduleLoader
await import('../lib/client.js')

globalThis.__x.apply({
  effect(fn) { fn(); return () => {} },
  inject(deps, cb) {
    if (JSON.stringify(deps) === JSON.stringify(['locale'])) return { dispose() {} } // locale child fiber: dormant in tests
    cb({
      effect(fn) { fn(); return () => {} },
      betterSidebar: { registerTab(d) { registration = d; return () => {} } },
    })
    return { dispose() {} }
  },
})
if (registration === null) throw new Error('tab not registered')

const host = document.getElementById('host')
const root = createRoot(host)

// Mount and let all effects/settled promises flush.
await act(async () => { root.render(registration.component({ visible: true })) })
await act(async () => { await new Promise(r => setTimeout(r, 50)) })
await act(async () => { await new Promise(r => setTimeout(r, 50)) })

const html = host.innerHTML
const feedCall = calls.find(c => c.includes('/feed'))
console.log('feed fetch called:', Boolean(feedCall))
if (feedCall === undefined) throw new Error('the feed fetch never fired')
// The shorts flow mounts the YtCard; the YT SDK cannot load in jsdom, which
// surfaces the retry overlay — assert the card rendered with its content.
if (!html.includes('端到端 Shorts 标题')) throw new Error('shorts card title missing from render')
const img = host.querySelector('img')
if (img === null || !String(img.getAttribute('src') ?? '').includes('/bilibili/proxy?u=')) {
  throw new Error('shorts thumbnail not proxied')
}
console.log('shorts card renders with proxied thumb ✓')
// Unmount: the poll/handshake intervals keep the node event loop alive
// otherwise (the process would never exit).
await act(async () => { root.unmount() })
console.log('E2E RENDER TEST PASSED')
