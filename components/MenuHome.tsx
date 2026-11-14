"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";

export type MenuCard = { key: string; label: string; desc: string; href: string; granted?: boolean };

// 로그인한 뒤 메인에 뜨는 메뉴 선택 화면. 직급 기본 메뉴 + 최고 관리자·개발팀이 부여한 메뉴가 카드로 나온다.
export default function MenuHome({ name, roleLabel, items }: { name: string; roleLabel: string; items: MenuCard[] }) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
    router.refresh();
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 py-12">
      <div className="flex items-start gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold tracking-tight">{name}님, 안녕하세요</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">{roleLabel}</span>
            <span className="ml-2">이용할 메뉴를 골라 주세요.</span>
          </p>
        </div>
        <button type="button" onClick={logout} className="shrink-0 rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:border-blue-400 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200">
          로그아웃
        </button>
      </div>

      <div className="mt-8 grid gap-3" role="list" aria-label="메뉴">
        {items.map((m, i) => (
          <motion.div
            key={m.key}
            role="listitem"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 + i * 0.07, type: "spring", stiffness: 280, damping: 26 }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.985 }}
          >
            <Link
              href={m.href}
              className="flex items-center gap-4 rounded-2xl border border-black/10 bg-white p-5 shadow-sm transition-colors hover:border-blue-500 dark:border-white/10 dark:bg-zinc-900"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <b className="text-lg">{m.label}</b>
                  {m.granted && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">부여받음</span>
                  )}
                </span>
                <span className="mt-1 block text-sm text-zinc-500 dark:text-zinc-400">{m.desc}</span>
              </span>
              <span className="text-xl text-zinc-400" aria-hidden>→</span>
            </Link>
          </motion.div>
        ))}
      </div>
    </main>
  );
}
