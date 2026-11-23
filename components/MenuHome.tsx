"use client";

import AdminNav from "@/components/admin/AdminNav";

export type MenuCard = { key: string; label: string; desc: string; href: string; granted?: boolean };

// 로그인한 뒤 메인 화면. 관리자 화면과 같은 상단 메뉴바(묶음 메뉴·계정 버튼)를 쓰고,
// 아래에는 이용할 수 있는 메뉴를 작은 타일로 한눈에 보여 준다.
export default function MenuHome({ name, roleLabel }: { name: string; roleLabel: string; items: MenuCard[]; idChange?: false | "once" | "unlimited"; temp?: boolean }) {
  return (
    <>
      <AdminNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <h1 className="text-xl font-extrabold tracking-tight">{name}님, 안녕하세요</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">{roleLabel}</span>
          <span className="ml-2">위 메뉴에서 이용할 메뉴를 골라 주세요.</span>
        </p>
      </main>
    </>
  );
}
