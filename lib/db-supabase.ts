import 'server-only';
import type { MaterialRequest, Member, MemberPatch, Product, RequestItem, SurveyPayload, TrashedProduct } from './types';
import type { GrantedActions, GroupKey, MenuKey, RoleKey, Team } from './roles';
import { removeImage } from './images';
import { supabase } from './supabase';
import type { CatResult, TradeResult } from './db-file';

// Supabase(Postgres) 저장소. db-file.ts 와 같은 함수 이름·반환 형태를 가진다 (db.ts 가 둘 중 하나를 고른다).
// 서버에서 비밀 키로만 접근한다. 한 번에 보내는 key 목록은 URL 길이 제한 때문에 잘라서 보낸다.

const PAGE = 1000; // PostgREST 는 한 번에 최대 1000행만 돌려준다
const CHUNK = 200;

type DbError = { message: string; code?: string } | null;
function must<T>(res: { data: T | null; error: DbError }, what: string): T {
  if (res.error) throw new Error(`Supabase ${what} 실패: ${res.error.message}`);
  return res.data as T;
}
const chunks = <T,>(list: T[], n = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};
async function fetchAll<Row>(build: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: DbError }>, what: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = must(await build(from, from + PAGE - 1), what);
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

// ───────── 자재 ─────────
type ProductRow = {
  key: string; seq: number; category: string; sub: string; name: string; brand: string;
  price: number | null; price_incl_vat: number | null; vat_basis: string | null; soldout: boolean; stock: number | null; image: string; trades: string[];
  deleted_at: string | null;
};
const toProduct = (r: ProductRow): Product => ({
  seq: r.seq, key: r.key, category: r.category, sub: r.sub, name: r.name, brand: r.brand,
  price: r.price ?? 0, priceInclVat: r.price_incl_vat, vatBasis: r.vat_basis ?? '', soldout: r.soldout, stock: r.stock ?? 0, image: r.image, trades: r.trades ?? [],
});

export async function getProducts(): Promise<Product[]> {
  const rows = await fetchAll<ProductRow>((a, b) => supabase().from('products').select('*').is('deleted_at', null).order('seq').range(a, b), '자재 조회');
  return rows.map(toProduct);
}

export async function getTrash(): Promise<TrashedProduct[]> {
  const rows = await fetchAll<ProductRow>((a, b) => supabase().from('products').select('*').not('deleted_at', 'is', null).order('deleted_at').order('seq').range(a, b), '휴지통 조회');
  return rows.map(r => ({ ...toProduct(r), deletedAt: new Date(r.deleted_at as string).toISOString() }));
}

export async function getTrades(): Promise<string[]> {
  const row = must(await supabase().from('app_settings').select('value').eq('key', 'trades').maybeSingle(), '공정 목록 조회') as { value: string[] } | null;
  if (!row) throw new Error('Supabase app_settings 에 공정 목록(trades)이 없어요. npm run supabase:migrate 를 먼저 실행하세요.');
  return row.value;
}

/** 삭제 = 휴지통으로 이동(deleted_at 기록). */
export async function deleteProducts(keys: string[]): Promise<number> {
  const now = new Date().toISOString();
  let n = 0;
  for (const part of chunks(keys)) {
    const rows = must(await supabase().from('products').update({ deleted_at: now }).in('key', part).is('deleted_at', null).select('key'), '삭제') as { key: string }[];
    n += rows.length;
  }
  return n;
}

export async function restoreProducts(keys: string[]): Promise<number> {
  let n = 0;
  for (const part of chunks(keys)) {
    const rows = must(await supabase().from('products').update({ deleted_at: null }).in('key', part).not('deleted_at', 'is', null).select('key'), '복원') as { key: string }[];
    n += rows.length;
  }
  return n;
}

