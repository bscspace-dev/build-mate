import { actorCan, getActor } from '@/lib/auth';
import { addExpense, getExpenses, getSites, removeExpense, updateExpense } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';
import { removeImage, saveImage } from '@/lib/images';
import type { ExpenseCategory, ExpenseDoc, ExpenseInput, ExpensePay, ExpenseStatus } from '@/lib/types';

// 경비관리: 영수증·세금계산서를 사진으로 올리거나, 인터넷으로 사야 하는 비품을 「구매요청」으로 올린다.
//  · 영수증·세금계산서(등록 권한): 사진 + 현장 + 날짜 + 금액. 사무실 경리가 보고 엑셀로 정리한다.
//  · 구매요청(등록 권한): 사진/링크 + 현장 + 분류 + 구매처 + 금액 + 사유. 담당자(수정 권한)가 구매하고 영수증 사진을 올려 「완료」로 처리한다.
//  · 영수증·세금계산서(등록 권한): 결제수단은 카드·현금·계좌이체 중 고른다. 전체 권한(수정 권한)이 있는 사람은 계좌이체여도 계좌번호를 적지 않고 바로 완료로 올라간다.
//    일부 권한만 있는 사람이 계좌이체를 고르면 입금할 계좌번호를 적어야 하고 「입금 요청」으로 올라가며, 담당자(수정 권한)가 입금한 뒤 확인하면 「구매 완료」가 된다.
//  · 올린 사람은 자기 것을 수정·삭제할 수 있다(구매요청은 완료되기 전까지). 남의 것을 고치기(수정 권한)·지우기(삭제 권한)는 관리자 권한.
// 사진 때문에 등록·수정·완료는 multipart(FormData), 삭제는 JSON 으로 받는다.
const OFFICE = '사무실'; // 현장이 아닌 사무실 경비도 같은 목록에 올린다
const MAX_IMAGE = 3 * 1024 * 1024;
const MAX_PHOTOS = 4; // 한 번에 올릴 수 있는 사진 수 (구매요청은 완료할 때 영수증 사진이 더해져 최대 8장)
const MAX_REQUEST_PHOTOS = 8;
const TYPES = ['image/webp', 'image/jpeg', 'image/png'];
const CATEGORIES: ExpenseCategory[] = ['meal', 'drink', 'materials', 'fuel', 'parking', 'supplies', 'other'];
const DOCS: ExpenseDoc[] = ['receipt', 'invoice', 'request'];
const PAYS: ExpensePay[] = ['card', 'cash', 'transfer'];
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const clipText = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '');
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

