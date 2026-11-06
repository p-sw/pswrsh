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

export function TotpForm({ enabled, onChanged }: { enabled: boolean; onChanged: (enabled: boolean) => void }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function begin() {
    setError(null);
    setBusy(true);
    const result = await postJson("/api/settings/totp/start", {});
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    setSetup({ secret: String(result.data.secret), uri: String(result.data.uri) });
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await postJson("/api/settings/totp/confirm", { code });
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    setSetup(null);
    setCode("");
    onChanged(true);
  }

  async function disable(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await postJson("/api/settings/totp/disable", { password });
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    setPassword("");
    onChanged(false);
  }

  if (enabled) {
    return (
      <form onSubmit={disable} className="flex flex-col gap-3 border-t pt-4">
        <p className="text-sm">
          인증 앱(TOTP): <span className="font-medium">켜짐</span>
        </p>
        <Field id="totp-password" label="현재 비밀번호">
          <Input id="totp-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" autoComplete="current-password" />
        </Field>
        <Status error={error} />
        <Button type="submit" variant="outline" className="h-11 self-start" disabled={busy || !password}>
          인증 앱 끄기
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <p className="text-sm">
        인증 앱(TOTP): <span className="font-medium">꺼짐</span>
      </p>
      {!setup ? (
        <>
          <Status error={error} />
          <Button type="button" className="h-11 self-start" disabled={busy} onClick={begin}>
            인증 앱 등록
          </Button>
        </>
      ) : (
        <form onSubmit={confirm} className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">인증 앱에 아래 설정 키를 직접 입력하거나 링크를 여세요. 앱에 나온 6자리 코드를 넣으면 켜집니다.</p>
          <code className="rounded-md bg-muted px-3 py-2 font-mono text-sm break-all select-all" aria-label="설정 키">
            {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
          </code>
          <a href={setup.uri} className="text-sm underline underline-offset-4">
            인증 앱으로 열기
          </a>
          <Field id="totp-code" label="앱의 6자리 코드">
            <Input id="totp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="h-11 font-mono tracking-widest" />
          </Field>
          <Status error={error} />
          <Button type="submit" className="h-11 self-start" disabled={busy || code.length !== 6}>
            확인하고 켜기
          </Button>
        </form>
      )}
    </div>
  );
}
