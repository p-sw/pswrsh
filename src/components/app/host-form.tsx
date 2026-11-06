"use client";

import { type FormEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { ResponsiveModal } from "@/components/app/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { Host, HostAuth } from "@/lib/vault";

const MAX_KEY_FILE_BYTES = 256 * 1024;
const FORM_ID = "host-form";

type Props = {
  host: Host | null;
  onCancel: () => void;
  onSave: (host: Host) => void;
};

type Errors = Partial<Record<"hostname" | "port" | "username" | "privateKey", string>>;

export function HostForm({ host, onCancel, onSave }: Props) {
  const [name, setName] = useState(host?.name ?? "");
  const [hostname, setHostname] = useState(host?.hostname ?? "");
  const [port, setPort] = useState(String(host?.port ?? 22));
  const [username, setUsername] = useState(host?.username ?? "");
  const [authType, setAuthType] = useState<HostAuth["type"]>(host?.auth.type ?? "password");
  const [password, setPassword] = useState(host?.auth.type === "password" ? host.auth.password : "");
  const [privateKey, setPrivateKey] = useState(host?.auth.type === "key" ? host.auth.privateKey : "");
  const [keyPassphrase, setKeyPassphrase] = useState(host?.auth.type === "key" ? host.auth.passphrase : "");
  const [errors, setErrors] = useState<Errors>({});
  const fileInput = useRef<HTMLInputElement>(null);

  async function loadKeyFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_KEY_FILE_BYTES) {
      toast.error("개인키 파일이 너무 큽니다.");
      return;
    }
    setPrivateKey(await file.text());
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Errors = {};
    const portNumber = Number(port);
    if (!hostname.trim()) next.hostname = "호스트를 입력하세요.";
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      next.port = "포트는 1에서 65535 사이입니다.";
    }
    if (!username.trim()) next.username = "사용자를 입력하세요.";
    if (authType === "key" && !privateKey.trim()) next.privateKey = "개인키를 붙여넣거나 파일을 고르세요.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const auth: HostAuth =
      authType === "password"
        ? { type: "password", password }
        : authType === "key"
          ? { type: "key", privateKey, passphrase: keyPassphrase }
          : { type: "interactive" };
    onSave({
      id: host?.id ?? crypto.randomUUID(),
      name: name.trim() || hostname.trim(),
      hostname: hostname.trim(),
      port: portNumber,
      username: username.trim(),
      auth,
    });
  }

  const noAutoCorrect = { autoCapitalize: "none", autoCorrect: "off", spellCheck: false } as const;

  return (
    <ResponsiveModal
      open
      onOpenChange={(open) => !open && onCancel()}
      title={host ? "호스트 수정" : "호스트 추가"}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onCancel}>
            취소
          </Button>
          <Button type="submit" form={FORM_ID}>
            저장
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate autoComplete="off" className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="host-name">이름</Label>
          <Input
            id="host-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="비워 두면 호스트 주소를 씁니다"
            autoComplete="off"
          />
        </div>
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="host-hostname">호스트</Label>
            <Input
              id="host-hostname"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="example.com"
              inputMode="url"
              aria-invalid={Boolean(errors.hostname)}
              autoComplete="off"
              {...noAutoCorrect}
            />
            {errors.hostname && <p className="text-sm text-destructive">{errors.hostname}</p>}
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="host-port">포트</Label>
            <Input
              id="host-port"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              inputMode="numeric"
              aria-invalid={Boolean(errors.port)}
              autoComplete="off"
            />
          </div>
        </div>
        {errors.port && <p className="text-sm text-destructive">{errors.port}</p>}
        <div className="flex flex-col gap-2">
          <Label htmlFor="host-username">사용자</Label>
          <Input
            id="host-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-invalid={Boolean(errors.username)}
            autoComplete="off"
            {...noAutoCorrect}
          />
          {errors.username && <p className="text-sm text-destructive">{errors.username}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <Label>인증 방식</Label>
          <Tabs value={authType} onValueChange={(value) => setAuthType(value as HostAuth["type"])}>
            <TabsList className="grid h-10 w-full grid-cols-3">
              <TabsTrigger value="password">비밀번호</TabsTrigger>
              <TabsTrigger value="key">개인키</TabsTrigger>
              <TabsTrigger value="interactive">대화형</TabsTrigger>
            </TabsList>
            <TabsContent value="password" className="flex flex-col gap-2 pt-2">
              <Label htmlFor="host-password">비밀번호</Label>
              <Input
                id="host-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <p className="text-sm text-muted-foreground">비워 두면 접속할 때 묻습니다.</p>
            </TabsContent>
            <TabsContent value="key" className="flex flex-col gap-2 pt-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="host-key">개인키</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                  파일 선택
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  className="hidden"
                  aria-label="개인키 파일"
                  onChange={(e) => {
                    void loadKeyFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
              <Textarea
                id="host-key"
                rows={5}
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                aria-invalid={Boolean(errors.privateKey)}
                className="max-h-48 font-mono text-xs"
                {...noAutoCorrect}
              />
              {errors.privateKey && <p className="text-sm text-destructive">{errors.privateKey}</p>}
              <Label htmlFor="host-key-passphrase" className="pt-2">
                키 패스프레이즈 (선택)
              </Label>
              <Input
                id="host-key-passphrase"
                type="password"
                value={keyPassphrase}
                onChange={(e) => setKeyPassphrase(e.target.value)}
                autoComplete="new-password"
              />
            </TabsContent>
            <TabsContent value="interactive" className="pt-2">
              <p className="text-sm text-muted-foreground">서버의 질문을 접속할 때 대화상자로 받습니다.</p>
            </TabsContent>
          </Tabs>
        </div>
      </form>
    </ResponsiveModal>
  );
}
