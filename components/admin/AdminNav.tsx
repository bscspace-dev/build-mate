"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "motion/react";
import PasswordChangeButton from "@/components/PasswordChange";
import LoginIdChangeButton from "@/components/LoginIdChange";
import PushToggle from "@/components/admin/PushToggle";
import { Modal } from "@/components/Sheet";
import { isStaffAdmin, MENUS, menuLabel, menuParent, orderedMenuKeys, sortMenus, type MenuKey } from "@/lib/roles";

type Me = { kind: "root" | "member"; name: string; roleLabel: string; menus: MenuKey[]; temp: boolean; idChange: false | "once" | "unlimited"; order: string[]; canOrder: boolean; myVehicles: number };

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
        setMe({ kind: j.kind, name: j.kind === "member" ? j.member.name : j.name, roleLabel: j.roleLabel, menus: j.menus ?? [], temp: j.kind === "member" && !!j.member.mustChangePassword, idChange: j.kind !== "member" ? false : isStaffAdmin(j.member.role) ? "unlimited" : j.member.idChanged ? false : "once", order: j.menuOrder ?? [], canOrder: j.kind !== "member" || isStaffAdmin(j.member.role), myVehicles: j.myVehicles ?? 0 });
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

  // 메뉴 순서 변경 (최고 관리자·개발팀): 모든 메뉴를 한 목록으로 보여 주고 ▲▼ 로 옮긴다
  const [orderOpen, setOrderOpen] = useState(false);
  const [draft, setDraft] = useState<MenuKey[]>([]);
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderErr, setOrderErr] = useState("");
  const shift = (i: number, d: -1 | 1) => setDraft(p => { const n = [...p]; const j = i + d; if (j < 0 || j >= n.length) return p; [n[i], n[j]] = [n[j], n[i]]; return n; });
  async function saveOrder() {
    if (orderBusy) return;
    setOrderBusy(true);
    setOrderErr("");
    try {
      const r = await fetch("/api/admin/menu-order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order: draft }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string; order?: string[] };
      if (!r.ok) throw new Error(j.error ?? "순서를 저장하지 못했어요.");
      setMe(m => (m ? { ...m, order: j.order ?? draft } : m));
      setOrderOpen(false);
      router.refresh();
    } catch (e) {
      setOrderErr(e instanceof Error ? e.message : "순서를 저장하지 못했어요.");
    }
    setOrderBusy(false);
  }

  // 상위 메뉴(예: 현장관리)가 있는 메뉴는 묶어서 한 칸으로 보여 주고, 눌러서 펼친다. 묶음의 자리는 첫 하위 메뉴의 순서를 따른다.
  type Link2 = { href: string; label: string };
  type Entry = ({ group?: undefined } & Link2) | { group: string; children: Link2[]; href?: undefined };
  const entries: Entry[] = [];
  for (const k of sortMenus(MENUS.map(m => m.key), me?.order)) {
    if (!me?.menus.includes(k)) continue;
    const m = MENUS.find(x => x.key === k)!;
    const parent = menuParent(k);
    if (!parent) { entries.push({ href: m.href, label: m.label }); continue; }
    const g = entries.find((e): e is Extract<Entry, { group: string }> => e.group === parent);
    if (g) g.children.push({ href: m.href, label: m.label });
    else entries.push({ group: parent, children: [{ href: m.href, label: m.label }] });
  }
  if (me && me.myVehicles > 0) entries.push({ href: "/my-vehicle", label: "내 차량" }); // 배차받은 회원은 상단에서도 바로 간다
  const [openGroup, setOpenGroup] = useState<{ name: string; left: number; top: number } | null>(null);
  const isActive = (href: string) => (href === "/admin" ? path === "/admin" : path.startsWith(href));
  return (
    <nav className="border-b border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900" aria-label="메뉴">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-1 px-4">
        <Link href="/" className="order-1 mr-4 shrink-0 whitespace-nowrap py-3 text-sm font-extrabold sm:order-none sm:py-3.5" title="메뉴 선택 화면으로">빌드메이트</Link>
        <div className="no-scrollbar order-3 -mx-4 flex w-[calc(100%+2rem)] items-center gap-1 overflow-x-auto px-4 sm:order-none sm:mx-0 sm:w-auto sm:px-0">
        {entries.map(m => {
          if (m.group !== undefined) {
            const active = m.children.some(c => isActive(c.href));
            const open = openGroup?.name === m.group;
            return (
              <button
                key={"g:" + m.group}
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setOpenGroup(open ? null : { name: m.group, left: r.left, top: r.bottom }); }}
                className={`relative shrink-0 whitespace-nowrap px-3 py-3 text-sm font-bold transition-colors sm:py-3.5 ${active ? "text-blue-600 dark:text-blue-300" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
              >
                {m.group}<span className="ml-1 text-[10px]" aria-hidden>{open ? "▲" : "▼"}</span>
                {active && (
                  <motion.span layoutId="adminNavUnderline" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-blue-600 dark:bg-blue-300" transition={{ type: "spring", stiffness: 420, damping: 34 }} />
                )}
              </button>
            );
          }
          const active = isActive(m.href);
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
          {me && <PushToggle className="shrink-0 whitespace-nowrap rounded-full border border-black/10 px-2.5 py-1 text-xs text-zinc-700 sm:px-3 sm:py-1.5 sm:text-sm hover:border-blue-500 dark:border-white/15 dark:text-zinc-200" />}
          {me?.idChange && <LoginIdChangeButton temp={me.temp} unlimited={me.idChange === "unlimited"} className="shrink-0 whitespace-nowrap rounded-full border border-black/10 px-2.5 py-1 text-xs text-zinc-700 sm:px-3 sm:py-1.5 sm:text-sm hover:border-blue-400 dark:border-white/10 dark:text-zinc-200" />}
          {me?.canOrder && <button type="button" onClick={() => { setDraft(orderedMenuKeys(me.order)); setOrderErr(""); setOrderOpen(true); }} className="shrink-0 whitespace-nowrap rounded-full border border-black/10 px-2.5 py-1 text-xs text-zinc-700 sm:px-3 sm:py-1.5 sm:text-sm hover:border-blue-400 dark:border-white/10 dark:text-zinc-200">메뉴 순서</button>}
          {me?.kind === "member" && <PasswordChangeButton temp={me.temp} className="shrink-0 whitespace-nowrap rounded-full border border-black/10 px-2.5 py-1 text-xs text-zinc-700 sm:px-3 sm:py-1.5 sm:text-sm hover:border-blue-400 dark:border-white/10 dark:text-zinc-200" />}
          <button type="button" onClick={logout} className="shrink-0 whitespace-nowrap rounded-full border border-black/10 px-2.5 py-1 text-xs text-zinc-700 sm:px-3 sm:py-1.5 sm:text-sm hover:border-blue-400 dark:border-white/10 dark:text-zinc-200">
            로그아웃
          </button>
        </div>
      </div>
      {openGroup && (() => {
        const g = entries.find((e): e is Extract<Entry, { group: string }> => e.group === openGroup.name);
        if (!g) return null;
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpenGroup(null)} aria-hidden />
            <div role="menu" style={{ left: Math.max(8, Math.min(openGroup.left, (typeof window === "undefined" ? 9999 : window.innerWidth) - 168)), top: openGroup.top }} className="fixed z-50 min-w-40 overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-zinc-900">
              {g.children.map(c => (
                <Link key={c.href} role="menuitem" href={c.href} onClick={() => setOpenGroup(null)} aria-current={isActive(c.href) ? "page" : undefined} className={`block whitespace-nowrap px-4 py-2.5 text-sm font-bold ${isActive(c.href) ? "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300" : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"}`}>{c.label}</Link>
              ))}
            </div>
          </>
        );
      })()}
      <Modal open={orderOpen} onClose={() => !orderBusy && setOrderOpen(false)}>
        <h2 className="text-lg font-bold">메뉴 순서 변경</h2>
        <p className="mt-1 text-sm text-zinc-500">▲▼로 순서를 바꾸면 모든 사용자의 상단 메뉴에 같은 순서로 보여요.</p>
        <ul className="mt-3 divide-y divide-black/5 rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/10">
          {draft.map((k, i) => (
            <li key={k} className="flex items-center gap-2 px-3 py-2">
              <span className="w-6 text-center text-xs text-zinc-400">{i + 1}</span>
              <span className="flex-1 text-sm font-bold">{menuParent(k) && <small className="mr-1 font-normal text-zinc-500">{menuParent(k)} ›</small>}{menuLabel(k)}</span>
              <button type="button" aria-label={menuLabel(k) + " 위로"} disabled={i === 0} onClick={() => shift(i, -1)} className="rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs font-bold disabled:opacity-30 dark:bg-zinc-800">▲</button>
              <button type="button" aria-label={menuLabel(k) + " 아래로"} disabled={i === draft.length - 1} onClick={() => shift(i, 1)} className="rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs font-bold disabled:opacity-30 dark:bg-zinc-800">▼</button>
            </li>
          ))}
        </ul>
        {orderErr && <p className="mt-3 text-sm text-red-500" role="alert">{orderErr}</p>}
        <div className="mt-5 flex gap-2">
          <button type="button" disabled={orderBusy} onClick={() => setOrderOpen(false)} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
          <button type="button" disabled={orderBusy} onClick={() => void saveOrder()} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{orderBusy ? "저장 중…" : "저장"}</button>
        </div>
      </Modal>
    </nav>
  );
}
