// ============================================================================
// query.mbt —— 检索查询（wasm-gc + JS string builtins ABI）
// ============================================================================
//
// load_dict(bytes) 把宿主 fetch 的 dict.bin 字节数组装入引擎；
// 查询函数接收 JS string，返回 JSON string（命中索引数组或记录 JSON）。
// wasm-gc 的 String 即 JS string、FixedArray[Byte] 即 Uint8Array，零拷贝。
// ============================================================================

///|
fn read_u16(b : FixedArray[Byte], addr : Int32) -> Int32 {
  b[addr].to_int() | (b[addr + 1].to_int() << 8)
}

///|
fn read_u32(b : FixedArray[Byte], addr : Int32) -> Int32 {
  b[addr].to_int() |
  (b[addr + 1].to_int() << 8) |
  (b[addr + 2].to_int() << 16) |
  (b[addr + 3].to_int() << 24)
}

///|
fn read_u64(b : FixedArray[Byte], addr : Int32) -> Int64 {
  let lo = Int64::from_int(read_u32(b, addr))
  let hi = Int64::from_int(read_u32(b, addr + 4))
  lo | (hi << 32)
}

///|
priv struct Engine {
  mut bytes : FixedArray[Byte]
  mut count : Int32
  mut table_off : Int32
  mut pool_off : Int32
}

///|
let engine : Engine = {
  bytes: FixedArray::make(0, b'\x00'),
  count: 0,
  table_off: 0,
  pool_off: 0,
}

///|
fn check_magic(b : FixedArray[Byte]) -> Bool {
  let magic = "XTEXT"
  for i in 0..<5 {
    if b[i].to_int() != magic[i].to_int() {
      return false
    }
  }
  true
}

///|
/// length == 0xFFFF 表示字段缺失
let absent_len : Int32 = 0xFFFF

///|
/// Base64 解码（标准 alphabet，无填充容错）。
fn base64_decode(s : String) -> FixedArray[Byte] {
  let table = FixedArray::make(256, -1)
  let alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  for i in 0..<64 {
    table[alphabet[i].to_int()] = i
  }
  let mut pad = 0
  let n = s.length()
  if n >= 1 && s[n - 1] == '=' {
    pad += 1
    if n >= 2 && s[n - 2] == '=' {
      pad += 1
    }
  }
  let out_len = n / 4 * 3 - pad
  let out = FixedArray::make(out_len, b'\x00')
  let mut oi = 0
  let mut i = 0
  while i + 4 <= n && oi < out_len {
    let a = table[s[i].to_int()]
    let b = table[s[i + 1].to_int()]
    let c = if s[i + 2] == '=' { 0 } else { table[s[i + 2].to_int()] }
    let d = if s[i + 3] == '=' { 0 } else { table[s[i + 3].to_int()] }
    let triple = (a << 18) | (b << 12) | (c << 6) | d
    if oi < out_len {
      out[oi] = ((triple >> 16) & 0xFF).to_byte()
    }
    if oi + 1 < out_len {
      out[oi + 1] = ((triple >> 8) & 0xFF).to_byte()
    }
    if oi + 2 < out_len {
      out[oi + 2] = (triple & 0xFF).to_byte()
    }
    oi += 3
    i += 4
  }
  out
}

///|
/// 装载 dict.bin（base64 编码）。返回记录条数；魔数错误返回 -1。
#export_name("load_dict")
pub fn load_dict(b64 : String) -> Int32 {
  let bytes = base64_decode(b64)
  engine.bytes = bytes
  if bytes.length() < 32 || !check_magic(bytes) {
    engine.count = 0
    return -1
  }
  engine.count = Int64::to_int(read_u64(bytes, 8))
  engine.table_off = Int64::to_int(read_u64(bytes, 16))
  engine.pool_off = Int64::to_int(read_u64(bytes, 24))
  engine.count
}

///|
/// 记录条数。
#export_name("record_count")
pub fn record_count() -> Int32 {
  engine.count
}

// ── 记录访问 ───────────────────────────────────────────────────────────────

