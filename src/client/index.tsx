/**
 * dsh-bilibili-sidebar client half: registers the「Shorts」tab in
 * dsh-better-sidebar — a full-height YouTube Shorts vertical carousel
 * (keyword rotation, wheel/keys/buttons to advance, auto-next on end,
 * watchdog for dead channels). Rendering lives here; behavior lives in
 * sibling hooks (embed-events / card-timers / feed-state).
 *
 * The betterSidebar service contract is re-stated locally (sentinel style)
 * and the dependency is a runtime dynamic inject so a missing
 * better-sidebar keeps this bundle dormant instead of failing the boot.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { YtVideo } from '../youtube.ts'
import { useRotation, useShotsFeed, type FeedItem, type RotatedEntry } from './feed-state.ts'
import { fetchBiliPlay } from './feed-state.ts'
import { useCoverLift, useNineBySixteen, useTitleAutoHide } from './card-timers.ts'
import { useYtEmbedEvents } from './embed-events.ts'
import { attachLocale, isEn, PRESET_PACKS, useT, type PresetPack } from './i18n.ts'

/** Minimal structural re-statement of the betterSidebar service contract. */
interface SessionScope { sessionId: string; cwd?: string }
interface TabComponentProps {
  visible: boolean
  scope: SessionScope
  tab: { id: string; type: string; title: string }
}
interface TabDescriptor {
  id: string
  title: string | (() => string)
  icon?: ReactNode | ((size: number) => ReactNode)
  order?: number
  single?: boolean
  component: (props: TabComponentProps) => ReactNode
}
interface ClientContext {
  effect(callback: () => () => void, label?: string): () => void
  inject(dependencies: string[], callback: (ctx: InjectedContext) => void): unknown
}
interface InjectedContext {
  effect(callback: () => () => void, label?: string): () => void
  locale?: import('./i18n.ts').LocaleService
}

const ACCENT = '#ff2d55'
const WHEEL_COOLDOWN_MS = 380
const MUTE_KEY = 'dsh-bilibili-sidebar:muted'
const BUILD_TAG = 'v0.8.1'

/** Wrap an upstream URL through the host media proxy. */
function proxyUrl(upstream: string): string {
  return `/bilibili/proxy?u=${encodeURIComponent(upstream)}`
}

/** Play glyph for the tab icon and loading states. */
function PlayGlyph({ size }: { size: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.2v13.6a.8.8 0 0 0 1.23.67l9.2-6.8a.8.8 0 0 0 0-1.34l-9.2-6.8A.8.8 0 0 0 8 5.2z" fill={ACCENT} />
    </svg>
  )
}

/** Client plugin body. */
export function apply(ctx: ClientContext): void {
  // Locale: separate child fiber so a missing locale service never blocks
  // (or is blocked by) anything else.
  ctx.inject(['locale'], (lctx) => {
    lctx.effect(() => attachLocale(lctx.locale as import('./i18n.ts').LocaleService), 'shorts-wall: attach locale')
  })

  // Primary surface: a self-mounted FLOATING window on document.body — no
  // better-sidebar dependency. Stick mode docks it to the screen's right
  // edge as a slim vertical rail; drag to reposition; double-click the
  // title bar to toggle stick.
  ctx.effect(() => {
    const host = document.createElement('div')
    host.setAttribute('data-dsh-shorts-wall', '')
    document.body.appendChild(host)
    const root = createRoot(host)
    root.render(<FloatingShell />)
    return () => {
      try { root.unmount() } catch { /* already gone */ }
      host.remove()
    }
  }, 'shorts-wall: floating window')

}

