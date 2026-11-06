"use client";

import { LockKeyhole } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createVault, unlockVault, type VaultData } from "@/lib/vault";

const MIN_PASSPHRASE_LENGTH = 8;

type Props = {
  firstRun: boolean;
  onUnlocked: (vault: { key: CryptoKey; data: VaultData }) => void;
};

export function UnlockScreen({ firstRun, onUnlocked }: Props) {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (firstRun && passphrase.length < MIN_PASSPHRASE_LENGTH) {
      setError(`패스프레이즈는 ${MIN_PASSPHRASE_LENGTH}자 이상이어야 합니다.`);
      return;
    }
    if (firstRun && passphrase !== confirm) {
      setError("두 패스프레이즈가 같지 않습니다.");
      return;
    }
    setBusy(true);
    try {
      onUnlocked(firstRun ? await createVault(passphrase) : await unlockVault(passphrase));
    } catch {
      setBusy(false);
      setError(firstRun ? "볼트를 만들지 못했습니다." : "패스프레이즈가 맞지 않습니다.");
    }
  }

  return (
    <main className="flex h-dvh items-center justify-center overflow-y-auto p-6">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-5">
        <div className="flex flex-col gap-2">
          <LockKeyhole className="size-7 text-muted-foreground" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight">{firstRun ? "볼트 만들기" : "pswrsh 잠금 해제"}</h1>
          <Link href="/connections" className="text-sm underline underline-offset-4">
            연결 목록
          </Link>
          <p className="text-sm text-muted-foreground">
            {firstRun
              ? "호스트와 비밀은 이 브라우저에만 암호화해 저장합니다. 패스프레이즈를 잊으면 복구할 수 없습니다."
              : "패스프레이즈를 입력하면 저장된 호스트를 엽니다."}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="passphrase">패스프레이즈</Label>
          <Input
            id="passphrase"
            type="password"
            autoFocus
            autoComplete={firstRun ? "new-password" : "current-password"}
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            aria-invalid={Boolean(error)}
            className="h-11"
          />
        </div>
        {firstRun && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="passphrase-confirm">패스프레이즈 확인</Label>
            <Input
              id="passphrase-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className="h-11"
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="h-11" disabled={busy || !passphrase}>
          {busy ? "여는 중…" : firstRun ? "볼트 만들기" : "잠금 해제"}
        </Button>
      </form>
    </main>
  );
}
