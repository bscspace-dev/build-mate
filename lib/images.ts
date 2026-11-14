import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';

const CATALOG_DIR = path.join(process.cwd(), 'public', 'catalog');

/** 이미지 파일 삭제. public/catalog 안의 파일만 지운다 (경로 조작 방지). */
export async function removeImage(image: string): Promise<void> {
  if (!image.startsWith('/catalog/')) return;
  const file = path.resolve(process.cwd(), 'public', image.slice(1));
  if (!file.startsWith(CATALOG_DIR + path.sep)) return;
  await fs.rm(file, { force: true });
}
