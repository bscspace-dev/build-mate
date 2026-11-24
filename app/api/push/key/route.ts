import { json } from '@/lib/guard';
import { pushPublicKey, pushReady } from '@/lib/push';

// 알림을 켜려면 브라우저에 줄 공개 키 (서버에 키가 없으면 알림 기능이 꺼진 상태)
export async function GET() {
  return json({ ok: true, enabled: pushReady(), key: pushReady() ? pushPublicKey() : '' });
}
