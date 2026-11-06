"use client";

import { Lock, LogOut, MoreVertical, Pencil, Plus, Search, Server, Settings, Trash2, UserRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "cn";
import type { SessionState, SshSession } from "@/lib/session";
import type { Host, HostAuth } from "@/lib/vault";

export const AUTH_LABELS: Record<HostAuth["type"], string> = {
  password: "비밀번호",
  key: "개인키",
  interactive: "대화형",
};

const noSubscribe = () => () => {};
const noState = (): SessionState | null => null;

export function statusDotClass(state: SessionState | null) {
  switch (state?.status) {
    case "connected":
      return "bg-emerald-500";
    case "connecting":
    case "verifying":
    case "authenticating":
      return "bg-amber-500";
    case "auth-failed":
    case "failed":
      return "bg-destructive";
    case "disconnected":
      return "bg-muted-foreground";
    default:
      return "";
  }
}

function HostRow({
  host,
  session,
  active,
  onOpen,
  onEdit,
  onDelete,
}: {
  host: Host;
  session: SshSession | undefined;
  active: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const state = useSyncExternalStore(session?.subscribe ?? noSubscribe, session?.getState ?? noState);
  return (
    <li className={cn("flex items-center rounded-md", active && "bg-accent")}>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-2 text-left outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="relative shrink-0">
          <Server className="size-4 text-muted-foreground" aria-hidden />
          {state && (
            <span
              className={cn("absolute -right-1 -bottom-1 size-2 rounded-full ring-2 ring-background", statusDotClass(state))}
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{host.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {host.username}@{host.hostname}:{host.port} · {AUTH_LABELS[host.auth.type]}
          </span>
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="mr-1 size-10 shrink-0" aria-label={`${host.name} 메뉴`}>
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit} className="max-md:min-h-11">
            <Pencil />
            수정
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onDelete} className="max-md:min-h-11">
            <Trash2 />
            삭제
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

type Props = {
  hosts: Host[];
  sessions: SshSession[];
  activeHostId: string | null;
  onAdd: () => void;
  onLock: () => void;
  onWipe: () => void;
  onOpen: (host: Host) => void;
  onEdit: (host: Host) => void;
  onDelete: (host: Host) => void;
};

/** Leaving the page also ends every SSH session and drops the vault key. */
async function logOut() {
  await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
  window.location.href = "/login";
}

export function HostList({ hosts, sessions, activeHostId, onAdd, onLock, onWipe, onOpen, onEdit, onDelete }: Props) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return hosts;
    return hosts.filter((host) =>
      [host.name, host.hostname, host.username].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [hosts, query]);

  return (
    <div className="flex h-full min-h-0 flex-col pt-[env(safe-area-inset-top)]">
      <header className="flex h-14 shrink-0 items-center justify-between px-4">
        <h1 className="text-base font-semibold tracking-tight">pswrsh</h1>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-10" aria-label="잠금" onClick={onLock}>
            <Lock />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-10" aria-label="계정">
                <UserRound />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <Settings />
                  설정
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={logOut}>
                <LogOut />
                로그아웃
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" className="size-10" aria-label="호스트 추가" onClick={onAdd}>
            <Plus />
          </Button>
        </div>
      </header>
      {hosts.length > 0 && (
        <div className="relative shrink-0 px-3 pb-2">
          <Search className="pointer-events-none absolute top-2.5 left-6 size-4 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="호스트 검색"
            aria-label="호스트 검색"
            className="pl-9"
          />
        </div>
      )}
      {hosts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-sm text-muted-foreground">저장된 호스트가 없습니다.</p>
          <Button onClick={onAdd} className="h-11">
            <Plus />
            호스트 추가
          </Button>
        </div>
      ) : (
        // Radix wraps the viewport content in display:table, which defeats truncate.
        <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
          {filtered.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">검색 결과가 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-0.5 px-1 pb-2">
              {filtered.map((host) => (
                <HostRow
                  key={host.id}
                  host={host}
                  session={sessions.find((s) => s.hostId === host.id)}
                  active={host.id === activeHostId}
                  onOpen={() => onOpen(host)}
                  onEdit={() => onEdit(host)}
                  onDelete={() => onDelete(host)}
                />
              ))}
            </ul>
          )}
        </ScrollArea>
      )}
      <footer className="shrink-0 border-t p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        <Button variant="ghost" className="h-10 w-full justify-start text-destructive hover:text-destructive" onClick={onWipe}>
          <Trash2 />
          볼트 지우기
        </Button>
      </footer>
    </div>
  );
}
