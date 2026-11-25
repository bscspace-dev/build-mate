import { audited } from '@/lib/audit';
import { getActor, vehiclesFull } from '@/lib/auth';
import { addVehicle, assignItem, getActiveMembers, getTeams, removeVehicle, returnItem, updateVehicle } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';
import { sideOf, teamGroup } from '@/lib/roles';
import { asIcon, type VehicleOwnership, type VehicleSpec } from '@/lib/types';

// 차량정보: 차량 등록(등록 권한) · 이름/메모 수정 · 연장/상비품 싣기·빼기(수정 권한) · 차량 삭제(삭제 권한)
type Body = { action?: unknown; id?: unknown; name?: unknown; nickname?: unknown; icon?: unknown; memo?: unknown; driverId?: unknown; key?: unknown; qty?: unknown; note?: unknown; restock?: unknown; model?: unknown; year?: unknown; vin?: unknown; ownership?: unknown; mileage?: unknown; oilDate?: unknown; oilKm?: unknown; inspectionDate?: unknown; insurer?: unknown; policyNo?: unknown; insuranceExpiry?: unknown; premium?: unknown; insurancePhone?: unknown; insuranceNote?: unknown };
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const kmOf = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 9_999_999 ? v : NaN);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const qtyOf = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 99_999 ? v : 0);

async function handlePOST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('vehicles');
  if (!actor) return json({ error: '차량정보 메뉴 권한이 필요해요.' }, 401);
  if (limited(req, 'vehicles', 300, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);

  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b) return json({ error: 'bad request' }, 400);
  const a = b.action;
  const need = a === 'add' ? 'register' : a === 'remove' ? 'delete' : a === 'update' || a === 'assign' || a === 'return' ? 'edit' : null;
  if (!need) return json({ error: 'bad request' }, 400);
  if (!vehiclesFull(actor)) return json({ error: '이 작업을 할 권한이 없어요. (차량정보 모든 권한이 필요해요) 최고 관리자나 개발팀에 요청해 주세요.' }, 403);

  const id = str(b.id, 64);
  if (a === 'add' || a === 'update') {
    const name = str(b.name, 40);
    const nickname = str(b.nickname, 20);
    const icon = asIcon(b.icon);
    // 비고는 여러 줄로 적을 수 있다 (줄바꿈은 그대로 두고 앞뒤 공백만 정리)
    const memo = typeof b.memo === 'string' ? b.memo.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1000) : '';
    const driverId = str(b.driverId, 64);
    if (driverId) {
      // 배차는 사내 회원(사무실·현장)만 가능하다
      const [members, teams] = await Promise.all([getActiveMembers(), getTeams()]);
      const m = members.find(x => x.id === driverId);
      if (!m) return json({ error: '없는 회원이에요. 배차할 회원을 다시 골라 주세요.' }, 400);
      const g = teamGroup(teams, m.role);
      if (g === null || sideOf(g) !== 'inhouse') return json({ error: '배차는 사내 회원만 할 수 있어요.' }, 400);
    }
    if (!name) return json({ error: '차량 번호를 적어 주세요.' }, 400);
    // 차량 관리 정보 (모두 선택): 차종·연식·차대번호·소유 형태·주행거리·엔진오일·검사일
    const oilDate = str(b.oilDate, 10);
    const inspectionDate = str(b.inspectionDate, 10);
    const insuranceExpiry = str(b.insuranceExpiry, 10);
    if ((oilDate && !isDate(oilDate)) || (inspectionDate && !isDate(inspectionDate)) || (insuranceExpiry && !isDate(insuranceExpiry))) return json({ error: '엔진오일 교환일·검사일·보험 만기일 날짜가 올바르지 않아요.' }, 400);
    const premium = b.premium === undefined || b.premium === '' ? 0 : typeof b.premium === 'number' && Number.isInteger(b.premium) && b.premium >= 0 && b.premium <= 99_999_999 ? b.premium : NaN;
    if (Number.isNaN(premium)) return json({ error: '보험료는 0 이상의 숫자(원)로 적어 주세요.' }, 400);
    const mileage = b.mileage === undefined || b.mileage === '' ? 0 : kmOf(b.mileage);
    const oilKm = b.oilKm === undefined || b.oilKm === '' ? 0 : kmOf(b.oilKm);
    if (Number.isNaN(mileage) || Number.isNaN(oilKm)) return json({ error: '주행거리(km)는 0 이상의 숫자로 적어 주세요.' }, 400);
    const spec: VehicleSpec = { model: str(b.model, 30), year: str(b.year, 10), vin: str(b.vin, 30).toUpperCase(), ownership: (['owned', 'lease', 'rent'].includes(b.ownership as string) ? b.ownership : '') as VehicleOwnership, mileage, oilDate, oilKm, inspectionDate, insurer: str(b.insurer, 30), policyNo: str(b.policyNo, 40), insuranceExpiry, premium, insurancePhone: str(b.insurancePhone, 30), insuranceNote: str(b.insuranceNote, 200) };
    const r = a === 'add' ? await addVehicle(name, nickname, icon, memo, driverId, spec) : id ? await updateVehicle(id, name, nickname, icon, memo, driverId, spec) : { error: 'bad id' };
    return 'error' in r ? json(r, 400) : json(r);
  }
  if (a === 'remove') {
    if (!id) return json({ error: 'bad id' }, 400);
    const r = await removeVehicle(id);
    return 'error' in r ? json(r, 400) : json(r);
  }
  if (a === 'assign') {
    const key = str(b.key, 64);
    const qty = qtyOf(b.qty);
    if (!id || !key) return json({ error: 'bad request' }, 400);
    if (!qty) return json({ error: '수량은 1 이상의 숫자로 적어 주세요.' }, 400);
    const r = await assignItem(id, key, qty, str(b.note, 60));
    return 'error' in r ? json(r, 400) : json(r);
  }
  // return: 차량에서 빼기 (회수하거나 써서 없어진 수량). 창고 재고와는 따로 센다
  const qty = qtyOf(b.qty);
  if (!id) return json({ error: 'bad id' }, 400);
  if (!qty) return json({ error: '수량은 1 이상의 숫자로 적어 주세요.' }, 400);
  const r = await returnItem(id, qty);
  return 'error' in r ? json(r, 400) : json(r);
}

export const POST = audited('vehicles', handlePOST);
