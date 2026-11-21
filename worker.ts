/* eslint-disable */
// @ts-nocheck
// Cloudflare 작업자: OpenNext 가 만든 작업자(.open-next/worker.js)에 '예약 작업(scheduled)'을 더한다.
//  · 평소 요청은 그대로 OpenNext 작업자가 처리한다.
//  · wrangler.jsonc 의 triggers.crons 시각이 되면 scheduled() 가 불려서, 앱 안의 /api/cron/office-auto 를 호출한다
//    (겸직 인원의 빈 시간을 사무실로 자동 배치). CRON_SECRET 은 'wrangler secret put CRON_SECRET' 으로 올린다.
// 이 파일은 빌드(opennextjs-cloudflare build) 뒤에 wrangler 가 묶는다. tsconfig 의 exclude 에 들어 있어서 Next 타입 검사와는 무관하다.
import handler from "./.open-next/worker.js";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

export default {
  fetch: handler.fetch,
  async scheduled(event, env, ctx) {
    const req = new Request("https://cron.internal/api/cron/office-auto", {
      method: "POST",
      headers: { authorization: `Bearer ${env.CRON_SECRET ?? ""}` },
    });
    ctx.waitUntil(
      handler.fetch(req, env, ctx).then(async res => {
        const text = await res.text().catch(() => "");
        if (!res.ok) console.error("office-auto cron failed", res.status, text);
        else console.log("office-auto cron ok", text);
      }),
    );
  },
};
