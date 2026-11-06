"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { type FormEvent, useState } from "react";
import { Field } from "@/components/auth/auth-card";
import { errorText, Section, Status } from "@/components/settings/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/api";

type Passkey = { id: string; name: string; createdAt: number; lastUsedAt: number | null };

function when(value: number | null) {
  return value ? new Date(value).toLocaleString("ko-KR") : "아직 안 씀";
}

export function PasskeySection({ passkeys, onChanged }: { passkeys: Passkey[]; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const options = await postJson("/api/passkeys/register/options", {});
      if (!options.ok) return setError(errorText(options.error));
      let response;
      try {
        response = await startRegistration({ optionsJSON: options.data.options as Parameters<typeof startRegistration>[0]["optionsJSON"] });
      } catch {
        return setError("패스키 만들기를 취소했거나 이 기기가 지원하지 않습니다.");
      }
      const saved = await postJson("/api/passkeys/register/verify", { name, response });
      if (!saved.ok) return setError(errorText(saved.error));
      setName("");
      setNotice("패스키를 추가했습니다.");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove(event: FormEvent) {
    event.preventDefault();
    if (!deleting) return;
    setError(null);
    setBusy(true);
    const result = await postJson("/api/passkeys/delete", { id: deleting, password });
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    setDeleting(null);
    setPassword("");
    onChanged();
  }

  return (
    <Section title="패스키" description="지문, 얼굴, 기기 잠금으로 비밀번호 없이 로그인합니다. 2단계 인증을 따로 묻지 않습니다.">
      {passkeys.length > 0 && (
        <ul className="flex flex-col divide-y rounded-md border">
          {passkeys.map((passkey) => (
            <li key={passkey.id} className="flex flex-col gap-3 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{passkey.name}</p>
                  <p className="text-xs text-muted-foreground">
                    추가 {when(passkey.createdAt)} · 마지막 사용 {when(passkey.lastUsedAt)}
                  </p>
                </div>
                <Button type="button" variant="ghost" className="h-11 shrink-0" onClick={() => setDeleting(deleting === passkey.id ? null : passkey.id)}>
                  삭제
                </Button>
              </div>
              {deleting === passkey.id && (
                <form onSubmit={remove} className="flex flex-col gap-3">
                  <Field id={`passkey-password-${passkey.id}`} label="현재 비밀번호">
                    <Input id={`passkey-password-${passkey.id}`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" autoComplete="current-password" />
                  </Field>
                  <Button type="submit" variant="destructive" className="h-11 self-start" disabled={busy || !password}>
                    이 패스키 삭제
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-col gap-3">
        <Field id="passkey-name" label="새 패스키 이름">
          <Input id="passkey-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 내 휴대폰" className="h-11" maxLength={64} />
        </Field>
        <Status error={error} notice={notice} />
        <Button type="submit" className="h-11 self-start" disabled={busy || !name.trim()}>
          패스키 추가
        </Button>
      </form>
    </Section>
  );
}
