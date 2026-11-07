"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ResponsiveModal } from "@/components/app/responsive-modal";
import { UnlockScreen } from "@/components/app/unlock-screen";
import { useVault } from "@/components/app/vault-provider";
import { MobileNav } from "@/components/app/mobile-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import { echoInstallCommand, generateSshKey, keyErrorMessage, parsePrivateKey, replaceComment } from "@/lib/ssh-key";
import { isCryptoAvailable, readVault, updateVault, vaultExists, type SshKey, type VaultData } from "@/lib/vault";

const MAX_KEY_FILE_BYTES = 256 * 1024;

function typeLabel(type: string) {
  if (type === "ssh-ed25519") return "ed25519";
  if (type === "ecdsa-sha2-nistp256") return "ECDSA P-256";
  if (type === "ecdsa-sha2-nistp384") return "ECDSA P-384";
  if (type === "ecdsa-sha2-nistp521") return "ECDSA P-521";
  if (type === "ssh-rsa") return "rsa";
  return type;
}

function when(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label}를 복사했습니다.`);
  } catch {
    toast.error("복사하지 못했습니다.");
  }
}

export function KeysClient() {
  const { vaultRef, unlocked, restoring, unlock } = useVault();
  const [firstRun, setFirstRun] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  if (loadError) {
    return (
      <main className="flex h-dvh items-center justify-center p-6 text-center text-sm text-destructive" role="alert">
        {loadError}
      </main>
    );
  }
  const vault = unlocked ? vaultRef.current : null;
  if (!vault) {
    if (firstRun === null || restoring) return <div className="h-dvh bg-background" />;
    return <UnlockScreen key={String(firstRun)} firstRun={firstRun} onUnlocked={unlock} />;
  }
  return <KeysPage vaultKey={vault.key} initialData={vault.data} />;
}

function KeysPage({ vaultKey, initialData }: { vaultKey: CryptoKey; initialData: VaultData }) {
  const router = useRouter();
  const { syncData, draft, setDraft } = useVault();
  const [data, setData] = useState(initialData);
  const rev = useRef(0);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [revealed, setRevealed] = useState<SshKey | null>(null);
  const [removing, setRemoving] = useState<SshKey | null>(null);

  useEffect(() => {
    const ticket = ++rev.current;
    readVault(vaultKey).then((next) => {
      if (ticket !== rev.current) return;
      syncData(next);
      setData(next);
    });
  }, [syncData, vaultKey]);

  async function apply(change: (current: VaultData) => VaultData) {
    const ticket = ++rev.current;
    const next = await updateVault(vaultKey, change);
    if (ticket !== rev.current) return next;
    syncData(next);
    setData(next);
    return next;
  }

  function choose(key: SshKey) {
    if (!draft) return;
    setDraft({ ...draft, authType: "key", keyId: key.id, picking: false, resume: true });
    router.push("/");
  }

  const picking = Boolean(draft?.picking);
  const usedBy = (key: SshKey) => data.hosts.filter((host) => host.auth.type === "key" && host.auth.keyId === key.id);

  return (
    <div className="flex h-dvh flex-col">
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-xl flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-8 md:pb-[max(2rem,env(safe-area-inset-bottom))]">
          <header className="flex items-center gap-2 py-2">
            <Link
              href="/"
              className="-ml-2 flex size-11 items-center justify-center rounded-md hover:bg-accent"
              aria-label="터미널로 돌아가기"
              onClick={() => {
                if (draft?.picking) setDraft({ ...draft, picking: false, resume: true });
              }}
            >
              <ChevronLeft className="size-5" />
            </Link>
            <h1 className="text-xl font-semibold tracking-tight">키 관리</h1>
          </header>
          <div className="flex gap-2 py-3">
            <Button type="button" onClick={() => setCreating(true)}>
              키 만들기
            </Button>
            <Button type="button" variant="outline" onClick={() => setImporting(true)}>
              키 불러오기
            </Button>
          </div>
          {data.keys.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">저장된 키가 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.keys.map((key) => (
                <li key={key.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{key.name}</p>
                      <p className="text-sm text-muted-foreground">{typeLabel(key.type)}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">{key.fingerprint || "지문 없음"}</p>
                      <p className="text-xs text-muted-foreground">{when(key.createdAt)}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {picking && (
                      <Button type="button" size="sm" onClick={() => choose(key)}>
                        이 키 사용
                      </Button>
                    )}
                    <Button type="button" size="sm" variant="outline" onClick={() => setRevealed(key)} disabled={!key.publicKey}>
                      공개키
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => void copyPublic(key)}>
                      공개키 복사
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => copyEcho(key)}>
                      설치 명령 복사
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setRemoving(key)}>
                      삭제
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {creating && (
          <CreateKeyDialog
            onCancel={() => setCreating(false)}
            onCreate={async (name, comment) => {
              const parsed = await generateSshKey(comment);
              const record: SshKey = {
                id: crypto.randomUUID(),
                name,
                comment: parsed.comment,
                type: parsed.type,
                publicKey: parsed.publicKey,
                fingerprint: parsed.fingerprint,
                privateKey: parsed.privateKey,
                passphrase: "",
                createdAt: new Date().toISOString(),
              };
              await apply((current) => ({ ...current, keys: [...current.keys, record] }));
              setCreating(false);
              setRevealed(record);
            }}
          />
        )}
        {importing && (
          <ImportKeyDialog
            onCancel={() => setImporting(false)}
            onImport={async (name, source, passphrase) => {
              const parsed = await parsePrivateKey(source, passphrase);
              const record: SshKey = {
                id: crypto.randomUUID(),
                name,
                comment: parsed.comment,
                type: parsed.type,
                publicKey: parsed.publicKey,
                fingerprint: parsed.fingerprint,
                privateKey: parsed.privateKey,
                passphrase,
                createdAt: new Date().toISOString(),
              };
              await apply((current) => ({ ...current, keys: [...current.keys, record] }));
              setImporting(false);
              setRevealed(record);
            }}
          />
        )}
        {revealed && (
          <PublicKeyDialog
            sshKey={data.keys.find((key) => key.id === revealed.id) ?? revealed}
            onClose={() => setRevealed(null)}
            onComment={async (comment) => {
              const current = data.keys.find((key) => key.id === revealed.id) ?? revealed;
              const publicKey = replaceComment(current.publicKey, comment);
              const next = await apply((vault) => ({
                ...vault,
                keys: vault.keys.map((key) => (key.id === current.id ? { ...key, comment, publicKey } : key)),
              }));
              setRevealed(next.keys.find((key) => key.id === current.id) ?? null);
            }}
          />
        )}
        {removing && (
          <DeleteKeyDialog
            sshKey={removing}
            hosts={usedBy(removing)}
            onCancel={() => setRemoving(null)}
            onConfirm={async () => {
              const id = removing.id;
              await apply((current) => ({
                ...current,
                keys: current.keys.filter((key) => key.id !== id),
                hosts: current.hosts.map((host) =>
                  host.auth.type === "key" && host.auth.keyId === id ? { ...host, auth: { type: "key", keyId: "" } } : host,
                ),
              }));
              setRemoving(null);
              if (revealed?.id === id) setRevealed(null);
            }}
          />
        )}
        <Toaster position="top-center" />
      </main>
      {/* Picking a key for the host form: leave only through the back button, which returns to the form. */}
      {!picking && <MobileNav />}
    </div>
  );
}

function copyPublic(key: SshKey) {
  if (!key.publicKey) {
    toast.error("이 키의 공개키를 계산하지 못했습니다.");
    return;
  }
  return copyText(key.publicKey, "공개키");
}

function copyEcho(key: SshKey) {
  if (!key.publicKey) {
    toast.error("이 키의 공개키를 계산하지 못했습니다.");
    return;
  }
  const command = echoInstallCommand(key.publicKey);
  if (!command) {
    toast.error("주석에 작은따옴표가 있어 명령을 만들 수 없습니다. 주석을 바꾸세요.");
    return;
  }
  return copyText(command, "설치 명령");
}

function CreateKeyDialog({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (name: string, comment: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("이름을 입력하세요.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim(), comment.trim());
    } catch (caught) {
      setBusy(false);
      setError(keyErrorMessage(caught));
    }
  }

  return (
    <ResponsiveModal
      open
      onOpenChange={(open) => !open && !busy && onCancel()}
      title="키 만들기"
      description="브라우저에서 키를 만듭니다. 비공개키는 이 볼트에만 저장됩니다."
      footer={
        <>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            취소
          </Button>
          <Button type="submit" form="create-key" disabled={busy}>
            만들기
          </Button>
        </>
      }
    >
      <form id="create-key" onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="key-name">이름</Label>
          <Input id="key-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="key-comment">주석</Label>
          <Input id="key-comment" value={comment} onChange={(event) => setComment(event.target.value)} autoComplete="off" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>
    </ResponsiveModal>
  );
}

function ImportKeyDialog({
  onCancel,
  onImport,
}: {
  onCancel: () => void;
  onImport: (name: string, source: string, passphrase: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_KEY_FILE_BYTES) {
      setError("개인키 파일이 너무 큽니다.");
      return;
    }
    setSource(await file.text());
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("이름을 입력하세요.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onImport(name.trim(), source, passphrase);
    } catch (caught) {
      setBusy(false);
      setError(keyErrorMessage(caught));
    }
  }

  return (
    <ResponsiveModal
      open
      onOpenChange={(open) => !open && !busy && onCancel()}
      title="키 불러오기"
      description="OpenSSH 개인키를 붙여넣거나 파일로 고릅니다. 암호가 있으면 함께 입력합니다."
      footer={
        <>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            취소
          </Button>
          <Button type="submit" form="import-key-form" disabled={busy}>
            불러오기
          </Button>
        </>
      }
    >
      <form id="import-key-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="import-name">이름</Label>
          <Input id="import-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="import-key">개인키</Label>
          <Button type="button" variant="outline" size="sm" asChild>
            <label>
              파일 선택
              <input
                type="file"
                className="hidden"
                aria-label="개인키 파일"
                onChange={(event) => {
                  void loadFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
          </Button>
        </div>
        <Textarea
          id="import-key"
          rows={6}
          value={source}
          onChange={(event) => setSource(event.target.value)}
          className="max-h-48 font-mono text-xs"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <div className="flex flex-col gap-2">
          <Label htmlFor="import-passphrase">키 암호 (없으면 비움)</Label>
          <Input
            id="import-passphrase"
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            autoComplete="new-password"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>
    </ResponsiveModal>
  );
}

function PublicKeyDialog({
  sshKey,
  onClose,
  onComment,
}: {
  sshKey: SshKey;
  onClose: () => void;
  onComment: (comment: string) => Promise<void>;
}) {
  const [comment, setComment] = useState(sshKey.comment);
  const [busy, setBusy] = useState(false);
  const command = echoInstallCommand(sshKey.publicKey);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onComment(comment.trim());
    } catch (caught) {
      toast.error(keyErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResponsiveModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={sshKey.name}
      description="공개키입니다. 비공개키는 보여 주지 않습니다."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => void copyPublic(sshKey)}>
            공개키 복사
          </Button>
          <Button type="button" variant="outline" onClick={() => copyEcho(sshKey)}>
            설치 명령 복사
          </Button>
          <Button type="button" onClick={onClose}>
            닫기
          </Button>
        </>
      }
    >
      <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">{sshKey.publicKey}</pre>
      <form onSubmit={(event) => void save(event)} className="mt-3 flex flex-col gap-2">
        <Label htmlFor="public-comment">주석</Label>
        <div className="flex gap-2">
          <Input id="public-comment" value={comment} onChange={(event) => setComment(event.target.value)} />
          <Button type="submit" variant="outline" disabled={busy}>
            주석 저장
          </Button>
        </div>
      </form>
      {!command && <p className="mt-2 text-sm text-destructive">주석에 작은따옴표가 있어 명령을 만들 수 없습니다. 주석을 바꾸세요.</p>}
    </ResponsiveModal>
  );
}

function DeleteKeyDialog({
  sshKey,
  hosts,
  onCancel,
  onConfirm,
}: {
  sshKey: SshKey;
  hosts: { name: string }[];
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const warning =
    hosts.length > 0
      ? `이 키를 쓰는 호스트: ${hosts.map((host) => host.name).join(", ")}. 삭제하면 그 호스트의 키 연결이 끊깁니다. 되돌릴 수 없습니다.`
      : "이 키를 삭제합니다. 되돌릴 수 없습니다.";

  return (
    <ResponsiveModal
      open
      onOpenChange={(open) => !open && !busy && onCancel()}
      title="키 삭제"
      description={warning}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            취소
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onConfirm().catch(() => {
                setBusy(false);
                toast.error("키를 삭제하지 못했습니다.");
              });
            }}
          >
            삭제
          </Button>
        </>
      }
    />
  );
}
