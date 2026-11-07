"use client";
// The account's SSH connections as the gateway lists them. Every device of the
// account sees the same list, so counts built on it are account-wide.
import { useCallback, useEffect, useRef, useState } from "react";

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

const changeListeners = new Set<() => void>();

/**
 * Tells every list on this page that the gateway's list changed, e.g. after this
 * device's DELETE returned or a new shell became ready. Call it only once the gateway
 * has applied the change, or the refetch reads the old list.
 */
export function notifyLiveSessionsChanged() {
  for (const listener of changeListeners) listener();
}

/** Polls the list, and refetches at once on notifyLiveSessionsChanged. */
export function useLiveSessions(intervalMs: number) {
  const [list, setList] = useState<LiveSessionList | null>(null);
  const [error, setError] = useState(false);
  // One request at a time. A poll or notify during a request asks for one more pass after
  // it instead of a parallel request, so a burst costs at most two requests.
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const load = useCallback((): Promise<void> => {
    if (running.current) {
      again.current = true;
      return running.current;
    }
    const run = (async () => {
      try {
        do {
          again.current = false;
          try {
            const result = await fetchLiveSessions();
            if (result === "login") {
              window.location.href = "/login";
              return;
            }
            // Always show the answer, even if a change came in meanwhile: dropping it would
            // starve the list whenever answers take longer than the poll. The next pass corrects it.
            setList(result);
            setError(false);
          } catch {
            if (!again.current) setError(true);
          }
        } while (again.current);
      } finally {
        running.current = null;
      }
    })();
    running.current = run;
    return run;
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), intervalMs);
    const onChange = () => void load();
    changeListeners.add(onChange);
    return () => {
      clearInterval(timer);
      changeListeners.delete(onChange);
    };
  }, [load, intervalMs]);

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
