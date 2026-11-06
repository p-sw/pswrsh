"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { Field, FormError } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/api";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await postJson("/api/login", { email, password });
    setBusy(false);
    if (result.ok) {
      window.location.href = "/";
      return;
    }
    setError(
      result.error === "too_many_attempts"
        ? "로그인 시도가 너무 많습니다. 1분 뒤 다시 시도하세요."
        : result.error === "network"
          ? "서버에 연결하지 못했습니다."
          : "이메일이나 비밀번호가 맞지 않습니다.",
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