/** The tab root: header + one full-height shorts card. */
function ShortsFeed({ visible }: { visible: boolean }): ReactNode {
  const t = useT()
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem(MUTE_KEY) !== '0' } catch { return true }
  })
  const toggleMute = useCallback((): void => {
    setMuted((prev) => {
      const next = !prev
      try { localStorage.setItem(MUTE_KEY, next ? '1' : '0') } catch { /* optional */ }
      return next
    })
  }, [])

  const { rotation, biliRotation, commit, commitBili, reset, resetBili } = useRotation()
  const feed = useShotsFeed(rotation, biliRotation)
  const [panelOpen, setPanelOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [switchToast, setSwitchToast] = useState<string | null>(null)
  const [queryInput, setQueryInput] = useState('')
  const flashToast = useCallback((msg: string): void => {
    setSwitchToast(msg)
    window.setTimeout(() => { setSwitchToast(null) }, 2000)
  }, [])
  const [alive, setAlive] = useState(false)
  const lastWheelRef = useRef(0)

  const current = feed.items[feed.idx]
  const loadingInitial = feed.items.length === 0 && feed.busy
  // The card key must be the item id (bilibili and youtube ids differ in shape).
  const card = current === undefined ? null : current.kind === 'bili'
    ? (
      <BiliCard
        key={current.id}
        short={current.bili!}
        visible={visible}
        muted={muted}
        onToggleMute={toggleMute}
        onEnded={feed.next}
        autoSkipRef={feed.autoSkipRef}
      />
      )
    : (
      <ShortsCard
        key={current.id}
        video={current.yt!}
        visible={visible}
        muted={muted}
        onToggleMute={toggleMute}
        onEnded={feed.next}
        autoSkipRef={feed.autoSkipRef}
        onAliveChange={setAlive}
        onOutcome={feed.noteYtOutcome}
      />
      )

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#000', color: '#fff', fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif', minWidth: 0, position: 'relative' }}
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); feed.next() }
        if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); feed.prev() }
      }}
    >
      {/* Header: keyword box, counter, sound, nav */}
      <div style={{ display: 'flex', gap: 6, padding: '7px 10px', background: '#111', borderBottom: '1px solid #222', alignItems: 'center' }}>
        <span title={`${t('header.build')} ${BUILD_TAG}`} style={{ fontSize: 9, color: '#555', border: '1px solid #333', borderRadius: 6, padding: '0 5px' }}>{BUILD_TAG}</span>
        <button type="button" onClick={() => { if (feed.source !== 'youtube') flashToast(t('header.switching')); feed.setSource('youtube') }} style={{ background: feed.source === 'youtube' ? ACCENT : 'none', border: `1px solid ${feed.source === 'youtube' ? ACCENT : '#2c2c30'}`, color: feed.source === 'youtube' ? '#fff' : '#888', borderRadius: 999, fontSize: 10, padding: '2px 9px', cursor: 'pointer' }}>YT</button>
        <button type="button" onClick={() => { if (feed.source !== 'bilibili') flashToast(t('header.switching')); feed.setSource('bilibili') }} style={{ background: feed.source === 'bilibili' ? '#00a1d6' : 'none', border: `1px solid ${feed.source === 'bilibili' ? '#00a1d6' : '#2c2c30'}`, color: feed.source === 'bilibili' ? '#fff' : '#888', borderRadius: 999, fontSize: 10, padding: '2px 9px', cursor: 'pointer' }}>B站</button>
        {feed.source === 'youtube' && (
        <span
          title={alive ? t('header.alive') : t('header.dead')}
          style={{ width: 7, height: 7, borderRadius: 999, background: alive ? '#2ecc71' : '#777', display: 'inline-block', cursor: 'help' }}
        />
        )}
        {/* Active keyword chip: shows the selected keyword; click opens the picker */}
        <button
          type="button"
          title={t('header.keywordTip')}
          onClick={() => { setPickerOpen(o => !o) }}
          style={{ background: '#1c2230', border: `1px solid ${pickerOpen ? ACCENT : '#2c3a4c'}`, color: '#cfe3f5', borderRadius: 999, fontSize: 11, fontWeight: 600, padding: '3px 12px', cursor: 'pointer', whiteSpace: 'nowrap', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {feed.activeQuery === '' ? t('header.pickKeyword') : feed.activeQuery}
        </button>
        <button type="button" title={t('header.nextTitle')} onClick={() => { flashToast(t('header.switchingBatch')); feed.refreshVideos() }} style={{ background: '#1c1c1f', border: '1px solid #2c2c30', color: ACCENT, borderRadius: 8, fontSize: 11, padding: '4px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          {t('header.next')}
        </button>
        <button type="button" title={muted ? t('header.unmute') : t('header.mute')} onClick={toggleMute} style={{ background: muted ? '#1c1c1f' : ACCENT, border: `1px solid ${muted ? '#2c2c30' : ACCENT}`, color: muted ? '#aaa' : '#fff', borderRadius: 999, fontSize: 11, fontWeight: 600, padding: '3px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>{muted ? t('header.soundOff') : t('header.soundOn')}</button>
        <button type="button" title={t('header.gear')} onClick={() => { setPanelOpen(o => !o) }} style={{ background: panelOpen ? ACCENT : '#1c1c1f', border: `1px solid ${panelOpen ? ACCENT : '#2c2c30'}`, color: panelOpen ? '#fff' : '#ccc', borderRadius: 999, fontSize: 11, fontWeight: 600, padding: '3px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('header.keywords')}</button>
        <button type="button" title={t('header.prev')} onClick={feed.prev} style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 13, cursor: 'pointer' }}>‹</button>
        <button type="button" title={t('header.nextVideo')} onClick={feed.next} style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 13, cursor: 'pointer' }}>›</button>
        <button type="button" title={t('header.random')} onClick={() => { feed.jumpRandom() }} style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 13, cursor: 'pointer' }}>🎲</button>
        <span style={{ fontSize: 10, color: '#666' }}>{feed.items.length > 0 ? `${feed.idx + 1}/${feed.items.length}` : ''}</span>
      </div>
      {switchToast !== null && (
        <div style={{ position: 'absolute', top: 42, left: '50%', transform: 'translateX(-50%)', background: 'rgba(30,30,34,.94)', border: '1px solid #2c3a4c', borderRadius: 10, fontSize: 11, color: '#cfe3f5', padding: '5px 14px', pointerEvents: 'none', zIndex: 30 }}>{switchToast}</div>
      )}
      {pickerOpen && (
        <KeywordPicker
          entries={feed.source === 'bilibili' ? biliRotation : rotation}
          active={feed.activeQuery}
          onPick={(q) => { setPickerOpen(false); feed.selectQuery(q) }}
          onClose={() => { setPickerOpen(false) }}
        />
      )}
      {panelOpen && (
        feed.source === 'bilibili'
          ? <RotationPanel list={biliRotation} onChange={commitBili} onReset={resetBili} onClose={() => { setPanelOpen(false) }} />
          : <RotationPanel list={rotation} onChange={commit} onReset={reset} onClose={() => { setPanelOpen(false) }} />
      )}
      {feed.ytDown && feed.source === 'youtube' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#3a2a14', color: '#ffd7a1', fontSize: 11, borderBottom: '1px solid #4a3a20' }}>
          <span style={{ flex: 1 }}>{t('err.ytDown')}</span>
          <button type="button" onClick={() => { feed.setSource('bilibili') }} style={{ background: '#00a1d6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 11, padding: '4px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('err.ytDownSwitch')}</button>
        </div>
      )}
      {feed.error !== null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 10px', background: '#3a1418', color: '#ffb4bc', fontSize: 11 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{feed.error}</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => { void feed.reload(feed.mode === 'rotate' ? null : queryInput.trim()) }} style={{ background: 'none', border: 'none', color: '#ffb4bc', cursor: 'pointer', fontSize: 11 }}>{t('err.retry')}</button>
            <button type="button" onClick={feed.dismissError} style={{ background: 'none', border: 'none', color: '#ffb4bc', cursor: 'pointer', fontSize: 11 }}>✕</button>
          </span>
        </div>
      )}

      {/* Body: the current short, 9:16 locked */}
      <div
        style={{ flex: 1, minHeight: 0, position: 'relative' }}
        onWheel={e => {
          if (Math.abs(e.deltaY) < 12) return
          const now = Date.now()
          if (now - lastWheelRef.current < WHEEL_COOLDOWN_MS) return
          lastWheelRef.current = now
          if (e.deltaY > 0) feed.next(); else feed.prev()
        }}
      >
        {loadingInitial
          ? (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#888', fontSize: 12 }}>
              <PlayGlyph size={22} /> {t('common.loading')}
            </div>
            )
          : current === undefined
            ? (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#888', fontSize: 12 }}>
                <span>{t('empty.none')}</span>
                <button type="button" onClick={() => { void feed.reload(null) }} style={{ background: 'none', border: `1px solid ${ACCENT}`, color: ACCENT, borderRadius: 10, fontSize: 12, padding: '6px 18px', cursor: 'pointer' }}>{t('err.retry')}</button>
              </div>
              )
 : card}
      </div>
    </div>
  )
}

