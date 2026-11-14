// scripts/ 의 Supabase 관련 스크립트가 같이 쓰는 도우미: .env.local 읽기 + 키 종류 검사.
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

export const root = path.resolve(import.meta.dirname, '..');

export function loadEnv() {
  const file = path.join(root, '.env.local');
  const env = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

/** 서버용 비밀 키인지 확인한다. 공개(anon/publishable) 키면 이유를 돌려준다. 키 값은 절대 출력하지 않는다. */
export function keyProblem(key) {
  if (!key) return 'SUPABASE_SERVICE_ROLE_KEY 가 비어 있어요.';
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

/** .env.local 에 /rest/v1/ 같은 꼬리가 붙은 주소를 넣어도 프로젝트 주소(https://xxxx.supabase.co)로 정리한다. 형식이 틀리면 null. */
export function normalizeUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    return u.protocol === 'https:' && /^[a-z0-9-]+\.supabase\.co$/.test(u.hostname) ? u.origin : null;
  } catch {
    return null;
  }
}

export function connect({ quiet = false } = {}) {
  const env = loadEnv();
  const url = normalizeUrl(env.SUPABASE_URL ?? '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const fail = msg => {
    console.error('✗ ' + msg);
    process.exit(1);
  };
  if (!env.SUPABASE_URL) fail('.env.local 에 SUPABASE_URL 을 먼저 넣어 주세요.');
  if (!url) fail('SUPABASE_URL 형식이 달라요. 예: https://abcdefgh.supabase.co');
  if (!key) fail('.env.local 의 SUPABASE_SERVICE_ROLE_KEY 가 비어 있어요. 서버용 비밀 키를 넣어 주세요.');
  const problem = keyProblem(key);
  if (problem) fail(problem);
  if (!quiet) console.log('✓ 환경 변수 확인 (URL 형식, 서버용 비밀 키)');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const TABLES = ['products', 'categories', 'teams', 'members', 'responses', 'app_settings'];
