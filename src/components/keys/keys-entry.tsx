"use client";

import dynamic from "next/dynamic";

export const KeysEntry = dynamic(() => import("./keys-client").then((mod) => mod.KeysClient), {
  ssr: false,
  loading: () => <div className="h-dvh bg-background" />,
});
