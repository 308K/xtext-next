/**
 * PRD §3.3.1：MD3 动态色彩系统（Dynamic Color Tokens）
 *
 * 配色方案由 Material Color Utilities（@material/material-color-utilities）
 * 依据种子色（朱砂-焦褐，PRD「朱砂/焦墨主色推导」）实时生成，输出全部
 * --md-sys-color-* token：
 *   - :root            → 浅色方案（Scheme, contrastLevel 0，原生满足 WCAG AA）
 *   - @media dark:root → 深色方案
 *
 * 本模块在 src/index.ts 中先于组件注册被 import（ESM 按序求值），
 * 生成的 <style id="mcu-dynamic-theme"> 位于 head 末尾，与 m3-theme.css
 * 中静态回退 token 同优先级、后出现者胜出 → 运行时以 MCU 生成值为准。
 */
import {
  argbFromHex,
  hexFromArgb,
  Hct,
  DynamicScheme,
  MaterialDynamicColors,
  Variant,
} from '@material/material-color-utilities';

/** 种子色：朱砂-焦褐 */
export const SEED_COLOR = '#8f4a3c';

const mdc = new MaterialDynamicColors();

/** m3-theme.css 中引用的全部 --md-sys-color-* token → MCU DynamicColor */
const TOKENS: Array<[name: string, get: (s: DynamicScheme) => number]> = [
  ['primary', s => mdc.primary().getArgb(s)],
  ['on-primary', s => mdc.onPrimary().getArgb(s)],
  ['primary-container', s => mdc.primaryContainer().getArgb(s)],
  ['on-primary-container', s => mdc.onPrimaryContainer().getArgb(s)],
  ['secondary', s => mdc.secondary().getArgb(s)],
  ['on-secondary', s => mdc.onSecondary().getArgb(s)],
  ['secondary-container', s => mdc.secondaryContainer().getArgb(s)],
  ['on-secondary-container', s => mdc.onSecondaryContainer().getArgb(s)],
  ['tertiary', s => mdc.tertiary().getArgb(s)],
  ['on-tertiary', s => mdc.onTertiary().getArgb(s)],
  ['tertiary-container', s => mdc.tertiaryContainer().getArgb(s)],
  ['on-tertiary-container', s => mdc.onTertiaryContainer().getArgb(s)],
  ['error', s => mdc.error().getArgb(s)],
  ['on-error', s => mdc.onError().getArgb(s)],
  ['error-container', s => mdc.errorContainer().getArgb(s)],
  ['on-error-container', s => mdc.onErrorContainer().getArgb(s)],
  ['background', s => mdc.background().getArgb(s)],
  ['on-background', s => mdc.onBackground().getArgb(s)],
  ['surface', s => mdc.surface().getArgb(s)],
  ['on-surface', s => mdc.onSurface().getArgb(s)],
  ['surface-variant', s => mdc.surfaceVariant().getArgb(s)],
  ['on-surface-variant', s => mdc.onSurfaceVariant().getArgb(s)],
  ['outline', s => mdc.outline().getArgb(s)],
  ['outline-variant', s => mdc.outlineVariant().getArgb(s)],
  ['inverse-surface', s => mdc.inverseSurface().getArgb(s)],
  ['inverse-on-surface', s => mdc.inverseOnSurface().getArgb(s)],
  ['inverse-primary', s => mdc.inversePrimary().getArgb(s)],
  ['surface-container-lowest', s => mdc.surfaceContainerLowest().getArgb(s)],
  ['surface-container-low', s => mdc.surfaceContainerLow().getArgb(s)],
  ['surface-container', s => mdc.surfaceContainer().getArgb(s)],
  ['surface-container-high', s => mdc.surfaceContainerHigh().getArgb(s)],
  ['surface-container-highest', s => mdc.surfaceContainerHighest().getArgb(s)],
];

function buildScheme(isDark: boolean): DynamicScheme {
  return new DynamicScheme({
    sourceColorHct: Hct.fromInt(argbFromHex(SEED_COLOR)),
    variant: Variant.TONAL_SPOT,
    contrastLevel: 0, // 标准 M3 对比度规格
    isDark,
  });
}

function schemeToCss(scheme: DynamicScheme): string {
  return TOKENS.map(([name, get]) => `  --md-sys-color-${name}: ${hexFromArgb(get(scheme))};`).join('\n');
}

const light = buildScheme(false);
const dark = buildScheme(true);

const css = [
  ':root {',
  schemeToCss(light),
  '}',
  '@media (prefers-color-scheme: dark) {',
  ':root {',
  schemeToCss(dark),
  '}',
  '}',
].join('\n');

const style = document.createElement('style');
style.id = 'mcu-dynamic-theme';
style.textContent = css;
document.head.appendChild(style);

/** 同步浏览器 UI 主题色（地址栏/状态栏）为 MCU 生成的背景色 */
function syncThemeColorMeta(): void {
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  metas.forEach(meta => {
    const isDarkMeta = meta.media.includes('dark');
    meta.content = hexFromArgb(mdc.background().getArgb(isDarkMeta ? dark : light));
  });
}
syncThemeColorMeta();
