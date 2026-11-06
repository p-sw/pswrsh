"use client";

import dynamic from "next/dynamic";

// The app needs IndexedDB, WebCrypto and xterm, all of which are browser-only.
export const ClientApp = dynamic(() => import("./app-shell").then((m) => m.AppShell), {
  ssr: false,
  loading: () => <div className="h-dvh bg-background" />,
});
