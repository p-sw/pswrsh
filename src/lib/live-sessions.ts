"use client";
// The account's SSH connections as the gateway lists them. Every device of the
// account sees the same list, so counts built on it are account-wide.
import { useCallback, useEffect, useState } from "react";

export type LiveSession = {
  id: string;
  name: string;
  hostId: string;
  status: "attached" | "detached";
  viewers: number;
  startedAt: string;
  lastInputAt: string;
  expiresAt: string | null;
};

export type LiveSessionList = { sessions: LiveSession[]; limit: number };

export const DEFAULT_SESSION_LIMIT = 20;

export async function fetchLiveSessions(): Promise<LiveSessionList | "login"> {
  const response = await fetch("/api/sessions");
  if (response.status === 401) return "login";
  if (!response.ok) throw new Error(`sessions ${response.status}`);
  const body = (await response.json()) as { sessions?: LiveSession[]; limit?: number };
  return {
    sessions: Array.isArray(body.sessions) ? body.sessions : [],
    limit: typeof body.limit === "number" ? body.limit : DEFAULT_SESSION_LIMIT,
  };
}

/** Polls the list. `revision` refetches at once, e.g. after this device opened a tab. */
export function useLiveSessions(intervalMs: number, revision = 0) {
  const [list, setList] = useState<LiveSessionList | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await fetchLiveSessions();
      if (result === "login") {
        window.location.href = "/login";
        return;
      }
      setList(result);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), intervalMs);
    return () => clearInterval(timer);
  }, [load, intervalMs, revision]);

  return { list, error, reload: load };
}

/** "12분 30초" style time left until the keep-alive closes the connection. */
export function remainingLabel(expiresAt: string, now: number) {
  const at = new Date(expiresAt).getTime();
  if (!Number.isFinite(at)) return "알 수 없음";
  const left = Math.max(0, Math.ceil((at - now) / 1000));
  const hours = Math.floor(left / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  const seconds = left % 60;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  if (minutes > 0) return `${minutes}분 ${seconds}초`;
  return `${seconds}초`;
}
