import type { GrantedActions, MenuKey, RoleKey } from './roles';

/** 장비운용의 3가지 분류 */
export const KINDS = ['연장', '상비품', '자재'] as const;
export type Kind = (typeof KINDS)[number];
export const asKind = (v: unknown): Kind => ((KINDS as readonly unknown[]).includes(v) ? (v as Kind) : '상비품');

export type Product = {
  kind: Kind; // 장비운용 분류 (연장 / 상비품 / 자재)
  seq: number;
  key: string; // 자재 번호 (예: p0001). 이미지 파일 이름과 같다 (/catalog/p0001.webp). 설문 응답·엑셀 취합이 이 번호를 쓴다
  category: string;
  sub: string;
  name: string;
  brand: string;
  price: number;
  priceInclVat: number | null;
  vatBasis: string;
  soldout: boolean;
  stock: number; // 회사 재고 수량 (0 = 재고 없음)
  image: string;
  trades: string[];
};

/** 차량 */
/** 차량 아이콘 선택지 (첫 번째가 기본) */
export const VEHICLE_ICONS = ['🚚', '🚛', '🚐', '🛻', '🚗', '🚙', '🚜', '🏗️'] as const;
export const asIcon = (v: unknown): string => ((VEHICLE_ICONS as readonly unknown[]).includes(v) ? (v as string) : VEHICLE_ICONS[0]);

export type Vehicle = { id: string; name: string; nickname: string; icon: string; memo: string; driverId: string; createdAt: string }; // driverId = 배차된 회원(members.id), 없으면 빈 문자열. name = 차량 번호, nickname = 1호차 같은 별칭(없으면 빈 문자열)

/** 차량에 배치된 품목. 연장은 1개씩(note = 일련번호·메모), 상비품은 품목마다 한 줄에 수량을 합친다. */
export type VehicleItem = { id: string; vehicleId: string; key: string; qty: number; note: string; at: string };

/** 등록된 현장 — 자재 요청에서 이 목록 중에서 고른다 */
export type Site = {
  id: string;
  name: string; // 현장명
  address: string; // 현장 주소
  pmId: string; // 담당 PM (members.id), 없으면 빈 문자열
  startDate: string; // 공사 시작일 (YYYY-MM-DD), 없으면 빈 문자열
  endDate: string; // 공사 종료일
  memo: string; // 특이사항
  photos: string[]; // 현장 사진 주소들 (여러 장, 없으면 빈 배열)
  extensions: SiteExtension[]; // 마감일을 바꾼 이력 (연장·단축), 오래된 것부터
  createdAt: string;
};
/** 배치 시간대. 종일 배치는 오전·오후를 같은 현장으로 두 건 넣는다. */
export const SLOTS = ['am', 'pm'] as const; // 하루 근무 시간대 (종일 = 오전+오후)
export const EXTRA_SLOTS = ['ot', 'nt'] as const; // 추가 근무: 야간(오후 5~8시, 0.5일) · 심야(오후 8~10시, 1일)
export type Slot = 'am' | 'pm' | 'ot' | 'nt';
export const ALL_SLOTS: Slot[] = [...SLOTS, ...EXTRA_SLOTS];
export const slotLabel = (s: Slot) => ({ am: '오전', pm: '오후', ot: '야간', nt: '심야' })[s];
/** 야간·심야의 시간 기준 (오전·오후는 따로 시간을 두지 않는다) */
export const slotTime = (s: Slot) => ({ am: '', pm: '', ot: '오후 5~8시', nt: '오후 8~10시' })[s];
/** 출근 일수(공수)로 칠 때의 값: 오전 0.5 · 오후 0.5 · 야간 0.5 · 심야 1 */
export const slotWeight = (s: Slot) => ({ am: 0.5, pm: 0.5, ot: 0.5, nt: 1 })[s];
export const isSlot = (v: unknown): v is Slot => v === 'am' || v === 'pm' || v === 'ot' || v === 'nt';

/** 현장 배치 한 건: 이 날짜(YYYY-MM-DD)의 이 시간대(오전/오후)에 이 회원이 이 현장에 간다. 한 사람은 같은 날 같은 시간대에 한 현장만. */
export type Placement = { date: string; slot: Slot; siteId: string; memberId: string };

/** 현장·날짜별 작업 내용 메모 (예: "방통 주방 방수") */
export type PlacementNote = { date: string; siteId: string; note: string };

/** 휴가 구분: 종일 · 오전 반차 · 오후 반차 */
export type LeaveKind = 'full' | 'am' | 'pm';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';
/** 휴가 신청 한 건. 승인되면 그 날짜의 배치가 빠지고 휴가로 표시된다. */
export type LeaveRequest = {
  id: string;
  memberId: string;
  startDate: string; // 휴가 시작일 (YYYY-MM-DD)
  endDate: string; // 휴가 종료일
  kind: LeaveKind;
  reason: string; // 사유
  status: LeaveStatus;
  createdAt: string;
  decidedAt: string; // 승인·반려한 시각 (대기 중이면 빈 문자열)
  decidedBy: string; // 승인·반려한 사람 이름
  decisionNote: string; // 승인·반려 메모 (반려 사유 등)
};
export type LeaveInput = { memberId: string; startDate: string; endDate: string; kind: LeaveKind; reason: string };