///|
priv struct Rec {
  z_off : Int32
  z_len : Int32
  y_off : Int32
  y_len : Int32
  p_off : Int32
  p_len : Int32
  a_off : Int32
  a_len : Int32
  c_off : Int32
  c_len : Int32
  m_off : Int32
  m_len : Int32
  e_off : Int32
  e_len : Int32
  n_off : Int32
  n_len : Int32
  d_off : Int32
  d_len : Int32
  flags : Int32
}

///|
fn rec_load(idx : Int32) -> Rec {
  let base = engine.table_off + idx * 56
  let b = engine.bytes
  {
    z_off: read_u32(b, base),
    z_len: read_u16(b, base + 4),
    y_off: read_u32(b, base + 6),
    y_len: read_u16(b, base + 10),
    p_off: read_u32(b, base + 12),
    p_len: read_u16(b, base + 16),
    a_off: read_u32(b, base + 18),
    a_len: read_u16(b, base + 22),
    c_off: read_u32(b, base + 24),
    c_len: read_u16(b, base + 28),
    m_off: read_u32(b, base + 30),
    m_len: read_u16(b, base + 34),
    e_off: read_u32(b, base + 36),
    e_len: read_u16(b, base + 40),
    n_off: read_u32(b, base + 42),
    n_len: read_u16(b, base + 46),
    d_off: read_u32(b, base + 48),
    d_len: read_u16(b, base + 52),
    flags: b[base + 54].to_int(),
  }
}

///|
/// 从字符串池读取 UTF-8 文本。
fn pool_str(off : Int32, len : Int32) -> String {
  if len == absent_len {
    return ""
  }
  let start = engine.pool_off + off
  let buf = StringBuilder::new()
  let mut i = 0
  while i < len {
    let byte = engine.bytes[start + i].to_int()
    if byte < 0x80 {
      buf.write_char(Int32::unsafe_to_char(byte))
      i += 1
    } else if byte < 0xE0 {
      let c = ((byte & 0x1F) << 6) |
        (engine.bytes[start + i + 1].to_int() & 0x3F)
      buf.write_char(Int32::unsafe_to_char(c))
      i += 2
    } else if byte < 0xF0 {
      let c = ((byte & 0x0F) << 12) |
        ((engine.bytes[start + i + 1].to_int() & 0x3F) << 6) |
        (engine.bytes[start + i + 2].to_int() & 0x3F)
      buf.write_char(Int32::unsafe_to_char(c))
      i += 3
    } else {
      let c = ((byte & 0x07) << 18) |
        ((engine.bytes[start + i + 1].to_int() & 0x3F) << 12) |
        ((engine.bytes[start + i + 2].to_int() & 0x3F) << 6) |
        (engine.bytes[start + i + 3].to_int() & 0x3F)
      buf.write_char(Int32::unsafe_to_char(c))
      i += 4
    }
  }
  buf.to_string()
}

///|
fn rec_z(r : Rec) -> String {
  pool_str(r.z_off, r.z_len)
}

///|
fn rec_y(r : Rec) -> String {
  pool_str(r.y_off, r.y_len)
}

///|
fn rec_p(r : Rec) -> String {
  pool_str(r.p_off, r.p_len)
}

///|
fn rec_a(r : Rec) -> String {
  pool_str(r.a_off, r.a_len)
}

///|
fn rec_c(r : Rec) -> String {
  pool_str(r.c_off, r.c_len)
}

///|
fn rec_m(r : Rec) -> String {
  pool_str(r.m_off, r.m_len)
}

///|
fn rec_e(r : Rec) -> String {
  pool_str(r.e_off, r.e_len)
}

///|
fn rec_n(r : Rec) -> String {
  pool_str(r.n_off, r.n_len)
}

///|
fn rec_d(r : Rec) -> String {
  pool_str(r.d_off, r.d_len)
}

// ── 字符串工具 ─────────────────────────────────────────────────────────────

///|
fn str_contains(haystack : String, needle : String) -> Bool {
  let h = haystack.length()
  let n = needle.length()
  if n == 0 {
    return true
  }
  if n > h {
    return false
  }
  let mut i = 0
  while i + n <= h {
    let mut ok = true
    let mut j = 0
    while j < n {
      if haystack[i + j] != needle[j] {
        ok = false
        break
      }
      j += 1
    }
    if ok {
      return true
    }
    i += 1
  }
  false
}

