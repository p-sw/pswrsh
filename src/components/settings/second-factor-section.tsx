"use client";

import { type FormEvent, useState } from "react";
import { Field } from "@/components/auth/auth-card";
import { errorText, Section, Status } from "@/components/settings/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/api";

export function EmailOtpForm({ enabled, onChanged }: { enabled: boolean; onChanged: (enabled: boolean) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await postJson("/api/settings/email-otp", { enabled: !enabled, password });
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    setPassword("");
    onChanged(!enabled);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-sm">
        이메일 코드: <span className="font-medium">{enabled ? "켜짐" : "꺼짐"}</span>
      </p>
      <p className="text-sm text-muted-foreground">켜면 로그인할 때 비밀번호 다음에 메일로 받은 코드를 한 번 더 입력합니다.</p>
      <Field id="email-otp-password" label="현재 비밀번호">
        <Input id="email-otp-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" autoComplete="current-password" />
      </Field>
      <Status error={error} />
      <Button type="submit" variant={enabled ? "outline" : "default"} className="h-11 self-start" disabled={busy || !password}>
        {enabled ? "이메일 코드 끄기" : "이메일 코드 켜기"}
      </Button>
    </form>
  );
}

export function SecondFactorSection({ children }: { children: React.ReactNode }) {
  return (
    <Section title="2단계 인증" description="일회성 코드로 로그인을 한 번 더 확인합니다. 패스키 로그인에는 묻지 않습니다.">
      {children}
    </Section>
  );
}
