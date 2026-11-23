import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { asIcon, asKind, EMPTY_SPEC, MAX_VEHICLE_PHOTOS } from './types';
import { toEntries, type CycleEntry } from './attendance-cycle';
import type { AnnualLeave } from './leave';
import type { Kind, MaterialRequest, Member, MemberPatch, Product, SurveyPayload, TrashedProduct, Vehicle, VehicleSpec, VehiclePhoto, LoadPackage, LoadPackageInput, VehicleItem, VehicleResult, Site, SiteInput, SiteExtension, Placement, PlacementNote, Slot, LeaveRequest, LeaveInput, Expense, ExpenseInput } from './types';
import { removeImage } from './images';
import { DEFAULT_TEAMS, withAccountingTeam, withFieldWorkerTeams, type Team } from './roles';

// 파일 기반 저장소 (data/*.json). 쓰기는 한 번에 하나씩, 임시파일 → rename 으로 안전하게 저장한다.
const DIR = path.join(process.cwd(), 'data');
const RESP_DIR = path.join(DIR, 'responses');

let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}
async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(DIR, file), 'utf8')) as T;
}
async function writeJson(file: string, data: unknown) {
  const target = path.join(DIR, file);
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
  await fs.rename(tmp, target);
}

export const getProducts = async () => (await readJson<Product[]>('products.json')).map(p => ({ ...p, stock: p.stock ?? 0, kind: asKind(p.kind) }));
export const getTrash = async () => (await readJson<TrashedProduct[]>('trash.json')).map(p => ({ ...p, kind: asKind(p.kind) }));
export async function getTrades(): Promise<string[]> {
  return (await readJson<{ trades: string[] }>('meta.json')).trades;
}

/** 삭제 = 휴지통으로 이동 (영구 삭제 아님). 복원 가능. */
export function deleteProducts(keys: string[]): Promise<number> {
  return withLock(async () => {
    const set = new Set(keys);
    const [products, trash] = await Promise.all([getProducts(), getTrash()]);
    const gone = products.filter(p => set.has(p.key));
    if (!gone.length) return 0;
    const now = new Date().toISOString();
    await writeJson('trash.json', [...trash, ...gone.map(p => ({ ...p, deletedAt: now }))]);
    await writeJson('products.json', products.filter(p => !set.has(p.key)));
    return gone.length;
  });
}

export function restoreProducts(keys: string[]): Promise<number> {
  return withLock(async () => {
    const set = new Set(keys);
    const [products, trash] = await Promise.all([getProducts(), getTrash()]);
    const back = trash.filter(p => set.has(p.key));
    if (!back.length) return 0;
    const restored: Product[] = back.map(p => {
      const { deletedAt: _deletedAt, ...rest } = p;
      void _deletedAt;
      return rest;
    });
    await writeJson('products.json', [...products, ...restored].sort((a, b) => a.seq - b.seq));
    await writeJson('trash.json', trash.filter(p => !set.has(p.key)));
    return back.length;
  });
}

/**
 * 영구 삭제: 휴지통에 있는 자재만 대상. 자재 데이터와 이미지 파일을 완전히 지운다. 되돌릴 수 없다.
 * (이미 지나간 설문 응답 파일에는 자재 코드 문자열이 남지만, 코드만으로는 어떤 자재인지 알 수 없다.)
 */
export function purgeProducts(keys: string[]): Promise<number> {
  return withLock(async () => {
    const set = new Set(keys);
    const [products, trash] = await Promise.all([getProducts(), getTrash()]);
    const gone = trash.filter(p => set.has(p.key));
    if (!gone.length) return 0;
    const rest = trash.filter(p => !set.has(p.key));
    await writeJson('trash.json', rest); // 데이터부터 지우고
    const stillUsed = new Set([...products, ...rest].map(p => p.image)); // 다른 자재가 같은 이미지를 쓰면 남긴다
    for (const p of gone) {
      if (p.image && !stillUsed.has(p.image)) await removeImage(p.image).catch(() => undefined);
    }
    return gone.length;
  });
}

/** 설문 응답을 data/responses/ 에 한 건당 파일 하나로 저장 (현장설문/aggregate.js 가 그대로 읽는 형식). */
export async function saveResponse(payload: SurveyPayload): Promise<string> {
  await fs.mkdir(RESP_DIR, { recursive: true });
  const id = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const file = path.join(RESP_DIR, `${id}.json`);
  await fs.writeFile(file, JSON.stringify(payload), { encoding: 'utf8', flag: 'wx' });
  return id;
}

