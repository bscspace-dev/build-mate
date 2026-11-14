import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// 서버 전용 Supabase 클라이언트. 비밀 키(service_role / secret)를 쓰므로 절대 브라우저로 보내지 않는다.
// (server-only 를 import 해서, 클라이언트 컴포넌트가 실수로 가져오면 빌드가 실패한다.)
let client: SupabaseClient | null = null;

/** /rest/v1/ 같은 꼬리가 붙은 주소도 프로젝트 주소로 정리한다. 형식이 틀리면 null. */
export function normalizeSupabaseUrl(raw: string | undefined): string | null {
  try {
    const u = new URL((raw ?? '').trim());
    return u.protocol === 'https:' && /^[a-z0-9-]+\.supabase\.co$/.test(u.hostname) ? u.origin : null;
  } catch {
    return null;
  }
}

export function supabase(): SupabaseClient {
  if (client) return client;
  const url = normalizeSupabaseUrl(process.env.SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL(형식 https://xxxx.supabase.co) / SUPABASE_SERVICE_ROLE_KEY 가 .env.local 에 없거나 형식이 달라요.');
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export const supabaseConfigured = () => Boolean(normalizeSupabaseUrl(process.env.SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY);