///|
fn str_starts_with(s : String, prefix : String) -> Bool {
  let p = prefix.length()
  if p > s.length() {
    return false
  }
  for i in 0..<p {
    if s[i] != prefix[i] {
      return false
    }
  }
  true
}

///|
/// 解码 UTF-16 字符串的首个 Unicode 码点（含代理对，支持非 BMP 扩展区汉字）。
/// 无代理对时返回该码元值；空串返回 -1。
fn first_codepoint(s : String) -> Int32 {
  if s.length() == 0 {
    return -1
  }
  let unit = s[0].to_int()
  if unit >= 0xD800 && unit <= 0xDBFF && s.length() >= 2 {
    let low = s[1].to_int()
    if low >= 0xDC00 && low <= 0xDFFF {
      return 0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00)
    }
  }
  unit
}

// ── 二分查找（记录表按 z 码点升序） ───────────────────────────────────────

///|
fn z_codepoint(idx : Int32) -> Int32 {
  let r = rec_load(idx)
  let s = rec_z(r)
  first_codepoint(s)
}

///|
/// 返回码点等于 target 的最小索引；找不到返回 -1。
fn find_by_z_codepoint(target : Int32) -> Int32 {
  let mut lo = 0
  let mut hi = engine.count - 1
  let mut result = -1
  while lo <= hi {
    let mid = lo + (hi - lo) / 2
    let cp = z_codepoint(mid)
    if cp < target {
      lo = mid + 1
    } else {
      if cp == target {
        result = mid
      }
      hi = mid - 1
    }
  }
  result
}

// ── 查询导出 ───────────────────────────────────────────────────────────────

///|
fn json_int_array(hits : Array[Int32]) -> String {
  let sb = StringBuilder::new()
  sb.write_char('[')
  for i in 0..<hits.length() {
    if i > 0 {
      sb.write_char(',')
    }
    sb.write_string(hits[i].to_string())
  }
  sb.write_char(']')
  sb.to_string()
}

///|
/// z 精确匹配（二分查找 + 同码点扫描）。
#export_name("search_z")
pub fn search_z(query : String) -> String {
  if engine.count == 0 || query.length() == 0 {
    return "[]"
  }
  let target = first_codepoint(query)
  let first = find_by_z_codepoint(target)
  if first < 0 {
    return "[]"
  }
  let hits : Array[Int32] = []
  let mut i = first
  while i < engine.count && z_codepoint(i) == target {
    hits.push(i)
    i += 1
  }
  json_int_array(hits)
}

///|
/// 精确匹配 y/p/a/m/z 任一字段。
#export_name("search_exact")
pub fn search_exact(query : String) -> String {
  if engine.count == 0 || query.length() == 0 {
    return "[]"
  }
  let hits : Array[Int32] = Array::new()
  let seen = Array::make(engine.count, false)
  let target = first_codepoint(query)
  let first = find_by_z_codepoint(target)
  if first >= 0 {
    let mut i = first
    while i < engine.count && z_codepoint(i) == target {
      if !seen[i] {
        seen[i] = true
        hits.push(i)
      }
      i += 1
    }
  }
  for i in 0..<engine.count {
    if seen[i] {
      continue
    }
    let r = rec_load(i)
    if rec_y(r) == query ||
      rec_p(r) == query ||
      rec_a(r) == query ||
      rec_m(r) == query {
      seen[i] = true
      hits.push(i)
    }
  }
  json_int_array(hits)
}

///|
/// 前缀匹配 y/p（正则 ^prefix 加速）。
#export_name("search_prefix")
pub fn search_prefix(query : String) -> String {
  if engine.count == 0 || query.length() == 0 {
    return "[]"
  }
  let hits : Array[Int32] = []
  for i in 0..<engine.count {
    let r = rec_load(i)
    if str_starts_with(rec_y(r), query) || str_starts_with(rec_p(r), query) {
      hits.push(i)
    }
  }
  json_int_array(hits)
}

