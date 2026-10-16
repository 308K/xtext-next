/**
 * 边缘地域探测与 MiSans 字体动态注入模块
 * 依据 PRD §3.2.2：基于 /cdn-cgi/trace 判定访客地域，就近选择 CDN
 */
export async function initializeFontSystem(): Promise<void> {
  let isMainlandChina = false;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200); // 1.2s 超时防阻塞

    const res = await fetch('/cdn-cgi/trace', { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const text = await res.text();
      const locMatch = text.match(/^loc=(.+)$/m);
      if (locMatch && locMatch[1].trim() === 'CN') {
        isMainlandChina = true;
      }
    }
  } catch (err) {
    console.warn('[xtext] trace geo detection fallback to default CDN', err);
  }

  const baseCDN = isMainlandChina
    ? 'https://cdn.bootcdn.net/ajax/libs/misans-webfont/4.3.1'
    : 'https://cdnjs.cloudflare.com/ajax/libs/misans-webfont/4.3.1';

  injectStyleLink(`${baseCDN}/misans-style.min.css`);
  injectStyleLink(`${baseCDN}/misans-l3-style.min.css`);
}

function injectStyleLink(href: string): void {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}
