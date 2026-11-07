"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useVault } from "@/components/app/vault-provider";
import { Button } from "@/components/ui/button";

type LiveSession = {
  id: string;
  name: string;
  status: "attached" | "detached";
  viewers: number;
  startedAt: string;
  lastInputAt: string;
};

function when(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

export function ConnectionsClient() {
  const router = useRouter();
  const { requestAttach } = useVault();
  const [sessions, setSessions] = useState<LiveSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/sessions");
    if (response.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (!response.ok) {
      setError("연결 목록을 불러오지 못했습니다.");
      return;
    }
    const body = (await response.json()) as { sessions?: LiveSession[] };
    setSessions(Array.isArray(body.sessions) ? body.sessions : []);
    setError(null);
  }, []);

  useEffect(() => {
    let stopped = false;
    const tick = () => {
      if (!stopped) void load().catch(() => setError("연결 목록을 불러오지 못했습니다."));
    };
    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [load]);

  async function disconnect(id: string) {
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.status === 401) {
      window.location.href = "/login";
      return;
    }
    await load();
  }

  function attach(session: LiveSession) {
    requestAttach(session.id, session.name);
    router.push("/");
  }

  return (
    <main className="h-dvh overflow-y-auto">
      <div className="mx-auto flex w-full max-w-xl flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
        <header className="flex items-center gap-2 py-2">
          <Link
            href="/"
            className="-ml-2 flex size-11 items-center justify-center rounded-md hover:bg-accent"
            aria-label="터미널로 돌아가기"
          >
            <ChevronLeft className="size-5" />
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">연결 목록</h1>
        </header>
        <p className="py-3 text-sm text-muted-foreground">
          페이지를 떠나거나 새로고침해도 연결은 유지됩니다. 여러 기기가 같은 연결에 붙으면 화면을 함께 보고 모두 입력할 수
          있습니다. 같은 호스트를 다시 열면 새 연결이 따로 생깁니다. 입력이 없으면 설정의 유지 시간 뒤에 끊깁니다. 서비스를 다시
          시작하면 연결이 사라집니다.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {sessions === null ? (
          <p className="py-6 text-sm text-muted-foreground">불러오는 중…</p>
        ) : sessions.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">유지 중인 연결이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {sessions.map((session) => (
              <li key={session.id} className="rounded-lg border p-3">
                <p className="truncate font-medium">{session.name}</p>
                <p className="text-sm text-muted-foreground">{session.viewers > 0 ? `연결됨 · 기기 ${session.viewers}대에서 사용 중` : "분리됨"}</p>
                <p className="text-xs text-muted-foreground">시작 {when(session.startedAt)}</p>
                <p className="text-xs text-muted-foreground">마지막 입력 {when(session.lastInputAt)}</p>
                <div className="mt-3 flex gap-2">
                  <Button type="button" size="sm" onClick={() => attach(session)}>
                    붙기
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => void disconnect(session.id)}>
                    끊기
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
