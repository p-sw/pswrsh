"use client";

import { ChevronLeft, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useVault } from "@/components/app/vault-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { remainingLabel, useLiveSessions, type LiveSession } from "@/lib/live-sessions";

const NAME_MAX = 80;

function when(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

/** Re-renders every second so the keep-alive countdown moves. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function SessionItem({
  session,
  now,
  onAttach,
  onDisconnect,
  onRenamed,
}: {
  session: LiveSession;
  now: number;
  onAttach: () => void;
  onDisconnect: () => void;
  onRenamed: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(session.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const next = name.trim();
    if (!next) {
      setError("이름을 적어 주세요.");
      return;
    }
    if (next === session.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        setError(response.status === 404 ? "연결이 이미 닫혔습니다." : (body.message ?? "이름을 바꾸지 못했습니다."));
        return;
      }
      setEditing(false);
      setError(null);
      onRenamed();
    } catch {
      setError("이름을 바꾸지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded-lg border p-3">
      {editing ? (
        <form onSubmit={save} className="flex flex-col gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX}
            aria-label="연결 이름"
            aria-invalid={error !== null}
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              저장
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setEditing(false);
                setName(session.name);
                setError(null);
              }}
            >
              취소
            </Button>
          </div>
        </form>
      ) : (
        <p className="truncate font-medium">{session.name}</p>
      )}
      <p className="text-sm text-muted-foreground">
        {session.viewers > 0 ? `연결됨 · 기기 ${session.viewers}대에서 사용 중` : "분리됨"}
      </p>
      <p className="text-xs text-muted-foreground">
        {session.expiresAt
          ? `남은 유지 시간 ${remainingLabel(session.expiresAt, now)}`
          : "기기가 붙어 있는 동안 계속 유지됩니다"}
      </p>
      <p className="text-xs text-muted-foreground">시작 {when(session.startedAt)}</p>
      <p className="text-xs text-muted-foreground">마지막 입력 {when(session.lastInputAt)}</p>
      {!editing && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={onAttach}>
            붙기
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setName(session.name);
              setEditing(true);
            }}
          >
            이름 바꾸기
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onDisconnect}>
            끊기
          </Button>
        </div>
      )}
    </li>
  );
}

export function ConnectionsClient() {
  const router = useRouter();
  const { requestAttach, requestOpen, data } = useVault();
  const { list, error, reload } = useLiveSessions(2000);
  const [picking, setPicking] = useState(false);
  const now = useNow();

  const sessions = list?.sessions ?? null;
  const limit = list?.limit ?? 20;
  const atLimit = sessions !== null && sessions.length >= limit;

  async function disconnect(id: string) {
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.status === 401) {
      window.location.href = "/login";
      return;
    }
    await reload();
  }

  function attach(session: LiveSession) {
    requestAttach(session.id, session.name, session.hostId);
    router.push("/");
  }

  function startNew() {
    // Locked vault: the host list behind the unlock screen opens the connection.
    if (!data) {
      router.push("/");
      return;
    }
    setPicking((open) => !open);
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
          <h1 className="flex-1 text-xl font-semibold tracking-tight">연결 목록</h1>
          <Button type="button" size="sm" onClick={startNew} disabled={atLimit} aria-expanded={picking}>
            <Plus />새 연결
          </Button>
        </header>
        <p className="py-3 text-sm text-muted-foreground">
          페이지를 떠나거나 새로고침해도 연결은 유지됩니다. 여러 기기가 같은 연결에 붙으면 화면을 함께 보고 모두 입력할 수
          있습니다. 같은 호스트를 다시 열면 새 연결이 따로 생깁니다. 붙어 있는 기기가 모두 떠나면 설정의 유지 시간 뒤에
          끊깁니다. 서비스를 다시 시작하면 연결이 사라집니다.
        </p>
        {sessions !== null && (
          <p className={atLimit ? "pb-3 text-sm text-destructive" : "pb-3 text-sm text-muted-foreground"} role="status">
            {atLimit
              ? `연결은 계정당 ${limit}개까지 열 수 있습니다. 쓰지 않는 연결을 끊으면 새로 열 수 있습니다.`
              : `연결 ${sessions.length}/${limit}개 사용 중`}
          </p>
        )}
        {picking && data && !atLimit && (
          <div className="mb-4 rounded-lg border p-3">
            <p className="pb-2 text-sm font-medium">어느 호스트로 열까요?</p>
            {data.hosts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                저장된 호스트가 없습니다.{" "}
                <Link href="/" className="underline underline-offset-4">
                  호스트 추가하기
                </Link>
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {data.hosts.map((host) => (
                  <li key={host.id}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full flex-col justify-center rounded-md px-3 py-1.5 text-left hover:bg-accent"
                      onClick={() => {
                        requestOpen(host.id);
                        router.push("/");
                      }}
                    >
                      <span className="truncate text-sm font-medium">{host.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {host.username}@{host.hostname}:{host.port}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {error && <p className="text-sm text-destructive">연결 목록을 불러오지 못했습니다.</p>}
        {sessions === null ? (
          <p className="py-6 text-sm text-muted-foreground">불러오는 중…</p>
        ) : sessions.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">유지 중인 연결이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {sessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                now={now}
                onAttach={() => attach(session)}
                onDisconnect={() => void disconnect(session.id)}
                onRenamed={() => void reload()}
              />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
