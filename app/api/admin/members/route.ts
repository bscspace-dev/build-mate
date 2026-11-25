import { audited } from '@/lib/audit';
import { actorCan, getActor } from '@/lib/auth';
import { getLeaves, getTeams as getTeamsForPay, setAnnualLeave } from '@/lib/db';
import { leaveUsage } from '@/lib/leave';
import { isOfficePay } from '@/lib/roles';
import { getTrades } from '@/lib/db';
import { json, sameOrigin } from '@/lib/guard';
import { actorPowers, addMember, deleteMember, resetMember, resignMember, updateMember } from '@/lib/members';

// 회원 관리 (최고 관리자·개발팀 전용): 생성(아이디·임시 비밀번호 발급) / 수정 / 임시 비밀번호 재발급 / 삭제
async function handlePOST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('members');
  if (!actor) return json({ error: '회원 관리 권한이 없어요. 최고 관리자나 개발팀 계정으로 로그인해 주세요.' }, 401);

  const b = (await req.json().catch(() => null)) as {
    action?: unknown; annualRemain?: unknown; id?: unknown; name?: unknown; role?: unknown; extraRole?: unknown; payType?: unknown; menus?: unknown; actions?: unknown; trades?: unknown; categories?: unknown; handles?: unknown; phone?: unknown; address?: unknown; addressDetail?: unknown; position?: unknown; fieldRoles?: unknown; officeStatus?: unknown; hireDate?: unknown; payEffective?: unknown; resignDate?: unknown; payAmount?: unknown; bank?: unknown; accountNo?: unknown; accountHolder?: unknown; safetyDate?: unknown; license?: unknown; password?: unknown; loginId?: unknown; account?: unknown;
  } | null;
  if (!b) return json({ error: 'bad request' }, 400);
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

  // 동작별 권한: 생성=등록, 수정·임시 비밀번호 재발급=수정, 삭제=삭제
  const need = b.action === 'add' ? 'register' : b.action === 'update' || b.action === 'reset' ? 'edit' : b.action === 'delete' || b.action === 'resign' ? 'delete' : null;
  if (!need) return json({ error: 'bad action' }, 400);
  if (!actorCan(actor, 'members', need)) return json({ error: '이 작업을 할 권한이 없어요.' }, 403);

  // 연차 잔여(사무직 기준 회원만): 비우면 미설정. 총 일수 = 올해 이미 쓴 일수 + 입력한 잔여 일수 — 휴가를 쓸 때마다 잔여가 자동으로 줄어든다.
  const remainRaw = b.annualRemain;
  const remain = remainRaw === undefined ? undefined : remainRaw === null || remainRaw === '' ? null : typeof remainRaw === 'number' && remainRaw >= 0 && remainRaw <= 120 && Number.isInteger(remainRaw * 2) ? remainRaw : NaN;
  if (typeof remain === 'number' && Number.isNaN(remain)) return json({ error: '연차는 0~120일, 0.5 단위로 적어 주세요.' }, 400);
  async function saveAnnual(m: { id: string; role: string; extraRole?: string; payType?: '' | 'daily' | 'office' }) {
    if (remain === undefined || !isOfficePay(await getTeamsForPay(), m)) return undefined;
    const year = new Date().getFullYear();
    const { used } = leaveUsage(await getLeaves(), m.id, year);
    const total = remain === null ? null : used + remain;
    await setAnnualLeave(year, m.id, total);
    return { total, used };
  }

  if (b.action === 'add') {
    const r = await addMember({ name: str(b.name) ?? '', role: b.role, extraRole: b.extraRole, payType: b.payType, menus: b.menus, actions: b.actions, trades: b.trades, categories: b.categories, handles: b.handles, phone: b.phone, address: b.address, addressDetail: b.addressDetail, position: b.position, hireDate: b.hireDate, fieldRoles: b.fieldRoles, officeStatus: b.officeStatus, loginId: str(b.loginId), password: b.password, payAmount: b.payAmount, bank: b.bank, accountNo: b.accountNo, accountHolder: b.accountHolder, safetyDate: b.safetyDate, license: b.license, account: b.account !== false }, await getTrades(), actorPowers(actor));
    if ('error' in r) return json({ error: r.error }, 400);
    return json({ ok: true, ...r, annual: await saveAnnual(r.member) });
  }

  if (typeof b.id !== 'string') return json({ error: 'bad id' }, 400);

  if (b.action === 'update') {
    const patch: { name?: string; role?: unknown; extraRole?: unknown; payType?: unknown; menus?: unknown; actions?: unknown; trades?: unknown; categories?: unknown; handles?: unknown; phone?: unknown; address?: unknown; addressDetail?: unknown; position?: unknown; fieldRoles?: unknown; officeStatus?: unknown; hireDate?: unknown; payEffective?: unknown; resignDate?: unknown; payAmount?: unknown; bank?: unknown; accountNo?: unknown; accountHolder?: unknown; safetyDate?: unknown; license?: unknown; loginId?: string } = {};
    if (b.name !== undefined) patch.name = str(b.name) ?? '';
    if (b.role !== undefined) patch.role = b.role;
    if (b.extraRole !== undefined) patch.extraRole = b.extraRole;
    if (b.payType !== undefined) patch.payType = b.payType;
    if (b.menus !== undefined) patch.menus = b.menus;
    if (b.actions !== undefined) patch.actions = b.actions;
    if (b.trades !== undefined) patch.trades = b.trades;
    if (b.categories !== undefined) patch.categories = b.categories;
    if (b.handles !== undefined) patch.handles = b.handles;
    if (b.phone !== undefined) patch.phone = b.phone;
    if (b.address !== undefined) patch.address = b.address;
    if (b.addressDetail !== undefined) patch.addressDetail = b.addressDetail;
    if (b.position !== undefined) patch.position = b.position;
    if (b.hireDate !== undefined) patch.hireDate = b.hireDate;
    if (b.payAmount !== undefined) patch.payAmount = b.payAmount;
    if (b.payEffective !== undefined) patch.payEffective = b.payEffective;
    if (b.bank !== undefined) patch.bank = b.bank;
    if (b.accountNo !== undefined) patch.accountNo = b.accountNo;
    if (b.accountHolder !== undefined) patch.accountHolder = b.accountHolder;
    if (b.safetyDate !== undefined) patch.safetyDate = b.safetyDate;
    if (b.license !== undefined) patch.license = b.license;
    if (b.resignDate !== undefined) patch.resignDate = b.resignDate;
    if (b.fieldRoles !== undefined) patch.fieldRoles = b.fieldRoles;
    if (b.officeStatus !== undefined) patch.officeStatus = b.officeStatus;
    if (b.loginId !== undefined) patch.loginId = str(b.loginId) ?? '';
    const r = await updateMember(actor, b.id, patch, await getTrades());
    if ('error' in r) return json({ error: r.error }, 400);
    return json({ ok: true, member: r, annual: await saveAnnual(r) });
  }
  if (b.action === 'reset') {
    const r = await resetMember(actor, b.id);
    return 'error' in r ? json({ error: r.error }, 400) : json({ ok: true, ...r });
  }
  if (b.action === 'resign') {
    const r = await resignMember(actor, b.id);
    return 'error' in r ? json({ error: r.error }, 400) : json({ ok: true, member: r.member });
  }
  if (b.action === 'delete') {
    const r = await deleteMember(actor, b.id);
    return 'error' in r ? json({ error: r.error }, 400) : json({ ok: true });
  }
  return json({ error: 'bad action' }, 400);
}

export const POST = audited('members', handlePOST);
