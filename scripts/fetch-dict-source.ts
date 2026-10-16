/**
 * 从上游原始仓库（Qwert-ly/xtext）下载字典源数据
 * base.json.gz + extra.json.gz → src/assets/
 *
 * 仓库内不提交这两个数据文件（见 .gitignore），本地开发与 CI 构建时按需下载。
 * 用法：bun scripts/fetch-dict-source.ts [--force]
 *   --force  即使文件已存在也重新下载
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const UPSTREAM_RAW = 'https://raw.githubusercontent.com/Qwert-ly/xtext/main/docs';
const ASSETS = 'src/assets';
const FILES = ['base.json.gz', 'extra.json.gz'] as const;

const force = process.argv.includes('--force');

mkdirSync(ASSETS, { recursive: true });

async function download(name: string): Promise<void> {
  const dest = join(ASSETS, name);
  if (!force && existsSync(dest)) {
    console.log(`= ${name} 已存在，跳过（--force 可强制重新下载）`);
    return;
  }
  const url = `${UPSTREAM_RAW}/${name}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = new Uint8Array(await resp.arrayBuffer());
      if (buf.length < 1024) throw new Error(`文件过小: ${buf.length} bytes`);
      writeFileSync(dest, buf);
      console.log(`✓ ${name}: ${(buf.length / 1024 / 1024).toFixed(2)} MB ← ${url}`);
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`  第 ${attempt} 次下载失败: ${err instanceof Error ? err.message : err}`);
      await new Promise(r => setTimeout(r, attempt * 1500));
    }
  }
  throw new Error(`下载 ${name} 失败: ${lastErr}`);
}

for (const f of FILES) await download(f);
console.log('✓ 字典源数据就绪');