/** 영구 삭제: 휴지통에 있는 것만. 행을 지우고, 다른 자재가 안 쓰는 이미지 파일도 지운다. */
export async function purgeProducts(keys: string[]): Promise<number> {
  let n = 0;
  for (const part of chunks(keys)) {
    const rows = must(await supabase().from('products').select('key,image').in('key', part).not('deleted_at', 'is', null), '영구 삭제 조회') as { key: string; image: string }[];
    if (!rows.length) continue;
    must(await supabase().from('products').delete().in('key', rows.map(r => r.key)), '영구 삭제');
    n += rows.length;
    for (const image of new Set(rows.map(r => r.image).filter(Boolean))) {
      // 다른 자재가 같은 이미지를 쓰고 있거나 확인에 실패하면 파일은 남긴다
      const { count, error } = await supabase().from('products').select('*', { count: 'exact', head: true }).eq('image', image);
      if (!error && count === 0) await removeImage(image).catch(() => undefined);
    }
  }
  return n;
}

// ───────── 설문 응답 ─────────
export async function saveResponse(payload: SurveyPayload): Promise<string> {
  const row = { worker_id: payload.workerId ?? null, name: payload.name, trade: payload.trade, at: payload.at, items: payload.items, custom: payload.custom };
  const saved = must(await supabase().from('responses').insert(row).select('id').single(), '응답 저장') as { id: number | string };
  return String(saved.id);
}

export async function countResponses(): Promise<number> {
  const { count, error } = await supabase().from('responses').select('*', { count: 'exact', head: true });
  if (error) throw new Error(`Supabase 응답 수 조회 실패: ${error.message}`);
  return count ?? 0;
}

/** 현장관리자별 공정별 마지막 제출 시각: { [workerId]: { [trade]: ISO } } */
export async function getSubmissions(): Promise<Record<string, Record<string, string>>> {
  const rows = await fetchAll<{ worker_id: string; trade: string; at: string }>(
    (a, b) => supabase().from('responses').select('worker_id,trade,at').not('worker_id', 'is', null).order('id').range(a, b),
    '제출 현황 조회',
  );
  const out: Record<string, Record<string, string>> = {};
  for (const r of rows) {
    const at = new Date(r.at).toISOString();
    const m = (out[r.worker_id] ||= {});
    if (!m[r.trade] || at > m[r.trade]) m[r.trade] = at;
  }
  return out;
}

// ───────── 회원 ─────────
type MemberRow = {
  id: string; name: string; role: string; trades: string[]; categories: string[] | null; handles: string | null; phone: string | null; address: string | null; menus: string[] | null; actions: GrantedActions | null; login_id: string | null; pass_hash: string | null;
  must_change_password: boolean; id_changed: boolean; created_at: string;
};
const toMember = (r: MemberRow): Member => ({
  id: r.id, name: r.name, role: r.role as RoleKey, trades: r.trades ?? [], categories: r.categories ?? [], handles: r.handles ?? '', phone: r.phone ?? '', address: r.address ?? '', menus: (r.menus ?? []) as MenuKey[], actions: r.actions ?? {}, createdAt: new Date(r.created_at).toISOString(),
  loginId: r.login_id ?? undefined, passHash: r.pass_hash ?? undefined, mustChangePassword: r.must_change_password, idChanged: r.id_changed,
});
const toRow = (m: Member) => ({
  id: m.id, name: m.name, role: m.role, trades: m.trades, categories: m.categories, handles: m.handles, phone: m.phone, address: m.address, menus: m.menus, actions: m.actions, login_id: m.loginId ?? null, pass_hash: m.passHash ?? null,
  must_change_password: m.mustChangePassword, id_changed: m.idChanged, created_at: m.createdAt,
});
function toPatchRow(p: MemberPatch): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (p.name !== undefined) o.name = p.name;
  if (p.role !== undefined) o.role = p.role;
  if (p.trades !== undefined) o.trades = p.trades;
  if (p.categories !== undefined) o.categories = p.categories;
  if (p.handles !== undefined) o.handles = p.handles;
  if (p.phone !== undefined) o.phone = p.phone;
  if (p.address !== undefined) o.address = p.address;
  if (p.menus !== undefined) o.menus = p.menus;
  if (p.actions !== undefined) o.actions = p.actions;
  if (p.loginId !== undefined) o.login_id = p.loginId;
  if (p.passHash !== undefined) o.pass_hash = p.passHash;
  if (p.mustChangePassword !== undefined) o.must_change_password = p.mustChangePassword;
  if (p.idChanged !== undefined) o.id_changed = p.idChanged;
  return o;
}

