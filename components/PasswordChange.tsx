"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Sheet";

const inputCls = "mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15";

// 화면 우측 상단에 두는 "비밀번호 변경" 버튼. 누르면 창이 떠서 현재 비밀번호 확인 후 바꾼다.
export default function PasswordChangeButton({ className = "", temp = false }: { className?: string; temp?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [needCur, setNeedCur] = useState(!temp); // 임시 비밀번호로 처음 들어왔을 때는 현재 비밀번호 칸 없이 바로 바꾼다

  function close() {
    if (busy) return;
    setOpen(false);
    setCur(""); setPw1(""); setPw2(""); setErr(""); setDone(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (pw1 !== pw2) return setErr("새 비밀번호가 서로 달라요.");
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/me", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "password", current: cur, next: pw1 }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (r.status === 401) { router.replace("/"); return; }
      if (!r.ok) { setErr(j.error ?? "요청에 실패했어요."); if (r.status === 403) setNeedCur(true); }
      else { setDone(true); setNeedCur(true); setCur(""); setPw1(""); setPw2(""); router.refresh(); }
    } catch {
      setErr("서버에 연결할 수 없어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>비밀번호 변경</button>
      <Modal open={open} onClose={close}>
        <h2 className="text-lg font-bold">비밀번호 변경</h2>
        {done ? (
          <>
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">비밀번호를 바꿨어요.</p>
            <button type="button" onClick={close} className="mt-4 w-full rounded-xl bg-blue-600 py-3 font-bold text-white">확인</button>
          </>
        ) : (
          <form onSubmit={submit}>
            {needCur ? (
              <>
                <label htmlFor="pc-cur" className="mt-3 block text-sm font-bold">현재 비밀번호</label>
                <input id="pc-cur" type="password" value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" className={inputCls} />
              </>
            ) : (
              <p className="mt-1 text-sm text-zinc-500">임시 비밀번호로 들어왔어요. 현재 비밀번호 없이 새 비밀번호를 바로 정할 수 있어요.</p>
            )}
            <label htmlFor="pc-1" className="mt-3 block text-sm font-bold">새 비밀번호 <span className="font-normal text-zinc-500">(6자 이상)</span></label>
            <input id="pc-1" type="password" value={pw1} onChange={e => setPw1(e.target.value)} autoComplete="new-password" className={inputCls} />
            <label htmlFor="pc-2" className="mt-3 block text-sm font-bold">새 비밀번호 확인</label>
            <input id="pc-2" type="password" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" className={inputCls} />
            {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
            <div className="mt-4 flex gap-2">
              <button type="button" disabled={busy} onClick={close} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
              <button disabled={(needCur && !cur) || !pw1 || !pw2 || busy} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-40">{busy ? "변경 중…" : "변경"}</button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
