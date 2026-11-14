import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import { supabase } from './supabase';

// 소모품 이미지 저장소
//  · 기존 이미지: public/catalog/ 안의 파일 (image 값이 '/catalog/p0001.webp')
//  · Supabase 로 운영할 때 새로 올리는 이미지: Storage 의 'catalog' 버킷 (image 값이 공개 주소 전체)
//    — Cloudflare 같은 서버는 파일을 쓸 수 없어서 Storage 를 쓴다.
//  · 파일 방식(DATA_STORE 가 supabase 가 아닐 때)에서는 public/catalog/ 에 그대로 저장한다.
const CATALOG_DIR = path.join(process.cwd(), 'public', 'catalog');
const BUCKET = 'catalog';
const STORAGE_MARK = `/storage/v1/object/public/${BUCKET}/`;
const inStorageMode = () => process.env.DATA_STORE === 'supabase';

async function ensureBucket(): Promise<void> {
  const { error } = await supabase().storage.createBucket(BUCKET, { public: true });
  if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(`이미지 저장소를 준비하지 못했어요: ${error.message}`);
}

/** 이미지를 저장하고 화면에서 쓸 주소(image 값)를 돌려준다. bytes 는 webp 로 변환된 이미지. */
export async function saveImage(key: string, bytes: Uint8Array, contentType: string): Promise<string> {
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/jpeg' ? 'jpg' : 'webp';
  if (!inStorageMode()) {
    await fs.mkdir(CATALOG_DIR, { recursive: true });
    await fs.writeFile(path.join(CATALOG_DIR, `${key}.${ext}`), bytes);
    return `/catalog/${key}.${ext}`;
  }
  await ensureBucket();
  const file = `${key}-${Date.now().toString(36)}.${ext}`; // 주소가 바뀌어야 캐시된 옛 그림이 안 보인다
  const { error } = await supabase().storage.from(BUCKET).upload(file, bytes, { contentType, upsert: false });
  if (error) throw new Error(`이미지를 올리지 못했어요: ${error.message}`);
  return supabase().storage.from(BUCKET).getPublicUrl(file).data.publicUrl;
}

/** 이미지 파일 삭제. public/catalog 안의 파일과 Storage 'catalog' 버킷의 파일만 지운다 (경로 조작 방지). */
export async function removeImage(image: string): Promise<void> {
  if (image.startsWith('/catalog/')) {
    const file = path.resolve(process.cwd(), 'public', image.slice(1));
    if (!file.startsWith(CATALOG_DIR + path.sep)) return;
    try {
      await fs.rm(file, { force: true });
    } catch {
      // Cloudflare 같은 읽기 전용 서버에서는 파일을 지울 수 없다 — 이미지는 남겨 두고 넘어간다
    }
    return;
  }
  const i = image.indexOf(STORAGE_MARK);
  if (i < 0 || !inStorageMode()) return;
  const name = decodeURIComponent(image.slice(i + STORAGE_MARK.length));
  if (!name || name.includes('/') || name.includes('..')) return;
  await supabase().storage.from(BUCKET).remove([name]);
}