type Conflict = { conflict: 'name' | 'loginId' };
/** 동시에 같은 이름·아이디로 만드는 경우는 DB 의 unique 인덱스가 막는다. 그 오류를 충돌 종류로 바꾼다. */
const conflictOf = (e: NonNullable<DbError>): Conflict | null => (e.code === '23505' ? { conflict: /login/.test(e.message) ? 'loginId' : 'name' } : null);

export async function getMembers(): Promise<Member[]> {
  const rows = await fetchAll<MemberRow>((a, b) => supabase().from('members').select('*').order('created_at').order('id').range(a, b), '회원 조회');
  return rows.map(toMember);
}
export async function getMember(id: string): Promise<Member | null> {
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(id)) return null;
  const row = must(await supabase().from('members').select('*').eq('id', id).maybeSingle(), '회원 조회') as MemberRow | null;
  return row ? toMember(row) : null;
}
export async function getMemberByLoginId(loginId: string): Promise<Member | null> {
  const row = must(await supabase().from('members').select('*').eq('login_id', loginId.trim().toLowerCase()).maybeSingle(), '로그인 조회') as MemberRow | null;
  return row ? toMember(row) : null;
}

export async function insertMember(m: Member): Promise<{ member: Member } | Conflict> {
  const { data, error } = await supabase().from('members').insert(toRow(m)).select('*').single();
  if (error) {
    const c = conflictOf(error);
    if (c) return c;
    throw new Error(`Supabase 회원 등록 실패: ${error.message}`);
  }
  return { member: toMember(data as MemberRow) };
}

export async function patchMember(id: string, patch: MemberPatch): Promise<{ member: Member } | Conflict | { notFound: true }> {
  const row = toPatchRow(patch);
  if (!Object.keys(row).length) {
    const cur = await getMember(id);
    return cur ? { member: cur } : { notFound: true };
  }
  const { data, error } = await supabase().from('members').update(row).eq('id', id).select('*').maybeSingle();
  if (error) {
    const c = conflictOf(error);
    if (c) return c;
    throw new Error(`Supabase 회원 수정 실패: ${error.message}`);
  }
  return data ? { member: toMember(data as MemberRow) } : { notFound: true };
}

export async function removeMember(id: string): Promise<boolean> {
  const rows = must(await supabase().from('members').delete().eq('id', id).select('id'), '회원 삭제') as { id: string }[];
  return rows.length > 0;
}

// ───────── 팀 ─────────
type TeamRow = { key: string; label: string; grp: string; locked: boolean };
const toTeam = (r: TeamRow): Team => ({ key: r.key, label: r.label, group: r.grp as GroupKey, locked: r.locked });

export async function getTeams(): Promise<Team[]> {
  const rows = await fetchAll<TeamRow>((a, b) => supabase().from('teams').select('*').order('sort').order('created_at').range(a, b), '팀 조회');
  return rows.map(toTeam);
}

export async function insertTeam(t: Team): Promise<{ team: Team } | { conflict: 'label' }> {
  const { data, error } = await supabase().from('teams').insert({ key: t.key, label: t.label, grp: t.group, locked: t.locked, sort: 1000 }).select('*').single();
  if (error) {
    if (error.code === '23505') return { conflict: 'label' };
    throw new Error(`Supabase 팀 추가 실패: ${error.message}`);
  }
  return { team: toTeam(data as TeamRow) };
}

