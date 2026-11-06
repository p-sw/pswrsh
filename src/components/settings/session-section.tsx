"use client";

import { useState } from "react";
import { errorText, Section, Status } from "@/components/settings/shared";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/api";

const CHOICES = [5, 30, 60, 180];

export function KeepAliveSection({ minutes, onChanged }: { minutes: number; onChanged: (minutes: number) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function choose(value: number) {
    setError(null);
    setBusy(true);
    const result = await postJson("/api/settings/keep-alive", { minutes: value });
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    onChanged(value);
  }

  return (
    <Section title="연결 유지 시간" description="페이지를 떠난 뒤 SSH 연결을 얼마나 남겨 둘지 정합니다. 연결 목록 기능이 들어오면 적용됩니다.">
      <div role="radiogroup" aria-label="연결 유지 시간" className="grid grid-cols-4 gap-2">
        {CHOICES.map((value) => (
          <Button
            key={value}
            type="button"
            role="radio"
            aria-checked={minutes === value}
            variant={minutes === value ? "default" : "outline"}
            className="h-11"
            disabled={busy}
            onClick={() => choose(value)}
          >
            {value}분
          </Button>
        ))}
      </div>
      <Status error={error} />
    </Section>
  );
}

export function SignupSection({ enabled, onChanged }: { enabled: boolean; onChanged: (enabled: boolean) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setError(null);
    setBusy(true);
    const result = await postJson("/api/admin/signup", { enabled: !enabled });
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    onChanged(!enabled);
  }

  return (
    <Section
      title="가입 허용 (관리자)"
      description="켜면 이 주소에 들어온 누구나 계정을 만들고 이 서버를 거쳐 SSH로 나갈 수 있습니다."
    >
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm">{enabled ? "가입을 받고 있습니다." : "가입이 꺼져 있습니다."}</p>
        <Button type="button" role="switch" aria-checked={enabled} aria-label="가입 허용" variant={enabled ? "default" : "outline"} className="h-11" disabled={busy} onClick={toggle}>
          {enabled ? "끄기" : "켜기"}
        </Button>
      </div>
      <Status error={error} />
    </Section>
  );
}
