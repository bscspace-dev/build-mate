import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// 캐시 설정은 기본값(캐시 없음)으로 둔다. 데이터는 Supabase 에서 요청마다 읽는다.
export default defineCloudflareConfig();