export async function countResponses(): Promise<number> {
  try {
    return (await fs.readdir(RESP_DIR)).filter(f => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

// ───────── 회원 (members.json) ─────────
async function readOr<T>(file: string, fallback: T): Promise<T> {
  try {
    return await readJson<T>(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw e;
  }
}

type LegacyWorker = { id: string; name: string; trades: string[]; createdAt: string; loginId?: string; passHash?: string };

/** members.json 을 읽는다. 처음이면 예전 workers.json(현장작업자 목록)을 '현장작업자' 회원으로 옮겨 만든다. */
async function loadMembers(): Promise<Member[]> {
  try {
    // 예전에 만들어진 회원에는 menus(부여받은 메뉴)가 없으니 빈 값으로 채운다
    return (await readJson<Member[]>('members.json')).map(m => ({ ...m, menus: m.menus ?? [], actions: m.actions ?? {}, categories: m.categories ?? [], handles: m.handles ?? '', phone: m.phone ?? '', address: m.address ?? '', extraRole: m.extraRole ?? '', payType: m.payType ?? '' }));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    const old = await readOr<LegacyWorker[]>('workers.json', []);
    const migrated: Member[] = old.map(w => ({
      id: w.id, name: w.name, role: 'worker', extraRole: '', payType: '', trades: w.trades, categories: [], handles: '', phone: '', address: '', menus: [], actions: {}, createdAt: w.createdAt,
      loginId: w.loginId, passHash: w.passHash, mustChangePassword: false, idChanged: false,
    }));
    await writeJson('members.json', migrated);
    return migrated;
  }
}

const squash = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const sameName = (a: string, b: string) => squash(a) === squash(b);
type Conflict = { conflict: 'name' | 'loginId' };

export const getMembers = () => loadMembers();
export async function getMember(id: string): Promise<Member | null> {
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(id)) return null;
  return (await loadMembers()).find(m => m.id === id) ?? null;
}
export async function getMemberByLoginId(loginId: string): Promise<Member | null> {
  const k = loginId.trim().toLowerCase();
  return (await loadMembers()).find(m => m.loginId === k) ?? null;
}

// 이름·아이디 중복 검사는 저장 직전에 잠금 안에서 한다 (동시에 만들어도 겹치지 않는다).
export function insertMember(m: Member): Promise<{ member: Member } | Conflict> {
  return withLock(async () => {
    const list = await loadMembers();
    if (list.some(x => sameName(x.name, m.name))) return { conflict: 'name' as const };
    if (m.loginId && list.some(x => x.loginId === m.loginId)) return { conflict: 'loginId' as const };
    await writeJson('members.json', [...list, m]);
    return { member: m };
  });
}

export function patchMember(id: string, patch: MemberPatch): Promise<{ member: Member } | Conflict | { notFound: true }> {
  return withLock(async () => {
    const list = await loadMembers();
    const i = list.findIndex(m => m.id === id);
    if (i < 0) return { notFound: true as const };
    if (patch.name !== undefined && list.some(x => x.id !== id && sameName(x.name, patch.name as string))) return { conflict: 'name' as const };
    if (patch.loginId && list.some(x => x.id !== id && x.loginId === patch.loginId)) return { conflict: 'loginId' as const };
    const member: Member = { ...list[i], ...patch };
    list[i] = member;
    await writeJson('members.json', list);
    return { member };
  });
}

// ───────── 팀 (teams.json) ─────────
// 처음이면 기본 팀(DEFAULT_TEAMS)으로 채운다. 이후에는 최고 관리자·개발팀이 추가·삭제한다.
async function loadTeams(): Promise<Team[]> {
  try {
    const list = await readJson<Team[]>('teams.json');
    const fixed = withAccountingTeam(withFieldWorkerTeams(list) ?? list) ?? withFieldWorkerTeams(list); // 현장작업자(정/부) 분리, 경리팀 추가 반영
    if (fixed) await writeJson('teams.json', fixed);
    return fixed ?? list;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    await writeJson('teams.json', DEFAULT_TEAMS);
    return DEFAULT_TEAMS;
  }
}
export const getTeams = () => loadTeams();

export function insertTeam(t: Team): Promise<{ team: Team } | { conflict: 'label' }> {
  return withLock(async () => {
    const list = await loadTeams();
    if (list.some(x => squash(x.label) === squash(t.label))) return { conflict: 'label' as const };
    await writeJson('teams.json', [...list, t]);
    return { team: t };
  });
}

/** 팀 삭제: 소속 회원이 있으면 지우지 않고 인원수를 알려준다. */
export function removeTeam(key: string): Promise<{ ok: true } | { inUse: number } | { notFound: true }> {
  return withLock(async () => {
    const list = await loadTeams();
    if (!list.some(x => x.key === key)) return { notFound: true as const };
    const used = (await loadMembers()).filter(m => m.role === key || m.extraRole === key).length;
    if (used > 0) return { inUse: used };
    await writeJson('teams.json', list.filter(x => x.key !== key));
    return { ok: true as const };
  });
}

export function removeMember(id: string): Promise<boolean> {
  return withLock(async () => {
    const list = await loadMembers();
    if (!list.some(m => m.id === id)) return false;
    await writeJson('members.json', list.filter(m => m.id !== id));
    return true;
  });
}

/** 작업자별 공정별 마지막 제출 시각: { [workerId]: { [trade]: ISO } } */
export async function getSubmissions(): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = {};
  let files: string[] = [];
  try {
    files = (await fs.readdir(RESP_DIR)).filter(f => f.endsWith('.json'));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const r = JSON.parse(await fs.readFile(path.join(RESP_DIR, f), 'utf8')) as Partial<SurveyPayload>;
      if (typeof r.workerId !== 'string' || typeof r.trade !== 'string') continue;
      const at = typeof r.at === 'string' ? r.at : '';
      const m = (out[r.workerId] ||= {});
      if (!m[r.trade] || at > m[r.trade]) m[r.trade] = at;
    } catch {}
  }
  return out;
}

// ───────── 카테고리 ─────────
// data/categories.json = 카테고리 이름 목록(순서). 비어 있는 카테고리도 남길 수 있다. 목록에 없는 자재 카테고리는 자동으로 합쳐 보여 준다.
export type CatResult = { ok: true; count?: number } | { conflict: true } | { notFound: true } | { inUse: number };
const squashCat = (s: string) => s.split(' ').join('').toLowerCase();

async function loadCategories(): Promise<string[]> {
  let stored: string[] = [];
  try {
    stored = await readJson<string[]>('categories.json');
  } catch {
    stored = [];
  }
  const p = await getProducts(); // 사용 중인 소모품의 카테고리만 합친다 (휴지통에만 남은 카테고리는 지워진 카테고리)
  const extra = [...new Set(p.map(x => x.category))].filter(c => !stored.includes(c));
  return [...stored, ...extra];
}
export const getCategories = () => loadCategories();

// data/category-trades.json = { 카테고리 이름: 공정 이름 }. 공정이 비어 있으면 '미지정'. 카테고리 관리 화면이 공정별로 묶어 보여 주는 데 쓴다.
type TradeMap = Record<string, string>;
async function readTradeMap(): Promise<TradeMap> {
  try {
    return await readJson<TradeMap>('category-trades.json');
  } catch {
    return {};
  }
}
/** 지정이 없는 카테고리의 기본 공정 = 그 카테고리 소모품이 가장 많이 걸린 공정 (모든 공정 공통 소모품은 제외) */
function deriveTrade(products: Product[], trades: string[], name: string): string {
  const cnt = new Map<string, number>();
  for (const p of products) if (p.category === name && p.trades.length < trades.length) for (const t of p.trades) cnt.set(t, (cnt.get(t) ?? 0) + 1);
  let best = '';
  let n = 0;
  for (const [t, c] of cnt) if (c > n) { best = t; n = c; }
  return best;
}

export function getCategoryTrades(): Promise<Record<string, string>> {
  return withLock(async () => {
    const [list, map, products, trades] = await Promise.all([loadCategories(), readTradeMap(), getProducts(), getTrades()]);
    let changed = false;
    for (const name of list) if (!(name in map)) { map[name] = deriveTrade(products, trades, name); changed = true; }
    if (changed) await writeJson('category-trades.json', map);
    return Object.fromEntries(list.map(c => [c, map[c] ?? '']));
  });
}

/** 카테고리의 공정 지정 (빈 문자열 = 미지정) */
export function setCategoryTrade(name: string, trade: string): Promise<CatResult> {
  return withLock(async () => {
    const [list, map, trades] = await Promise.all([loadCategories(), readTradeMap(), getTrades()]);
    if (!list.includes(name)) return { notFound: true } as const;
    if (trade && !trades.includes(trade)) return { notFound: true } as const;
    map[name] = trade;
    await writeJson('category-trades.json', map);
    return { ok: true } as const;
  });
}

export function addCategory(name: string, trade = ''): Promise<CatResult> {
  return withLock(async () => {
    const list = await loadCategories();
    if (list.some(c => squashCat(c) === squashCat(name))) return { conflict: true } as const;
    await writeJson('categories.json', [...list, name]);
    const map = await readTradeMap();
    map[name] = trade;
    await writeJson('category-trades.json', map);
    return { ok: true } as const;
  });
}

/** 이름 바꾸기: 그 카테고리의 자재(휴지통 포함)도 같이 바뀐다 */
export function renameCategory(from: string, to: string): Promise<CatResult> {
  return withLock(async () => {
    const list = await loadCategories();
    if (!list.includes(from)) return { notFound: true } as const;
    if (list.some(c => c !== from && squashCat(c) === squashCat(to))) return { conflict: true } as const;
    const [products, trash] = await Promise.all([getProducts(), getTrash()]);
    let n = 0;
    const re = <T extends { category: string }>(rows: T[]) => rows.map(r => (r.category === from ? (n++, { ...r, category: to }) : r));
    await writeJson('products.json', re(products));
    await writeJson('trash.json', re(trash));
    await writeJson('categories.json', list.map(c => (c === from ? to : c)));
    const map = await readTradeMap();
    if (from in map) { map[to] = map[from]; delete map[from]; await writeJson('category-trades.json', map); }
    return { ok: true, count: n } as const;
  });
}

/** 삭제: 그 카테고리의 소모품을 모두 휴지통으로 옮기고(복원 가능) 카테고리를 지운다 */
export function removeCategory(name: string): Promise<CatResult> {
  return withLock(async () => {
    const list = await loadCategories();
    if (!list.includes(name)) return { notFound: true } as const;
    const [products, trash] = await Promise.all([getProducts(), getTrash()]);
    const gone = products.filter(p => p.category === name);
    if (gone.length) {
      const now = new Date().toISOString();
      await writeJson('trash.json', [...trash, ...gone.map(p => ({ ...p, deletedAt: now }))]);
      await writeJson('products.json', products.filter(p => p.category !== name));
    }
    await writeJson('categories.json', list.filter(c => c !== name));
    const map = await readTradeMap();
    if (name in map) { delete map[name]; await writeJson('category-trades.json', map); }
    return { ok: true, count: gone.length } as const;
  });
}

// ───────── 공정 추가 / 삭제 (data/meta.json 의 trades) ─────────
export type TradeResult = { ok: true; count?: number } | { conflict: true } | { notFound: true };

export function addTrade(name: string): Promise<TradeResult> {
  return withLock(async () => {
    const trades = await getTrades();
    if (trades.some(t => squashCat(t) === squashCat(name))) return { conflict: true } as const;
    const meta = await readJson<{ trades: string[] }>('meta.json');
    await writeJson('meta.json', { ...meta, trades: [...trades, name] });
    return { ok: true } as const;
  });
}

/** 여러 소모품의 세부분류를 한 번에 저장한다 (공정>카테고리 앞머리 갱신용) */
export function setSubs(entries: { key: string; sub: string }[]): Promise<void> {
  return withLock(async () => {
    const map = new Map(entries.map(e => [e.key, e.sub]));
    const products = await getProducts();
    await writeJson('products.json', products.map(p => (map.has(p.key) ? { ...p, sub: map.get(p.key)! } : p)));
  });
}

/** 공정 순서를 바꾼다. order 는 현재 공정 목록과 이름이 똑같아야 한다(순서만 다름). */
export function reorderTrades(order: string[]): Promise<boolean> {
  return withLock(async () => {
    const trades = await getTrades();
    if (order.length !== trades.length || new Set(order).size !== order.length || !order.every(t => trades.includes(t))) return false;
    const meta = await readJson<{ trades: string[] }>('meta.json');
    await writeJson('meta.json', { ...meta, trades: order });
    return true;
  });
}

/** 공정을 지운다. 소모품(휴지통 포함)·회원에 걸린 이 공정과 카테고리의 공정 지정도 함께 뺀다. */
export function removeTrade(name: string): Promise<TradeResult> {
  return withLock(async () => {
    const trades = await getTrades();
    if (!trades.includes(name)) return { notFound: true } as const;
    const meta = await readJson<{ trades: string[] }>('meta.json');
    const [products, trash, members, map] = await Promise.all([getProducts(), getTrash(), loadMembers(), readTradeMap()]);
    let n = 0;
    const strip = <T extends { trades: string[] }>(rows: T[]) => rows.map(r => (r.trades.includes(name) ? (n++, { ...r, trades: r.trades.filter(t => t !== name) }) : r));
    await writeJson('products.json', strip(products));
    await writeJson('trash.json', strip(trash));
    await writeJson('members.json', members.map(m => (m.trades.includes(name) ? { ...m, trades: m.trades.filter(t => t !== name) } : m)));
    for (const c of Object.keys(map)) if (map[c] === name) map[c] = '';
    await writeJson('category-trades.json', map);
    await writeJson('meta.json', { ...meta, trades: trades.filter(t => t !== name) });
    return { ok: true, count: n } as const;
  });
}

// ───────── 현장 자재 요청 (data/requests.json) ─────────
export function saveRequest(r: Omit<MaterialRequest, 'id' | 'at' | 'done' | 'doneAt' | 'doneBy'>): Promise<MaterialRequest> {
  return withLock(async () => {
    let list: MaterialRequest[] = [];
    try {
      list = await readJson<MaterialRequest[]>('requests.json');
    } catch {
      list = [];
    }
    const row: MaterialRequest = { ...r, id: crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(), done: false, doneAt: null, doneBy: null };
    await writeJson('requests.json', [row, ...list]);
    return row;
  });
}

/**
 * 요청을 '준비 완료'로 처리한다. 재고가 모자라 아직 못 채운 품목이 남아 있으면 처리하지 않는다.
 * 'ok' 처리됨 · 'short' 부족한 품목이 남음 · 'none' 없거나 이미 완료된 요청
 */
export function completeRequest(id: string, by: string): Promise<'ok' | 'short' | 'none'> {
  return withLock(async () => {
    const list = await getRequests();
    const r = list.find(x => x.id === id);
    if (!r || r.done) return 'none';
    if (r.items.some(it => (it.s ?? 0) > 0)) return 'short';
    await writeJson('requests.json', list.map(x => (x.id === id ? { ...x, done: true, doneAt: new Date().toISOString(), doneBy: by } : x)));
    return 'ok';
  });
}

/**
 * 재고가 모자랐던 품목을 채운다: 입고 수량(received)만큼 재고에 넣고, 이 요청의 부족분(s)을 바로 가져간다.
 * 입고 수량은 부족분 이상이어야 하고, 남는 수량은 재고에 그대로 남는다.
 */
export function fillRequestItem(id: string, k: string, received: number): Promise<{ request: MaterialRequest } | { error: string }> {
  return withLock(async () => {
    const list = await getRequests();
    const r = list.find(x => x.id === id);
    if (!r) return { error: '없는 요청이에요.' };
    if (r.done) return { error: '이미 준비 완료된 요청이에요.' };
    const it = r.items.find(x => x.k === k);
    const need = it?.s ?? 0;
    if (!it || need <= 0) return { error: '채울 부족분이 없는 품목이에요.' };
    if (!Number.isInteger(received) || received < need) return { error: '부족한 ' + need + '개 이상 입고해야 해요.' };
    const products = await getProducts();
    if (!products.some(p => p.key === k)) return { error: '재고 목록에 없는 자재예요.' };
    await writeJson('products.json', products.map(p => (p.key === k ? { ...p, stock: p.stock + received - need } : p)));
    const updated: MaterialRequest = { ...r, items: r.items.map(x => (x.k === k ? { ...x, s: undefined, f: (x.f ?? 0) + need } : x)) };
    await writeJson('requests.json', list.map(x => (x.id === id ? updated : x)));
    return { request: updated };
  });
}

/** 최신순 */
export async function getRequests(): Promise<MaterialRequest[]> {
  try {
    return (await readJson<MaterialRequest[]>('requests.json')).map(r => ({ ...r, site: r.site ?? '', done: r.done ?? true, doneAt: r.doneAt ?? null, doneBy: r.doneBy ?? null }));
  } catch {
    return [];
  }
}

/** 자재를 다른 카테고리로 옮긴다 (세부분류는 비운다) */
export function moveProducts(keys: string[], category: string): Promise<CatResult> {
  return withLock(async () => {
    const list = await loadCategories();
    if (!list.includes(category)) return { notFound: true } as const;
    const set = new Set(keys);
    const [products, trash] = await Promise.all([getProducts(), getTrash()]);
    let n = 0;
    const mv = <T extends { key: string; category: string; sub: string }>(rows: T[]) =>
      rows.map(r => (set.has(r.key) && r.category !== category ? (n++, { ...r, category, sub: '' }) : r));
    const np = mv(products);
    const nt = mv(trash);
    if (n) {
      await writeJson('products.json', np);
      await writeJson('trash.json', nt);
      await writeJson('categories.json', list);
    }
    return { ok: true, count: n } as const;
  });
}

/** 품목의 장비운용 분류(연장/소모품/자재)를 바꾼다 (휴지통 포함). 바뀐 개수를 돌려준다. */
export function setKind(keys: string[], kind: Kind): Promise<number> {
  return withLock(async () => {
    const set = new Set(keys);
    const [products, trash] = await Promise.all([getProducts(), getTrash()]);
    let n = 0;
    const mv = <T extends { key: string; kind: Kind }>(rows: T[]) => rows.map(r => (set.has(r.key) && r.kind !== kind ? (n++, { ...r, kind }) : r));
    const np = mv(products);
    const nt = mv(trash);
    if (n) {
      await writeJson('products.json', np);
      await writeJson('trash.json', nt);
    }
    return n;
  });
}

/** 다음에 쓸 자재 번호 (p0001 형식, 휴지통 포함해서 가장 큰 번호 다음) */
export async function nextProductKey(): Promise<string> {
  const [products, trash] = await Promise.all([getProducts(), getTrash()]);
  let max = 0;
  for (const p of [...products, ...trash]) {
    const m = /^p(\d+)$/.exec(p.key);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return 'p' + String(max + 1).padStart(4, '0');
}

/** 새 자재 등록. 목록 맨 뒤(seq 가 가장 큰 값 다음)에 들어간다. */
export function addProduct(p: Omit<Product, 'seq'>): Promise<Product> {
  return withLock(async () => {
    const [products, trash] = await Promise.all([getProducts(), getTrash()]);
    const seq = Math.max(0, ...products.map(x => x.seq), ...trash.map(x => x.seq)) + 1;
    const row: Product = { ...p, seq };
    await writeJson('products.json', [...products, row]);
    return row;
  });
}

/**
 * 현장 요청이 들어오면 재고에서 요청 수량만큼 뺀다. 재고보다 많이 요청해도 받는다 — 재고는 0까지만 줄고,
 * 실제로 뺀 수량(took)을 돌려준다. (요청 수량 - took = 부족한 수량)
 */
export function takeStock(lines: { k: string; q: number }[]): Promise<{ ok: true; took: Record<string, number> } | { short: string }> {
  return withLock(async () => {
    const products = await getProducts();
    const by = new Map(products.map(p => [p.key, p]));
    const took: Record<string, number> = {};
    for (const l of lines) {
      const p = by.get(l.k);
      if (!p) return { short: '없는 자재가 섞여 있어요. 화면을 새로고침해 주세요.' };
      took[l.k] = Math.min(p.stock, l.q);
    }
    await writeJson('products.json', products.map(p => (p.key in took ? { ...p, stock: p.stock - took[p.key] } : p)));
    return { ok: true, took } as const;
  });
}

/** takeStock 으로 뺀 재고를 되돌린다 (요청 저장에 실패했을 때) */
export function returnStock(took: Record<string, number>): Promise<void> {
  return withLock(async () => {
    const products = await getProducts();
    await writeJson('products.json', products.map(p => (p.key in took ? { ...p, stock: p.stock + took[p.key] } : p)));
  });
}

/** 재고 수량 저장 */
export function setStock(key: string, stock: number): Promise<number> {
  return withLock(async () => {
    const products = await getProducts();
    let n = 0;
    await writeJson('products.json', products.map(p => (p.key === key ? (n++, { ...p, stock }) : p)));
    return n;
  });
}

/** 소모품 이름 바꾸기 (휴지통의 것도 가능). 바뀐 개수를 돌려준다. */
export function renameProduct(key: string, name: string): Promise<number> {
  return withLock(async () => {
    const [products, trash] = await Promise.all([getProducts(), getTrash()]);
    let n = 0;
    const re = <T extends { key: string; name: string }>(rows: T[]) => rows.map(r => (r.key === key ? (n++, { ...r, name }) : r));
    const np = re(products);
    const nt = re(trash);
    if (n) {
      await writeJson('products.json', np);
      await writeJson('trash.json', nt);
    }
    return n;
  });
}

/** 소모품 정보 고치기 (휴지통의 것도 가능). 없으면 null, 있으면 바꾸기 전 이미지 주소를 돌려준다. */
export function updateProduct(key: string, e: { name: string; sub: string; brand: string; price: number; kind?: Kind; image?: string }): Promise<{ prevImage: string } | null> {
  return withLock(async () => {
    const [products, trash] = await Promise.all([getProducts(), getTrash()]);
    let prevImage: string | null = null;
    const up = <T extends Product>(rows: T[]) => rows.map(r => {
      if (r.key !== key) return r;
      prevImage = r.image;
      return { ...r, name: e.name, sub: e.sub, brand: e.brand, price: e.price, kind: e.kind ?? r.kind, priceInclVat: e.price === r.price ? r.priceInclVat : null, image: e.image ?? r.image };
    });
    const np = up(products);
    const nt = up(trash);
    if (prevImage === null) return null;
    await writeJson('products.json', np);
    await writeJson('trash.json', nt);
    return { prevImage };
  });
}

/** 카테고리 순서를 통째로 저장한다 (order = 새 순서의 전체 이름 목록) */
export function saveCategoryOrder(order: string[]): Promise<void> {
  return withLock(async () => {
    await writeJson('categories.json', order);
  });
}

/** keys 를 주어진 순서대로 보이게 한다: 이 품목들이 원래 쓰던 순서 값(seq)을 같은 묶음 안에서 다시 나눠 가진다 */
export function reorderProducts(keys: string[]): Promise<boolean> {
  return withLock(async () => {
    const products = await getProducts();
    const rows = keys.map(k => products.find(p => p.key === k));
    if (new Set(keys).size !== keys.length || rows.some(r => !r)) return false;
    const seqs = rows.map(r => r!.seq).sort((x, y) => x - y);
    rows.forEach((r, i) => { r!.seq = seqs[i]; });
    await writeJson('products.json', products.sort((x, y) => x.seq - y.seq));
    return true;
  });
}

/** 두 소모품의 목록 순서(seq)를 서로 바꾼다 */
export function swapProducts(a: string, b: string): Promise<boolean> {
  return withLock(async () => {
    const products = await getProducts();
    const pa = products.find(p => p.key === a);
    const pb = products.find(p => p.key === b);
    if (!pa || !pb || a === b) return false;
    const sa = pa.seq;
    pa.seq = pb.seq;
    pb.seq = sa;
    await writeJson('products.json', products.sort((x, y) => x.seq - y.seq));
    return true;
  });
}

// ───────── 차량정보 (data/vehicles.json · data/vehicle-items.json) ─────────
async function readList<T>(file: string): Promise<T[]> {
  try {
    return await readJson<T[]>(file);
  } catch {
    return [];
  }
}
export const getVehicles = async () => (await readList<Vehicle>('vehicles.json')).map(v => ({ ...EMPTY_SPEC, ...v, photos: v.photos ?? [], nickname: v.nickname ?? '', icon: asIcon(v.icon), driverId: v.driverId ?? '' }));
export const getVehicleItems = () => readList<VehicleItem>('vehicle-items.json');

export function addVehicle(name: string, nickname: string, icon: string, memo: string, driverId: string, spec: VehicleSpec): Promise<VehicleResult<{ vehicle: Vehicle }>> {
  return withLock(async () => {
    const list = await getVehicles();
    if (list.some(v => v.name === name)) return { error: '같은 차량 번호가 이미 있어요.' };
    if (nickname && list.some(v => v.nickname === nickname)) return { error: '같은 별칭이 이미 있어요.' };
    const vehicle: Vehicle = { id: crypto.randomBytes(6).toString('hex'), name, nickname, icon, memo, driverId, photos: [], ...spec, createdAt: new Date().toISOString() };
    await writeJson('vehicles.json', [...list, vehicle]);
    return { ok: true, vehicle };
  });
}

export function updateVehicle(id: string, name: string, nickname: string, icon: string, memo: string, driverId: string, spec: VehicleSpec): Promise<VehicleResult> {
  return withLock(async () => {
    const list = await getVehicles();
    if (!list.some(v => v.id === id)) return { error: '없는 차량이에요.' };
    if (list.some(v => v.id !== id && v.name === name)) return { error: '같은 차량 번호가 이미 있어요.' };
    if (nickname && list.some(v => v.id !== id && v.nickname === nickname)) return { error: '같은 별칭이 이미 있어요.' };
    await writeJson('vehicles.json', list.map(v => (v.id === id ? { ...v, name, nickname, icon, memo, driverId, ...spec } : v)));
    return { ok: true };
  });
}

/** 차량 현황 사진 추가. 한도를 넘으면 가장 오래된 사진부터 빠지고, 빠진 사진 주소를 돌려준다(파일 정리용). */
export function addVehiclePhoto(id: string, photo: VehiclePhoto): Promise<VehicleResult<{ removed: string[] }>> {
  return withLock(async () => {
    const list = await getVehicles();
    const v = list.find(x => x.id === id);
    if (!v) return { error: '없는 차량이에요.' };
    const all = [photo, ...v.photos];
    const photos = all.slice(0, MAX_VEHICLE_PHOTOS);
    await writeJson('vehicles.json', list.map(x => (x.id === id ? { ...x, photos } : x)));
    return { ok: true, removed: all.slice(MAX_VEHICLE_PHOTOS).map(p => p.url) };
  });
}
export function removeVehiclePhoto(id: string, url: string): Promise<VehicleResult> {
  return withLock(async () => {
    const list = await getVehicles();
    const v = list.find(x => x.id === id);
    if (!v || !v.photos.some(p => p.url === url)) return { error: '없는 사진이에요.' };
    await writeJson('vehicles.json', list.map(x => (x.id === id ? { ...x, photos: x.photos.filter(p => p.url !== url) } : x)));
    return { ok: true };
  });
}

/** 차량 삭제: 차량에 배치된 품목은 모두 되돌린 뒤 삭제한다 (연장은 창고 재고로 돌아오고, 상비품은 차량에서 빠진다 — 내리기와 같은 규칙) */
export function removeVehicle(id: string): Promise<VehicleResult> {
  return withLock(async () => {
    const list = await getVehicles();
    if (!list.some(v => v.id === id)) return { error: '없는 차량이에요.' };
    const items = await getVehicleItems();
    const mine = items.filter(i => i.vehicleId === id);
    if (mine.length) {
      const known = [...(await getProducts()), ...(await getTrash())];
      await writeJson('vehicle-items.json', items.filter(i => i.vehicleId !== id));
      for (const it of mine) if (known.find(x => x.key === it.key)?.kind === '연장') await addStock(it.key, it.qty);
    }
    await writeJson('vehicles.json', list.filter(v => v.id !== id));
    return { ok: true };
  });
}

/** 재고를 더하거나 뺀다 (휴지통에 있는 품목도). 바뀌었으면 true */
async function addStock(key: string, delta: number): Promise<boolean> {
  const [products, trash] = await Promise.all([getProducts(), getTrash()]);
  let hit = false;
  const up = <T extends { key: string; stock: number }>(rows: T[]) => rows.map(r => (r.key === key ? (hit = true, { ...r, stock: Math.max(0, r.stock + delta) }) : r));
  const np = up(products);
  const nt = up(trash);
  if (hit) {
    await writeJson('products.json', np);
    await writeJson('trash.json', nt);
  }
  return hit;
}

/**
 * 차량에 연장·상비품을 올린다.
 *  · 연장: 장비운용(창고) 재고에서 배정한 수량만큼 뺀다. 재고가 모자라면 배정할 수 없다. 구분 메모(note)가 다르면 따로 적는다.
 *  · 상비품: 차량에 실린 수량을 따로 센다 (창고 재고는 건드리지 않는다). 같은 품목끼리 수량을 합친다.
 */
export function assignItem(vehicleId: string, key: string, qty: number, note: string): Promise<VehicleResult> {
  return withLock(async () => {
    if (!(await getVehicles()).some(v => v.id === vehicleId)) return { error: '없는 차량이에요.' };
    const p = (await getProducts()).find(x => x.key === key);
    if (!p) return { error: '없는 품목이에요.' };
    if (p.kind === '자재') return { error: '자재는 차량에 싣지 않아요. 연장이나 상비품만 가능해요.' };
    const n = qty;
    if (p.kind === '연장' && p.stock < n) return { error: '창고 재고가 부족해요. (현재 ' + p.stock + '개)' };
    const items = await getVehicleItems();
    const now = new Date().toISOString();
    const memo = p.kind === '연장' ? note : '';
    const same = items.find(i => i.vehicleId === vehicleId && i.key === key && i.note === memo); // 같은 품목·같은 메모는 수량을 합친다
    if (p.kind === '연장') await addStock(key, -n);
    await writeJson('vehicle-items.json', same
      ? items.map(i => (i === same ? { ...i, qty: i.qty + n, at: now } : i))
      : [...items, { id: crypto.randomBytes(6).toString('hex'), vehicleId, key, qty: n, note: memo, at: now }]);
    return { ok: true };
  });
}

/** 차량에서 뺀다. 연장을 내리면 창고 재고로 돌아오고, 상비품은 차량 수량만 줄어든다. */
export function returnItem(itemId: string, qty: number): Promise<VehicleResult> {
  return withLock(async () => {
    const items = await getVehicleItems();
    const it = items.find(i => i.id === itemId);
    if (!it) return { error: '이미 처리됐거나 없는 항목이에요.' };
    if (qty > it.qty) return { error: '차량에는 ' + it.qty + '개만 있어요.' };
    const kind = [...(await getProducts()), ...(await getTrash())].find(x => x.key === it.key)?.kind;
    await writeJson('vehicle-items.json', qty === it.qty ? items.filter(i => i !== it) : items.map(i => (i === it ? { ...i, qty: i.qty - qty } : i)));
    if (kind === '연장') await addStock(it.key, qty);
    return { ok: true };
  });
}

// ───────── 상단 메뉴 순서 (data/menu-order.json) — 모두에게 같게 적용된다 ─────────
export async function getMenuOrder(): Promise<string[]> {
  try {
    const v = await readJson<unknown>('menu-order.json');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
export function saveMenuOrder(order: string[]): Promise<void> {
  return withLock(async () => {
    await writeJson('menu-order.json', order);
  });
}

// ───────── 현장 (data/sites.json) — 자재 요청에서 고르는 등록된 현장 ─────────
// 예전에는 사진이 한 장(photo)이었다 — 있으면 photos 의 첫 장으로 읽는다.
type StoredSite = Omit<Site, 'photos' | 'extensions'> & { photos?: string[]; photo?: string; extensions?: SiteExtension[] };
export const getSites = async (): Promise<Site[]> =>
  (await readList<StoredSite>('sites.json')).map(({ photo, photos, extensions, ...s }) => ({ ...s, address: s.address ?? '', pmId: s.pmId ?? '', startDate: s.startDate ?? '', endDate: s.endDate ?? '', photos: photos ?? (photo ? [photo] : []), extensions: extensions ?? [] }));

export function addSite(i: SiteInput): Promise<VehicleResult<{ site: Site }>> {
  return withLock(async () => {
    const list = await getSites();
    if (list.some(s => s.name === i.name)) return { error: '같은 이름의 현장이 이미 있어요.' };
    const site: Site = { id: crypto.randomBytes(6).toString('hex'), ...i, photos: i.photos ?? [], extensions: [], createdAt: new Date().toISOString() };
    await writeJson('sites.json', [...list, site]);
    return { ok: true, site };
  });
}

/** 수정. 사진 목록에서 빠진 사진 주소들(removed)을 돌려줘서 파일을 정리할 수 있게 한다. */
export function updateSite(id: string, i: SiteInput): Promise<VehicleResult<{ removed: string[] }>> {
  return withLock(async () => {
    const list = await getSites();
    const cur = list.find(s => s.id === id);
    if (!cur) return { error: '없는 현장이에요.' };
    if (list.some(s => s.id !== id && s.name === i.name)) return { error: '같은 이름의 현장이 이미 있어요.' };
    const photos = i.photos ?? cur.photos;
    // 마감일을 바꾸면 이력에 남긴다 (바꾸기 전 마감일이 있을 때만 연장·단축으로 센다)
    const extensions = cur.endDate && i.endDate && cur.endDate !== i.endDate ? [...cur.extensions, { from: cur.endDate, to: i.endDate, at: new Date().toISOString() }] : cur.extensions;
    await writeJson('sites.json', list.map(s => (s.id === id ? { ...s, ...i, photos, extensions } : s)));
    return { ok: true, removed: cur.photos.filter(p => !photos.includes(p)) };
  });
}

export function removeSite(id: string): Promise<VehicleResult<{ photos: string[] }>> {
  return withLock(async () => {
    const list = await getSites();
    const cur = list.find(s => s.id === id);
    if (!cur) return { error: '없는 현장이에요.' };
    await writeJson('sites.json', list.filter(s => s.id !== id)); // 이미 들어온 요청에는 현장 이름이 그대로 남는다
    const pl = await readList<StoredPlacement>('placements.json');
    if (pl.some(p => p.siteId === id)) await writeJson('placements.json', pl.filter(p => p.siteId !== id)); // 그 현장의 배치도 함께 지운다
    const nt = await readList<PlacementNote>('placement-notes.json');
    if (nt.some(n => n.siteId === id)) await writeJson('placement-notes.json', nt.filter(n => n.siteId !== id)); // 작업 내용 메모도
    return { ok: true, photos: cur.photos };
  });
}

// ───────── 현장 배치 (data/placements.json) — 날짜·시간대(오전/오후)별로 누가 어느 현장에 가는지 ─────────
// 한 사람은 같은 날 같은 시간대에 한 현장에만 배치된다 (다시 배치하면 그 현장으로 옮겨진다).
// 시간대가 없던 예전 배치는 종일(오전+오후)로 읽는다.
type StoredPlacement = { date: string; slot?: Slot; siteId: string; memberId: string };
const readPlacements = async (): Promise<Placement[]> =>
  (await readList<StoredPlacement>('placements.json')).flatMap((p): Placement[] => (p.slot ? [p as Placement] : [{ ...p, slot: 'am' }, { ...p, slot: 'pm' }]));

export const getPlacements = async (from: string, to: string): Promise<Placement[]> => (await readPlacements()).filter(p => p.date >= from && p.date <= to);

/** 날짜 하루의 이 시간대(들)에 이 현장으로 사람들을 배치한다. 같은 시간대에 다른 현장에 있던 사람은 옮겨진다. 배치된 인원 수를 돌려준다. */
export function assignPlacements(date: string, siteId: string, memberIds: string[], slots: Slot[]): Promise<number> {
  return withLock(async () => {
    const list = await readPlacements();
    const ids = new Set(memberIds);
    // 야간(오후 5~8시)과 심야(오후 8~10시)는 하루에 하나만: 새로 넣는 쪽이 이기고 반대쪽은 빠진다 (1.5일이 아니라 새로 체크한 것만 센다)
    const drop = new Set<Slot>(slots);
    if (slots.includes('nt')) drop.add('ot');
    if (slots.includes('ot')) drop.add('nt');
    const keep = list.filter(p => !(p.date === date && drop.has(p.slot) && ids.has(p.memberId)));
    await writeJson('placements.json', [...keep, ...memberIds.flatMap(memberId => slots.map(slot => ({ date, slot, siteId, memberId })))]);
    return memberIds.length;
  });
}

export function removePlacement(date: string, memberId: string, slots: Slot[]): Promise<boolean> {
  return withLock(async () => {
    const list = await readPlacements();
    const next = list.filter(p => !(p.date === date && p.memberId === memberId && slots.includes(p.slot)));
    if (next.length === list.length) return false;
    await writeJson('placements.json', next);
    return true;
  });
}

/** fromDate 의 배치(오전·오후 모두)를 toDate 로 복사한다 (toDate 에 같은 시간대가 이미 있는 사람은 건너뛴다). allow 에 없는 현장·회원도 건너뛴다. 복사한 인원 수를 돌려준다. */
export function copyPlacements(fromDate: string, toDate: string, allow: { sites: string[]; members: string[] }): Promise<number> {
  return withLock(async () => {
    const list = await readPlacements();
    const taken = new Set(list.filter(p => p.date === toDate).map(p => p.slot + ':' + p.memberId));
    const add = list
      .filter(p => p.date === fromDate && !taken.has(p.slot + ':' + p.memberId) && allow.sites.includes(p.siteId) && allow.members.includes(p.memberId))
      .map(p => ({ date: toDate, slot: p.slot, siteId: p.siteId, memberId: p.memberId }));
    if (add.length) await writeJson('placements.json', [...list, ...add]);
    return new Set(add.map(p => p.memberId)).size;
  });
}

// ───────── 현장 작업 내용 (data/placement-notes.json) — 현장·날짜별 메모 ─────────
export const getPlacementNotes = async (from: string, to: string): Promise<PlacementNote[]> =>
  (await readList<PlacementNote>('placement-notes.json')).filter(n => n.date >= from && n.date <= to);

/** 그날 이 현장의 작업 내용을 저장한다. 비우면 지운다. */
export function setPlacementNote(date: string, siteId: string, note: string): Promise<void> {
  return withLock(async () => {
    const list = await readList<PlacementNote>('placement-notes.json');
    const rest = list.filter(n => !(n.date === date && n.siteId === siteId));
    await writeJson('placement-notes.json', note ? [...rest, { date, siteId, note }] : rest);
  });
}

// ───────── 출근 조회 기준 이력 (data/attendance-cycle.json) — 매달 며칠부터 며칠까지, 적용 시작 월별로 ─────────
export async function getAttendanceCycles(): Promise<CycleEntry[]> {
  try {
    return toEntries(await readJson<unknown>('attendance-cycle.json'));
  } catch {
    return toEntries(null);
  }
}
export function saveAttendanceCycles(list: CycleEntry[]): Promise<void> {
  return withLock(async () => {
    await writeJson('attendance-cycle.json', list);
  });
}

// ───────── 휴가 신청 (data/leaves.json) ─────────
export const getLeaves = () => readList<LeaveRequest>('leaves.json');

export function addLeave(i: LeaveInput): Promise<LeaveRequest> {
  return withLock(async () => {
    const list = await getLeaves();
    const row: LeaveRequest = { id: crypto.randomBytes(6).toString('hex'), ...i, status: 'pending', createdAt: new Date().toISOString(), decidedAt: '', decidedBy: '', decisionNote: '' };
    await writeJson('leaves.json', [row, ...list]);
    return row;
  });
}

/** 본인이 낸 '승인 대기' 신청만 취소(삭제)할 수 있다 */
export function cancelLeave(id: string, memberId: string): Promise<boolean> {
  return withLock(async () => {
    const list = await getLeaves();
    const cur = list.find(l => l.id === id);
    if (!cur || cur.memberId !== memberId || cur.status !== 'pending') return false;
    await writeJson('leaves.json', list.filter(l => l.id !== id));
    return true;
  });
}

/** 승인·반려. 대기 중인 신청만 처리하고, 처리된 신청을 돌려준다 (없거나 이미 처리됐으면 null) */
export function decideLeave(id: string, status: 'approved' | 'rejected', by: string, note: string): Promise<LeaveRequest | null> {
  return withLock(async () => {
    const list = await getLeaves();
    const cur = list.find(l => l.id === id);
    if (!cur || cur.status !== 'pending') return null;
    const next: LeaveRequest = { ...cur, status, decidedAt: new Date().toISOString(), decidedBy: by, decisionNote: note };
    await writeJson('leaves.json', list.map(l => (l.id === id ? next : l)));
    return next;
  });
}

/** 회원의 기간 안 배치를 지운다 (휴가 승인 때). 지운 건수를 돌려준다. */
export function removePlacementsRange(memberId: string, from: string, to: string, slots: Slot[]): Promise<number> {
  return withLock(async () => {
    const list = await readPlacements();
    const next = list.filter(p => !(p.memberId === memberId && p.date >= from && p.date <= to && slots.includes(p.slot)));
    if (next.length !== list.length) await writeJson('placements.json', next);
    return list.length - next.length;
  });
}

// ───────── 사무 연차 부여 (data/annual-leave.json) — { 연도: { 회원 id: 총 일수 } } ─────────
export async function getAnnualLeave(): Promise<AnnualLeave> {
  try {
    const v = await readJson<unknown>('annual-leave.json');
    return v && typeof v === 'object' ? (v as AnnualLeave) : {};
  } catch {
    return {};
  }
}
/** 그 해 이 회원의 연차 총 일수를 정한다. days 가 null 이면 지운다(미설정). */
export function setAnnualLeave(year: number, memberId: string, days: number | null): Promise<void> {
  return withLock(async () => {
    const all = await getAnnualLeave();
    const y = { ...(all[String(year)] ?? {}) };
    if (days === null) delete y[memberId];
    else y[memberId] = days;
    await writeJson('annual-leave.json', { ...all, [String(year)]: y });
  });
}

// ───────── 현장경비 (data/expenses.json) — 현장에서 쓴 식비·음료 영수증 ─────────
export const getExpenses = async () => (await readList<Expense>('expenses.json')).map(e => ({ ...e, photos: e.photos ?? [], memo: e.memo ?? '', docType: e.docType ?? 'receipt', vendor: e.vendor ?? '', payMethod: e.payMethod ?? 'card', booked: !!e.booked, bookedBy: e.bookedBy ?? '', bookedAt: e.bookedAt ?? '', purchaseId: e.purchaseId ?? '', status: (e.status === 'requested' ? 'requested' : 'done') as 'requested' | 'done', link: e.link ?? '', account: e.account ?? '' }));

export function addExpense(i: ExpenseInput, by: { id: string; name: string }): Promise<Expense> {
  return withLock(async () => {
    const list = await getExpenses();
    const row: Expense = { id: crypto.randomBytes(6).toString('hex'), ...i, memberId: by.id, memberName: by.name, createdAt: new Date().toISOString() };
    await writeJson('expenses.json', [row, ...list]);
    return row;
  });
}
export function updateExpense(id: string, i: ExpenseInput): Promise<boolean> {
  return withLock(async () => {
    const list = await getExpenses();
    if (!list.some(e => e.id === id)) return false;
    await writeJson('expenses.json', list.map(e => (e.id === id ? { ...e, ...i } : e)));
    return true;
  });
}
export function removeExpense(id: string): Promise<boolean> {
  return withLock(async () => {
    const list = await getExpenses();
    if (!list.some(e => e.id === id)) return false;
    await writeJson('expenses.json', list.filter(e => e.id !== id));
    return true;
  });
}

// ───────── 적재 패키지 (data/load-packages.json) — 자주 싣는 연장·상비품 묶음 ─────────
export const getLoadPackages = async () => (await readList<LoadPackage>('load-packages.json')).map(p => ({ ...p, items: p.items ?? [] }));
export function saveLoadPackage(i: LoadPackageInput, id: string | null): Promise<VehicleResult> {
  return withLock(async () => {
    const list = await getLoadPackages();
    if (list.some(p => p.id !== id && p.name === i.name)) return { error: '같은 이름의 패키지가 이미 있어요.' };
    if (id) {
      if (!list.some(p => p.id === id)) return { error: '없는 패키지예요.' };
      await writeJson('load-packages.json', list.map(p => (p.id === id ? { ...p, ...i } : p)));
    } else {
      await writeJson('load-packages.json', [...list, { id: crypto.randomBytes(6).toString('hex'), ...i, createdAt: new Date().toISOString() }]);
    }
    return { ok: true };
  });
}
export function removeLoadPackage(id: string): Promise<VehicleResult> {
  return withLock(async () => {
    const list = await getLoadPackages();
    if (!list.some(p => p.id === id)) return { error: '없는 패키지예요.' };
    await writeJson('load-packages.json', list.filter(p => p.id !== id));
    return { ok: true };
  });
}

