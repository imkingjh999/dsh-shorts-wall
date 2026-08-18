/**
 * Persistent floating-window shell. One React subtree is re-styled across
 * float/stick/closed modes so playback never remounts. The chrome itself
 * lives in the shared dsh-float-window package (same shell as dsh-deepsea);
 * this file only supplies the plugin-specific labels and the feed content.
 */
import type { ReactNode } from "react";
import { FloatWindow } from "dsh-float-window";
import { ACCENT, PlayGlyph } from "./common.tsx";
import { ShortsFeed } from "./feed-view.tsx";
import { useT } from "./i18n.ts";

export function FloatingShell(): ReactNode {
  const t = useT();
  return (
    <FloatWindow
      storageKey="dsh-shorts-wall:shell"
      title="Shorts"
      accent={ACCENT}
      launcherGlyph={<PlayGlyph size={20} />}
      defaultW={420}
      defaultH={760}
      minW={300}
      minH={400}
      defaultMode="stick"
      // Declarative boss key: registered in the shared float-window registry
      // so the deepsea window gets auto-assigned a different combo.
      bossKey="Alt+S"
      labels={{
        openTitle: t("shell.open"),
        expandTitle: t("shell.expand"),
        minimizeTitle: t("shell.minimize"),
        minimizeText: t("shell.minimizeText"),
        modeToggleTip: t("shell.modeToggleTip"),
        floatText: t("shell.floatText"),
        bossKeyText: t("shell.bossKey"),
      }}
    >
      {(visible) => (
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <ShortsFeed visible={visible} />
        </div>
      )}
    </FloatWindow>
  );
}
