import 'server-only';
import { asIcon, asKind, MAX_VEHICLE_PHOTOS } from './types';
import { toEntries, type CycleEntry } from './attendance-cycle';
import type { AnnualLeave } from './leave';
import type { SitePost, Kind, MaterialRequest, Member, MemberPatch, Product, RequestItem, SurveyPayload, TrashedProduct, Vehicle, VehicleSpec, VehiclePhoto, LoadPackage, LoadPackageInput, LoadPackageItem, VehicleItem, VehicleResult, Site, SiteInput, SiteExtension, Placement, PlacementNote, Slot, LeaveRequest, LeaveInput, PayType, Expense, ExpenseInput, InventoryEntry, InventoryEntryInput, AuditEntry, AuditInput, PricingSnapshot, InventoryExcluded, PurchaseInfo, VehicleLayout, PurchaseOption, VendorShipping } from './types';
import { applyTeamLocks, type GrantedActions, type GroupKey, type MenuKey, type RoleKey, type Team } from './roles';
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
  price: number | null; price_incl_vat: number | null; vat_basis: string | null; soldout: boolean; stock: number | null; kind: string | null; image: string; trades: string[];
  deleted_at: string | null;
};
const toProduct = (r: ProductRow): Product => ({
  seq: r.seq, key: r.key, category: r.category, sub: r.sub, name: r.name, brand: r.brand,
  price: r.price ?? 0, priceInclVat: r.price_incl_vat, vatBasis: r.vat_basis ?? '', soldout: r.soldout, stock: r.stock ?? 0, kind: asKind(r.kind), image: r.image, trades: r.trades ?? [],
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
  id: string; name: string; role: string; extra_role: string | null; pay_type: string | null; trades: string[]; categories: string[] | null; handles: string | null; phone: string | null; address: string | null; address_detail: string | null; position: string | null; hire_date: string | null; pay_amount: number | null; pay_history: { from: string; amount: number; at: string }[] | null; bank: string | null; account_no: string | null; account_holder: string | null; safety_date: string | null; license: string | null; resign_date: string | null; employment_history: { hire: string; resign: string }[] | null; photo: string | null; bankbook: string | null; field_roles: string[] | null; office_status: string | null; menus: string[] | null; actions: GrantedActions | null; login_id: string | null; pass_hash: string | null;
  must_change_password: boolean; id_changed: boolean; created_at: string;
};
const toMember = (r: MemberRow): Member => ({
  id: r.id, name: r.name, role: r.role as RoleKey, extraRole: (r.extra_role ?? '') as RoleKey | '', payType: (r.pay_type ?? '') as PayType, trades: r.trades ?? [], categories: r.categories ?? [], handles: r.handles ?? '', phone: r.phone ?? '', address: r.address ?? '', addressDetail: r.address_detail ?? '', position: r.position ?? '', hireDate: r.hire_date ?? '', payAmount: r.pay_amount ?? 0, payHistory: r.pay_history ?? [], bank: r.bank ?? '', accountNo: r.account_no ?? '', accountHolder: r.account_holder ?? '', safetyDate: r.safety_date ?? '', license: r.license ?? '', resignDate: r.resign_date ?? '', history: r.employment_history ?? [], photo: r.photo ?? '', bankbook: r.bankbook ?? '', fieldRoles: (r.field_roles ?? []) as RoleKey[], officeStatus: (r.office_status ?? '') as '' | 'probation' | 'regular', menus: (r.menus ?? []) as MenuKey[], actions: r.actions ?? {}, createdAt: new Date(r.created_at).toISOString(),
  loginId: r.login_id ?? undefined, passHash: r.pass_hash ?? undefined, mustChangePassword: r.must_change_password, idChanged: r.id_changed,
});
const toRow = (m: Member) => ({
  id: m.id, name: m.name, role: m.role, extra_role: m.extraRole || null, pay_type: m.payType || null, trades: m.trades, categories: m.categories, handles: m.handles, phone: m.phone, address: m.address, address_detail: m.addressDetail ?? '', position: m.position, hire_date: m.hireDate || null, pay_amount: m.payAmount || 0, pay_history: m.payHistory ?? [], bank: m.bank, account_no: m.accountNo, account_holder: m.accountHolder, safety_date: m.safetyDate || null, license: m.license, resign_date: m.resignDate || null, employment_history: m.history ?? [], photo: m.photo ?? '', bankbook: m.bankbook ?? '', field_roles: m.fieldRoles, office_status: m.officeStatus, menus: m.menus, actions: m.actions, login_id: m.loginId ?? null, pass_hash: m.passHash ?? null,
  must_change_password: m.mustChangePassword, id_changed: m.idChanged, created_at: m.createdAt,
});
function toPatchRow(p: MemberPatch): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (p.name !== undefined) o.name = p.name;
  if (p.role !== undefined) o.role = p.role;
  if (p.extraRole !== undefined) o.extra_role = p.extraRole || null;
  if (p.payType !== undefined) o.pay_type = p.payType || null;
  if (p.trades !== undefined) o.trades = p.trades;
  if (p.categories !== undefined) o.categories = p.categories;
  if (p.handles !== undefined) o.handles = p.handles;
  if (p.phone !== undefined) o.phone = p.phone;
  if (p.address !== undefined) o.address = p.address;
  if (p.addressDetail !== undefined) o.address_detail = p.addressDetail;
  if (p.position !== undefined) o.position = p.position;
  if (p.hireDate !== undefined) o.hire_date = p.hireDate || null;
  if (p.payAmount !== undefined) o.pay_amount = p.payAmount || 0;
  if (p.payHistory !== undefined) o.pay_history = p.payHistory;
  if (p.bank !== undefined) o.bank = p.bank;
  if (p.accountNo !== undefined) o.account_no = p.accountNo;
  if (p.accountHolder !== undefined) o.account_holder = p.accountHolder;
  if (p.safetyDate !== undefined) o.safety_date = p.safetyDate || null;
  if (p.license !== undefined) o.license = p.license;
  if (p.resignDate !== undefined) o.resign_date = p.resignDate || null;
  if (p.history !== undefined) o.employment_history = p.history;
  if (p.photo !== undefined) o.photo = p.photo;
  if (p.bankbook !== undefined) o.bankbook = p.bankbook;
  if (p.fieldRoles !== undefined) o.field_roles = p.fieldRoles;
  if (p.officeStatus !== undefined) o.office_status = p.officeStatus;
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
type TeamRow = { key: string; label: string; grp: string; locked: boolean; trades?: string[] | null };
const toTeam = (r: TeamRow): Team => ({ key: r.key, label: r.label, group: r.grp as GroupKey, locked: r.locked, trades: r.trades ?? [] });

export async function getTeams(): Promise<Team[]> {
  const load = async () => (await fetchAll<TeamRow>((a, b) => supabase().from('teams').select('*').order('sort').order('created_at').range(a, b), '팀 조회')).map(toTeam);
  return applyTeamLocks(await load()); // 지운 기본 팀을 다시 만들지 않는다
}

export async function insertTeam(t: Team): Promise<{ team: Team } | { conflict: 'label' }> {
  const { data, error } = await supabase().from('teams').insert({ key: t.key, label: t.label, grp: t.group, locked: t.locked, sort: 1000 }).select('*').single();
  if (error) {
    if (error.code === '23505') return { conflict: 'label' };
    throw new Error(`Supabase 팀 추가 실패: ${error.message}`);
  }
  return { team: toTeam(data as TeamRow) };
}

/** 현장 팀이 관여하는 공정 저장 */
export async function updateTeamTrades(key: string, trades: string[]): Promise<Team | null> {
  const { data, error } = await supabase().from('teams').update({ trades }).eq('key', key).select('*').maybeSingle();
  if (error) throw new Error(`Supabase 팀 공정 저장 실패: ${error.message}`);
  return data ? toTeam(data as TeamRow) : null;
}

/** 팀 삭제: 소속 회원이 있으면 지우지 않고 인원수를 알려준다 (DB 의 외래 키도 같은 규칙을 한 번 더 지킨다). */
export async function removeTeam(key: string): Promise<{ ok: true } | { inUse: number } | { notFound: true }> {
  const { count, error: ce } = await supabase().from('members').select('*', { count: 'exact', head: true }).eq('role', key);
  if (ce) throw new Error(`Supabase 팀 소속 회원 확인 실패: ${ce.message}`);
  if ((count ?? 0) > 0) return { inUse: count ?? 0 };
  const { count: fc } = await supabase().from('members').select('*', { count: 'exact', head: true }).contains('field_roles', [key]);
  if ((fc ?? 0) > 0) return { inUse: fc ?? 0 };
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

export async function setSubs(entries: { key: string; sub: string }[]): Promise<void> {
  for (let i = 0; i < entries.length; i += 20) {
    await Promise.all(entries.slice(i, i + 20).map(async e => { must(await supabase().from('products').update({ sub: e.sub }).eq('key', e.key), '세부분류 저장'); }));
  }
}

export async function reorderTrades(order: string[]): Promise<boolean> {
  const trades = await getTrades();
  if (order.length !== trades.length || new Set(order).size !== order.length || !order.every(t => trades.includes(t))) return false;
  await saveTrades(order);
  return true;
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

/** 품목의 장비운용 분류(연장/소모품/자재)를 바꾼다 (휴지통 포함). 바뀐 개수를 돌려준다. */
export async function setKind(keys: string[], kind: Kind): Promise<number> {
  let n = 0;
  for (const part of chunks(keys)) {
    const rows = must(await supabase().from('products').update({ kind }).in('key', part).neq('kind', kind).select('key'), '분류 변경') as { key: string }[];
    n += rows.length;
  }
  return n;
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
      soldout: false, stock: p.stock, kind: p.kind, image: p.image, trades: p.trades,
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

export async function updateProduct(key: string, e: { name: string; sub: string; brand: string; price: number; kind?: Kind; image?: string; priceInclVat?: number | null }): Promise<{ prevImage: string } | null> {
  const cur = must(await supabase().from('products').select('image,price').eq('key', key).maybeSingle(), '소모품 조회') as { image: string; price: number | null } | null;
  if (!cur) return null;
  const patch: Record<string, unknown> = { name: e.name, sub: e.sub, brand: e.brand, price: e.price };
  if (e.kind) patch.kind = e.kind;
  if (e.price !== (cur.price ?? 0)) patch.price_incl_vat = null;
  if (e.priceInclVat !== undefined) patch.price_incl_vat = e.priceInclVat; // 부가세 포함가를 직접 적은 경우 그 값을 그대로 저장
  if (e.image) patch.image = e.image;
  must(await supabase().from('products').update(patch).eq('key', key), '소모품 수정');
  return { prevImage: cur.image };
}

export async function saveCategoryOrder(order: string[]): Promise<void> {
  must(await supabase().from('categories').upsert(order.map((name, i) => ({ name, sort: i + 1 })), { onConflict: 'name' }), '카테고리 순서 저장');
}

export async function reorderProducts(keys: string[]): Promise<boolean> {
  if (new Set(keys).size !== keys.length || keys.length === 0) return false;
  const rows = must(await supabase().from('products').select('key,seq').in('key', keys).is('deleted_at', null), '순서 조회') as { key: string; seq: number }[];
  if (rows.length !== keys.length) return false;
  const seqs = rows.map(r => r.seq).sort((x, y) => x - y);
  const cur = new Map(rows.map(r => [r.key, r.seq]));
  const changed = keys.map((k, i) => ({ k, seq: seqs[i] })).filter(x => cur.get(x.k) !== x.seq);
  for (let i = 0; i < changed.length; i += 20) {
    await Promise.all(changed.slice(i, i + 20).map(async x => { must(await supabase().from('products').update({ seq: x.seq }).eq('key', x.k), '순서 변경'); }));
  }
  return true;
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

// ───────── 차량정보 ─────────
type VehicleRow = { id: number; name: string; nickname: string | null; icon: string | null; memo: string; driver_id: string | null; created_at: string; model: string | null; year: string | null; vin: string | null; ownership: string | null; mileage: number | null; oil_date: string | null; oil_km: number | null; inspection_date: string | null; photos: VehiclePhoto[] | null; insurer: string | null; policy_no: string | null; insurance_expiry: string | null; premium: number | null; insurance_phone: string | null; insurance_note: string | null };
type VehicleItemRow = { id: number; vehicle_id: number; product_key: string; qty: number; note: string; at: string };
const toVehicle = (r: VehicleRow): Vehicle => ({ id: String(r.id), name: r.name, nickname: r.nickname ?? '', icon: asIcon(r.icon), memo: r.memo, driverId: r.driver_id ?? '', createdAt: new Date(r.created_at).toISOString(), model: r.model ?? '', year: r.year ?? '', vin: r.vin ?? '', ownership: (['owned', 'lease', 'rent'].includes(r.ownership ?? '') ? r.ownership : '') as VehicleSpec['ownership'], mileage: r.mileage ?? 0, oilDate: r.oil_date ?? '', oilKm: r.oil_km ?? 0, inspectionDate: r.inspection_date ?? '', photos: Array.isArray(r.photos) ? r.photos : [], insurer: r.insurer ?? '', policyNo: r.policy_no ?? '', insuranceExpiry: r.insurance_expiry ?? '', premium: r.premium ?? 0, insurancePhone: r.insurance_phone ?? '', insuranceNote: r.insurance_note ?? '' });
const specCols = (s: VehicleSpec) => ({ model: s.model, year: s.year, vin: s.vin, ownership: s.ownership, mileage: s.mileage, oil_date: s.oilDate || null, oil_km: s.oilKm, inspection_date: s.inspectionDate || null, insurer: s.insurer, policy_no: s.policyNo, insurance_expiry: s.insuranceExpiry || null, premium: s.premium, insurance_phone: s.insurancePhone, insurance_note: s.insuranceNote });
const toVehicleItem = (r: VehicleItemRow): VehicleItem => ({ id: String(r.id), vehicleId: String(r.vehicle_id), key: r.product_key, qty: r.qty, note: r.note, at: new Date(r.at).toISOString() });
const numId = (s: string) => (/^\d{1,15}$/.test(s) ? Number(s) : -1);
const DUP = '같은 차량 번호나 별칭이 이미 있어요.';

export async function getVehicles(): Promise<Vehicle[]> {
  return (await fetchAll<VehicleRow>((a, b) => supabase().from('vehicles').select('*').order('id').range(a, b), '차량 조회')).map(toVehicle);
}
export async function getVehicleItems(): Promise<VehicleItem[]> {
  return (await fetchAll<VehicleItemRow>((a, b) => supabase().from('vehicle_items').select('*').order('id').range(a, b), '차량 품목 조회')).map(toVehicleItem);
}

export async function addVehicle(name: string, nickname: string, icon: string, memo: string, driverId: string, spec: VehicleSpec): Promise<VehicleResult<{ vehicle: Vehicle }>> {
  const res = await supabase().from('vehicles').insert({ name, nickname, icon, memo, driver_id: driverId || null, ...specCols(spec) }).select('*').single();
  if (res.error) {
    if (res.error.code === '23505') return { error: DUP };
    throw new Error('Supabase 차량 등록 실패: ' + res.error.message);
  }
  return { ok: true, vehicle: toVehicle(res.data as VehicleRow) };
}

export async function updateVehicle(id: string, name: string, nickname: string, icon: string, memo: string, driverId: string, spec: VehicleSpec): Promise<VehicleResult> {
  const res = await supabase().from('vehicles').update({ name, nickname, icon, memo, driver_id: driverId || null, ...specCols(spec) }).eq('id', numId(id)).select('id');
  if (res.error) {
    if (res.error.code === '23505') return { error: DUP };
    throw new Error('Supabase 차량 수정 실패: ' + res.error.message);
  }
  return (res.data ?? []).length ? { ok: true } : { error: '없는 차량이에요.' };
}

/** 차량 현황 사진 추가. 한도를 넘으면 가장 오래된 사진부터 빠지고, 빠진 사진 주소를 돌려준다(파일 정리용). */
export async function addVehiclePhoto(id: string, photo: VehiclePhoto): Promise<VehicleResult<{ removed: string[] }>> {
  const n = numId(id);
  const row = must(await supabase().from('vehicles').select('photos').eq('id', n).maybeSingle(), '차량 조회') as { photos: VehiclePhoto[] | null } | null;
  if (!row) return { error: '없는 차량이에요.' };
  const all = [photo, ...(Array.isArray(row.photos) ? row.photos : [])];
  must(await supabase().from('vehicles').update({ photos: all.slice(0, MAX_VEHICLE_PHOTOS) }).eq('id', n).select('id'), '차량 사진 저장');
  return { ok: true, removed: all.slice(MAX_VEHICLE_PHOTOS).map(p => p.url) };
}
export async function removeVehiclePhoto(id: string, url: string): Promise<VehicleResult> {
  const n = numId(id);
  const row = must(await supabase().from('vehicles').select('photos').eq('id', n).maybeSingle(), '차량 조회') as { photos: VehiclePhoto[] | null } | null;
  const cur = Array.isArray(row?.photos) ? row!.photos! : [];
  if (!row || !cur.some(p => p.url === url)) return { error: '없는 사진이에요.' };
  must(await supabase().from('vehicles').update({ photos: cur.filter(p => p.url !== url) }).eq('id', n).select('id'), '차량 사진 삭제');
  return { ok: true };
}

export async function removeVehicle(id: string): Promise<VehicleResult> {
  const n = numId(id);
  // 차량에 배치된 품목은 모두 되돌린 뒤 삭제한다 (연장은 창고 재고로 돌아오고, 상비품은 차량에서 빠진다 — 내리기와 같은 규칙)
  const items = must(await supabase().from('vehicle_items').select('*').eq('vehicle_id', n), '차량 품목 조회') as VehicleItemRow[];
  for (const it of items) {
    const gone = must(await supabase().from('vehicle_items').delete().eq('id', it.id).eq('qty', it.qty).select('id'), '차량 품목 빼기') as { id: number }[];
    if (!gone.length) return { error: '다른 곳에서 먼저 바뀌었어요. 새로고침한 뒤 다시 해 주세요.' };
    const p = must(await supabase().from('products').select('kind').eq('key', it.product_key).maybeSingle(), '품목 조회') as { kind: string | null } | null;
    if (p && asKind(p.kind) === '연장') await adjustStock(it.product_key, it.qty);
  }
  const rows = must(await supabase().from('vehicles').delete().eq('id', n).select('id'), '차량 삭제') as { id: number }[];
  return rows.length ? { ok: true } : { error: '없는 차량이에요.' };
}

/** 재고를 읽은 값 그대로일 때만 바꾼다 (그 사이 바뀌었으면 다시 읽어서 시도). 바꾼 뒤 재고, 못 바꾸면 null */
async function adjustStock(key: string, delta: number): Promise<number | null> {
  for (let tries = 0; tries < 5; tries++) {
    const r = must(await supabase().from('products').select('stock').eq('key', key).maybeSingle(), '재고 조회') as { stock: number | null } | null;
    if (!r) return null;
    const from = r.stock ?? 0;
    const to = Math.max(0, from + delta);
    const upd = must(await supabase().from('products').update({ stock: to }).eq('key', key).eq('stock', from).select('key'), '재고 변경') as { key: string }[];
    if (upd.length) return to;
  }
  return null;
}

/** 연장은 배정한 수량만큼 창고 재고에서 뺀다. 상비품은 차량 수량만 따로 센다(재고는 그대로). */
export async function assignItem(vehicleId: string, key: string, qty: number, note: string): Promise<VehicleResult> {
  const vid = numId(vehicleId);
  const veh = must(await supabase().from('vehicles').select('id').eq('id', vid).maybeSingle(), '차량 조회') as { id: number } | null;
  if (!veh) return { error: '없는 차량이에요.' };
  const p = must(await supabase().from('products').select('kind').eq('key', key).is('deleted_at', null).maybeSingle(), '품목 조회') as { kind: string | null } | null;
  if (!p) return { error: '없는 품목이에요.' };
  const kind = asKind(p.kind);
  if (kind === '자재') return { error: '자재는 차량에 싣지 않아요. 연장이나 상비품만 가능해요.' };
  const n = qty;
  const now = new Date().toISOString();
  const memo = kind === '연장' ? note : '';
  if (kind === '연장') {
    // 먼저 재고에서 뺀다. 읽은 값 그대로일 때만 바뀌므로 같은 재고를 동시에 두 번 쓰지 못한다.
    let took = false;
    for (let tries = 0; tries < 5 && !took; tries++) {
      const r = must(await supabase().from('products').select('stock').eq('key', key).is('deleted_at', null).maybeSingle(), '재고 조회') as { stock: number | null } | null;
      const from = r?.stock ?? 0;
      if (from < n) return { error: '창고 재고가 부족해요. (현재 ' + from + '개)' };
      took = (must(await supabase().from('products').update({ stock: from - n }).eq('key', key).eq('stock', from).select('key'), '재고 차감') as { key: string }[]).length > 0;
    }
    if (!took) return { error: '요청이 몰려서 처리하지 못했어요. 잠시 후 다시 해 주세요.' };
  }
  try {
    // 같은 품목·같은 메모는 수량을 합친다
    for (let tries = 0; tries < 5; tries++) {
      const same = (must(await supabase().from('vehicle_items').select('*').eq('vehicle_id', vid).eq('product_key', key).eq('note', memo).limit(1), '차량 품목 조회') as VehicleItemRow[])[0];
      if (!same) break;
      const upd = must(await supabase().from('vehicle_items').update({ qty: same.qty + n, at: now }).eq('id', same.id).eq('qty', same.qty).select('id'), '수량 변경') as { id: number }[];
      if (upd.length) return { ok: true };
    }
    must(await supabase().from('vehicle_items').insert({ vehicle_id: vid, product_key: key, qty: n, note: memo, at: now }), '차량 적재');
  } catch (e) {
    if (kind === '연장') await adjustStock(key, n); // 저장에 실패하면 뺀 재고를 되돌린다
    throw e;
  }
  return { ok: true };
}

export async function returnItem(itemId: string, qty: number): Promise<VehicleResult> {
  const id = numId(itemId);
  const it = must(await supabase().from('vehicle_items').select('*').eq('id', id).maybeSingle(), '차량 품목 조회') as VehicleItemRow | null;
  if (!it) return { error: '이미 처리됐거나 없는 항목이에요.' };
  if (qty > it.qty) return { error: '차량에는 ' + it.qty + '개만 있어요.' };
  const done = qty === it.qty
    ? (must(await supabase().from('vehicle_items').delete().eq('id', id).eq('qty', it.qty).select('id'), '차량 품목 빼기') as { id: number }[])
    : (must(await supabase().from('vehicle_items').update({ qty: it.qty - qty }).eq('id', id).eq('qty', it.qty).select('id'), '차량 품목 빼기') as { id: number }[]);
  if (!done.length) return { error: '다른 곳에서 먼저 바뀌었어요. 새로고침해 주세요.' };
  // 연장을 내리면 창고 재고로 돌아온다
  const p = must(await supabase().from('products').select('kind').eq('key', it.product_key).maybeSingle(), '품목 조회') as { kind: string | null } | null;
  if (p && asKind(p.kind) === '연장') await adjustStock(it.product_key, qty);
  return { ok: true };
}

// ───────── 상단 메뉴 순서 (app_settings.menu_order) ─────────
export async function getMenuOrder(): Promise<string[]> {
  const row = must(await supabase().from('app_settings').select('value').eq('key', 'menu_order').maybeSingle(), '메뉴 순서 조회') as { value: unknown } | null;
  return Array.isArray(row?.value) ? (row!.value as unknown[]).filter((x): x is string => typeof x === 'string') : [];
}
export async function saveMenuOrder(order: string[]): Promise<void> {
  must(await supabase().from('app_settings').upsert({ key: 'menu_order', value: order }, { onConflict: 'key' }), '메뉴 순서 저장');
}

// ───────── 현장 일지 (site_posts) ─────────
type SitePostRow = { id: number; site_id: string; post_date: string; kind: string; body: string; photos: string[] | null; author_id: string | null; author_name: string; created_at: string };
const toSitePost = (r: SitePostRow): SitePost => ({ id: String(r.id), siteId: r.site_id, date: r.post_date, kind: (['log', 'change', 'order', 'etc'].includes(r.kind) ? r.kind : 'etc') as SitePost['kind'], body: r.body, photos: r.photos ?? [], authorId: r.author_id ?? '', authorName: r.author_name, createdAt: new Date(r.created_at).toISOString() });
export async function getSitePosts(siteId: string): Promise<SitePost[]> {
  return (await fetchAll<SitePostRow>((a, b) => supabase().from('site_posts').select('*').eq('site_id', siteId).order('post_date', { ascending: false }).order('id', { ascending: false }).range(a, b), '현장 일지 조회')).map(toSitePost);
}
export async function getSitePost(id: string): Promise<SitePost | null> {
  const row = must(await supabase().from('site_posts').select('*').eq('id', id).maybeSingle(), '현장 일지 조회') as SitePostRow | null;
  return row ? toSitePost(row) : null;
}
export async function addSitePost(i: Omit<SitePost, 'id' | 'createdAt'>): Promise<SitePost> {
  const { data, error } = await supabase().from('site_posts').insert({ site_id: i.siteId, post_date: i.date, kind: i.kind, body: i.body, photos: i.photos, author_id: i.authorId || null, author_name: i.authorName }).select('*').single();
  if (error) throw new Error('Supabase 현장 일지 등록 실패: ' + error.message);
  return toSitePost(data as SitePostRow);
}
export async function removeSitePost(id: string): Promise<SitePost | null> {
  const cur = await getSitePost(id);
  if (!cur) return null;
  must(await supabase().from('site_posts').delete().eq('id', id), '현장 일지 삭제');
  return cur;
}
/** 현장을 지우면 그 현장의 일지도 함께 정리한다 (사진 주소를 돌려준다) */
// ───────── 푸시 알림 (app_settings.push_state) — 알림을 켠 기기와 최근에 보낸 알림 ─────────
export async function getPushState(): Promise<import('./types').PushState> {
  const row = must(await supabase().from('app_settings').select('value').eq('key', 'push_state').maybeSingle(), '푸시 상태 조회') as { value: Partial<import('./types').PushState> | null } | null;
  return { subs: row?.value?.subs ?? [], feed: row?.value?.feed ?? [] };
}
export async function updatePushState(fn: (s: import('./types').PushState) => import('./types').PushState): Promise<void> {
  const next = fn(await getPushState());
  must(await supabase().from('app_settings').upsert({ key: 'push_state', value: next }, { onConflict: 'key' }), '푸시 상태 저장');
}

export type SiteMarks = Record<string, { infoAt?: string; drawingsAt?: string }>;
export async function getSiteMarks(): Promise<SiteMarks> {
  const row = must(await supabase().from('app_settings').select('value').eq('key', 'site_marks').maybeSingle(), '현장 변경 표시 조회') as { value: unknown } | null;
  return row?.value && typeof row.value === 'object' ? (row.value as SiteMarks) : {};
}
export async function setSiteMark(siteId: string, patch: { infoAt?: string; drawingsAt?: string }): Promise<void> {
  const all = await getSiteMarks();
  must(await supabase().from('app_settings').upsert({ key: 'site_marks', value: { ...all, [siteId]: { ...all[siteId], ...patch } } }, { onConflict: 'key' }), '현장 변경 표시 저장');
}
export async function getSitePostsSince(since: string): Promise<SitePost[]> {
  return (await fetchAll<SitePostRow>((a, b) => supabase().from('site_posts').select('*').gte('created_at', since).order('id', { ascending: false }).range(a, b), '현장 일지 조회')).map(toSitePost);
}
export async function removeSitePostsOf(siteId: string): Promise<string[]> {
  const rows = await fetchAll<SitePostRow>((a, b) => supabase().from('site_posts').select('*').eq('site_id', siteId).order('id').range(a, b), '현장 일지 조회');
  if (rows.length === 0) return [];
  must(await supabase().from('site_posts').delete().eq('site_id', siteId), '현장 일지 삭제');
  return rows.flatMap(r => r.photos ?? []);
}

// ───────── 월급 지급 완료 (app_settings.payroll_paid) — { 'YYYY-MM': { 회원 id: { at, amount, by } } } ─────────
type PaidMap = Record<string, Record<string, { at: string; amount: number; by: string }>>;
async function loadPaid(): Promise<PaidMap> {
  const row = must(await supabase().from('app_settings').select('value').eq('key', 'payroll_paid').maybeSingle(), '월급 지급 조회') as { value: unknown } | null;
  return row?.value && typeof row.value === 'object' ? (row.value as PaidMap) : {};
}
export async function getPayrollPaid(ym: string): Promise<Record<string, { at: string; amount: number; by: string }>> {
  return (await loadPaid())[ym] ?? {};
}
/** 여러 회원을 한 번에: 값이 있으면 지급 완료로 표시, null 이면 취소(미지급으로 되돌림). */
export async function setPayrollPaidMany(ym: string, changes: [string, { at: string; amount: number; by: string } | null][]): Promise<void> {
  const all = await loadPaid();
  const month = { ...(all[ym] ?? {}) };
  for (const [id, rec] of changes) {
    if (rec === null) delete month[id];
    else month[id] = rec;
  }
  must(await supabase().from('app_settings').upsert({ key: 'payroll_paid', value: { ...all, [ym]: month } }, { onConflict: 'key' }), '월급 지급 저장');
}

// ───────── 급여 기본값 (app_settings.pay_defaults) — 새 회원의 기본 일당 ─────────
export async function getPayDefaults(): Promise<{ daily: number; monthly: number }> {
  const row = must(await supabase().from('app_settings').select('value').eq('key', 'pay_defaults').maybeSingle(), '급여 기본값 조회') as { value: { daily?: unknown; monthly?: unknown } | null } | null;
  const n = (x: unknown) => (typeof x === 'number' && x > 0 ? x : 0);
  return { daily: n(row?.value?.daily), monthly: n(row?.value?.monthly) };
}
export async function savePayDefaults(d: { daily: number; monthly: number }): Promise<void> {
  must(await supabase().from('app_settings').upsert({ key: 'pay_defaults', value: d }, { onConflict: 'key' }), '급여 기본값 저장');
}

// ───────── 현장 (sites) — 자재 요청에서 고르는 등록된 현장 ─────────
// photos(여러 장)가 비어 있고 예전 photo(한 장)만 있으면 그것을 첫 장으로 읽는다.
type SiteRow = { id: number; name: string; address: string | null; pm_id: string | null; start_date: string | null; end_date: string | null; memo: string; photo: string | null; photos: string[] | null; drawings: string[] | null; extensions: SiteExtension[] | null; created_at: string };
const sitePhotos = (r: { photo: string | null; photos: string[] | null }): string[] => (r.photos && r.photos.length ? r.photos : r.photo ? [r.photo] : []);
const toSite = (r: SiteRow): Site => ({ id: String(r.id), name: r.name, address: r.address ?? '', pmId: r.pm_id ?? '', startDate: r.start_date ?? '', endDate: r.end_date ?? '', memo: r.memo, photos: sitePhotos(r), drawings: r.drawings ?? [], extensions: r.extensions ?? [], createdAt: new Date(r.created_at).toISOString() });
const siteCols = (i: SiteInput) => ({ name: i.name, address: i.address, pm_id: i.pmId || null, start_date: i.startDate || null, end_date: i.endDate || null, memo: i.memo, ...(i.photos === undefined ? {} : { photos: i.photos, photo: '' }), ...(i.drawings === undefined ? {} : { drawings: i.drawings }) });
const SITE_DUP = '같은 이름의 현장이 이미 있어요.';

export async function getSites(): Promise<Site[]> {
  return (await fetchAll<SiteRow>((a, b) => supabase().from('sites').select('*').order('id').range(a, b), '현장 조회')).map(toSite);
}

export async function addSite(i: SiteInput): Promise<VehicleResult<{ site: Site }>> {
  const res = await supabase().from('sites').insert(siteCols({ ...i, photos: i.photos ?? [], drawings: i.drawings ?? [] })).select('*').single();
  if (res.error) {
    if (res.error.code === '23505') return { error: SITE_DUP };
    throw new Error('Supabase 현장 등록 실패: ' + res.error.message);
  }
  return { ok: true, site: toSite(res.data as SiteRow) };
}

export async function updateSite(id: string, i: SiteInput): Promise<VehicleResult<{ removed: string[] }>> {
  const cur = must(await supabase().from('sites').select('photo,photos,drawings,end_date,extensions').eq('id', numId(id)).maybeSingle(), '현장 조회') as { photo: string | null; photos: string[] | null; drawings: string[] | null; end_date: string | null; extensions: SiteExtension[] | null } | null;
  if (!cur) return { error: '없는 현장이에요.' };
  // 마감일을 바꾸면 이력에 남긴다 (바꾸기 전 마감일이 있을 때만 연장·단축으로 센다)
  const ext = cur.end_date && i.endDate && cur.end_date !== i.endDate ? { extensions: [...(cur.extensions ?? []), { from: cur.end_date, to: i.endDate, at: new Date().toISOString() }] } : {};
  const res = await supabase().from('sites').update({ ...siteCols(i), ...ext }).eq('id', numId(id)).select('id');
  if (res.error) {
    if (res.error.code === '23505') return { error: SITE_DUP };
    throw new Error('Supabase 현장 수정 실패: ' + res.error.message);
  }
  if (!(res.data ?? []).length) return { error: '없는 현장이에요.' };
  const prev = sitePhotos(cur);
  const prevDrawings = cur.drawings ?? [];
  return { ok: true, removed: [...(i.photos === undefined ? [] : prev.filter(p => !i.photos!.includes(p))), ...(i.drawings === undefined ? [] : prevDrawings.filter(p => !i.drawings!.includes(p)))] };
}

export async function removeSite(id: string): Promise<VehicleResult<{ photos: string[] }>> {
  const rows = must(await supabase().from('sites').delete().eq('id', numId(id)).select('photo,photos,drawings'), '현장 삭제') as { photo: string | null; photos: string[] | null; drawings: string[] | null }[];
  if (!rows.length) return { error: '없는 현장이에요.' };
  await supabase().from('placements').delete().eq('site_id', id); // 그 현장의 배치도 함께 지운다 (테이블이 아직 없으면 무시)
  await supabase().from('placement_notes').delete().eq('site_id', id); // 작업 내용 메모도
  return { ok: true, photos: [...sitePhotos(rows[0]), ...(rows[0].drawings ?? [])] }; // 사진·도면 파일을 모두 정리할 수 있게 돌려준다
}

// ───────── 현장 배치 (placements) — 날짜·시간대(오전/오후)별로 누가 어느 현장에 가는지 ─────────
// 한 사람은 같은 날 같은 시간대에 한 현장에만 배치된다 (date + slot + member_id 가 유일). 종일 = 오전·오후 두 행.
type PlacementRow = { date: string; slot: Slot; site_id: string; member_id: string };
const toPlacement = (r: PlacementRow): Placement => ({ date: r.date, slot: r.slot, siteId: r.site_id, memberId: r.member_id });

export async function getPlacements(from: string, to: string): Promise<Placement[]> {
  const rows = await fetchAll<PlacementRow>((a, b) => supabase().from('placements').select('date,slot,site_id,member_id').gte('date', from).lte('date', to).order('date').order('id').range(a, b), '현장 배치 조회');
  return rows.map(toPlacement);
}

/** 날짜 하루의 이 시간대(들)에 이 현장으로 사람들을 배치한다. 같은 시간대에 다른 현장에 있던 사람은 옮겨진다. */
export async function assignPlacements(date: string, siteId: string, memberIds: string[], slots: Slot[]): Promise<number> {
  if (!memberIds.length || !slots.length) return 0;
  const rows = memberIds.flatMap(m => slots.map(slot => ({ date, slot, site_id: siteId, member_id: m })));
  must(await supabase().from('placements').upsert(rows, { onConflict: 'date,slot,member_id' }), '현장 배치 저장');
  // 야간(오후 5~8시)과 심야(오후 8~10시)는 하루에 하나만: 새로 넣은 쪽이 이기고 반대쪽은 빠진다 (1.5일이 아니라 새로 체크한 것만 센다)
  const opposite: Slot[] = [...(slots.includes('nt') && !slots.includes('ot') ? ['ot' as const] : []), ...(slots.includes('ot') && !slots.includes('nt') ? ['nt' as const] : [])];
  if (opposite.length) must(await supabase().from('placements').delete().eq('date', date).in('member_id', memberIds).in('slot', opposite), '야간·심야 정리');
  return memberIds.length;
}

export async function removePlacement(date: string, memberId: string, slots: Slot[]): Promise<boolean> {
  const rows = must(await supabase().from('placements').delete().eq('date', date).eq('member_id', memberId).in('slot', slots).select('id'), '현장 배치 삭제') as { id: number }[];
  return rows.length > 0;
}

/** fromDate 의 배치(오전·오후 모두)를 toDate 로 복사한다 (같은 시간대가 이미 있는 사람은 건너뛴다). allow 에 없는 현장·회원도 건너뛴다. */
export async function copyPlacements(fromDate: string, toDate: string, allow: { sites: string[]; members: string[] }): Promise<number> {
  const src = must(await supabase().from('placements').select('date,slot,site_id,member_id').eq('date', fromDate), '현장 배치 조회') as PlacementRow[];
  const rows = src.filter(r => allow.sites.includes(r.site_id) && allow.members.includes(r.member_id)).map(r => ({ date: toDate, slot: r.slot, site_id: r.site_id, member_id: r.member_id }));
  if (!rows.length) return 0;
  const done = must(await supabase().from('placements').upsert(rows, { onConflict: 'date,slot,member_id', ignoreDuplicates: true }).select('member_id'), '현장 배치 복사') as { member_id: string }[];
  return new Set(done.map(d => d.member_id)).size;
}

// ───────── 현장 작업 내용 (placement_notes) — 현장·날짜별 메모 ─────────
export async function getPlacementNotes(from: string, to: string): Promise<PlacementNote[]> {
  const rows = await fetchAll<{ date: string; site_id: string; note: string }>((a, b) => supabase().from('placement_notes').select('date,site_id,note').gte('date', from).lte('date', to).order('date').order('id').range(a, b), '작업 내용 조회');
  return rows.map(r => ({ date: r.date, siteId: r.site_id, note: r.note }));
}

/** 그날 이 현장의 작업 내용을 저장한다. 비우면 지운다. */
export async function setPlacementNote(date: string, siteId: string, note: string): Promise<void> {
  if (!note) {
    must(await supabase().from('placement_notes').delete().eq('date', date).eq('site_id', siteId), '작업 내용 삭제');
    return;
  }
  must(await supabase().from('placement_notes').upsert({ date, site_id: siteId, note }, { onConflict: 'date,site_id' }), '작업 내용 저장');
}

// ───────── 출근 조회 기준 이력 (app_settings.attendance_cycle) — 매달 며칠부터 며칠까지, 적용 시작 월별로 ─────────
export async function getAttendanceCycles(): Promise<CycleEntry[]> {
  const row = must(await supabase().from('app_settings').select('value').eq('key', 'attendance_cycle').maybeSingle(), '출근 조회 기준 조회') as { value: unknown } | null;
  return toEntries(row?.value);
}
export async function saveAttendanceCycles(list: CycleEntry[]): Promise<void> {
  must(await supabase().from('app_settings').upsert({ key: 'attendance_cycle', value: list }, { onConflict: 'key' }), '출근 조회 기준 저장');
}

// ───────── 휴가 신청 (leave_requests) ─────────
type LeaveRow = { id: number; member_id: string; start_date: string; end_date: string; kind: string; reason: string; status: string; created_at: string; decided_at: string | null; decided_by: string | null; decision_note: string | null };
const toLeave = (r: LeaveRow): LeaveRequest => ({ id: String(r.id), memberId: r.member_id, startDate: r.start_date, endDate: r.end_date, kind: r.kind as LeaveRequest['kind'], reason: r.reason, status: r.status as LeaveRequest['status'], createdAt: new Date(r.created_at).toISOString(), decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : '', decidedBy: r.decided_by ?? '', decisionNote: r.decision_note ?? '' });

export async function getLeaves(): Promise<LeaveRequest[]> {
  return (await fetchAll<LeaveRow>((a, b) => supabase().from('leave_requests').select('*').order('id', { ascending: false }).range(a, b), '휴가 신청 조회')).map(toLeave);
}

export async function addLeave(i: LeaveInput): Promise<LeaveRequest> {
  const row = must(await supabase().from('leave_requests').insert({ member_id: i.memberId, start_date: i.startDate, end_date: i.endDate, kind: i.kind, reason: i.reason }).select('*').single(), '휴가 신청') as LeaveRow;
  return toLeave(row);
}

/** 본인이 낸 '승인 대기' 신청만 취소(삭제)할 수 있다 */
export async function cancelLeave(id: string, memberId: string): Promise<boolean> {
  const rows = must(await supabase().from('leave_requests').delete().eq('id', numId(id)).eq('member_id', memberId).eq('status', 'pending').select('id'), '휴가 신청 취소') as { id: number }[];
  return rows.length > 0;
}

/** 승인·반려. 대기 중인 신청만 처리하고, 처리된 신청을 돌려준다 (없거나 이미 처리됐으면 null) */
export async function decideLeave(id: string, status: 'approved' | 'rejected', by: string, note: string): Promise<LeaveRequest | null> {
  const rows = must(await supabase().from('leave_requests').update({ status, decided_at: new Date().toISOString(), decided_by: by, decision_note: note }).eq('id', numId(id)).eq('status', 'pending').select('*'), '휴가 승인') as LeaveRow[];
  return rows.length ? toLeave(rows[0]) : null;
}

/** 회원의 기간 안 배치를 지운다 (휴가 승인 때). 지운 건수를 돌려준다. */
export async function removePlacementsRange(memberId: string, from: string, to: string, slots: Slot[]): Promise<number> {
  const rows = must(await supabase().from('placements').delete().eq('member_id', memberId).gte('date', from).lte('date', to).in('slot', slots).select('id'), '휴가 기간 배치 삭제') as { id: number }[];
  return rows.length;
}

// ───────── 사무 연차 부여 (app_settings.annual_leave) — { 연도: { 회원 id: 총 일수 } } ─────────
export async function getAnnualLeave(): Promise<AnnualLeave> {
  const row = must(await supabase().from('app_settings').select('value').eq('key', 'annual_leave').maybeSingle(), '연차 부여 조회') as { value: unknown } | null;
  return row?.value && typeof row.value === 'object' ? (row.value as AnnualLeave) : {};
}
/** 그 해 이 회원의 연차 총 일수를 정한다. days 가 null 이면 지운다(미설정). */
export async function setAnnualLeave(year: number, memberId: string, days: number | null): Promise<void> {
  const all = await getAnnualLeave();
  const y = { ...(all[String(year)] ?? {}) };
  if (days === null) delete y[memberId];
  else y[memberId] = days;
  must(await supabase().from('app_settings').upsert({ key: 'annual_leave', value: { ...all, [String(year)]: y } }, { onConflict: 'key' }), '연차 부여 저장');
}

// ───────── 경비관리 (expenses) — 현장에서 쓴 경비 영수증 ─────────
type ExpenseRow = { purchase_id?: string | null; status?: string | null; link?: string | null; account?: string | null; id: number; spent_on: string; site: string; category: string; amount: number; memo: string | null; photos: string[] | null; doc_type: string | null; vendor: string | null; pay_method: string | null; booked: boolean | null; booked_by: string | null; booked_at: string | null; member_id: string; member_name: string; created_at: string };
const toExpense = (r: ExpenseRow): Expense => ({ id: String(r.id), date: r.spent_on, site: r.site, category: (['meal', 'drink', 'materials', 'fuel', 'parking', 'supplies'].includes(r.category) ? r.category : 'other') as Expense['category'], amount: r.amount, memo: r.memo ?? '', docType: (r.doc_type === 'invoice' || r.doc_type === 'request' ? r.doc_type : 'receipt') as Expense['docType'], vendor: r.vendor ?? '', payMethod: (['cash', 'transfer'].includes(r.pay_method ?? '') ? r.pay_method : 'card') as Expense['payMethod'], photos: r.photos ?? [], memberId: r.member_id, memberName: r.member_name, createdAt: new Date(r.created_at).toISOString(), booked: !!r.booked, bookedBy: r.booked_by ?? '', bookedAt: r.booked_at ? new Date(r.booked_at).toISOString() : '', purchaseId: r.purchase_id ?? '', status: r.status === 'requested' ? 'requested' : 'done', link: r.link ?? '', account: r.account ?? '' });
const expenseCols = (i: ExpenseInput) => ({ spent_on: i.date, site: i.site, category: i.category, amount: i.amount, memo: i.memo, doc_type: i.docType, vendor: i.vendor, pay_method: i.payMethod, photos: i.photos, booked: i.booked, booked_by: i.bookedBy, booked_at: i.bookedAt || null, purchase_id: i.purchaseId, status: i.status, link: i.link, account: i.account });

export async function getExpenses(): Promise<Expense[]> {
  return (await fetchAll<ExpenseRow>((a, b) => supabase().from('expenses').select('*').order('spent_on', { ascending: false }).order('id', { ascending: false }).range(a, b), '경비 조회')).map(toExpense);
}
export async function addExpense(i: ExpenseInput, by: { id: string; name: string }): Promise<Expense> {
  return toExpense(must(await supabase().from('expenses').insert({ ...expenseCols(i), member_id: by.id, member_name: by.name }).select('*').single(), '경비 등록') as ExpenseRow);
}
export async function updateExpense(id: string, i: ExpenseInput): Promise<boolean> {
  const rows = must(await supabase().from('expenses').update(expenseCols(i)).eq('id', numId(id)).select('id'), '경비 수정') as { id: number }[];
  return rows.length > 0;
}
export async function removeExpense(id: string): Promise<boolean> {
  const rows = must(await supabase().from('expenses').delete().eq('id', numId(id)).select('id'), '경비 삭제') as { id: number }[];
  return rows.length > 0;
}

// ───────── 적재 패키지 (load_packages) — 자주 싣는 연장·상비품 묶음 ─────────
type PackageRow = { id: number; name: string; items: LoadPackageItem[] | null; created_at: string };
const toPackage = (r: PackageRow): LoadPackage => ({ id: String(r.id), name: r.name, items: Array.isArray(r.items) ? r.items : [], createdAt: new Date(r.created_at).toISOString() });
export async function getLoadPackages(): Promise<LoadPackage[]> {
  return (await fetchAll<PackageRow>((a, b) => supabase().from('load_packages').select('*').order('id').range(a, b), '적재 패키지 조회')).map(toPackage);
}
export async function saveLoadPackage(i: LoadPackageInput, id: string | null): Promise<VehicleResult> {
  const res = id
    ? await supabase().from('load_packages').update({ name: i.name, items: i.items }).eq('id', numId(id)).select('id')
    : await supabase().from('load_packages').insert({ name: i.name, items: i.items }).select('id');
  if (res.error) {
    if (res.error.code === '23505') return { error: '같은 이름의 패키지가 이미 있어요.' };
    throw new Error('Supabase 적재 패키지 저장 실패: ' + res.error.message);
  }
  return (res.data ?? []).length ? { ok: true } : { error: '없는 패키지예요.' };
}
export async function removeLoadPackage(id: string): Promise<VehicleResult> {
  const rows = must(await supabase().from('load_packages').delete().eq('id', numId(id)).select('id'), '적재 패키지 삭제') as { id: number }[];
  return rows.length ? { ok: true } : { error: '없는 패키지예요.' };
}


// ───────── 장비조사 (inventory_entries) + 팀별 고정 카테고리 (app_settings: team_categories) ─────────
type InventoryRow = { id: number; action: string | null; price: number | null; shipping: number | null; vendor: string | null; unit: string | null; category: string; product_key: string; name: string; brand: string | null; qty: number; memo: string | null; by_id: string | null; by_name: string; created_at: string };
const toInventory = (r: InventoryRow): InventoryEntry => ({ id: String(r.id), action: r.action === 'delete' ? 'delete' : r.action === 'buy' ? 'buy' : 'add', price: r.price ?? 0, shipping: r.shipping ?? 0, vendor: r.vendor ?? '', unit: r.unit ?? '', category: r.category, productKey: r.product_key, name: r.name, brand: r.brand ?? '', qty: r.qty, memo: r.memo ?? '', byId: r.by_id ?? '', byName: r.by_name, createdAt: new Date(r.created_at).toISOString() });
export async function getInventory(): Promise<InventoryEntry[]> {
  return (await fetchAll<InventoryRow>((a, b) => supabase().from('inventory_entries').select('*').order('id', { ascending: false }).range(a, b), '장비조사 조회')).map(toInventory);
}
export async function addInventory(i: InventoryEntryInput): Promise<InventoryEntry> {
  const row: Record<string, unknown> = { action: i.action, price: i.price, shipping: i.shipping ?? 0, vendor: i.vendor ?? '', unit: i.unit ?? '', category: i.category, product_key: i.productKey, name: i.name, brand: i.brand, qty: i.qty, memo: i.memo, by_id: i.byId || null, by_name: i.byName };
  // 새 컬럼(shipping·vendor·unit)을 만드는 SQL 을 아직 실행하지 않았어도 기록이 막히지 않도록, 없는 컬럼은 빼고 다시 저장한다
  for (let tries = 0; tries < 4; tries++) {
    const r = await supabase().from('inventory_entries').insert(row).select('*').single();
    if (!r.error) return toInventory(r.data as InventoryRow);
    const col = /column ["']?(?:inventory_entries\.)?([a-z_]+)["']? .*does not exist|Could not find the '([a-z_]+)' column/i.exec(r.error.message);
    const name = col?.[1] ?? col?.[2];
    if (!name || !(name in row)) throw new Error(`Supabase 장비조사 등록 실패: ${r.error.message}`);
    delete row[name];
  }
  throw new Error('Supabase 장비조사 등록 실패: 컬럼을 맞추지 못했어요');
}
export async function removeInventory(id: string): Promise<boolean> {
  const rows = must(await supabase().from('inventory_entries').delete().eq('id', numId(id)).select('id'), '장비조사 삭제') as { id: number }[];
  return rows.length > 0;
}
// ───────── 가격조사 — 품목별 구매 링크 (app_settings: purchase_links) ─────────
const toInfo = (u: unknown): PurchaseInfo | null => { if (typeof u === 'string') return u ? { url: u, vendor: '', unit: '' } : null; if (!u || typeof u !== 'object') return null; const o = u as Partial<PurchaseInfo>; return { url: typeof o.url === 'string' ? o.url : '', vendor: typeof o.vendor === 'string' ? o.vendor : '', unit: typeof o.unit === 'string' ? o.unit : '' }; };
export async function getPurchaseLinks(): Promise<Record<string, PurchaseInfo>> {
  const row = must(await supabase().from('app_settings').select('value').eq('key', 'purchase_links').maybeSingle(), '구매 링크 조회') as { value: unknown } | null;
  const v = row?.value;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).flatMap(([k, u]) => { const i = toInfo(u); return i && (i.url || i.vendor || i.unit) ? [[k, i] as [string, PurchaseInfo]] : []; }));
}
export async function setPurchaseLink(key: string, info: PurchaseInfo | null): Promise<void> {
  const cur = await getPurchaseLinks();
  if (info && (info.url || info.vendor || info.unit)) cur[key] = info; else delete cur[key];
  must(await supabase().from('app_settings').upsert({ key: 'purchase_links', value: cur }, { onConflict: 'key' }), '구매 링크 저장');
}

// ───────── 변경이력 (audit_log) ─────────
type AuditRow = { id: number; at: string; menu: string; action: string; target: string | null; detail: string | null; by_id: string | null; by_name: string };
const toAudit = (r: AuditRow): AuditEntry => ({ id: String(r.id), at: new Date(r.at).toISOString(), menu: r.menu, action: r.action, target: r.target ?? '', detail: r.detail ?? '', byId: r.by_id ?? '', byName: r.by_name });
/** 최근 기록부터 (최대 5000건) */
export async function getAudit(): Promise<AuditEntry[]> {
  const { data, error } = await supabase().from('audit_log').select('*').order('id', { ascending: false }).limit(5000);
  if (error) throw new Error(`Supabase 변경이력 조회 실패: ${error.message}`);
  return (data as AuditRow[]).map(toAudit);
}
export async function addAudit(i: AuditInput): Promise<void> {
  must(await supabase().from('audit_log').insert({ menu: i.menu, action: i.action, target: i.target, detail: i.detail, by_id: i.byId || null, by_name: i.byName }), '변경이력 기록');
}

// ───────── 가격조사 — 저장해 둔 금액·수량 (app_settings: pricing_snapshots) ─────────
export async function getPricingSnapshots(): Promise<PricingSnapshot[]> {
  const row = must(await supabase().from('app_settings').select('value').eq('key', 'pricing_snapshots').maybeSingle(), '저장한 금액·수량 조회') as { value: unknown } | null;
  return Array.isArray(row?.value) ? (row!.value as PricingSnapshot[]) : [];
}
export async function savePricingSnapshots(list: PricingSnapshot[]): Promise<void> {
  must(await supabase().from('app_settings').upsert({ key: 'pricing_snapshots', value: list }, { onConflict: 'key' }), '저장한 금액·수량 저장');
}

// ───────── 장비조사 — 제외할 공정·카테고리 (app_settings: inventory_excluded) ─────────
export async function getInventoryExcluded(): Promise<InventoryExcluded> {
  const row = must(await supabase().from('app_settings').select('value').eq('key', 'inventory_excluded').maybeSingle(), '장비조사 제외 설정 조회') as { value: { trades?: unknown; categories?: unknown } | null } | null;
  const strs = (x: unknown) => (Array.isArray(x) ? x.filter((k): k is string => typeof k === 'string') : []);
  return { trades: strs(row?.value?.trades), categories: strs(row?.value?.categories) };
}
export async function saveInventoryExcluded(v: InventoryExcluded): Promise<void> {
  must(await supabase().from('app_settings').upsert({ key: 'inventory_excluded', value: v }, { onConflict: 'key' }), '장비조사 제외 설정 저장');
}
export async function removeAudit(ids: string[]): Promise<number> {
  const nums = ids.map(i => Number(i)).filter(n => Number.isInteger(n));
  if (nums.length === 0) return 0;
  const rows = must(await supabase().from('audit_log').delete().in('id', nums).select('id'), '변경이력 삭제') as { id: number }[];
  return rows.length;
}

// ───────── 가격조사 — 자주 가는 구매처 (app_settings: favorite_vendors) ─────────
export async function getFavoriteVendors(): Promise<string[]> {
  const row = must(await supabase().from('app_settings').select('value').eq('key', 'favorite_vendors').maybeSingle(), '자주 가는 구매처 조회') as { value: unknown } | null;
  return Array.isArray(row?.value) ? (row!.value as unknown[]).filter((x): x is string => typeof x === 'string' && !!x) : [];
}
export async function saveFavoriteVendors(list: string[]): Promise<void> {
  must(await supabase().from('app_settings').upsert({ key: 'favorite_vendors', value: list }, { onConflict: 'key' }), '자주 가는 구매처 저장');
}

// ───────── 차량정보 — 차량 순서·카테고리 (app_settings: vehicle_layout) ─────────
const vStrs = (x: unknown) => (Array.isArray(x) ? x.filter((k): k is string => typeof k === 'string') : []);
const toVehicleLayout = (v: { order?: unknown; cats?: unknown; catOf?: unknown } | null | undefined): VehicleLayout => ({
  order: vStrs(v?.order),
  cats: vStrs(v?.cats),
  catOf: v?.catOf && typeof v.catOf === 'object' && !Array.isArray(v.catOf) ? (Object.fromEntries(Object.entries(v.catOf as Record<string, unknown>).filter(([, c]) => typeof c === 'string')) as Record<string, string>) : {},
});
export async function getVehicleLayout(): Promise<VehicleLayout> {
  const row = must(await supabase().from('app_settings').select('value').eq('key', 'vehicle_layout').maybeSingle(), '차량 배치 조회') as { value: { order?: unknown; cats?: unknown; catOf?: unknown } | null } | null;
  return toVehicleLayout(row?.value);
}
export async function saveVehicleLayout(v: VehicleLayout): Promise<void> {
  must(await supabase().from('app_settings').upsert({ key: 'vehicle_layout', value: v }, { onConflict: 'key' }), '차량 배치 저장');
}

// ───────── 가격조사 — 품목별 판매 옵션 (app_settings: purchase_options) ─────────
const toOptions = (v: unknown): Record<string, PurchaseOption[]> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, PurchaseOption[]> = {};
  for (const [k, arr] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(arr)) continue;
    const list = arr.flatMap((o): PurchaseOption[] => {
      if (!o || typeof o !== 'object') return [];
      const x = o as Partial<PurchaseOption>;
      if (typeof x.id !== 'string' || !x.id) return [];
      return [{ id: x.id, unit: typeof x.unit === 'string' ? x.unit : '', vendor: typeof x.vendor === 'string' ? x.vendor : '', url: typeof x.url === 'string' ? x.url : '', price: typeof x.price === 'number' && x.price >= 0 ? x.price : 0, incl: typeof x.incl === 'number' ? x.incl : null }];
    });
    if (list.length) out[k] = list;
  }
  return out;
};
export async function getPurchaseOptions(): Promise<Record<string, PurchaseOption[]>> {
  const row = must(await supabase().from('app_settings').select('value').eq('key', 'purchase_options').maybeSingle(), '판매 옵션 조회') as { value: unknown } | null;
  return toOptions(row?.value);
}
export async function savePurchaseOptions(v: Record<string, PurchaseOption[]>): Promise<void> {
  must(await supabase().from('app_settings').upsert({ key: 'purchase_options', value: v }, { onConflict: 'key' }), '판매 옵션 저장');
}

// ───────── 가격조사 — 구매처별 배송 정책 (app_settings: vendor_shipping) ─────────
const toVendorShipping = (v: unknown): Record<string, VendorShipping> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, VendorShipping> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Partial<VendorShipping>;
    const fee = typeof o.fee === 'number' && o.fee >= 0 ? Math.round(o.fee) : 0;
    const freeOver = typeof o.freeOver === 'number' && o.freeOver >= 0 ? Math.round(o.freeOver) : 0;
    if (fee > 0 || freeOver > 0) out[k] = { fee, freeOver };
  }
  return out;
};
export async function getVendorShipping(): Promise<Record<string, VendorShipping>> {
  const row = must(await supabase().from('app_settings').select('value').eq('key', 'vendor_shipping').maybeSingle(), '구매처 배송비 조회') as { value: unknown } | null;
  return toVendorShipping(row?.value);
}
export async function saveVendorShipping(v: Record<string, VendorShipping>): Promise<void> {
  must(await supabase().from('app_settings').upsert({ key: 'vendor_shipping', value: v }, { onConflict: 'key' }), '구매처 배송비 저장');
}
