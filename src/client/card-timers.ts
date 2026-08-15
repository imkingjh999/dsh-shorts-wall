/**
 * UI timing hooks for the shorts card: the cover that hides the embed's
 * paused-overlay chrome (1s) and the title auto-hide (2s). Both run from
 * card MOUNT — one-shot per video, deliberately independent of player
 * events (dead event channels must never freeze the UI chrome).
 */
import { useEffect, useState } from 'react'

/** Lift the cover 1s after mount unless PLAYING arrives first (the video
 *  itself replaces the thumbnail). Never re-covers for the same video. */
export function useCoverLift(videoKey: string, playing: boolean): boolean {
  // playing=true → cover off immediately and permanently.
  const [coverTimedOut, setCoverTimedOut] = useState(false)
  useEffect(() => {
    if (playing) {
      setCoverTimedOut(true)
      return
    }
    const t = window.setTimeout(() => { setCoverTimedOut(true) }, 1000)
    return () => { window.clearTimeout(t) }
  }, [videoKey, playing])
  return coverTimedOut || playing
}

/** Hide the title bar 2s after mount (hover re-shows is the caller's job). */
export function useTitleAutoHide(videoKey: string): boolean {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    setVisible(true)
    const t = window.setTimeout(() => { setVisible(false) }, 2000)
    return () => { window.clearTimeout(t) }
  }, [videoKey])
  return visible
}

/** Fit the largest 9:16 rectangle inside the card, recomputed on resize. */
export function useNineBySixteen(
  cardRef: React.RefObject<HTMLDivElement | null>,
): { w: number; h: number } | null {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const el = cardRef.current
    if (el === null) return
    const measure = (): void => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (w === 0 || h === 0) return
      const vw = Math.min(w, (h * 9) / 16)
      setBox({ w: Math.round(vw), h: Math.round((vw * 16) / 9) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => { ro.disconnect() }
  }, [cardRef])
  return box
}
