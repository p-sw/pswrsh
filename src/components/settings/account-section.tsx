"use client";

import { type FormEvent, useState } from "react";
import { Field } from "@/components/auth/auth-card";
import { errorText, Section, Status } from "@/components/settings/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/api";

export function EmailForm({ email, onChanged }: { email: string; onChanged: (email: string) => void }) {
  const [step, setStep] = useState<"start" | "code">("start");
  const [password, setPassword] = useState("");
  const [next, setNext] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await postJson("/api/settings/email/start", { password, email: next });
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    setPassword("");
    setStep("code");
    setNotice(`${next}로 보낸 6자리 코드를 입력하세요.`);
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await postJson("/api/settings/email/verify", { email: next, code });
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    onChanged(next);
    setStep("start");
    setNext("");
    setCode("");
    setNotice("로그인 이메일을 바꿨습니다.");
  }

  return (
    <Section title="이메일" description={`지금 로그인 이메일: ${email}`}>
      {step === "start" ? (
        <form onSubmit={start} className="flex flex-col gap-3">
          <Field id="email-next" label="새 이메일">
            <Input id="email-next" type="email" value={next} onChange={(e) => setNext(e.target.value)} className="h-11" autoCapitalize="none" />
          </Field>
          <Field id="email-password" label="현재 비밀번호">
            <Input id="email-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" autoComplete="current-password" />
          </Field>
          <Status error={error} notice={notice} />
          <Button type="submit" className="h-11 self-start" disabled={busy || !next || !password}>
            확인 코드 보내기
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-3">
          <Field id="email-code" label="확인 코드">
            <Input id="email-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="h-11 font-mono tracking-widest" />
          </Field>
          <Status error={error} notice={notice} />
          <div className="flex gap-2">
            <Button type="submit" className="h-11" disabled={busy || code.length !== 6}>
              이메일 바꾸기
            </Button>
            <Button type="button" variant="ghost" className="h-11" onClick={() => setStep("start")}>
              취소
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (next !== confirm) return setError("두 비밀번호가 같지 않습니다.");
    setBusy(true);
    const result = await postJson("/api/settings/password", { current, next });
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    setCurrent("");
    setNext("");
    setConfirm("");
    setNotice("비밀번호를 바꿨습니다. 다른 기기의 로그인은 모두 끊었습니다.");
  }

  return (
    <Section title="비밀번호" description="계정 비밀번호입니다. 볼트 패스프레이즈와는 별개입니다.">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field id="password-current" label="현재 비밀번호">
          <Input id="password-current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className="h-11" autoComplete="current-password" />
        </Field>
        <Field id="password-next" label="새 비밀번호">
          <Input id="password-next" type="password" value={next} onChange={(e) => setNext(e.target.value)} className="h-11" autoComplete="new-password" />
        </Field>
        <Field id="password-confirm" label="새 비밀번호 확인">
          <Input id="password-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-11" autoComplete="new-password" />
        </Field>
        <Status error={error} notice={notice} />
        <Button type="submit" className="h-11 self-start" disabled={busy || !current || !next}>
          비밀번호 바꾸기
        </Button>
      </form>
    </Section>
  );
}
