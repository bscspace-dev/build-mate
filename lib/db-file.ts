import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Member, MemberPatch, Product, SurveyPayload, TrashedProduct } from './types';
import { removeImage } from './images';
import { DEFAULT_TEAMS, type Team } from './roles';

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

export const getProducts = () => readJson<Product[]>('products.json');
export const getTrash = () => readJson<TrashedProduct[]>('trash.json');
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
    return (await readJson<Member[]>('members.json')).map(m => ({ ...m, menus: m.menus ?? [], actions: m.actions ?? {}, categories: m.categories ?? [] }));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    const old = await readOr<LegacyWorker[]>('workers.json', []);
    const migrated: Member[] = old.map(w => ({
      id: w.id, name: w.name, role: 'worker', trades: w.trades, categories: [], menus: [], actions: {}, createdAt: w.createdAt,
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
    return await readJson<Team[]>('teams.json');
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
    const used = (await loadMembers()).filter(m => m.role === key).length;
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

/** 카테고리 순서를 통째로 저장한다 (order = 새 순서의 전체 이름 목록) */
export function saveCategoryOrder(order: string[]): Promise<void> {
  return withLock(async () => {
    await writeJson('categories.json', order);
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