/** 팀 삭제: 소속 회원이 있으면 지우지 않고 인원수를 알려준다 (DB 의 외래 키도 같은 규칙을 한 번 더 지킨다). */
export async function removeTeam(key: string): Promise<{ ok: true } | { inUse: number } | { notFound: true }> {
  const { count, error: ce } = await supabase().from('members').select('*', { count: 'exact', head: true }).eq('role', key);
  if (ce) throw new Error(`Supabase 팀 소속 회원 확인 실패: ${ce.message}`);
  if ((count ?? 0) > 0) return { inUse: count ?? 0 };
  const { data, error } = await supabase().from('teams').delete().eq('key', key).select('key');
  if (error) {
    if (error.code === '23503') return { inUse: 1 }; // 그 사이에 회원이 생긴 경우
    throw new Error(`Supabase 팀 삭제 실패: ${error.message}`);
  }
  return (data as { key: string }[]).length > 0 ? { ok: true } : { notFound: true };
}

// ───────── 카테고리 ─────────
const squashCat = (s: string) => s.split(' ').join('').toLowerCase();

async function loadCategories(): Promise<string[]> {
  const rows = await fetchAll<{ name: string }>((a, b) => supabase().from('categories').select('name').order('sort').order('created_at').range(a, b), '카테고리 조회');
  const stored = rows.map(r => r.name);
  const used = await fetchAll<{ category: string }>((a, b) => supabase().from('products').select('category').is('deleted_at', null).order('seq').range(a, b), '자재 카테고리 조회');
  return [...stored, ...[...new Set(used.map(x => x.category))].filter(c => !stored.includes(c))];
}
export const getCategories = () => loadCategories();

async function ensureCategoryRow(name: string, order: number) {
  const has = must(await supabase().from('categories').select('name').eq('name', name).maybeSingle(), '카테고리 확인') as { name: string } | null;
  if (!has) must(await supabase().from('categories').insert({ name, sort: order }), '카테고리 추가');
}

export async function getCategoryTrades(): Promise<Record<string, string>> {
  const list = await loadCategories();
  const rows = await fetchAll<{ name: string; trade: string }>((a, b) => supabase().from('categories').select('name,trade').range(a, b), '카테고리 공정 조회');
  const map = new Map(rows.map(r => [r.name, r.trade]));
  return Object.fromEntries(list.map(c => [c, map.get(c) ?? '']));
}

export async function setCategoryTrade(name: string, trade: string): Promise<CatResult> {
  const list = await loadCategories();
  if (!list.includes(name)) return { notFound: true };
  if (trade && !(await getTrades()).includes(trade)) return { notFound: true };
  await ensureCategoryRow(name, list.indexOf(name) + 1);
  must(await supabase().from('categories').update({ trade }).eq('name', name), '카테고리 공정 지정');
  return { ok: true };
}

export async function addCategory(name: string, trade = ''): Promise<CatResult> {
  const list = await loadCategories();
  if (list.some(c => squashCat(c) === squashCat(name))) return { conflict: true };
  const res = await supabase().from('categories').insert({ name, sort: list.length + 1, trade });
  if (res.error) {
    if (res.error.code === '23505') return { conflict: true };
    throw new Error(`Supabase 카테고리 추가 실패: ${res.error.message}`);
  }
  return { ok: true };
}

export async function renameCategory(from: string, to: string): Promise<CatResult> {
  const list = await loadCategories();
  if (!list.includes(from)) return { notFound: true };
  if (list.some(c => c !== from && squashCat(c) === squashCat(to))) return { conflict: true };
  await ensureCategoryRow(from, list.indexOf(from) + 1);
  const moved = must(await supabase().from('products').update({ category: to }).eq('category', from).select('key'), '카테고리 이름 변경') as { key: string }[];
  must(await supabase().from('categories').update({ name: to }).eq('name', from), '카테고리 이름 변경');
  return { ok: true, count: moved.length };
}

export async function removeCategory(name: string): Promise<CatResult> {
  const list = await loadCategories();
  if (!list.includes(name)) return { notFound: true };
  // 소모품은 휴지통으로(복원 가능), 카테고리는 지운다
  const moved = must(await supabase().from('products').update({ deleted_at: new Date().toISOString() }).eq('category', name).is('deleted_at', null).select('key'), '카테고리 소모품 삭제') as { key: string }[];
  must(await supabase().from('categories').delete().eq('name', name), '카테고리 삭제');
  return { ok: true, count: moved.length };
}

