/* 라이트닝 라이트 — 번역 모드
   외국어 책(EPUB·TXT·DOCX·HWP, 주로 구텐베르크의 영어 원서)을 열어 장마다 한국어로 옮기며 읽는다.
   - 번역은 설정(lightning)의 Gemini 키·모델로 한다. 지금 펼친 장부터 문단마다 번호를 붙여 보내고, 오는 대로 화면에 채운다.
     다음 장은 미리 옮겨 둔다. 「끝까지 번역」을 켜면 이 화면을 열어 둔 동안 책 끝까지 차례로 옮긴다.
   - 사람·땅 이름 표기와 인물 사이 말투는 '표기표'에 모아 다음 대목마다 함께 보낸다. AI가 보태고, 작가가 고칠 수 있다.
   - 책과 번역·읽던 자리는 서재(library.js)에 둔다. 이 기기에 보관되고, 드라이브에 연결돼 있으면 다른 기기와 이어진다.
     같은 책을 다시 열거나 불러오기 메뉴의 「이어 읽기」를 누르면 이어진다. 문단마다 ts(바뀐 때)를 적어 두 기기의 번역을 합친다.
   - 「고치기」로 번역문을 직접 고치고(고친 문단은 다시 번역해도 그대로), 「원고로」로 편집할 수 있는 원고를 만든다.
   window.__tr = {openFile, openSaved, close} (+ 시험용 내부 함수) */
