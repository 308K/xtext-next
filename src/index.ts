import './theme/dynamic-theme'; // 0. PRD §3.3.1：MCU 动态主题先于组件注册注入
import { initializeFontSystem } from './core/font-loader';
import './components/pboc-app';

// 1. PRD §5.1：页面初始化渲染前判定访客地域，动态注入 MiSans CDN
void initializeFontSystem();

// 2. 注册 Service Worker（与原 script.js 行为一致：本地开发环境注销，生产注册并监听 controllerchange）
const isLocalDevelopment = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

if ('serviceWorker' in navigator) {
  if (isLocalDevelopment) {
    navigator.serviceWorker.getRegistrations()
      .then(registrations => Promise.all(registrations.map(r => r.unregister())))
      .catch(() => {});
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
    });
  }
}