// ───────── 공정 추가 / 삭제 (app_settings.trades) ─────────
async function saveTrades(list: string[]) {
  must(await supabase().from('app_settings').upsert({ key: 'trades', value: list }, { onConflict: 'key' }), '공정 목록 저장');
}

export async function addTrade(name: string): Promise<TradeResult> {
  const trades = await getTrades();
  if (trades.some(t => squashCat(t) === squashCat(name))) return { conflict: true };
  await saveTrades([...trades, name]);
  return { ok: true };
}

/** 공정을 지운다. 소모품(휴지통 포함)·회원에 걸린 이 공정과 카테고리의 공정 지정도 함께 뺀다. */
export async function removeTrade(name: string): Promise<TradeResult> {
  const trades = await getTrades();
  if (!trades.includes(name)) return { notFound: true };
  let n = 0;
  const prods = await fetchAll<{ key: string; trades: string[] }>((a, b) => supabase().from('products').select('key,trades').contains('trades', [name]).order('key').range(a, b), '공정 소모품 조회');
  for (const p of prods) {
    must(await supabase().from('products').update({ trades: (p.trades ?? []).filter(t => t !== name) }).eq('key', p.key), '소모품 공정 제거');
    n++;
  }
  const mems = await fetchAll<{ id: string; trades: string[] }>((a, b) => supabase().from('members').select('id,trades').contains('trades', [name]).order('id').range(a, b), '공정 회원 조회');
  for (const m of mems) must(await supabase().from('members').update({ trades: (m.trades ?? []).filter(t => t !== name) }).eq('id', m.id), '회원 공정 제거');
  must(await supabase().from('categories').update({ trade: '' }).eq('trade', name), '카테고리 공정 해제');
  await saveTrades(trades.filter(t => t !== name));
  return { ok: true, count: n };
}

// ───────── 현장 자재 요청 (requests 테이블) ─────────
type RequestRow = { id: number; worker_id: string | null; name: string; trade: string; site: string | null; at: string; items: RequestItem[]; done: boolean | null; done_at: string | null; done_by: string | null };
const toRequest = (r: RequestRow): MaterialRequest => ({ id: String(r.id), workerId: r.worker_id, name: r.name, trade: r.trade, site: r.site ?? '', at: new Date(r.at).toISOString(), items: r.items ?? [], done: r.done ?? true, doneAt: r.done_at ? new Date(r.done_at).toISOString() : null, doneBy: r.done_by ?? null });

export async function saveRequest(r: Omit<MaterialRequest, 'id' | 'at' | 'done' | 'doneAt' | 'doneBy'>): Promise<MaterialRequest> {
  const row = must(await supabase().from('requests').insert({ worker_id: r.workerId, name: r.name, trade: r.trade, site: r.site, items: r.items }).select('*').single(), '요청 저장') as RequestRow;
  return toRequest(row);
}

/**
 * 요청을 '준비 완료'로 처리한다. 재고가 모자라 아직 못 채운 품목이 남아 있으면 처리하지 않는다.
 * 'ok' 처리됨 · 'short' 부족한 품목이 남음 · 'none' 없거나 이미 완료된 요청
 */
export async function completeRequest(id: string, by: string): Promise<'ok' | 'short' | 'none'> {
  const n = Number(id);
  if (!Number.isInteger(n)) return 'none';
  const row = must(await supabase().from('requests').select('items,done').eq('id', n).maybeSingle(), '요청 조회') as { items: RequestItem[]; done: boolean | null } | null;
  if (!row || row.done) return 'none';
  if ((row.items ?? []).some(it => (it.s ?? 0) > 0)) return 'short';
  const rows = must(await supabase().from('requests').update({ done: true, done_at: new Date().toISOString(), done_by: by }).eq('id', n).eq('done', false).select('id'), '요청 완료 처리') as { id: number }[];
  return rows.length > 0 ? 'ok' : 'none';
}