/** One full-height 9:16 shorts card: plain iframe + event hook wiring. */
function ShortsCard(props: {
  video: YtVideo
  visible: boolean
  muted: boolean
  onToggleMute: () => void
  onEnded: () => void
  autoSkipRef: { current: number }
  onAliveChange: (alive: boolean) => void
  onOutcome: (ok: boolean) => void
}): ReactNode {
  const { video } = props
  const t = useT()
  const cardRef = useRef<HTMLDivElement | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [hovered, setHovered] = useState(false)

  const videoKey = `${video.videoId}:${attempt}`

  // Error classification: deterministic per-video codes and mid-play errors
  // auto-advance (budgeted); load-phase failures keep the retry overlay.
  // The classification needs events.started, so the advance/fail plumbing
  // below reads it through a ref bridged out of the hook.
  const startedRef = useRef(false)
  const advanceRef = useRef((): void => undefined)
  const handleError = useCallback((code: number): void => {
    props.onOutcome(false)
    const perVideo = code === 2 || code === 5 || code === 100 || code === 101 || code === 150
    if ((perVideo || startedRef.current) && props.autoSkipRef.current < 3) {
      props.autoSkipRef.current += 1
      advanceRef.current()
      return
    }
    setFailed(true)
  }, [props.autoSkipRef, props.onOutcome])

  const events = useYtEmbedEvents(iframeRef, videoKey, { onEnded: props.onEnded, onError: handleError, onAliveChange: props.onAliveChange })
  startedRef.current = events.started
  advanceRef.current = events.advance
  // Report playback outcome for YT-down detection (playing = alive).
  useEffect(() => { if (events.playing) props.onOutcome(true) }, [events.playing])

  const box = useNineBySixteen(cardRef)
  const coverLifted = useCoverLift(videoKey, events.playing)
  const titleVisible = useTitleAutoHide(videoKey)

  // Keep the embed's mute in sync (re-fired when the iframe swaps).
  useEffect(() => { events.setMuted(props.muted) }, [props.muted, box, attempt, events])

  return (
    <div
      ref={cardRef}
      onMouseEnter={() => { setHovered(true) }}
      onMouseLeave={() => { setHovered(false) }}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    >
      {/* Vertical thumbnail underlay (until the player covers it) */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img src={proxyUrl(video.thumbUrl)} alt="" onError={e => { e.currentTarget.style.display = 'none' }} style={{ height: '100%', maxWidth: '100%', objectFit: 'cover', opacity: failed ? 0.25 : 1 }} />
      </div>

      {/* The 9:16 player box, centered — the iframe fills it exactly. */}
      {box !== null && !failed && (
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: box.w, height: box.h, transform: 'translate(-50%, -50%)' }}>
          {!coverLifted && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 2, background: '#000', pointerEvents: 'none' }}>
              <img src={proxyUrl(video.thumbUrl)} alt="" onError={e => { e.currentTarget.style.display = 'none' }} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          )}
          <iframe
            key={videoKey}
            ref={iframeRef}
            src={`https://www.youtube.com/embed/${video.videoId}?autoplay=1&mute=${props.muted ? 1 : 0}&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`}
            title={video.title}
            allow="autoplay; encrypted-media; picture-in-picture"
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          />
          <WheelVeil onLift={() => { window.setTimeout(() => { setHovered(false) }, 6000) }} />
        </div>
      )}
      {failed && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#bbb', fontSize: 12 }}>
          <span>{t('card.failed.yt')}</span>
          <button type="button" onClick={() => { setFailed(false); setAttempt(a => a + 1) }} style={{ background: ACCENT, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 18px', fontSize: 12, cursor: 'pointer' }}>重试</button>
        </div>
      )}

      {/* Sound hint on the muted card */}
      {props.muted && !failed && (
        <button type="button" onClick={props.onToggleMute} style={{ position: 'absolute', left: '50%', bottom: 96, transform: 'translateX(-50%)', background: 'rgba(20,20,24,.82)', color: '#ffd7a1', border: '1px solid rgba(255,215,161,.45)', borderRadius: 999, fontSize: 11, padding: '4px 12px', cursor: 'pointer', zIndex: 4 }}>
          {t('card.muted')}
        </button>
      )}

      {/* Title bar: auto-hides 2s after mount; hover re-shows. The veil's
          lift-gesture also re-shows it (player control = want context). */}
      {(hovered || titleVisible) && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '36px 12px 12px', background: 'linear-gradient(transparent, rgba(0,0,0,.78))', pointerEvents: 'none' }}>
          <div style={{ fontSize: 12, color: '#eee', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{video.title}</div>
          <div style={{ fontSize: 10, color: '#999', marginTop: 3 }}>{video.authorName} · YouTube Shorts</div>
        </div>
      )}
    </div>
  )
}

