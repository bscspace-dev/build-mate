import { getActor } from '@/lib/auth';
import { json } from '@/lib/guard';
import { normalizeSupabaseUrl, supabase } from '@/lib/supabase';

// 관리자 전용: Supabase 설정이 제대로 들어갔는지 확인한다 (브라우저에서 로그인한 채로 주소를 열면 된다).
// 키 값은 응답에 절대 담지 않는다. 종류(서버용 비밀 키인지)와 연결·테이블 상태만 알려준다.
const TABLES = ['products', 'categories', 'teams', 'members', 'responses', 'app_settings'] as const;

function keyProblem(key: string | undefined): string | null {
  if (!key) return 'SUPABASE_SERVICE_ROLE_KEY 가 비어 있어요. .env.local 에 서버용 비밀 키를 넣고 서버를 다시 시작하세요.';
  if (key.startsWith('sb_publishable_')) return '공개용(publishable) 키예요. 서버용 비밀(secret) 키를 넣어 주세요.';
  if (key.startsWith('sb_secret_')) return null;
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const role = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role;
      if (role === 'service_role') return null;
      if (role === 'anon') return '공개용(anon) 키예요. 서버용 service_role 키를 넣어 주세요.';
    } catch {}
  }
  return '키 형식을 알 수 없어요. service_role 또는 sb_secret_ 으로 시작하는 서버용 키가 맞는지 확인해 주세요.';
}

export async function GET() {
  if (!(await getActor('members'))) return json({ error: '회원 관리 메뉴 권한이 필요해요.' }, 401);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const cleanUrl = normalizeSupabaseUrl(url);
  const urlOk = cleanUrl !== null;
  const problem = keyProblem(key);
  const result: {
    dataStore: 'file' | 'supabase';
    url: { set: boolean; valid: boolean; host: string | null };
    key: { set: boolean; ok: boolean; problem: string | null };
    connection: 'ok' | 'failed' | 'skipped';
    tables: Record<string, { status: 'ok' | 'missing' | 'error'; rows?: number; message?: string }>;
    ready: boolean;
    next: string;
  } = {
    dataStore: process.env.DATA_STORE === 'supabase' ? 'supabase' : 'file',
    url: { set: !!url, valid: urlOk, host: cleanUrl ? new URL(cleanUrl).host : null },
    key: { set: !!key, ok: problem === null, problem },
    connection: 'skipped',
    tables: {},
    ready: false,
    next: '',
  };

  if (!urlOk) result.next = 'SUPABASE_URL 을 https://<프로젝트>.supabase.co 형식으로 .env.local 에 넣어 주세요.';
  else if (problem) result.next = problem;
  else {
    try {
      const db = supabase();
      let reached = false;
      for (const t of TABLES) {
        const { count, error } = await db.from(t).select('*', { count: 'exact', head: true });
        if (!error) {
          reached = true;
          result.tables[t] = { status: 'ok', rows: count ?? 0 };
        } else if (error.code === 'PGRST205' || error.code === '42P01') {
          reached = true; // 서버에는 도달했고 테이블만 없는 것
          result.tables[t] = { status: 'missing' };
        } else {
          result.tables[t] = { status: 'error', message: error.message.slice(0, 160) };
        }
      }
      result.connection = reached ? 'ok' : 'failed';
    } catch (e) {
      result.connection = 'failed';
      result.next = e instanceof Error ? e.message.slice(0, 160) : '연결에 실패했어요.';
    }
    const states = Object.values(result.tables);
    const allOk = states.length === TABLES.length && states.every(s => s.status === 'ok');
    result.ready = result.connection === 'ok' && allOk;
    if (!result.next) {
      if (result.connection === 'failed') result.next = '연결에 실패했어요. 주소와 키가 같은 프로젝트의 것인지 확인해 주세요.';
      else if (states.some(s => s.status === 'missing')) result.next = 'Supabase SQL Editor 에서 supabase/schema.sql 을 실행해 테이블을 만들어 주세요.';
      else if (!allOk) result.next = '일부 테이블 조회에 오류가 있어요. tables 항목의 message 를 확인해 주세요.';
      else if (result.dataStore === 'file') result.next = '연결 정상. npm run supabase:migrate 로 데이터를 옮긴 뒤 DATA_STORE=supabase 로 바꾸세요.';
      else result.next = '연결 정상, Supabase 저장소를 쓰는 중이에요.';
    }
  }
  return json(result);
}
