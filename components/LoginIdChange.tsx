"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Sheet";

const inputCls = "mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15";

// "아이디 변경" 버튼 (비밀번호 변경 옆). 일반 회원은 처음 1회만 바꿀 수 있고, 바꾸고 나면 버튼이 사라진다.
// 최고 관리자·개발팀(unlimited)은 횟수 제한이 없어 계속 보인다.
export default function LoginIdChangeButton({ className = "", unlimited = false, temp = false }: { className?: string; unlimited?: boolean; temp?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newId, setNewId] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [needPw, setNeedPw] = useState(!temp); // 임시 비밀번호로 처음 들어왔을 때는 비밀번호 확인 없이 바로 바꾼다

  if (gone) return null;

  function close() {
    if (busy) return;
    setOpen(false);
    setNewId(""); setPw(""); setErr("");
    if (done !== null) {
      setDone(null);
      if (!unlimited) setGone(true); // 1회 사용 끝 — 메뉴를 없앤다
      router.refresh();
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/me", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "loginId", loginId: newId, password: pw }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string; member?: { loginId: string | null } };
      if (r.status === 401) { router.replace("/"); return; }
      if (!r.ok) { setErr(j.error ?? "요청에 실패했어요."); if (r.status === 403 && !(j.error ?? "").includes("한 번만")) setNeedPw(true); }
      else setDone(j.member?.loginId ?? newId.trim().toLowerCase());
    } catch {
      setErr("서버에 연결할 수 없어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>아이디 변경</button>
      <Modal open={open} onClose={close}>
        <h2 className="text-lg font-bold">아이디 변경</h2>
        {done !== null ? (
          <>
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">아이디를 <b>{done}</b>(으)로 바꿨어요. 다음 로그인부터 새 아이디를 쓰세요.</p>
            <button type="button" onClick={close} className="mt-4 w-full rounded-xl bg-blue-600 py-3 font-bold text-white">확인</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="mt-1 text-sm text-zinc-500">{unlimited ? "횟수 제한 없이 바꿀 수 있어요." : "아이디는 처음 한 번만 바꿀 수 있어요. 신중하게 정해 주세요."}</p>
            <label htmlFor="li-new" className="mt-3 block text-sm font-bold">새 아이디 <span className="font-normal text-zinc-500">(영문 소문자·숫자·_- 3~20자)</span></label>
            <input id="li-new" value={newId} onChange={e => setNewId(e.target.value)} autoCapitalize="none" spellCheck={false} autoComplete="off" className={inputCls} />
            {needPw && (
              <>
                <label htmlFor="li-pw" className="mt-3 block text-sm font-bold">현재 비밀번호</label>
                <input id="li-pw" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" className={inputCls} />
              </>
            )}
            {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
            <div className="mt-4 flex gap-2">
              <button type="button" disabled={busy} onClick={close} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
              <button disabled={!newId.trim() || (needPw && !pw) || busy} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-40">{busy ? "변경 중…" : "변경"}</button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
