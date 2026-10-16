/**
 * PBOC 字典核心引擎 —— 与原仓库 docs/script.js 行为严格一致
 * 数据契约：base.json.gz → {z,y,p,a,s,q}[]；extra.json.gz → {c,m,d,e,n,...}[]
 * 索引：zIndex / pinyinIndex / phoneticIndex / domainExactIndex / initialExactIndex / meaningIndex
 */

export interface DictItem {
  z?: string;  // 字頭
  y?: string;  // 擬音
  p?: string;  // 拼音
  a?: string;  // 諧聲域
  s?: number;  // 見詩經韻
  q?: number;  // 見戰國韻
  c?: string;  // 中古音韻地位
  m?: string;  // 聲首
  d?: [string, string[]]; // 釋義 [說明, 義項[]]
  e?: string;  // 詞源
  n?: string;  // 注釋
}

export type SearchMode = 'default' | 'exact' | 'regex' | 'meaning' | 'batch';
export type SortKey = 'default' | 'pinyin' | 'phonetic' | 'domain';

export const SEARCH_MODES = new Set<SearchMode>(['default', 'exact', 'regex', 'meaning', 'batch']);
export const CJK_RE = /[㐀-䶿一-鿿豈-﫿𠀀-𲎯]/u;
export const CJK_TOKEN_RE = /[㐀-䶿一-鿿豈-﫿𠀀-𲎯]+|[^㐀-䶿一-鿿豈-﫿𠀀-𲎯]+/gu;
export const BATCH_MAX_LENGTH = 5000;

export const DICT_URLS = ['assets/base.json.gz', 'assets/extra.json.gz'];

