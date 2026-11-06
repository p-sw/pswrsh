"use client";

import type { ReactNode } from "react";

export const ERROR_TEXT: Record<string, string> = {
  bad_password: "비밀번호가 맞지 않거나 8자보다 짧습니다.",
  too_many_attempts: "시도가 너무 많습니다. 1분 뒤 다시 하세요.",
  bad_email: "이메일 주소를 확인하세요.",
  same_email: "지금 쓰는 주소와 같습니다.",
  email_taken: "이미 다른 계정이 쓰는 주소입니다.",
  too_soon: "코드는 1분에 한 번만 보낼 수 있습니다.",
  mail_failed: "메일을 보내지 못했습니다.",
  code_invalid: "코드가 맞지 않습니다.",
  code_expired: "코드가 만료됐거나 너무 많이 틀렸습니다. 다시 받으세요.",
  network: "서버에 연결하지 못했습니다.",
};

export function errorText(code: string | undefined) {
  return ERROR_TEXT[code ?? ""] ?? "요청을 처리하지 못했습니다.";
}

export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-b py-6 last:border-b-0">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function Status({ error, notice }: { error: string | null; notice?: string | null }) {
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (notice) return <p className="text-sm text-muted-foreground">{notice}</p>;
  return null;
}
