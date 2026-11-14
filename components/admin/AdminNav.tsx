"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "motion/react";
import PasswordChangeButton from "@/components/PasswordChange";
import LoginIdChangeButton from "@/components/LoginIdChange";
import { isStaffAdmin, MENUS, type MenuKey } from "@/lib/roles";

type Me = { kind: "root" | "member"; name: string; roleLabel: string; menus: MenuKey[]; temp: boolean; idChange: false | "once" | "unlimited" };

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
        setMe({ kind: j.kind, name: j.kind === "member" ? j.member.name : j.name, roleLabel: j.roleLabel, menus: j.menus ?? [], temp: j.kind === "member" && !!j.member.mustChangePassword, idChange: j.kind !== "member" ? false : isStaffAdmin(j.member.role) ? "unlimited" : j.member.idChanged ? false : "once" });
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
    ...MENUS.filter(m => me?.menus.includes(m.key)).flatMap(m => [{ href: m.href, label: m.label }, ...(m.key === "members" ? [{ href: "/admin/partners", label: "거래처" }] : [])]),
  ];

  return (
    <nav className="border-b border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900" aria-label="메뉴">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-1 px-4">
        <Link href="/" className="order-1 mr-4 shrink-0 whitespace-nowrap py-3 text-sm font-extrabold sm:order-none sm:py-3.5" title="메뉴 선택 화면으로">빌드메이트</Link>
        <div className="no-scrollbar order-3 -mx-4 flex w-[calc(100%+2rem)] items-center gap-1 overflow-x-auto px-4 sm:order-none sm:mx-0 sm:w-auto sm:px-0">
        {items.map(m => {
          const active = m.href === "/admin" ? path === "/admin" : path.startsWith(m.href);
          return (
            <Link
              key={m.href}
              href={m.href}
              aria-current={active ? "page" : undefined}
              className={`relative shrink-0 whitespace-nowrap px-3 py-3 text-sm font-bold transition-colors sm:py-3.5 ${active ? "text-blue-600 dark:text-blue-300" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
            >
              {m.label}
              {active && (
                <motion.span layoutId="adminNavUnderline" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-blue-600 dark:bg-blue-300" transition={{ type: "spring", stiffness: 420, damping: 34 }} />
              )}
            </Link>
          );
        })}
        </div>
        <div className="order-2 ml-auto flex items-center gap-1.5 sm:order-none sm:gap-2">
          {me && (
            <span className="hidden text-xs text-zinc-500 sm:inline">
              {me.name} · {me.roleLabel}
            </span>
          )}
          {me?.idChange && <LoginIdChangeButton temp={me.temp} unlimited={me.idChange === "unlimited"} className="shrink-0 whitespace-nowrap rounded-full border border-black/10 px-2.5 py-1 text-xs text-zinc-700 sm:px-3 sm:py-1.5 sm:text-sm hover:border-blue-400 dark:border-white/10 dark:text-zinc-200" />}
          {me?.kind === "member" && <PasswordChangeButton temp={me.temp} className="shrink-0 whitespace-nowrap rounded-full border border-black/10 px-2.5 py-1 text-xs text-zinc-700 sm:px-3 sm:py-1.5 sm:text-sm hover:border-blue-400 dark:border-white/10 dark:text-zinc-200" />}
          <button type="button" onClick={logout} className="shrink-0 whitespace-nowrap rounded-full border border-black/10 px-2.5 py-1 text-xs text-zinc-700 sm:px-3 sm:py-1.5 sm:text-sm hover:border-blue-400 dark:border-white/10 dark:text-zinc-200">
            로그아웃
          </button>
        </div>
      </div>
    </nav>
  );
}
