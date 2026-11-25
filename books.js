/* 라이트닝 라이트 — 읽기 모드 · EPUB 만들기 · EPUB을 원고로 · PDF(인쇄)
   읽기 모드: HWP·HWPX·DOCX·TXT·PDF·EPUB을 열어 보기만 한다. 연 파일과 읽던 자리는 서재(library.js)에 두어
   「이어 읽기」로 다시 열고, 드라이브에 연결돼 있으면 다른 기기에서도 같은 자리부터 읽는다.
   EPUB → 원고: 변환 모드(또는 편집 모드)에서 EPUB을 고르면 장 제목·별표·기울임·굵게를 살린 원고로 연다. epubBook은 번역 모드(translate.js)도 쓴다.
   EPUB: 크레마샤인(흑백 전자잉크)용 조판. 본문은 한 글자도 고치지 않는다. 표지는 제목·작가 이름으로 그린다.
   PDF: 본문 서식 그대로 인쇄 창을 띄운다('PDF로 저장'). */
(() => {
'use strict';
const W = window.__wongo;
if(!W || typeof document === 'undefined') return;
const $ = s => document.querySelector(s);
const paper = $('#paper');
const esc = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const toast = W.toast, narrow = W.narrow;
const stemOf = name => String(name || '').replace(/\.[^.]+$/, '');
const extOf = name => ((String(name || '').match(/\.([^.]+)$/) || [])[1] || '').toLowerCase();
const paraText = p => p.runs.map(r => r.t).join('');
const sceneRe = W.sceneRe;
const isSep = t => !!t.trim() && sceneRe.test(t);
/* 장 제목: 편집기에서 장으로 표시했거나, '제1장 …'·'1. …'처럼 시작하는 짧은 줄(문장으로 끝나지 않는 것) */
const isChap = p => { if(p.chap) return true; const t = paraText(p).trim(); return W.chapRe.test(t) && t.length <= 30 && !/[.?!。…”"’'」』]$/.test(t); };

/* ================= 문서 읽기: 파일 → 문단 모델 [{runs:[{t,b,i}], chap}] ================= */
const ERR = Object.assign({}, W.importErrors, {
  doc_old: '옛 워드 형식(.doc)은 열 수 없습니다. 워드에서 「다른 이름으로 저장 → Word 문서(.docx)」로 바꿔 주세요',
  docx_empty: '워드 문서에서 본문을 찾지 못했습니다',
  epub_drm: '잠금(DRM)이 걸린 전자책은 열 수 없습니다',
  epub_bad: '전자책 파일을 읽지 못했습니다',
  pdf_password: '암호가 걸린 PDF는 열 수 없습니다',
  pdf_bad: 'PDF 파일을 읽지 못했습니다',
  pdf_scan: '글자가 들어 있지 않은 PDF(스캔한 그림)라 글을 뽑을 수 없습니다',
  pdf_lib: 'PDF를 읽는 부품을 받지 못했습니다. 인터넷에 연결한 뒤 한 번 열면 그 뒤로는 오프라인에서도 됩니다',
  unsupported: '이 형식은 열 수 없습니다',
  empty: '문서에 글이 없습니다'
});
const errText = e => ERR[e && e.message] || '이 파일을 읽지 못했습니다';
async function sniff(f){
  const h = new Uint8Array(await f.slice(0, 8).arrayBuffer());
  if(h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46) return 'pdf';
  if(h[0] === 0x50 && h[1] === 0x4B) return 'zip';
  if(h[0] === 0xD0 && h[1] === 0xCF) return 'ole';
  return 'text';
}
async function readTxt(f){
  const buf = await f.arrayBuffer(); let text;
  try{ text = new TextDecoder('utf-8', {fatal: true}).decode(buf); }catch(e){ text = new TextDecoder('euc-kr').decode(buf); }
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').map(l => ({runs: l ? [{t: l, b: false, i: false}] : [], chap: false}));
}
/* 글자 크기(h)를 가장 많이 쓴 크기 대비 비율(r)로 바꾼다 */
function sizeRatio(paras){
  const w = new Map();
  for(const p of paras) for(const r of p.runs) if(r.h) w.set(r.h, (w.get(r.h) || 0) + r.t.length);
  let base = 0, best = -1; for(const [h, n] of w) if(n > best){ best = n; base = h; }
  for(const p of paras) for(const r of p.runs){
    let q = r.h && base ? Math.round(r.h / base * 100) / 100 : 1;
    if(Math.abs(q - 1) < 0.05) q = 1;
    delete r.h; if(q !== 1) r.r = q;
  }
  return paras;
}
async function readDocx(z){
  const xml = await z.text('word/document.xml'); if(!xml) throw new Error('docx_empty');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const on = el => { if(!el) return false; const v = el.getAttributeNS(NS, 'val') || el.getAttribute('w:val'); return !(v === '0' || v === 'false' || v === 'none'); };
  const kid = (el, name) => { for(const c of el.children) if(c.namespaceURI === NS && c.localName === name) return c; return null; };
  const paras = [];
  for(const p of doc.getElementsByTagNameNS(NS, 'p')){
    const ppr = kid(p, 'pPr'), st = ppr && kid(ppr, 'pStyle');
    const sv = st ? (st.getAttributeNS(NS, 'val') || st.getAttribute('w:val') || '') : '';
    const chap = /^(heading|title|제목)/i.test(sv);
    let cur = {runs: [], chap};
    let hh = 0;
    const push = (t, b, i) => { if(!t) return; const l = cur.runs[cur.runs.length - 1]; if(l && l.b === b && l.i === i && l.h === hh) l.t += t; else cur.runs.push({t, b, i, h: hh}); };
    for(const r of p.getElementsByTagNameNS(NS, 'r')){
      // 글상자 안의 문단은 그 문단 차례에 따로 읽으므로, 이 문단에 바로 속한 글만 읽는다
      let a = r.parentNode; while(a && a !== p && !(a.namespaceURI === NS && a.localName === 'p')) a = a.parentNode;
      if(a !== p) continue;
      const rpr = kid(r, 'rPr'), b = !!rpr && on(kid(rpr, 'b')), i = !!rpr && on(kid(rpr, 'i'));
      const sz = rpr && kid(rpr, 'sz'); hh = sz ? Number(sz.getAttributeNS(NS, 'val') || sz.getAttribute('w:val')) || 0 : 0;
      for(const c of r.children){
        if(c.namespaceURI !== NS) continue;
        if(c.localName === 't') push(c.textContent, b, i);
        else if(c.localName === 'tab') push('\t', b, i);
        else if(c.localName === 'noBreakHyphen') push('-', b, i);
        else if(c.localName === 'br' || c.localName === 'cr'){
          const ty = c.getAttributeNS(NS, 'type') || c.getAttribute('w:type');
          if(ty === 'page' || ty === 'column') continue;
          paras.push(cur); cur = {runs: [], chap: false};
        }
      }
    }
    paras.push(cur);
  }
  if(!paras.some(p => paraText(p).trim())) throw new Error('docx_empty');
  return sizeRatio(paras);
}
/* 글로 된 문서(HWP·HWPX·DOCX·TXT)를 문단 모델로 읽는다 */
async function readTextDoc(f){
  const kind = await sniff(f), ext = extOf(f.name);
  if(kind === 'pdf') throw new Error('unsupported');
  if(kind === 'ole'){
    if(ext === 'doc') throw new Error('doc_old');
    try{ return await Hangul.read(f); }catch(e){ if(e && e.message === 'unknown_format' && ext !== 'hwp') throw new Error('doc_old'); throw e; }
  }
  if(kind === 'zip'){
    const z = await Hangul.unzip(await f.arrayBuffer());
    if(z.names.includes('word/document.xml')) return readDocx(z);
    if(z.names.includes('META-INF/container.xml') && !z.names.some(n => /^Contents\/section/.test(n))) throw new Error('unsupported');
    return Hangul.read(f);
  }
  if(ext && !['txt', 'text', 'md'].includes(ext)) throw new Error(ext === 'doc' ? 'doc_old' : 'unsupported');
  return readTxt(f);
}

/* ================= 읽기 모드 ================= */
const rd = {el: $('#reader'), doc: $('#rdDoc'), scroll: $('#rdScroll'), urls: [], pdf: null, obs: null, token: 0, libId: null, anchors: null, pages: 0, moved: false};
function rdReset(){
  rd.token++;
  clearTimeout(rdPosT); rdPosT = null; rd.libId = null; rd.anchors = null; rd.pages = 0; rd.moved = false;
  pg.cur = 0; pg.n = 1; pg.anchor = null; rd.scroll.scrollLeft = 0;
  if(rd.obs){ rd.obs.disconnect(); rd.obs = null; }
  if(rd.pdf){ pdfFree(rd.pdf); rd.pdf = null; }
  rd.urls.forEach(u => URL.revokeObjectURL(u)); rd.urls = [];
  rd.doc.textContent = ''; rd.doc.className = '';
  rd.scroll.onscroll = null; $('#rdInfo').textContent = '';
}
/* 읽기 모드 글자 크기: 편집기와 따로 기억(기기마다) */
const RD_MIN = 12, RD_MAX = 44;
const rdFsNow = () => { const v = Number(lsGet('rd-fs')); return v >= RD_MIN && v <= RD_MAX ? v : (parseFloat(paper.style.getPropertyValue('--fs')) || 16); };
function rdFs(v){ v = Math.max(RD_MIN, Math.min(RD_MAX, Math.round(v))); rd.doc.style.setProperty('--fs', v + 'px'); $('#rdSm').disabled = v <= RD_MIN; $('#rdLg').disabled = v >= RD_MAX; return v; }
function rdStep(d){ const v = rdFs(rdFsNow() + d); lsSet('rd-fs', v); rdRelayout(); toast('글자 크기 ' + v, 1200); }
$('#rdSm').onclick = () => rdStep(-1); $('#rdLg').onclick = () => rdStep(1);
/* 전체 화면으로 읽기(번역 모드와 같은 방식): 머리 띠를 숨기고 글만. 글을 누르면 띠가 잠깐 글 위로, 글을 넘기면 들어간다.
   브라우저의 전체 화면은 쓰지 않는다(켤 때마다 「전체 화면을 종료하려면…」 안내가 떠서). F 키로 켜고 끄고, Esc로 끈다 */
function rdSetFull(on){
  on = !!on;
  if(on === rd.el.classList.contains('full')) return;
  const p = rdPosNow();
  rd.el.classList.toggle('full', on); rd.el.classList.remove('peek');
  const b = $('#rdFull');
  b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', on ? '전체 화면 끝내기' : '전체 화면으로 읽기');
  b.title = on ? '전체 화면 끝내기 (F·Esc)' : '전체 화면으로 읽기 (F)';
  if(p) pg.anchor = p.pos;   // 띠가 사라지거나 나와 화면 크기가 바뀌면 rdRelayout이 이 자리로 다시 맞춘다
  rdRelayout();
}
$('#rdFull').onclick = e => { e.stopPropagation(); rdSetFull(!rd.el.classList.contains('full')); };
/* ---- 쪽 넘기기(전자책 리더처럼): 글(EPUB·문서)은 화면 크기의 단(column)으로 한 장씩, PDF는 쪽마다 화면에 맞춰 옆으로 늘어놓는다.
   왼쪽 30%를 누르거나 오른쪽으로 쓸면 앞 쪽, 오른쪽 30%를 누르거나 왼쪽으로 쓸면 다음 쪽, 가운데는 위 띠를 숨기고(전체 화면) 다시 보인다.
   휠·←→·PageUp/Down·Space·Home/End도 쪽을 넘긴다. 지금 쪽은 pg.cur, 화면이 바뀔 때 되돌아갈 자리는 pg.anchor ---- */
const pg = {stride: 0, n: 1, cur: 0, anchor: null};
const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
function rdDims(){
  const sw = rd.scroll.clientWidth, sh = rd.scroll.clientHeight, small = sw < 620;
  return {sw, sh, padX: small ? 20 : 48, padY: small ? 22 : 40};
}
function rdFitBox(b){
  const {sw, sh, padX, padY} = rdDims(); if(!sw) return;
  const ar = String(b.style.aspectRatio || '1 / 1.414').split('/').map(Number), ratio = ar[0] && ar[1] ? ar[0] / ar[1] : 0.707;
  const w = Math.floor(Math.min(sw - padX * 2, (sh - padY * 2) * ratio));
  b.style.width = w + 'px'; b.style.maxWidth = 'none'; b.style.margin = '0 ' + (sw - w) / 2 + 'px';
}
const pageOf = x => Math.floor((x - rd.scroll.getBoundingClientRect().left + rd.scroll.scrollLeft) / pg.stride + 0.002);
function rdLayout(){
  const {sw, sh, padX, padY} = rdDims(); if(!sw || !sh) return;
  pg.stride = sw;
  let sp = rd.scroll.querySelector(':scope > .pg-spacer');   // 넘길 수 있는 폭 = 쪽 수 × 화면폭(마지막 쪽이 오른쪽으로 밀리지 않게)
  if(!sp){ sp = document.createElement('div'); sp.className = 'pg-spacer'; sp.setAttribute('aria-hidden', 'true'); rd.scroll.appendChild(sp); }
  sp.style.width = '0px';
  if(rd.pdf){ const bs = rd.doc.querySelectorAll('.pdf-page'); bs.forEach(rdFitBox); pg.n = Math.max(1, bs.length); }
  else {
    const colW = Math.min(720, sw - padX * 2), gap = sw - colW, d = rd.doc.style;
    d.setProperty('--pg-w', colW + 'px'); d.setProperty('--pg-gap', gap + 'px'); d.setProperty('--pg-m', gap / 2 + 'px');
    d.setProperty('--pg-h', Math.max(80, sh - padY * 2) + 'px'); d.setProperty('--pg-t', padY + 'px');
    rd.anchors = null;
    let n = Math.round(rd.scroll.scrollWidth / sw);
    const last = rd.doc.lastElementChild;
    if(last){ const rs = last.getClientRects(); if(rs.length) n = Math.max(n, pageOf(rs[rs.length - 1].left) + 1); }
    pg.n = Math.max(1, n);
  }
  sp.style.width = pg.n * sw + 'px';
  if(pg.cur > pg.n - 1) pg.cur = pg.n - 1;
}
function rdShow(k, smooth){
  pg.cur = Math.max(0, Math.min(pg.n - 1, k));
  const left = pg.cur * pg.stride;
  if(smooth && !reduceMotion()) rd.scroll.scrollTo({left, behavior: 'smooth'}); else rd.scroll.scrollLeft = left;
  if(!rd.el.hidden && (rd.pdf || rd.doc.querySelector(ANCH))) $('#rdInfo').textContent = (pg.cur + 1) + ' / ' + pg.n + '쪽';
}
/* 손으로 넘길 때: 쪽을 옮기고 그 쪽의 맨 앞 글을 기억 */
function rdTurn(k){
  rd.el.classList.remove('peek');
  if(k < 0 || k > pg.n - 1){ rdShow(pg.cur, true); return; }
  rdShow(k, true);
  const p = rdPosNow(); if(p) pg.anchor = p.pos;
}
function rdRelayout(){
  if(rd.el.hidden) return;
  rdLayout();
  if(pg.anchor) rdGoPos(pg.anchor); else rdShow(pg.cur, false);
}
let relayT = null;
const rdRelayoutSoon = () => { clearTimeout(relayT); relayT = setTimeout(rdRelayout, 80); };
new ResizeObserver(() => { if(!rd.el.hidden) rdRelayoutSoon(); }).observe(rd.scroll);
rd.doc.addEventListener('load', e => { if(e.target.tagName === 'IMG') rdRelayoutSoon(); }, true);   // 그림이 들어오면 쪽이 바뀐다
if(document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { if(!rd.el.hidden) rdRelayoutSoon(); });
// 누르기: 왼쪽 30% 앞 쪽, 오른쪽 30% 다음 쪽, 가운데는 띠
rd.scroll.addEventListener('click', e => {
  if(e.target.closest('button, a')) return;
  const sel = getSelection(); if(sel && String(sel).trim()) return;   // 글을 고르는 중이면 그대로
  const r = rd.scroll.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
  if(x < 0.3) rdTurn(pg.cur - 1);
  else if(x > 0.7) rdTurn(pg.cur + 1);
  else if(!rd.el.classList.contains('full')) rdSetFull(true);
  else rd.el.classList.toggle('peek');
});
// 쓸기: 손가락을 따라 옆으로 움직이다가, 충분히 쓸었으면 다음·앞 쪽으로, 아니면 제자리로
let sw0 = null;
rd.scroll.addEventListener('touchstart', e => { if(e.touches.length !== 1){ sw0 = null; return; } const t = e.touches[0]; sw0 = {x: t.clientX, y: t.clientY, t: Date.now(), left: pg.cur * pg.stride, moved: false}; }, {passive: true});
rd.scroll.addEventListener('touchmove', e => {
  if(!sw0 || e.touches.length !== 1) return;
  const t = e.touches[0], dx = t.clientX - sw0.x, dy = t.clientY - sw0.y;
  if(!sw0.moved && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
  sw0.moved = true;
  if(Math.abs(dx) > Math.abs(dy)) rd.scroll.scrollLeft = sw0.left - dx;
}, {passive: true});
rd.scroll.addEventListener('touchend', e => {
  const s = sw0; sw0 = null; if(!s || !s.moved) return;   // 누르기는 click에서
  const t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y, v = Math.abs(dx) / Math.max(1, Date.now() - s.t);
  if(Math.abs(dx) > Math.abs(dy) && (Math.abs(dx) > pg.stride * 0.18 || v > 0.35)) rdTurn(pg.cur + (dx < 0 ? 1 : -1));
  else rdShow(pg.cur, true);
}, {passive: true});
rd.scroll.addEventListener('touchcancel', () => { if(sw0 && sw0.moved) rdShow(pg.cur, true); sw0 = null; }, {passive: true});
// 휠: 한 번 굴리면 한 쪽
let wheelAt = 0;
rd.scroll.addEventListener('wheel', e => {
  if(e.ctrlKey) return;   // 화면 확대는 브라우저에
  e.preventDefault();
  const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX, now = Date.now();
  if(Math.abs(d) < 4 || now - wheelAt < 380) return;
  wheelAt = now; rdTurn(pg.cur + (d > 0 ? 1 : -1));
}, {passive: false});
function rdClose(){
  rdSetFull(false);
  if(rd.libId){ rdSavePos(); const L = window.__lib; if(L) setTimeout(() => L.soon(1500), 300); }
  rdReset(); rd.el.hidden = true; if(!narrow()) paper.focus({preventScroll: true});
}
/* ---- 읽던 자리: 기기마다 화면 폭·글자 크기가 달라도 같은 데로 가도록 '몇 번째 문단의 어디쯤', PDF는 '몇 쪽의 어디쯤'으로 적는다 ---- */
const ANCH = 'p,h1,h2,h3,h4,h5,h6,li,pre,dt,dd,td,th,figcaption,img';
let rdPosT = null;
function rdMarks(){ return rd.pdf ? [...rd.doc.querySelectorAll('.pdf-page')] : (rd.anchors || (rd.anchors = [...rd.doc.querySelectorAll(ANCH)])); }
function rdPosNow(){
  const ms = rdMarks(); if(!ms.length || !pg.stride) return null;
  const cur = pg.cur;
  if(rd.pdf) return {pos: {pg: cur + 1, f: 0}, pct: Math.round((cur + 1) / ms.length * 100), pages: ms.length};
  if(cur === 0) return {pos: {a: -1}, pct: 0};
  const lastPage = el => { const rs = el.getClientRects(); return rs.length ? pageOf(rs[rs.length - 1].left) : -1; };
  let lo = 0, hi = ms.length - 1;   // 끝이 지금 쪽이거나 그 뒤인 첫 글 = 이 쪽 맨 위에 보이는 글
  while(lo < hi){ const m = (lo + hi) >> 1; if(lastPage(ms[m]) >= cur) hi = m; else lo = m + 1; }
  const pages = [...new Set([...ms[lo].getClientRects()].map(r => pageOf(r.left)))].sort((a, b) => a - b);
  const idx = Math.max(0, pages.indexOf(cur));
  return {pos: {a: lo, f: pages.length > 1 ? Math.round(idx / pages.length * 1000) / 1000 : 0}, pct: Math.round(cur / pg.n * 100)};
}
/* 적어 둔 자리로: 글이 여러 쪽에 걸쳐 있으면 f(몇 번째 조각쯤)로 그 쪽을 고른다 */
function rdGoPos(p){
  if(!p) return false;
  if(!pg.stride) rdLayout();
  pg.anchor = p;
  if(rd.pdf){ rdShow((p.pg || 1) - 1, false); return (p.pg || 1) > 1; }
  if(p.a === -1 || p.a == null){ rdShow(0, false); return false; }
  const el = rdMarks()[p.a]; if(!el){ rdShow(0, false); return false; }
  const pages = [...new Set([...el.getClientRects()].map(r => pageOf(r.left)))].sort((a, b) => a - b);
  if(!pages.length){ rdShow(0, false); return false; }
  rdShow(pages[Math.min(pages.length - 1, Math.floor((p.f || 0) * pages.length + 0.001))], false);
  return true;
}
function rdSavePos(){
  const L = window.__lib, id = rd.libId; if(!L || !id) return;
  const p = rdPosNow(); if(!p) return;
  L.setPos(id, p.pos, Object.assign({pct: p.pct}, p.pages ? {pages: p.pages} : {})).catch(() => {});
}
rd.scroll.addEventListener('scroll', () => { if(!rd.libId || rdPosT) return; rdPosT = setTimeout(() => { rdPosT = null; rdSavePos(); }, 700); });
for(const ev of ['wheel', 'touchstart', 'keydown', 'mousedown']) rd.scroll.addEventListener(ev, () => { rd.moved = true; }, {passive: true});
/* 서재에 두고, 읽던 자리가 있으면 그 쪽을 연다 */
async function rdRemember(f, token, info){
  const L = window.__lib; if(!L) return;
  try{
    const id = await L.rememberRd(f, info);
    if(rd.token !== token) return;
    rd.libId = id;
    const m = await L.meta(id);
    if(rd.token !== token) return;
    if(!(m && m.pos && !rd.moved && rdGoPos(m.pos))) rdSavePos();   // 그림이 늦게 들어와 쪽이 바뀌면 rdRelayout이 이 자리로 다시 맞춘다
  }catch(e){}
}
$('#rdClose').onclick = rdClose;
function rdOpen(name){
  rdReset(); W.closePops(); $('#toast').hidden = true;
  $('#rdName').textContent = name;
  for(const v of ['--font', '--lh']) rd.doc.style.setProperty(v, paper.style.getPropertyValue(v));
  rdFs(rdFsNow());
  $('#rdSize').hidden = false;
  rd.doc.innerHTML = '<p class="rd-wait">여는 중…</p>';
  rd.el.classList.add('paged');
  rd.el.hidden = false; rd.scroll.scrollTop = 0; rd.scroll.focus({preventScroll: true});
  rdLayout();
  if(narrow()) $('#app').classList.remove('drawer');
  return rd.token;
}
function rdText(paras){
  const frag = document.createDocumentFragment(); let chars = 0;
  for(const p of paras){
    const el = document.createElement('p'); const t = paraText(p);
    chars += t.replace(/\s/g, '').length;
    if(isChap(p)) el.className = 'chap'; else if(isSep(t)) el.className = 'rc';
    if(!p.runs.length) el.appendChild(document.createElement('br'));
    for(const r of p.runs){
      let n = document.createTextNode(r.t.replace(/\t/g, ' '));
      if(r.r && r.r > 0.3 && r.r < 6){ const x = document.createElement('span'); x.style.fontSize = r.r + 'em'; x.appendChild(n); n = x; }
      if(r.i){ const x = document.createElement('i'); x.appendChild(n); n = x; }
      if(r.b){ const x = document.createElement('b'); x.appendChild(n); n = x; }
      el.appendChild(n);
    }
    frag.appendChild(el);
  }
  rd.doc.textContent = ''; rd.doc.classList.toggle('indent', !!W.prefs.indent); rd.doc.appendChild(frag);
  $('#rdInfo').textContent = chars.toLocaleString() + '자';
}
/* ---- EPUB: 차례(spine) 순서대로 글과 그림만 옮긴다. 책의 스타일·스크립트는 쓰지 않는다
   (책 CSS에서 '여기서 새 쪽'(page-break-·break-before/after) 규칙만 읽어 장이 새 쪽에서 시작하게 한다) ---- */
const MIME = {jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml'};
const DROP = new Set(['script', 'style', 'head', 'link', 'meta', 'iframe', 'object', 'embed', 'audio', 'video', 'form', 'input', 'button', 'select', 'textarea', 'title', 'noscript', 'template', 'canvas']);
const KEEP = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'br', 'hr', 'span', 'em', 'i', 'b', 'strong', 'u', 'sup', 'sub', 'small', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'pre', 'code', 'figure', 'figcaption', 'dl', 'dt', 'dd', 'ruby', 'rt', 'rp']);
const INL = new Set(['br', 'span', 'em', 'i', 'b', 'strong', 'u', 'sup', 'sub', 'small', 'code', 'ruby', 'rt', 'rp', 'img']);
const BRK_V = '(?:always|page|left|right|recto|verso)';
const BRK_B = new RegExp('[;{\\s](?:page-)?break-before\\s*:\\s*' + BRK_V, 'i'), BRK_A = new RegExp('[;{\\s](?:page-)?break-after\\s*:\\s*' + BRK_V, 'i');
/* CSS 글에서 새 쪽 규칙의 선택자만: {b: 앞에서 나눔, a: 뒤에서 나눔}. @import는 따라가고 @media 안 규칙도 읽는다 */
async function cssBreaks(z, text, base, memo, depth){
  const out = {b: [], a: []};
  text = String(text || '').replace(/\/\*[\s\S]*?\*\//g, '');
  if(depth < 3) for(const m of text.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)){
    const r = await cssFile(z, resolvePath(base, m[1]), memo, depth + 1); out.b.push(...r.b); out.a.push(...r.a);
  }
  text = text.replace(/@(?:import|charset|namespace)[^;{}]*;/gi, '')
    .replace(/@media([^{]*)\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/gi, (m, q, body) => /print/i.test(q) && !/screen|all|handheld|amzn/i.test(q) ? '' : body);   // 인쇄용 규칙은 뺀다
  for(const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
    const sel = m[1].trim(), d = ';' + m[2]; if(!sel || sel[0] === '@') continue;
    if(BRK_B.test(d)) out.b.push(sel);
    if(BRK_A.test(d)) out.a.push(sel);
  }
  return out;
}
function cssFile(z, path, memo, depth){
  if(!path) return Promise.resolve({b: [], a: []});
  if(!memo.has(path)) memo.set(path, z.text(path).then(t => t == null ? {b: [], a: []} : cssBreaks(z, t, path, memo, depth)));
  return memo.get(path);
}
async function fileBreaks(z, body, href, memo){
  const dom = body.ownerDocument, rules = [], brk = {b: new Set(), a: new Set()};
  for(const l of dom.getElementsByTagNameNS('*', 'link')) if(/stylesheet/i.test(l.getAttribute('rel') || '') && !/alternate/i.test(l.getAttribute('rel'))) rules.push(cssFile(z, resolvePath(href, l.getAttribute('href')), memo, 0));
  for(const st of dom.getElementsByTagNameNS('*', 'style')) rules.push(cssBreaks(z, st.textContent, href, memo, 0));
  for(const r of await Promise.all(rules)) for(const k of ['b', 'a']) for(const sel of r[k]){ try{ for(const e of body.querySelectorAll(sel)) brk[k].add(e); }catch(e){} }
  return brk;
}
/* 나눔이 둘 겹치거나 앞뒤에 글이 없으면 빈 쪽이 생기므로, 글·그림 사이에 있는 나눔만 남긴다 */
function tidyBreaks(root){
  let seen = false, pend = null, lastB = null; const open = [];
  const endOf = e => { if(seen && !pend){ pend = e; } else e.classList.remove('pa'); };
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for(let n = w.nextNode(); n; n = w.nextNode()){
    while(open.length && !open[open.length - 1].contains(n)) endOf(open.pop());
    if(n.nodeType === 3 || n.localName === 'img'){
      if(n.nodeType === 3 && !n.nodeValue.trim()) continue;
      seen = true; pend = null; lastB = null; continue;
    }
    if(n.classList.contains('pb')){
      if(pend){ pend.classList.remove('pa'); pend = null; seen = false; lastB = n; }
      else if(seen){ seen = false; lastB = n; }
      else n.classList.remove('pb');
    }
    if(n.classList.contains('pa')) open.push(n);
  }
  while(open.length) endOf(open.pop());
  if(pend) pend.classList.remove('pa');
  if(lastB) lastB.classList.remove('pb');
}
/* 책에 새 쪽 규칙이 하나도 없을 때: 두 번 넘게 나오는 가장 큰 제목 단계를 장 제목으로 보고, 그 앞에 글이 있으면 새 쪽 */
function headBreaks(parts){
  const cnt = [0, 0, 0, 0, 0, 0, 0];
  for(const p of parts) for(const h of p.querySelectorAll('h1,h2,h3,h4,h5,h6')) cnt[+h.localName[1]]++;
  const L = cnt.findIndex((c, i) => i > 0 && c >= 2); if(L < 1) return;
  for(const p of parts){
    let seen = false; const w = document.createTreeWalker(p, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for(let n = w.nextNode(); n; n = w.nextNode()){
      if(n.nodeType === 3){ if(n.nodeValue.trim() && !n.parentNode.closest('h1,h2,h3,h4,h5,h6')) seen = true; }
      else if(n.localName === 'img') seen = true;
      else if(/^h[1-6]$/.test(n.localName) && +n.localName[1] <= L){ if(seen) n.classList.add('pb'); seen = false; }
    }
  }
}
function resolvePath(base, href){
  href = String(href || '').split('#')[0].split('?')[0];
  try{ href = decodeURIComponent(href); }catch(e){}
  if(/^[a-z]+:/i.test(href)) return null;
  const parts = href.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for(const seg of href.split('/')){ if(seg === '..') parts.pop(); else if(seg && seg !== '.') parts.push(seg); }
  return parts.join('/');
}
/* EPUB 꾸러미 열기: 차례(spine)·책 정보(OPF). 잠긴 책(DRM)은 여기서 막는다 */
async function epubPkg(f){
  let z;
  try{ z = await Hangul.unzip(await f.arrayBuffer()); }catch(e){ throw new Error('epub_bad'); }
  const cont = await z.text('META-INF/container.xml'); if(!cont) throw new Error('epub_bad');
  const XP = new DOMParser();
  const rf = XP.parseFromString(cont, 'application/xml').getElementsByTagNameNS('*', 'rootfile')[0];
  const opfPath = rf && rf.getAttribute('full-path'); const opfText = opfPath && await z.text(opfPath);
  if(!opfText) throw new Error('epub_bad');
  const opf = XP.parseFromString(opfText, 'application/xml');
  const items = new Map();
  for(const it of opf.getElementsByTagNameNS('*', 'item')) items.set(it.getAttribute('id'), {href: resolvePath(opfPath, it.getAttribute('href')), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || ''});
  const spine = [...opf.getElementsByTagNameNS('*', 'itemref')].map(r => ({it: items.get(r.getAttribute('idref')), linear: r.getAttribute('linear') !== 'no'})).filter(x => x.it && x.it.href);
  if(!spine.length) throw new Error('epub_bad');
  // 잠금: 본문 파일이 암호화 목록에 있으면 DRM (글꼴만 가린 책은 괜찮다)
  if(z.names.includes('META-INF/rights.xml')) throw new Error('epub_drm');
  const encX = await z.text('META-INF/encryption.xml');
  if(encX){
    const locked = new Set([...XP.parseFromString(encX, 'application/xml').getElementsByTagNameNS('*', 'CipherReference')].map(c => resolvePath('', c.getAttribute('URI'))));
    if(spine.some(s => locked.has(s.it.href))) throw new Error('epub_drm');
  }
  const meta = tag => { const e = opf.getElementsByTagNameNS('*', tag)[0]; return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; };
  return {z, XP, spine, opf, items, title: meta('title'), author: meta('creator'), lang: meta('language')};
}
/* 책의 차례(목차): EPUB3 nav(epub:type="toc")가 둘 넘게 가리키면 그것, 아니면 EPUB2 NCX → [{file, frag, label}] 읽는 순서대로 */
async function epubToc(pkg){
  const {z, XP, opf, items} = pkg, out = [];
  const push = (base, href, label) => {
    if(!href) return; const file = resolvePath(base, href); if(!file) return;
    let frag = String(href).split('#')[1] || ''; try{ frag = decodeURIComponent(frag); }catch(e){}
    out.push({file, frag, label: String(label || '').replace(/\s+/g, ' ').trim()});
  };
  try{
    const nav = [...items.values()].find(it => /\bnav\b/.test(it.props)), t = nav && await z.text(nav.href);
    if(t){
      const d = spineDoc(XP, t).ownerDocument, navs = [...d.getElementsByTagNameNS('*', 'nav')];
      const toc = navs.find(n => /\btoc\b/.test(n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || n.getAttribute('epub:type') || '')) || navs[0];
      if(toc) for(const a of toc.getElementsByTagNameNS('*', 'a')) push(nav.href, a.getAttribute('href'), a.textContent);
    }
    if(out.length < 2){
      out.length = 0;
      const sp = opf.getElementsByTagNameNS('*', 'spine')[0], tid = sp && sp.getAttribute('toc');
      const ncx = (tid && items.get(tid)) || [...items.values()].find(it => /dtbncx/.test(it.type)), x = ncx && await z.text(ncx.href);
      if(x) for(const np of XP.parseFromString(x, 'application/xml').getElementsByTagNameNS('*', 'navPoint')){
        const kid = name => [...np.childNodes].find(c => c.localName === name);
        const lab = kid('navLabel'), con = kid('content');
        push(ncx.href, con && con.getAttribute('src'), lab && lab.textContent);
      }
    }
  }catch(e){ return []; }
  return out;
}
const spineDoc = (XP, text) => {
  let d = XP.parseFromString(text, 'application/xhtml+xml');
  if(d.getElementsByTagName('parsererror').length) d = XP.parseFromString(text, 'text/html');
  return d.getElementsByTagNameNS('*', 'body')[0] || d.documentElement;
};
async function rdEpub(f, token){
  const {z, XP, spine, title} = await epubPkg(f);
  const blobUrl = new Map();
  async function img(path){
    if(!path) return null;
    if(blobUrl.has(path)) return blobUrl.get(path);
    const data = await z.get(path); if(!data) return null;
    const u = URL.createObjectURL(new Blob([data], {type: MIME[extOf(path)] || 'application/octet-stream'}));
    rd.urls.push(u); blobUrl.set(path, u); return u;
  }
  function styleClass(el){
    const st = (el.getAttribute('style') || '').replace(/\s+/g, '').toLowerCase(), c = [];
    if(/text-align:center/.test(st) || el.getAttribute('align') === 'center') c.push('rc');
    else if(/text-align:right/.test(st)) c.push('rr');
    if(/display:table/.test(st) && /margin:0auto/.test(st)) c.push('rt');
    return c.join(' ');
  }
  let brk = {b: new Set(), a: new Set()}; const memo = new Map();
  async function clean(src, out, base){
    for(const n of src.childNodes){
      if(n.nodeType === 3){ out.appendChild(document.createTextNode(n.nodeValue)); continue; }
      if(n.nodeType !== 1) continue;
      const tag = n.localName.toLowerCase();
      if(DROP.has(tag)) continue;
      if(tag === 'img' || tag === 'image'){
        const u = await img(resolvePath(base, n.getAttribute('src') || n.getAttribute('xlink:href') || n.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || n.getAttribute('href')));
        if(u){ const e = document.createElement('img'); e.src = u; e.alt = n.getAttribute('alt') || ''; out.appendChild(e); }
        continue;
      }
      if(tag === 'svg'){ await clean(n, out, base); continue; }
      const e = document.createElement(KEEP.has(tag) ? tag : (tag === 'a' ? 'span' : 'div'));
      let c = styleClass(n);
      if(!INL.has(e.localName)){
        const st = ';' + (n.getAttribute('style') || '');
        if(brk.b.has(n) || BRK_B.test(st)) c += ' pb';
        if(brk.a.has(n) || BRK_A.test(st)) c += ' pa';
      }
      c = c.trim(); if(c) e.className = c;
      await clean(n, e, base);
      if(KEEP.has(tag) || e.childNodes.length) out.appendChild(e);
    }
  }
  const frag = document.createDocumentFragment(), parts = [];
  for(const s of spine){
    if(!s.linear || /\bnav\b/.test(s.it.props)) continue;
    const text = await z.text(s.it.href); if(text == null) continue;
    const body = spineDoc(XP, text);
    brk = await fileBreaks(z, body, s.it.href, memo);   // 이 파일에 걸린 책 CSS(link·style)의 새 쪽 규칙을 원래 요소에 표시해 둔다
    const part = document.createElement('div'); part.className = 'rd-part';
    await clean(body, part, s.it.href);
    if(rd.token !== token) return;
    if(part.textContent.trim() || part.querySelector('img')){ frag.appendChild(part); parts.push(part); }
  }
  if(!parts.length) throw new Error('empty');
  // 장 나눔: 책 규칙이 없으면 제목으로 짐작, 파일마다 새 쪽, 빈 쪽이 생기는 나눔은 뺌
  if(!frag.querySelector('.pb,.pa')) headBreaks(parts);
  parts.forEach((p, i) => { if(i) p.classList.add('pb'); });
  tidyBreaks(frag);
  rd.doc.textContent = ''; rd.doc.classList.add('indent'); rd.doc.appendChild(frag);
  return title;
}
/* ---- EPUB → 문단 모델: 원고로 바꾸기·번역 모드가 쓴다 ----
   차례 순서대로 글만 문단으로 옮긴다. 제목 태그(h1~h6)는 장 제목(chap), <hr>는 별표 줄(sep), 그림·표 모양·스타일은 버린다.
   기울임·굵게는 살린다. 구텐베르크 책 앞뒤의 안내·약관 글에는 pg를 붙여 둔다(번역 모드는 건너뛴다).
   → {title, author, lang, paras: [{runs:[{t,b,i}], chap, lv, sep, pg}]} */
const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'dt', 'dd', 'td', 'th', 'figcaption', 'caption', 'section', 'article', 'header', 'footer', 'aside', 'nav', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'ul', 'ol', 'dl', 'figure', 'center', 'address', 'body', 'main', 'hgroup']);
const SKIP = new Set(['img', 'image', 'svg', 'math', 'rt', 'rp']);
const PG_START = /\*{3}\s*START OF (THE|THIS) PROJECT GUTENBERG/i, PG_END = /\*{3}\s*END OF (THE|THIS) PROJECT GUTENBERG/i;
async function epubBook(f){
  const pkg = await epubPkg(f), paras = [];
  // 장 시작(k): 책 차례가 가리키는 자리. 쓸 만한 차례가 없으면 파일 첫머리와 책 CSS의 새 쪽 규칙.
  // 문단을 나누는 방식·글은 바꾸지 않는다(번역 모드의 책 번호가 글로 정해지므로)
  const lin = new Set(pkg.spine.filter(s => s.linear && !/\bnav\b/.test(s.it.props)).map(s => s.it.href));
  const toc = (await epubToc(pkg)).filter(e => lin.has(e.file)), useToc = toc.length >= 2, memo = new Map();
  let pend = null, tg = null, brkB = null;
  const mark = lab => { if(!pend) pend = []; if(lab && !pend.includes(lab)) pend.push(lab); };
  let cur = null;
  const end = () => {
    if(!cur) return;
    const rs = cur.runs;
    if(rs.length){ rs[0].t = rs[0].t.replace(/^\s+/, ''); rs[rs.length - 1].t = rs[rs.length - 1].t.replace(/\s+$/, ''); }
    cur.runs = rs.filter(r => r.t);
    if(cur.runs.some(r => r.t.trim())) paras.push(cur);
    cur = null;
  };
  const add = (t, c) => {
    if(!cur){
      if(!t.trim()) return;
      cur = {runs: [], chap: !!c.h, lv: c.h || 0, sep: false, pg: c.pg}; t = t.replace(/^\s+/, '');
      if(pend){ cur.k = 1; if(pend.length) cur.kt = pend.join(' ').slice(0, 120); pend = null; }
    }
    const l = cur.runs[cur.runs.length - 1];
    if(l && l.b === c.b && l.i === c.i) l.t += t; else cur.runs.push({t, b: c.b, i: c.i});
  };
  function walk(node, c){
    for(const n of node.childNodes){
      if(n.nodeType === 3){
        if(c.pre){ n.nodeValue.split('\n').forEach((ln, k) => { if(k) end(); add(ln.replace(/\t/g, ' '), c); }); }
        else add(n.nodeValue.replace(/[ \t\n\r\f]+/g, ' '), c);
        continue;
      }
      if(n.nodeType !== 1) continue;
      const tag = n.localName.toLowerCase();
      if(DROP.has(tag) || SKIP.has(tag)) continue;
      if(tag === 'br'){ if(c.h) add(' ', c); else end(); continue; }
      if(tag === 'hr'){ end(); paras.push({runs: [{t: '* * *', b: false, i: false}], chap: false, lv: 0, sep: true, pg: c.pg}); continue; }
      const id = n.getAttribute('id') || '', cls = n.getAttribute('class') || '';
      if(tg){ const ls = (id && tg.get(id)) || (n.getAttribute('name') && tg.get(n.getAttribute('name'))); if(ls) ls.forEach(mark); }
      if(brkB && (brkB.has(n) || BRK_B.test(';' + (n.getAttribute('style') || '')))) mark('');
      const k = Object.assign({}, c);
      if(/\b(pagenum|pageno|page-?number)\b/i.test(cls)) continue;   // 종이책 쪽 번호 표시는 버린다
      if(/^pg-(header|footer)/i.test(id) || /\bpg-boilerplate\b/i.test(cls)) k.pg = true;
      if(/^h[1-6]$/.test(tag)) k.h = +tag[1];
      if(tag === 'i' || tag === 'em' || tag === 'cite' || tag === 'dfn' || tag === 'var') k.i = true;
      if(tag === 'b' || tag === 'strong') k.b = true;
      if(tag === 'pre') k.pre = true;
      if(BLOCK.has(tag)){ end(); walk(n, k); end(); } else walk(n, k);
    }
  }
  for(const s of pkg.spine){
    if(!s.linear || /\bnav\b/.test(s.it.props)) continue;
    const text = await pkg.z.text(s.it.href); if(text == null) continue;
    const body = spineDoc(pkg.XP, text);
    if(useToc){
      tg = new Map();
      for(const e of toc) if(e.file === s.it.href){
        if(!e.frag || e.frag === body.getAttribute('id')) mark(e.label);
        else { if(!tg.has(e.frag)) tg.set(e.frag, []); tg.get(e.frag).push(e.label); }
      }
    } else { mark(''); brkB = (await fileBreaks(pkg.z, body, s.it.href, memo)).b; }
    walk(body, {b: false, i: false, h: 0, pre: false, pg: false});
    end();
  }
  // 옛 구텐베르크 책: '*** START OF …' 앞과 '*** END OF …' 뒤가 안내·약관 글
  const si = paras.findIndex(p => PG_START.test(paraText(p))), ei = paras.findIndex(p => PG_END.test(paraText(p)));
  if(si >= 0) for(let k = 0; k <= si; k++) paras[k].pg = true;
  if(ei >= 0) for(let k = ei; k < paras.length; k++) paras[k].pg = true;
  // 별표 줄 정리: 처음·끝, 잇달아 나온 것, 장 제목 바로 앞뒤의 것은 뺀다
  const out = [];
  for(let k = 0; k < paras.length; k++){
    const p = paras[k];
    if(p.sep){
      const prev = out[out.length - 1], next = paras.slice(k + 1).find(x => !x.sep);
      if(!prev || prev.sep || prev.chap || !next || next.chap || !!next.pg !== !!p.pg) continue;
    }
    out.push(p);
  }
  if(!out.length) throw new Error('empty');
  if(!useToc){
    // 차례 없이 파일·CSS로 짐작한 장: 제목 태그로 장이 나뉘는 책은 그것만 쓰고(파일 경계가 장 중간일 수 있다),
    // 아니면 장 첫 문단이 짧고 문장 같지 않으면(끝에 마침표·따옴표 없음) 장 제목으로
    if(out.some(p => p.chap)) out.forEach(p => { delete p.k; });
    else out.forEach(p => { if(!p.k || p.sep) return; const t = paraText(p).trim(); if(t.length <= 50 && !/[.!?,;:…”"’)\]]$/.test(t) && !/^[“"‘'(\[]/.test(t)) p.h = 1; });
  }
  // 차례 이름과 글이 같은 짧은 문단(제목 태그가 아닌 장 제목, 「CHAPTER I.」 + 「Down the Rabbit-Hole」처럼 둘로 나뉜 것도)은 h
  const norm = t => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  out.forEach((p, i) => {
    if(!p.k || !p.kt) return;
    let rest = norm(p.kt);
    for(let j = i; j < out.length && j < i + 3; j++){
      const q = out[j]; if(j > i && q.k) break;
      const raw = paraText(q).trim(), t = norm(raw);
      if(q.sep || !t || raw.length > 120 || !rest.includes(t)) break;
      q.h = 1; rest = rest.replace(t, '');
    }
  });
  return {title: pkg.title || stemOf(f.name), author: pkg.author, lang: pkg.lang, paras: out};
}
async function isEpubFile(f){
  const kind = await sniff(f);
  return kind === 'zip' && (extOf(f.name) === 'epub' || await isEpub(f));
}
/* 편집 가능 문서로 바꿀 책: EPUB과 PDF */
async function isBookFile(f){ return (await sniff(f)) === 'pdf' || await isEpubFile(f); }

/* ---- PDF → 문단 모델: 글이 들어 있는 PDF에서 글을 뽑아 문단을 다시 세운다(편집 가능 문서·번역 모드) ----
   같은 높이의 글 조각을 한 줄로 모으고, 줄을 문단으로 잇는다. 새 문단: 줄 간격이 벌어짐 · 들여 쓴 줄 · 앞줄이 짧게 끝남.
   쪽마다 같은 자리에 되풀이되는 머리글·꼬리글과 쪽 번호는 뺀다. 본문보다 15% 넘게 큰 짧은 줄은 장 제목.
   줄을 이을 때: 영어 줄 끝 하이픈은 붙이고, 한글은 문서 전체의 줄 끝 글자를 보고 어절에서 끊긴 문서(띄어 이음)인지
   글자에서 끊긴 문서(붙여 이음)인지 가린다. 굵게·기울임은 살리지 못한다. 스캔한 PDF는 글이 없어 pdf_scan. */
const HANGUL = /[\uAC00-\uD7A3]/;
const WORD_END = new Set('다고를을은는이가의에서도로며면지게만와과요네니까죠야해던한할된될인들께며나라랑데듯처럼고요라서여'.split(''));
// 글자에서 끊긴 문서라도 줄 끝이 이 조사·어미면 낱말이 끝난 자리로 보고 띄어 잇는다(PDF에 띄어쓰기가 안 남은 줄바꿈)
const SURE_END = new Set('는를을은의에로와과도께며면듯서고'.split(''));
function pdfLines(items){
  const lines = []; let cur = null;
  const push = () => {
    if(!cur) return;
    const raw = cur.text, text = raw.replace(/\s+/g, ' ').trim();
    if(text) lines.push({x: cur.x, y: cur.y, end: cur.end, size: cur.n ? cur.sz / cur.n : cur.size, text, sp: /\s$/.test(raw)});
    cur = null;
  };
  for(const it of items){
    if(typeof it.str !== 'string') continue;
    const t = it.transform, x = t[4], y = t[5], size = Math.hypot(t[2], t[3]) || it.height || 10;
    if(it.str){
      if(cur && Math.abs(y - cur.y) > Math.max(size, cur.size) * 0.5) push();
      if(!cur) cur = {x, y, end: x, size, text: '', sz: 0, n: 0};
      else {
        const gap = x - cur.end;
        if(gap > size * 0.2 && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) cur.text += ' ';
        if(x < cur.x) cur.x = x;
      }
      cur.text += it.str; cur.end = Math.max(cur.end, x + (it.width || 0));
      const len = it.str.trim().length; cur.sz += size * len; cur.n += len;
    }
    if(it.hasEOL) push();
  }
  push();
  return lines;
}
const median = a => { if(!a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
const PAGE_NO = /^[\s\-–—·|()[\]]*(\d{1,4}|[ivxlcdm]{1,7})[\s\-–—·|()[\]]*$/i;
async function pdfBook(f, onProgress){
  const {lib, at} = await loadPdfLib();
  let pdf;
  try{ pdf = await lib.getDocument({data: new Uint8Array(await f.arrayBuffer()), cMapUrl: at('cmaps/'), cMapPacked: true, standardFontDataUrl: at('standard_fonts/'), wasmUrl: at('wasm/')}).promise; }
  catch(e){ throw new Error(e && e.name === 'PasswordException' ? 'pdf_password' : 'pdf_bad'); }
  let title = '', pages = [];
  try{
    try{ const md = await pdf.getMetadata(); title = String((md && md.info && md.info.Title) || '').trim(); }catch(e){}
    for(let i = 1; i <= pdf.numPages; i++){
      const page = await pdf.getPage(i), tc = await page.getTextContent();
      pages.push(pdfLines(tc.items).sort((a, b) => b.y - a.y || a.x - b.x));
      page.cleanup();
      if(onProgress) onProgress(i, pdf.numPages);
    }
  }finally{ pdfFree(pdf); }
  const chars = pages.reduce((s, ls) => s + ls.reduce((t, l) => t + l.text.length, 0), 0);
  if(chars < Math.max(20, pages.length * 15)) throw new Error('pdf_scan');
  // 머리글·꼬리글: 쪽의 맨 위·맨 아래 두 줄 가운데 여러 쪽에 되풀이되는 것(숫자는 빼고 견줌)과 쪽 번호만 있는 줄
  const key = l => l.text.replace(/\d+/g, '#').replace(/\s+/g, '');
  const edge = ls => new Set([0, 1, ls.length - 2, ls.length - 1].filter(k => k >= 0 && k < ls.length));
  const cnt = new Map();
  pages.forEach(ls => { const seen = new Set(); for(const k of edge(ls)){ const kk = key(ls[k]); if(!seen.has(kk)){ seen.add(kk); cnt.set(kk, (cnt.get(kk) || 0) + 1); } } });
  const rep = Math.max(2, Math.ceil(pages.length * 0.3));
  pages = pages.map(ls => { const e = edge(ls); return ls.filter((l, k) => !(e.has(k) && (PAGE_NO.test(l.text) || (pages.length >= 2 && cnt.get(key(l)) >= rep)))); });
  const all = [].concat(...pages);
  if(!all.length) throw new Error('pdf_scan');
  const body = median(all.filter(l => l.text.length > 8).map(l => Math.round(l.size * 10) / 10)) || median(all.map(l => l.size)) || 10;
  // 한글 줄 끝이 어절에서 끊겼나: 줄 끝 글자가 낱말 끝에 흔한 글자인 비율
  let hk = 0, hEnd = 0;
  for(const l of all){ const c = l.text.slice(-1); if(HANGUL.test(c) && !l.sp){ hk++; if(WORD_END.has(c)) hEnd++; } }
  const tight = hk >= 20 && hEnd / hk < 0.5;
  const join = (s, l) => {
    if(!s) return l.text;
    if(/[A-Za-z]-$/.test(s) && /^[a-z]/.test(l.text)) return s.slice(0, -1) + l.text;
    if(tight && HANGUL.test(s.slice(-1)) && /^[\uAC00-\uD7A3]/.test(l.text) && !l.prevSp && !SURE_END.has(s.slice(-1))) return s + l.text;
    return s + ' ' + l.text;
  };
  const paras = []; let cur = null, prev = null;
  const close = () => { if(cur && cur.text) paras.push({runs: [{t: cur.text, b: false, i: false}], chap: false, sep: false}); cur = null; };
  pages.forEach((ls, pi) => {
    const bl = ls.filter(l => Math.abs(l.size - body) < body * 0.15);
    const xs = new Map(); for(const l of bl){ const k = Math.round(l.x); xs.set(k, (xs.get(k) || 0) + 1); }
    const left = xs.size ? +[...xs.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0] : (ls[0] ? ls[0].x : 0);
    const ends = bl.map(l => l.end).sort((a, b) => a - b), right = ends.length ? ends[Math.floor(ends.length * 0.9)] : 0;
    const gaps = []; for(let k = 1; k < bl.length; k++){ const d = bl[k - 1].y - bl[k].y; if(d > 0 && d < body * 4) gaps.push(d); }
    const gap = median(gaps) || body * 1.6;
    for(const l of ls){
      if(isSep(l.text)){ close(); paras.push({runs: [{t: '* * *', b: false, i: false}], chap: false, sep: true}); prev = null; continue; }
      if(l.size > body * 1.15 && l.text.length <= 80){   // 본문보다 15% 넘게 큰 짧은 줄: 장 제목(두 줄이면 하나로)
        const last = paras[paras.length - 1];
        if(!cur && last && last.chap && prev && prev.big && prev.pi === pi && prev.y - l.y < l.size * 2.2) last.runs[0].t += ' ' + l.text;
        else { close(); paras.push({runs: [{t: l.text, b: false, i: false}], chap: true, sep: false}); }
        prev = Object.assign({}, l, {pi, big: true, right}); continue;
      }
      let start = !cur;
      if(cur && prev){
        if(prev.pi === pi && prev.y - l.y > gap * 1.5) start = true;                                   // 줄 간격이 벌어짐
        if(l.x > left + body * 0.6 && l.x < left + body * 8) start = true;                              // 들여 쓴 줄
        if(prev.right && prev.end < prev.right - body * 2.5) start = true;                              // 앞줄이 짧게 끝남
        if(prev.big) start = true;
      }
      if(start){ close(); cur = {text: ''}; }
      cur.text = join(cur.text, Object.assign({}, l, {prevSp: prev && prev.sp}));
      prev = Object.assign({}, l, {pi, big: false, right});
    }
  });
  close();
  if(!paras.length) throw new Error('pdf_scan');
  return {title: title || stemOf(f.name), author: '', lang: '', paras};
}

/* EPUB·PDF → 편집할 수 있는 원고. 책의 글은 그대로 옮기고(장 제목·별표, EPUB은 기울임·굵게도), 원고 목록에 새로 만든다 */
async function epubsToMs(fs, from){
  W.closePops(); toast('글을 읽는 중…', 60000);
  const made = [], bad = [];
  for(const f of fs){
    try{
      const isPdf = (await sniff(f)) === 'pdf';
      const bk = isPdf ? await pdfBook(f, (i, n) => { if(n > 20 && i % 10 === 0) toast('PDF에서 글을 뽑는 중… ' + i + ' / ' + n + '쪽', 60000); }) : await epubBook(f);
      const paras = bk.paras.map(p => ({runs: p.runs, chap: !!p.chap}));
      const chars = paras.reduce((s, p) => s + paraText(p).replace(/\s/g, '').length, 0);
      await W.newMs(bk.title, W.parasToHtml(paras));
      made.push({title: bk.title, chaps: paras.filter(p => p.chap).length, chars, pdf: isPdf});
    }catch(e){ bad.push(f.name + ': ' + errText(e)); }
  }
  $('#toast').hidden = true;
  if(!made.length){ toast(bad[0] || '읽을 수 있는 파일이 없습니다', 9000); return 0; }
  const m = made[0], drive = from === 'drive' && W.Drive.enabled();
  const msg = made.length === 1
    ? '「' + m.title + '」을(를) 원고로 열었습니다 · ' + (m.chaps ? '장 제목 ' + m.chaps + '개 · ' : '') + m.chars.toLocaleString() + '자. 이제 고칠 수 있고, 저장 메뉴에서 한글·워드 파일로도 저장됩니다.' + (m.pdf ? ' PDF에서 뽑은 글이라 문단 나눔이 원본과 조금 다를 수 있고, 굵게·기울임은 빠집니다.' : '')
    : made.length + '개를 원고로 열었습니다. 원고 목록에 있습니다.';
  if(made.length === 1) W.notice(msg + (bad.length ? ' (읽지 못한 파일 ' + bad.length + '개)' : ''), drive ? '드라이브에 한글 파일로 저장' : '한글 파일로 저장', () => { $('#notice').hidden = true; $(drive ? '#dvHwpx' : '#exHwpx').click(); });
  else W.notice(msg + (bad.length ? ' 읽지 못한 파일 ' + bad.length + '개는 뺐습니다 — ' + bad[0] : ''));
  return made.length;
}
/* ---- PDF: 쪽 모양 그대로. 보이는 쪽만 그리고, 멀어진 쪽은 지운다 ---- */
let pdfLib = null;
/* pdf.js 6에는 문서의 destroy가 없고 불러오기 작업(loadingTask)에 있다 */
const pdfFree = pdf => { try{ const t = pdf && (pdf.loadingTask || pdf); if(t && t.destroy) t.destroy(); }catch(e){} };
async function loadPdfLib(){
  if(pdfLib) return pdfLib;
  const at = p => new URL('vendor/pdfjs/' + p, document.baseURI).href;
  try{
    const lib = await import(at('pdf.min.mjs'));
    lib.GlobalWorkerOptions.workerSrc = at('pdf.worker.min.mjs');
    pdfLib = {lib, at};
  }catch(e){ throw new Error('pdf_lib'); }
  return pdfLib;
}
async function rdPdf(f, token){
  const {lib, at} = await loadPdfLib();
  let pdf;
  try{
    pdf = await lib.getDocument({data: new Uint8Array(await f.arrayBuffer()), cMapUrl: at('cmaps/'), cMapPacked: true, standardFontDataUrl: at('standard_fonts/'), wasmUrl: at('wasm/')}).promise;
  }catch(e){ throw new Error(e && e.name === 'PasswordException' ? 'pdf_password' : 'pdf_bad'); }
  if(rd.token !== token){ pdfFree(pdf); return; }
  rd.pdf = pdf;
  const n = pdf.numPages, first = await pdf.getPage(1), v1 = first.getViewport({scale: 1});
  rd.doc.textContent = ''; rd.doc.classList.add('pdf'); $('#rdSize').hidden = true;
  const boxes = [];
  for(let i = 1; i <= n; i++){
    const b = document.createElement('div'); b.className = 'pdf-page'; b.dataset.n = i;
    b.style.aspectRatio = v1.width + ' / ' + v1.height; b.style.maxWidth = Math.round(v1.width * 1.5) + 'px';
    rd.doc.appendChild(b); boxes.push(b);
  }
  const live = []; let chain = Promise.resolve();
  async function render(b){
    if(b.firstChild || rd.token !== token) return;
    const page = await pdf.getPage(+b.dataset.n); if(rd.token !== token || b.firstChild) return;
    const v = page.getViewport({scale: 1});
    b.style.aspectRatio = v.width + ' / ' + v.height;
    rdFitBox(b);
    const scale = Math.min(3, (b.clientWidth || 600) / v.width * Math.min(2, window.devicePixelRatio || 1));
    const vp = page.getViewport({scale}), cv = document.createElement('canvas');
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    b.appendChild(cv);
    try{ await page.render({canvasContext: cv.getContext('2d'), viewport: vp, canvas: cv}).promise; }catch(e){}
    live.push(b);
    while(live.length > 10){   // 가장 멀리 있는 쪽부터 지운다
      const here = +b.dataset.n; let far = 0;
      for(let k = 1; k < live.length; k++) if(Math.abs(+live[k].dataset.n - here) > Math.abs(+live[far].dataset.n - here)) far = k;
      const x = live.splice(far, 1)[0]; if(x === b) break;
      const c = x.firstChild; if(c){ c.width = 0; c.remove(); }
    }
  }
  rd.obs = new IntersectionObserver(es => { for(const e of es) if(e.isIntersecting){ const b = e.target; chain = chain.then(() => render(b)); } }, {root: rd.scroll, rootMargin: '100% 100%'});
  boxes.forEach(b => rd.obs.observe(b));
}
async function readFile(f, shown, opt){
  opt = opt || {};
  const token = rdOpen(shown || f.name);
  let kind = '', title = stemOf(shown || f.name);
  try{
    const k = await sniff(f), ext = extOf(f.name);
    if(k === 'pdf'){ kind = 'pdf'; await rdPdf(f, token); }
    else if(k === 'zip' && (ext === 'epub' || await isEpub(f))){ kind = 'epub'; const t = await rdEpub(f, token); if(t) title = t; }
    else {
      const paras = await readTextDoc(f);
      if(rd.token !== token) return;
      if(!paras.some(p => paraText(p).trim())) throw new Error('empty');
      kind = ext && ext.length <= 5 ? ext : 'txt';
      rdText(paras);
    }
  }catch(e){
    if(rd.token !== token) return;
    rd.doc.innerHTML = '<p class="rd-wait"></p>'; rd.doc.firstChild.textContent = errText(e);
    return;
  }
  if(rd.token !== token) return;
  rdLayout(); rdShow(0, false);
  await rdRemember(f, token, {id: opt.libId, title, kind});
}
async function isEpub(f){
  try{ const z = await Hangul.unzip(await f.arrayBuffer()); const m = await z.text('mimetype'); return !!m && m.trim() === 'application/epub+zip'; }catch(e){ return false; }
}
$('#readIn').onchange = () => { const f = $('#readIn').files[0]; $('#readIn').value = ''; if(f) readFile(f); };
for(const id of ['readBtn', 'convBtn']) $('#' + id).addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); $('#' + $('#' + id).getAttribute('for')).click(); } });

/* ================= 표지 그리기 (1200×1600) =================
   밝은 종이색 바탕 + 먹색 큰 덩어리(겹친 능선과 달). 제목은 세로쓰기, 작가 이름은 붉은 낙관.
   16단계 흑백 전자잉크에서도 명암만으로 읽히게 한다. 모양은 제목·작가 이름·seed로 정해진다. */
const PAPER = '#EEEAE1', INK = '#1C1B19', SEAL = '#B4372C';
function rng(str){
  let h = 1779033703 ^ str.length;
  for(let i = 0; i < str.length; i++){ h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
  let a = h >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const SERIF = '"Noto Serif KR","KoPub Batang",serif';
async function coverFonts(text){
  if(!document.fonts || !document.fonts.load) return;
  const wait = Promise.all([document.fonts.load('700 100px "Noto Serif KR"', text || '가'), document.fonts.load('400 100px "KoPub Batang"', text || '가')]).catch(() => {});
  await Promise.race([wait, new Promise(r => setTimeout(r, 3500))]);
}
function drawCover(cv, title, author, seed){
  const Wd = 1200, Hg = 1600, c = cv.getContext('2d'), R = rng(title + '/' + author + '/' + (seed || 0));
  cv.width = Wd; cv.height = Hg;
  c.fillStyle = PAPER; c.fillRect(0, 0, Wd, Hg);
  // 달
  const mx = 280 + R() * 160, my = 330 + R() * 150, mr = 120 + R() * 55;
  c.beginPath(); c.arc(mx, my, mr, 0, Math.PI * 2); c.fillStyle = '#DCD5C6'; c.fill();
  c.lineWidth = 3; c.strokeStyle = 'rgba(28,27,25,.5)'; c.stroke();
  // 능선 세 겹: 왼쪽이 높고 오른쪽이 낮다(오른쪽 위는 제목 자리)
  const layers = [{l: 900, r: 1250, a: 70, col: '#B7B0A2'}, {l: 1030, r: 1340, a: 85, col: '#69655D'}, {l: 1200, r: 1450, a: 95, col: INK}];
  for(const L of layers){
    const k = [0, 1, 2, 3].map(i => ({f: (1.2 + i * 1.7 + R() * 1.3) / Wd * Math.PI * 2, p: R() * Math.PI * 2, w: 1 / (i + 1.2)}));
    const sum = k.reduce((s, x) => s + x.w, 0);
    c.beginPath(); c.moveTo(0, Hg);
    let jit = 0;
    for(let x = 0; x <= Wd; x += 6){
      const t = x / Wd, e = t * t * (3 - 2 * t);
      jit = jit * .7 + (R() - .5) * 5;
      const nz = k.reduce((s, q) => s + Math.sin(x * q.f + q.p) * q.w, 0) / sum;
      c.lineTo(x, L.l + (L.r - L.l) * e - (nz * .5 + .5) * L.a + jit);
    }
    c.lineTo(Wd, Hg); c.closePath(); c.fillStyle = L.col; c.fill();
    if(L.col !== INK){   // 골짜기 안개
      const g = c.createLinearGradient(0, L.l, 0, L.r + 160);
      g.addColorStop(0, 'rgba(238,234,225,0)'); g.addColorStop(1, 'rgba(238,234,225,.55)');
      c.fillStyle = g; c.fillRect(0, L.l - 100, Wd, L.r + 260 - L.l);
    }
  }
  // 낙관 크기부터 정한다
  const au = [...String(author || '').trim()];
  const vertical = au.length > 0 && au.length <= 4 && au.every(ch => ch.charCodeAt(0) > 0x2E7F);
  const sealH = !au.length ? 0 : vertical ? au.length * 58 + 28 : 76;
  // 제목: 세로쓰기, 오른쪽 위
  const ch = [...String(title || '').trim()], top = 170, room = 1090 - top - (sealH ? sealH + 70 : 0);
  const cols = Math.min(3, Math.max(1, Math.ceil(ch.length / 9))), rows = Math.ceil(ch.length / cols) || 1;
  const adv = x => x === ' ' ? .5 : 1.1;
  let units = 0; for(let i = 0; i < cols; i++) units = Math.max(units, ch.slice(i * rows, (i + 1) * rows).reduce((s, x) => s + adv(x), 0));
  const s = Math.max(40, Math.min(150, Math.floor(room / Math.max(1, units))));
  const cx0 = 960; let bottom = top;
  c.fillStyle = INK; c.strokeStyle = INK; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = '700 ' + s + 'px ' + SERIF;
  for(let i = 0; i < cols; i++){
    let y = top; const x = cx0 - i * s * 1.3;
    for(const g of ch.slice(i * rows, (i + 1) * rows)){
      if(g !== ' ') c.fillText(g, x, y + s * .55);
      y += s * adv(g);
    }
    bottom = Math.max(bottom, y);
  }
  c.lineWidth = 3; c.beginPath(); c.moveTo(cx0 + s * .5 + 36, top - 14); c.lineTo(cx0 + s * .5 + 36, bottom + 6); c.stroke();
  // 낙관
  if(au.length){
    const y0 = bottom + 64;
    if(vertical){
      c.fillStyle = SEAL; c.fillRect(cx0 - 43, y0, 86, sealH);
      c.fillStyle = PAPER; c.font = '700 50px ' + SERIF;
      au.forEach((g, i) => c.fillText(g, cx0, y0 + 14 + 29 + i * 58));
    } else {
      c.font = '700 38px ' + SERIF;
      const tw = Math.min(520, c.measureText(au.join('')).width), w = tw + 44, x1 = Math.min(1120, cx0 + w / 2), x0 = x1 - w;
      c.fillStyle = SEAL; c.fillRect(x0, y0, w, sealH);
      c.fillStyle = PAPER; c.fillText(au.join(''), x0 + w / 2, y0 + sealH / 2 + 2, 520);
    }
  }
}
function drawImageCover(cv, img){
  cv.width = 1200; cv.height = 1600; const c = cv.getContext('2d');
  c.fillStyle = PAPER; c.fillRect(0, 0, 1200, 1600);
  const k = Math.max(1200 / img.width, 1600 / img.height), w = img.width * k, h = img.height * k;
  c.drawImage(img, (1200 - w) / 2, (1600 - h) / 2, w, h);
}
const toJpeg = cv => new Promise((res, rej) => cv.toBlob(async b => b ? res(new Uint8Array(await b.arrayBuffer())) : rej(new Error('cover')), 'image/jpeg', .92));

/* ================= EPUB 조판 (크레마샤인용) =================
   - 본문 <p>: 들여쓰기 1em, 문단 사이 0, 행간 1.75, 양쪽 정렬. 글꼴 지정 없음, word-break: keep-all 없음
   - 장면 구분 줄: <div class="sep"> 안에 display:table 상자로 가운데, 위아래는 실제 빈 줄(크레마가 여백 CSS를 지운다)
   - 작가 이름도 같은 방식. 제목 h1은 인라인 text-align:center
   - EPUB 3 + NCX, 표지는 SVG 래퍼, mimetype은 무압축 첫 항목 */
const NBSP = ' ';
const BLANK = '<div class="blank" style="margin:0;text-indent:0;">' + NBSP + '</div>';
const E_CSS = '@charset "UTF-8";\nhtml, body { margin: 0; padding: 0; }\nbody { line-height: 1.75; text-align: justify; overflow-wrap: break-word; -epub-line-break: strict; line-break: strict; }\np { margin: 0; text-indent: 1em; }\ndiv.sep, div.blank { margin: 0 !important; text-indent: 0 !important; }\ndiv.sep { text-align: center !important; }\n.sep-mark { display: table; margin: 0 auto; text-indent: 0; }\n.titleblock { margin: 22% 0 3.5em; text-align: center; }\nh1 { font-size: 1.9em; font-weight: bold; letter-spacing: 0.3em; margin: 0 0 0.9em 0.3em; line-height: 1.3; }\nh2.chap { font-size: 1.25em; font-weight: bold; margin: 1.5em 0 0; text-indent: 0; text-align: left; line-height: 1.4; }\n.author { text-indent: 0 !important; text-align: center !important; margin: 0 !important; font-size: 0.95em; letter-spacing: 0.15em; }\n.author-name { display: table; margin: 0 auto; padding-left: 0.15em; }\n.cover-page { margin: 0; padding: 0; text-align: center; }\n.cover-page svg { width: 100%; height: 100%; }\n';
const head = t => '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ko" lang="ko">\n<head>\n<meta charset="UTF-8"/>\n<title>' + esc(t) + '</title>\n<link rel="stylesheet" type="text/css" href="style.css"/>\n</head>\n';
function paraHtml(p){
  const t = paraText(p);
  if(isSep(t)){
    return [BLANK, '<div class="sep" style="text-align:center;text-indent:0;margin:0;"><span class="sep-mark" style="display:table;margin:0 auto;">' + esc(t.trim()).replace(/ /g, NBSP) + '</span></div>', BLANK].join('\n');
  }
  return '<p>' + p.runs.map(r => { let s = esc(r.t); if(r.i) s = '<i>' + s + '</i>'; if(r.b) s = '<b>' + s + '</b>'; return s; }).join('') + '</p>';
}
async function bookId(title, author){
  try{
    const h = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode('lightning-write/' + title + '/' + author)));
    h[6] = h[6] & 0x0f | 0x50; h[8] = h[8] & 0x3f | 0x80;
    const x = [...h.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('');
    return 'urn:uuid:' + x.slice(0, 8) + '-' + x.slice(8, 12) + '-' + x.slice(12, 16) + '-' + x.slice(16, 20) + '-' + x.slice(20);
  }catch(e){ return 'urn:uuid:' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(16)); }
}
/* paras: 문단 모델(빈 문단은 뺀다). 장 제목(chap)이 있으면 장마다 파일을 나눈다 */
async function buildEpub(title, author, paras, cover){
  const body = paras.filter(p => paraText(p).trim());
  const parts = [{t: null, ps: []}];
  for(const p of body){ if(isChap(p)) parts.push({t: paraText(p).trim(), ps: []}); else parts[parts.length - 1].ps.push(p); }
  const T = esc(title), A = esc(author), id = await bookId(title, author);
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const files = [];   // {name, title, xhtml}
  files.push({name: 'text.xhtml', title, xhtml: head(title) + '<body epub:type="bodymatter">\n<section epub:type="chapter" aria-labelledby="t">\n<div class="titleblock" style="text-align:center;">\n<h1 id="t" style="text-align:center;text-indent:0;">' + T + '</h1>\n'
    + (author ? '<div class="author" style="text-align:center;text-indent:0;margin:0;"><span class="author-name" style="display:table;margin:0 auto;padding-left:0.15em;">' + A + '</span></div>\n' : '')
    + '</div>\n' + parts[0].ps.map(paraHtml).join('\n') + '\n</section>\n</body>\n</html>\n'});
  parts.slice(1).forEach((pt, i) => files.push({name: 'ch' + (i + 1) + '.xhtml', title: pt.t, xhtml: head(pt.t) + '<body epub:type="bodymatter">\n<section epub:type="chapter" aria-labelledby="c">\n<h2 id="c" class="chap" style="text-indent:0;">' + esc(pt.t) + '</h2>\n' + BLANK + '\n' + pt.ps.map(paraHtml).join('\n') + '\n</section>\n</body>\n</html>\n'}));
  const coverX = head(title) + '<body class="cover-page" epub:type="cover">\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1"\n     width="100%" height="100%" viewBox="0 0 1200 1600" preserveAspectRatio="xMidYMid meet">\n<image width="1200" height="1600" xlink:href="images/cover.jpg"/>\n</svg>\n</body>\n</html>\n';
  const nav = head('차례') + '<body>\n<nav epub:type="toc" id="toc"><h2>차례</h2><ol>' + files.map(f => '<li><a href="' + f.name + '">' + esc(f.title) + '</a></li>').join('') + '</ol></nav>\n<nav epub:type="landmarks" hidden="hidden"><ol>\n<li><a epub:type="cover" href="cover.xhtml">표지</a></li>\n<li><a epub:type="bodymatter" href="text.xhtml">본문</a></li>\n</ol></nav>\n</body>\n</html>\n';
  const ncx = '<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="ko">\n<head><meta name="dtb:uid" content="' + id + '"/><meta name="dtb:depth" content="1"/>\n<meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>\n<docTitle><text>' + T + '</text></docTitle><docAuthor><text>' + A + '</text></docAuthor>\n<navMap>\n<navPoint id="np-1" playOrder="1"><navLabel><text>표지</text></navLabel><content src="cover.xhtml"/></navPoint>\n'
    + files.map((f, i) => '<navPoint id="np-' + (i + 2) + '" playOrder="' + (i + 2) + '"><navLabel><text>' + esc(f.title) + '</text></navLabel><content src="' + f.name + '"/></navPoint>').join('\n') + '\n</navMap>\n</ncx>\n';
  const fid = f => f.name.replace('.xhtml', '');
  const opf = '<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="ko">\n<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n<dc:identifier id="bookid">' + id + '</dc:identifier>\n<dc:title>' + T + '</dc:title>\n'
    + (author ? '<dc:creator id="creator">' + A + '</dc:creator>\n<meta refines="#creator" property="role" scheme="marc:relators">aut</meta>\n' : '')
    + '<dc:language>ko</dc:language>\n<dc:subject>소설</dc:subject>\n<meta property="dcterms:modified">' + modified + '</meta>\n<meta name="cover" content="cover-image"/>\n</metadata>\n<manifest>\n<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n<item id="css" href="style.css" media-type="text/css"/>\n<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>\n<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml" properties="svg"/>\n'
    + files.map(f => '<item id="' + fid(f) + '" href="' + f.name + '" media-type="application/xhtml+xml"/>').join('\n') + '\n</manifest>\n<spine toc="ncx"><itemref idref="cover"/>' + files.map(f => '<itemref idref="' + fid(f) + '"/>').join('') + '<itemref idref="nav" linear="no"/></spine>\n<guide>\n<reference type="cover" title="표지" href="cover.xhtml"/>\n<reference type="text" title="' + T + '" href="text.xhtml"/>\n</guide>\n</package>\n';
  const container = '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n</container>\n';
  const enc = new TextEncoder(), u = s => enc.encode(s);
  const blob = await Hangul.zip([
    {name: 'mimetype', data: u('application/epub+zip'), store: true},
    {name: 'META-INF/container.xml', data: u(container)}, {name: 'OEBPS/content.opf', data: u(opf)}, {name: 'OEBPS/toc.ncx', data: u(ncx)},
    {name: 'OEBPS/nav.xhtml', data: u(nav)}, {name: 'OEBPS/style.css', data: u(E_CSS)}, {name: 'OEBPS/cover.xhtml', data: u(coverX)}
  ].concat(files.map(f => ({name: 'OEBPS/' + f.name, data: u(f.xhtml)})), [{name: 'OEBPS/images/cover.jpg', data: cover, store: true}]));
  return new Blob([blob], {type: 'application/epub+zip'});
}

/* ================= EPUB 만들기 창 ================= */
const safeName = s => String(s || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || '원고';
const lsGet = k => { try{ return JSON.parse(localStorage.getItem('wongo-' + k)); }catch(e){ return null; } };
const lsSet = (k, v) => { try{ localStorage.setItem('wongo-' + k, JSON.stringify(v)); }catch(e){} };
let job = null;   // {docs:[{stem, paras, first}], seed, img, busy}
const firstLine = paras => { const p = paras.find(x => paraText(x).trim()); return p ? paraText(p).trim() : ''; };
const dropFirst = paras => { const i = paras.findIndex(x => paraText(x).trim()); return i < 0 ? paras : paras.slice(0, i).concat(paras.slice(i + 1)); };
const same = (a, b) => a.replace(/\s+/g, '') === b.replace(/\s+/g, '');
function docTitle(d){
  if(job.docs.length === 1) return $('#epTitle').value.trim() || d.stem;
  return $('#epFirst').checked && d.first && d.first.length <= 30 ? d.first : d.stem;
}
const docParas = d => {
  const use = job.docs.length === 1 ? $('#epFirst').checked : ($('#epFirst').checked && d.first && d.first.length <= 30) || same(d.first, d.stem);
  return use ? dropFirst(d.paras) : d.paras;
};
let pvT = null;
function preview(){
  clearTimeout(pvT);
  pvT = setTimeout(async () => {
    if(!job) return;
    const full = document.createElement('canvas'), title = docTitle(job.docs[0]), author = $('#epAuthor').value.trim();
    if(job.img) drawImageCover(full, job.img);
    else { await coverFonts(title + author); if(!job) return; drawCover(full, title, author, job.seed); }
    const pv = $('#epCv'); pv.getContext('2d').drawImage(full, 0, 0, pv.width, pv.height);
  }, 150);
}
function setDest(d){
  if(!job) return;
  job.dest = d === 'drive' && W.Drive.enabled() ? 'drive' : 'device';
  document.querySelectorAll('[data-dest]').forEach(b => { const on = b.dataset.dest === job.dest; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  const many = job.docs.length > 1;
  $('#epGo').textContent = (many ? 'EPUB ' + job.docs.length + '개 ' : 'EPUB ') + (job.dest === 'drive' ? '드라이브에 저장' : '만들기');
}
document.querySelectorAll('[data-dest]').forEach(b => { b.onclick = () => setDest(b.dataset.dest); });
function openEpub(docs, what, dest){
  job = {docs, seed: 0, img: null, busy: false, dest: 'device'};
  const one = docs.length === 1, d = docs[0];
  $('#epWhat').textContent = what;
  $('#epOne').querySelector('h3').hidden = !one; $('#epTitle').hidden = !one;
  $('#epTitle').value = one ? (d.title || d.stem) : '';
  $('#epFirst').checked = one ? (!!d.first && same(d.first, d.title || d.stem)) : false;
  $('#epFirst').parentNode.lastChild.textContent = one ? ' 원고 첫 줄은 제목이라 본문에서 뺍니다' : ' 각 파일의 첫 줄을 제목으로 쓰고 본문에서 뺍니다 (첫 줄이 30자 이하일 때)';
  $('#epFirstBox').hidden = one && !d.first;
  $('#epAuthor').value = lsGet('author') || '';
  $('#epAuto').hidden = true; $('#epAgain').hidden = false;
  $('#epCoverNote').textContent = one ? '제목과 작가 이름으로 표지를 그립니다. 흑백 전자잉크에서도 읽히는 먹색 그림입니다.' : '파일마다 제목에 맞춰 표지를 그립니다. 미리 보기는 첫 파일입니다.';
  $('#epMsg').textContent = ''; $('#epGo').disabled = false;
  $('#epDestBox').hidden = !W.Drive.enabled();
  setDest(dest);
  W.closePops(); if(narrow()) $('#app').classList.remove('drawer');
  $('#epubDlg').hidden = false;
  preview();
}
function closeEpub(){ $('#epubDlg').hidden = true; job = null; }
$('#epClose').onclick = closeEpub;
$('#epubDlg').addEventListener('click', e => { if(e.target.id === 'epubDlg') closeEpub(); });
$('#epTitle').addEventListener('input', preview);
$('#epAuthor').addEventListener('input', () => { $('#epMsg').textContent = ''; preview(); });
$('#epFirst').onchange = () => {
  if(job && job.docs.length === 1){
    const d = job.docs[0], t = $('#epTitle').value.trim(), base = d.title || d.stem;
    if($('#epFirst').checked && d.first && d.first.length <= 60 && (!t || t === base)) $('#epTitle').value = d.first;
    else if(!$('#epFirst').checked && t === d.first) $('#epTitle').value = base;
  }
  preview();
};
$('#epAgain').onclick = () => { if(job){ job.seed++; preview(); } };
$('#epAuto').onclick = () => { if(job){ job.img = null; $('#epAuto').hidden = true; $('#epAgain').hidden = false; preview(); } };
$('#epPick').addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); $('#coverIn').click(); } });
$('#coverIn').onchange = () => {
  const f = $('#coverIn').files[0]; $('#coverIn').value = ''; if(!f || !job) return;
  const u = URL.createObjectURL(f), im = new Image();
  im.onload = () => { URL.revokeObjectURL(u); if(!job) return; job.img = im; $('#epAuto').hidden = false; $('#epAgain').hidden = true; preview(); };
  im.onerror = () => { URL.revokeObjectURL(u); $('#epMsg').textContent = '이 그림은 쓸 수 없습니다.'; };
  im.src = u;
};
$('#epGo').onclick = async () => {
  if(!job || job.busy) return;
  const author = $('#epAuthor').value.trim();
  if(!author){ $('#epMsg').textContent = '작가 이름을 적어 주세요. 표지와 첫 화면에 들어갑니다.'; $('#epAuthor').focus(); return; }
  job.busy = true; $('#epGo').disabled = true; lsSet('author', author);
  const j = job, out = [];
  try{
    for(let i = 0; i < j.docs.length; i++){
      const d = j.docs[i], title = docTitle(d), paras = docParas(d);
      $('#epMsg').textContent = j.docs.length > 1 ? '만드는 중… ' + (i + 1) + ' / ' + j.docs.length + ' 「' + title + '」' : '만드는 중…';
      if(!paras.some(p => paraText(p).trim())) throw new Error('empty');
      const cv = document.createElement('canvas');
      if(j.img) drawImageCover(cv, j.img); else { await coverFonts(title + author); drawCover(cv, title, author, j.seed); }
      const blob = await buildEpub(title, author, paras, await toJpeg(cv));
      out.push({name: safeName(title) + '_' + safeName(author) + '.epub', blob});
    }
    let ok, msg;
    if(j.dest === 'drive'){
      for(let i = 0; i < out.length; i++){
        $('#epMsg').textContent = '드라이브에 올리는 중… ' + (out.length > 1 ? (i + 1) + ' / ' + out.length : '');
        out[i].res = await W.Drive.saveFile(j.docs[i].key, 'epub', out[i].name, out[i].blob);
      }
      ok = true; msg = out.length === 1 ? '드라이브 \'LWRITE\' 폴더에 「' + out[0].name + '」을(를) 저장했습니다' : '드라이브 \'LWRITE\' 폴더에 EPUB ' + out.length + '권을 저장했습니다';
      W.setSave('saved', '드라이브에 저장함 · ' + (out.length === 1 ? out[0].name : 'EPUB ' + out.length + '권'));
      if(out.length === 1 && out[0].res && out[0].res.webViewLink){ const link = out[0].res.webViewLink; W.notice(msg + '.', '드라이브에서 열기', () => window.open(link, '_blank', 'noopener')); msg = ''; }
    } else if(out.length === 1){ ok = await W.download(out[0].name, out[0].blob); msg = '「' + out[0].name + '」을(를) 만들었습니다'; }
    else {
      const seen = new Map(), files = [];
      for(const o of out){ const n = seen.get(o.name) || 0; seen.set(o.name, n + 1); files.push({name: n ? o.name.replace(/\.epub$/, ' (' + (n + 1) + ').epub') : o.name, data: new Uint8Array(await o.blob.arrayBuffer()), store: true}); }
      ok = await W.download('EPUB ' + out.length + '권.zip', new Blob([await Hangul.zip(files)], {type: 'application/zip'}));
      msg = 'EPUB ' + out.length + '권을 묶음 파일(.zip)로 만들었습니다. 풀어서 쓰세요';
    }
    if(job === j) closeEpub();
    if(ok === false || msg) toast(ok === false ? '저장을 취소했습니다' : msg, 6000);
  }catch(e){
    if(job === j){ j.busy = false; $('#epGo').disabled = false; $('#epMsg').textContent = e && e.message === 'empty' ? '본문에 글이 없습니다.' : e && e.code ? W.Drive.errorText(e) : 'EPUB을 만들지 못했습니다. 다시 눌러 주세요.'; }
  }
};
/* 지금 원고 → EPUB */
async function epubFromMs(dest){
  W.closePops(); if(dest === 'drive' && !W.driveReady()) return;
  await W.flush();
  const paras = W.paragraphs(paper), title = W.titleVal();
  if(!paras.some(p => paraText(p).trim())){ toast('원고에 글이 없습니다', 4000); return; }
  openEpub([{key: W.cur().id, stem: title, title, paras, first: firstLine(paras)}], '지금 원고를 전자책으로 만듭니다.', dest);
}
$('#exEpub').onclick = () => epubFromMs('device');
$('#dvEpub').onclick = () => epubFromMs('drive');
/* 문서 파일 → EPUB. from: 'device' | 'drive' (저장할 곳의 처음 값) */
async function convertFiles(fs, from){
  W.closePops();
  // 전자책(EPUB)과 PDF는 편집 가능 문서로, 나머지 문서는 전자책으로
  const books = [], rest = [];
  for(const f of fs) (await isBookFile(f) ? books : rest).push(f);
  if(books.length) await epubsToMs(books, from);
  if(!rest.length) return;
  fs = rest;
  toast('문서를 읽는 중…', 20000);
  const docs = [], bad = [];
  for(const f of fs){
    try{
      const paras = await readTextDoc(f);
      if(!paras.some(p => paraText(p).trim())) throw new Error('empty');
      const stem = stemOf(f.name).replace(/\.docx$/i, '');
      docs.push({key: 'conv:' + stem, stem, paras, first: firstLine(paras)});
    }catch(e){ bad.push(f.name + ': ' + errText(e)); }
  }
  $('#toast').hidden = true;
  if(!docs.length){ toast(bad[0] || '읽을 수 있는 문서가 없습니다', 9000); return; }
  if(bad.length) toast('읽지 못한 파일 ' + bad.length + '개는 뺐습니다 — ' + bad[0], 9000);
  openEpub(docs, docs.length === 1 ? '「' + docs[0].stem + '」을(를) 전자책으로 바꿉니다.' : '문서 ' + docs.length + '개를 전자책으로 바꿉니다.', from);
}
$('#convIn').onchange = () => { const fs = [...$('#convIn').files]; $('#convIn').value = ''; if(fs.length) convertFiles(fs, 'device'); };

/* ================= PDF 파일 (pdfout.js) ================= */
async function pdfOut(){
  await W.flush();
  const paras = W.paragraphs(paper), title = W.titleVal();
  if(!paras.some(p => paraText(p).trim())){ toast('원고에 글이 없습니다', 4000); return null; }
  W.setSave('saving', 'PDF 만드는 중…');
  try{
    const res = await PdfOut.make(paras, {title: title === '제목 없는 원고' ? '' : title, author: lsGet('author') || '', fs: W.prefs.fs, lh: W.prefs.lh, indent: W.prefs.indent, sceneRe: W.sceneRe, chapRe: W.chapRe});
    return {name: W.fileBase() + '.pdf', blob: res.blob};
  }catch(e){ W.setSave('error', 'PDF를 만들지 못했습니다' + (e && e.message === 'pdf_font' ? ' (글꼴 파일을 읽지 못함)' : '')); return null; }
}
$('#exPdf').onclick = async () => { W.closePops(); const o = await pdfOut(); if(o) await W.saveTo('device', 'pdf', o); };
$('#dvPdf').onclick = async () => { W.closePops(); if(!W.driveReady()) return; const o = await pdfOut(); if(o) await W.saveTo('drive', 'pdf', o); };

/* ================= 키 ================= */
window.addEventListener('keydown', e => {
  const reading = !rd.el.hidden, making = !$('#epubDlg').hidden;
  if(!reading && !making) return;
  if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); if(making) closeEpub(); else if(rd.el.classList.contains('full')) rdSetFull(false); else rdClose(); return; }
  if(reading && !making && /^f$/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); e.stopPropagation(); rdSetFull(!rd.el.classList.contains('full')); return; }
  if(reading && !making && !e.ctrlKey && !e.metaKey && !e.altKey){   // 쪽 넘기기
    const k = e.key, next = k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || (k === ' ' && !e.shiftKey), prev = k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || (k === ' ' && e.shiftKey);
    if(next || prev || k === 'Home' || k === 'End'){ e.preventDefault(); e.stopPropagation(); rdTurn(k === 'Home' ? 0 : k === 'End' ? pg.n - 1 : pg.cur + (next ? 1 : -1)); return; }
  }
  if((e.ctrlKey || e.metaKey) && reading){   // 읽는 동안에는 편집 단축키가 원고에 닿지 않게. 찾기(Ctrl+F)는 브라우저 것을 쓴다
    if(/^f$/i.test(e.key)) e.stopPropagation();
    else if(e.key === 'Enter' || /^[szybi]$/i.test(e.key)){ e.preventDefault(); e.stopPropagation(); }
  }
}, true);

window.__books = {readTextDoc, buildEpub, drawCover, readFile, convertFiles, epubBook, pdfBook, epubsToMs, isEpubFile, isBookFile, sniff, readTxt, errText, paraText};
})();
