"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";

export default function WorkerLogin() {
  const router = useRouter();
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!id.trim() || !pw || busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, password: pw }) });
      if (r.ok) {
        const j = (await r.json().catch(() => ({}))) as { role?: string };
        if (j.role === "admin") router.replace("/admin"); // 관리자는 관리자 화면으로
        else router.refresh(); // 현장관리자는 서버가 세션을 보고 설문 화면을 그려 준다
        return;
      }
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      setErr(j.error ?? "로그인에 실패했어요.");
    } catch {
      setErr("서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.");
    }
    setBusy(false);
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 24 }}
        className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-900"
      >
        <h1 className="text-xl font-extrabold">현장 자재 설문</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">관리자에게 받은 아이디와 비밀번호로 로그인해 주세요.</p>

        <label htmlFor="lid" className="mt-5 block text-sm font-bold">아이디</label>
        <input
          id="lid"
          value={id}
          onChange={e => setId(e.target.value)}
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="username"
          className="mt-2 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15"
        />
        <label htmlFor="lpw" className="mt-4 block text-sm font-bold">비밀번호</label>
        <input
          id="lpw"
          type="password"
          value={pw}
          onChange={e => setPw(e.target.value)}
          autoComplete="current-password"
          className="mt-2 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15"
        />
        <motion.p
          initial={false}
          animate={{ opacity: err ? 1 : 0, height: err ? "auto" : 0 }}
          className="overflow-hidden text-sm text-red-500"
          role="alert"
        >
          <span className="block pt-3">{err}</span>
        </motion.p>
        <motion.button whileTap={{ scale: 0.98 }} disabled={!id.trim() || !pw || busy} className="mt-5 w-full rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white disabled:opacity-40">
          {busy ? "확인 중…" : "로그인"}
        </motion.button>
      </motion.form>
    </main>
  );
}