/** 링크 정리: 비어 있으면 빈 값, http(s)가 없으면 https:// 를 붙이고, http·https 가 아니면(javascript: 등) 거절한다. */
function cleanUrl(raw: unknown): string | null {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) return '';
  const withProto = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : 'https://' + v;
  try {
    const u = new URL(withProto);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString().slice(0, 2000);
  } catch {
    return null;
  }
}
const amountOf = (v: unknown) => { const n = Number(clip(v, 12)); return Number.isInteger(n) && n >= 0 && n <= 99_999_999 ? n : NaN; };

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('expenses');
  if (!actor) return json({ error: '경비관리 메뉴 권한이 필요해요.' }, 401);
  if (limited(req, 'expenses', 120, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);
  const meId = actor.kind === 'member' ? actor.member.id : '';
  const meName = actor.kind === 'member' ? actor.member.name : '최고 관리자';

  const multipart = (req.headers.get('content-type') ?? '').includes('multipart/form-data');
  let get: (k: string) => unknown;
  let files: File[] = [];
  if (multipart) {
    const form = await req.formData().catch(() => null);
    if (!form) return json({ error: 'bad request' }, 400);
    get = k => form.get(k);
    files = form.getAll('photo').filter((f): f is File => f instanceof File && f.size > 0);
  } else {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) return json({ error: 'bad request' }, 400);
    get = k => b[k];
  }
  const a = get('action');
  if (a !== 'add' && a !== 'update' && a !== 'delete' && a !== 'complete') return json({ error: 'bad request' }, 400);
  const can = (k: 'register' | 'edit' | 'delete') => actorCan(actor, 'expenses', k);

  const id = clip(get('id'), 64);
  if (a === 'add') {
    if (!meId) return json({ error: '서류는 회원 계정으로 올려 주세요.' }, 403);
    if (!can('register')) return json({ error: '서류를 올릴 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);
  }

  const cur = a === 'add' ? null : (await getExpenses()).find(x => x.id === id);
  if (a !== 'add' && !cur) return json({ error: '없는 서류예요.' }, 404);
  const own = !!cur && !!meId && cur.memberId === meId && can('register') && !cur.booked && (cur.docType !== 'request' || cur.status === 'requested'); // 내 것 (담당자가 처리하기 전까지, 구매요청은 완료되기 전까지)

  if (a === 'delete') {
    if (!can('delete') && !own) return json({ error: '이 서류를 지울 권한이 없어요.' }, 403);
    await removeExpense(id);
    await Promise.all(cur!.photos.map(p => removeImage(p).catch(() => undefined))); // 서류 사진 파일도 정리한다
    return json({ ok: true });
  }
  if (a === 'update' && !can('edit') && !own) return json({ error: '이 서류를 고칠 권한이 없어요.' }, 403);
  if (a === 'complete') {
    if (!can('edit')) return json({ error: '확인·구매 완료 처리는 전체 권한(수정 권한)이 있는 담당자가 해요.' }, 403);
    if (cur!.status !== 'requested') return json({ error: '처리 대기 중인 구매요청·입금요청이 아니에요.' }, 400);
  }

  // 사진 검사 (새로 올린 파일)
  if (files.length > MAX_PHOTOS) return json({ error: `사진은 한 번에 ${MAX_PHOTOS}장까지 올릴 수 있어요.` }, 400);
  for (const f of files) {
    if (!TYPES.includes(f.type)) return json({ error: '사진은 webp·jpg·png 파일만 올릴 수 있어요.' }, 400);
    if (f.size > MAX_IMAGE) return json({ error: '사진이 너무 커요. 한 장에 3MB 이하로 올려 주세요.' }, 413);
  }
  const saved: string[] = [];
  const dropSaved = () => Promise.all(saved.map(p => removeImage(p).catch(() => undefined)));
  const saveAll = async () => { for (const f of files) saved.push(await saveImage('exp-' + Math.random().toString(36).slice(2, 10), new Uint8Array(await f.arrayBuffer()), f.type)); };
  const failMsg = (e: unknown) => {
    // 저장소 오류는 화면에 이유가 보이게 돌려준다 (예: DB에 새 칸이 아직 없을 때)
    const msg = e instanceof Error ? e.message : '';
    const stale = /column|does not exist|schema cache|constraint|check/i.test(msg);
    return json({ error: stale ? '저장소(DB)가 아직 최신이 아니에요. Supabase SQL Editor 에서 supabase/add-expenses.sql 을 실행한 뒤 다시 해 주세요.' : '저장하지 못했어요. 잠시 후 다시 해 보세요.' }, 500);
  };

  // 완료: 구매요청은 영수증 사진(필수)과 결제수단을 확인하고, 세금계산서는 입금을 확인한다 (이체 확인증 사진은 선택)
  if (a === 'complete') {
    const reqDoc = cur!.docType === 'request';
    if (reqDoc && files.length < 1) return json({ error: '구매한 영수증 사진을 올려 주세요.' }, 400);
    if (files.length + cur!.photos.length > MAX_REQUEST_PHOTOS) return json({ error: '사진이 너무 많아요.' }, 400);
    const amountRaw = get('amount') === undefined || get('amount') === '' ? cur!.amount : amountOf(get('amount'));
    if (Number.isNaN(amountRaw)) return json({ error: '금액은 0 이상의 숫자(원)로 적어 주세요.' }, 400);
    let payMethod: ExpensePay = cur!.payMethod; // 입금 요청은 올릴 때 고른 결제수단(계좌이체) 그대로
    if (reqDoc) {
      if (!PAYS.includes(get('payMethod') as ExpensePay)) return json({ error: '결제수단(카드·현금·계좌이체)을 골라 주세요.' }, 400);
      payMethod = get('payMethod') as ExpensePay;
    }
    try {
      await saveAll();
      const { id: _id, memberId, memberName, createdAt, ...base } = cur!;
      void _id; void memberId; void memberName; void createdAt;
      const input: ExpenseInput = { ...base, date: reqDoc ? kstToday() : cur!.date, amount: amountRaw, vendor: reqDoc && get('vendor') !== undefined ? clip(get('vendor'), 60) : cur!.vendor, payMethod, photos: [...saved, ...cur!.photos], status: 'done', booked: true, bookedBy: meName, bookedAt: new Date().toISOString() };
      if (!(await updateExpense(id, input))) { await dropSaved(); return json({ error: '없는 서류예요.' }, 404); }
      return json({ ok: true });
    } catch (e) {
      await dropSaved();
      return failMsg(e);
    }
  }

  // add · update: 서류 내용
  const posted = DOCS.includes(get('docType') as ExpenseDoc) ? (get('docType') as ExpenseDoc) : 'receipt';
  const docType: ExpenseDoc = cur ? cur.docType : posted; // 서류 종류는 만든 뒤에 바꿀 수 없다
  const isRequest = docType === 'request';
  const date = isRequest ? (cur?.date ?? kstToday()) : clip(get('date'), 10);
  if (!isDate(date)) return json({ error: '날짜를 골라 주세요.' }, 400);
  if (date > new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10)) return json({ error: '앞으로의 날짜는 올릴 수 없어요.' }, 400);
  const site = clip(get('site'), 50);
  if (!site) return json({ error: '현장이나 사무실을 골라 주세요.' }, 400);
  if (site !== OFFICE && !(await getSites()).some(s => s.name === site) && cur?.site !== site) return json({ error: '현장이나 사무실을 골라 주세요.' }, 400);
  const category = CATEGORIES.includes(get('category') as ExpenseCategory) ? (get('category') as ExpenseCategory) : isRequest ? 'supplies' : 'meal';
  // 결제수단: 영수증·세금계산서는 올리는 사람이 고른다(카드·현금·계좌이체 모두 가능, 안 고르면 영수증은 카드·세금계산서는 계좌이체). 구매요청은 완료할 때 담당자가 고른다(그 전에는 카드로 둔다).
  const payMethod: ExpensePay = isRequest ? 'card' : PAYS.includes(get('payMethod') as ExpensePay) ? (get('payMethod') as ExpensePay) : docType === 'invoice' ? 'transfer' : 'card';
  const vendor = clip(get('vendor'), 60);
  const amount = amountOf(get('amount'));
  if (Number.isNaN(amount)) return json({ error: '금액은 0 이상의 숫자(원)로 적어 주세요.' }, 400);
  const link = isRequest ? cleanUrl(get('link')) : '';
  if (link === null) return json({ error: '구매 링크는 http:// 또는 https:// 주소로 적어 주세요.' }, 400);
  const memo = isRequest ? clipText(get('memo'), 300) : clip(get('memo'), 200);
  if (isRequest && !memo) return json({ error: '구매가 필요한 사유를 적어 주세요.' }, 400);

  // 사진: keep = 그대로 둘 기존 사진(수정할 때), photo = 새로 올린 파일들
  let keep: string[] = [];
  if (cur) {
    let want: unknown = [];
    try { want = JSON.parse(typeof get('keep') === 'string' ? (get('keep') as string) : '[]'); } catch { want = []; }
    keep = (Array.isArray(want) ? want : []).filter((p): p is string => typeof p === 'string' && cur.photos.includes(p));
  }
  const total = files.length + keep.length;
  if (isRequest ? !link && total < 1 : total < 1) return json({ error: isRequest ? '링크나 사진 중 하나는 꼭 넣어 주세요.' : '영수증(또는 세금계산서) 사진을 1장 이상 올려 주세요.' }, 400);
  // 진행 상태·확인: 모든 서류(영수증·세금계산서·구매요청)는 전체 권한(수정 권한)을 가진 사람이 마지막으로 확인해야 하고, 그 이름이 「확인」 칸에 기록된다.
  //  · 전체 권한 사람이 영수증·세금계산서를 올리면 본인이 올린 것이니 그 자리에서 본인 이름으로 확인 처리된다 (계좌번호도 필요 없다).
  //  · 일부 권한만 있는 사람이 올리면 「확인 대기」가 된다. 계좌이체를 고르면 입금할 계좌번호가 필수이고 「입금 요청」이 된다.
  //  · 구매요청은 누가 올리든 구매 대기에서 시작해, 담당자가 구매하고 영수증 사진을 올려 완료한다.
  const admin = can('edit');
  let status: ExpenseStatus = 'requested';
  let account = '';
  let booked = cur?.booked ?? false;
  let bookedBy = cur?.bookedBy ?? '';
  let bookedAt = cur?.bookedAt ?? '';
  if (isRequest) {
    status = cur?.status ?? 'requested';
  } else if (admin) {
    if (cur) { status = cur.status; account = cur.account; } // 이미 있던 상태·계좌·확인은 그대로 둔다
    else { status = 'done'; booked = true; bookedBy = meName; bookedAt = new Date().toISOString(); }
  } else {
    // 일부 권한: 올리거나 고치면 다시 확인 대기
    status = 'requested';
    booked = false; bookedBy = ''; bookedAt = '';
    if (payMethod === 'transfer') {
      account = clip(get('account'), 80);
      if (!account) return json({ error: '계좌이체는 입금할 계좌번호를 적어 주세요.' }, 400);
    }
  }
  const maxTotal = isRequest || payMethod === 'transfer' ? MAX_REQUEST_PHOTOS : MAX_PHOTOS; // 구매요청·입금 요청은 완료할 때 사진이 더해질 수 있다
  if (total > maxTotal) return json({ error: `사진은 한 건에 ${maxTotal}장까지 올릴 수 있어요.` }, 400);
  try {
    await saveAll();
    const input: ExpenseInput = {
      date, site, category, amount, memo, docType, vendor, payMethod, photos: [...keep, ...saved],
      booked, bookedBy, bookedAt, purchaseId: cur?.purchaseId ?? '',
      status, link, account,
    };
    if (a === 'add') {
      await addExpense(input, { id: meId, name: meName });
      return json({ ok: true });
    }
    if (!(await updateExpense(id, input))) { await dropSaved(); return json({ error: '없는 서류예요.' }, 404); }
    await Promise.all(cur!.photos.filter(p => !keep.includes(p)).map(p => removeImage(p).catch(() => undefined))); // 뺀 사진 파일 정리
    return json({ ok: true });
  } catch (e) {
    await dropSaved();
    return failMsg(e);
  }
}
