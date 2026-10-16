/**
 * 静态资源复制与 SW 编译（Bun 脚本）
 * bun build 输出 index.js 后，将 HTML / manifest / SW / 样式 / 字典数据复制至 dist
 */
import { mkdir, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const dist = 'dist';
// 仅清理本脚本管理的产物（index.js 由 bun build 在此之前生成，不可删除）
await Promise.all([
  rm(join(dist, 'styles'), { recursive: true, force: true }),
  rm(join(dist, 'assets'), { recursive: true, force: true }),
  rm(join(dist, 'sw.js'), { force: true }),
]);
await mkdir(join(dist, 'styles'), { recursive: true });
await mkdir(join(dist, 'assets'), { recursive: true });

const staticFiles: Array<[string, string]> = [
  ['src/index.html', join(dist, 'index.html')],
  ['src/manifest.webmanifest', join(dist, 'manifest.webmanifest')],
  ['src/styles/m3-theme.css', join(dist, 'styles/m3-theme.css')],
  ['src/styles/typography.css', join(dist, 'styles/typography.css')],
  ['src/assets/icon.svg', join(dist, 'assets/icon.svg')],
  ['src/assets/xtext_core.wasm', join(dist, 'assets/xtext_core.wasm')],
  ['src/assets/dict.bin.gz', join(dist, 'assets/dict.bin.gz')],
];
for (const [from, to] of staticFiles) await copyFile(from, to);

// 编译 Service Worker 为独立产物
await Bun.build({
  entrypoints: ['src/sw.ts'],
  outdir: dist,
  target: 'browser',
  minify: true,
  naming: { entry: '[name].[ext]' },
});

console.log('✓ static assets copied to dist/');
