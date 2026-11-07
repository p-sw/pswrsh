"use client";

import "@/lib/terminal-fonts";
import { useState } from "react";
import { errorText, Section, Status } from "@/components/settings/shared";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/api";
import { setTerminalStyle } from "@/lib/terminal-style-store";
import {
  boldWeightOf,
  fontOf,
  FONTS,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  SYSTEM_FONT_STACK,
  type TerminalStyle,
  themeOf,
  THEMES,
} from "@/lib/terminal-style";

const SELECT_CLASS = "h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm";
const SIZES = Array.from({ length: MAX_FONT_SIZE - MIN_FONT_SIZE + 1 }, (_, i) => MIN_FONT_SIZE + i);

export function TerminalStyleSection({ initial, onSaved }: { initial: TerminalStyle; onSaved: (style: TerminalStyle) => void }) {
  const [style, setStyle] = useState<TerminalStyle>(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const font = fontOf(style.font);
  const theme = themeOf(style.theme).theme;

  function changeFont(id: string) {
    const next = fontOf(id);
    // Keep the weight when the new font has it, else the closest one.
    const weight = next.weights.includes(style.weight)
      ? style.weight
      : next.weights.reduce((best, w) => (Math.abs(w - style.weight) < Math.abs(best - style.weight) ? w : best));
    setStyle({ ...style, font: id, weight });
  }

  async function save() {
    setError(null);
    setNotice(null);
    setBusy(true);
    const result = await postJson("/api/settings/terminal-style", { style });
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    setNotice("저장했습니다. 열려 있는 터미널에도 바로 적용됩니다.");
    setTerminalStyle(style);
    onSaved(style);
  }

  return (
    <Section title="터미널 스타일" description="계정에 저장되어 어느 브라우저에서 로그인해도 같습니다.">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm font-medium">
          폰트
          <select aria-label="폰트" className={SELECT_CLASS} value={style.font} onChange={(e) => changeFont(e.target.value)}>
            {FONTS.map((f) => (
              <option key={f.id} value={f.id} className="bg-popover">
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium">
          크기
          <select
            aria-label="크기"
            className={SELECT_CLASS}
            value={style.size ?? "auto"}
            onChange={(e) => setStyle({ ...style, size: e.target.value === "auto" ? null : Number(e.target.value) })}
          >
            <option value="auto" className="bg-popover">
              자동 (데스크톱 13, 휴대폰 15)
            </option>
            {SIZES.map((size) => (
              <option key={size} value={size} className="bg-popover">
                {size}px
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium">
          두께
          <select aria-label="두께" className={SELECT_CLASS} value={style.weight} onChange={(e) => setStyle({ ...style, weight: Number(e.target.value) })}>
            {font.weights.map((w) => (
              <option key={w} value={w} className="bg-popover">
                {w}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium">
          색 테마
          <select aria-label="색 테마" className={SELECT_CLASS} value={style.theme} onChange={(e) => setStyle({ ...style, theme: e.target.value })}>
            {THEMES.map((t) => (
              <option key={t.id} value={t.id} className="bg-popover">
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        data-testid="terminal-style-preview"
        className="overflow-x-auto rounded-md border p-3 whitespace-pre"
        style={{
          background: theme.background,
          color: theme.foreground,
          fontFamily: font.id === "system" ? SYSTEM_FONT_STACK : `${font.family}, ${SYSTEM_FONT_STACK}`,
          fontSize: style.size ?? 14,
          fontWeight: style.weight,
        }}
      >
        <span style={{ color: theme.green }}>user@host</span>:<span style={{ color: theme.blue }}>~</span>$ ls -la{"\n"}
        <span style={{ color: theme.red }}>error</span> <span style={{ color: theme.yellow }}>warn</span>{" "}
        <span style={{ color: theme.magenta }}>0O1lI</span> <span style={{ fontWeight: boldWeightOf(font, style.weight) }}>bold</span>
      </div>
      <Status error={error} notice={notice} />
      <Button type="button" className="h-11 self-start" disabled={busy} onClick={save}>
        스타일 저장
      </Button>
    </Section>
  );
}
