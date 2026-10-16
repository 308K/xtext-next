/**
 * dict.bin 编码器 —— 把 base.json.gz + extra.json.gz 打包为紧凑二进制字库
 * 布局与 moonbit/xtext_core/dict.mbt 中定义的格式严格一致。
 *
 * 用法：bun scripts/encode-dict.ts
 * 输入：src/assets/base.json.gz / extra.json.gz（由 scripts/fetch-dict-source.ts 从上游仓库下载）
 * 输出：src/assets/dict.bin + dict.bin.gz
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

interface RawBase { z?: string; y?: string; p?: string; a?: string; s?: number; q?: number }
interface RawExtra { c?: string; m?: string; d?: [string, string[]]; e?: string; n?: string }

const base = JSON.parse(gunzipSync(readFileSync('src/assets/base.json.gz')).toString()) as RawBase[];
const extra = JSON.parse(gunzipSync(readFileSync('src/assets/extra.json.gz')).toString()) as RawExtra[];

if (base.length !== extra.length) throw new Error(`条目数不一致: ${base.length} vs ${extra.length}`);

const ABSENT = 0xffff;
const HEADER_SIZE = 32;
const RECORD_SIZE = 56;

// ── 字符串池构建 ────────────────────────────────────────────────
const pool = Buffer.alloc(64 * 1024 * 1024); // 64MB 上限
let poolLen = 0;
const poolMap = new Map<string, number>();

function intern(s: string | undefined): [number, number] {
  if (!s) return [0, ABSENT];
  const existing = poolMap.get(s);
  if (existing !== undefined) return [existing, Buffer.byteLength(s, 'utf8')];
  const bytes = Buffer.from(s, 'utf8');
  if (poolLen + bytes.length > pool.length) throw new Error('pool overflow');
  bytes.copy(pool, poolLen);
  const off = poolLen;
  poolMap.set(s, off);
  poolLen += bytes.length;
  return [off, bytes.length];
}

/** 释义 d → 多行文本：首行说明（可空），其后每行一个义项 */
function encodeMeanings(d?: [string, string[]]): string | undefined {
  if (!d || !d[1] || !d[1].length) return undefined;
  const lines: string[] = [];
  lines.push(d[0] ?? '');
  for (const m of d[1]) lines.push(m);
  return lines.join('\n');
}

// ── 记录装配（按 z 码点升序排序，保证二分查找正确） ─────────────
interface Rec {
  z: string; y?: string; p?: string; a?: string; c?: string; m?: string;
  e?: string; n?: string; d?: string; s: boolean; q: boolean;
}

const recs: Rec[] = base.map((b, i) => {
  const x = extra[i] ?? {};
  const z = b.z ?? '';
  if (!z) throw new Error(`第 ${i} 条缺 z 字段`);
  return {
    z,
    y: b.y, p: b.p, a: b.a,
    c: x.c, m: x.m,
    e: x.e, n: x.n,
    d: encodeMeanings(x.d),
    s: b.s === 1, q: b.q === 1,
  };
});

// 按 z 的首个码点升序（同码点保持原顺序——stable sort）
const sorted = recs
  .map((r, idx) => ({ r, idx, cp: r.z.codePointAt(0)! }))
  .sort((a, b) => a.cp - b.cp || a.idx - b.idx)
  .map(x => x.r);

// ── 序列化 ──────────────────────────────────────────────────────
const recordTableSize = sorted.length * RECORD_SIZE;
const tableOffset = HEADER_SIZE;
const poolOffset = HEADER_SIZE + recordTableSize;

const out = Buffer.alloc(HEADER_SIZE + recordTableSize + pool.length);

// Header
out.write('XTEXT\0', 0, 'ascii');
out.writeUInt8(1, 6);
out.writeBigUInt64LE(BigInt(sorted.length), 8);
out.writeBigUInt64LE(BigInt(tableOffset), 16);
out.writeBigUInt64LE(BigInt(poolOffset), 24);

for (let i = 0; i < sorted.length; i++) {
  const r = sorted[i];
  const addr = tableOffset + i * RECORD_SIZE;
  const w = (off: number, len: number, field: 'u32' | 'u16', at: number) => {
    if (field === 'u32') out.writeUInt32LE(off, addr + at);
    else out.writeUInt16LE(len, addr + at);
  };
  const [zOff, zLen] = intern(r.z);   w(zOff, zLen, 'u32', 0); w(zOff, zLen, 'u16', 4);
  const [yOff, yLen] = intern(r.y);   w(yOff, yLen, 'u32', 6); w(yOff, yLen, 'u16', 10);
  const [pOff, pLen] = intern(r.p);   w(pOff, pLen, 'u32', 12); w(pOff, pLen, 'u16', 16);
  const [aOff, aLen] = intern(r.a);   w(aOff, aLen, 'u32', 18); w(aOff, aLen, 'u16', 22);
  const [cOff, cLen] = intern(r.c);   w(cOff, cLen, 'u32', 24); w(cOff, cLen, 'u16', 28);
  const [mOff, mLen] = intern(r.m);   w(mOff, mLen, 'u32', 30); w(mOff, mLen, 'u16', 34);
  const [eOff, eLen] = intern(r.e);   w(eOff, eLen, 'u32', 36); w(eOff, eLen, 'u16', 40);
  const [nOff, nLen] = intern(r.n);   w(nOff, nLen, 'u32', 42); w(nOff, nLen, 'u16', 46);
  const [dOff, dLen] = intern(r.d);   w(dOff, dLen, 'u32', 48); w(dOff, dLen, 'u16', 52);
  let flags = 0;
  if (r.s) flags |= 1;
  if (r.q) flags |= 2;
  out.writeUInt8(flags, addr + 54);
}

pool.copy(out, poolOffset, 0, poolLen);
const final = out.subarray(0, poolOffset + poolLen);
writeFileSync('src/assets/dict.bin', final);

// 运行时产物：DecompressionStream('gzip') 解压后加载
const gz = gzipSync(final, { level: 9 });
writeFileSync('src/assets/dict.bin.gz', gz);

console.log(`✓ dict.bin: ${sorted.length} 记录, ${(final.length / 1024 / 1024).toFixed(2)} MB (pool ${(poolLen / 1024 / 1024).toFixed(2)} MB)`);
console.log(`✓ dict.bin.gz: ${(gz.length / 1024 / 1024).toFixed(2)} MB`);