/** 구매관리 품목 상태: 구매 예정 → 주문함 → 구매 완료 */
export type PurchaseStatus = 'want' | 'ordered' | 'done';
/** 배송비: included = 가격에 포함(무료배송 포함) · separate = 따로 낸다(배송비 금액을 적는다) */
export type PurchaseShipping = 'included' | 'separate';

/** 구매하려는 품목 (링크·가격 정리) */
export type PurchaseItem = {
  id: string;
  name: string; // 품목명
  brand: string; // 브랜드 (없으면 빈 문자열)
  url: string; // 구매 링크 (없으면 빈 문자열)
  price: number; // 개당 가격(원)
  qty: number; // 수량
  shipping: PurchaseShipping; // 배송비 포함 여부
  shippingFee: number; // 배송비 별도일 때 배송비(원, 품목당 한 번). 포함이면 0
  memo: string;
  tags: string[]; // 묶어 보기용 태그 (최대 5개)
  status: PurchaseStatus;
  createdBy: string; // 등록한 사람 이름
  createdAt: string;
  updatedAt: string;
};
export type PurchaseInput = { name: string; brand: string; url: string; price: number; qty: number; shipping: PurchaseShipping; shippingFee: number; memo: string; tags: string[]; status: PurchaseStatus };

/** 마감일 변경 한 번: from(바꾸기 전 마감일) → to(새 마감일). to 가 늦으면 연장, 빠르면 단축 */
export type SiteExtension = { from: string; to: string; at: string };
/** 현장 등록·수정 입력 (이름 외에는 모두 선택) */
export type SiteInput = { name: string; address: string; pmId: string; startDate: string; endDate: string; memo: string; photos?: string[] }; // photos: 등록 때는 사진 주소들, 수정 때는 undefined=그대로 · 배열=이 목록으로 바꾸기 (빠진 사진은 정리 대상)

export type VehicleResult<T = object> = ({ ok: true } & T) | { error: string };

export type TrashedProduct = Product & { deletedAt: string };

/** 급여 기준: '' = 자동(주 팀 기준), daily = 일수제(일당), office = 4대보험 사무직 기준 */
export type PayType = '' | 'daily' | 'office';

export type Member = {
  id: string; // 내부 식별자 (응답 집계용). 로그인에는 쓰지 않는다
  name: string;
  role: RoleKey; // 직급 (주 팀)
  extraRole: RoleKey | ''; // 겸직 팀 (사무실 팀과 현장 팀을 함께 가질 때 반대쪽 팀), 없으면 빈 문자열
  payType: PayType; // 급여 기준 (일수제 / 4대보험 사무직 기준), ''면 주 팀에 따라 자동
  trades: string[]; // 설문에 참여하는 회원(현장작업자·현장관리자, 또는 설문 참여를 부여받은 회원)만 1~3개, 나머지는 빈 배열
  handles: string; // 거래처의 취급품목 (자유 입력)
  phone: string; // 연락처
  address: string; // 주소
  categories: string[]; // 설문에서 맡는 카테고리(공정 아래 카테고리) 최대 3개. 비어 있으면 공정 전체
  menus: MenuKey[]; // 직급 기본 메뉴 외에 최고 관리자·개발팀이 추가로 부여한 메뉴 (소모품 / 설문 참여)
  actions: GrantedActions; // 부여받은 메뉴에서 허용된 동작 (예: { catalog: ['delete'] }). 설문 참여에는 없다
  createdAt: string;
  loginId?: string; // 로그인 아이디
  passHash?: string; // 비밀번호는 해시로만 저장 (원문 저장 안 함)
  mustChangePassword: boolean; // 임시 비밀번호 상태 — 첫 로그인 때 새 비밀번호를 정해야 한다
  idChanged: boolean; // 본인이 아이디를 이미 한 번 바꿨는지 (이후엔 최고 관리자·개발팀만 변경 가능)
};

/** 회원 정보 일부만 바꿀 때 쓰는 형태 */
export type MemberPatch = Partial<Omit<Member, 'id' | 'createdAt'>>;

/** 브라우저(관리자·내 정보 화면)로 보내도 되는 형태 — 비밀번호 해시는 절대 포함하지 않는다. */
export type PublicMember = Omit<Member, 'passHash' | 'loginId'> & { loginId: string | null };

/** 현장 자재 요청 한 줄: 요청 당시의 이름·이미지를 같이 저장해 둔다(나중에 자재가 지워져도 요청은 그대로 보인다). */
/** s = 재고가 모자라서 아직 못 채운 수량(없으면 충분했거나 이미 채웠다), f = 입고해서 채운 수량, x = 목록에 없어서 직접 적어 요청한 품목 */
export type RequestItem = { k: string; n: string; i: string; q: number; s?: number; f?: number; x?: boolean };

/** 현장 작업자가 보낸 자재 요청 한 건 */
export type MaterialRequest = {
  id: string; workerId: string | null; name: string; trade: string; site: string; at: string; items: RequestItem[];
  done: boolean; // 준비 완료 처리됐는가
  doneAt: string | null;
  doneBy: string | null; // 완료 처리한 사람 이름
};

export type SurveyPayload = {
  v: 1;
  workerId?: string;
  name: string;
  trade: string;
  at: string;
  items: string[];
  custom: { n: string; m: string }[];
};
