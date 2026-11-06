"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { Field, FormError } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/api";

const ERRORS: Record<string, string> = {
  bad_email: "이메일 주소를 확인하세요.",
  too_soon: "코드는 1분에 한 번만 보낼 수 있습니다. 잠시 뒤 다시 시도하세요.",
  mail_failed: "메일을 보내지 못했습니다. 관리자에게 문의하세요.",
  signup_disabled: "지금은 가입을 받지 않습니다.",
  code_invalid: "코드가 맞지 않습니다.",
  code_expired: "코드가 만료됐거나 너무 많이 틀렸습니다. 코드를 다시 받으세요.",
  ticket_invalid: "확인 시간이 지났습니다. 처음부터 다시 하세요.",
  bad_password: "비밀번호는 8자 이상이어야 합니다.",
  email_taken: "이미 가입된 이메일입니다.",
  network: "서버에 연결하지 못했습니다.",
};

type Props = {
  /** API prefix, such as /api/signup. */
  api: string;
  passwordLabel: string;
  submitLabel: string;
  /** Where to go after the last step. */
  done: string;
};

export function EmailCodeFlow({ api, passwordLabel, submitLabel, done }: Props) {
  const [step, setStep] = useState<"email" | "code" | "password">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [ticket, setTicket] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(path: string, body: unknown) {
    setError(null);
    setBusy(true);
    const result = await postJson(`${api}/${path}`, body);
    setBusy(false);
    if (!result.ok) setError(ERRORS[result.error ?? ""] ?? "요청을 처리하지 못했습니다.");
    return result;
  }

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    if ((await call("start", { email })).ok) setStep("code");
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    const result = await call("verify", { email, code });
    if (!result.ok) return;
    setTicket(String(result.data.ticket ?? ""));
    setStep("password");
  }

  async function finish(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) return setError("두 비밀번호가 같지 않습니다.");
    if ((await call("complete", { ticket, password })).ok) window.location.href = done;
  }

  return (
    <div className="flex flex-col gap-4">
      {step === "email" && (
        <form onSubmit={sendCode} className="flex flex-col gap-4">
          <Field id="flow-email" label="이메일">
            <Input id="flow-email" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" autoCapitalize="none" autoComplete="email" />
          </Field>
          <FormError message={error} />
          <Button type="submit" className="h-11" disabled={busy || !email}>
            확인 코드 받기
          </Button>
        </form>
      )}
      {step === "code" && (
        <form onSubmit={verify} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{email}로 보낸 6자리 코드를 입력하세요. 10분 동안 쓸 수 있습니다.</p>
          <Field id="flow-code" label="확인 코드">
            <Input id="flow-code" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="h-11 font-mono tracking-widest" />
          </Field>
          <FormError message={error} />
          <Button type="submit" className="h-11" disabled={busy || code.length !== 6}>
            확인
          </Button>
          <Button type="button" variant="ghost" className="h-11" disabled={busy} onClick={() => sendCode()}>
            코드 다시 받기
          </Button>
        </form>
      )}
      {step === "password" && (
        <form onSubmit={finish} className="flex flex-col gap-4">
          <Field id="flow-password" label={passwordLabel}>
            <Input id="flow-password" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" autoComplete="new-password" />
          </Field>
          <Field id="flow-password-confirm" label="비밀번호 확인">
            <Input id="flow-password-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-11" autoComplete="new-password" />
          </Field>
          <p className="text-xs text-muted-foreground">8자 이상. 볼트 패스프레이즈와는 별개입니다.</p>
          <FormError message={error} />
          <Button type="submit" className="h-11" disabled={busy || !password}>
            {submitLabel}
          </Button>
        </form>
      )}
      <Link href="/login" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
        로그인으로 돌아가기
      </Link>
    </div>
  );
}
