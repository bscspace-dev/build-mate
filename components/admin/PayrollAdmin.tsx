"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buildXlsx, downloadBlob, type Sheet } from "@/lib/xlsx-export";
import { fmtDate } from "@/lib/site-period";

export type PayrollRow = {
  id: string; name: string; team: string; office: boolean; base: number; // base: 사무직은 월급(세전), 일수제는 일당
  days: number; planDays: number; // 출근 공수(오늘까지) · 예정 공수
  gross: number; planGross: number; deduct: number; net: number;
  bank: string; accountNo: string; holder: string;
};

const won = (n: number) => n.toLocaleString("ko-KR") + "원";
const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const shiftYm = (ym: string, n: number) => {
  const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// 월급관리: 그 달분(출근관리 조회 기준) 급여를 사무직(월급−4대보험)과 일수제(일당×출근 공수)로 계산해 보여 준다.
type Paid = Record<string, { at: string; amount: number; by: string }>;
export default function PayrollAdmin({ ym, from, to, today, rows, paid }: { ym: string; from: string; to: string; today: string; rows: PayrollRow[]; paid: Paid }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | "office" | "daily">("all");
  const [copied, setCopied] = useState<string | null>(null); // 방금 복사한 계좌 (회원 id)
  const [sel, setSel] = useState<string[]>([]); // 체크한 회원
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const kw = q.replace(/\s+/g, "").toLowerCase();
  const shown = rows.filter(r => (kind === "all" || (kind === "office") === r.office) && (!kw || (r.name + r.team).replace(/\s+/g, "").toLowerCase().includes(kw)));
  const sum = (f: (r: PayrollRow) => number) => shown.reduce((n, r) => n + f(r), 0);
  const noPay = shown.filter(r => r.base === 0).length;
  const noAcct = shown.filter(r => !r.accountNo).length;
  const unpaid = shown.filter(r => !paid[r.id]);
  const settled = (r: PayrollRow) => !!paid[r.id] && paid[r.id].amount === r.net; // 지급이 끝난 사람 (금액도 그대로)
  const selectable = shown.filter(r => !settled(r));
  const picked = selectable.filter(r => sel.includes(r.id)); // 지금 보이는 목록 중 체크한 사람
  const allOn = selectable.length > 0 && selectable.every(r => sel.includes(r.id));
  const toggle = (id: string) => setSel(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  const go = (m: string) => router.push(`/admin/payroll?m=${m}`);

  // 체크한 사람들을 지급완료로 표시하거나 취소한다
  async function apply(action: "paid" | "unpaid", list: PayrollRow[]) {
    if (busy || list.length === 0) return;
    if (action === "unpaid" && !window.confirm(`선택한 ${list.length}명의 지급완료를 취소할까요?`)) return;
    if (action === "paid" && !window.confirm(`선택한 ${list.length}명, 실지급 ${won(list.reduce((n, r) => n + r.net, 0))}을 지급완료로 처리할까요?`)) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/payroll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ym, items: list.map(r => ({ memberId: r.id, amount: r.net })) }) });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 401) { router.replace("/"); return; }
      if (!res.ok) throw new Error(j.error ?? "처리하지 못했어요.");
      setSel([]);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "처리하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  // 급여 계좌 복사: "은행 계좌번호 예금주" 한 줄로 (이체 앱에 붙여 넣기 좋게)
  async function copyAccount(r: PayrollRow) {
    const text = `${r.bank} ${r.accountNo} ${r.holder}`.trim();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea"); // 보안 연결이 아니면 clipboard 가 막혀 예전 방식으로 복사한다
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(r.id);
    window.setTimeout(() => setCopied(c => (c === r.id ? null : c)), 1800);
  }

  function exportXlsx() {
    const sheet: Sheet = {
      name: "월급",
      header: ["이름", "팀", "구분", "기준(월급/일당)", "출근(공수)", "세전", "4대보험 공제", "실지급(세후)", "은행", "계좌번호", "예금주"],
      rows: shown.map(r => [r.name, r.team, r.office ? "사무직" : "일수제", r.base || null, r.office ? null : r.days, r.gross, r.deduct || null, r.net, r.bank || null, r.accountNo || null, r.accountNo ? r.holder : null]),
      widths: [12, 18, 9, 16, 11, 14, 14, 14, 12, 20, 12],
    };
    downloadBlob(buildXlsx([sheet]), `월급_${ym}.xlsx`);
  }

  const card = "rounded-2xl border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-zinc-900";
  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24">
      <header className="flex flex-wrap items-center gap-3 py-5">
        <h1 className="mr-auto text-xl font-extrabold">월급관리</h1>
        <button type="button" onClick={exportXlsx} disabled={shown.length === 0} className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-bold disabled:opacity-40 dark:bg-zinc-800">엑셀 내려받기</button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => go(shiftYm(ym, -1))} aria-label="이전 달" className="rounded-lg bg-zinc-100 px-3 py-1.5 font-bold dark:bg-zinc-800">‹</button>
        <h2 className="text-base font-extrabold">{ym.slice(0, 4)}년 {Number(ym.slice(5))}월분</h2>
        <button type="button" onClick={() => go(shiftYm(ym, 1))} aria-label="다음 달" className="rounded-lg bg-zinc-100 px-3 py-1.5 font-bold dark:bg-zinc-800">›</button>
        <span className="text-xs text-zinc-500">{fmtDate(from)} ~ {fmtDate(to)} 출근 기준</span>
      </div>

      <section className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="합계">
        <div className={card}><div className="text-xs text-zinc-500">인원</div><div className="text-xl font-extrabold">{shown.length}<small className="ml-0.5 text-sm">명</small></div></div>
        <div className={card}><div className="text-xs text-zinc-500">세전 합계</div><div className="text-xl font-extrabold">{won(sum(r => r.gross))}</div></div>
        <div className={card}><div className="text-xs text-zinc-500">4대보험 공제</div><div className="text-xl font-extrabold">{won(sum(r => r.deduct))}</div></div>
        <div className={`${card} border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10`}><div className="text-xs text-zinc-500">실지급 합계</div><div className="text-xl font-extrabold text-emerald-700 dark:text-emerald-300">{won(sum(r => r.net))}</div><div className="mt-0.5 text-[11px] text-zinc-500">지급완료 {shown.length - unpaid.length}명 · 미지급 {unpaid.length}명{unpaid.length > 0 && ` (${won(unpaid.reduce((n, r) => n + r.net, 0))})`}</div></div>
      </section>
      {err && <p className="mt-2 text-sm text-red-500" role="alert">{err}</p>}
      {(noPay > 0 || noAcct > 0) && (
        <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">{noPay > 0 && `급여 금액이 없는 회원 ${noPay}명`}{noPay > 0 && noAcct > 0 && " · "}{noAcct > 0 && `계좌 미등록 ${noAcct}명`} — 회원등록에서 입력해 주세요.</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="이름·팀으로 검색" aria-label="검색" className="min-w-0 flex-1 rounded-xl border border-black/15 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900" />
        <select aria-label="구분" value={kind} onChange={e => setKind(e.target.value as "all" | "office" | "daily")} className="rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900">
          <option value="all">전체</option>
          <option value="office">사무직 (월급)</option>
          <option value="daily">일수제 (일당)</option>
        </select>
      </div>

      {picked.length > 0 && (
        <div className="sticky top-2 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-blue-300 bg-blue-50 px-4 py-2.5 shadow-sm dark:border-blue-500/40 dark:bg-blue-950">
          <span className="mr-auto text-sm font-bold">선택 {picked.length}명 · 실지급 {won(picked.reduce((n, r) => n + r.net, 0))}</span>
          <button type="button" onClick={() => setSel([])} className="rounded-lg px-3 py-1.5 text-xs font-bold text-zinc-600 dark:text-zinc-300">선택 해제</button>
          <button type="button" disabled={busy} onClick={() => void apply("paid", picked)} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-bold text-white disabled:opacity-40">{busy ? "처리 중…" : `지급완료 (${picked.length})`}</button>
        </div>
      )}
      {shown.length === 0 ? (
        <p className="mt-3 rounded-2xl bg-white p-8 text-center text-sm text-zinc-500 dark:bg-zinc-900">해당하는 회원이 없어요.</p>
      ) : (
        <div className="no-scrollbar mt-3 overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900">
          <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-black/10 bg-zinc-50 text-xs text-zinc-500 dark:border-white/10 dark:bg-zinc-800/60">
                <th className="w-9 px-3 py-2.5"><input type="checkbox" aria-label="전체 선택" checked={allOn} disabled={selectable.length === 0} onChange={() => setSel(allOn ? [] : selectable.map(r => r.id))} className="h-4 w-4" /></th>
                <th className="px-3 py-2.5 font-bold">이름</th>
                <th className="px-3 py-2.5 font-bold">구분</th>
                <th className="px-3 py-2.5 text-right font-bold">기준</th>
                <th className="px-3 py-2.5 text-right font-bold">출근(공수)</th>
                <th className="px-3 py-2.5 text-right font-bold">세전</th>
                <th className="px-3 py-2.5 text-right font-bold">4대보험</th>
                <th className="px-3 py-2.5 text-right font-bold">실지급</th>
                <th className="px-3 py-2.5 font-bold">급여 계좌</th>
                <th className="px-3 py-2.5 text-center font-bold">지급</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.id} className="border-b border-black/5 align-top hover:bg-zinc-50/70 dark:border-white/5 dark:hover:bg-zinc-800/40">
                  <td className="px-3 py-2.5">{!settled(r) && <input type="checkbox" aria-label={`${r.name} 선택`} checked={sel.includes(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4" />}</td>
                  <td className="whitespace-nowrap px-3 py-2.5"><b>{r.name}</b><div className="text-[11px] text-zinc-500">{r.team}</div></td>
                  <td className="whitespace-nowrap px-3 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${r.office ? "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"}`}>{r.office ? "사무직" : "일수제"}</span></td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">{r.base > 0 ? <>{won(r.base)}<div className="text-[11px] text-zinc-500">{r.office ? "월급" : "일당"}</div></> : <span className="text-amber-600 dark:text-amber-300">미설정</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">{r.office ? <span className="text-zinc-400">—</span> : <>{fmtDays(r.days)}{r.planDays > 0 && <div className="text-[11px] text-zinc-500">예정 +{fmtDays(r.planDays)}</div>}</>}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">{won(r.gross)}{r.planGross > 0 && <div className="text-[11px] font-normal text-zinc-500">예정 +{won(r.planGross)}</div>}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-zinc-600 dark:text-zinc-300">{r.deduct > 0 ? "− " + won(r.deduct) : <span className="text-zinc-400">—</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-extrabold text-emerald-700 dark:text-emerald-300">{won(r.net)}</td>
                  <td className="min-w-[12rem] px-3 py-2.5 text-xs">
                    {r.accountNo ? (
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">{r.bank} {r.accountNo}<div className="text-zinc-500">{r.holder}</div></div>
                        <button type="button" onClick={() => void copyAccount(r)} title="은행 · 계좌번호 · 예금주 복사" className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold ${copied === r.id ? "bg-emerald-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>{copied === r.id ? "복사됨" : "복사"}</button>
                      </div>
                    ) : <span className="text-amber-600 dark:text-amber-300">미등록</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-center text-[11px]">
                    {paid[r.id] ? (
                      <>
                        <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white">지급완료</span>
                        <div className="mt-1 text-zinc-500">{paid[r.id].at.slice(5, 10).replace("-", "/")} · {paid[r.id].by}</div>
                        {paid[r.id].amount !== r.net && <div className="mt-0.5 font-semibold text-amber-700 dark:text-amber-300">지급 {won(paid[r.id].amount)} (금액 변경됨)</div>}
                        <button type="button" disabled={busy} onClick={() => void apply("unpaid", [r])} className="mt-1 font-bold text-zinc-500 underline disabled:opacity-40">지급 취소</button>
                      </>
                    ) : <span className="text-zinc-400">미지급</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-black/10 bg-zinc-50 font-bold dark:border-white/10 dark:bg-zinc-800/60">
                <td className="px-3 py-2.5" colSpan={5}>합계 ({shown.length}명)</td>
                <td className="px-3 py-2.5 text-right">{won(sum(r => r.gross))}</td>
                <td className="px-3 py-2.5 text-right">{sum(r => r.deduct) > 0 ? "− " + won(sum(r => r.deduct)) : "—"}</td>
                <td className="px-3 py-2.5 text-right text-emerald-700 dark:text-emerald-300">{won(sum(r => r.net))}</td>
                <td />
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-zinc-500">사무직은 월급에서 4대보험(근로자 부담분)을 뺀 금액이에요. 일수제는 일당 × 출근 공수이고 공제 없이 표시해요. 출근은 오늘({fmtDate(today)})까지, 이후 배치는 예정이에요. 소득세는 넣지 않았어요.</p>
    </div>
  );
}
