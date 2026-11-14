"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "motion/react";
import { MENUS, type MenuKey } from "@/lib/roles";

type Me = { kind: "root" | "member"; name: string; roleLabel: string; menus: MenuKey[] };

// 관리자 화면 공통 메뉴. 로그인한 사람이 쓸 수 있는 메뉴(직급 기본 + 부여받은 메뉴)만 보인다.
export default function AdminNav() {
  const path = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/me")
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!alive || !j) return;
        setMe({ kind: j.kind, name: j.kind === "member" ? j.member.name : j.name, roleLabel: j.roleLabel, menus: j.menus ?? [] });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/");
    router.refresh();
  }

  const items = [
    ...MENUS.filter(m => me?.menus.includes(m.key)).flatMap(m => [{ href: m.href, label: m.label }, ...(m.key === "members" ? [{ href: "/admin/partners", label: "협력업체" }] : [])]),
    ...(me?.kind === "member" ? [{ href: "/me", label: "내 정보" }] : []),
  ];

  return (
    <nav className="border-b border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900" aria-label="메뉴">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-1 px-4">
        <Link href="/" className="mr-4 py-3.5 text-sm font-extrabold" title="메뉴 선택 화면으로">빌드메이트</Link>
        {items.map(m => {
          const active = m.href === "/admin" ? path === "/admin" : path.startsWith(m.href);
          return (
            <Link
              key={m.href}
              href={m.href}
              aria-current={active ? "page" : undefined}
              className={`relative px-3 py-3.5 text-sm font-bold transition-colors ${active ? "text-blue-600 dark:text-blue-300" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
            >
              {m.label}
              {active && (
                <motion.span layoutId="adminNavUnderline" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-blue-600 dark:bg-blue-300" transition={{ type: "spring", stiffness: 420, damping: 34 }} />
              )}
            </Link>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          {me && (
            <span className="hidden text-xs text-zinc-500 sm:inline">
              {me.name} · {me.roleLabel}
            </span>
          )}
          <button type="button" onClick={logout} className="rounded-full border border-black/10 px-3 py-1.5 text-sm text-zinc-700 hover:border-blue-400 dark:border-white/10 dark:text-zinc-200">
            로그아웃
          </button>
        </div>
      </div>
    </nav>
  );
}
