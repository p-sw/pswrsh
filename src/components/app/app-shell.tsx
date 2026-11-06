"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
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
import { type KbdRequest, type SessionDelegate, type SpecialKey, SshSession } from "@/lib/session";
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

type Vault = { key: CryptoKey; data: VaultData };

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
  const [firstRun, setFirstRun] = useState<boolean | null>(null);
  // Not state: React keeps the previous hook state on the alternate fiber, which would
  // keep the key and the decrypted data reachable after locking. A ref can be emptied.
  const vaultRef = useRef<Vault | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isCryptoAvailable()) {
      setLoadError("이 주소에서는 브라우저 암호화를 쓸 수 없습니다. localhost 또는 HTTPS로 여세요.");
      return;
    }
    vaultExists().then(
      (exists) => setFirstRun(!exists),
      () => setLoadError("브라우저 저장소를 열 수 없습니다."),
    );
  }, []);

  // Dropping the vault unmounts Workspace, which ends its sessions and releases the key.
  useEffect(() => {
    if (!isCryptoAvailable()) return;
    return onVaultEvent((event) => {
      if (event === "changed") return;
      vaultRef.current = null;
      setUnlocked(false);
      if (event === "wiped") setFirstRun(true);
    });
  }, []);

  if (loadError) {
    return (
      <main className="flex h-dvh items-center justify-center p-6 text-center text-sm text-destructive" role="alert">
        {loadError}
      </main>
    );
  }
  if (firstRun === null) return <div className="h-dvh bg-background" />;
  const vault = unlocked ? vaultRef.current : null;
  if (!vault) {
    return (
      <UnlockScreen
        key={String(firstRun)}
        firstRun={firstRun}
        onUnlocked={(opened) => {
          vaultRef.current = opened;
          setFirstRun(false);
          setUnlocked(true);
        }}
      />
    );
  }
  return <Workspace vaultKey={vault.key} initialData={vault.data} />;
}

function Workspace({ vaultKey, initialData }: { vaultKey: CryptoKey; initialData: VaultData }) {
  const isDesktop = useIsDesktop();
  const [data, setData] = useState(initialData);
  const dataRef = useRef(data);
  const [sessions, setSessions] = useState<SshSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mobileTerminalOpen, setMobileTerminalOpen] = useState(false);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [editing, setEditing] = useState<Host | "new" | null>(null);
  const [deleting, setDeleting] = useState<Host | null>(null);
  const [wiping, setWiping] = useState(false);

  const sessionsRef = useRef(sessions);

  useVisualViewportVars();

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(
    () => () => {
      for (const session of sessionsRef.current) session.dispose();
    },
    [],
  );

  const applyChange = useCallback(
    async (change: (current: VaultData) => VaultData) => {
      const next = await updateVault(vaultKey, change);
      dataRef.current = next;
      setData(next);
    },
    [vaultKey],
  );

  useEffect(
    () =>
      onVaultEvent((event) => {
        if (event !== "changed") return;
        readVault(vaultKey).then((next) => {
          dataRef.current = next;
          setData(next);
        });
      }),
    [vaultKey],
  );

  const enqueue = useCallback((prompt: Prompt) => setPrompts((queue) => [...queue, prompt]), []);

  const delegate = useMemo<SessionDelegate>(
    () => ({
      getHost: (hostId) => dataRef.current.hosts.find((host) => host.id === hostId),
      checkHostKey: async (session, host, presented) => {
        const id = knownHostKey(host.hostname, host.port);
        const previous = dataRef.current.knownHosts[id];
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
    session.dispose();
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

  const openHost = useCallback(
    (host: Host) => {
      const existing = sessions.find((session) => session.hostId === host.id);
      const session = existing ?? new SshSession(host.id, delegate);
      if (!existing) setSessions((current) => [...current, session]);
      setActiveId(session.id);
      showMobileTerminal();
    },
    [delegate, sessions, showMobileTerminal],
  );

  const activeSession = sessions.find((session) => session.id === activeId) ?? null;
  const activeHost = activeSession ? data.hosts.find((host) => host.id === activeSession.hostId) : undefined;

  const disconnectActive = useCallback(() => {
    if (!activeSession) return;
    closeSession(activeSession);
    leaveMobileTerminal();
  }, [activeSession, closeSession, leaveMobileTerminal]);

  async function saveHost(host: Host) {
    try {
      await applyChange((current) => ({
        ...current,
        hosts: current.hosts.some((h) => h.id === host.id)
          ? current.hosts.map((h) => (h.id === host.id ? host : h))
          : [...current.hosts, host],
      }));
      setEditing(null);
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
          onAdd={() => setEditing("new")}
          onLock={lockVault}
          onWipe={() => setWiping(true)}
          onOpen={openHost}
          onEdit={setEditing}
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
            name={activeHost?.name ?? ""}
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
                    name={data.hosts.find((host) => host.id === session.hostId)?.name ?? ""}
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
          host={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={saveHost}
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
  return (
    <div className="flex shrink-0 items-center rounded-md has-[[data-state=active]]:bg-accent">
      <TabsTrigger
        value={session.id}
        title={statusLabel(state)}
        className="h-8 flex-none gap-2 border-0 px-2.5 data-[state=active]:bg-transparent data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent"
      >
        <span className={cn("size-2 rounded-full", statusDotClass(state))} />
        <span className="max-w-40 truncate">{name}</span>
      </TabsTrigger>
      <button
        type="button"
        onClick={onClose}
        aria-label={`${name} 세션 닫기`}
        className="mr-1 flex size-6 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-background/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <X className="size-3.5" />
      </button>
    </div>
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
  return (
    <header className="flex shrink-0 items-center gap-1 border-b bg-background px-1 pt-[env(safe-area-inset-top)] md:hidden">
      <Button variant="ghost" size="icon" className="size-11" aria-label="뒤로" onClick={onBack}>
        <ChevronLeft className="size-5" />
      </Button>
      <div className="min-w-0 flex-1 py-1">
        <p className="truncate text-sm font-medium">{name}</p>
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

const SPECIAL_KEYS_BEFORE_CTRL: { key: SpecialKey; label: string }[] = [
  { key: "esc", label: "Esc" },
  { key: "tab", label: "Tab" },
];

const ARROW_KEYS: { key: SpecialKey; label: string; icon: typeof ArrowLeft }[] = [
  { key: "left", label: "왼쪽", icon: ArrowLeft },
  { key: "up", label: "위", icon: ArrowUp },
  { key: "down", label: "아래", icon: ArrowDown },
  { key: "right", label: "오른쪽", icon: ArrowRight },
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
      className="grid shrink-0 grid-cols-7 gap-1 border-t bg-background p-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))] md:hidden"
    >
      {SPECIAL_KEYS_BEFORE_CTRL.map(({ key, label }) => (
        <Button
          key={key}
          variant="ghost"
          className="h-11 min-w-0 px-0 text-xs"
          disabled={disabled}
          onClick={() => session.sendSpecialKey(key)}
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
      {ARROW_KEYS.map(({ key, label, icon: Icon }) => (
        <Button
          key={key}
          variant="ghost"
          className="h-11 min-w-0 px-0"
          aria-label={label}
          disabled={disabled}
          onClick={() => session.sendSpecialKey(key)}
        >
          <Icon />
        </Button>
      ))}
    </div>
  );
}
