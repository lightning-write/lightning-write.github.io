/* 라이트닝 라이트 — 원고를 PDF 파일로 만든다 (외부 라이브러리 없음)
   - A4, 본문 서식(글자 크기·줄 간격·들여쓰기)을 따르고 양쪽 정렬, 장 제목, 장면 구분 가운데, 쪽 번호
   - 글꼴은 앱에 들어 있는 코펍 바탕체(TrueType)에서 원고에 쓰인 글자만 골라 넣는다(CIDFontType2, Identity-H)
   - 글자를 고를 수 있고 복사·검색이 되도록 ToUnicode를 넣는다
   window.PdfOut = {make(paras, opt) → Blob} */
const PdfOut = (() => {
'use strict';
const FONT_URL = 'KoPub_Batang_Light.ttf';
let fontBuf = null;
async function loadFont(){
  if(fontBuf) return fontBuf;
  const r = await fetch(FONT_URL);
  if(!r.ok) throw new Error('pdf_font');
  fontBuf = new Uint8Array(await r.arrayBuffer());
  return fontBuf;
}

/* ---------- TrueType 읽기 ---------- */
function parseTtf(u8){
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = dv.getUint16(4), tables = {};
  for(let i = 0; i < n; i++){
    const p = 12 + i * 16, tag = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
    tables[tag] = {off: dv.getUint32(p + 8), len: dv.getUint32(p + 12)};
  }
  const T = k => { if(!tables[k]) throw new Error('pdf_font'); return tables[k].off; };
  const head = T('head'), hhea = T('hhea'), maxp = T('maxp'), hmtx = T('hmtx'), loca = T('loca');
  const upem = dv.getUint16(head + 18), locFmt = dv.getInt16(head + 50);
  const bbox = [dv.getInt16(head + 36), dv.getInt16(head + 38), dv.getInt16(head + 40), dv.getInt16(head + 42)];
  const ascent = dv.getInt16(hhea + 4), descent = dv.getInt16(hhea + 6), nHM = dv.getUint16(hhea + 34);
  const numGlyphs = dv.getUint16(maxp + 4);
  let capH = ascent * .7;
  if(tables['OS/2'] && dv.getUint16(tables['OS/2'].off) >= 2 && tables['OS/2'].len >= 90) capH = dv.getInt16(tables['OS/2'].off + 88) || capH;
  const adv = g => dv.getUint16(hmtx + 4 * Math.min(g, nHM - 1));
  const glyphRange = g => {
    if(locFmt){ const a = dv.getUint32(loca + 4 * g), b = dv.getUint32(loca + 4 * g + 4); return [a, b]; }
    return [dv.getUint16(loca + 2 * g) * 2, dv.getUint16(loca + 2 * g + 2) * 2];
  };
  // cmap: (3,10) 형식 12 → (3,1)/(0,x) 형식 4
  const cm = T('cmap'), nSub = dv.getUint16(cm + 2);
  let f4 = -1, f12 = -1;
  for(let i = 0; i < nSub; i++){
    const pid = dv.getUint16(cm + 4 + i * 8), eid = dv.getUint16(cm + 6 + i * 8), o = cm + dv.getUint32(cm + 8 + i * 8), fmt = dv.getUint16(o);
    if(fmt === 12 && (pid === 3 && eid === 10 || pid === 0)) f12 = o;
    if(fmt === 4 && (pid === 3 && (eid === 1 || eid === 0) || pid === 0) && f4 < 0) f4 = o;
  }
  const cache = new Map();
  function gidOf(cp){
    if(cache.has(cp)) return cache.get(cp);
    let g = 0;
    if(f12 >= 0){
      const ng = dv.getUint32(f12 + 12); let lo = 0, hi = ng - 1;
      while(lo <= hi){ const m = (lo + hi) >> 1, p = f12 + 16 + m * 12, s = dv.getUint32(p), e = dv.getUint32(p + 4); if(cp < s) hi = m - 1; else if(cp > e) lo = m + 1; else { g = dv.getUint32(p + 8) + cp - s; break; } }
    } else if(f4 >= 0 && cp <= 0xFFFF){
      const segX2 = dv.getUint16(f4 + 6), ends = f4 + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ros = deltas + segX2;
      let lo = 0, hi = segX2 / 2 - 1;
      while(lo <= hi){
        const m = (lo + hi) >> 1, e = dv.getUint16(ends + m * 2);
        if(cp > e){ lo = m + 1; continue; }
        const s = dv.getUint16(starts + m * 2);
        if(cp < s){ hi = m - 1; continue; }
        const d = dv.getInt16(deltas + m * 2), ro = dv.getUint16(ros + m * 2);
        if(!ro) g = (cp + d) & 0xFFFF;
        else { const gp = ros + m * 2 + ro + (cp - s) * 2; const gi = dv.getUint16(gp); g = gi ? (gi + d) & 0xFFFF : 0; }
        break;
      }
    }
    if(g >= numGlyphs) g = 0;
    cache.set(cp, g); return g;
  }
  return {u8, dv, tables, upem, bbox, ascent, descent, capH, numGlyphs, adv, glyphRange, gidOf, locFmt};
}
/* 쓴 글리프만 남긴 글꼴. 글리프 번호는 그대로 두고 쓰지 않은 글리프를 비운다 */
function subsetTtf(F, used){
  const {u8, dv} = F, glyf = F.tables.glyf.off;
  const keep = new Set([0, ...used]), stack = [...keep];
  while(stack.length){   // 합성 글리프의 부품도 넣는다
    const g = stack.pop(), [a, b] = F.glyphRange(g);
    if(b <= a || dv.getInt16(glyf + a) >= 0) continue;
    let p = glyf + a + 10, flags;
    do{
      flags = dv.getUint16(p); const c = dv.getUint16(p + 2);
      if(!keep.has(c)){ keep.add(c); stack.push(c); }
      p += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
    } while(flags & 0x20);
  }
  let size = 0;
  for(const g of keep){ const [a, b] = F.glyphRange(g); size += (b - a + 3) & ~3; }
  const newGlyf = new Uint8Array(size), newLoca = new Uint8Array((F.numGlyphs + 1) * 4), lv = new DataView(newLoca.buffer);
  let off = 0;
  for(let g = 0; g < F.numGlyphs; g++){
    lv.setUint32(g * 4, off);
    if(keep.has(g)){ const [a, b] = F.glyphRange(g); if(b > a){ newGlyf.set(u8.subarray(glyf + a, glyf + b), off); off += (b - a + 3) & ~3; } }
  }
  lv.setUint32(F.numGlyphs * 4, off);
  const out = {};
  for(const [tag, t] of Object.entries(F.tables)){
    if(['glyf', 'loca', 'DSIG', 'GSUB', 'GPOS', 'GDEF', 'kern', 'FFTM', 'BASE', 'JSTF', 'morx', 'vhea', 'vmtx'].includes(tag)) continue;
    out[tag] = u8.slice(t.off, t.off + t.len);
  }
  const head = out.head, hv = new DataView(head.buffer, head.byteOffset);
  hv.setUint32(8, 0); hv.setInt16(50, 1);   // checkSumAdjustment 0, loca는 긴 형식
  out.glyf = newGlyf.subarray(0, off); out.loca = newLoca;
  const tags = Object.keys(out).sort(), nt = tags.length;
  let es = 0; while((1 << (es + 1)) <= nt) es++;
  let total = 12 + nt * 16; for(const k of tags) total += (out[k].length + 3) & ~3;
  const res = new Uint8Array(total), rv = new DataView(res.buffer);
  rv.setUint32(0, 0x00010000); rv.setUint16(4, nt); rv.setUint16(6, 16 << es); rv.setUint16(8, es); rv.setUint16(10, nt * 16 - (16 << es));
  let p = 12 + nt * 16;
  tags.forEach((k, i) => {
    const d = out[k], q = 12 + i * 16;
    for(let j = 0; j < 4; j++) res[q + j] = k.charCodeAt(j);
    let sum = 0; const pad = new Uint8Array((d.length + 3) & ~3); pad.set(d); const pv = new DataView(pad.buffer);
    for(let j = 0; j < pad.length; j += 4) sum = (sum + pv.getUint32(j)) >>> 0;
    rv.setUint32(q + 4, sum); rv.setUint32(q + 8, p); rv.setUint32(q + 12, d.length);
    res.set(d, p); p += pad.length;
  });
  return res;
}

/* ---------- 줄 나누기 ---------- */
const NO_START = new Set([...'.,!?;:)]}>»」』】〕〉》）］｝、。，．！？：；…‥·%’”ㆍ~～']);
const NO_END = new Set([...'([{<«「『【〔〈《（［｛‘“']);
const isWordCh = c => /[A-Za-z0-9À-ɏ'’\-]/.test(c);
/* runs → 글자 목록 [{c, g, w, st}] */
function glyphs(F, p, size, prefs){
  const out = [];
  for(const r of p.runs){
    const sz = size * (r.r || 1) * (p.chap ? 1.2 : 1);
    for(const ch of r.t.replace(/[\t 　]/g, m => m === '　' ? '　' : ' ')){
      const cp = ch.codePointAt(0); if(cp < 32) continue;
      const g = F.gidOf(cp);
      out.push({c: ch, g, w: F.adv(g) / F.upem * sz, sz, b: r.b || p.chap, i: !!r.i});
    }
  }
  return out;
}
function breakLines(gs, width, indent){
  const lines = []; let i = 0, first = true;
  while(i < gs.length){
    if(!first) while(i < gs.length && gs[i].c === ' ') i++;
    if(i >= gs.length) break;
    const avail = width - (first ? indent : 0);
    let w = 0, j = i;
    while(j < gs.length && w + gs[j].w <= avail + 0.01){ w += gs[j].w; j++; }
    if(j < gs.length){
      let k = j;
      // 낱말(영문·숫자) 한가운데면 낱말 앞에서
      if(isWordCh(gs[k].c) && k > i && isWordCh(gs[k - 1].c)){ let m = k; while(m > i && isWordCh(gs[m - 1].c)) m--; if(m > i) k = m; }
      // 줄 머리에 못 오는 닫는 부호는 앞줄 끝에 매단다(두 개까지). 낱말 때문에 앞으로 옮긴 경우면 그 앞에서 다시 본다
      if(k === j && NO_START.has(gs[k].c)){ k++; while(k < gs.length && NO_START.has(gs[k].c) && k - j < 2) k++; }
      else while(k > i + 1 && k < gs.length && NO_START.has(gs[k].c)) k--;
      while(k > i + 1 && NO_END.has(gs[k - 1].c)) k--;
      if(k <= i) k = Math.max(i + 1, j);
      j = k;
    }
    lines.push({from: i, to: j, first, last: j >= gs.length});
    i = j; first = false;
  }
  if(!lines.length) lines.push({from: 0, to: 0, first: true, last: true});
  return lines;
}

/* ---------- PDF 만들기 ---------- */
const enc = new TextEncoder();
async function zlib(u8){
  if(typeof CompressionStream !== 'function') return null;
  try{ return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()); }catch(e){ return null; }
}
const hex4 = n => n.toString(16).padStart(4, '0').toUpperCase();
const num = x => { const s = (Math.round(x * 1000) / 1000).toString(); return s === '-0' ? '0' : s; };
function utf16hex(s){ let h = 'FEFF'; for(const ch of s){ const cp = ch.codePointAt(0); if(cp > 0xFFFF){ const v = cp - 0x10000; h += hex4(0xD800 + (v >> 10)) + hex4(0xDC00 + (v & 0x3FF)); } else h += hex4(cp); } return '<' + h + '>'; }

/* paras: [{runs:[{t,b,i,r}], chap}], opt: {title, author, fs(px), lh, indent, sceneRe, chapRe, pageNumbers} */
async function make(paras, opt){
  const F = parseTtf(await loadFont());
  const PW = 595.28, PH = 841.89, ML = 62.36, MR = 62.36, MT = 70.87, MB = 70.87;
  const W = PW - ML - MR, size = Math.max(8, (opt.fs || 16) * .75), lh = opt.lh || 1.9;
  const used = new Set(), uni = new Map();
  const pages = []; let ops = null, y = 0;
  const newPage = () => { ops = []; pages.push(ops); y = PH - MT; };
  newPage();
  const asc = F.ascent / F.upem;
  /* 한 줄을 그린다: 같은 꾸밈끼리 묶어 Tj 하나로. Tc(글자 사이)로 양쪽 정렬 */
  function drawLine(gs, from, to, x, base, tc){
    let k = from;
    while(k < to){
      const s = gs[k]; let e = k + 1;
      while(e < to && gs[e].sz === s.sz && gs[e].b === s.b && gs[e].i === s.i) e++;
      let hex = '', w = 0;
      for(let q = k; q < e; q++){ const g = gs[q]; used.add(g.g); if(!uni.has(g.g)) uni.set(g.g, g.c); hex += hex4(g.g); w += g.w + tc; }
      ops.push('BT /F1 ' + num(s.sz) + ' Tf ' + num(tc) + ' Tc ' + (s.b ? '2 Tr ' + num(s.sz * .028) + ' w ' : '0 Tr ') + '1 0 ' + (s.i ? '0.2' : '0') + ' 1 ' + num(x) + ' ' + num(base) + ' Tm <' + hex + '> Tj ET');
      x += w; k = e;
    }
  }
  function block(gs, o){
    const lineH = Math.max(...gs.map(g => g.sz), o.size || size) * lh;
    const ind = o.indent || 0, lines = breakLines(gs, W, ind);
    if(o.before) y -= o.before;
    if(o.keepNext && y - lineH * (lines.length + 2) < MB) newPage();
    for(const L of lines){
      if(y - lineH < MB - 0.5){ newPage(); }
      const lsz = Math.max(...gs.slice(L.from, L.to).map(g => g.sz), o.size || size);
      const base = y - (lineH - lsz) / 2 - lsz * asc + lsz * .06;
      let to = L.to; while(to > L.from && gs[to - 1].c === ' ') to--;
      let w = 0; for(let q = L.from; q < to; q++) w += gs[q].w;
      const avail = W - (L.first ? ind : 0);
      let x = ML + (L.first ? ind : 0), tc = 0;
      if(o.align === 'center') x = ML + (W - w) / 2;
      else if(!L.last && to - L.from > 1 && o.align !== 'left'){ tc = (avail - w) / (to - L.from - 1); if(tc > size * .6) tc = 0; }
      drawLine(gs, L.from, to, x, base, tc);
      y -= lineH;
    }
    if(o.after) y -= o.after;
  }
  const paraText = p => p.runs.map(r => r.t).join('');
  const isSep = t => !!t.trim() && opt.sceneRe && opt.sceneRe.test(t);
  const isChap = p => { if(p.chap) return true; const t = paraText(p).trim(); return !!opt.chapRe && opt.chapRe.test(t) && t.length <= 30 && !/[.?!。…”"’'」』]$/.test(t); };
  // 제목(원고 첫 줄과 다를 때만)
  const firstText = (paras.find(p => paraText(p).trim()) ? paraText(paras.find(p => paraText(p).trim())).trim() : '');
  if(opt.title && opt.title.replace(/\s/g, '') !== firstText.replace(/\s/g, '')){
    const tg = glyphs(F, {runs: [{t: opt.title, b: true}], chap: false}, size * 1.6, opt);
    y -= size * 2; block(tg, {align: 'center', size: size * 1.6, after: size * lh * 1.5});
  }
  let started = false;
  for(const p of paras){
    const t = paraText(p);
    if(!t.trim()){ if(started){ if(y - size * lh < MB) newPage(); else y -= size * lh; } continue; }
    started = true;
    if(isChap(p)){ const cp = Object.assign({}, p, {chap: true}); block(glyphs(F, cp, size, opt), {align: 'left', before: y < PH - MT - 1 ? size * 1.4 : 0, after: size * .7, keepNext: true, size: size * 1.2}); continue; }
    if(isSep(t)){ block(glyphs(F, {runs: [{t: t.trim()}], chap: false}, size, opt), {align: 'center'}); continue; }
    block(glyphs(F, p, size, opt), {indent: opt.indent ? size : 0});
  }
  // 쪽 번호
  if(opt.pageNumbers !== false && pages.length > 1){
    pages.forEach((o, i) => {
      ops = o; const s = String(i + 1), ps = size * .75;
      const gs = [...s].map(c => { const g = F.gidOf(c.codePointAt(0)); return {c, g, w: F.adv(g) / F.upem * ps, sz: ps, b: false, i: false}; });
      const w = gs.reduce((a, g) => a + g.w, 0);
      drawLine(gs, 0, gs.length, (PW - w) / 2, MB / 2 - ps / 2, 0);
    });
  }

  /* ---- 객체 쓰기 ---- */
  const objs = [];   // [{id, parts:[Uint8Array|string]}]
  const add = () => { objs.push(null); return objs.length; };
  const set = (id, ...parts) => { objs[id - 1] = parts; };
  async function stream(id, dict, data, extra){
    const z = await zlib(data);
    const body = z || data;
    set(id, '<< ' + dict + (z ? ' /Filter /FlateDecode' : '') + ' /Length ' + body.length + (extra || '') + ' >>\nstream\n', body, '\nendstream');
  }
  const catalog = add(), pagesId = add(), font0 = add(), cidFont = add(), desc = add(), fontFile = add(), toUni = add(), info = add();
  const pageIds = [];
  for(const o of pages){
    const pid = add(), cid = add(); pageIds.push(pid);
    set(pid, '<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 ' + num(PW) + ' ' + num(PH) + '] /Resources << /Font << /F1 ' + font0 + ' 0 R >> >> /Contents ' + cid + ' 0 R >>');
    await stream(cid, '', enc.encode('0 g 0 G\n' + o.join('\n')));
  }
  set(catalog, '<< /Type /Catalog /Pages ' + pagesId + ' 0 R /ViewerPreferences << /DisplayDocTitle true >> /Lang (ko) >>');
  set(pagesId, '<< /Type /Pages /Kids [' + pageIds.map(i => i + ' 0 R').join(' ') + '] /Count ' + pageIds.length + ' >>');
  const fname = 'LWRITE+KoPubBatang-Light';
  set(font0, '<< /Type /Font /Subtype /Type0 /BaseFont /' + fname + ' /Encoding /Identity-H /DescendantFonts [' + cidFont + ' 0 R] /ToUnicode ' + toUni + ' 0 R >>');
  const k = 1000 / F.upem, gidList = [...used].sort((a, b) => a - b);
  set(cidFont, '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /' + fname + ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ' + desc + ' 0 R /DW 1000 /CIDToGIDMap /Identity /W [' + gidList.map(g => g + ' [' + Math.round(F.adv(g) * k) + ']').join(' ') + '] >>');
  set(desc, '<< /Type /FontDescriptor /FontName /' + fname + ' /Flags 6 /FontBBox [' + F.bbox.map(v => Math.round(v * k)).join(' ') + '] /ItalicAngle 0 /Ascent ' + Math.round(F.ascent * k) + ' /Descent ' + Math.round(F.descent * k) + ' /CapHeight ' + Math.round(F.capH * k) + ' /StemV 80 /FontFile2 ' + fontFile + ' 0 R >>');
  const sub = subsetTtf(F, used);
  await stream(fontFile, '', sub, ' /Length1 ' + sub.length);
  let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
  const pairs = [...uni.entries()].sort((a, b) => a[0] - b[0]);
  for(let i = 0; i < pairs.length; i += 100){
    const ch = pairs.slice(i, i + 100);
    cmap += ch.length + ' beginbfchar\n' + ch.map(([g, c]) => '<' + hex4(g) + '> ' + utf16hex(c).replace(/^<FEFF/, '<')).join('\n') + '\nendbfchar\n';
  }
  cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
  await stream(toUni, '', enc.encode(cmap));
  set(info, '<< /Title ' + utf16hex(opt.title || '') + (opt.author ? ' /Author ' + utf16hex(opt.author) : '') + ' /Producer ' + utf16hex('라이트닝 라이트') + ' >>');

  const parts = [enc.encode('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n')].map(x => x);
  parts[0] = new Uint8Array([...enc.encode('%PDF-1.7\n%'), 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]);
  let off = parts[0].length; const xref = [];
  objs.forEach((o, i) => {
    xref.push(off);
    const chunk = [enc.encode((i + 1) + ' 0 obj\n'), ...o.map(x => typeof x === 'string' ? enc.encode(x) : x), enc.encode('\nendobj\n')];
    for(const c of chunk){ parts.push(c); off += c.length; }
  });
  let tail = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + xref.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  tail += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalog + ' 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + off + '\n%%EOF\n';
  parts.push(enc.encode(tail));
  return {blob: new Blob(parts, {type: 'application/pdf'}), pages: pages.length};
}
return {make, _parse: parseTtf, _break: breakLines};
})();
