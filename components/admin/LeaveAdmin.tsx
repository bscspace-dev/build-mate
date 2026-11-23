"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LEAVE_KINDS, leaveDays, leaveKindLabel, leaveStatusLabel } from "@/lib/leave";
import { fmtDate } from "@/lib/site-period";
import type { LeaveKind, LeaveRequest, LeaveStatus } from "@/lib/types";

const inputCls = "mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15";
const badge = (s: LeaveStatus) => ({ pending: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200", approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200", rejected: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200" })[s];
const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const period = (l: { startDate: string; endDate: string }) => (l.startDate === l.endDate ? fmtDate(l.startDate) : `${fmtDate(l.startDate)} ~ ${fmtDate(l.endDate)}`);

// 휴가관리: 사유를 적어 신청하면 관리자가 승인·반려한다. 승인하면 그 기간 배치가 빠지고 현장배치·출근관리에 휴가로 표시된다.
export default function LeaveAdmin({
  me, canApply, canDecide, leaves, people, year, balances, roster,
}: {
  me: { id: string; name: string } | null; canApply: boolean; canDecide: boolean; leaves: LeaveRequest[]; people: Record<string, { name: string; team: string; office: boolean }>;
  year: number; balances: Record<string, { total: number | null; used: number; pending: number }>; roster: { id: string; name: string; team: string }[];
}) {
  const router = useRouter();
  const today = new Date().toLocaleDateString("sv-SE");
  const [tab, setTab] = useState<"mine" | "manage">(canDecide && !canApply ? "manage" : "mine");
  const [kind, setKind] = useState<LeaveKind>("full");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState<string | null>(null); // 반려 사유를 적는 중인 신청
  const [note, setNote] = useState("");
  const [onlyPending, setOnlyPending] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [allow, setAllow] = useState<Record<string, string>>({}); // 연차 총 일수 입력 중인 값 (회원 id → 입력)
  const myBal = me ? balances[me.id] : undefined; // 사무 회원이면 있다 (현장 회원은 연차가 없다)
  const remainOf = (b: { total: number | null; used: number; pending: number } | undefined) => (b && b.total !== null ? b.total - b.used - b.pending : null);

  const mine = leaves.filter(l => l.memberId === me?.id);
  const pending = leaves.filter(l => l.status === "pending");
  const endEff = kind === "full" ? end : start; // 반차는 하루
  const draftDays = leaveDays({ startDate: start, endDate: endEff < start ? start : endEff, kind });
  const myRemain = remainOf(myBal);
  const short = myRemain !== null && draftDays > myRemain; // 사무: 연차가 모자라면 신청할 수 없다

  async function call(body: Record<string, unknown>, done: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/admin/leave", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (r.status === 401) { router.replace("/"); return false; }
      const j = (await r.json().catch(() => ({}))) as { error?: string; removed?: number };
      if (!r.ok) throw new Error(j.error ?? "처리하지 못했어요.");
      setToast(body.action === "approve" && j.removed ? `${done} (배치 ${j.removed}건을 뺐어요)` : done);
      setTimeout(() => setToast(""), 3000);
      router.refresh();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "처리하지 못했어요.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function apply(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return setErr("사유를 적어 주세요.");
    if (await call({ action: "apply", startDate: start, endDate: endEff < start ? start : endEff, kind, reason }, "휴가를 신청했어요. 관리자가 승인하면 휴가로 처리돼요")) setReason("");
  }

  const card = (l: LeaveRequest, manage: boolean) => {
    const p = people[l.memberId];
    return (
      <li key={l.id} className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-2">
          {manage && <b className="text-base">{p?.name ?? "삭제된 회원"}{p?.team && <small className="ml-1.5 text-xs font-normal text-zinc-500">{p.team}</small>}</b>}
          <b className={manage ? "text-sm text-zinc-700 dark:text-zinc-200" : "text-base"}>{period(l)}</b>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-bold dark:bg-zinc-800">{leaveKindLabel(l.kind)} · {fmtDays(leaveDays(l))}일</span>
          <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-bold ${badge(l.status)}`}>{leaveStatusLabel(l.status)}</span>
        </div>
        <p className="mt-2 whitespace-pre-line rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/60"><span className="mr-1.5 text-xs font-bold text-zinc-500">사유</span>{l.reason}</p>
        {manage && (() => {
          if (!p?.office) return <p className="mt-1.5 text-xs text-zinc-500">현장 · 연차 차감 없이 휴가 일수만 출근에서 제외돼요</p>;
          const b = balances[l.memberId];
          const rem = remainOf(b);
          const need = leaveDays(l);
          const bad = l.status === "pending" && b && b.total !== null && need > b.total - b.used;
          return <p className={`mt-1.5 text-xs font-semibold ${bad ? "text-red-600" : "text-blue-700 dark:text-blue-300"}`}>사무 · {b?.total == null ? `${year}년 연차 총 일수 미설정` : `${year}년 연차 총 ${fmtDays(b.total)}일 · 사용 ${fmtDays(b.used)}일 · 잔여 ${fmtDays(rem ?? 0)}일`}{bad && " — 연차가 부족해서 승인할 수 없어요"}</p>;
        })()}
        {l.status !== "pending" && (
          <p className="mt-1.5 text-xs text-zinc-500">{l.decidedBy} · {new Date(l.decidedAt).toLocaleDateString("ko-KR")} {l.status === "approved" ? "승인" : "반려"}{l.decisionNote && ` — ${l.decisionNote}`}</p>
        )}
        {l.status === "pending" && !manage && canApply && l.memberId === me?.id && (
          <div className="mt-2 flex justify-end"><button type="button" disabled={busy} onClick={() => void call({ action: "cancel", id: l.id }, "신청을 취소했어요")} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold dark:bg-zinc-800">신청 취소</button></div>
        )}
        {l.status === "pending" && manage && (
          rejecting === l.id ? (
            <div className="mt-3">
              <input autoFocus value={note} onChange={e => setNote(e.target.value)} maxLength={200} placeholder="반려 사유 (필수)" className={inputCls + " !mt-0"} />
              <div className="mt-2 flex justify-end gap-1.5">
                <button type="button" disabled={busy} onClick={() => { setRejecting(null); setNote(""); }} className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-bold dark:bg-zinc-800">취소</button>
                <button type="button" disabled={busy || !note.trim()} onClick={() => void call({ action: "reject", id: l.id, note }, "반려했어요").then(ok => { if (ok) { setRejecting(null); setNote(""); } })} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">반려</button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-end gap-1.5">
              <span className="mr-auto text-xs text-zinc-500">승인하면 이 기간의 배치가 빠지고 휴가로 처리돼요</span>
              <button type="button" disabled={busy} onClick={() => { setRejecting(l.id); setNote(""); setErr(""); }} className="rounded-lg bg-red-50 px-3.5 py-2 text-sm font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300">반려</button>
              <button type="button" disabled={busy} onClick={() => void call({ action: "approve", id: l.id }, `${p?.name ?? ""} 휴가를 승인했어요`)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">승인 (휴가 처리)</button>
            </div>
          )
        )}
      </li>
    );
  };

  const manageList = (onlyPending ? pending : leaves);
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24">
      <header className="flex flex-wrap items-center gap-3 py-5">
        <h1 className="mr-auto text-xl font-extrabold">휴가관리</h1>
        {canDecide && pending.length > 0 && <span className="rounded-full bg-amber-500 px-2.5 py-1 text-xs font-bold text-white">승인 대기 {pending.length}건</span>}
      </header>

      {canDecide && canApply && (
        <div className="mb-3 flex gap-2" role="tablist" aria-label="휴가 메뉴">
          <button type="button" role="tab" aria-selected={tab === "mine"} onClick={() => setTab("mine")} className={`flex-1 rounded-xl border py-2.5 text-sm font-extrabold ${tab === "mine" ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white dark:border-white/15 dark:bg-zinc-900"}`}>내 휴가 신청</button>
          <button type="button" role="tab" aria-selected={tab === "manage"} onClick={() => setTab("manage")} className={`flex-1 rounded-xl border py-2.5 text-sm font-extrabold ${tab === "manage" ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white dark:border-white/15 dark:bg-zinc-900"}`}>승인 관리{pending.length > 0 && <small className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-white">{pending.length}</small>}</button>
        </div>
      )}
      {toast && <p className="mb-3 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200" role="status">{toast}</p>}
      {err && <p className="mb-3 text-sm text-red-500" role="alert">{err}</p>}

      {tab === "mine" ? (
        <>
          {canApply ? (
            <form onSubmit={apply} className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
              <h2 className="text-base font-extrabold">휴가 신청하기 <span className="text-sm font-normal text-zinc-500">· {me?.name}</span></h2>
              <div className="mt-3 flex gap-2" role="radiogroup" aria-label="휴가 구분">
                {LEAVE_KINDS.map(k => (
                  <button key={k.v} type="button" role="radio" aria-checked={kind === k.v} onClick={() => setKind(k.v)} className={`flex-1 rounded-xl border py-2.5 text-sm font-extrabold ${kind === k.v ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white dark:border-white/15 dark:bg-zinc-900"}`}>{k.label}</button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input type="date" aria-label="휴가 시작일" value={start} min={today} onChange={e => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} className={inputCls + " !mt-0 min-w-0 flex-1"} />
                {kind === "full" && <><span className="text-zinc-400" aria-hidden>~</span><input type="date" aria-label="휴가 종료일" value={end} min={start} onChange={e => setEnd(e.target.value)} className={inputCls + " !mt-0 min-w-0 flex-1"} /></>}
              </div>
              <p className="mt-1.5 text-sm font-bold text-blue-700 dark:text-blue-300">{draftDays > 0 ? `${fmtDays(draftDays)}일` : "일요일은 쉬는 날이라 휴가에 포함되지 않아요"} <span className="font-normal text-zinc-500">(일요일 제외)</span></p>
              {myBal && (
                <p className={`mt-2 rounded-lg px-3 py-2 text-sm font-semibold ${short ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-200" : "bg-blue-50 text-blue-900 dark:bg-blue-500/10 dark:text-blue-100"}`}>
                  {myBal.total === null ? `${year}년 연차 총 일수가 아직 정해지지 않았어요 (사용 ${fmtDays(myBal.used)}일)` : `${year}년 연차 총 ${fmtDays(myBal.total)}일 · 사용 ${fmtDays(myBal.used)}일${myBal.pending ? ` · 대기 ${fmtDays(myBal.pending)}일` : ""} → 잔여 ${fmtDays(myRemain ?? 0)}일`}
                  {short && <> — 연차가 부족해서 신청할 수 없어요</>}
                </p>
              )}
              <label htmlFor="lv-reason" className="mt-3 block text-sm font-bold">사유 <span className="font-normal text-red-500">(필수)</span></label>
              <textarea id="lv-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={300} rows={3} placeholder="예: 가족 행사, 병원 진료" className={inputCls + " resize-none"} />
              <button disabled={busy || draftDays === 0 || !reason.trim() || short} className="mt-3 w-full rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "신청 중…" : "승인 신청"}</button>
              <p className="mt-2 text-xs text-zinc-500">{myBal ? "승인되면 연차에서 차감돼요 (사무)." : "승인되면 그 기간의 현장 배치가 빠지고 출근 일수에는 세지 않아요 (현장 · 연차에서 차감되지 않아요)."}</p>
            </form>
          ) : (
            <p className="rounded-2xl bg-white p-5 text-center text-sm text-zinc-500 dark:bg-zinc-900">{me ? "휴가를 신청할 권한이 없어요." : "휴가는 회원 계정으로만 신청할 수 있어요."}</p>
          )}
          <h2 className="mt-6 text-sm font-extrabold text-zinc-500">내 신청 내역 <span className="font-semibold">{mine.length}건</span></h2>
          {mine.length === 0 ? <p className="mt-2 rounded-2xl bg-white p-6 text-center text-sm text-zinc-500 dark:bg-zinc-900">신청한 휴가가 없어요.</p> : <ul className="mt-2 space-y-2">{mine.map(l => card(l, false))}</ul>}
        </>
      ) : (
        <>
          <details className="mb-3 rounded-2xl border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-zinc-900">
            <summary className="cursor-pointer text-sm font-extrabold">사무 연차 관리 <span className="font-normal text-zinc-500">· {year}년 (사무 {roster.length}명)</span></summary>
            <p className="mt-2 text-xs text-zinc-500">사무(사무실 부서) 회원의 휴가는 연차에서 차감돼요. 올해 연차 총 일수를 정해 두세요(0.5 단위). 비워 두면 연차 제한 없이 신청돼요. 현장 회원은 연차가 없고 휴가 일수만 출근에서 빠져요.</p>
            {roster.length === 0 ? <p className="mt-2 text-sm text-zinc-500">사무 부서 회원이 없어요.</p> : (
              <ul className="mt-2 divide-y divide-black/5 dark:divide-white/10">
                {roster.map(m => {
                  const b = balances[m.id];
                  const val = allow[m.id] ?? (b?.total == null ? "" : String(b.total));
                  const dirty = val !== (b?.total == null ? "" : String(b.total));
                  return (
                    <li key={m.id} className="flex flex-wrap items-center gap-2 py-2">
                      <span className="min-w-24 flex-1 text-sm font-bold">{m.name}<small className="ml-1 text-xs font-normal text-zinc-500">{m.team}</small></span>
                      <label className="flex items-center gap-1 text-xs text-zinc-500">총
                        <input inputMode="decimal" aria-label={`${m.name} 연차 총 일수`} value={val} onChange={e => setAllow({ ...allow, [m.id]: e.target.value.replace(/[^\d.]/g, "") })} placeholder="미설정" className="w-16 rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-right text-sm font-bold text-zinc-900 outline-none focus:border-blue-500 dark:border-white/15 dark:text-zinc-100" />일
                      </label>
                      <span className="text-xs text-zinc-500">사용 {fmtDays(b?.used ?? 0)}{b?.pending ? ` · 대기 ${fmtDays(b.pending)}` : ""} · 잔여 {b?.total == null ? "—" : fmtDays(b.total - b.used - b.pending)}</span>
                      <button type="button" disabled={busy || !dirty} onClick={() => { const n = val === "" ? null : Number(val); void call({ action: "allowance", memberId: m.id, year, days: n }, `${m.name} 연차를 저장했어요`).then(ok => { if (ok) setAllow(a => { const n = { ...a }; delete n[m.id]; return n; }); }); }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">저장</button>
                    </li>
                  );
                })}
              </ul>
            )}
          </details>
          <label className="mb-2 inline-flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300"><input type="checkbox" checked={onlyPending} onChange={e => setOnlyPending(e.target.checked)} className="h-4 w-4" /> 승인 대기만 보기</label>
          {manageList.length === 0 ? <p className="rounded-2xl bg-white p-8 text-center text-sm text-zinc-500 dark:bg-zinc-900">{onlyPending ? "승인 대기 중인 신청이 없어요." : "신청 내역이 없어요."}</p> : <ul className="space-y-2">{manageList.map(l => card(l, true))}</ul>}
        </>
      )}
    </div>
  );
}