/**
 * 재고가 모자랐던 품목을 채운다: 입고 수량(received)만큼 재고에 넣고, 이 요청의 부족분(s)을 바로 가져간다.
 * 입고 수량은 부족분 이상이어야 하고, 남는 수량은 재고에 그대로 남는다.
 */
export async function fillRequestItem(id: string, k: string, received: number): Promise<{ request: MaterialRequest } | { error: string }> {
  const n = Number(id);
  if (!Number.isInteger(n)) return { error: '없는 요청이에요.' };
  const row = must(await supabase().from('requests').select('*').eq('id', n).maybeSingle(), '요청 조회') as RequestRow | null;
  if (!row) return { error: '없는 요청이에요.' };
  if (row.done) return { error: '이미 준비 완료된 요청이에요.' };
  const items = row.items ?? [];
  const it = items.find(x => x.k === k);
  const need = it?.s ?? 0;
  if (!it || need <= 0) return { error: '채울 부족분이 없는 품목이에요.' };
  if (!Number.isInteger(received) || received < need) return { error: '부족한 ' + need + '개 이상 입고해야 해요.' };
  const add = received - need; // 부족분은 이 요청이 가져가고, 나머지만 재고에 남는다
  if (add > 0) {
    let done = false;
    for (let tries = 0; tries < 5 && !done; tries++) {
      const p = must(await supabase().from('products').select('stock').eq('key', k).maybeSingle(), '재고 조회') as { stock: number | null } | null;
      if (!p) return { error: '재고 목록에 없는 자재예요.' };
      const from = p.stock ?? 0;
      const upd = must(await supabase().from('products').update({ stock: from + add }).eq('key', k).eq('stock', from).select('key'), '재고 입고') as { key: string }[];
      done = upd.length > 0;
    }
    if (!done) return { error: '재고를 저장하지 못했어요. 잠시 후 다시 해 주세요.' };
  }
  const nextItems = items.map(x => (x.k === k ? { ...x, s: undefined, f: (x.f ?? 0) + need } : x));
  const saved = must(await supabase().from('requests').update({ items: nextItems }).eq('id', n).select('*').single(), '요청 수정') as RequestRow;
  return { request: toRequest(saved) };
}

/** 최신순 (최근 300건) */
export async function getRequests(): Promise<MaterialRequest[]> {
  const rows = must(await supabase().from('requests').select('*').order('at', { ascending: false }).limit(300), '요청 조회') as RequestRow[];
  return rows.map(toRequest);
}

export async function moveProducts(keys: string[], category: string): Promise<CatResult> {
  const list = await loadCategories();
  if (!list.includes(category)) return { notFound: true };
  await ensureCategoryRow(category, list.indexOf(category) + 1);
  let n = 0;
  for (const part of chunks(keys)) {
    const rows = must(await supabase().from('products').update({ category, sub: '' }).in('key', part).neq('category', category).select('key'), '카테고리 이동') as { key: string }[];
    n += rows.length;
  }
  return { ok: true, count: n };
}

