"use client";

import { useEffect, useState } from "react";
import { shrink } from "@/components/admin/AddProduct";
import type { SitePost } from "@/lib/types";

const hhmm = (d: Date) => d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
function ago(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "방금";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  const day = (x: Date) => x.toLocaleDateString("sv-SE");
  const now = new Date();
  if (day(d) === day(now)) return `오늘 ${hhmm(d)}`;
  if (day(d) === day(new Date(now.getTime() - 86_400_000))) return `어제 ${hhmm(d)}`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${hhmm(d)}`;
}
const dayLabel = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });

// 작업일보: 그날그날 변경된 정보·발주사항·작업내용·사진을 올려 공유한다. 전용 화면에서는 날짜를 하루씩 넘기며 본다.
export default function SiteJournal({ siteId, page = false, startOpen = false }: { siteId: string; page?: boolean; startOpen?: boolean }) {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const [posts, setPosts] = useState<SitePost[] | null>(null);
  const [meId, setMeId] = useState("");
  const [canPost, setCanPost] = useState(false);
  const [canModerate, setCanModerate] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(startOpen); // 글쓰기 폼 (현장 목록의 작업일보 버튼으로 들어오면 바로 열린다)
  const [date, setDate] = useState(today);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<{ id: number; file: File; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [day, setDay] = useState(today); // 하루씩 보기: 보고 있는 날짜
  const [allDays, setAllDays] = useState(false); // 전체 보기 (날짜를 가리지 않고 모두)
  const [q, setQ] = useState(""); // 내용 검색
  const [month, setMonth] = useState(""); // 월 선택 (YYYY-MM, 빈 값은 전체)

  // 그날 이 현장에 배치된 인원 (보고 있는 날짜, 글쓰기 폼이 열려 있으면 그 날짜 기준)
  const crewDay = open ? date : page && !allDays ? day : "";
  const [crew, setCrew] = useState<{ day: string; shown: boolean; list: { name: string; tag: string }[]; note: string } | null>(null);
  useEffect(() => {
    if (!crewDay) return;
    let dead = false;
    fetch(`/api/admin/site-posts?siteId=${encodeURIComponent(siteId)}&crewDate=${crewDay}`)
      .then(r => r.json().catch(() => ({})) as Promise<{ shown?: boolean; crew?: { name: string; tag: string }[]; note?: string }>)
      .then(j => { if (!dead) setCrew({ day: crewDay, shown: !!j.shown, list: j.crew ?? [], note: j.note ?? "" }); })
      .catch(() => { if (!dead) setCrew(null); });
    return () => { dead = true; };
  }, [siteId, crewDay]);
  const crewNow = crew && crew.day === crewDay && crew.shown ? crew : null;
  const crewChips = (c: NonNullable<typeof crewNow>) => (
    <div className="rounded-xl bg-sky-50 px-3 py-2 dark:bg-sky-500/10" aria-label="배치 인원">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-extrabold text-sky-800 dark:text-sky-200">배치 인원 {c.list.length}명</span>
        {c.list.length === 0 ? <span className="text-xs text-zinc-500">이 날 배치된 인원이 없어요</span> : c.list.map((w, i) => (
          <span key={w.name + i} className="rounded-full bg-white px-2.5 py-0.5 text-sm font-semibold text-sky-900 dark:bg-zinc-900 dark:text-sky-100">{w.name}{w.tag && <small className="ml-1 text-[10px] font-bold text-amber-700 dark:text-amber-300">{w.tag}</small>}</span>
        ))}
      </div>
      {c.note && <p className="mt-1 whitespace-pre-line text-xs text-zinc-600 dark:text-zinc-300">작업 내용 메모: {c.note}</p>}
    </div>
  );

  const [tick, setTick] = useState(0); // 올리기·지우기 뒤에 목록을 다시 불러온다
  const load = async () => { setTick(t => t + 1); };
  useEffect(() => {
    let dead = false;
    fetch(`/api/admin/site-posts?siteId=${encodeURIComponent(siteId)}`)
      .then(async r => {
        const j = (await r.json().catch(() => ({}))) as { posts?: SitePost[]; meId?: string; canPost?: boolean; canModerate?: boolean; error?: string };
        if (!r.ok) throw new Error(j.error ?? "불러오지 못했어요.");
        return j;
      })
      .then(j => {
        if (dead) return;
        setPosts(j.posts ?? []);
        setMeId(j.meId ?? "");
        setCanPost(!!j.canPost);
        setCanModerate(!!j.canModerate);
      })
      .catch(e => {
        if (dead) return;
        setErr(e instanceof Error ? e.message : "불러오지 못했어요.");
        setPosts([]);
      });
    return () => { dead = true; };
  }, [siteId, tick]);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const picked = [...list]; // 입력칸을 비우면 FileList 도 비워지므로 먼저 배열로 복사한다
    setFiles(prev => [...prev, ...picked.slice(0, Math.max(0, 6 - prev.length)).map((file, i) => ({ id: Date.now() + i, file, url: URL.createObjectURL(file) }))]);
  };
  const dropFile = (id: number) => setFiles(prev => { const x = prev.find(p => p.id === id); if (x) URL.revokeObjectURL(x.url); return prev.filter(p => p.id !== id); });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!body.trim() && files.length === 0) return setErr("내용이나 사진을 올려 주세요.");
    setBusy(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.set("siteId", siteId);
      fd.set("date", date);
      fd.set("kind", "log"); // 작업일보는 작업내용 하나뿐
      fd.set("body", body);
      for (const f of files) {
        const blob = await shrink(f.file);
        fd.append("photo", new File([blob], blob.type === "image/webp" ? "post.webp" : "post.jpg", { type: blob.type }));
      }
      const r = await fetch("/api/admin/site-posts", { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "올리지 못했어요.");
      files.forEach(f => URL.revokeObjectURL(f.url));
      setFiles([]);
      setBody("");
      setOpen(false);
      await load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "올리지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  async function remove(p: SitePost) {
    if (busy || !window.confirm("이 글을 지울까요? 올린 사진도 함께 지워져요.")) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/admin/site-posts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete", id: p.id }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "지우지 못했어요.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "지우지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  const months = [...new Set((posts ?? []).map(p => p.date.slice(0, 7)))]; // 글이 있는 달 (최신 순)
  const kw = q.replace(/\s+/g, "").toLowerCase();
  const dayMode = page && !allDays; // 전용 화면의 기본: 하루씩
  const countOn = (d: string) => (posts ?? []).filter(p => p.date === d).length;
  const shown = (posts ?? []).filter(p => (!dayMode || p.date === day) && (!month || p.date.startsWith(month)) && (!kw || (p.body + p.authorName).replace(/\s+/g, "").toLowerCase().includes(kw)));
  const byDay: [string, SitePost[]][] = [];
  for (const p of shown) {
    const last = byDay[byDay.length - 1];
    if (last && last[0] === p.date) last[1].push(p);
    else byDay.push([p.date, [p]]);
  }

  return (
    <section className={page ? "mt-4" : "mt-5 border-t border-black/10 pt-4 dark:border-white/10"} aria-label="작업일보">
      <div className="flex items-center gap-2">
        <h3 className="mr-auto text-base font-extrabold">작업일보 <span className="text-sm font-normal text-zinc-500">· 변경사항·발주·작업내용·사진 공유</span></h3>
        {canPost && !open && <button type="button" onClick={() => { setErr(""); setDate(page && !allDays ? day : today); setOpen(true); }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white">+ 글 올리기</button>}
      </div>

      {open && canPost && (
        <form onSubmit={submit} className="mt-3 rounded-2xl border border-black/10 bg-zinc-50 p-3 dark:border-white/10 dark:bg-zinc-800/40">
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" aria-label="날짜" value={date} onChange={e => setDate(e.target.value)} className="rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900" />
          </div>
          {crewNow && <div className="mt-2">{crewChips(crewNow)}</div>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {files.map(f => (
              <span key={f.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url} alt="" className="h-16 w-16 rounded-lg bg-zinc-100 object-cover" />
                <button type="button" onClick={() => dropFile(f.id)} aria-label="사진 빼기" className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-xs text-white">✕</button>
              </span>
            ))}
            {files.length < 6 && (
              <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-zinc-400 text-xs font-bold text-zinc-500">
                + 사진
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
              </label>
            )}
          </div>
          <textarea autoFocus={startOpen} value={body} onChange={e => setBody(e.target.value)} maxLength={2000} rows={4} placeholder="오늘 작업한 내용을 적어 주세요 (변경사항·발주할 것도 함께 적어도 돼요)" className="mt-2 w-full resize-none rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900" />
          {err && <p className="mt-2 text-sm text-red-500" role="alert">{err}</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={busy} onClick={() => { setOpen(false); setErr(""); files.forEach(f => URL.revokeObjectURL(f.url)); setFiles([]); }} className="rounded-xl bg-zinc-100 px-4 py-2.5 text-sm font-bold dark:bg-zinc-800">취소</button>
            <button disabled={busy} className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? "올리는 중…" : "올리기"}</button>
          </div>
        </form>
      )}
      {!open && err && <p className="mt-2 text-sm text-red-500" role="alert">{err}</p>}

      {page && (
        <div className="mt-3">
          {dayMode ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setDay(d => new Date(Date.parse(d) - 86_400_000).toISOString().slice(0, 10))} aria-label="전날" className="rounded-lg border border-black/15 px-3 py-2 text-sm font-bold dark:border-white/15">‹</button>
                <input type="date" aria-label="작업일보 날짜" value={day} onChange={e => e.target.value && setDay(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-black/15 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-blue-500 sm:flex-none dark:border-white/15 dark:bg-zinc-900" />
                <button type="button" onClick={() => setDay(d => new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10))} aria-label="다음날" className="rounded-lg border border-black/15 px-3 py-2 text-sm font-bold dark:border-white/15">›</button>
                <button type="button" onClick={() => setDay(today)} className={`rounded-lg px-3 py-2 text-xs font-bold ${day === today ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>오늘</button>
                <button type="button" onClick={() => setAllDays(true)} className="ml-auto rounded-lg bg-zinc-100 px-3 py-2 text-xs font-bold dark:bg-zinc-800">전체 보기</button>
              </div>
              <h4 className="mt-3 text-xl font-extrabold">{day.slice(0, 4)}년 {dayLabel(day)} <span className="text-sm font-semibold text-zinc-500">작업일보 {countOn(day)}건</span></h4>
              {crewNow && crewNow.day === day && <div className="mt-2">{crewChips(crewNow)}</div>}
            </>
          ) : (
            <div className="flex items-center gap-2">
              <h4 className="mr-auto text-base font-extrabold">전체 작업일보 <span className="text-sm font-semibold text-zinc-500">{(posts ?? []).length}건</span></h4>
              <button type="button" onClick={() => setAllDays(false)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">하루씩 보기</button>
            </div>
          )}
        </div>
      )}

      {posts && posts.length > 0 && (
        <>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {page && allDays && <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="내용·작성자 검색" aria-label="일지 검색" className="min-w-0 flex-1 rounded-xl border border-black/15 bg-white px-3.5 py-2 text-sm outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900" />}
          {page && allDays && months.length > 1 && (
            <select aria-label="월 선택" value={month} onChange={e => setMonth(e.target.value)} className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900">
              <option value="">전체 기간</option>
              {months.map(m => <option key={m} value={m}>{m.slice(0, 4)}년 {Number(m.slice(5))}월</option>)}
            </select>
          )}
        </div>
        </>
      )}

      {posts === null ? (
        <p className="mt-3 text-sm text-zinc-500">불러오는 중…</p>
      ) : byDay.length === 0 ? (
        <p className="mt-3 rounded-xl bg-zinc-50 p-5 text-center text-sm text-zinc-500 dark:bg-zinc-800/40">{dayMode ? "이 날 올라온 작업일보가 없어요." : posts.length === 0 ? "아직 올라온 글이 없어요." : "이 구분의 글이 없어요."}</p>
      ) : page ? (
        <ul className="mx-auto mt-4 max-w-2xl space-y-5">
          {shown.map(p => (
            <li key={p.id} className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <div className="flex items-center gap-3 px-4 pt-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-base font-extrabold text-blue-700 dark:bg-blue-500/20 dark:text-blue-200" aria-hidden>{p.authorName.slice(0, 1) || "?"}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <b className="text-[15px]">{p.authorName}</b>
                    
                  </div>
                  <div className="text-xs text-zinc-500">{ago(p.createdAt)}{p.date !== new Date(p.createdAt).toLocaleDateString("sv-SE") && <span className="ml-1.5 font-semibold text-orange-600 dark:text-orange-300">· {dayLabel(p.date)} 건</span>}</div>
                </div>
                {(canModerate || (meId && p.authorId === meId)) && <button type="button" disabled={busy} onClick={() => void remove(p)} className="rounded-lg px-2 py-1 text-xs font-bold text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10">삭제</button>}
              </div>
              {p.body && <p className="whitespace-pre-line px-4 pt-3 text-[15px] leading-relaxed">{p.body}</p>}
              {p.photos.length > 0 && (
                <div className={`mt-3 grid gap-0.5 ${p.photos.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                  {p.photos.map((u, i) => (
                    <a key={u} href={u} target="_blank" rel="noreferrer" title="눌러서 크게 보기" className={`block overflow-hidden bg-zinc-100 dark:bg-zinc-800 ${p.photos.length > 2 && i === 0 ? "col-span-2" : ""}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt={`작업일보 사진 ${i + 1}`} loading="lazy" className={`w-full object-cover ${p.photos.length === 1 ? "max-h-[28rem]" : p.photos.length > 2 && i === 0 ? "h-64" : "h-44"}`} />
                    </a>
                  ))}
                </div>
              )}
              <div className="h-3" />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 space-y-4">
          {byDay.map(([d, list]) => (
            <div key={d}>
              <div className="text-xs font-extrabold text-zinc-500">{dayLabel(d)}{d === today && <span className="ml-1.5 rounded-full bg-blue-100 px-1.5 text-[10px] text-blue-800 dark:bg-blue-500/20 dark:text-blue-200">오늘</span>}</div>
              <ul className="mt-1.5 space-y-2">
                {list.map(p => (
                  <li key={p.id} className="rounded-2xl border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-zinc-900">
                    <div className="flex flex-wrap items-center gap-2">
                      
                      <b className="text-sm">{p.authorName}</b>
                      <span className="text-xs text-zinc-500">{new Date(p.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                      {(canModerate || (meId && p.authorId === meId)) && <button type="button" disabled={busy} onClick={() => void remove(p)} className="ml-auto text-xs font-bold text-zinc-400 hover:text-red-600">삭제</button>}
                    </div>
                    {p.body && <p className={`mt-1.5 whitespace-pre-line leading-relaxed ${page ? "text-[15px]" : "text-sm"}`}>{p.body}</p>}
                    {p.photos.length > 0 && (
                      <div className={page ? "mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3" : "no-scrollbar mt-2 flex gap-2 overflow-x-auto"}>
                        {p.photos.map((u, i) => (
                          <a key={u} href={u} target="_blank" rel="noreferrer" className={page ? "block" : "shrink-0"} title="눌러서 크게 보기">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u} alt={`작업일보 사진 ${i + 1}`} loading="lazy" className={page ? "h-44 w-full rounded-lg bg-zinc-100 object-cover dark:bg-zinc-800" : "h-28 rounded-lg bg-zinc-100 object-cover dark:bg-zinc-800"} />
                          </a>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
