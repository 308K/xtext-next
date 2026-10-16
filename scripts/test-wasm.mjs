import fs from 'node:fs';

const wasm = fs.readFileSync('moonbit/xtext_core/_build/wasm-gc/release/build/xtext_core.wasm');
const dictB64 = fs.readFileSync('src/assets/dict.bin').toString('base64');

const stringImports = new Proxy({}, { get: (_, name) => (typeof name === 'string' ? name : '') });

const { instance } = await WebAssembly.instantiate(wasm, { _: stringImports }, { builtins: ['js-string'] });
const ex = instance.exports;

console.log('records:', ex.load_dict(dictB64));
console.log('search_z 道:', JSON.parse(ex.search_z('道')));
console.log('exact LU:', JSON.parse(ex.search_exact('LU')).length);
console.log("exact l'uq:", JSON.parse(ex.search_exact("l'uq")).length);
console.log('prefix kʷ:', JSON.parse(ex.search_prefix('kʷ')).length);
console.log('contains y ʔ:', JSON.parse(ex.search_contains(1, 'ʔ')).length);
console.log('meaning 丈夫:', JSON.parse(ex.search_meaning('丈夫')).length);
console.log('domain LU:', JSON.parse(ex.search_domain_prefix('LU')).length);
const t0 = Date.now();
console.log('meaning 之:', JSON.parse(ex.search_meaning('之')).length, Date.now() - t0 + 'ms');
console.log('get_json sample:', ex.get_json(9193).slice(0, 150));
