import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';

const CATALOG_DIR = path.join(process.cwd(), 'public', 'catalog');

/** 이미지 파일 삭제. public/catalog 안의 파일만 지운다 (경로 조작 방지). */
export async function removeImage(image: string): Promise<void> {
  if (!image.startsWith('/catalog/')) return;
  const file = path.resolve(process.cwd(), 'public', image.slice(1));
  if (!file.startsWith(CATALOG_DIR + path.sep)) return;
  try {
    await fs.rm(file, { force: true });
  } catch {
    // Cloudflare 같은 읽기 전용 서버에서는 파일을 지울 수 없다 — 이미지는 남겨 두고 넘어간다
  }
}
