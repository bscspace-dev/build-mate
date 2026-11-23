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

export type Vehicle = { id: string; name: string; nickname: string; icon: string; memo: string; driverId: string; createdAt: string; photos: VehiclePhoto[] } & VehicleSpec;
/** 차량 현황 사진 한 장: 지금 차량 상태를 사진으로 남긴다 (외관, 계기판, 적재 상태 등). 새 사진이 위로 온다. */
export type VehiclePhoto = { url: string; at: string; by: string; byId: string; note: string };
export const MAX_VEHICLE_PHOTOS = 20; // 차량 한 대에 남기는 사진 수 (넘으면 가장 오래된 것부터 지운다)
/** 차량 소유 형태: 소유 · 리스 · 장기렌트 (모르면 빈 값) */
export type VehicleOwnership = '' | 'owned' | 'lease' | 'rent';
/** 차량 관리 정보 (소유 차량 관리 표): 차종·연식·차대번호·소유 형태·주행거리·엔진오일 관리·검사일. memo 는 비고. */
export type VehicleSpec = {
  model: string; // 차종 (예: 포터, 봉고, K3)
  year: string; // 연식 (예: 2017, 2022/11)
  vin: string; // 차대번호
  ownership: VehicleOwnership;
  mileage: number; // 현재 주행거리(km), 모르면 0
  oilDate: string; // 엔진오일 마지막 교환일 (YYYY-MM-DD), 없으면 빈 문자열
  oilKm: number; // 마지막 교환 때 주행거리(km), 모르면 0
  inspectionDate: string; // 차량 검사 만료·예정일 (YYYY-MM-DD), 없으면 빈 문자열
  insurer: string; // 보험사
  policyNo: string; // 증권번호
  insuranceExpiry: string; // 보험 만기일 (YYYY-MM-DD), 없으면 빈 문자열
  premium: number; // 연 보험료(원), 모르면 0
  insurancePhone: string; // 보험 연락처 (담당자·긴급출동)
  insuranceNote: string; // 보험 특이사항 (운전자 범위, 특약 등)
};
export const EMPTY_SPEC: VehicleSpec = { model: '', year: '', vin: '', ownership: '', mileage: 0, oilDate: '', oilKm: 0, inspectionDate: '', insurer: '', policyNo: '', insuranceExpiry: '', premium: 0, insurancePhone: '', insuranceNote: '' }; // driverId = 배차된 회원(members.id), 없으면 빈 문자열. name = 차량 번호, nickname = 1호차 같은 별칭(없으면 빈 문자열)

/** 적재 패키지: 자주 싣는 연장·상비품 묶음. 차량에 한 번에 적재한다. */
export type LoadPackageItem = { key: string; qty: number };
export type LoadPackage = { id: string; name: string; items: LoadPackageItem[]; createdAt: string };
export type LoadPackageInput = { name: string; items: LoadPackageItem[] };

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

/** 경비 분류: 식사 · 음료 · 자재구매 · 유류비 · 주차·통행 · 공구·소모품 · 기타 */
export type ExpenseCategory = 'meal' | 'drink' | 'materials' | 'fuel' | 'parking' | 'supplies' | 'other';
/** 올리는 서류: 영수증 · 세금계산서 · 구매요청(인터넷으로 사야 하는 비품을 구매해 달라고 요청) */
export type ExpenseDoc = 'receipt' | 'invoice' | 'request';
/** 진행 상태: 구매요청은 구매 대기 → 구매 완료(담당자가 구매하고 영수증 사진을 올림), 세금계산서는 입금 요청 → 구매 완료(담당자가 입금하고 확인). 영수증은 언제나 완료. */
export type ExpenseStatus = 'requested' | 'done';
/** 결제수단: 카드 · 현금 · 계좌이체 */
export type ExpensePay = 'card' | 'cash' | 'transfer';
/** 현장에서 쓴 경비 서류(영수증·세금계산서) 한 건. 사무실 경리가 이걸 보고 엑셀로 정리한다. */
export type Expense = {
  id: string;
  date: string; // 쓴 날짜 (YYYY-MM-DD)
  site: string; // 현장 이름
  category: ExpenseCategory;
  amount: number; // 금액(원)
  memo: string; // 무엇에 썼는지
  docType: ExpenseDoc; // 영수증 / 세금계산서
  vendor: string; // 상호·거래처 (가게 이름, 세금계산서를 준 업체)
  payMethod: ExpensePay; // 결제수단
  photos: string[]; // 서류 사진 주소들
  memberId: string; // 올린 회원
  memberName: string;
  createdAt: string;
  booked: boolean; // 경리가 장부·엑셀에 정리했는가
  bookedBy: string; // 정리한 사람 이름
  bookedAt: string; // 정리한 시각
  purchaseId: string; // 예전 구매관리 메뉴에서 넘어온 건의 옛 번호 (이제 쓰지 않는다)
  status: ExpenseStatus; // 구매요청이면 대기·완료, 그 밖에는 언제나 done
  link: string; // 구매요청의 구매 링크 (없으면 빈 문자열)
  account: string; // 세금계산서의 입금할 계좌번호 (없으면 빈 문자열)
};
export type ExpenseInput = { date: string; site: string; category: ExpenseCategory; amount: number; memo: string; docType: ExpenseDoc; vendor: string; payMethod: ExpensePay; photos: string[]; booked: boolean; bookedBy: string; bookedAt: string; purchaseId: string; status: ExpenseStatus; link: string; account: string };

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
