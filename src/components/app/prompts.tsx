"use client";

import { type FormEvent, useState } from "react";
import { ResponsiveModal } from "@/components/app/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { KbdRequest } from "@/lib/session";
import type { Host, KnownHost } from "@/lib/vault";

function Fingerprint({ label, value, algorithm }: { label: string; value: string; algorithm: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium">
        {label} <span className="font-normal text-muted-foreground">({algorithm})</span>
      </p>
      <code className="rounded-md bg-muted px-3 py-2 font-mono text-xs break-all select-all">{value}</code>
    </div>
  );
}

export function HostKeyPrompt({
  host,
  presented,
  previous,
  onAnswer,
}: {
  host: Host;
  presented: KnownHost;
  previous?: KnownHost;
  onAnswer: (accepted: boolean) => void;
}) {
  const address = `${host.hostname}:${host.port}`;
  return (
    <ResponsiveModal
      open
      onOpenChange={(open) => !open && onAnswer(false)}
      title={previous ? "호스트 키가 바뀌었습니다" : "처음 접속하는 호스트입니다"}
      description={
        previous
          ? `${address}의 키가 저장된 값과 다릅니다. 서버를 다시 설치했을 수도 있지만, 누군가 연결을 가로채고 있을 수도 있습니다. 확실하지 않으면 접속하지 마세요.`
          : `${address}의 지문이 맞는지 확인하세요. 수락하면 볼트에 저장합니다.`
      }
      footer={
        previous ? (
          <>
            <Button variant="outline" onClick={() => onAnswer(false)}>
              접속 안 함
            </Button>
            <Button variant="destructive" onClick={() => onAnswer(true)}>
              새 키로 교체하고 접속
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={() => onAnswer(false)}>
              거부
            </Button>
            <Button onClick={() => onAnswer(true)}>수락하고 접속</Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {previous && <Fingerprint label="저장된 지문" value={previous.fingerprint} algorithm={previous.algorithm} />}
        <Fingerprint
          label={previous ? "새 지문" : "SHA256 지문"}
          value={presented.fingerprint}
          algorithm={presented.algorithm}
        />
      </div>
    </ResponsiveModal>
  );
}

export function PasswordPrompt({ host, onAnswer }: { host: Host; onAnswer: (password: string | null) => void }) {
  const [password, setPassword] = useState("");
  const formId = "password-prompt";
  return (
    <ResponsiveModal
      open
      onOpenChange={(open) => !open && onAnswer(null)}
      title="비밀번호 입력"
      description={`${host.username}@${host.hostname}. 입력한 비밀번호는 저장하지 않습니다.`}
      footer={
        <>
          <Button variant="outline" onClick={() => onAnswer(null)}>
            취소
          </Button>
          <Button type="submit" form={formId}>
            접속
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          onAnswer(password);
        }}
      >
        <Label htmlFor="prompt-password">비밀번호</Label>
        <Input
          id="prompt-password"
          type="password"
          autoFocus
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </form>
    </ResponsiveModal>
  );
}

export function KbdInteractivePrompt({
  host,
  request,
  onAnswer,
}: {
  host: Host;
  request: KbdRequest;
  onAnswer: (answers: string[] | null) => void;
}) {
  const [answers, setAnswers] = useState<string[]>(() => request.prompts.map(() => ""));
  const formId = "kbd-prompt";
  return (
    <ResponsiveModal
      open
      onOpenChange={(open) => !open && onAnswer(null)}
      title={request.name || "서버 질문"}
      description={request.instructions || `${host.username}@${host.hostname}`}
      footer={
        <>
          <Button variant="outline" onClick={() => onAnswer(null)}>
            취소
          </Button>
          <Button type="submit" form={formId}>
            보내기
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          onAnswer(answers);
        }}
      >
        {request.prompts.map((prompt, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Label htmlFor={`kbd-${index}`}>{prompt.prompt}</Label>
            <Input
              id={`kbd-${index}`}
              type={prompt.echo ? "text" : "password"}
              autoFocus={index === 0}
              autoComplete="off"
              autoCapitalize="none"
              value={answers[index]}
              onChange={(e) => setAnswers((prev) => prev.map((value, i) => (i === index ? e.target.value : value)))}
            />
          </div>
        ))}
      </form>
    </ResponsiveModal>
  );
}

export function DeleteHostPrompt({ host, onAnswer }: { host: Host; onAnswer: (confirmed: boolean) => void }) {
  return (
    <ResponsiveModal
      open
      onOpenChange={(open) => !open && onAnswer(false)}
      title="호스트 삭제"
      description={`${host.name}을(를) 삭제합니다. 저장된 비밀도 함께 지워지고 열린 세션은 끊깁니다.`}
      footer={
        <>
          <Button variant="outline" onClick={() => onAnswer(false)}>
            취소
          </Button>
          <Button variant="destructive" onClick={() => onAnswer(true)}>
            삭제
          </Button>
        </>
      }
    />
  );
}

export function WipeVaultPrompt({ onAnswer }: { onAnswer: (confirmed: boolean) => void }) {
  return (
    <ResponsiveModal
      open
      onOpenChange={(open) => !open && onAnswer(false)}
      title="볼트 지우기"
      description="이 브라우저의 호스트와 키가 삭제됩니다. 되돌릴 수 없습니다."
      footer={
        <>
          <Button variant="outline" onClick={() => onAnswer(false)}>
            취소
          </Button>
          <Button variant="destructive" onClick={() => onAnswer(true)}>
            볼트 지우기
          </Button>
        </>
      }
    />
  );
}

/** Shown when the browser refuses clipboard reads. */
export function PastePrompt({ onAnswer }: { onAnswer: (text: string | null) => void }) {
  const [text, setText] = useState("");
  return (
    <ResponsiveModal
      open
      onOpenChange={(open) => !open && onAnswer(null)}
      title="붙여넣기"
      description="브라우저가 클립보드 읽기를 막았습니다. 아래 칸에 붙여넣으면 터미널로 보냅니다."
      footer={
        <>
          <Button variant="outline" onClick={() => onAnswer(null)}>
            취소
          </Button>
          <Button disabled={!text} onClick={() => onAnswer(text)}>
            보내기
          </Button>
        </>
      }
    >
      <Textarea
        autoFocus
        rows={5}
        aria-label="붙여넣을 내용"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="font-mono"
      />
    </ResponsiveModal>
  );
}