///|
/// 子串匹配：field 0=z 1=y 2=p 3=a。
#export_name("search_contains")
pub fn search_contains(field : Int32, query : String) -> String {
  if engine.count == 0 || query.length() == 0 {
    return "[]"
  }
  let hits : Array[Int32] = []
  for i in 0..<engine.count {
    let r = rec_load(i)
    let matched = match field {
      0 => str_contains(rec_z(r), query)
      1 => str_contains(rec_y(r), query)
      2 => str_contains(rec_p(r), query)
      3 => str_contains(rec_a(r), query)
      _ => false
    }
    if matched {
      hits.push(i)
    }
  }
  json_int_array(hits)
}

///|
/// 谐声域前缀模糊（大写 token）。
#export_name("search_domain_prefix")
pub fn search_domain_prefix(query : String) -> String {
  if engine.count == 0 || query.length() == 0 {
    return "[]"
  }
  let hits : Array[Int32] = []
  for i in 0..<engine.count {
    let r = rec_load(i)
    if str_starts_with(rec_a(r), query) {
      hits.push(i)
    }
  }
  json_int_array(hits)
}

///|
/// 释义反查：n/e/d 子串。
#export_name("search_meaning")
pub fn search_meaning(query : String) -> String {
  if engine.count == 0 || query.length() == 0 {
    return "[]"
  }
  let hits : Array[Int32] = []
  for i in 0..<engine.count {
    let r = rec_load(i)
    if str_contains(rec_d(r), query) ||
      str_contains(rec_e(r), query) ||
      str_contains(rec_n(r), query) {
      hits.push(i)
    }
  }
  json_int_array(hits)
}

///|
/// 取回第 idx 条记录的 JSON。
#export_name("get_json")
pub fn get_json(idx : Int32) -> String {
  if idx < 0 || idx >= engine.count {
    return "{}"
  }
  let r = rec_load(idx)
  record_to_json(r)
}

// ── JSON 序列化 ────────────────────────────────────────────────────────────

///|
fn json_escape(s : String) -> String {
  let sb = StringBuilder::new()
  for i in 0..<s.length() {
    let c = s[i].to_int()
    match c {
      0x22 => sb.write_string("\\\"")
      0x5C => sb.write_string("\\\\")
      0x08 => sb.write_string("\\b")
      0x0C => sb.write_string("\\f")
      0x0A => sb.write_string("\\n")
      0x0D => sb.write_string("\\r")
      0x09 => sb.write_string("\\t")
      _ =>
        if c < 0x20 {
          sb.write_string("\\u" + c.to_string())
        } else {
          sb.write_char(Int32::unsafe_to_char(c))
        }
    }
  }
  sb.to_string()
}

///|
fn record_to_json(r : Rec) -> String {
  let sb = StringBuilder::new()
  sb.write_char('{')
  sb.write_string("\"z\":\"" + json_escape(rec_z(r)) + "\"")
  let y = rec_y(r)
  if y.length() > 0 {
    sb.write_string(",\"y\":\"" + json_escape(y) + "\"")
  }
  let p = rec_p(r)
  if p.length() > 0 {
    sb.write_string(",\"p\":\"" + json_escape(p) + "\"")
  }
  let a = rec_a(r)
  if a.length() > 0 {
    sb.write_string(",\"a\":\"" + json_escape(a) + "\"")
  }
  let c = rec_c(r)
  if c.length() > 0 {
    sb.write_string(",\"c\":\"" + json_escape(c) + "\"")
  }
  let m = rec_m(r)
  if m.length() > 0 {
    sb.write_string(",\"m\":\"" + json_escape(m) + "\"")
  }
  let e = rec_e(r)
  if e.length() > 0 {
    sb.write_string(",\"e\":\"" + json_escape(e) + "\"")
  }
  let n = rec_n(r)
  if n.length() > 0 {
    sb.write_string(",\"n\":\"" + json_escape(n) + "\"")
  }
  let d = rec_d(r)
  if d.length() > 0 {
    sb.write_string(",\"d\":\"" + json_escape(d) + "\"")
  }
  if (r.flags & 1) != 0 {
    sb.write_string(",\"s\":1")
  }
  if (r.flags & 2) != 0 {
    sb.write_string(",\"q\":1")
  }
  sb.write_char('}')
  sb.to_string()
}
