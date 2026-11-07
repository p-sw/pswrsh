"use client";

import {
  ChevronLeft,
  PowerOff,
  TerminalSquare,
  X,
} from "lucide-react";
import { cn } from "cn";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { HostForm } from "@/components/app/host-form";
import { HostList, statusDotClass } from "@/components/app/host-list";
import {
  DeleteHostPrompt,
  HostKeyPrompt,
  KbdInteractivePrompt,
  PasswordPrompt,
  WipeVaultPrompt,
} from "@/components/app/prompts";
import { statusLabel, TerminalPane } from "@/components/app/terminal-pane";
import { UnlockScreen } from "@/components/app/unlock-screen";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { watchTerminalStyle } from "@/lib/terminal-style-store";
import { haptic } from "@/lib/haptics";
import { fetchLiveSessions, type LiveSession } from "@/lib/live-sessions";
import { type KbdRequest, type SessionDelegate, type SessionState, type SpecialKey, SshSession } from "@/lib/session";

/** A tab whose SSH connection is over. Clicking the host does not reuse it. */
function isEnded(state: SessionState) {
  return state.status === "disconnected" || state.status === "failed" || state.status === "auth-failed";
}

/** The most recently used of the account's connections to the host that no tab here shows. */
function reusableConnection(list: LiveSession[], hostId: string, shownHere: Set<string>) {
  let best: LiveSession | null = null;
  for (const session of list) {
    if (session.hostId !== hostId || shownHere.has(session.id)) continue;
    if (
      !best ||
      session.lastInputAt > best.lastInputAt ||
      (session.lastInputAt === best.lastInputAt && session.startedAt > best.startedAt)
    ) {
      best = session;
    }
  }
  return best;
}

const ATTACH_DELEGATE: SessionDelegate = {
  getHost: () => undefined,
  getKey: () => undefined,
  checkHostKey: async () => false,
  askPassword: async () => null,
  askKbd: async () => null,
};
import { useVault, type PendingAttach, type PendingOpen } from "@/components/app/vault-provider";
import Link from "next/link";
import {
  type Host,
  isCryptoAvailable,
  knownHostKey,
  type KnownHost,
  lockVault,
  onVaultEvent,
  readVault,
  updateVault,
  vaultExists,
  type VaultData,
  wipeVault,
} from "@/lib/vault";

type Prompt =
  | { kind: "hostkey"; sessionId: string; host: Host; presented: KnownHost; previous?: KnownHost; resolve: (ok: boolean) => void }
  | { kind: "password"; sessionId: string; host: Host; resolve: (password: string | null) => void }
  | { kind: "kbd"; sessionId: string; host: Host; request: KbdRequest; resolve: (answers: string[] | null) => void };

function cancelPrompt(prompt: Prompt) {
  if (prompt.kind === "hostkey") prompt.resolve(false);
  else prompt.resolve(null);
}

