"use client";

import { type FormEvent, useState } from "react";
import { Field, FormError } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/api";

const SECURITY_OPTIONS = [
  { value: "starttls", label: "STARTTLS (보통 587)" },
  { value: "tls", label: "TLS (보통 465)" },
  { value: "none", label: "암호화 없음" },
];

function errorText(code: string | undefined) {
  if (!code) return "요청을 처리하지 못했습니다.";
  if (code === "bad_token") return "셋업 토큰이 맞지 않습니다.";
  if (code === "bad_email") return "관리자 이메일을 확인하세요.";
  if (code === "bad_password") return "비밀번호는 8자 이상이어야 합니다.";
  if (code === "bad_smtp") return "SMTP 설정을 확인하세요.";
  if (code === "smtp_not_tested") return "지금 입력한 SMTP 설정으로 테스트 메일을 먼저 보내세요.";
  if (code.startsWith("smtp_failed")) return `테스트 메일을 보내지 못했습니다. (${code.split(":")[1] ?? "오류"})`;
  if (code === "network") return "서버에 연결하지 못했습니다.";
  return "요청을 처리하지 못했습니다.";
}

export function SetupForm() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [smtp, setSmtp] = useState({ host: "", port: "587", security: "starttls", username: "", password: "", fromAddress: "" });
  const [testedWith, setTestedWith] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const smtpBody = { ...smtp, port: Number(smtp.port) };
  const smtpKey = JSON.stringify(smtpBody) + email;
  const tested = testedWith === smtpKey;
  const setField = (key: keyof typeof smtp) => (event: { target: { value: string } }) =>
    setSmtp((current) => ({ ...current, [key]: event.target.value }));

  async function sendTest() {
    setError(null);
    setNotice(null);
    setBusy(true);
    const result = await postJson("/api/setup/test-mail", { token, email, smtp: smtpBody });
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    setTestedWith(smtpKey);
    setNotice(`${email}로 테스트 메일을 보냈습니다. 받았는지 확인하세요.`);
  }

  async function complete(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) return setError("두 비밀번호가 같지 않습니다.");
    setBusy(true);
    const result = await postJson("/api/setup/complete", { token, email, password, smtp: smtpBody });
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    window.location.href = "/";
  }

  return (
    <form onSubmit={complete} className="flex flex-col gap-4" autoComplete="off">
      <Field id="setup-token" label="셋업 토큰">
        <Input id="setup-token" value={token} onChange={(e) => setToken(e.target.value)} className="h-11 font-mono" spellCheck={false} autoCapitalize="none" />
      </Field>
      <p className="-mt-2 text-xs text-muted-foreground">서버의 데이터 폴더에 있는 setup-token 파일이나 서비스 로그에서 확인합니다.</p>
      <Field id="setup-email" label="관리자 이메일">
        <Input id="setup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" autoCapitalize="none" />
      </Field>
      <Field id="setup-password" label="관리자 비밀번호">
        <Input id="setup-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" autoComplete="new-password" />
      </Field>
      <Field id="setup-password-confirm" label="비밀번호 확인">
        <Input id="setup-password-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-11" autoComplete="new-password" />
      </Field>
      <h2 className="pt-2 text-base font-semibold">SMTP</h2>
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <Field id="smtp-host" label="호스트">
          <Input id="smtp-host" value={smtp.host} onChange={setField("host")} className="h-11" autoCapitalize="none" spellCheck={false} />
        </Field>
        <Field id="smtp-port" label="포트">
          <Input id="smtp-port" value={smtp.port} onChange={setField("port")} className="h-11" inputMode="numeric" />
        </Field>
      </div>
      <Field id="smtp-security" label="보안 방식">
        <select
          id="smtp-security"
          value={smtp.security}
          onChange={setField("security")}
          className="h-11 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          {SECURITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value} className="bg-popover">
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <Field id="smtp-username" label="사용자 (선택)">
        <Input id="smtp-username" value={smtp.username} onChange={setField("username")} className="h-11" autoCapitalize="none" spellCheck={false} />
      </Field>
      <Field id="smtp-password" label="SMTP 비밀번호 (선택)">
        <Input id="smtp-password" type="password" value={smtp.password} onChange={setField("password")} className="h-11" autoComplete="new-password" />
      </Field>
      <Field id="smtp-from" label="보내는 주소">
        <Input id="smtp-from" type="email" value={smtp.fromAddress} onChange={setField("fromAddress")} className="h-11" autoCapitalize="none" />
      </Field>
      <FormError message={error} />
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={sendTest}>
        테스트 메일 보내기
      </Button>
      <Button type="submit" className="h-11" disabled={busy || !tested}>
        셋업 완료
      </Button>
    </form>
  );
}
