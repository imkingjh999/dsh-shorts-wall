/**
 * User-managed keyword rotation lists, persisted separately per source.
 */
import { useCallback, useState } from "react";
import { BIKINI_QUERIES } from "../youtube.ts";

const ROTATION_KEY = "dsh-bilibili-sidebar:rotation";
const BILI_ROTATION_KEY = "dsh-bilibili-sidebar:rotation:bili";

/** Default bilibili keywords (rotatable — users add their own in ⚙). */
export const BILI_DEFAULT_ROTATION: readonly RotatedEntry[] = [
  { query: "美女 舞蹈", region: "🇨🇳 舞蹈" },
  { query: "服装 搭配", region: "👗 搭配" },
  { query: "cos 小姐姐", region: "🎭 COS" },
];

export interface RotatedEntry {
  query: string;
  region: string;
}

function loadRotationOf(key: string, defaults: readonly RotatedEntry[]): RotatedEntry[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return [...defaults];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...defaults];
    return parsed.filter(
      (x): x is RotatedEntry =>
        typeof x === "object" &&
        x !== null &&
        typeof (x as Record<string, unknown>)["query"] === "string" &&
        (x as Record<string, unknown>)["query"] !== "",
    );
  } catch {
    return [...defaults];
  }
}

function saveRotationTo(key: string, list: RotatedEntry[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* optional */
  }
}

/** User-managed rotation lists (editable through the ⚙ panel), one per source. */
export function useRotation(): {
  rotation: RotatedEntry[];
  biliRotation: RotatedEntry[];
  commit: (list: RotatedEntry[]) => void;
  commitBili: (list: RotatedEntry[]) => void;
  reset: () => void;
  resetBili: () => void;
} {
  const [rotation, setRotation] = useState<RotatedEntry[]>(() =>
    loadRotationOf(ROTATION_KEY, BIKINI_QUERIES),
  );
  const [biliRotation, setBiliRotation] = useState<RotatedEntry[]>(() =>
    loadRotationOf(BILI_ROTATION_KEY, BILI_DEFAULT_ROTATION),
  );
  const commit = useCallback((list: RotatedEntry[]): void => {
    setRotation(list);
    saveRotationTo(ROTATION_KEY, list);
  }, []);
  const commitBili = useCallback((list: RotatedEntry[]): void => {
    setBiliRotation(list);
    saveRotationTo(BILI_ROTATION_KEY, list);
  }, []);
  const reset = useCallback((): void => {
    setRotation([...BIKINI_QUERIES]);
    saveRotationTo(ROTATION_KEY, [...BIKINI_QUERIES]);
  }, []);
  const resetBili = useCallback((): void => {
    setBiliRotation([...BILI_DEFAULT_ROTATION]);
    saveRotationTo(BILI_ROTATION_KEY, [...BILI_DEFAULT_ROTATION]);
  }, []);
  return { rotation, biliRotation, commit, commitBili, reset, resetBili };
}