/** 다음에 쓸 자재 번호 (p0001 형식, 휴지통 포함해서 가장 큰 번호 다음) */
export async function nextProductKey(): Promise<string> {
  const rows = must(await supabase().from('products').select('key').like('key', 'p%').order('key', { ascending: false }).limit(50), '자재 번호 조회') as { key: string }[];
  let max = 0;
  for (const r of rows) {
    const m = /^p(\d+)$/.exec(r.key);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return 'p' + String(max + 1).padStart(4, '0');
}

/** 새 자재 등록. 목록 맨 뒤(seq 가 가장 큰 값 다음)에 들어간다. */
export async function addProduct(p: Omit<Product, 'seq'>): Promise<Product> {
  const top = must(await supabase().from('products').select('seq').order('seq', { ascending: false }).limit(1), '순서 조회') as { seq: number }[];
  const seq = (top[0]?.seq ?? 0) + 1;
  const row = must(
    await supabase().from('products').insert({
      key: p.key, seq, category: p.category, sub: p.sub, name: p.name, brand: p.brand, price: p.price, price_incl_vat: null, vat_basis: null,
      soldout: false, stock: p.stock, image: p.image, trades: p.trades,
    }).select('*').single(),
    '자재 등록',
  ) as ProductRow;
  return toProduct(row);
}

/**
 * 현장 요청이 들어오면 재고에서 요청 수량만큼 뺀다. 재고보다 많이 요청해도 받는다 — 재고는 0까지만 줄고,
 * 실제로 뺀 수량(took)을 돌려준다. (요청 수량 - took = 부족한 수량)
 */
export async function takeStock(lines: { k: string; q: number }[]): Promise<{ ok: true; took: Record<string, number> } | { short: string }> {
  const took: Record<string, number> = {};
  for (const l of lines) {
    let done = false;
    for (let tries = 0; tries < 5 && !done; tries++) {
      const r = must(await supabase().from('products').select('stock').eq('key', l.k).is('deleted_at', null).maybeSingle(), '재고 조회') as { stock: number | null } | null;
      if (!r) {
        await returnStock(took);
        return { short: '없는 자재가 섞여 있어요. 화면을 새로고침해 주세요.' };
      }
      const from = r.stock ?? 0;
      const t = Math.min(from, l.q);
      if (t === 0) {
        took[l.k] = 0;
        done = true;
        break;
      }
      // 읽은 값 그대로일 때만 바꾼다 (그 사이 다른 요청이 재고를 바꿨다면 다시 읽어서 시도한다)
      const upd = must(await supabase().from('products').update({ stock: from - t }).eq('key', l.k).eq('stock', from).select('key'), '재고 차감') as { key: string }[];
      if (upd.length) {
        took[l.k] = t;
        done = true;
      }
    }
    if (!done) {
      await returnStock(took);
      return { short: '요청이 몰려서 처리하지 못했어요. 잠시 후 다시 요청해 주세요.' };
    }
  }
  return { ok: true, took };
}

/** takeStock 으로 뺀 재고를 되돌린다 (요청 저장에 실패했을 때) */
export async function returnStock(took: Record<string, number>): Promise<void> {
  for (const [k, q] of Object.entries(took)) {
    if (!q) continue;
    const r = must(await supabase().from('products').select('stock').eq('key', k).maybeSingle(), '재고 조회') as { stock: number | null } | null;
    if (r) await supabase().from('products').update({ stock: (r.stock ?? 0) + q }).eq('key', k);
  }
}

/** 재고 수량 저장. 바뀐 개수(0 또는 1)를 돌려준다. */
export async function setStock(key: string, stock: number): Promise<number> {
  const rows = must(await supabase().from('products').update({ stock }).eq('key', key).select('key'), '재고 저장') as { key: string }[];
  return rows.length;
}

export async function renameProduct(key: string, name: string): Promise<number> {
  const rows = must(await supabase().from('products').update({ name }).eq('key', key).select('key'), '이름 변경') as { key: string }[];
  return rows.length;
}

export async function saveCategoryOrder(order: string[]): Promise<void> {
  must(await supabase().from('categories').upsert(order.map((name, i) => ({ name, sort: i + 1 })), { onConflict: 'name' }), '카테고리 순서 저장');
}

export async function swapProducts(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const rows = must(await supabase().from('products').select('key,seq').in('key', [a, b]).is('deleted_at', null), '순서 조회') as { key: string; seq: number }[];
  const ra = rows.find(r => r.key === a);
  const rb = rows.find(r => r.key === b);
  if (!ra || !rb) return false;
  must(await supabase().from('products').update({ seq: rb.seq }).eq('key', a), '순서 변경');
  must(await supabase().from('products').update({ seq: ra.seq }).eq('key', b), '순서 변경');
  return true;
}
