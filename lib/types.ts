import type { GrantedActions, MenuKey, RoleKey } from './roles';

export type Product = {
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
  image: string;
  trades: string[];
};

export type TrashedProduct = Product & { deletedAt: string };

export type Member = {
  id: string; // 내부 식별자 (응답 집계용). 로그인에는 쓰지 않는다
  name: string;
  role: RoleKey; // 직급
  trades: string[]; // 설문에 참여하는 회원(현장작업자·현장관리자, 또는 설문 참여를 부여받은 회원)만 1~3개, 나머지는 빈 배열
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

export type SurveyPayload = {
  v: 1;
  workerId?: string;
  name: string;
  trade: string;
  at: string;
  items: string[];
  custom: { n: string; m: string }[];
};
