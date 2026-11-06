"use client";

import dynamic from "next/dynamic";

export const ConnectionsEntry = dynamic(() => import("./connections-client").then((mod) => mod.ConnectionsClient), {
  ssr: false,
  loading: () => <div className="h-dvh bg-background" />,
});