const REGEX_MAX_LEN = 100;
const REDOS_PATTERN = /(\(.*\*.*\*|\(.*\+.*\+|\(\?=.*\*|\(\?!.*\*|(\.\*){3,}|\(\w+\+\)\+|\(\w+\*\)\+)/;

export function safeRegex(str: string, flags = ''): { ok: true; regex: RegExp } | { ok: false; msg: string } {
  if (str.length > REGEX_MAX_LEN) return { ok: false, msg: `正則表達式過長（${str.length}/${REGEX_MAX_LEN}字元）` };
  if (REDOS_PATTERN.test(str)) return { ok: false, msg: '正則表達式含有可能造成卡頓的模式，已拒絕執行' };
  try {
    const safeFlags = Array.from(new Set(flags.replace(/g/g, '').split(''))).join('');
    return { ok: true, regex: new RegExp(str, safeFlags) };
  } catch (e: any) {
    return { ok: false, msg: `正則語法錯誤：${e.message}` };
  }
}

function addToIndex<T>(index: Map<string, T[]>, key: unknown, item: T) {
  if (!key) return;
  const normalized = String(key).trim();
  if (!normalized) return;
  if (!index.has(normalized)) index.set(normalized, []);
  index.get(normalized)!.push(item);
}

function appendUnique<T>(target: T[], seen: Set<T>, items?: T[]) {
  if (!items) return;
  items.forEach(item => {
    if (!seen.has(item)) { seen.add(item); target.push(item); }
  });
}

function regexMatches(regex: RegExp, ...values: (string | undefined)[]) {
  return values.some(value => {
    if (!value) return false;
    regex.lastIndex = 0;
    return regex.test(value);
  });
}

export class DictEngine {
  dictData: DictItem[] = [];
  private zIndex = new Map<string, DictItem[]>();
  private pinyinIndex = new Map<string, DictItem[]>();
  private phoneticIndex = new Map<string, DictItem[]>();
  private domainExactIndex = new Map<string, DictItem[]>();
  private initialExactIndex = new Map<string, DictItem[]>();
  private meaningIndex = new Map<string, Set<number>>();

  buildIndexes({ includeExtra = false } = {}) {
    this.zIndex.clear(); this.pinyinIndex.clear(); this.phoneticIndex.clear();
    this.domainExactIndex.clear(); this.initialExactIndex.clear(); this.meaningIndex.clear();

    this.dictData.forEach((item, index) => {
      addToIndex(this.zIndex, item.z, item);
      addToIndex(this.pinyinIndex, item.p, item);
      addToIndex(this.phoneticIndex, item.y, item);
      addToIndex(this.domainExactIndex, item.a, item);
      if (includeExtra) {
        addToIndex(this.initialExactIndex, item.m, item);
        const addMeaningText = (text?: string) => {
          if (!text) return;
          for (const char of text) {
            if (!this.meaningIndex.has(char)) this.meaningIndex.set(char, new Set());
            this.meaningIndex.get(char)!.add(index);
          }
        };
        item.d?.[1]?.forEach(addMeaningText);
        addMeaningText(item.e);
        addMeaningText(item.n);
      }
    });
  }

  /** 与原 script.js searchDict 一致的检索逻辑 */
  search(query: string, mode: SearchMode): { results?: DictItem[]; regexError?: string; batchText?: string } {
    let isRegexMode = mode === 'regex' || (query.startsWith('/') && query.endsWith('/') && query.length > 2);
    let isExactMode = mode === 'exact' || (query.startsWith('"') && query.endsWith('"') && query.length > 2);
    let regex: RegExp | null = null;
    let exactStr = '';

    if (isRegexMode) {
      let regexStr = query;
      let flags = '';
      const match = query.match(/^\/(.+)\/([gimsuy]*)$/);
      if (match) { regexStr = match[1]; flags = match[2]; }
      const result = safeRegex(regexStr, flags);
      if (!result.ok) return { regexError: result.msg };
      regex = result.regex;
    }
    if (isExactMode) {
      exactStr = (query.startsWith('"') && query.endsWith('"')) ? query.slice(1, -1) : query;
    }

    if (mode === 'default' && !isRegexMode && !isExactMode) {
      let tokens: string[] = [];
      for (const p of query.split(/\s+/)) {
        if (!p) continue;
        const matches = p.match(CJK_TOKEN_RE);
        if (matches) {
          matches.forEach(m => {
            if (CJK_RE.test(m)) tokens.push(...Array.from(m));
            else tokens.push(m);
          });
        }
      }
      if (!tokens.length) tokens = [query];
      const parsedTokens = tokens.map(t => ({ val: t, isUpper: /^[A-Z0-9]+$/.test(t), isHan: CJK_RE.test(t) }));

      const results: DictItem[] = [];
      const seen = new Set<DictItem>();
      parsedTokens.forEach(token => {
        appendUnique(results, seen, this.zIndex.get(token.val));
        appendUnique(results, seen, this.pinyinIndex.get(token.val));
        appendUnique(results, seen, this.phoneticIndex.get(token.val));
        appendUnique(results, seen, this.domainExactIndex.get(token.val));

        if (token.isUpper) {
          for (const [domain, items] of this.domainExactIndex) {
            if (domain.includes(token.val)) appendUnique(results, seen, items);
          }
        }
        if (!token.isHan) {
          this.dictData.forEach(item => {
            if (!seen.has(item) && ((item.y && item.y.includes(token.val)) || (item.p && item.p.includes(token.val)))) {
              seen.add(item); results.push(item);
            }
          });
        }
      });
      return { results };
    }

    if (mode === 'meaning') {
      if (query.length > 0 && this.meaningIndex.has(query[0])) {
        const candidateIndices = Array.from(this.meaningIndex.get(query[0])!);
        return {
          results: candidateIndices.map(i => this.dictData[i]).filter(item =>
            item.d?.[1]?.some(m => m.includes(query)) || item.e?.includes(query) || item.n?.includes(query)),
        };
      }
      return { results: [] };
    }

    if (isRegexMode && regex) {
      return { results: this.dictData.filter(item => regexMatches(regex, item.z, item.y, item.p, item.a)) };
    }
    if (isExactMode) {
      const seen = new Set<DictItem>();
      const results: DictItem[] = [];
      appendUnique(results, seen, this.zIndex.get(exactStr));
      appendUnique(results, seen, this.pinyinIndex.get(exactStr));
      appendUnique(results, seen, this.phoneticIndex.get(exactStr));
      appendUnique(results, seen, this.domainExactIndex.get(exactStr));
      appendUnique(results, seen, this.initialExactIndex.get(exactStr));
      return { results };
    }
    return { results: [] };
  }

  /** 批量標音：逐字查表，保留输入顺序与重复 */
  batchAnalyze(text: string): Array<{ char: string; items: DictItem[] }> {
    const chars: string[] = [];
    for (const ch of Array.from(text).slice(0, BATCH_MAX_LENGTH)) {
      if (CJK_RE.test(ch)) chars.push(ch);
    }
    return chars.map(ch => ({ char: ch, items: this.zIndex.get(ch) || [] }));
  }

  sortResults(results: DictItem[], sortKey: SortKey): DictItem[] {
    if (sortKey === 'default' || !results.length) return results;
    const sorted = [...results];
    const collator = new Intl.Collator('zh', { sensitivity: 'base' });
    switch (sortKey) {
      case 'pinyin': sorted.sort((a, b) => collator.compare(a.p || '', b.p || '')); break;
      case 'phonetic': sorted.sort((a, b) => collator.compare(a.y || '', b.y || '')); break;
      case 'domain': sorted.sort((a, b) => collator.compare(a.a || '', b.a || '')); break;
    }
    return sorted;
  }
}

export const dictEngine = new DictEngine();