// Publishes the visual viewport so the phone terminal stays above the keyboard.
function useVisualViewportVars() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const root = document.documentElement.style;
      root.setProperty("--vv-height", `${viewport.height}px`);
      root.setProperty("--vv-top", `${viewport.offsetTop}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
}

// Must be an object: Next copies its router state onto whatever is pushed.
function isMobileTerminalEntry() {
  return history.state?.pswrshTerminal === true;
}

export function AppShell() {
  const { vaultRef, unlocked, unlock, pendingAttach, clearAttach } = useVault();
  const [firstRun, setFirstRun] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [carried, setCarried] = useState<SshSession[]>([]);
  const carriedRef = useRef(carried);
  carriedRef.current = carried;

  useEffect(() => {
    if (!isCryptoAvailable()) {
      setLoadError("이 주소에서는 브라우저 암호화를 쓸 수 없습니다. localhost 또는 HTTPS로 여세요.");
      return;
    }
    if (unlocked) {
      setFirstRun(false);
      return;
    }
    vaultExists().then(
      (exists) => setFirstRun(!exists),
      () => setLoadError("서버에서 볼트를 불러오지 못했습니다."),
    );
  }, [unlocked]);

  useEffect(() => {
    if (!isCryptoAvailable()) return;
    return onVaultEvent((event) => {
      if (event === "wiped") setFirstRun(true);
    });
  }, []);

  const handledAttach = useRef<PendingAttach | null>(null);
  useEffect(() => {
    if (!pendingAttach || handledAttach.current === pendingAttach) return;
    handledAttach.current = pendingAttach;
    const session = new SshSession(pendingAttach.hostId, ATTACH_DELEGATE, {
      joinId: pendingAttach.id,
      label: pendingAttach.label,
    });
    setCarried((current) => [...current, session]);
    clearAttach();
  }, [pendingAttach, clearAttach]);

  useEffect(() => {
    setCarried((current) => current.filter((session) => !session.released));
    return () => {
      for (const session of carriedRef.current) session.dispose();
    };
  }, []);

  if (loadError) {
    return (
      <main className="flex h-dvh items-center justify-center p-6 text-center text-sm text-destructive" role="alert">
        {loadError}
      </main>
    );
  }
  if (!unlocked && firstRun === null && carried.length === 0) return <div className="h-dvh bg-background" />;
  const vault = unlocked ? vaultRef.current : null;
  if (!vault) {
    if (carried.length > 0) {
      return (
        <LockedSessions
          sessions={carried}
          onEnd={(session) => {
            void session.end();
            setCarried((current) => current.filter((item) => item !== session));
          }}
        />
      );
    }
    return (
      <UnlockScreen
        key={String(firstRun)}
        firstRun={Boolean(firstRun)}
        onUnlocked={(opened) => {
          unlock(opened);
          setFirstRun(false);
        }}
      />
    );
  }
  return <Workspace vaultKey={vault.key} incoming={carried} onConsumeIncoming={() => setCarried([])} />;
}

function Workspace({
  vaultKey,
  incoming,
  onConsumeIncoming,
}: {
  vaultKey: CryptoKey;
  incoming: SshSession[];
  onConsumeIncoming: () => void;
}) {
  const { syncData, draft, setDraft, data, pendingOpen, clearOpen } = useVault();
  const isDesktop = useIsDesktop();
  const dataRef = useRef(data);
  dataRef.current = data;
  const [sessions, setSessions] = useState<SshSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mobileTerminalOpen, setMobileTerminalOpen] = useState(false);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [editing, setEditing] = useState<Host | "new" | null>(null);
  const [deleting, setDeleting] = useState<Host | null>(null);
  const [wiping, setWiping] = useState(false);

  const sessionsRef = useRef(sessions);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  useVisualViewportVars();

  useEffect(() => watchTerminalStyle(), []);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    setSessions((current) => current.filter((session) => !session.released));
    setActiveId((active) => {
      const kept = sessionsRef.current.filter((session) => !session.released);
      return kept.some((session) => session.id === active) ? active : (kept[0]?.id ?? null);
    });
    return () => {
      for (const session of sessionsRef.current) session.dispose();
    };
  }, []);

  const applyChange = useCallback(
    async (change: (current: VaultData) => VaultData) => {
      const next = await updateVault(vaultKey, change);
      dataRef.current = next;
      syncData(next);
    },
    [syncData, vaultKey],
  );

  useEffect(
    () =>
      onVaultEvent((event) => {
        if (event !== "changed") return;
        readVault(vaultKey).then((next) => {
          dataRef.current = next;
          syncData(next);
        });
      }),
    [syncData, vaultKey],
  );

  const enqueue = useCallback((prompt: Prompt) => setPrompts((queue) => [...queue, prompt]), []);

  const delegate = useMemo<SessionDelegate>(
    () => ({
      getHost: (hostId) => dataRef.current?.hosts.find((host) => host.id === hostId),
      getKey: (keyId) => dataRef.current?.keys.find((key) => key.id === keyId),
      checkHostKey: async (session, host, presented) => {
        const id = knownHostKey(host.hostname, host.port);
        const previous = dataRef.current?.knownHosts[id];
        if (previous?.fingerprint === presented.fingerprint) return true;
        const accepted = await new Promise<boolean>((resolve) => {
          enqueue({ kind: "hostkey", sessionId: session.id, host, presented, previous, resolve });
        });
        if (!accepted) return false;
        const record: KnownHost = { algorithm: presented.algorithm, fingerprint: presented.fingerprint };
        await applyChange((current) => ({ ...current, knownHosts: { ...current.knownHosts, [id]: record } }));
        return true;
      },
      askPassword: (session, host) =>
        new Promise((resolve) => enqueue({ kind: "password", sessionId: session.id, host, resolve })),
      askKbd: (session, host, request) =>
        new Promise((resolve) => enqueue({ kind: "kbd", sessionId: session.id, host, request, resolve })),
    }),
    [applyChange, enqueue],
  );

  const closeSession = useCallback((session: SshSession) => {
    void session.end();
    setPrompts((queue) =>
      queue.filter((prompt) => {
        if (prompt.sessionId !== session.id) return true;
        cancelPrompt(prompt);
        return false;
      }),
    );
    setSessions((current) => {
      const index = current.indexOf(session);
      const remaining = current.filter((s) => s !== session);
      setActiveId((active) =>
        active === session.id ? (remaining[Math.min(index, remaining.length - 1)]?.id ?? null) : active,
      );
      return remaining;
    });
  }, []);

  const showMobileTerminal = useCallback(() => {
    setMobileTerminalOpen(true);
    if (!window.matchMedia("(min-width: 768px)").matches) {
      if (!isMobileTerminalEntry()) history.pushState({ pswrshTerminal: true }, "");
    }
  }, []);

  const leaveMobileTerminal = useCallback(() => {
    // Pops the entry so the browser back button and the header agree.
    if (isMobileTerminalEntry()) history.back();
    else setMobileTerminalOpen(false);
  }, []);

  useEffect(() => {
    const onPop = () => setMobileTerminalOpen(isMobileTerminalEntry());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!draft?.resume) return;
    const host = draft.id ? dataRef.current?.hosts.find((item) => item.id === draft.id) : undefined;
    setEditing(host ?? "new");
    setDraft({ ...draft, resume: false, picking: false });
  }, [draft, setDraft]);

  useEffect(() => {
    if (incoming.length === 0) return;
    setSessions((current) => [...current, ...incoming]);
    setActiveId(incoming[incoming.length - 1].id);
    showMobileTerminal();
    onConsumeIncoming();
  }, [incoming, onConsumeIncoming, showMobileTerminal]);

  const addTab = useCallback(
    (session: SshSession) => {
      setSessions((current) => [...current, session]);
      setActiveId(session.id);
      showMobileTerminal();
    },
    [showMobileTerminal],
  );

  /** Always a new SSH connection: the host menu's "새 연결" and the connections page. */
  const newConnection = useCallback((host: Host) => addTab(new SshSession(host.id, delegate)), [addTab, delegate]);

  // Hosts whose click is still looking up the account's connections. A second click waits.
  const lookingUp = useRef(new Set<string>());

  /**
   * Clicking a host: its tab on this device, else the account's most recently used
   * connection to it (from any device), else a new connection.
   */
  const openHost = useCallback(
    async (host: Host) => {
      /** Switches to a tab of this host on this device that has not ended, if there is one. */
      const showOpenTab = () => {
        const tabs = sessionsRef.current.filter((s) => s.hostId === host.id && !isEnded(s.getState()));
        if (tabs.length === 0) return false;
        const tab = tabs.find((s) => s.id === activeIdRef.current) ?? tabs[tabs.length - 1];
        setActiveId(tab.id);
        showMobileTerminal();
        return true;
      };
      if (showOpenTab()) return;
      if (lookingUp.current.has(host.id)) return;
      lookingUp.current.add(host.id);
      try {
        const result = await fetchLiveSessions().catch(() => null);
        if (result === "login") {
          window.location.href = "/login";
          return;
        }
        // A tab of this host may have opened while the list loaded (the connections page, a
        // reconnect): use it instead of opening a second one.
        if (showOpenTab()) return;
        // Only tabs still connected count as shown. A tab whose socket dropped (disconnected)
        // no longer shows its connection, which the keep-alive may still hold: attach to it.
        const shownHere = new Set<string>();
        for (const s of sessionsRef.current) {
          if (isEnded(s.getState())) continue;
          const id = s.getGatewayId();
          if (id) shownHere.add(id);
        }
        const live = result ? reusableConnection(result.sessions, host.id, shownHere) : null;
        // The connection may be the one an ended tab here showed: rejoin it in that tab, so
        // one device never holds two tabs of the same shell.
        const endedTab = live
          ? sessionsRef.current.find((s) => isEnded(s.getState()) && s.getGatewayId() === live.id)
          : undefined;
        if (endedTab) {
          setActiveId(endedTab.id);
          showMobileTerminal();
          endedTab.connect();
        } else if (live) {
          addTab(new SshSession(host.id, delegate, { joinId: live.id, label: live.name }));
        } else if (result && result.sessions.length >= result.limit) {
          toast.error(`연결이 계정당 상한인 ${result.limit}개에 닿았습니다. 연결 목록에서 쓰지 않는 연결을 끊어 주세요.`);
        } else {
          // The list could not be read: the gateway answers a new connection itself.
          newConnection(host);
        }
      } finally {
        lookingUp.current.delete(host.id);
      }
    },
    [addTab, delegate, newConnection, showMobileTerminal],
  );

  const handledOpen = useRef<PendingOpen | null>(null);
  useEffect(() => {
    if (!pendingOpen || handledOpen.current === pendingOpen) return;
    handledOpen.current = pendingOpen;
    clearOpen();
    const host = dataRef.current?.hosts.find((item) => item.id === pendingOpen.hostId);
    if (host) newConnection(host);
  }, [pendingOpen, clearOpen, newConnection]);

  const activeSession = sessions.find((session) => session.id === activeId) ?? null;
  const activeHost = activeSession ? data?.hosts.find((host) => host.id === activeSession.hostId) : undefined;

  const disconnectActive = useCallback(() => {
    if (!activeSession) return;
    closeSession(activeSession);
    leaveMobileTerminal();
  }, [activeSession, closeSession, leaveMobileTerminal]);

  if (!data) return null;

  async function saveHost(host: Host) {
    try {
      await applyChange((current) => ({
        ...current,
        hosts: current.hosts.some((h) => h.id === host.id)
          ? current.hosts.map((h) => (h.id === host.id ? host : h))
          : [...current.hosts, host],
      }));
      setEditing(null);
      setDraft(null);
    } catch {
      toast.error("호스트를 저장하지 못했습니다.");
    }
  }

  async function deleteHost(host: Host) {
    setDeleting(null);
    for (const session of sessions) {
      if (session.hostId === host.id) closeSession(session);
    }
    try {
      await applyChange((current) => ({ ...current, hosts: current.hosts.filter((h) => h.id !== host.id) }));
    } catch {
      toast.error("호스트를 삭제하지 못했습니다.");
    }
  }

  async function wipe() {
    setWiping(false);
    try {
      await wipeVault();
    } catch {
      toast.error("볼트를 지우지 못했습니다.");
    }
  }

  function answerPrompt(prompt: Prompt, answer: () => void) {
    setPrompts((queue) => queue.filter((p) => p !== prompt));
    answer();
  }

  const prompt = prompts[0];
  const noHosts = data.hosts.length === 0;
  const mobileListVisible = !isDesktop && !mobileTerminalOpen;

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside
        // Hidden from assistive tech and focus while the phone terminal covers it.
        inert={!isDesktop && !mobileListVisible}
        className="flex h-full w-full min-w-0 flex-col md:w-72 md:shrink-0 md:border-r"
      >
        <HostList
          hosts={data.hosts}
          sessions={sessions}
          activeHostId={activeSession?.hostId ?? null}
          onAdd={() => {
            setDraft(null);
            setEditing("new");
          }}
          onLock={lockVault}
          onWipe={() => setWiping(true)}
          onOpen={(host) => void openHost(host)}
          onNewConnection={newConnection}
          onEdit={(host) => {
            setDraft(null);
            setEditing(host);
          }}
          onDelete={setDeleting}
        />
      </aside>

      <main
        className={cn(
          "terminal-screen min-w-0 flex-1 flex-col bg-[#09090b]",
          mobileTerminalOpen ? "flex" : "hidden md:flex",
        )}
      >
        {activeSession && (
          <MobileHeader
            session={activeSession}
            name={activeHost?.name || activeSession.getLabel()}
            onBack={leaveMobileTerminal}
            onDisconnect={disconnectActive}
          />
        )}
        {sessions.length === 0 ? (
          <div className="hidden flex-1 flex-col items-center justify-center gap-3 text-center md:flex">
            <TerminalSquare className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {noHosts ? "호스트를 추가하면 여기에 터미널이 열립니다." : "왼쪽에서 호스트를 고르면 터미널이 열립니다."}
            </p>
          </div>
        ) : (
          <Tabs value={activeId ?? ""} onValueChange={setActiveId} className="min-h-0 flex-1 gap-0">
            <div className="hidden h-11 shrink-0 items-center gap-2 border-b bg-background px-2 md:flex">
              <TabsList className="h-8 min-w-0 flex-1 justify-start overflow-x-auto overflow-y-hidden bg-transparent p-0 [scrollbar-width:none]">
                {sessions.map((session) => (
                  <SessionTab
                    key={session.id}
                    session={session}
                    name={data.hosts.find((host) => host.id === session.hostId)?.name || session.getLabel()}
                    onClose={() => closeSession(session)}
                  />
                ))}
              </TabsList>
              <Button variant="ghost" size="sm" onClick={disconnectActive}>
                <PowerOff />
                연결 끊기
              </Button>
            </div>
            {sessions.map((session) => (
              <TabsContent
                key={session.id}
                value={session.id}
                forceMount
                className="min-h-0 flex-1 data-[state=inactive]:hidden"
              >
                <TerminalPane
                  session={session}
                  active={session.id === activeId}
                  onEditHost={() => {
                    const host = data.hosts.find((h) => h.id === session.hostId);
                    if (host) setEditing(host);
                  }}
                />
              </TabsContent>
            ))}
          </Tabs>
        )}
        {activeSession && <SpecialKeyBar session={activeSession} />}
      </main>

      {editing && (
        <HostForm
          key={editing === "new" ? "new" : editing.id}
          host={editing === "new" ? null : editing}
          keys={data.keys}
          prefill={draft}
          onCancel={() => {
            setEditing(null);
            setDraft(null);
          }}
          onSave={saveHost}
          onPick={setDraft}
        />
      )}
      {deleting && (
        <DeleteHostPrompt
          host={deleting}
          onAnswer={(confirmed) => (confirmed ? void deleteHost(deleting) : setDeleting(null))}
        />
      )}
      {wiping && <WipeVaultPrompt onAnswer={(confirmed) => (confirmed ? void wipe() : setWiping(false))} />}
      {prompt?.kind === "hostkey" && (
        <HostKeyPrompt
          host={prompt.host}
          presented={prompt.presented}
          previous={prompt.previous}
          onAnswer={(accepted) => answerPrompt(prompt, () => prompt.resolve(accepted))}
        />
      )}
      {prompt?.kind === "password" && (
        <PasswordPrompt
          host={prompt.host}
          onAnswer={(password) => answerPrompt(prompt, () => prompt.resolve(password))}
        />
      )}
      {prompt?.kind === "kbd" && (
        <KbdInteractivePrompt
          key={prompt.request.prompts.map((p) => p.prompt).join("\n")}
          host={prompt.host}
          request={prompt.request}
          onAnswer={(answers) => answerPrompt(prompt, () => prompt.resolve(answers))}
        />
      )}
      <Toaster position="top-center" />
    </div>
  );
}

function SessionTab({ session, name, onClose }: { session: SshSession; name: string; onClose: () => void }) {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const liveName = useSyncExternalStore(session.subscribe, session.getLabel);
  const shown = liveName || name || "연결";
  return (
    <div className="flex shrink-0 items-center rounded-md has-[[data-state=active]]:bg-accent">
      <TabsTrigger
        value={session.id}
        title={statusLabel(state)}
        className="h-8 flex-none gap-2 border-0 px-2.5 data-[state=active]:bg-transparent data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent"
      >
        <span className={cn("size-2 rounded-full", statusDotClass(state))} />
        <span className="max-w-40 truncate">{shown}</span>
      </TabsTrigger>
      <button
        type="button"
        onClick={onClose}
        aria-label={`${shown} 세션 닫기`}
        className="mr-1 flex size-6 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-background/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function LockedSessions({
  sessions,
  onEnd,
}: {
  sessions: SshSession[];
  onEnd: (session: SshSession) => void;
}) {
  const [activeId, setActiveId] = useState(sessions[0]?.id ?? "");
  const active = sessions.find((session) => session.id === activeId) ?? sessions[0] ?? null;
  return (
    <main className="flex h-dvh min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <Link href="/connections" className="shrink-0 text-sm underline underline-offset-4">
          연결 목록
        </Link>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {sessions.map((session) => (
            <AttachTab key={session.id} session={session} active={session.id === active?.id} onSelect={() => setActiveId(session.id)} />
          ))}
        </div>
        {active && (
          <Button variant="ghost" size="sm" onClick={() => onEnd(active)}>
            연결 끊기
          </Button>
        )}
      </header>
      {active && (
        <div className="min-h-0 flex-1">
          <TerminalPane session={active} active onEditHost={() => {}} />
        </div>
      )}
    </main>
  );
}

function AttachTab({ session, active, onSelect }: { session: SshSession; active: boolean; onSelect: () => void }) {
  const label = useSyncExternalStore(session.subscribe, session.getLabel);
  return (
    <Button variant={active ? "secondary" : "ghost"} size="sm" onClick={onSelect}>
      {label || "연결"}
    </Button>
  );
}

function MobileHeader({
  session,
  name,
  onBack,
  onDisconnect,
}: {
  session: SshSession;
  name: string;
  onBack: () => void;
  onDisconnect: () => void;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const liveName = useSyncExternalStore(session.subscribe, session.getLabel);
  const shown = liveName || name || "연결";
  return (
    <header className="flex shrink-0 items-center gap-1 border-b bg-background px-1 pt-[env(safe-area-inset-top)] md:hidden">
      <Button variant="ghost" size="icon" className="size-11" aria-label="뒤로" onClick={onBack}>
        <ChevronLeft className="size-5" />
      </Button>
      <div className="min-w-0 flex-1 py-1">
        <p className="truncate text-sm font-medium">{shown}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", statusDotClass(state))} />
          {statusLabel(state)}
        </p>
      </div>
      <Button variant="ghost" className="h-11 px-2 text-sm" onClick={onDisconnect}>
        <PowerOff />
        연결 끊기
      </Button>
    </header>
  );
}

/** Arrows and Tab tap the haptic on each press, like the touch gestures; Esc and Ctrl do not. */
const HAPTIC_KEYS: ReadonlySet<SpecialKey> = new Set(["tab", "left", "up", "down", "right"]);

const SPECIAL_KEYS_BEFORE_CTRL: { key: SpecialKey; label: string }[] = [
  { key: "esc", label: "Esc" },
  { key: "tab", label: "Tab" },
];

/** Phone only. A flex sibling of the terminal, so the terminal is fitted above it. */
function SpecialKeyBar({ session }: { session: SshSession }) {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const ctrlArmed = useSyncExternalStore(session.subscribe, session.getCtrlArmed);
  const disabled = state.status !== "connected";
  return (
    <div
      role="toolbar"
      aria-label="특수키"
      // Keeps focus in the terminal, so the on-screen keyboard stays open.
      onMouseDown={(event) => event.preventDefault()}
      className="grid shrink-0 grid-cols-3 gap-1 border-t bg-background p-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))] md:hidden"
    >
      {SPECIAL_KEYS_BEFORE_CTRL.map(({ key, label }) => (
        <Button
          key={key}
          variant="ghost"
          className="h-11 min-w-0 px-0 text-xs"
          disabled={disabled}
          onClick={() => {
            if (HAPTIC_KEYS.has(key)) haptic();
            session.sendSpecialKey(key);
          }}
        >
          {label}
        </Button>
      ))}
      <Button
        variant={ctrlArmed ? "default" : "ghost"}
        className="h-11 min-w-0 px-0 text-xs"
        aria-pressed={ctrlArmed}
        disabled={disabled}
        onClick={() => session.toggleCtrl()}
      >
        Ctrl
      </Button>
    </div>
  );
}
