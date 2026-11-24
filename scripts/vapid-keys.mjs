// 웹 푸시(VAPID) 키를 한 쌍 만든다. 출력된 두 줄을 .env.local (배포할 때는 서버 환경변수)에 넣으세요.
//   node scripts/vapid-keys.mjs
import { webcrypto as c } from 'node:crypto';
const b64u = b => Buffer.from(b).toString('base64url');
const pair = await c.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = new Uint8Array(await c.subtle.exportKey('raw', pair.publicKey));
const jwk = await c.subtle.exportKey('jwk', pair.privateKey);
console.log('VAPID_PUBLIC_KEY=' + b64u(pub));
console.log('VAPID_PRIVATE_KEY=' + jwk.d);
