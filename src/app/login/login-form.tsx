"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { Field, FormError } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/api";

type Method = "totp" | "email";
type SecondStep = { ticket: string; methods: Method[] };

const ERRORS: Record<string, string> = {
  too_many_attempts: "로그인 시도가 너무 많습니다. 1분 뒤 다시 시도하세요.",
  network: "서버에 연결하지 못했습니다.",
  code_invalid: "코드가 맞지 않습니다.",
  ticket_expired: "확인 시간이 지났거나 너무 많이 틀렸습니다. 처음부터 다시 로그인하세요.",
  too_soon: "코드는 1분에 한 번만 보낼 수 있습니다.",
  mail_failed: "메일을 보내지 못했습니다.",
  method_unavailable: "이 계정에서 쓸 수 없는 방식입니다.",
};

const METHOD_LABELS: Record<Method, string> = { totp: "인증 앱", email: "이메일 코드" };

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [second, setSecond] = useState<SecondStep | null>(null);
  const [method, setMethod] = useState<Method>("totp");
  const [code, setCode] = useState("");
  const [mailed, setMailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await postJson("/api/login", { email, password });
    setBusy(false);
    if (!result.ok) {
      return setError(ERRORS[result.error ?? ""] ?? "이메일이나 비밀번호가 맞지 않습니다.");
    }
    const next = result.data.secondFactor as SecondStep | undefined;
    if (!next) {
      window.location.href = "/";
      return;
    }
    setPassword("");
    setSecond(next);
    setMethod(next.methods[0]);
  }

  async function mailCode() {
    if (!second) return;
    setError(null);
    setBusy(true);
    const result = await postJson("/api/login/email-code", { ticket: second.ticket });
    setBusy(false);
    if (!result.ok) return setError(ERRORS[result.error ?? ""] ?? "요청을 처리하지 못했습니다.");
    setMailed(true);
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!second) return;
    setError(null);
    setBusy(true);
    const result = await postJson("/api/login/second-factor", { ticket: second.ticket, method, code });
    setBusy(false);
    if (result.ok) {
      window.location.href = "/";
      return;
    }
    setCode("");
    setError(ERRORS[result.error ?? ""] ?? "요청을 처리하지 못했습니다.");
    if (result.error === "ticket_expired") setSecond(null);
  }

  if (second) {
    return (
      <form onSubmit={verify} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">2단계 인증이 켜져 있습니다. 코드를 입력하세요.</p>
        {second.methods.length > 1 && (
          <div role="radiogroup" aria-label="인증 방식" className="grid grid-cols-2 gap-2">
            {second.methods.map((value) => (
              <Button
                key={value}
                type="button"
                role="radio"
                aria-checked={method === value}
                variant={method === value ? "default" : "outline"}
                className="h-11"
                onClick={() => {
                  setMethod(value);
                  setCode("");
                }}
              >
                {METHOD_LABELS[value]}
              </Button>
            ))}
          </div>
        )}
        {method === "email" && (
          <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={mailCode}>
            {mailed ? "코드 다시 받기" : "메일로 코드 받기"}
          </Button>
        )}
        <Field id="login-code" label={method === "totp" ? "인증 앱의 6자리 코드" : "메일로 받은 6자리 코드"}>
          <Input
            id="login-code"
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="h-11 font-mono tracking-widest"
          />
        </Field>
        <FormError message={error} />
        <Button type="submit" className="h-11" disabled={busy || code.length !== 6}>
          확인
        </Button>
        <Button type="button" variant="ghost" className="h-11" onClick={() => setSecond(null)}>
          처음으로
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field id="login-email" label="이메일">
        <Input id="login-email" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" autoCapitalize="none" autoComplete="username" />
      </Field>
      <Field id="login-password" label="비밀번호">
        <Input id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" autoComplete="current-password" />
      </Field>
      <FormError message={error} />
      <Button type="submit" className="h-11" disabled={busy || !email || !password}>
        로그인
      </Button>
      <div className="flex justify-between text-sm text-muted-foreground">
        <Link href="/signup" className="underline-offset-4 hover:underline">
          가입
        </Link>
        <Link href="/forgot" className="underline-offset-4 hover:underline">
          비밀번호 찾기
        </Link>
      </div>
    </form>
  );
}
