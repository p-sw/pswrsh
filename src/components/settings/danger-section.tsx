"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { WipeVaultPrompt } from "@/components/app/prompts";
import { Section, Status } from "@/components/settings/shared";
import { Button } from "@/components/ui/button";
import { closeAllSessions } from "@/lib/live-sessions";
import { wipeVault } from "@/lib/vault";

/** Last section of the settings page: actions that cannot be undone. */
export function DangerSection() {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function wipe() {
    setAsking(false);
    setBusy(true);
    setError(null);
    // Close the shells first so they end even if the wipe fails.
    await closeAllSessions();
    try {
      await wipeVault();
    } catch {
      setBusy(false);
      setError("볼트를 지우지 못했습니다.");
      return;
    }
    // The host list then shows the first-run screen to make a new vault.
    router.replace("/");
  }

  return (
    <Section title="Dangerous Action" description="되돌릴 수 없는 작업입니다.">
      <div className="flex flex-col gap-3 rounded-lg border border-destructive/50 p-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">볼트 지우기</p>
          <p className="text-sm text-muted-foreground">
            계정에 저장된 호스트와 키를 모든 기기에서 지웁니다. 열린 SSH 연결이 모두 끊깁니다.
          </p>
        </div>
        <Button
          type="button"
          variant="destructive"
          className="h-10 self-start"
          disabled={busy}
          onClick={() => setAsking(true)}
        >
          <Trash2 />
          볼트 지우기
        </Button>
        <Status error={error} />
      </div>
      {asking && <WipeVaultPrompt onAnswer={(confirmed) => (confirmed ? void wipe() : setAsking(false))} />}
    </Section>
  );
}
