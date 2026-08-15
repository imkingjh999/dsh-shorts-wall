/**
 * UI i18n for the shorts tab: zh/en dictionaries registered into the DSH
 * locale service (follows the host language setting, switches live). The
 * service is captured from a dynamic inject in apply(); when absent the
 * hook falls back to the navigator language so the tab still renders.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

/** Structural subset of the DSH client locale service this plugin uses
 *  (method names match LocaleRuntime: getLocale / subscribe / register). */
export interface LocaleService {
  register(ns: string, locale: string, dict: Record<string, string>): () => void
  bind(ns: string): (key: string, ...args: unknown[]) => string
  getLocale(): { active: string; revision: number }
  subscribe(listener: () => void): () => void
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'shorts.sidebar'

const zh: Record<string, string> = {
  // header
  'header.build': '构建',
  'header.alive': '事件通道已连接（自动连播可用）',
  'header.dead': '事件通道未连接（看门狗保底推进）',
  'header.ph.bili': 'B站竖屏搜索（当前「{0}」）回车换词',
  'header.ph.rotate': '轮换中 · 当前「{0}」回车固定',
  'header.ph.fixed': '固定词模式 · 回车重新搜索',
  'header.next': '换一批视频',
  'header.nextTitle': '同关键词重新取一批视频',
  'header.regionTip': '当前批次关键词：{0}',
  'header.gear': '管理轮换词表',
  'header.unmute': '开启声音',
  'header.mute': '静音',
  'header.soundOn': '声音开',
  'header.soundOff': '已静音',
  'header.keywords': '关键词',
  'header.pickKeyword': '选择关键词',
  'shell.open': '打开 Shorts',
  'shell.close': '收起窗口',
  'shell.stick': '贴边（吸右缘）',
  'shell.float': '浮窗模式',
  'shell.expand': '展开 Shorts',
  'header.switching': '切换中…',
  'header.switchingBatch': '换一批中…',
  'header.keywordTip': '点击切换关键词',
  'header.prev': '上一条（滚轮上 / ↑）',
  'header.random': '随机跳一条',
  'header.nextVideo': '下一条（滚轮下 / ↓）',
  // errors / empty
  'err.load': '列表加载失败',
  'err.noShorts': '没有搜到 Shorts，换个词试试',
  'err.noVertical': '没有搜到竖屏视频，换个词试试',
  'err.retry': '重试',
  'err.ytDown': 'YouTube 暂不可用（连接被限制），可稍后再试',
  'err.ytDownSwitch': '切到 B站',
  'empty.none': '没有内容',
  'common.loading': '加载中…',
  'card.muted': '已静音 · 点此开启声音',
  'card.failed.yt': '这条播放失败（网络或限制）',
  'card.failed.bili': '这条播放失败（已下架或限制）',
  'card.fetching': '取流中…',
  'card.src.yt': 'YouTube Shorts',
  'card.src.bili': 'B站竖屏',
  // rotation panel
  'panel.title': '轮换词表（换一批按此顺序循环）',
  'panel.reset': '恢复默认',
  'panel.region': '地区标签',
  'panel.query': '关键词（如 fancam kpop girls dance）回车添加',
  'panel.add': '＋ 添加',
  'panel.up': '上移',
  'panel.del': '删除',
  'panel.custom': '📌 自定义',
  'panel.presets': '预设词库（点击替换 · 追加）',
  'panel.append': '追加',
  'panel.replace': '替换',
  'panel.batchPh': '自定义：每行一个 · 格式 关键词 | 地区\n粘贴后点导入',
  'panel.import': '导入',
  'panel.imported': '已导入 {0} 条',
}

const en: Record<string, string> = {
  'header.build': 'build',
  'header.alive': 'Event channel connected (auto-advance active)',
  'header.dead': 'Event channel down (watchdog drives advancing)',
  'header.ph.bili': 'Bilibili vertical search (now “{0}”) · Enter to change',
  'header.ph.rotate': 'Rotating · now “{0}” · Enter to pin',
  'header.ph.fixed': 'Pinned keyword · Enter to search again',
  'header.next': 'More videos',
  'header.nextTitle': 'Fetch a fresh batch under the same keyword',
  'header.regionTip': 'Current batch keyword: {0}',
  'header.gear': 'Manage rotation list',
  'header.unmute': 'Unmute',
  'header.mute': 'Mute',
  'header.soundOn': 'Sound on',
  'header.soundOff': 'Muted',
  'header.keywords': 'Keywords',
  'header.pickKeyword': 'Pick a keyword',
  'shell.open': 'Open Shorts',
  'shell.close': 'Close window',
  'shell.stick': 'Stick to edge',
  'shell.float': 'Float mode',
  'shell.expand': 'Expand Shorts',
  'header.switching': 'Switching…',
  'header.switchingBatch': 'Fetching a new batch…',
  'header.keywordTip': 'Click to switch keyword',
  'header.prev': 'Previous (wheel up / ↑)',
  'header.random': 'Random jump',
  'header.nextVideo': 'Next (wheel down / ↓)',
  'err.load': 'Failed to load the list',
  'err.noShorts': 'No Shorts found — try another keyword',
  'err.noVertical': 'No vertical videos found — try another keyword',
  'err.retry': 'Retry',
  'err.ytDown': 'YouTube is unavailable right now (restricted) — try again later',
  'err.ytDownSwitch': 'Switch to Bilibili',
  'empty.none': 'Nothing here',
  'common.loading': 'Loading…',
  'card.muted': 'Muted · click for sound',
  'card.failed.yt': 'This video failed (network or restriction)',
  'card.failed.bili': 'This video failed (removed or restricted)',
  'card.fetching': 'Fetching stream…',
  'card.src.yt': 'YouTube Shorts',
  'card.src.bili': 'Bilibili vertical',
  'panel.title': 'Rotation list (Next cycles through it in order)',
  'panel.reset': 'Reset to defaults',
  'panel.region': 'Region label',
  'panel.query': 'Keyword (e.g. fancam kpop girls dance) · Enter to add',
  'panel.add': '＋ Add',
  'panel.up': 'Move up',
  'panel.del': 'Delete',
  'panel.custom': '📌 Custom',
  'panel.presets': 'Preset packs (click to replace · append)',
  'panel.append': 'Append',
  'panel.replace': 'Replace',
  'panel.batchPh': 'Custom: one per line · format keyword | region\nPaste then import',
  'panel.import': 'Import',
  'panel.imported': 'Imported {0} entries',
}

/** All locales under this namespace. */
export const LOCALES: Record<string, Record<string, string>> = { zh, en }

/** One preset rotation pack: a themed, ready-to-use keyword list. */
export interface PresetPack {
  id: string
  /** Localized display name (zh/en). */
  name: { zh: string; en: string }
  /** The pack's entries (region labels are locale-neutral). */
  entries: { query: string; region: string }[]
}

/** Built-in preset packs — verified anonymously searchable on both sources
 *  (YT yields noted; bilibili accepts any Chinese keyword). */
export const PRESET_PACKS: readonly PresetPack[] = [
  {
    id: 'kpop',
    name: { zh: 'KPOP 直拍', en: 'KPOP fancam' },
    entries: [
      { query: 'fancam kpop girls dance', region: '🎤 KPOP' },
      { query: 'kpop fancam', region: '🎤 KPOP' },
      { query: 'dance cover kpop', region: '💃 翻跳' },
      { query: '比基尼 舞蹈', region: '🇨🇳 舞蹈' },
      { query: '美女 舞蹈', region: '🇨🇳 舞蹈' },
    ],
  },
  {
    id: 'fashion',
    name: { zh: '服饰穿搭', en: 'Fashion' },
    entries: [
      { query: 'try on haul', region: '🛍️ 试穿' },
      { query: 'outfit ideas', region: '👗 穿搭' },
      { query: 'ootd fashion', region: '👠 OOTD' },
      { query: '服装 搭配', region: '🇨🇳 搭配' },
      { query: 'outfit swap', region: '🔄 换装' },
      { query: 'get ready with me', region: '💄 GRWM' },
    ],
  },
  {
    id: 'costume',
    name: { zh: '特色服饰', en: 'Costume' },
    entries: [
      { query: 'hanfu girl', region: '🏮 汉服' },
      { query: '汉服', region: '🏮 汉服' },
      { query: 'hanbok fashion', region: '🇰🇷 韩服' },
      { query: 'jk 制服', region: '📕 JK' },
      { query: 'uniform fashion', region: '🎽 制服' },
      { query: 'cos 小姐姐', region: '🎭 COS' },
    ],
  },
  {
    id: 'pets',
    name: { zh: '宠物萌宠', en: 'Pets' },
    entries: [
      { query: 'cat mom', region: '🐱 猫' },
      { query: 'pet girl', region: '🐶 宠物' },
      { query: '猫咪 日常', region: '🐱 日常' },
      { query: '狗狗 日常', region: '🐶 日常' },
      { query: '可爱 宠物', region: '🐾 萌宠' },
    ],
  },
  {
    id: 'pov',
    name: { zh: '性别视角', en: 'POV' },
    entries: [
      { query: 'boyfriend pov', region: '💘 视角' },
      { query: 'gym girl', region: '💪 健身' },
      { query: '小姐姐 街拍', region: '📷 街拍' },
      { query: '男生 视角', region: '👁️ 视角' },
      { query: 'first date', region: '💕 约会' },
    ],
  },
  {
    id: 'beach',
    name: { zh: '沙滩泳装', en: 'Beach & swimwear' },
    entries: [
      { query: 'bikini beach', region: '🏖️ Beach' },
      { query: '沙滩 比基尼', region: '🏖️ 沙滩' },
      { query: '泳装 写真', region: '🩱 泳装' },
      { query: 'swimwear model', region: '🩱 Model' },
      { query: '比基尼 走秀', region: '👙 走秀' },
    ],
  },
  {
    id: 'stage',
    name: { zh: '舞台演出', en: 'Stage' },
    entries: [
      { query: 'stage performance', region: '🎭 Stage' },
      { query: '音乐节 舞台', region: '🎸 音乐节' },
      { query: 'stage dance', region: '💫 舞台' },
      { query: '女团 舞台', region: '💖 女团' },
    ],
  },
]

/** Captured locale service (set from apply's dynamic inject). */
let service: LocaleService | undefined

/** Attach the live locale service and register the dictionaries. */
export function attachLocale(locale: LocaleService): () => void {
  service = locale
  const disposers = Object.entries(LOCALES).map(([id, dict]) => locale.register(NS, id, dict))
  return () => {
    for (const off of disposers) off()
    if (service === locale) service = undefined
  }
}

/** Simple {0}/{1} substitution. */
function format(template: string, args: unknown[]): string {
  return template.replaceAll(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''))
}

/** Translate a key in the active language (module-level, non-reactive). */
export function tr(key: string, ...args: unknown[]): string {
  const active = service?.getLocale().active
  const dict = active !== undefined && active !== 'zh' ? (LOCALES[active] ?? en) : zh
  return format(dict[key] ?? zh[key] ?? key, args)
}

/** Whether the active UI language is English (used for source labels). */
export function isEn(): boolean {
  const active = service?.getLocale().active
  if (active !== undefined) return active !== 'zh'
  return (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('en'))
}

/**
 * Reactive translate hook: re-renders on locale switches. Returns a `t`
 * bound to the current language.
 */
export function useT(): (key: string, ...args: unknown[]) => string {
  const [revision, setRevision] = useState(() => service?.getLocale().revision ?? 0)
  useEffect(() => {
    if (service === undefined) return
    const off = service.subscribe(() => { setRevision(service?.getLocale().revision ?? 0) })
    return () => { off() }
  }, [])
  return (key: string, ...args: unknown[]): string => {
    void revision // dependency: re-created when the revision bumps
    return tr(key, ...args)
  }
}
