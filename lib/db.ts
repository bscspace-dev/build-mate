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
export const addTrade = (name: string) => impl().addTrade(name);
export const setSubs = (entries: { key: string; sub: string }[]) => impl().setSubs(entries);
export const reorderTrades = (order: string[]) => impl().reorderTrades(order);
export const removeTrade = (name: string) => impl().removeTrade(name);
export const deleteProducts = (keys: string[]) => impl().deleteProducts(keys);
export const restoreProducts = (keys: string[]) => impl().restoreProducts(keys);
export const purgeProducts = (keys: string[]) => impl().purgeProducts(keys);
export const nextProductKey = () => impl().nextProductKey();
export const addProduct = (p: Parameters<typeof file.addProduct>[0]) => impl().addProduct(p);
export const takeStock = (lines: { k: string; q: number }[]) => impl().takeStock(lines);
export const returnStock = (took: Record<string, number>) => impl().returnStock(took);
export const setStock = (key: string, stock: number) => impl().setStock(key, stock);
export const renameProduct = (key: string, name: string) => impl().renameProduct(key, name);
export const updateProduct = (key: string, e: Parameters<typeof file.updateProduct>[1]) => impl().updateProduct(key, e);
export const saveCategoryOrder = (order: string[]) => impl().saveCategoryOrder(order);
export const reorderProducts = (keys: string[]) => impl().reorderProducts(keys);
export const swapProducts = (a: string, b: string) => impl().swapProducts(a, b);
export const saveRequest = (r: Parameters<typeof file.saveRequest>[0]) => impl().saveRequest(r);
export const getRequests = () => impl().getRequests();
export const completeRequest = (id: string, by: string) => impl().completeRequest(id, by);
export const fillRequestItem = (id: string, k: string, received: number) => impl().fillRequestItem(id, k, received);
export const getCategories = () => impl().getCategories();
export const addCategory = (name: string, trade = '') => impl().addCategory(name, trade);
export const getCategoryTrades = () => impl().getCategoryTrades();
export const setCategoryTrade = (name: string, trade: string) => impl().setCategoryTrade(name, trade);
export const renameCategory = (from: string, to: string) => impl().renameCategory(from, to);
export const removeCategory = (name: string) => impl().removeCategory(name);
export const setKind = (keys: string[], kind: import('./types').Kind) => impl().setKind(keys, kind);
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
export const getVehicles = () => impl().getVehicles();
export const getVehicleItems = () => impl().getVehicleItems();
export const addVehicle = (name: string, nickname: string, icon: string, memo: string, driverId: string) => impl().addVehicle(name, nickname, icon, memo, driverId);
export const updateVehicle = (id: string, name: string, nickname: string, icon: string, memo: string, driverId: string) => impl().updateVehicle(id, name, nickname, icon, memo, driverId);
export const removeVehicle = (id: string) => impl().removeVehicle(id);
export const assignItem = (vehicleId: string, key: string, qty: number, note: string) => impl().assignItem(vehicleId, key, qty, note);
export const returnItem = (itemId: string, qty: number) => impl().returnItem(itemId, qty);
export const getMenuOrder = () => impl().getMenuOrder();
export const saveMenuOrder = (order: string[]) => impl().saveMenuOrder(order);
export const getSites = () => impl().getSites();
export const addSite = (i: import('./types').SiteInput) => impl().addSite(i);
export const updateSite = (id: string, i: import('./types').SiteInput) => impl().updateSite(id, i);
export const removeSite = (id: string) => impl().removeSite(id);
export const getPlacements = (from: string, to: string) => impl().getPlacements(from, to);
export const assignPlacements = (date: string, siteId: string, memberIds: string[], slots: import('./types').Slot[]) => impl().assignPlacements(date, siteId, memberIds, slots);
export const removePlacement = (date: string, memberId: string, slots: import('./types').Slot[]) => impl().removePlacement(date, memberId, slots);
export const copyPlacements = (fromDate: string, toDate: string, allow: { sites: string[]; members: string[] }) => impl().copyPlacements(fromDate, toDate, allow);
export const getPlacementNotes = (from: string, to: string) => impl().getPlacementNotes(from, to);
export const setPlacementNote = (date: string, siteId: string, note: string) => impl().setPlacementNote(date, siteId, note);
export const getAttendanceCycles = () => impl().getAttendanceCycles();
export const saveAttendanceCycles = (list: import('./attendance-cycle').CycleEntry[]) => impl().saveAttendanceCycles(list);
export const getLeaves = () => impl().getLeaves();
export const addLeave = (i: import('./types').LeaveInput) => impl().addLeave(i);
export const cancelLeave = (id: string, memberId: string) => impl().cancelLeave(id, memberId);
export const decideLeave = (id: string, status: 'approved' | 'rejected', by: string, note: string) => impl().decideLeave(id, status, by, note);
export const removePlacementsRange = (memberId: string, from: string, to: string, slots: import('./types').Slot[]) => impl().removePlacementsRange(memberId, from, to, slots);
export const getAnnualLeave = () => impl().getAnnualLeave();
export const setAnnualLeave = (year: number, memberId: string, days: number | null) => impl().setAnnualLeave(year, memberId, days);
export const getPurchases = () => impl().getPurchases();
export const addPurchase = (i: import('./types').PurchaseInput, by: string) => impl().addPurchase(i, by);
export const updatePurchase = (id: string, i: import('./types').PurchaseInput) => impl().updatePurchase(id, i);
export const removePurchase = (id: string) => impl().removePurchase(id);