(() => {
'use strict';
const W = window.__wongo, B = window.__books, AI = window.__ai, L = window.__lib;
if(!W || !B || !AI || !L || typeof document === 'undefined') return;
const $ = s => document.querySelector(s);
const toast = W.toast, narrow = W.narrow;
const lsGet = k => { try{ return JSON.parse(localStorage.getItem('wongo-' + k)); }catch(e){ return null; } };
const lsSet = (k, v) => { try{ localStorage.setItem('wongo-' + k, JSON.stringify(v)); }catch(e){} };
const lsDel = k => { try{ localStorage.removeItem('wongo-' + k); }catch(e){} };
const stemOf = name => String(name || '').replace(/\.[^.]+$/, '');

/* ================= 글 표시: *기울임* · **굵게** ================= */
const STAR = '＊';   // 원문에 있던 별표는 표시와 섞이지 않게 바꿔 둔다
function toMarkup(runs){
  return runs.map(r => {
    const t = String(r.t).replace(/\*/g, STAR).replace(/\t/g, ' ');
    if(!(r.b || r.i) || !t.trim()) return t;
    const m = t.match(/^(\s*)([\s\S]*?)(\s*)$/), mk = r.b && r.i ? '***' : r.b ? '**' : '*';
    return m[1] + mk + m[2] + mk + m[3];
  }).join('').replace(/\s+/g, ' ').trim();
}
function fromMarkup(s){
  s = String(s || ''); const out = [], re = /\*\*\*([^*]+?)\*\*\*|\*\*([^*]+?)\*\*|\*([^*]+?)\*/g; let last = 0, m;
  while((m = re.exec(s))){
    if(m.index > last) out.push({t: s.slice(last, m.index), b: false, i: false});
    if(m[1] != null) out.push({t: m[1], b: true, i: true}); else if(m[2] != null) out.push({t: m[2], b: true, i: false}); else out.push({t: m[3], b: false, i: true});
    last = re.lastIndex;
  }
  if(last < s.length) out.push({t: s.slice(last), b: false, i: false});
  return out.map(r => ({t: r.t.replace(/\*/g, ''), b: r.b, i: r.i})).filter(r => r.t);   // 짝 없는 별표는 버린다
}
const plain = s => fromMarkup(s).map(r => r.t).join('');
function fill(el, s){
  el.textContent = '';
  for(const r of fromMarkup(s)){
    let n = document.createTextNode(r.t);
    if(r.i){ const x = document.createElement('i'); x.appendChild(n); n = x; }
    if(r.b){ const x = document.createElement('b'); x.appendChild(n); n = x; }
    el.appendChild(n);
  }
}
function domToMarkup(el){
  const runs = [];
  (function walk(n, b, i){
    for(const c of n.childNodes){
      if(c.nodeType === 3){ runs.push({t: c.nodeValue, b, i}); continue; }
      if(c.nodeType !== 1) continue;
      const t = c.localName;
      if(t === 'br'){ runs.push({t: ' ', b, i}); continue; }
      walk(c, b || t === 'b' || t === 'strong', i || t === 'i' || t === 'em');
      if(t === 'div' || t === 'p') runs.push({t: ' ', b, i});
    }
  })(el, false, false);
  const m = [];
  for(const r of runs){ const l = m[m.length - 1]; if(l && l.b === r.b && l.i === r.i) l.t += r.t; else m.push(Object.assign({}, r)); }
  return toMarkup(m);
}

/* ================= 책 읽기 → {title, author, lang, paras:[{m, c, s}]} =================
   m: 글(표시 포함), c: 장 제목, s: 별표 줄 */
const PG_START = /\*{3}\s*START OF (THE|THIS) PROJECT GUTENBERG/i, PG_END = /\*{3}\s*END OF (THE|THIS) PROJECT GUTENBERG/i;
const HEAD_RE = /^(chapter|book|part|volume|act|scene|letter|stave|canto|section|prologue|epilogue|preface|introduction|contents|appendix|afterword|foreword|chapitre|kapitel|cap[ií]tulo|capitolo)\b/i;
const ROMAN = /^[IVXLCDM]{1,8}\.?$/;
const SEP_RE = /^[\s*.\-–—~#•·=＊]+$/;
const isSepText = t => !!t.trim() && SEP_RE.test(t) && /[*#~=•·＊]/.test(t) && t.replace(/\s/g, '').length <= 20;
const headish = t => t.length <= 80 && (HEAD_RE.test(t) || ROMAN.test(t.trim()));
const RMN = '(?=[ivxlcdm])m{0,4}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})';   // 로마 숫자 꼴만
const NUMW = '(?:\\d{1,3}|' + RMN + '|(?:the\\s+)?(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last))';
const TAIL = '(?:\\s*[.:\\-–—]+(?:\\s*\\S.*)?)?$';   // 「CHAPTER I.」「Chapter One: The Boy」 — 번호 뒤에 바로 글이 이어지면(문장) 제목이 아니다
const TITLE_RE = new RegExp('^(?:(?:chapter|book|part|volume|stave|canto|letter|chapitre|kapitel|cap[ií]tulo|capitolo)\\s+' + NUMW + '|prologue|epilogue|preface|introduction|afterword|foreword)' + TAIL, 'i');
const NUM_LINE = new RegExp('^(?:\\d{1,3}|' + RMN.toUpperCase().replace('(?=[IVXLCDM])', '(?=[IVXLCDM])') + ')\\.?$');
const titleLine = t => { t = t.trim(); return t.length <= 60 && (TITLE_RE.test(t) || NUM_LINE.test(t)); };
const marked = ps => ps.some(p => p.c || p.h || p.k);
/* 구텐베르크 TXT: 한 문단이 70자쯤에서 줄이 바뀌어 있다. 빈 줄로 나뉜 덩어리를 한 문단으로 잇는다. _기울임_도 살린다 */
function txtBook(text, name){
  text = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const ti = text.match(/^Title:\s*(.+)$/m), au = text.match(/^Author:\s*(.+)$/m), la = text.match(/^Language:\s*(.+)$/m);
  let lines = text.split('\n');
  const si = lines.findIndex(l => PG_START.test(l)), ei = lines.findIndex(l => PG_END.test(l));
  if(ei >= 0 && ei > si) lines = lines.slice(0, ei);
  if(si >= 0) lines = lines.slice(si + 1);
  const blocks = []; let cur = [];
  for(const l of lines){ if(l.trim()) cur.push(l.trim()); else if(cur.length){ blocks.push(cur); cur = []; } }
  if(cur.length) blocks.push(cur);
  const wrapped = blocks.length > 0 && blocks.filter(b => b.length > 1).length / blocks.length >= 0.25;
  const ital = t => t.replace(/\*/g, STAR).replace(/_([^_\n]{1,300}?)_/g, '*$1*');
  const paras = [];
  for(const b of blocks){
    for(const t of wrapped ? [b.join(' ')] : b){
      if(isSepText(t)){ paras.push({m: '* * *', c: 0, s: 1}); continue; }
      paras.push({m: ital(t).replace(/\s+/g, ' '), c: (!wrapped || b.length <= 2) && headish(t) ? 1 : 0, s: 0});
    }
  }
  const lang = la ? la[1].trim().toLowerCase().slice(0, 2) : '';
  return {title: ti ? ti[1].trim() : stemOf(name), author: au ? au[1].trim() : '', lang: lang === 'en' || !lang ? 'en' : lang, paras};
}
async function loadSource(f){
  const kind = await B.sniff(f);
  if(kind === 'pdf'){   // 글이 들어 있는 PDF: 글을 뽑아 문단으로(books.js)
    const bk = await B.pdfBook(f);
    return {title: bk.title, author: '', lang: 'en', paras: bk.paras.map(p => { const t = B.paraText(p).trim(); return p.sep || isSepText(t) ? {m: '* * *', c: 0, s: 1} : {m: toMarkup(p.runs), c: p.chap || headish(t) ? 1 : 0, s: 0}; }).filter(p => p.s || p.m)};
  }
  if(kind === 'zip' && await B.isEpubFile(f)){
    const bk = await B.epubBook(f), paras = [];
    let carry = null;   // 건너뛴 문단(구텐베르크 안내 등)에 걸린 장 시작은 다음 문단으로
    for(const p of bk.paras){
      const q = p.pg ? null : {m: p.sep ? '* * *' : toMarkup(p.runs), c: p.chap ? 1 : 0, s: p.sep ? 1 : 0};
      if(!q || !(q.s || q.m)){ if(p.k && !carry) carry = p; continue; }
      const k = p.k ? p : carry; carry = null;
      if(k){ q.k = 1; if(k.kt) q.kt = k.kt; }
      if(p.h) q.h = 1;
      paras.push(q);
    }
    return {title: bk.title, author: bk.author, lang: (bk.lang || 'en').toLowerCase(), paras};
  }
  if(kind === 'text'){
    const buf = await f.arrayBuffer(); let text;
    try{ text = new TextDecoder('utf-8', {fatal: true}).decode(buf); }catch(e){ text = new TextDecoder('windows-1252').decode(buf); }
    return txtBook(text, f.name);
  }
  const ps = await B.readTextDoc(f);
  const paras = ps.map(p => { const t = B.paraText(p).trim(); return isSepText(t) ? {m: '* * *', c: 0, s: 1} : {m: toMarkup(p.runs), c: p.chap || headish(t) ? 1 : 0, s: 0}; }).filter(p => p.s || p.m);
  return {title: stemOf(f.name).replace(/\.docx$/i, ''), author: '', lang: 'en', paras};
}
async function hashOf(src){
  const s = src.paras.map(p => (p.c ? '#' : p.s ? '*' : '') + p.m).join('\n');
  try{
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
    return 'b' + [...h.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
  }catch(e){ let h = 0; for(let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761) >>> 0; return 'b' + h.toString(16) + s.length.toString(16); }
}
/* 장 나누기: 장 제목 줄(c: 제목 태그, h: 차례 이름과 같은 문단·제목다운 줄)과 장 시작(k: 책 차례가 가리키는 자리)에서 새 장.
   잇달아 나온 제목 줄(PART ONE + CHAPTER 1 + 부제)은 한 장의 제목으로 묶는다. 장 이름은 제목 줄, 없으면 차례 이름.
   제목도 장 시작도 없는 긴 글은 1만 5천 자쯤마다 '구간'으로 나눈다 */
function chaptersOf(paras){
  const chs = []; let cur = null, head = false;
  paras.forEach((p, i) => {
    const isH = !!(p.c || p.h);
    if(isH || p.k){
      if(cur && head){   // 제목 줄만 있던 장에 이어 붙인다
        cur.b = i + 1; if(isH) cur.ht = (cur.ht + ' ' + plain(p.m)).trim(); if(p.kt && !cur.lt) cur.lt = p.kt;
        head = isH; return;
      }
      cur = {a: i, b: i + 1, ht: isH ? plain(p.m) : '', lt: p.kt || ''}; chs.push(cur); head = isH; return;
    }
    if(!cur){ cur = {a: i, b: i + 1, ht: '', lt: ''}; chs.push(cur); }
    cur.b = i + 1; head = false;
  });
  for(const c of chs){ c.t = c.ht || c.lt; delete c.ht; delete c.lt; }
  const total = paras.reduce((s, p) => s + p.m.length, 0);
  if(chs.length === 1 && !chs[0].t && total > 30000){
    chs.length = 0; let a = 0, n = 0;
    paras.forEach((p, i) => { n += p.m.length; if(n >= 15000 && i + 1 < paras.length){ chs.push({a, b: i + 1, t: '', part: true}); a = i + 1; n = 0; } });
    chs.push({a, b: paras.length, t: '', part: true});
  }
  for(const c of chs) c.t = c.t.slice(0, 90);
  return chs;
}

/* ================= 번역 요청 만들기 · 답 읽기 ================= */
const TARGET = 9000, MAXP = 90;
let bk = null;   // 지금 연 책: {id, name, title, author, lang, trTitle, paras, chaps, tr, ed, fail, tries, gloss, all}
const view = {ch: 0, v: 'tr', edit: false};
const pending = i => { const p = bk.paras[i]; return !p.s && bk.tr[i] == null && !bk.fail[i] && !!p.m.trim(); };
function chunkOf(ch, limit){
  const c = bk.chaps[ch]; if(!c) return null;
  const idx = []; let n = 0;
  for(let i = c.a; i < c.b; i++){
    if(!pending(i)) continue;
    const len = bk.paras[i].m.length;
    if(idx.length && (n + len > TARGET * 1.4 || idx.length >= (limit || MAXP))) break;
    idx.push(i); n += len;
    if(n >= TARGET) break;
  }
  return idx.length ? {ch, idx} : null;
}
function buildPrompt(job){
  const before = [];
  for(let i = job.idx[0] - 1, n = 0; i >= 0 && n < 3; i--){ const p = bk.paras[i]; if(p.s) continue; if(bk.tr[i] == null) break; before.unshift(plain(bk.tr[i])); n++; }
  const ask = !bk.trTitle;
  return [
    '너는 문학 번역가다. 아래 [원문]을 한국어로 옮긴다.',
    '책: ' + bk.title + (bk.author ? ' / ' + bk.author : '') + (bk.lang && bk.lang !== 'ko' ? ' (원문 언어: ' + bk.lang + ')' : ''),
    '',
    '지킬 것',
    '- 원문 문단마다 같은 번호를 붙여 "[번호] 번역문"을 한 줄에 하나씩 쓴다. 번호 순서대로, 하나도 빼지 않는다. 문단을 합치거나 나누지 않는다.',
    '- 원문의 뜻은 모두 옮기고, 줄이거나 설명·주석을 보태지 않는다.',
    '- 한국 소설처럼 자연스럽게 쓴다. 서술은 "-다"로 맺고, 대사는 인물의 나이·신분·관계에 맞는 말투로 쓴다.',
    '- 큰따옴표는 “ ”, 작은따옴표는 ‘ ’만 쓴다. 책·작품 제목은 〈 〉로 묶는다.',
    '- *기울임*과 **굵게** 표시는 번역문의 같은 말에 그대로 붙인다.',
    '- 장 제목도 옮긴다(예: CHAPTER I → 제1장).',
    '- 사람·땅 이름과 말투는 [표기표]를 따른다. 표기표에 없는 이름은 외래어 표기법에 맞게 적는다.',
    '- 번역을 다 쓴 뒤, 이번 대목에서 표기표에 없는 사람·땅 이름이 처음 나왔으면 맨 끝에 "#표기 원어=한국어; 원어=한국어" 한 줄을 쓴다. 두 인물 사이의 말투를 이번에 처음 정했으면 "#말투 누가→누구에게=존댓말; 누가→누구에게=반말" 한 줄을 쓴다. 해당이 없으면 쓰지 않는다.',
    ask ? '- 맨 마지막 줄에 책 제목을 한국어로 옮겨 "#제목 한국어 제목"으로 쓴다.' : null,
    '- 그 밖의 말(인사·머리말·설명)은 쓰지 않는다.',
    '',
    '[표기표]',
    bk.gloss.trim() || '(아직 없음)',
    before.length ? '\n[앞 대목 번역 — 흐름만 참고하고 다시 쓰지 않는다]\n' + before.join('\n') : null,
    '',
    '[원문]',
    job.idx.map((i, k) => '[' + (k + 1) + '] ' + bk.paras[i].m).join('\n')
  ].filter(x => x != null).join('\n');
}
function pairs(s){
  const out = [];
  for(const x of String(s).split(/[;；]/)){ const kv = x.split(/=|＝/); if(kv.length === 2 && kv[0].trim() && kv[1].trim()) out.push([kv[0].trim(), kv[1].trim()]); }
  return out;
}
function parseOut(text, k){
  const out = new Map(); let gl = [], tone = [], title = '', cur = 0, last = 0;
  for(const raw of String(text || '').split('\n')){
    const t = raw.trim(); let m;
    if(/^```/.test(t)){ cur = 0; continue; }   // 코드 울타리로 감싸 오는 경우
    if((m = t.match(/^#\s*표기\s*[:：]?\s*(.*)$/))){ gl = gl.concat(pairs(m[1])); cur = 0; continue; }
    if((m = t.match(/^#\s*말투\s*[:：]?\s*(.*)$/))){ tone = tone.concat(pairs(m[1])); cur = 0; continue; }
    if((m = t.match(/^#\s*제목\s*[:：]?\s*(.*)$/))){ title = m[1].trim().replace(/^[〈《「『“"]+|[〉》」』”"]+$/g, '').trim(); cur = 0; continue; }
    if((m = t.match(/^(?:\*\*)?[[【](\d{1,3})[\]】](?:\*\*)?\s*(.*)$/))){
      const n = +m[1];
      if(n >= 1 && n <= k && !out.has(n)){ cur = n; last = n; out.set(n, m[2]); } else cur = 0;
      continue;
    }
    if(cur && t) out.set(cur, out.get(cur) + ' ' + t);
  }
  for(const [n, v] of out) out.set(n, v.replace(/\s+/g, ' ').trim());
  return {out, gl, tone, title, last};
}
const glossKey = l => { const m = String(l).match(/^(.*?)\s*[=＝]/); return m && m[1].trim() ? m[1].trim().toLowerCase() : null; };
function addGloss(gl, tone){
  const keys = new Set(bk.gloss.split('\n').map(glossKey).filter(Boolean)), add = [];
  for(const [a, b] of gl){ if(!keys.has(a.toLowerCase())){ keys.add(a.toLowerCase()); add.push(a + ' = ' + b); } }
  for(const [a, b] of tone){ const k = '말투: ' + a; if(!keys.has(k.toLowerCase())){ keys.add(k.toLowerCase()); add.push(k + ' = ' + b); } }
  if(!add.length) return;
  bk.gloss = (bk.gloss.trim() ? bk.gloss.trim() + '\n' : '') + add.join('\n'); bk.glossAt = Date.now();
  const ta = $('#trGl'); if(!$('#trDlg').hidden && document.activeElement !== ta) ta.value = bk.gloss;
}

/* ================= 보관 ================= */
function counts(){
  let all = 0, done = 0;
  bk.paras.forEach((p, i) => { if(p.s) return; const n = p.m.length; all += n; if(bk.tr[i] != null || bk.fail[i]) done += n; });
  return {all, done, pct: all ? Math.floor(done / all * 100) : 100};
}
let saveP = Promise.resolve();
const touch = i => { bk.ts[i] = Date.now(); };
function save(){
  if(!bk) return saveP;
  const rec = bk, c = counts();
  const data = {id: rec.id, name: rec.name, title: rec.title, author: rec.author, lang: rec.lang, trTitle: rec.trTitle, paras: rec.paras, tr: rec.tr, ed: rec.ed, fail: rec.fail, tries: rec.tries, ts: rec.ts, gloss: rec.gloss, glossAt: rec.glossAt || 0, all: !!rec.all};
  saveP = saveP.then(() => L.trSave(data, {pct: c.pct, chs: rec.chaps.length})).catch(e => { toast(e && e.name === 'QuotaExceededError' ? '기기 저장 공간이 부족해 번역을 보관하지 못했습니다' : '번역을 기기에 보관하지 못했습니다', 6000); });
  return saveP;
}
let saveT = null;
const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(save, 800); };

/* ================= 번역 돌리기 (한 번에 하나씩) ================= */
const tq = {busy: false, ctl: null, job: null, stopped: false, err: null, limit: 0, fails: 0, again: false, calls: 0};
function pick(){
  const n = bk.chaps.length, here = view.ch, order = [here];
  if(here + 1 < n) order.push(here + 1);   // 다음 장은 미리
  if(bk.all){ for(let k = here + 2; k < n; k++) order.push(k); for(let k = 0; k < here; k++) order.push(k); }
  for(const ch of order){ const j = chunkOf(ch, tq.limit); if(j) return j; }
  return null;
}
async function pump(){
  if(tq.busy || !bk) return;
  if(!AI.hasKey() || !AI.model()){ tq.err = {code: AI.hasKey() ? 'no_model' : 'no_key'}; foot(); return; }
  if(tq.stopped || tq.err){ foot(); return; }
  tq.busy = true;
  const me = bk;
  try{
    while(bk === me && !tq.stopped){
      const job = pick(); if(!job) break;
      tq.job = job; mark(job, true); foot();
      const go = await runJob(job, me);
      if(bk === me) mark(job, false);
      tq.job = null;
      if(!go) break;
    }
  }finally{
    tq.busy = false; tq.job = null; tq.ctl = null;
    if(bk === me){ foot(); chapterList(); info(); endLabels(); }
    if(bk && (bk !== me || tq.again)){ tq.again = false; setTimeout(pump, 0); }   // 다른 책을 그사이 열었거나, 장을 옮겨 멈춘 경우
  }
}
async function runJob(job, me){
  const ctl = tq.ctl = new AbortController(), k = job.idx.length;
  let res = null, e = null;
  tq.calls++;
  try{ res = await AI.generate(buildPrompt(job), {signal: ctl.signal, tier: 'fast', temperature: 0.4, maxTokens: 16384, onText: ({text}) => { if(bk === me) live(job, text); }}); }
  catch(x){ e = x; }
  if(bk !== me) return false;
  const p = parseOut(res ? res.text : (e && e.text) || '', k), whole = !!res && !res.truncated;
  let got = 0;
  for(const [n, v] of p.out){
    if(!v || (!whole && n === p.last)) continue;   // 끊긴 답의 마지막 문단은 덜 왔을 수 있다
    const i = job.idx[n - 1]; if(bk.tr[i] != null) continue;
    bk.tr[i] = v; delete bk.tries[i]; touch(i); got++;
  }
  if(p.title && !bk.trTitle){ bk.trTitle = p.title; head(); }
  addGloss(p.gl, p.tone);
  if(whole){   // 빠뜨린 문단: 두 번 빠지면 원문으로 둔다
    for(let n = 1; n <= k; n++){ const i = job.idx[n - 1]; if(bk.tr[i] == null){ bk.tries[i] = (bk.tries[i] || 0) + 1; if(bk.tries[i] >= 2){ bk.fail[i] = 1; touch(i); } } }
  }
  if(got || whole) save();
  paintJob(job);
  if(res){
    tq.limit = 0;
    tq.fails = got ? 0 : tq.fails + 1;
    if(tq.fails >= 3){ tq.err = {code: 'empty_completion'}; return false; }
    return true;
  }
  const c = e && e.code;
  if(c === 'cancelled') return false;
  if(c === 'refused' || c === 'prompt_too_large'){   // 반씩 나눠 다시. 한 문단만 남았는데도 안 되면 원문으로 둔다
    if(k > 1 && !got){ tq.limit = Math.max(1, Math.ceil(k / 2)); return true; }
    if(!got){ bk.fail[job.idx[0]] = 1; touch(job.idx[0]); save(); paintJob(job); }
    tq.limit = 0; return true;
  }
  if((c === 'busy' || c === 'network' || c === 'timeout' || c === 'empty_completion') && got && ++tq.fails < 3) return true;
  tq.err = e || {code: 'http'};
  return false;
}
function stopNow(){ tq.stopped = true; if(tq.ctl) tq.ctl.abort(); foot(); }
function resume(){ tq.stopped = false; tq.err = null; tq.fails = 0; tq.limit = 0; pump(); }

/* ================= 화면 ================= */
const doc = $('#trDoc'), scroller = $('#trScroll'), reader = $('#trReader');
let els = new Map();
function chapterTitle(k, short){
  const c = bk.chaps[k]; if(!c) return '';
  const hs = []; for(let i = c.a; i < c.b && (bk.paras[i].c || bk.paras[i].h); i++) hs.push(i);
  let t = hs.length && hs.every(i => bk.tr[i] != null) ? hs.map(i => plain(bk.tr[i])).join(' ') : c.t;
  if(!t) t = c.part ? '구간 ' + (k + 1) : k === 0 ? '앞부분' : (k + 1) + '번째';
  return short && t.length > 34 ? t.slice(0, 33) + '…' : t;
}
const chapterLeft = k => { const c = bk.chaps[k]; for(let i = c.a; i < c.b; i++) if(pending(i)) return true; return false; };
function chapterList(){
  if(!bk) return;
  const sel = $('#trCh'), frag = document.createDocumentFragment();
  bk.chaps.forEach((c, k) => { const o = document.createElement('option'); o.value = k; o.textContent = (chapterLeft(k) ? '' : '✓ ') + chapterTitle(k, true); frag.appendChild(o); });
  sel.textContent = ''; sel.appendChild(frag); sel.value = String(view.ch);
}
function head(){
  if(!bk) return;
  $('#trName').textContent = bk.trTitle ? bk.trTitle + ' · ' + bk.title : bk.title;
}
function info(){
  if(!bk) return;
  $('#trInfo').textContent = (view.ch + 1) + '/' + bk.chaps.length + '장 ' + (pg.cur + 1) + '/' + pg.n + '쪽 · 번역 ' + counts().pct + '%';
}
function render(){
  const c = bk.chaps[view.ch];
  doc.textContent = ''; els = new Map();
  const frag = document.createDocumentFragment();
  for(let i = c.a; i < c.b; i++){
    const p = bk.paras[i], sec = document.createElement('section');
    sec.className = 'tp' + (p.c || p.h ? ' c' : '') + (p.s ? ' s' : ''); sec.dataset.i = i;
    if(!p.s){ const kk = document.createElement('p'); kk.className = 'k'; kk.lang = 'ko'; sec.appendChild(kk); }
    const o = document.createElement('p'); o.className = 'o'; o.lang = bk.lang || 'en'; if(p.s) o.textContent = p.m; else fill(o, p.m); sec.appendChild(o);
    frag.appendChild(sec); els.set(i, sec);
  }
  const end = document.createElement('div'); end.className = 'tr-end';
  if(view.ch > 0){ const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost prev'; b.dataset.to = view.ch - 1; b.innerHTML = '‹ 앞 장<small></small>'; b.onclick = () => go(view.ch - 1); end.appendChild(b); }
  if(view.ch + 1 < bk.chaps.length){ const b = document.createElement('button'); b.type = 'button'; b.className = 'next'; b.dataset.to = view.ch + 1; b.innerHTML = '다음 장 ›<small></small>'; b.onclick = () => go(view.ch + 1); end.appendChild(b); }
  frag.appendChild(end);
  doc.appendChild(frag);
  endLabels();
  for(const i of els.keys()) paint(i);
  if(tq.job && tq.job.ch === view.ch) mark(tq.job, true);
  $('#trPrev').disabled = view.ch <= 0; $('#trNext').disabled = view.ch + 1 >= bk.chaps.length;
}
const endLabels = () => doc.querySelectorAll('.tr-end [data-to]').forEach(b => { b.lastChild.textContent = chapterTitle(+b.dataset.to, true); });
function paint(i){
  const sec = els.get(i); if(!sec || !bk) return;
  const t = bk.tr[i], k = sec.querySelector('.k');
  sec.classList.toggle('has', t != null);
  sec.classList.toggle('fail', !!bk.fail[i] && t == null);
  sec.classList.toggle('ed', !!bk.ed[i]);
  sec.classList.remove('live');
  if(k){
    if(t != null) fill(k, t); else k.textContent = '';
    if(view.edit && t != null) k.contentEditable = 'true'; else k.removeAttribute('contenteditable');
  }
  relayoutSoon();   // 번역문이 들어오면 쪽 나눔이 바뀐다
}
const paintJob = job => job.idx.forEach(paint);
function mark(job, on){ for(const i of job.idx){ const s = els.get(i); if(s) s.classList.toggle('wait', on); } }
function live(job, text){
  if(job.ch !== view.ch) return;
  const p = parseOut(text, job.idx.length);
  for(const [n, v] of p.out){
    const i = job.idx[n - 1], sec = els.get(i); if(!sec || bk.tr[i] != null) continue;
    const k = sec.querySelector('.k'); if(!k) continue;
    fill(k, v); sec.classList.add('has'); sec.classList.toggle('live', n === p.last);
  }
  relayoutSoon();
}
function foot(){
  if(!bk) return;
  reader.classList.toggle('busy', !!(tq.busy && tq.job));
  const st = $('#trStat'), act = $('#trAct'), all = $('#trAll'), c = counts();
  st.className = ''; act.hidden = true; act.onclick = null;
  all.hidden = c.done >= c.all; all.setAttribute('aria-pressed', String(!!bk.all));
  if(tq.err){
    const code = tq.err.code;
    st.className = 'err'; st.textContent = AI.errorText(tq.err);
    act.hidden = false;
    if(['no_key', 'no_model', 'auth', 'model'].includes(code)){ act.textContent = '설정 열기'; act.onclick = openSettings; }
    else { act.textContent = '다시'; act.onclick = resume; }
    return;
  }
  if(tq.busy && tq.job){
    st.className = 'busy';
    st.textContent = '번역하는 중 · ' + chapterTitle(tq.job.ch, true) + (tq.job.ch !== view.ch ? ' (미리)' : '');
    act.hidden = false; act.textContent = '멈추기'; act.onclick = stopNow;
    return;
  }
  if(tq.stopped){ st.textContent = '번역을 멈췄습니다.'; act.hidden = false; act.textContent = '이어서 번역'; act.onclick = resume; return; }
  if(c.done >= c.all){ st.textContent = '책 전체를 번역했습니다. 「원고로」를 누르면 편집할 수 있는 원고가 됩니다.'; return; }
  st.textContent = chapterLeft(view.ch) ? '' : '이 장은 번역을 마쳤습니다.';
}
function go(ch, pos){
  if(!bk) return;
  ch = Math.max(0, Math.min(bk.chaps.length - 1, ch));
  closeMsMenu();
  const moved = ch !== view.ch || !els.size;
  view.ch = ch; render(); chapterList();
  layout(); pg.anchor = null;
  if(pos && pos.last) show(pg.n - 1, false);   // 앞 장의 끝으로 넘어온 경우
  else if(pos && (pos.p != null || pos.end)) goPos(pos);
  else show(0, false);
  if(!pg.anchor){ const p0 = posNow(); if(p0) pg.anchor = p0; }
  info();
  if(moved || pos) savePos();
  // 지금 돌고 있는 요청이 이 장이나 다음 장 것이 아니면 멈추고 이 장부터
  if(tq.busy && tq.job && tq.job.ch !== ch && tq.job.ch !== ch + 1 && !bk.all){ tq.again = true; if(tq.ctl) tq.ctl.abort(); }
  else pump();
  foot();
}
/* ---- 쪽 넘기기(읽기 모드와 같은 방식): 장 안의 글을 화면 크기의 단(column)으로 나누고 scrollLeft로 한 장씩.
   오른쪽 30%·왼쪽으로 쓸기 = 다음 쪽(장 끝이면 다음 장 첫 쪽), 왼쪽 30%·오른쪽으로 쓸기 = 앞 쪽(장 처음이면 앞 장 끝 쪽),
   가운데 = 띠 숨기기(전체 화면)·잠깐 보이기. 고치기 중에는 번역문을 누르면 글자 자리가 잡힌다.
   번역문이 들어오거나 보기·글자 크기·화면이 바뀌면 다시 나누고, 읽던 문단(pg.anchor)이 있는 쪽으로 간다 ---- */
const pg = {stride: 0, n: 1, cur: 0, anchor: null};
const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const pageOf = x => Math.floor((x - scroller.getBoundingClientRect().left + scroller.scrollLeft) / pg.stride + 0.002);
function layout(){
  const sw = scroller.clientWidth, sh = scroller.clientHeight; if(!sw || !sh) return;
  const small = sw < 620, padX = small ? 20 : 48, padY = small ? 22 : 40;
  const colW = Math.min(720, sw - padX * 2), gap = sw - colW, d = doc.style;
  pg.stride = sw;
  d.setProperty('--pg-w', colW + 'px'); d.setProperty('--pg-gap', gap + 'px'); d.setProperty('--pg-m', gap / 2 + 'px');
  d.setProperty('--pg-h', Math.max(80, sh - padY * 2) + 'px'); d.setProperty('--pg-t', padY + 'px');
  const sp = spacer(scroller); sp.style.width = '0px';
  let n = Math.round(scroller.scrollWidth / sw);
  const last = doc.lastElementChild;
  if(last){ const rs = last.getClientRects(); if(rs.length) n = Math.max(n, pageOf(rs[rs.length - 1].left) + 1); }
  pg.n = Math.max(1, n);
  sp.style.width = pg.n * sw + 'px';   // 마지막 쪽도 끝까지 넘길 수 있게(글 끝이 쪽 끝보다 짧아 오른쪽으로 밀리던 것)
  if(pg.cur > pg.n - 1) pg.cur = pg.n - 1;
}
/* 넘길 수 있는 폭을 쪽 수 × 화면폭으로 맞추는 빈 막대(단의 글은 쪽 끝 여백까지 닿지 않는다) */
function spacer(sc){
  let sp = sc.querySelector(':scope > .pg-spacer');
  if(!sp){ sp = document.createElement('div'); sp.className = 'pg-spacer'; sp.setAttribute('aria-hidden', 'true'); sc.appendChild(sp); }
  return sp;
}
function show(k, smooth){
  pg.cur = Math.max(0, Math.min(pg.n - 1, k));
  const left = pg.cur * pg.stride;
  if(smooth && !reduceMotion()) scroller.scrollTo({left, behavior: 'smooth'}); else scroller.scrollLeft = left;
  info();
}
/* 손으로 넘길 때: 장 끝을 넘어가면 옆 장으로 */
function turn(k){
  if(!bk) return;
  reader.classList.remove('peek');
  if(k > pg.n - 1){ if(view.ch + 1 < bk.chaps.length) go(view.ch + 1); else show(pg.cur, true); return; }
  if(k < 0){ if(view.ch > 0) go(view.ch - 1, {last: true}); else show(0, true); return; }
  show(k, true);
  const p = posNow(); if(p) pg.anchor = p;
}
function relayout(){
  if(!bk || reader.hidden) return;
  layout();
  if(pg.anchor && (pg.anchor.p != null || pg.anchor.end)) goPos(pg.anchor); else show(pg.cur, false);
}
let relayT = null;
function relayoutSoon(){ clearTimeout(relayT); relayT = setTimeout(relayout, 120); }
new ResizeObserver(() => { if(bk && !reader.hidden) relayoutSoon(); }).observe(scroller);
if(document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { if(bk && !reader.hidden) relayoutSoon(); });
/* 읽던 자리: 그 쪽 맨 위에 보이는 문단(data-i)과, 여러 쪽에 걸친 문단이면 몇 번째 조각인지(f) */
function posNow(){
  if(!bk || !els.size || !pg.stride) return null;
  if(pg.cur === 0) return {ch: view.ch};
  const secs = [...els.values()];
  const lastPage = el => { const rs = el.getClientRects(); return rs.length ? pageOf(rs[rs.length - 1].left) : -1; };
  let lo = 0, hi = secs.length - 1;
  while(lo < hi){ const m = (lo + hi) >> 1; if(lastPage(secs[m]) >= pg.cur) hi = m; else lo = m + 1; }
  if(lastPage(secs[lo]) < pg.cur) return {ch: view.ch, end: 1};   // 장 끝의 「다음 장」 단추만 있는 쪽
  const pages = [...new Set([...secs[lo].getClientRects()].map(r => pageOf(r.left)))].sort((a, b) => a - b);
  const idx = Math.max(0, pages.indexOf(pg.cur));
  return {ch: view.ch, p: +secs[lo].dataset.i, f: pages.length > 1 ? Math.round(idx / pages.length * 1000) / 1000 : 0};
}
function goPos(pos){
  pg.anchor = pos;
  if(pos.end){ show(pg.n - 1, false); return; }
  const sec = pos.p != null && els.get(pos.p);
  if(!sec){ show(0, false); return; }
  const pages = [...new Set([...sec.getClientRects()].map(r => pageOf(r.left)))].sort((a, b) => a - b);
  show(pages.length ? pages[Math.min(pages.length - 1, Math.floor((pos.f || 0) * pages.length + 0.001))] : 0, false);
}
function savePos(){ if(!bk) return; const p = posNow(); if(p) L.setPos(bk.id, p, {pct: counts().pct}).catch(() => {}); }
let posT = null;
scroller.addEventListener('scroll', () => { if(!bk || posT) return; posT = setTimeout(() => { posT = null; savePos(); }, 700); });

/* 글자 크기·보기 */
const FS_MIN = 12, FS_MAX = 44;
const fsNow = () => { const v = Number(lsGet('tr-fs') || lsGet('rd-fs')); return v >= FS_MIN && v <= FS_MAX ? v : (W.prefs.fs || 16); };
function setFs(v){ v = Math.max(FS_MIN, Math.min(FS_MAX, Math.round(v))); doc.style.setProperty('--fs', v + 'px'); $('#trSm').disabled = v <= FS_MIN; $('#trLg').disabled = v >= FS_MAX; return v; }
function stepFs(d){ const v = setFs(fsNow() + d); lsSet('tr-fs', v); relayout(); toast('글자 크기 ' + v, 1200); }
$('#trSm').onclick = () => stepFs(-1); $('#trLg').onclick = () => stepFs(1);
function setView(v){
  if(!['tr', 'both', 'src'].includes(v)) v = 'tr';
  if(view.edit && v === 'src') v = 'both';
  view.v = v; lsSet('tr-view', v);
  doc.classList.remove('v-tr', 'v-both', 'v-src'); doc.classList.add('v-' + v);
  document.querySelectorAll('#trBar [data-v]').forEach(b => { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  relayout();
}
document.querySelectorAll('#trBar [data-v]').forEach(b => { b.onclick = () => setView(b.dataset.v); });
$('#trCh').onchange = () => go(+$('#trCh').value);
$('#trPrev').onclick = () => go(view.ch - 1);
$('#trNext').onclick = () => go(view.ch + 1);
$('#trAll').onclick = () => { if(!bk) return; bk.all = !bk.all; saveSoon(); if(bk.all){ tq.stopped = false; pump(); } foot(); };

/* 전체 화면으로 읽기: 위·아래 띠를 숨기고 글만 보인다. 브라우저의 전체 화면(requestFullscreen)은 쓰지 않는다
   — 켤 때마다 브라우저가 「전체 화면을 종료하려면…」 안내를 띄우는데 페이지에서 끌 수 없어서(작가 요청으로 뺌).
   글을 한 번 누르면 띠가 잠깐 글 위로 나오고(peek), 한 번 더 누르면 들어간다. F 키로 켜고 끄고, Esc로 끈다 */
function setFull(on){
  on = !!on;
  if(on === reader.classList.contains('full')) return;
  const pos = posNow();
  reader.classList.toggle('full', on); reader.classList.remove('peek');
  $('#trFull').setAttribute('aria-pressed', String(on));
  $('#trFull').setAttribute('aria-label', on ? '전체 화면 끝내기' : '전체 화면으로 읽기');
  $('#trFull').title = on ? '전체 화면 끝내기 (F·Esc)' : '전체 화면으로 읽기 (F)';
  closeMsMenu();
  if(pos && (pos.p != null || pos.end)) pg.anchor = pos;   // 띠가 사라지거나 나와 화면 크기가 바뀌어도 읽던 문단을 그대로
  relayout();
}
$('#trFull').onclick = e => { e.stopPropagation(); setFull(!reader.classList.contains('full')); };
// 누르기: 왼쪽 30% 앞 쪽, 오른쪽 30% 다음 쪽, 가운데는 띠. 고치기 중인 번역문을 누르면 글자 자리만 잡는다
scroller.addEventListener('click', e => {
  if(!bk || e.target.closest('button, a, select, [contenteditable="true"]')) return;
  const sel = getSelection(); if(sel && String(sel).trim()) return;   // 글을 고르는 중이면 그대로
  const r = scroller.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
  if(x < 0.3) turn(pg.cur - 1);
  else if(x > 0.7) turn(pg.cur + 1);
  else if(!reader.classList.contains('full')) setFull(true);
  else reader.classList.toggle('peek');
});
// 쓸기: 손가락을 따라 옆으로 움직이다가, 충분히 쓸었으면 다음·앞 쪽으로, 아니면 제자리로
let sw0 = null;
scroller.addEventListener('touchstart', e => { if(e.touches.length !== 1){ sw0 = null; return; } const t = e.touches[0]; sw0 = {x: t.clientX, y: t.clientY, t: Date.now(), left: pg.cur * pg.stride, moved: false}; }, {passive: true});
scroller.addEventListener('touchmove', e => {
  if(!sw0 || e.touches.length !== 1) return;
  const t = e.touches[0], dx = t.clientX - sw0.x, dy = t.clientY - sw0.y;
  if(!sw0.moved && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
  sw0.moved = true;
  if(Math.abs(dx) > Math.abs(dy)) scroller.scrollLeft = sw0.left - dx;
}, {passive: true});
scroller.addEventListener('touchend', e => {
  const s0 = sw0; sw0 = null; if(!s0 || !s0.moved) return;
  const t = e.changedTouches[0], dx = t.clientX - s0.x, dy = t.clientY - s0.y, v = Math.abs(dx) / Math.max(1, Date.now() - s0.t);
  if(Math.abs(dx) > Math.abs(dy) && (Math.abs(dx) > pg.stride * 0.18 || v > 0.35)) turn(pg.cur + (dx < 0 ? 1 : -1));
  else show(pg.cur, true);
}, {passive: true});
scroller.addEventListener('touchcancel', () => { if(sw0 && sw0.moved) show(pg.cur, true); sw0 = null; }, {passive: true});
let wheelAt = 0;
scroller.addEventListener('wheel', e => {
  if(e.ctrlKey) return;
  e.preventDefault();
  const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX, now = Date.now();
  if(Math.abs(d) < 4 || now - wheelAt < 380) return;
  wheelAt = now; turn(pg.cur + (d > 0 ? 1 : -1));
}, {passive: false});

/* 고치기: 번역문을 직접 고친다. 문단 나누기(엔터)는 막고, 붙여 넣기는 글만 */
function setEdit(on){
  view.edit = !!on;
  $('#trEdit').setAttribute('aria-pressed', String(view.edit));
  doc.classList.toggle('editing', view.edit);
  if(view.edit && view.v === 'src') setView('both');
  for(const i of els.keys()) paint(i);
  if(view.edit) toast('번역문을 눌러 고치세요. 고친 문단은 다시 번역해도 그대로 둡니다.', 4000);
  if(view.edit && reader.classList.contains('full')) setFull(false);
}
$('#trEdit').onclick = () => setEdit(!view.edit);
const edDirty = new Set(); let edT = null;
doc.addEventListener('input', e => {
  const k = e.target.closest && e.target.closest('.k'); if(!k || !bk) return;
  const i = +k.parentNode.dataset.i; edDirty.add(i);
  clearTimeout(edT); edT = setTimeout(flushEdits, 700);
});
function flushEdits(){
  if(!bk || !edDirty.size) return;
  for(const i of edDirty){ const sec = els.get(i), k = sec && sec.querySelector('.k'); if(!k) continue; bk.tr[i] = domToMarkup(k); bk.ed[i] = 1; delete bk.fail[i]; touch(i); sec.classList.add('ed'); }
  edDirty.clear(); save();
}
doc.addEventListener('keydown', e => { if(e.key === 'Enter' && e.target.closest && e.target.closest('.k')) e.preventDefault(); });
doc.addEventListener('paste', e => {
  if(!(e.target.closest && e.target.closest('.k'))) return;
  e.preventDefault();
  const t = ((e.clipboardData && e.clipboardData.getData('text/plain')) || '').replace(/\s+/g, ' ');
  if(!document.execCommand('insertText', false, t)){ const s = getSelection(); if(s.rangeCount){ const r = s.getRangeAt(0); r.deleteContents(); r.insertNode(document.createTextNode(t)); r.collapse(false); } }
});

/* 원고로: 번역문으로 편집할 수 있는 원고를 만든다 */
function closeMsMenu(){ $('#trMsMenu').hidden = true; $('#trMsBtn').setAttribute('aria-expanded', 'false'); }
$('#trMsBtn').onclick = e => {
  e.stopPropagation(); if(!bk) return;
  const m = $('#trMsMenu');
  if(!m.hidden){ closeMsMenu(); return; }
  const done = bk.chaps.filter((c, k) => !chapterLeft(k)).length, full = done === bk.chaps.length;
  $('#trMsDone').firstChild.textContent = full ? '원고로 만들기' : '번역한 장만';
  $('#trMsDone').lastChild.textContent = full ? '책 전체 · ' + bk.chaps.length + '장' : '다 옮긴 장 ' + done + '개 (모두 ' + bk.chaps.length + '장)';
  $('#trMsDone').disabled = !done; $('#trMsAll').hidden = full;
  m.hidden = false; $('#trMsBtn').setAttribute('aria-expanded', 'true');
  const r = $('#trMsBtn').getBoundingClientRect(), rr = reader.getBoundingClientRect();
  m.style.top = Math.round(r.bottom - rr.top + 6) + 'px';
  m.style.left = Math.round(Math.max(8, Math.min(r.left - rr.left, rr.width - m.offsetWidth - 8))) + 'px';
};
reader.addEventListener('click', e => { if(!$('#trMsMenu').hidden && !e.target.closest('#trMsMenu')) closeMsMenu(); });
async function toMs(all){
  closeMsMenu(); flushEdits();
  const paras = []; let chs = 0, chars = 0;
  bk.chaps.forEach((c, k) => {
    if(!all && chapterLeft(k)) return;
    chs++;
    for(let i = c.a; i < c.b; i++){
      const p = bk.paras[i], runs = p.s ? [{t: '* * *', b: false, i: false}] : fromMarkup(bk.tr[i] != null ? bk.tr[i] : p.m).map(r => ({t: r.t.replace(new RegExp(STAR, 'g'), '*'), b: r.b, i: r.i}));
      chars += runs.reduce((s, r) => s + r.t.replace(/\s/g, '').length, 0);
      paras.push({runs, chap: !!(p.c || p.h)});
    }
  });
  if(!paras.length){ toast('아직 다 옮긴 장이 없습니다', 4000); return; }
  const title = bk.trTitle || bk.title;
  await save(); close(true);
  await W.newMs(title, W.parasToHtml(paras));
  W.notice('「' + title + '」 번역 원고를 만들었습니다 · ' + chs + '장 · ' + chars.toLocaleString() + '자. 번역 모드의 책과 번역은 이 기기에 그대로 남아 있습니다.');
}
$('#trMsDone').onclick = () => toMs(false);
$('#trMsAll').onclick = () => toMs(true);

/* 표기·설정 창 */
function left(){
  let n = 0, chars = 0;
  bk.chaps.forEach((c, k) => { let m = 0; for(let i = c.a; i < c.b; i++) if(pending(i)) m += bk.paras[i].m.length; chars += m; n += Math.ceil(m / TARGET); });
  return {n, chars};
}
function openDlg(){
  if(!bk) return;
  closeMsMenu();
  $('#trGl').value = bk.gloss;
  const l = left(), md = AI.model();
  $('#trLeft').textContent = (l.chars ? '아직 옮기지 않은 원문 약 ' + l.chars.toLocaleString() + '자 · 요청 약 ' + l.n + '번.' : '모두 옮겼습니다.') + (tq.calls ? ' 이번에 연 뒤 ' + tq.calls + '번 불렀습니다.' : '') + ' 모델: ' + (md || '(아직 고르지 않음)') + '.';
  $('#trDlgMsg').textContent = '';
  $('#trDlg').hidden = false;
}
function closeDlg(){ $('#trDlg').hidden = true; }
$('#trGlBtn').onclick = openDlg;
$('#trDlgClose').onclick = closeDlg;
$('#trDlg').addEventListener('click', e => { if(e.target.id === 'trDlg') closeDlg(); });
$('#trGl').addEventListener('input', () => { if(bk){ bk.gloss = $('#trGl').value; bk.glossAt = Date.now(); saveSoon(); } });
$('#trRedo').onclick = () => {
  if(!bk) return;
  const c = bk.chaps[view.ch]; let n = 0;
  for(let i = c.a; i < c.b; i++){ if(bk.ed[i] || bk.paras[i].s) continue; if(bk.tr[i] != null || bk.fail[i]){ n++; touch(i); } delete bk.tr[i]; delete bk.fail[i]; delete bk.tries[i]; }
  save(); closeDlg();
  if(tq.busy && tq.job && tq.job.ch === view.ch){ tq.again = true; if(tq.ctl) tq.ctl.abort(); }
  const keep = posNow(); render(); chapterList(); layout(); if(keep && keep.p != null) goPos(keep); else show(0, false);
  tq.stopped = false; tq.err = null; pump();
  toast(n ? '이 장을 다시 옮깁니다' : '다시 옮길 문단이 없습니다', 3000);
};
$('#trForget').onclick = async () => {
  if(!bk) return;
  const b = $('#trForget');
  if(b.dataset.sure !== '1'){ b.dataset.sure = '1'; b.textContent = '한 번 더 누르면 지웁니다'; $('#trDlgMsg').textContent = '번역한 문단과 표기표가 모두 지워집니다. 원고로 만든 것은 남습니다.'; setTimeout(() => { b.dataset.sure = ''; b.textContent = '이 기기에 보관한 이 책과 번역 지우기'; }, 5000); return; }
  b.dataset.sure = ''; b.textContent = '이 기기에 보관한 이 책과 번역 지우기';
  const id = bk.id, t = bk.title;
  closeDlg(); close(true);
  try{ await saveP; await L.forget(id); }catch(e){}
  toast('「' + t + '」의 번역 기록을 지웠습니다', 4000);
};

/* 설정(lightning) 창을 번역 화면 위로 */
function openSettings(){
  setFull(false);
  reader.classList.add('under');
  $('#setBtn').click();
  const ai = $('#setAi'); if(ai) ai.open = true;
  const dlg = $('#aiDlg');
  const ob = new MutationObserver(() => {
    if(!dlg.hidden) return;
    ob.disconnect(); reader.classList.remove('under');
    if(bk && AI.hasKey() && AI.model()){ tq.err = null; tq.fails = 0; pump(); }
    foot();
  });
  ob.observe(dlg, {attributes: true, attributeFilter: ['hidden']});
}

/* ================= 열기 · 닫기 ================= */
function shell(name){
  if(tq.ctl) tq.ctl.abort();
  bk = null; els = new Map();
  W.closePops(); $('#toast').hidden = true;
  closeMsMenu(); closeDlg(); setEdit(false);
  for(const v of ['--font', '--lh']) doc.style.setProperty(v, $('#paper').style.getPropertyValue(v));
  doc.classList.toggle('indent', W.prefs.indent !== false);
  setFs(fsNow()); setView(lsGet('tr-view') || 'tr');
  $('#trName').textContent = name; $('#trInfo').textContent = ''; $('#trStat').textContent = ''; $('#trAct').hidden = true; $('#trAll').hidden = true;
  $('#trCh').textContent = '';
  doc.innerHTML = '<p class="rd-wait">여는 중…</p>';
  pg.cur = 0; pg.n = 1; pg.anchor = null;
  reader.hidden = false; scroller.scrollTop = 0; scroller.scrollLeft = 0; scroller.focus({preventScroll: true});
  if(narrow()) $('#app').classList.remove('drawer');
}
/* 다른 기기가 같은 책에 더한 번역을 지금 화면의 기록에 합친다(library.js가 부른다) */
function mergeOpen(remote){
  if(!bk || !remote || remote.id !== bk.id) return false;
  flushEdits();
  const m = L.mergeTr(bk, remote);
  for(const k of ['tr', 'ed', 'fail', 'ts', 'gloss', 'glossAt', 'trTitle']) bk[k] = m[k];
  const act = document.activeElement;
  for(const [i, sec] of els) if(!(view.edit && act && sec.contains(act))) paint(i);
  if(!$('#trDlg').hidden && act !== $('#trGl')) $('#trGl').value = bk.gloss;
  head(); chapterList(); info(); endLabels(); foot();
  save();
  return true;
}
function start(rec, pos, src){
  bk = rec;
  for(const k of ['tr', 'ed', 'fail', 'tries', 'ts']) if(!bk[k] || typeof bk[k] !== 'object') bk[k] = {};
  bk.gloss = bk.gloss || ''; bk.trTitle = bk.trTitle || '';
  const before = chaptersOf(bk.paras);
  if(src && src !== rec && src.paras.length === bk.paras.length) bk.paras.forEach((p, i) => {   // 같은 글이라 문단 순서도 같다
    const q = src.paras[i]; for(const k of ['k', 'kt', 'h']){ if(q[k]) p[k] = q[k]; else delete p[k]; }
  });
  if(!marked(bk.paras)) bk.paras.forEach(p => { if(!p.s && titleLine(plain(p.m))) p.h = 1; });
  bk.chaps = chaptersOf(bk.paras);
  Object.assign(tq, {stopped: false, err: null, limit: 0, fails: 0, again: false, calls: 0});
  pos = pos || lsGet('tr-pos-' + bk.id) || {};   // tr-pos-: 옛 판이 이 기기에 적어 둔 자리
  // 장이 새로 나뉘었으면 읽던 자리(장 번호)를 같은 문단이 든 장으로 옮긴다
  const chOf = i => bk.chaps.findIndex(c => i >= c.a && i < c.b);
  if(pos.p != null && chOf(pos.p) >= 0) pos = Object.assign({}, pos, {ch: chOf(pos.p)});
  else if(Number.isInteger(pos.ch) && before[pos.ch] && JSON.stringify(before.map(c => c.a)) !== JSON.stringify(bk.chaps.map(c => c.a))){
    const o = before[pos.ch];
    pos = pos.end ? {ch: chOf(o.b - 1), end: 1} : {ch: chOf(o.a), p: o.a, f: 0};
  }
  L.live = {id: bk.id, merge: mergeOpen, gone(){ close(true); toast('다른 기기에서 이 책을 서재에서 지웠습니다', 5000); }};
  head();
  els = new Map(); view.ch = -1;
  go(Number.isInteger(pos.ch) ? pos.ch : 0, pos);
  save();
}
async function openFile(f){
  shell(f.name);
  try{
    const src = await loadSource(f);
    if(!src.paras.some(p => !p.s && p.m.trim())) throw new Error('empty');
    const id = await hashOf(src);
    const rec = await L.trGet(id), m = await L.meta(id);
    if(reader.hidden) return;
    start(rec || Object.assign(src, {id, name: f.name, trTitle: '', tr: {}, ed: {}, fail: {}, tries: {}, ts: {}, gloss: '', glossAt: 0, all: false}), m && m.pos, src);
  }catch(e){
    if(reader.hidden) return;
    const msg = B.errText(e);
    doc.innerHTML = '<p class="rd-wait"></p>'; doc.firstChild.textContent = msg;
  }
}
async function openSaved(id){
  shell('…');
  let rec = await L.trGet(id), err = null;
  if(!rec){
    doc.innerHTML = '<p class="rd-wait">드라이브에서 받는 중…</p>';
    try{ rec = await L.trFetch(id); }catch(e){ err = e; }
  }
  if(reader.hidden) return;
  if(!rec){
    doc.innerHTML = '<p class="rd-wait"></p>';
    doc.firstChild.textContent = err && err.code === 'network' ? '인터넷에 연결된 뒤 드라이브에서 받을 수 있습니다.' : err && err.code === 'auth' ? '드라이브 연결이 만료되었습니다. 원고 목록 아래 「다시 연결」을 누른 뒤 다시 열어 주세요.' : '이 책의 번역 기록을 찾지 못했습니다.';
    return;
  }
  const m = await L.meta(id);
  start(rec, m && m.pos);
}
function close(quiet){
  if(reader.hidden) return;
  flushEdits(); clearTimeout(saveT); clearTimeout(posT); posT = null;
  if(bk){ savePos(); if(!quiet) save(); }
  if(tq.ctl) tq.ctl.abort();
  bk = null; els = new Map(); doc.textContent = ''; L.live = null;
  setFull(false);
  closeMsMenu(); closeDlg(); reader.hidden = true; reader.classList.remove('under', 'busy');
  saveP.then(() => { L.soon(1500); L.render(); });
  if(!narrow()) $('#paper').focus({preventScroll: true});
}
$('#trClose').onclick = () => close();
$('#trIn').onchange = () => { const f = $('#trIn').files[0]; $('#trIn').value = ''; if(f) openFile(f); };
$('#trBtn').addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); $('#trIn').click(); } });

/* ================= 키 ================= */
window.addEventListener('keydown', e => {
  if(reader.hidden || reader.classList.contains('under')) return;
  if(e.key === 'Escape'){
    e.preventDefault(); e.stopPropagation();
    if(!$('#trDlg').hidden) closeDlg(); else if(!$('#trMsMenu').hidden) closeMsMenu(); else if(reader.classList.contains('full')) setFull(false); else close();
    return;
  }
  if(e.ctrlKey || e.metaKey){   // 번역 화면에서는 편집 단축키가 뒤의 원고에 닿지 않게. 찾기(Ctrl+F)는 브라우저 것을 쓴다
    if(/^f$/i.test(e.key)) e.stopPropagation();
    else if(e.key === 'Enter' || /^s$/i.test(e.key)){ e.preventDefault(); e.stopPropagation(); }
    else if(/^[zybi]$/i.test(e.key)){ e.stopPropagation(); if(!(e.target.closest && e.target.closest('.k'))) e.preventDefault(); }
    return;
  }
  const typing = e.target.closest && (e.target.closest('.k') || /^(input|textarea|select)$/i.test(e.target.localName));
  if(!typing && !e.altKey && $('#trDlg').hidden && /^f$/i.test(e.key)){ e.preventDefault(); setFull(!reader.classList.contains('full')); return; }
  if(!typing && !e.altKey && $('#trDlg').hidden && bk){   // 쪽 넘기기
    const k = e.key, next = k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || (k === ' ' && !e.shiftKey), prev = k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || (k === ' ' && e.shiftKey);
    if(next || prev){ e.preventDefault(); turn(pg.cur + (next ? 1 : -1)); }
    else if(k === 'Home' || k === 'End'){ e.preventDefault(); show(k === 'Home' ? 0 : pg.n - 1, true); const p = posNow(); if(p) pg.anchor = p; }
  }
}, true);
window.addEventListener('pagehide', () => { if(bk){ flushEdits(); savePos(); } });

window.__tr = {openFile, openSaved, close, _: {toMarkup, fromMarkup, domToMarkup, txtBook, chaptersOf, parseOut, buildPrompt: j => buildPrompt(j), chunkOf: (c, l) => chunkOf(c, l), state: () => ({bk, view, tq}), posNow}};
})();
