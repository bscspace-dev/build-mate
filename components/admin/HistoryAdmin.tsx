"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuditEntry } from "@/lib/types";

const PAGE = 30;
const cell = "border border-black/10 px-2.5 py-1.5 dark:border-white/10";
const when = (iso: string) => new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16);
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const badge = (a: string) => (a.startsWith("추가") ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300" : a.startsWith("삭제") ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" : a.startsWith("구매") ? "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300" : "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300");

// 변경이력: 모든 메뉴의 추가·수정·삭제 기록. 메뉴·사람·기간·검색어로 거르고, 길면 쪽으로 나눈다.
export default function HistoryAdmin({ entries, menus, error, canDelete }: { entries: AuditEntry[]; menus: { key: string; label: string }[]; error: string; canDelete: boolean }) {
  const router = useRouter();
  const [sel, setSelIds] = useState<string[]>([]); // 삭제하려고 체크한 기록
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [menu, setMenu] = useState("");
  const [who, setWho] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  async function removeSelected() {
    if (sel.length === 0 || busy) return;
    if (!window.confirm(`체크한 변경이력 ${sel.length}건을 삭제할까요?\n삭제하면 되돌릴 수 없어요. (삭제한 사실은 변경이력에 남아요)`)) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/admin/history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete", ids: sel }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "삭제하지 못했어요.");
      setSelIds([]);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "서버에 연결할 수 없어요.");
    } finally {
      setBusy(false);
    }
  }
  const labelOf = (k: string) => menus.find(m => m.key === k)?.label ?? k;
  const people = [...new Set(entries.map(e => e.byName))].sort((a, b) => a.localeCompare(b, "ko"));
  const used = [...new Set(entries.map(e => e.menu))];
  const kw = q.trim().replace(/\s+/g, "").toLowerCase();
  const shown = entries.filter(e => (!menu || e.menu === menu) && (!who || e.byName === who) && (!from || dayOf(e.at) >= from) && (!to || dayOf(e.at) <= to) && (!kw || `${e.target}${e.detail}${e.action}`.replace(/\s+/g, "").toLowerCase().includes(kw)));
  useEffect(() => setPage(1), [menu, who, from, to, q]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const cur = Math.min(page, pages);
  const start = (cur - 1) * PAGE;
  const rows = shown.slice(start, start + PAGE);
  const nums = Array.from({ length: pages }, (_, n) => n + 1).filter(n => n === 1 || n === pages || Math.abs(n - cur) <= 2);
  const selCls = "rounded-lg border border-black/15 bg-transparent px-2.5 py-1.5 text-sm dark:border-white/15";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <h1 className="text-xl font-extrabold">변경이력 <span className="text-sm font-normal text-zinc-500">모든 메뉴의 추가·수정·삭제 · 최근 {entries.length.toLocaleString("ko-KR")}건</span></h1>
      {err && <p className="mt-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300" role="alert">{err}</p>}
      {error && <p className="mt-3 rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" role="alert">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select value={menu} onChange={e => setMenu(e.target.value)} className={selCls} aria-label="메뉴">
          <option value="">전체 메뉴</option>
          {used.map(k => <option key={k} value={k}>{labelOf(k)}</option>)}
        </select>
        <select value={who} onChange={e => setWho(e.target.value)} className={selCls} aria-label="변경한 사람">
          <option value="">전체 사람</option>
          {people.map(n => <option key={n}>{n}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={selCls} aria-label="시작일" />
        <span className="text-zinc-400">~</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={selCls} aria-label="종료일" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="품목·내용 검색" className={`${selCls} min-w-0 flex-1`} aria-label="검색" />
        {(menu || who || from || to || q) && <button type="button" onClick={() => { setMenu(""); setWho(""); setFrom(""); setTo(""); setQ(""); }} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-bold dark:bg-zinc-800">거르기 해제</button>}
      </div>

      {canDelete && sel.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm dark:bg-red-500/10">
          <b className="text-red-700 dark:text-red-300">{sel.length}건 선택</b>
          <button type="button" disabled={busy} onClick={() => void removeSelected()} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">선택한 이력 삭제</button>
          <button type="button" onClick={() => setSelIds([])} className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold dark:bg-zinc-800">선택 해제</button>
        </div>
      )}
      {/* 좁은 화면(모바일): 표 대신 카드 */}
      <div className="mt-4 space-y-2 md:hidden">
        {rows.length === 0 && <p className="rounded-xl border border-dashed border-black/15 p-6 text-center text-sm text-zinc-500 dark:border-white/15">{entries.length === 0 ? "아직 기록된 변경이 없어요." : "조건에 맞는 변경이력이 없어요."}</p>}
        {rows.map(e => (
          <div key={e.id} className={`rounded-xl border p-3 ${sel.includes(e.id) ? "border-red-300 bg-red-50/60 dark:border-red-500/40 dark:bg-red-500/5" : "border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900"}`}>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {canDelete && <input type="checkbox" aria-label="삭제할 이력 선택" checked={sel.includes(e.id)} onChange={ev => setSelIds(x => (ev.target.checked ? [...x, e.id] : x.filter(i => i !== e.id)))} className="mr-1 h-5 w-5 accent-red-600" />}
              <span className={`rounded-full px-2 py-0.5 font-bold ${badge(e.action)}`}>{e.action}</span>
              <span className="font-bold">{labelOf(e.menu)}</span>
              <span className="ml-auto text-zinc-500">{when(e.at)}</span>
            </div>
            <div className="mt-1.5 break-words font-semibold">{e.target || "—"}</div>
            {e.detail && <div className="mt-0.5 break-words text-xs text-zinc-600 dark:text-zinc-300">{e.detail}</div>}
            <div className="mt-1 text-xs text-zinc-500">{e.byName}</div>
          </div>
        ))}
      </div>
      <div className="no-scrollbar mt-4 hidden overflow-x-auto rounded-xl border border-black/10 md:block dark:border-white/10">
        <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
          <thead>
            <tr className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800/60">
              {canDelete && <th className={`${cell} w-9 text-center`}><input type="checkbox" aria-label="이 쪽 전체 선택" checked={rows.length > 0 && rows.every(e => sel.includes(e.id))} onChange={ev => setSelIds(x => (ev.target.checked ? [...new Set([...x, ...rows.map(e => e.id)])] : x.filter(i => !rows.some(e => e.id === i))))} className="h-4 w-4 accent-red-600" /></th>}
              <th className={`${cell} w-36`}>일시</th>
              <th className={`${cell} w-28`}>메뉴</th>
              <th className={`${cell} w-24`}>구분</th>
              <th className={`${cell} w-56`}>대상</th>
              <th className={cell}>내용</th>
              <th className={`${cell} w-24`}>변경한 사람</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={canDelete ? 7 : 6} className={`${cell} py-8 text-center text-zinc-500`}>{entries.length === 0 ? "아직 기록된 변경이 없어요." : "조건에 맞는 변경이력이 없어요."}</td></tr>}
            {rows.map(e => (
              <tr key={e.id} className="align-top hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40">
                {canDelete && <td className={`${cell} text-center`}><input type="checkbox" aria-label="삭제할 이력 선택" checked={sel.includes(e.id)} onChange={ev => setSelIds(x => (ev.target.checked ? [...x, e.id] : x.filter(i => i !== e.id)))} className="h-4 w-4 accent-red-600" /></td>}
                <td className={`${cell} whitespace-nowrap text-xs text-zinc-500`}>{when(e.at)}</td>
                <td className={`${cell} whitespace-nowrap`}>{labelOf(e.menu)}</td>
                <td className={`${cell} whitespace-nowrap`}><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${badge(e.action)}`}>{e.action}</span></td>
                <td className={`${cell} font-semibold`}>{e.target || "—"}</td>
                <td className={`${cell} text-zinc-600 dark:text-zinc-300`}>{e.detail || "—"}</td>
                <td className={`${cell} whitespace-nowrap`}>{e.byName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="mt-3 flex flex-wrap items-center justify-center gap-1" aria-label="쪽 이동">
          <button type="button" disabled={cur === 1} onClick={() => setPage(cur - 1)} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-bold disabled:opacity-35 dark:bg-zinc-800">이전</button>
          {nums.map((n, j) => (
            <span key={n} className="inline-flex items-center gap-1">
              {j > 0 && n - nums[j - 1] > 1 && <span className="px-1 text-zinc-400">…</span>}
              <button type="button" onClick={() => setPage(n)} aria-current={n === cur ? "page" : undefined} className={`min-w-9 rounded-lg px-2.5 py-1.5 text-sm font-bold ${n === cur ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>{n}</button>
            </span>
          ))}
          <button type="button" disabled={cur === pages} onClick={() => setPage(cur + 1)} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-bold disabled:opacity-35 dark:bg-zinc-800">다음</button>
          <span className="ml-2 text-xs text-zinc-500">{start + 1}–{Math.min(start + PAGE, shown.length)} / {shown.length}건</span>
        </nav>
      )}
    </div>
  );
}
