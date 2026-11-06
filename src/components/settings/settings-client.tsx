"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmailForm, PasswordForm } from "@/components/settings/account-section";
import { EmailOtpForm, SecondFactorSection, TotpForm } from "@/components/settings/second-factor-section";
import { PasskeySection } from "@/components/settings/passkey-section";
import { TerminalStyleSection } from "@/components/settings/terminal-style-section";
import { KeepAliveSection, SignupSection } from "@/components/settings/session-section";
import type { AccountSettings } from "@/server/settings.ts";

export function SettingsClient() {
  const [settings, setSettings] = useState<AccountSettings | null>(null);
  const [failed, setFailed] = useState(false);

  async function reload() {
    try {
      const response = await fetch("/api/settings");
      if (response.status === 401) return void (window.location.href = "/login");
      const body = await response.json();
      setSettings(body.settings);
    } catch {
      setFailed(true);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  return (
    <main className="h-dvh overflow-y-auto">
      <div className="mx-auto flex w-full max-w-xl flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
        <header className="flex items-center gap-2 py-2">
          <Link href="/" className="-ml-2 flex size-11 items-center justify-center rounded-md hover:bg-accent" aria-label="터미널로 돌아가기">
            <ChevronLeft className="size-5" />
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">설정</h1>
        </header>
        {failed && <p className="py-6 text-sm text-destructive">설정을 불러오지 못했습니다.</p>}
        {settings && (
          <>
            <EmailForm email={settings.email} onChanged={(email) => setSettings({ ...settings, email })} />
            <PasswordForm />
            <SecondFactorSection>
              <EmailOtpForm enabled={settings.emailOtp} onChanged={(emailOtp) => setSettings({ ...settings, emailOtp })} />
              <TotpForm enabled={settings.totp} onChanged={(totp) => setSettings({ ...settings, totp })} />
            </SecondFactorSection>
            <PasskeySection passkeys={settings.passkeys} onChanged={reload} />
            <TerminalStyleSection
              initial={settings.terminalStyle}
              onSaved={(terminalStyle) => setSettings({ ...settings, terminalStyle })}
            />
            <KeepAliveSection
              minutes={settings.keepAliveMinutes}
              onChanged={(keepAliveMinutes) => setSettings({ ...settings, keepAliveMinutes })}
            />
            {settings.isAdmin && (
              <SignupSection
                enabled={Boolean(settings.signupEnabled)}
                onChanged={(signupEnabled) => setSettings({ ...settings, signupEnabled })}
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}
