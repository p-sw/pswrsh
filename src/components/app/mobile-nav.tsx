"use client";

import { cn } from "cn";
import { Cable, KeyRound, Server, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "호스트", icon: Server },
  { href: "/connections", label: "연결", icon: Cable },
  { href: "/keys", label: "키", icon: KeyRound },
  { href: "/settings", label: "설정", icon: Settings },
] as const;

/**
 * Phone only (under 768px): the app's top-level pages, as the last flex child of each
 * page so the content scrolls above it. Wider screens keep the host list's header menu.
 */
export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="주요 메뉴"
      className="grid shrink-0 grid-cols-4 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const current = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "flex h-14 flex-col items-center justify-center gap-0.5 text-xs outline-none focus-visible:bg-accent",
              current ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            <Icon className={cn("size-5", current && "text-primary")} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