/** Transparent veil over the iframe: wheel-catcher + click-to-reveal. */
function WheelVeil(props: { onLift: () => void }): ReactNode {
  const [lifted, setLifted] = useState(false)
  return (
    <div
      onWheel={e => { e.preventDefault() }}
      onClick={() => { setLifted(true); props.onLift(); window.setTimeout(() => { setLifted(false) }, 6000) }}
      style={{ position: 'absolute', inset: 0, zIndex: 4, background: lifted ? 'transparent' : 'rgba(0,0,0,0.001)', cursor: 'pointer', pointerEvents: lifted ? 'none' : 'auto' }}
    />
  )
}

/** ⚙ panel: manage the rotation list (region label + query per row). */
function RotationPanel(props: {
  list: RotatedEntry[]
  onChange: (list: RotatedEntry[]) => void
  onReset: () => void
  onClose: () => void
}): ReactNode {
  const t = useT()
  const [region, setRegion] = useState('')
  const [query, setQuery] = useState('')
  const [batch, setBatch] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const isEnLocale = isEn()
  const add = (): void => {
    const q = query.trim()
    if (q === '') return
    props.onChange([...props.list, { query: q, region: region.trim() === '' ? t('panel.custom') : region.trim() }])
    setRegion('')
    setQuery('')
  }
  const flash = (msg: string): void => {
    setToast(msg)
    window.setTimeout(() => { setToast(null) }, 1800)
  }
  /** Append a preset pack (dedup by query). */
  const appendPack = (pack: PresetPack): void => {
    const seen = new Set(props.list.map(e => e.query))
    const fresh = pack.entries.filter(e => !seen.has(e.query))
    if (fresh.length === 0) { flash(t('panel.imported', 0)); return }
    props.onChange([...props.list, ...fresh])
    flash(t('panel.imported', fresh.length))
  }
  /** Import the batch textarea: one `keyword | region` per line. */
  const importBatch = (): void => {
    const lines = batch.split('\n').map(l => l.trim()).filter(l => l !== '')
    const parsed: RotatedEntry[] = []
    for (const line of lines) {
      const [q, r] = line.split('|').map(x => x.trim())
      if (q !== undefined && q !== '') parsed.push({ query: q, region: r !== undefined && r !== '' ? r : t('panel.custom') })
    }
    if (parsed.length === 0) return
    const seen = new Set(props.list.map(e => e.query))
    const fresh = parsed.filter(e => !seen.has(e.query))
    props.onChange([...props.list, ...fresh])
    setBatch('')
    flash(t('panel.imported', fresh.length))
  }
  return (
    <div style={{ background: '#15151a', borderBottom: '1px solid #222', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#aaa' }}>
        <span>{t('panel.title')}</span>
        <button type="button" onClick={props.onReset} style={{ background: 'none', border: 'none', color: '#888', fontSize: 10, cursor: 'pointer' }}>{t('panel.reset')}</button>
        <span style={{ flex: 1 }} />
        {toast !== null && <span style={{ fontSize: 10, color: '#8be08b' }}>{toast}</span>}
        <button type="button" onClick={props.onClose} style={{ background: 'none', border: 'none', color: '#888', fontSize: 11, cursor: 'pointer' }}>✕</button>
      </div>
      {/* Preset packs: one click replaces the list; ＋ appends (dedup). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: '#777' }}>{t('panel.presets')}</span>
        {PRESET_PACKS.map(pack => (
          <span key={pack.id} style={{ display: 'inline-flex', border: '1px solid #2c3a4c', borderRadius: 8, overflow: 'hidden' }}>
            <button type="button" title={pack.entries.map(e => e.query).join(' · ')} onClick={() => { props.onChange([...pack.entries]); flash(t('panel.imported', pack.entries.length)) }} style={{ background: '#1a2532', border: 'none', color: '#9cc3e5', fontSize: 10, padding: '3px 8px', cursor: 'pointer' }}>
              {isEnLocale ? pack.name.en : pack.name.zh}
            </button>
            <button type="button" title={t('panel.append')} onClick={() => { appendPack(pack) }} style={{ background: '#16202b', border: 'none', color: '#5d84a3', fontSize: 10, padding: '3px 6px', cursor: 'pointer' }}>＋</button>
          </span>
        ))}
      </div>
      {/* Batch import: paste `keyword | region` lines. */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <textarea value={batch} onChange={e => { setBatch(e.target.value) }} placeholder={t('panel.batchPh')} rows={2} style={{ flex: 1, minWidth: 0, background: '#111418', border: '1px dashed #2c2c30', borderRadius: 6, color: '#eee', fontSize: 10, padding: '4px 6px', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }} />
        <button type="button" onClick={importBatch} style={{ background: '#1c1c1f', border: '1px solid #2c2c30', color: ACCENT, borderRadius: 6, fontSize: 10, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('panel.import')}</button>
      </div>
      {props.list.map((entry, i) => (
        <div key={`${i}:${entry.query}`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input value={entry.region} onChange={e => { const next = [...props.list]; next[i] = { ...entry, region: e.target.value }; props.onChange(next) }} style={{ width: 86, background: '#1c1c1f', border: '1px solid #2c2c30', borderRadius: 6, color: '#ffd7a1', fontSize: 10, padding: '3px 6px', outline: 'none' }} />
          <input value={entry.query} onChange={e => { const next = [...props.list]; next[i] = { ...entry, query: e.target.value }; props.onChange(next) }} style={{ flex: 1, minWidth: 0, background: '#1c1c1f', border: '1px solid #2c2c30', borderRadius: 6, color: '#eee', fontSize: 10, padding: '3px 6px', outline: 'none' }} />
          <button type="button" title={t('panel.up')} onClick={() => { if (i === 0) return; const next = [...props.list]; [next[i - 1], next[i]] = [next[i]!, next[i - 1]!]; props.onChange(next) }} style={{ background: 'none', border: 'none', color: '#666', fontSize: 10, cursor: 'pointer' }}>↑</button>
          <button type="button" title={t('panel.del')} onClick={() => { props.onChange(props.list.filter((_, j) => j !== i)) }} style={{ background: 'none', border: 'none', color: '#a66', fontSize: 10, cursor: 'pointer' }}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input value={region} onChange={e => { setRegion(e.target.value) }} placeholder={t('panel.region')} style={{ width: 86, background: '#111418', border: '1px dashed #2c2c30', borderRadius: 6, color: '#ffd7a1', fontSize: 10, padding: '3px 6px', outline: 'none' }} />
        <input value={query} onChange={e => { setQuery(e.target.value) }} onKeyDown={e => { if (e.key === 'Enter') add() }} placeholder={t('panel.query')} style={{ flex: 1, minWidth: 0, background: '#111418', border: '1px dashed #2c2c30', borderRadius: 6, color: '#eee', fontSize: 10, padding: '3px 6px', outline: 'none' }} />
        <button type="button" onClick={add} style={{ background: '#1c1c1f', border: '1px solid #2c2c30', color: ACCENT, borderRadius: 6, fontSize: 10, padding: '3px 10px', cursor: 'pointer' }}>{t('panel.add')}</button>
      </div>
    </div>
  )
}

/** One full-height 9:16 bilibili shorts card: NATIVE <video> playback —
 *  mp4 through the host proxy, real ended/error events (no iframe, no
 *  postMessage, no watchdog). Streams resolve lazily when the card mounts,
 *  with candidate fallthrough on playback errors. */
function BiliCard(props: {
  short: import('../bilibili-shorts.ts').BiliShort
  visible: boolean
  muted: boolean
  onToggleMute: () => void
  onEnded: () => void
  autoSkipRef: { current: number }
}): ReactNode {
  const { short } = props
  const t = useT()
  const cardRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const box = useNineBySixteen(cardRef)
  const [urls, setUrls] = useState<string[] | undefined>(undefined)
  const [candidate, setCandidate] = useState(0)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [playing, setPlaying] = useState(false)
  const startedRef = useRef(false)

  // Lazy stream resolution (idempotent via attempt key).
  const playKey = `${short.bvid}:${attempt}`
  useEffect(() => {
    let disposed = false
    setUrls(undefined)
    setCandidate(0)
    setFailed(false)
    setPlaying(false)
    startedRef.current = false
    void fetchBiliPlay(short.bvid, short.cid)
      .then((u) => { if (!disposed) setUrls(u) })
      .catch(() => { if (!disposed) setFailed(true) })
    return () => { disposed = true }
  }, [playKey, short.bvid, short.cid])

  // Playback conductor: exactly this card plays while visible.
  useEffect(() => {
    const v = videoRef.current
    if (v === null) return
    if (props.visible) {
      v.muted = props.muted
      try { void Promise.resolve(v.play()).catch(() => undefined) } catch { /* autoplay refused */ }
    } else {
      v.pause()
    }
  }, [urls, candidate, props.visible, props.muted])

  const exhausted = urls !== undefined && candidate >= urls.length
  const src = !exhausted && urls !== undefined
    ? proxyUrl(urls[candidate] ?? urls[0] ?? '')
    : undefined

  const durationLabel = short.durationSec > 0
    ? `${Math.floor(short.durationSec / 60)}:${String(short.durationSec % 60).padStart(2, '0')}`
    : ''

  return (
    <div ref={cardRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {/* Cover underlay until the stream is ready; REMOVED once ready (an
          opacity-0 overlay would still swallow the video's pause clicks). */}
      {short.coverUrl !== '' && src === undefined && (
        <img src={proxyUrl(short.coverUrl.replace(/^http:/, 'https:'))} alt="" onError={e => { e.currentTarget.style.display = 'none' }} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      )}
      {src !== undefined && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
        <video
          ref={videoRef}
          src={src}
          playsInline
          style={{ ...(box !== null ? { width: box.w, height: box.h } : { width: '100%', height: '100%' }), objectFit: 'contain', background: '#000', display: 'block', maxWidth: '100%', maxHeight: '100%' }}
          onClick={e => { const el = e.currentTarget; if (el.paused) { try { void Promise.resolve(el.play()).catch(() => undefined) } catch { /* refused */ } } else el.pause() }}
          onPlay={() => { startedRef.current = true; setPlaying(true) }}
          onPause={() => { setPlaying(false) }}
          onEnded={props.onEnded}
          onError={() => {
            // Candidate fallthrough; deterministic exhaustion keeps the
            // retry overlay (auto-advance only for mid-play failures).
            if (candidate + 1 < (urls?.length ?? 0)) setCandidate(candidate + 1)
            else if (startedRef.current && props.autoSkipRef.current < 3) {
              props.autoSkipRef.current += 1
              props.onEnded()
            } else setFailed(true)
          }}
        />
        </div>
      )}
      {urls === undefined && !failed && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#888', fontSize: 12 }}>
          <PlayGlyph size={20} /> 取流中…
        </div>
      )}
      {failed && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#bbb', fontSize: 12 }}>
          <span>{t('card.failed.bili')}</span>
          <button type="button" onClick={() => { setFailed(false); setAttempt(a => a + 1) }} style={{ background: '#00a1d6', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 18px', fontSize: 12, cursor: 'pointer' }}>重试</button>
        </div>
      )}
      {!playing && <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 60, background: 'linear-gradient(transparent, rgba(0,0,0,.6))', pointerEvents: 'none' }} />}
      {props.muted && src !== undefined && (
        <button type="button" onClick={props.onToggleMute} style={{ position: 'absolute', left: '50%', bottom: 96, transform: 'translateX(-50%)', background: 'rgba(20,20,24,.82)', color: '#ffd7a1', border: '1px solid rgba(255,215,161,.45)', borderRadius: 999, fontSize: 11, padding: '4px 12px', cursor: 'pointer', zIndex: 4 }}>
          {t('card.muted')}
        </button>
      )}
      {/* Title bar: shows until playback starts, then fades (hover re-shows). */}
      <TitleBar title={short.title} author={`${short.authorName} · B站竖屏`} playing={playing} extra={durationLabel} />
    </div>
  )
}

/** Shared bottom title bar (auto-hides once playing; hover re-shows). */
function TitleBar(props: { title: string; author: string; playing: boolean; extra?: string }): ReactNode {
  const [visible, setVisible] = useState(true)
  const [hovered, setHovered] = useState(false)
  useEffect(() => {
    if (!props.playing) { setVisible(true); return }
    const t = window.setTimeout(() => { setVisible(false) }, 1500)
    return () => { window.clearTimeout(t) }
  }, [props.playing])
  return (
    <div
      onMouseEnter={() => { setHovered(true) }}
      onMouseLeave={() => { setHovered(false) }}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '36px 12px 12px', background: 'linear-gradient(transparent, rgba(0,0,0,.78))', pointerEvents: 'none' }}
    >
      {(hovered || visible) && (
        <>
          <div style={{ fontSize: 12, color: '#eee', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{props.title}</div>
          <div style={{ fontSize: 10, color: '#999', marginTop: 3 }}>{props.author}{props.extra !== undefined && props.extra !== '' ? ` · ${props.extra}` : ''}</div>
        </>
      )}
    </div>
  )
}

/** Keyword picker: the current source's rotation list as clickable chips —
 *  one click selects the keyword and reloads the feed under it. */
function KeywordPicker(props: {
  entries: RotatedEntry[]
  active: string
  onPick: (query: string) => void
  onClose: () => void
}): ReactNode {
  const t = useT()
  return (
    <div style={{ background: '#15151a', borderBottom: '1px solid #222', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#aaa' }}>
        <span>{t('header.pickKeyword')}</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={props.onClose} style={{ background: 'none', border: 'none', color: '#888', fontSize: 11, cursor: 'pointer' }}>✕</button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {props.entries.map(entry => {
          const isActive = entry.query === props.active
          return (
            <button
              key={entry.query}
              type="button"
              title={entry.region}
              onClick={() => { props.onPick(entry.query) }}
              style={{
                background: isActive ? ACCENT : '#1c2230',
                border: `1px solid ${isActive ? ACCENT : '#2c3a4c'}`,
                color: isActive ? '#fff' : '#cfe3f5',
                borderRadius: 999, fontSize: 11, padding: '4px 12px', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {entry.query}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** ── Floating window shell ────────────────────────────────────────────────
 *  A self-contained window mounted on document.body: FLOAT mode is a
 *  draggable 9:16-ish panel; STICK mode docks it to the right screen edge
 *  as a slim rail (click the rail tab to expand). State persists in
 *  localStorage. The feed itself renders inside unchanged. */

const SHELL_LS = 'dsh-shorts-wall:shell'

interface ShellState {
  mode: 'float' | 'stick' | 'closed'
  x: number
  y: number
  sizeW: number
  sizeH: number
}

const SHELL_DEFAULT: ShellState = { mode: 'float', x: 0, y: 0, sizeW: 420, sizeH: 760 }

function loadShell(): ShellState {
  try {
    const raw = localStorage.getItem(SHELL_LS)
    if (raw === null) return { ...SHELL_DEFAULT }
    const parsed = JSON.parse(raw) as Partial<ShellState>
    return {
      mode: parsed.mode === 'stick' || parsed.mode === 'closed' || parsed.mode === 'float' ? parsed.mode : 'float',
      x: typeof parsed.x === 'number' ? parsed.x : 0,
      y: typeof parsed.y === 'number' ? parsed.y : 0,
      sizeW: typeof parsed.sizeW === 'number' && parsed.sizeW >= 300 ? parsed.sizeW : SHELL_DEFAULT.sizeW,
      sizeH: typeof parsed.sizeH === 'number' && parsed.sizeH >= 400 ? parsed.sizeH : SHELL_DEFAULT.sizeH,
    }
  } catch {
    return { ...SHELL_DEFAULT }
  }
}

function saveShell(st: ShellState): void {
  try { localStorage.setItem(SHELL_LS, JSON.stringify(st)) } catch { /* optional */ }
}

/** The persistent shell: ONE ShortsFeed stays mounted for the whole
 *  session (mode switches only re-style/re-position the container — the
 *  video keeps playing). Modes: float (draggable window) · stick (right-edge
 *  rail + click-to-expand overlay) · minimized (launcher button). The boss
 *  key Alt+S toggles minimized/restore globally. */
function FloatingShell(): ReactNode {
  const t = useT()
  const [shell, setShell] = useState<ShellState>(loadShell)
  const [stuckOpen, setStuckOpen] = useState(false)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  /** The always-mounted feed container (moved between mode containers via
   *  a single parent — React keeps the subtree alive across re-renders). */
  const minimized = shell.mode === 'closed'
  const floating = shell.mode === 'float'

  const update = useCallback((patch: Partial<ShellState>): void => {
    setShell((prev) => {
      const next = { ...prev, ...patch }
      saveShell(next)
      return next
    })
  }, [])

  // Boss key: Alt+S toggles minimize/restore (restore → float).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        setShell((prev) => {
          const next: ShellState = prev.mode === 'closed'
            ? { ...prev, mode: 'float' }
            : { ...prev, mode: 'closed' }
          saveShell(next)
          return next
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [])

  // Global drag handlers (float mode).
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const d = dragRef.current
      if (d === null) return
      const maxX = window.innerWidth - 120
      const maxY = window.innerHeight - 60
      update({ x: Math.min(Math.max(e.clientX - d.dx, 0), maxX), y: Math.min(Math.max(e.clientY - d.dy, 0), maxY) })
      if (e.clientX > window.innerWidth - 24) {
        dragRef.current = null
        update({ mode: 'stick' })
      }
    }
    const onUp = (): void => { dragRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [update])

  // The feed subtree — declared once so React reuses it in every mode.
  const feedNode = <div style={{ flex: 1, minHeight: 0, position: 'relative' }}><ShortsFeed visible={!minimized} /></div>

  // Minimized: launcher pill (bottom-right); the feed stays mounted but the
  // window is display:none — audio pauses via visible=false through the feed.
  if (minimized) {
    return (
      <>
        <button
          type="button"
          title={t('shell.open') + ' (Alt+S)'}
          onClick={() => { update({ mode: 'float' }) }}
          style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 2147483000, width: 44, height: 44, borderRadius: 999, background: ACCENT, color: '#fff', border: 'none', cursor: 'pointer', boxShadow: '0 8px 30px rgba(0,0,0,.5)' }}
        >
          <PlayGlyph size={20} />
        </button>
        <div style={{ display: 'none' }}>{feedNode}</div>
      </>
    )
  }

  // Stick mode: slim right-edge rail; click toggles the overlay (the feed
  // lives inside the overlay, kept mounted even when collapsed).
  if (shell.mode === 'stick') {
    return (
      <>
        <button
          type="button"
          title={t('shell.expand') + ' (Alt+S 最小化)'}
          onClick={() => { setStuckOpen(true) }}
          style={{ position: 'fixed', right: 0, top: '40%', zIndex: 2147483000, writingMode: 'vertical-rl', padding: '14px 8px', background: ACCENT, color: '#fff', border: 'none', borderRadius: '10px 0 0 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700, letterSpacing: 2 }}
        >
          Shorts
        </button>
        <div
          ref={shellRef}
          style={{
            position: 'fixed', right: 12, top: '6%', bottom: '6%',
            width: Math.min(430, window.innerWidth - 48), zIndex: 2147483000,
            background: '#000', borderRadius: 14, overflow: 'hidden',
            boxShadow: '0 24px 80px rgba(0,0,0,.8)', display: 'flex', flexDirection: 'column',
            // Collapsed = visually hidden but MOUNTED: playback continuity.
            visibility: stuckOpen ? 'visible' : 'hidden', pointerEvents: stuckOpen ? 'auto' : 'none',
          }}
        >
          <ShellBar t={t} mode="stick" onFloat={() => { update({ mode: 'float', x: Math.max(40, window.innerWidth - 460), y: 60 }) }} onMinimize={() => { setStuckOpen(false); update({ mode: 'closed' }) }} />
          {feedNode}
        </div>
      </>
    )
  }

  // Float mode.
  const left = shell.x === 0 && shell.y === 0 ? undefined : shell.x
  const top = shell.y === 0 && shell.x === 0 ? undefined : shell.y
  return (
    <div
      ref={shellRef}
      style={{
        position: 'fixed',
        ...(left !== undefined ? { left } : { right: 24 }),
        ...(top !== undefined ? { top } : { top: 72 }),
        width: shell.sizeW,
        height: shell.sizeH,
        maxHeight: 'calc(100vh - 48px)',
        zIndex: 2147483000,
        background: '#000',
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,.8)',
        display: 'flex',
        flexDirection: 'column',
        resize: 'both',
      }}
    >
      <div
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button') !== null) return
          dragRef.current = { dx: e.clientX - (shellRef.current?.offsetLeft ?? 0), dy: e.clientY - (shellRef.current?.offsetTop ?? 0) }
        }}
        onDoubleClick={() => { update({ mode: 'stick' }) }}
        style={{ cursor: 'grab', userSelect: 'none' }}
      >
        <ShellBar t={t} mode="float" onStick={() => { update({ mode: 'stick' }) }} onMinimize={() => { update({ mode: 'closed' }) }} />
      </div>
      {feedNode}
    </div>
  )
}

/** Title bar: drag handle (float) + mode buttons (stick/float · minimize · close). */
function ShellBar(props: { t: (k: string) => string; mode: 'float' | 'stick'; onStick?: () => void; onFloat?: () => void; onMinimize: () => void }): ReactNode {
  const { t } = props
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: '#14141a', borderBottom: '1px solid #222', cursor: 'inherit' }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: ACCENT, flex: 1 }}>Shorts</span>
      {props.mode === 'float' && props.onStick !== undefined && (
        <button type="button" title={t('shell.stick')} onClick={props.onStick} style={barBtn}>📌</button>
      )}
      {props.mode === 'stick' && props.onFloat !== undefined && (
        <button type="button" title={t('shell.float')} onClick={props.onFloat} style={barBtn}>🪟</button>
      )}
      <button type="button" title={t('shell.minimize') + ' (Alt+S)'} onClick={props.onMinimize} style={barBtn}>─</button>
    </div>
  )
}

const barBtn = { background: 'none', border: 'none', color: '#999', fontSize: 13, cursor: 'pointer', padding: '2px 4px' } as const
