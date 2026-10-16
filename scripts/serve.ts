/** 本地预览服务器：bun run serve */
Bun.serve({
  port: 4173,
  async fetch(req: Request) {
    const url = new URL(req.url);
    // 模拟 Cloudflare /cdn-cgi/trace（本地开发环境）
    if (url.pathname === '/cdn-cgi/trace') {
      return new Response('loc=CN\nts=0\n', { headers: { 'content-type': 'text/plain' } });
    }
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = Bun.file(`dist${path}`);
    if (await file.exists()) return new Response(file);
    return new Response(Bun.file('dist/index.html'));
  },
});
console.log('▶ http://localhost:4173');
