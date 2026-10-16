/**
 * 字典加载器 —— 与原 script.js fetchGzJson 行为一致
 * - Cache Storage（pboc-dict-v1）优先，后台 ETag/Last-Modified 条件请求刷新
 * - gzip 流式解压 + 加载进度回调
 */
import { DICT_URLS, type DictItem } from './dict-engine';

const DICT_CACHE = 'pboc-dict-v1';
const supportsGzipStreams = 'DecompressionStream' in window;

export interface FetchResult {
  data: DictItem[];
  fromCache: boolean;
  updatedAt: number | null;
}

export function responseBodyIsAlreadyDecoded(response: Response): boolean {
  const encoding = response.headers.get('content-encoding');
  return !!encoding && encoding.toLowerCase() !== 'identity';
}

async function streamAndParseJson(
  response: Response,
  progressCallback?: (loaded: number, total: number) => void,
  { compressed = false } = {},
): Promise<DictItem[]> {
  const contentLength = response.headers.get('content-length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;
  let loaded = 0;

  if (compressed && !supportsGzipStreams) {
    throw new Error('此瀏覽器不支持DecompressionStream，無法直接讀取.json.gz。需要Chrome 80+/Firefox 113+/Safari 16.4+');
  }

  const progressStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      loaded += chunk.byteLength;
      progressCallback?.(loaded, total);
      controller.enqueue(chunk);
    },
  });

  let stream: ReadableStream<any> = response.body!.pipeThrough(progressStream);
  if (compressed) {
    stream = stream.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair);
  }
  return JSON.parse(await new Response(stream).text());
}

function responseUpdatedAt(response: Response): number | null {
  const lastModified = response?.headers.get('last-modified');
  if (!lastModified) return null;
  const ts = Date.parse(lastModified);
  return Number.isNaN(ts) ? null : ts;
}

function sameCachedPayload(cachedResp: Response, netResp: Response): boolean {
  const etag = cachedResp.headers.get('ETag');
  const newEtag = netResp.headers.get('ETag');
  if (etag && newEtag) return etag === newEtag;
  const lastMod = cachedResp.headers.get('Last-Modified');
  const newLastMod = netResp.headers.get('Last-Modified');
  if (lastMod && newLastMod) return lastMod === newLastMod;
  if (etag || newEtag || lastMod || newLastMod) return false;
  const oldLen = cachedResp.headers.get('Content-Length');
  const newLen = netResp.headers.get('Content-Length');
  return !!oldLen && !!newLen && oldLen === newLen;
}

export async function fetchGzJson(url: string, progressCallback?: (loaded: number, total: number) => void): Promise<FetchResult> {
  const fetchFromNetwork = async (): Promise<FetchResult> => {
    const resp = await fetch(url, { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`請求${url}失敗`);
    const respForCache = 'caches' in window ? resp.clone() : null;
    const data = await streamAndParseJson(resp, progressCallback, { compressed: !responseBodyIsAlreadyDecoded(resp) });
    if (respForCache) {
      const cache = await caches.open(DICT_CACHE);
      await cache.put(url, respForCache);
    }
    return { data, fromCache: false, updatedAt: responseUpdatedAt(resp) };
  };

  if (!('caches' in window)) return fetchFromNetwork();
  const cache = await caches.open(DICT_CACHE);
  const cachedResp = await cache.match(url);
  if (cachedResp) {
    const data = await streamAndParseJson(cachedResp.clone(), progressCallback, { compressed: !responseBodyIsAlreadyDecoded(cachedResp) });
    return { data, fromCache: true, updatedAt: responseUpdatedAt(cachedResp) };
  }
  return fetchFromNetwork();
}

/**
 * 后台条件请求检查字典更新；有新版本时写入缓存并触发 onUpdate 回调
 */
export async function checkDictionaryCacheRefresh(onUpdate: () => void): Promise<void> {
  if (!('caches' in window)) return;
  const cache = await caches.open(DICT_CACHE);
  const cachedEntries = await Promise.all(DICT_URLS.map(async url => ({
    url, response: await cache.match(url),
  })));
  if (cachedEntries.some(e => !e.response)) return;

  const refreshResults = await Promise.all(cachedEntries.map(async ({ url, response: cachedResp }) => {
    const condHeaders: Record<string, string> = {};
    const etag = cachedResp!.headers.get('ETag');
    const lastMod = cachedResp!.headers.get('Last-Modified');
    if (etag) condHeaders['If-None-Match'] = etag;
    if (lastMod) condHeaders['If-Modified-Since'] = lastMod;

    const netResp = await fetch(url, { cache: 'no-cache', headers: condHeaders });
    if (netResp.status === 304) return { url, changed: false as const };
    if (!netResp.ok) throw new Error(`${url} 更新检查返回 ${netResp.status}`);
    if (sameCachedPayload(cachedResp!, netResp)) return { url, changed: false as const };
    return { url, changed: true as const, response: netResp };
  }));

  const changed = refreshResults.filter(r => r.changed);
  if (!changed.length) return;

  const nextResponses = new Map<string, Response>();
  refreshResults.forEach(result => {
    nextResponses.set(result.url, result.changed
      ? result.response!
      : cachedEntries.find(e => e.url === result.url)!.response!);
  });

  const [nextBase, nextExtra] = await Promise.all(
    DICT_URLS.map(url => {
      const r = nextResponses.get(url)!.clone();
      return streamAndParseJson(r, undefined, { compressed: !responseBodyIsAlreadyDecoded(r) });
    }),
  );
  if (!Array.isArray(nextBase) || !Array.isArray(nextExtra) || nextBase.length !== nextExtra.length) {
    console.warn('字典更新已检测到，但 base/extra 条目数不一致，本次跳过回写。');
    return;
  }
  await Promise.all(changed.map(r => cache.put(r.url, (r as any).response)));
  onUpdate();
}
