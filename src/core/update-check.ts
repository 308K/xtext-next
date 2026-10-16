/**
 * 应用更新检测
 *
 * build-static.ts 构建时计算关键产物哈希,注入 <meta name="build-id"> 并写出
 * dist/version.json(SW 对 version.json 直通不拦截)。运行时定期以 no-store
 * 拉取 version.json,与实际加载页面中的 build-id 比对:不一致说明站点已重新
 * 部署,回调通知 UI 提示刷新。刷新时清理 SW 外壳/静态缓存(保留字库缓存)。
 */

const CHECK_URL = 'version.json';
const BUILD_ID_META = 'build-id';
const FIRST_CHECK_DELAY_MS = 5000;
const VISIBILITY_THROTTLE_MS = 5 * 60 * 1000;
const PERIODIC_INTERVAL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

let started = false;
let finished = false;
let lastCheckAt = 0;

/** 运行中页面的构建指纹(构建时注入的 meta;本地开发为 "dev") */
function runningBuildId(): string {
  return document.querySelector<HTMLMetaElement>(`meta[name="${BUILD_ID_META}"]`)?.content ?? '';
}

async function checkOnce(onUpdate: () => void): Promise<void> {
  if (finished) return;
  lastCheckAt = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const resp = await fetch(CHECK_URL, { cache: 'no-store', signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return;
    const data = (await resp.json()) as { build?: unknown };
    const current = runningBuildId();
    if (typeof data.build === 'string' && data.build && current && data.build !== current) {
      finished = true;
      onUpdate();
    }
  } catch {
    // 离线、或本地开发无 version.json(SPA fallback 返回 HTML)——静默跳过
  }
}

/** 启动更新检测:载入后 5s 首查,回到前台(≥5min 节流)与每 30min 定期复查 */
export function startUpdateCheck(onUpdateAvailable: () => void): void {
  if (started) return;
  const id = runningBuildId();
  if (!id || id === 'dev') return;
  started = true;

  setTimeout(() => void checkOnce(onUpdateAvailable), FIRST_CHECK_DELAY_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !finished
        && Date.now() - lastCheckAt >= VISIBILITY_THROTTLE_MS) {
      void checkOnce(onUpdateAvailable);
    }
  });
  window.setInterval(() => void checkOnce(onUpdateAvailable), PERIODIC_INTERVAL_MS);
}

/**
 * 立即更新:触发 SW 自查更新,在线时清理外壳/静态缓存后整页刷新。
 * pboc-dict* 字库缓存保留——由应用层 ETag 条件请求自行增量更新。
 */
export async function applyUpdate(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      void reg?.update().catch(() => {});
    }
    if (navigator.onLine) {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(k => k.startsWith('pboc-') && !k.startsWith('pboc-dict'))
          .map(k => caches.delete(k)),
      );
    }
  } catch {
    // 缓存清理失败不阻塞刷新(SWR 会在后续加载中逐步自愈)
  }
  window.location.reload();
}
