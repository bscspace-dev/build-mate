import 'server-only';
import * as file from './db-file';
import * as sb from './db-supabase';

// 저장소 선택: .env.local 의 DATA_STORE=supabase 이면 Supabase, 아니면(기본) data/*.json 파일.
// 데이터를 Supabase 로 옮기고 검증한 뒤에 supabase 로 바꾼다 (npm run supabase:migrate).
// 나머지 코드는 이 파일만 import 하므로 저장소가 바뀌어도 그대로 동작한다.
// 회원 규칙(권한·검사)은 lib/members.ts 에 있고, 여기는 저장·조회 기본 동작만 둔다.
const impl = () => (process.env.DATA_STORE === 'supabase' ? sb : file);

export const getProducts = () => impl().getProducts();
export const getTrash = () => impl().getTrash();
export const getTrades = () => impl().getTrades();
export const deleteProducts = (keys: string[]) => impl().deleteProducts(keys);
export const restoreProducts = (keys: string[]) => impl().restoreProducts(keys);
export const purgeProducts = (keys: string[]) => impl().purgeProducts(keys);
export const renameProduct = (key: string, name: string) => impl().renameProduct(key, name);
export const saveCategoryOrder = (order: string[]) => impl().saveCategoryOrder(order);
export const swapProducts = (a: string, b: string) => impl().swapProducts(a, b);
export const getCategories = () => impl().getCategories();
export const addCategory = (name: string, trade = '') => impl().addCategory(name, trade);
export const getCategoryTrades = () => impl().getCategoryTrades();
export const setCategoryTrade = (name: string, trade: string) => impl().setCategoryTrade(name, trade);
export const renameCategory = (from: string, to: string) => impl().renameCategory(from, to);
export const removeCategory = (name: string) => impl().removeCategory(name);
export const moveProducts = (keys: string[], category: string) => impl().moveProducts(keys, category);
export const saveResponse: typeof file.saveResponse = payload => impl().saveResponse(payload);
export const countResponses = () => impl().countResponses();
export const getSubmissions = () => impl().getSubmissions();

export const getMembers = () => impl().getMembers();
export const getMember = (id: string) => impl().getMember(id);
export const getMemberByLoginId = (loginId: string) => impl().getMemberByLoginId(loginId);
export const insertMember: typeof file.insertMember = m => impl().insertMember(m);
export const patchMember: typeof file.patchMember = (id, patch) => impl().patchMember(id, patch);
export const removeMember = (id: string) => impl().removeMember(id);

export const getTeams = () => impl().getTeams();
export const insertTeam: typeof file.insertTeam = t => impl().insertTeam(t);
export const removeTeam = (key: string) => impl().removeTeam(key);
