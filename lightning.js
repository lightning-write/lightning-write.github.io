/* 라이트닝 라이트 — 라이트닝 (앱 안에서 바로 AI를 부른다)
   번개: 커서 자리에서 이어 쓰기 (block 한두 문장 / blocks 한 문단)
   build: 쓴 데까지 맞춤법·띄어쓰기·군더더기 정리 → 바뀐 곳을 보고 받을 것만 고른다
   bricks: 떠오른 소재를 모아 두는 조각함
   스토밍: 브레인스토밍 → 8페이지즈 개요 → 인물표·연표. 위치 띠.
   자료는 원고 기록의 lt = {frags, mark, storm}에 담겨 드라이브 동기화로 다른 기기에도 간다.
   AI는 ai.js(Gemini)가 부른다. 키가 없으면 「라이트닝 설정」을 연다. */
(() => {
'use strict';
const W = window.__wongo, AI = window.__ai;
if(!W || !AI || typeof document === 'undefined') return;
const $ = s => document.querySelector(s);
const paper = $('#paper'), scroller = $('#scroll');
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
const clip = (t, k) => t.length > k ? t.slice(0, k) + '…' : t;
const hhmm = t => new Date(t).toLocaleTimeString('ko-KR', {hour: '2-digit', minute: '2-digit'});
const fmtWhen = t => { const d = new Date(t); if(isNaN(d)) return ''; return d.toDateString() === new Date().toDateString() ? hhmm(t) : (d.getMonth() + 1) + '월 ' + d.getDate() + '일'; };
const narrow = W.narrow, toast = W.toast, notice = W.notice;
function lsGet(k, d){ try{ const v = localStorage.getItem('wongo-lt-' + k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } }
function lsSet(k, v){ try{ localStorage.setItem('wongo-lt-' + k, JSON.stringify(v)); }catch(e){} }

/* ================= 설정 (이 기기) ================= */
const prefs = Object.assign({len: 'short', tier: 'mid', enter2: true}, lsGet('prefs', {}));
const savePrefs = () => lsSet('prefs', prefs);
function renderPrefs(){
  const para = prefs.len === 'para', b = $('#lenBtn');
  b.dataset.tip = para ? 'blocks' : 'block';
  b.dataset.tipD = para ? '번개 한 번에 한 문단이 나옵니다. 누르면 한두 문장(block)으로' : '번개 한 번에 한두 문장이 나옵니다. 누르면 한 문단(blocks)으로';
  b.setAttribute('aria-label', para ? 'blocks: 한 문단. 누르면 block으로' : 'block: 한두 문장. 누르면 blocks로');
  $('#lenIcS').toggleAttribute('hidden', para); $('#lenIcP').toggleAttribute('hidden', !para);
  document.querySelectorAll('[data-tier]').forEach(x => { const on = x.dataset.tier === prefs.tier; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
  $('#aiEnter2').checked = !!prefs.enter2;
}
$('#lenBtn').onclick = () => { prefs.len = prefs.len === 'para' ? 'short' : 'para'; savePrefs(); renderPrefs(); toast(prefs.len === 'para' ? 'blocks · 번개 한 번에 한 문단' : 'block · 번개 한 번에 한두 문장', 2200); };
document.querySelectorAll('[data-tier]').forEach(b => { b.onclick = () => { prefs.tier = b.dataset.tier; savePrefs(); renderPrefs(); }; });
$('#aiEnter2').onchange = () => { prefs.enter2 = $('#aiEnter2').checked; savePrefs(); };

/* ================= 원고의 라이트닝 자료 lt ================= */
const normLt = x => Object.assign({}, x || {}, {frags: x && Array.isArray(x.frags) ? x.frags.slice() : [], mark: (x && x.mark) || null});
let lt = normLt(null), ltId = null, ltT = null;
async function loadLt(){
  const c = W.cur(); if(!c){ lt = normLt(null); ltId = null; return; }
  const r = await W.DB.get(c.id);
  if(!W.cur() || W.cur().id !== c.id) return;
  lt = normLt(r && r.lt); ltId = c.id; stFill(lt.storm);
  renderFragCount(); renderBand();
  if(!$('#stormDlg').hidden) renderStorm();
  if(!$('#fragDlg').hidden) renderFrags();
}
function saveLt(){ clearTimeout(ltT); ltT = null; if(!ltId || !W.cur() || W.cur().id !== ltId) return; W.saveLt(ltId, lt); }
function markLt(){ clearTimeout(ltT); ltT = setTimeout(saveLt, 700); }
document.addEventListener('wongo:open', () => { stopGen(); hideSug(); lastSug = null; rejected.clear(); undoSt = null; stRv = null; stCT = null; stOpen.clear(); stAuto.clear(); clearTimeout(reflT); if(stBusy) stBusy.ctl.abort(); if(ltT) saveLt(); loadLt(); });
document.addEventListener('wongo:synced', () => { if(!gen && !stBusy && !tidyBusy() && !ltT) loadLt(); });
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden' && ltT) saveLt(); });
window.addEventListener('pagehide', () => { if(ltT) saveLt(); });

/* ================= 문장 나누기 · 비교 · 답 읽기 ================= */
const OPEN = '“‘「『（(〈《[{', CLOSE = '”’」』）)〉》]}';
const STOP = '.?!。？！', TERM = '.?!。？！…⋯';
/* 마침표 없이도 끝난 문장으로 보는 맺음말: 초고는 마침표 없이 번개를 누르는 일이 많다 */
const ENDED = /(다|요|까|죠|네|군|구나|자|냐|소서|니다|시오)$/
const AFTER_Q = /^\s*(하고|하며|하면서|하는|하자|하니|하더니|하곤|하였다|했다|한다|하던|라고|라며|라는|라면서|이라고|이라며|고|며)(\s|$|[.,])/;
function splitSents(text){
  const out = [], n = text.length;
  let st = 0, depth = 0, dq = false, sq = false;
  const cut = k => { const s = text.slice(st, k).trim(); if(s) out.push(s); st = k; };
  const tryCut = (k, afterQ) => { if(k < n && !/\s/.test(text[k])) return; if(afterQ && AFTER_Q.test(text.slice(k))) return; cut(k); };
  const closeQ = i => { if(!depth && !dq && !sq && i > 0 && TERM.includes(text[i - 1])) tryCut(i + 1, true); };
  for(let i = 0; i < n; i++){
    const c = text[i];
    if(OPEN.includes(c)){ depth++; continue; }
    if(CLOSE.includes(c)){ depth = Math.max(0, depth - 1); closeQ(i); continue; }
    if(c === '"'){ if(dq){ dq = false; closeQ(i); } else dq = true; continue; }
    if(c === "'"){ if(sq){ sq = false; closeQ(i); } else sq = true; continue; }
    if(STOP.includes(c) && !depth && !dq && !sq){
      let j = i; while(j + 1 < n && TERM.includes(text[j + 1])) j++;
      const run = text.slice(i, j + 1); i = j;
      if(run.length > 1 && /^[.…⋯]+$/.test(run)) continue;
      tryCut(j + 1, false);
    }
  }
  cut(n);
  return out;
}
const splitKw = s => (s || '').split(/[,，、/]/).map(x => x.trim().replace(/^#/, '')).filter(Boolean).slice(0, 6);
function parseResp(raw, nSents){
  const res = {ops: {}, ins: [], kw: {}, hits: 0};
  let sec = '';
  for(const line of String(raw || '').replace(/```[a-zA-Z]*/g, '').split(/\r?\n/)){
    const l = line.trim().replace(/^[-*•>]\s*/, '').replace(/\*\*/g, '').trim();
    if(!l) continue;
    if(/^\[\s*정리\s*\]$/.test(l)){ sec = 't'; continue; }
    if(/^\[\s*조각\s*핵심어\s*\]$/.test(l)){ sec = 'k'; continue; }
    let m;
    if(sec === 'k' && (m = l.match(/^\{\s*(\d+)\s*\}\s*[:：]?\s*(.*)$/))){ res.kw[+m[1]] = splitKw(m[2]); continue; }
    m = l.match(/^\[\s*(\d+)\s*(\+)?\s*\]\s*(.*)$/);
    if(!m || sec === 'k') continue;
    const n = +m[1], rest = m[3].trim();
    if(n < 1 || n > nSents) continue;
    res.hits++;
    if(m[2]){ const fm = rest.match(/^\{\s*(\d+)\s*\}\s*(.*)$/), t = (fm ? fm[2] : rest).trim(); if(t) res.ins.push({after: n, frag: fm ? +fm[1] : null, t}); continue; }
    if(!rest || /^[=＝]/.test(rest) || rest === '그대로'){ res.ops[n] = {k: 'same'}; continue; }
    if(/^삭제\.?$/.test(rest)){ res.ops[n] = {k: 'del'}; continue; }
    const mm = rest.match(/^메모\s*(?:[|｜:：]\s*(.*))?$/);
    if(mm){ res.ops[n] = {k: 'memo', kw: splitKw(mm[1])}; continue; }
    res.ops[n] = {k: 'edit', t: rest};
  }
  return res;
}
function cdiff(a, b){
  const n = a.length, m = b.length;
  if(!n || !m || n * m > 160000) return null;
  const dp = []; for(let i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1));
  for(let i = n - 1; i >= 0; i--) for(let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  const push = (t, s) => { const l = ops[ops.length - 1]; if(l && l.t === t) l.s += s; else ops.push({t, s}); };
  while(i < n && j < m){ if(a[i] === b[j]){ push('=', a[i]); i++; j++; } else if(dp[i + 1][j] >= dp[i][j + 1]) push('-', a[i++]); else push('+', b[j++]); }
  while(i < n) push('-', a[i++]);
  while(j < m) push('+', b[j++]);
  const out = []; let del = '', ins = '';
  const flush = () => { if(del) out.push({t: '-', s: del}); if(ins) out.push({t: '+', s: ins}); del = ins = ''; };
  ops.forEach((o, k) => {
    const lone = o.t === '=' && o.s.length === 1 && k > 0 && k < ops.length - 1 && ops[k - 1].t !== '=' && ops[k + 1].t !== '=';
    if(o.t === '-') del += o.s; else if(o.t === '+') ins += o.s; else if(lone){ del += o.s; ins += o.s; } else { flush(); out.push(o); }
  });
  flush();
  return {ops: out, sim: dp[0][0] / Math.max(n, m)};
}
function diffHtml(a, b){
  const d = cdiff(a, b);
  if(!d || d.sim < 0.4) return '<del>' + esc(a) + '</del> <ins>' + esc(b) + '</ins>';
  return d.ops.map(o => {
    if(o.t === '=') return esc(o.s);
    const sp = !o.s.trim();
    if(o.t === '-') return sp ? '<del class="sp" title="붙여 쓰기"><span class="m">⁀</span><span class="s"> </span></del>' : '<del>' + esc(o.s) + '</del>';
    return sp ? '<ins class="sp" title="띄어 쓰기">∨</ins>' : '<ins>' + esc(o.s) + '</ins>';
  }).join('');
}

/* ================= 원고의 문단 ================= */
const chapRe = W.chapRe, sceneRe = W.sceneRe, numRe = W.numRe;
const blocks = () => [...paper.children];
const textOf = el => (el.innerText || el.textContent || '').replace(/ /g, ' ').replace(/[ \t]*\n[ \t]*/g, ' ').replace(/\s+$/, '');
const isEmpty = el => !norm(textOf(el));
const isChap = el => el.classList.contains('chap') || chapRe.test(norm(textOf(el)));
const isSep = el => { const t = norm(textOf(el)); return isChap(el) || sceneRe.test(t) || numRe.test(t); };
function blockOf(node){
  if(!node || !paper.contains(node) || node === paper) return null;
  while(node && node.parentNode !== paper) node = node.parentNode;
  return node && node.nodeType === 1 ? node : null;
}
function normalizePaper(){
  let run = null, changed = false;
  for(const n of [...paper.childNodes]){
    const inline = n.nodeType === 3 ? n.nodeValue.trim() !== '' : (n.nodeType === 1 && !/^(DIV|P|H[1-6]|LI|UL|OL|BLOCKQUOTE)$/.test(n.tagName));
    if(inline){ if(!run){ run = document.createElement('div'); paper.insertBefore(run, n); changed = true; } run.appendChild(n); }
    else { run = null; if(n.nodeType === 3) n.remove(); }
  }
  if(!paper.firstElementChild){ paper.innerHTML = '<div><br></div>'; changed = true; }
  return changed;
}
let lastRange = null;
document.addEventListener('selectionchange', () => {
  const s = getSelection(); if(!s.rangeCount) return;
  const r = s.getRangeAt(0);
  if(paper.contains(r.commonAncestorContainer)) lastRange = r.cloneRange();
});
function caretRange(){
  const s = getSelection();
  if(s.rangeCount){ const r = s.getRangeAt(0); if(paper.contains(r.commonAncestorContainer)) return r.cloneRange(); }
  if(lastRange && paper.contains(lastRange.startContainer) && paper.contains(lastRange.endContainer)) return lastRange.cloneRange();
  const r = document.createRange(); r.selectNodeContents(paper.lastElementChild || paper); r.collapse(false); return r;
}
function liveSel(){
  const s = getSelection();
  if(s.rangeCount){ const r = s.getRangeAt(0); if(!r.collapsed && paper.contains(r.commonAncestorContainer) && r.toString().trim()) return r.cloneRange(); }
  return null;
}
function setCaret(r){
  const s = getSelection(); s.removeAllRanges(); s.addRange(r); lastRange = r.cloneRange();
  if(!narrow()) paper.focus({preventScroll: true});
}
function caretBlock(){
  const r = caretRange();
  let n = r.endContainer;
  if(n === paper) n = paper.childNodes[Math.max(0, Math.min(r.endOffset, paper.childNodes.length) - 1)];
  return blockOf(n);
}
const plain = () => paper.innerText.replace(/ /g, ' ');
const countChars = () => plain().replace(/\n/g, '').length;

/* ================= 번개: 커서 자리에서 주르륵 이어 쓰기 ================= */
let gen = null, lastSug = null;
const rejected = new Map();   // 같은 자리에서 작가가 지운 제안들 → 다음 요청에 '버린 방향'으로 보낸다
const addRej = (key, t) => { if(!t) return; const a = rejected.get(key) || []; if(!a.includes(t)) a.push(t); rejected.set(key, a.slice(-6)); };
function pickFrags(x){
  const fs = (x.frags || []).slice(-30); let total = 0; const out = [];
  for(let i = fs.length - 1; i >= 0; i--){ total += Math.min(300, fs[i].t.length); if(total > 4000) break; out.unshift(fs[i]); }
  return out.map((f, i) => ({num: i + 1, id: f.id, k: f.k || [], t: f.t}));
}
function fragLines(frags){
  const L = [];
  if(!frags.length) return L;
  L.push('', '[조각] 작가가 모아 둔 소재');
  for(const f of frags) L.push('{' + f.num + '} ' + (f.k && f.k.length ? '핵심어: ' + f.k.join(', ') : '핵심어 없음') + ' | ' + clip(f.t.replace(/\s+/g, ' '), 300));
  return L;
}
function contextAt(b, r){
  const rh = document.createRange(); rh.setStart(b, 0); rh.setEnd(r.endContainer, r.endOffset);
  const head = rh.toString().replace(/ /g, ' ');
  const rt = document.createRange(); rt.setStart(r.endContainer, r.endOffset); rt.setEnd(b, b.childNodes.length);
  const rest = norm(rt.toString().replace(/ /g, ' '));
  const bs = blocks(), i = bs.indexOf(b);
  const prev = []; let len = head.length, chap = '';
  for(let k = i - 1; k >= 0; k--){
    if(isEmpty(bs[k])) continue;
    const t = norm(textOf(bs[k]));
    if(len + t.length > 3000) break;
    prev.unshift(t); len += t.length + 1;
  }
  for(let k = i - 1; k >= 0; k--) if(!isEmpty(bs[k]) && isChap(bs[k])){ chap = norm(textOf(bs[k])); break; }
  const after = []; let al = rest.length; if(rest) after.push(rest);
  for(let k = i + 1; k < bs.length && al < 400 && after.length < 3; k++){ if(isEmpty(bs[k])) continue; const t = norm(textOf(bs[k])); after.push(t); al += t.length; }
  const h = head.replace(/^\s+/, '');
  const before = prev.join('\n') + (prev.length && h ? '\n' : '') + h;
  const last = head.replace(/\s+$/, '').slice(-1);
  return {
    head, before, after: clip(after.join('\n'), 500), chap: chap && !prev.includes(chap) ? chap : '',
    newPara: !head.trim(), mid: !!head.trim() && !TERM.includes(last) && !CLOSE.includes(last) && last !== '"' && last !== "'" && !ENDED.test(head.replace(/\s+$/, ''))
  };
}
function boltPrompt(c, frags, rej, len){
  const L = [];
  L.push('소설가가 초고를 쓰고 있다. [원고] 끝의 ▶ 자리에 바로 이어질 ' + (len === 'para' ? '한 문단(새 문장 3~5개)' : '새 문장 한두 개') + '를 써 줘.', '');
  L.push('- 반드시 ▶ 뒤에 올 새 문장을 쓴다. 마침표나 몇 글자만 붙이고 끝내지 않는다. [원고]에 이미 있는 문장을 다시 쓰지 않는다.');
  L.push('- 작가의 문체를 그대로 따른다: 어휘, 어미, 시제, 시점, 문장 길이와 호흡, 대사 따옴표 방식.');
  L.push('- 바로 다음 순간을 쓴다. 장면을 건너뛰거나 이야기를 서둘러 매듭짓거나 교훈으로 정리하지 않는다.');
  if(c.mid) L.push('- ▶ 앞 문장이 아직 끝나지 않았다. 그 문장을 자연스럽게 마저 잇고, 이어서 새 문장을 ' + (len === 'para' ? '3~5개' : '한두 개') + ' 더 쓴다.');
  else if(!c.newPara) L.push('- ▶ 앞 문장은 끝났다(마침표가 빠졌을 수 있다). 그 문장에는 손대지 말고 다음 문장부터 쓴다.');
  if(c.newPara) L.push('- ▶는 새 문단의 첫머리다.');
  if(c.after) L.push('- ▶ 뒤에 [뒤 문맥]이 이미 있다. 거기로 자연스럽게 닿게 쓰고, 뒤 문맥의 내용을 미리 써 버리지 않는다.');
  if(frags.length) L.push('- [조각]은 작가가 모아 둔 소재다. 이 자리에 꼭 맞을 때만 살짝 쓴다.');
  if(rej.length) L.push('- [버린 방향]은 작가가 이 자리에서 지운 제안이다. 그 내용, 사건, 방향과 겹치지 않는 다른 길로 쓴다.');
  L.push('- 답에는 이어질 본문만 쓴다. 설명, 제목, 머리말, 따옴표로 감싸기, ▶ 표시, 마크다운을 쓰지 않는다.');
  L.push(...fragLines(frags));
  L.push(...stormForBolt());
  if(rej.length){ L.push('', '[버린 방향]'); rej.forEach(t => L.push('- ' + clip(t, 300))); }
  if(c.chap) L.push('', '[지금 장] ' + c.chap);
  L.push('', '[원고]', c.before + '▶');
  if(c.after) L.push('', '[뒤 문맥]', c.after);
  return L.join('\n');
}
const cleanGen = t => String(t || '').replace(/```[a-zA-Z]*\n?/g, '').replace(/▶/g, '').replace(/\s*\n+\s*/g, ' ').replace(/^\s+/, '');
const keyOf = before => norm(before).slice(-150);
function keepVisible(el){
  const rc = el.getBoundingClientRect(), box = scroller.getBoundingClientRect();
  const over = rc.bottom - (box.bottom - 110);
  if(over > 0) scroller.scrollTop += over;
}
/* AI 오류 → 사람 말. 키가 없으면 설정 창을 연다 */
function aiFail(e, ms){
  if(e && e.code === 'cancelled') return;
  if(e && (e.code === 'no_key' || e.code === 'no_model')){ openAi(e.code === 'no_key' ? '번개를 치려면 먼저 Gemini API 키가 필요합니다. 무료로 받을 수 있습니다.' : ''); return; }
  toast(AI.errorText(e), ms || 8000);
}
let liveT = null, liveAt = 0;
function showLive(on, text){
  $('#live').hidden = !on; $('#boltBtn').classList.toggle('busy', !!on); clearInterval(liveT);
  if(!on) return;
  liveAt = Date.now(); const base = text || '쓰는 중…'; $('#liveText').textContent = base;
  liveT = setInterval(() => { const s = Math.round((Date.now() - liveAt) / 1000); $('#liveText').textContent = s >= 3 ? base + ' ' + s + '초' : base; }, 1000);
}
function stopGen(){ if(gen) gen.ctl.abort(); }
$('#stopBtn').onclick = stopGen;

async function bolt(){
  if(gen || !W.cur()) return;
  if(!AI.hasKey()){ openAi('번개를 치려면 먼저 Gemini API 키가 필요합니다. 무료로 받을 수 있습니다.'); return; }
  if(!$('#tidyDlg').hidden) return;
  if(lastSug && (!lastSug.span.isConnected || !norm(lastSug.span.textContent))){ addRej(lastSug.key, lastSug.text); lastSug = null; }
  hideSug(); W.closePops();
  await commitIme();
  normalizePaper();
  let r = caretRange();
  r.collapse(false);
  let b = blockOf(r.endContainer === paper ? paper.childNodes[Math.max(0, r.endOffset - 1)] : r.endContainer);
  if(!b){ b = paper.lastElementChild; r = document.createRange(); r.selectNodeContents(b); r.collapse(false); }
  if(r.endContainer === paper){ r = document.createRange(); r.selectNodeContents(b); r.collapse(false); }
  const c = contextAt(b, r);
  const key = keyOf(c.before);
  const prompt = boltPrompt(c, pickFrags(lt), rejected.get(key) || [], prefs.len);

  const span = document.createElement('span'); span.className = 'lt-new lt-live wait';
  const tail = document.createTextNode(' ');
  if(isEmpty(b)){ b.textContent = ''; b.append(span, tail); }
  else { r.insertNode(tail); r.insertNode(span); }
  keepVisible(span);
  const prevChar = c.head.slice(-1);
  let lead = null;
  const put = t => {
    const s = cleanGen(t); if(!s) return;
    if(lead === null) lead = prevChar && !/\s/.test(prevChar) && !/^[.,!?…·:;)\]}'"”’」』〉》~]/.test(s) ? ' ' : '';
    span.classList.remove('wait'); span.textContent = lead + s;
  };
  const ctl = new AbortController();
  gen = {ctl, span};
  showLive(true, '생각하는 중…');
  try{
    let started = false;
    const res = await AI.generate(prompt, {signal: ctl.signal, tier: prefs.tier === 'deep' ? 'mid' : 'fast', onText: ({text}) => { if(!started){ started = true; showLive(true, '쓰는 중…'); } put(text); keepVisible(span); }});
    put(res.text);
    if(res.truncated) toast('길이 제한에 걸려 중간에 멈췄습니다.');
  }catch(e){
    if(e && e.text && e.code !== 'refused') put(e.text);
    aiFail(e, 7000);
  }finally{
    gen = null; showLive(false);
    span.classList.remove('lt-live', 'wait');
    if(!norm(span.textContent)){
      const back = document.createRange(); back.setStartBefore(span); back.collapse(true);
      span.remove(); tail.remove(); setCaret(back);
    } else {
      lastSug = {span, tail, text: norm(span.textContent), key};
      const at = document.createRange(); at.setStart(tail, tail.length); at.collapse(true); setCaret(at);
      showSug(); W.onEdit();
    }
  }
}
function showSug(){ $('#sug').hidden = false; }
function hideSug(){ $('#sug').hidden = true; }
function dropSug(reject){
  if(!lastSug) return;
  const {span, tail, text, key} = lastSug;
  if(reject) addRej(key, text);
  if(span.isConnected){
    const r = document.createRange(); r.setStartBefore(span); r.collapse(true);
    span.remove(); if(tail.isConnected && /^ ?$/.test(tail.data)) tail.remove();
    setCaret(r);
  }
  lastSug = null; hideSug(); W.onEdit();
}
$('#sugAgain').onclick = () => { dropSug(true); bolt(); };
$('#sugDrop').onclick = () => dropSug(true);
$('#sugKeep').onclick = () => {
  if(lastSug && lastSug.span.isConnected){ const t = document.createTextNode(lastSug.span.textContent); lastSug.span.replaceWith(t); t.parentNode && t.parentNode.normalize(); }
  lastSug = null; hideSug(); W.onEdit();
};
document.addEventListener('pointerdown', e => { if(!$('#sug').hidden && !e.target.closest('#sug') && !e.target.closest('#boltBtn')) hideSug(); }, true);
/* 이어 쓴 문장 뒤의 줄바꿈 없는 칸(&nbsp;)은 작가가 이어 쓰기 시작하면 보통 띄어쓰기로 바꾼다 */
function fixGap(){
  const s = getSelection(); if(!s.rangeCount) return;
  const n = s.anchorNode;
  if(!n || n.nodeType !== 3 || !paper.contains(n) || s.anchorOffset < 2) return;
  if(n.data[0] !== ' ' || /\s/.test(n.data[1]) || !n.previousSibling || n.previousSibling.nodeName !== 'SPAN') return;
  n.replaceData(0, 1, ' ');
}

/* ================= 쓰기 ================= */
paper.addEventListener('beforeinput', e => { if(gen) e.preventDefault(); });
let composing = false;
paper.addEventListener('compositionstart', () => { composing = true; });
paper.addEventListener('compositionend', () => { composing = false; setTimeout(fixGap, 0); });
/* 한글 입력기가 마지막 글자를 아직 확정하지 않은 채로 번개가 글을 끼워 넣으면, 크롬이 끼워 넣은 글 전체를 '입력 중'으로 보고 실선 밑줄을 그린다.
   그래서 번개 전에 입력을 먼저 확정한다 (편집 칸에서 나갔다 들어오면 확정됨) */
async function commitIme(){
  if(!composing) return;
  const sel = getSelection(), rg = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  paper.blur(); await new Promise(r => setTimeout(r, 0));
  paper.focus({preventScroll: true}); composing = false;
  if(rg && paper.contains(rg.endContainer)){ sel.removeAllRanges(); sel.addRange(rg); }
}
paper.addEventListener('input', e => {
  hideSug();
  if(undoSt){ undoSt = null; if($('#noticeText').textContent === undoMsg) $('#notice').hidden = true; }
  if(!e.isComposing) fixGap();
  // 엔터 두 번: 키를 센 횟수가 아니라 '글 다음에 빈 줄이 생겼는지'로 본다 (한글 입력기 대비)
  if(!prefs.enter2 || e.isComposing || e.inputType !== 'insertParagraph') return;
  const b = caretBlock(); if(!b) return;
  const pr = b.previousElementSibling, pp = pr && pr.previousElementSibling;
  if(!pr || !pp || !isEmpty(b) || !isEmpty(pr) || isEmpty(pp)) return;
  pr.remove();
  bolt();
});
const SHEETS = ['tidyDlg', 'fragDlg', 'stormDlg', 'aiDlg'];
const sheetOpen = () => SHEETS.find(id => !$('#' + id).hidden) || null;
document.addEventListener('keydown', e => {
  if((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.isComposing){
    if(sheetOpen() || !$('#drvDlg').hidden) return;
    e.preventDefault(); e.stopPropagation(); bolt(); return;
  }
  if(e.key === 'Escape'){
    if(gen){ e.preventDefault(); e.stopPropagation(); stopGen(); return; }
    if(!$('#sug').hidden && lastSug){ e.preventDefault(); e.stopPropagation(); dropSug(true); return; }
    const id = sheetOpen();
    if(id){ e.preventDefault(); e.stopPropagation(); closeSheet(id); return; }
  }
  if(gen && paper.contains(document.activeElement) && !e.ctrlKey && !e.metaKey && e.key.length === 1) e.preventDefault();
}, true);
$('#boltBtn').addEventListener('pointerdown', e => e.preventDefault());
$('#boltBtn').onclick = () => { if(gen) stopGen(); else bolt(); };

/* ================= 시트 열고 닫기 ================= */
function openSheet(id){ W.closePops(); for(const x of SHEETS) if(x !== id) $('#' + x).hidden = true; hideSug(); $('#' + id).hidden = false; if(narrow()) app.classList.remove('drawer'); }
const app = $('#app');
function closeSheet(id){
  $('#' + id).hidden = true;
  if(id === 'tidyDlg' && tidy && tidy.ctl) tidy.ctl.abort();
  if(id === 'stormDlg' && lt.storm && lt.storm.ctDirty) runReflect();
  if(id === 'aiDlg') aiClosed();
}
for(const id of SHEETS) $('#' + id).addEventListener('click', e => { if(e.target.id === id) closeSheet(id); });
$('#tidyClose').onclick = () => closeSheet('tidyDlg');
$('#fragClose').onclick = () => closeSheet('fragDlg');
$('#stormClose').onclick = () => closeSheet('stormDlg');
$('#aiClose').onclick = () => closeSheet('aiDlg');

/* ================= build: 쓴 데까지 정리 ================= */
const MAX = 4000, CTX = 500;
function ctxText(bs, i, dir){
  const out = []; let len = 0;
  for(; i >= 0 && i < bs.length && out.length < 3; i += dir){
    if(isEmpty(bs[i])) continue;
    const t = norm(textOf(bs[i])); out.push(t); len += t.length;
    if(len >= CTX || (dir < 0 && isChap(bs[i]))) break;
  }
  if(dir < 0) out.reverse();
  const txt = out.join('\n'), cap = CTX * 1.5;
  return txt.length > cap ? (dir < 0 ? '…' + txt.slice(-cap) : txt.slice(0, cap) + '…') : txt;
}
function computeRange(endB, selR, x){
  const bs = blocks();
  let s = -1, e = -1, how = 'auto';
  if(selR){
    const a = blockOf(selR.startContainer === paper ? paper.childNodes[selR.startOffset] : selR.startContainer);
    const z = blockOf(selR.endContainer === paper ? paper.childNodes[Math.max(0, selR.endOffset - 1)] : selR.endContainer);
    s = bs.indexOf(a); e = bs.indexOf(z);
    if(s < 0 || e < s) selR = null; else how = 'sel';
  }
  if(!selR){
    e = endB ? bs.indexOf(endB) : -1;
    if(e < 0) e = bs.length - 1;
    while(e >= 0 && isEmpty(bs[e])) e--;
    if(e < 0) return {empty: 'none'};
    if(x.mark && norm(textOf(bs[e])) === x.mark) return {empty: 'done'};
    s = e;
    let chars = textOf(bs[e]).length;
    while(s > 0){
      const p = bs[s - 1];
      if(x.mark && norm(textOf(p)) === x.mark){ how = 'mark'; break; }
      if(isChap(p)){ how = 'chap'; break; }
      const l = textOf(p).length;
      if(chars + l > MAX){ how = 'cap'; break; }
      chars += l; s--;
    }
    if(s === 0 && how === 'auto') how = 'start';
  }
  const paras = []; let n = 0, chars = 0;
  for(let i = s; i <= e; i++){
    const b = bs[i]; if(isEmpty(b)) continue;
    const raw = textOf(b), lead = (raw.match(/^\s+/) || [''])[0], text = raw.trim();
    if(isSep(b)){ paras.push({i, text, lead, sep: true, sents: []}); continue; }
    const sents = splitSents(text).map(t => ({n: ++n, t}));
    chars += text.length;
    paras.push({i, text, lead, sents});
  }
  if(!n) return {empty: 'none'};
  return {how, paras, n, chars, before: ctxText(bs, s - 1, -1), after: ctxText(bs, e + 1, 1)};
}
function tidyPrompt(se, frags){
  const needKw = frags.some(f => !f.k || !f.k.length);
  const L = [];
  L.push('소설가가 생각과 문장을 뒤섞어 빠르게 쓴 초고를 정리해 줘. 가장 중요한 것은 작가의 문체를 지키는 것이다.', '');
  L.push('1. [원문]의 번호 붙은 문장을 하나씩 판단한다.');
  L.push('- 그대로 둘 문장 → [번호] =');
  L.push('- 고칠 문장 → [번호] 고친 문장. 오탈자, 맞춤법, 띄어쓰기, 어색한 연결만 고친다. 어휘, 어미, 시제, 시점, 문장 길이, 대사 따옴표 방식은 작가의 것을 따르고 내용은 바꾸지 않는다.');
  L.push('- 겹치거나 군더더기인 문장 → [번호] 삭제');
  L.push('- 소설 문장이 아니라 작가가 스스로에게 남긴 생각이나 메모 → [번호] 메모 | 핵심어, 핵심어');
  if(frags.length) L.push('- [조각]의 소재가 그 자리에 꼭 맞을 때만 새 문장을 넣는다 → [번호+] {조각번호} 새 문장. 그 번호 문장 바로 뒤에 들어간다. 전체에서 많아야 두 개.');
  if(needKw) L.push('2. [조각] 가운데 "핵심어 없음"인 것마다 핵심어를 2~4개 붙인다.');
  L.push('', '답은 아래 형식만 쓴다. 설명, 인사, 마크다운, 코드 블록은 쓰지 않는다. [정리]에는 원문의 모든 번호를 차례대로 적는다.');
  L.push('[정리]', '[1] =', '[2] 고친 문장', '…');
  if(needKw) L.push('[조각 핵심어]', '{조각번호} 핵심어, 핵심어');
  L.push(...fragLines(frags));
  if(se.before) L.push('', '[앞 문맥] 참고만 하고 고치지 않는다', se.before);
  L.push('', '[원문]');
  for(const p of se.paras){ if(p.sep) L.push('(장면 구분 ' + p.text + ')'); else L.push(p.sents.map(s => '[' + s.n + '] ' + s.t).join(' ')); }
  if(se.after) L.push('', '[뒤 문맥] 참고만 하고 고치지 않는다', se.after);
  return L.join('\n');
}
const HOW = {sel: '고른 부분', mark: '지난번 정리한 다음부터 여기까지', chap: '이 장 처음부터 여기까지', cap: '여기까지 4,000자 안쪽 (앞쪽은 길어서 뺐습니다)', start: '원고 처음부터 여기까지', auto: '여기까지'};
const KINDS = {edit: '손질', del: '삭제', memo: '조각으로', mat: '소재 넣기'};
const KIND_HELP = {edit: '맞춤법·띄어쓰기·어색한 연결 손질', del: '겹치거나 군더더기라 빼자는 문장', memo: '소설 문장이 아닌 메모라서 조각함으로 옮길 것', mat: '조각의 소재를 살려 새로 넣자는 문장'};
let tidy = null;
const tidyBusy = () => !!(tidy && tidy.ctl);
function renderRange(){
  const ps = tidy.paras.filter(p => !p.sep), head = ps[0].text, tail = ps[ps.length - 1].text;
  const quote = ps.length === 1 && head.length <= 40 ? '「' + head + '」' : '「' + clip(head, 18) + '」 … 「' + (tail.length > 18 ? '…' + tail.slice(-18) : tail) + '」';
  $('#tidyRange').innerHTML = '<span class="w">' + esc(HOW[tidy.how] || HOW.auto) + '</span><span class="q">' + esc(quote) + '</span><span class="n">' + tidy.chars.toLocaleString() + '자 · ' + tidy.n + '문장</span>';
}
async function startTidy(){
  if(!W.cur() || gen) return;
  if(!AI.hasKey()){ openAi('build를 쓰려면 먼저 Gemini API 키가 필요합니다. 무료로 받을 수 있습니다.'); return; }
  hideSug(); normalizePaper(); await W.flush();
  const selR = liveSel() || (lastRange && !lastRange.collapsed ? lastRange : null);
  const r = computeRange(caretBlock(), selR, lt);
  openSheet('tidyDlg');
  $('#tidyErr').textContent = ''; $('#tidyReview').hidden = true; $('#tidyFoot').hidden = true; $('#tidyWait').hidden = true;
  if(r.empty){
    tidy = null;
    $('#tidyRange').innerHTML = r.empty === 'done'
      ? '<span class="q">지난번 정리한 뒤로 새로 쓴 글이 없습니다.</span><span class="w">다른 부분을 정리하려면 글을 끌어서 고른 뒤 다시 누르세요.</span>'
      : '<span class="q">정리할 글이 없습니다.</span><span class="w">몇 줄 쓴 뒤 다시 눌러 주세요.</span>';
    return;
  }
  tidy = Object.assign({fragMap: pickFrags(lt), ms: W.cur().id}, r);
  renderRange();
  runTidy();
}
async function runTidy(){
  if(!tidy) return;
  const t = tidy;
  t.ctl = new AbortController();
  $('#tidyErr').textContent = ''; $('#tidyReview').hidden = true; $('#tidyFoot').hidden = true; $('#tidyWait').hidden = false;
  $('#tidyProg').textContent = '읽는 중…';
  try{
    const res = await AI.generate(tidyPrompt(t, t.fragMap), {signal: t.ctl.signal, tier: stTier(), temperature: 0.3, maxTokens: 16384, onText: ({text}) => {
      const done = (text.match(/^\s*\[\s*\d+\s*\]/gm) || []).length;
      $('#tidyProg').textContent = '정리하는 중… ' + Math.min(done, t.n) + ' / ' + t.n + '문장';
    }});
    if(tidy !== t) return;
    const p = parseResp(res.text, t.n);
    if(!p.hits){ $('#tidyErr').textContent = '답의 형식을 알아보지 못했습니다. 원고는 그대로입니다. 「다시 정리」를 눌러 주세요.'; $('#tidyFoot').hidden = false; return; }
    const all = {}; t.paras.forEach(pa => pa.sents.forEach(s => { all[s.n] = s.t; }));
    let missing = 0;
    for(let n = 1; n <= t.n; n++){ const op = p.ops[n]; if(!op) missing++; else if(op.k === 'edit' && norm(op.t) === norm(all[n])) p.ops[n] = {k: 'same'}; }
    p.missing = Object.keys(p.ops).length ? missing : 0;
    t.parsed = p; t.dec = {};
    items().forEach(it => { t.dec[it.id] = true; });
    renderReview();
    $('#tidyReview').hidden = false; $('#tidyFoot').hidden = false;
    $('#tidyBody').scrollTop = 0;
  }catch(e){
    if(tidy !== t) return;
    if(e && e.code === 'cancelled') $('#tidyErr').textContent = '정리를 멈췄습니다. 원고는 그대로입니다.';
    else if(e && (e.code === 'no_key' || e.code === 'no_model')){ $('#tidyErr').textContent = AI.errorText(e); }
    else $('#tidyErr').textContent = AI.errorText(e);
    $('#tidyFoot').hidden = false;
  }finally{ if(tidy === t){ t.ctl = null; $('#tidyWait').hidden = true; } }
}
$('#tidyStop').onclick = () => { if(tidy && tidy.ctl) tidy.ctl.abort(); };
$('#tidyAgain').onclick = runTidy;
$('#tidyBtn').onclick = startTidy;
function items(){
  const p = tidy.parsed, out = [];
  for(const para of tidy.paras) for(const s of para.sents){ const op = p.ops[s.n]; if(op && op.k !== 'same') out.push({id: 's' + s.n, kind: op.k}); }
  p.ins.forEach((x, i) => out.push({id: 'i' + i, kind: 'mat'}));
  return out;
}
function fragLabel(num){ const f = (tidy.fragMap || []).find(x => x.num === num); if(!f) return '소재'; return '조각 ' + num + (f.k && f.k.length ? ' · ' + f.k.slice(0, 2).join(', ') : ''); }
function xspan(id, k, on, inner){ return '<span class="x k-' + k + (on ? ' on' : '') + '" role="switch" tabindex="0" aria-checked="' + on + '" data-id="' + id + '" title="' + KIND_HELP[k] + ' · 누르면 ' + (on ? '거절' : '수락') + '">' + inner + '</span>'; }
function renderKinds(){
  const its = items(), cnt = {};
  its.forEach(it => { const c = cnt[it.kind] = cnt[it.kind] || {n: 0, on: 0}; c.n++; if(tidy.dec[it.id]) c.on++; });
  const kd = $('#kinds'); kd.innerHTML = '';
  if(!its.length) kd.innerHTML = '<p class="hint" style="margin:0">고칠 곳이 없다는 답입니다. 문장은 그대로 둡니다.</p>';
  for(const k of ['edit', 'del', 'memo', 'mat']){
    if(!cnt[k]) continue;
    const all = cnt[k].on === cnt[k].n, b = document.createElement('button');
    b.type = 'button'; b.className = 'chip k-' + k; b.setAttribute('aria-pressed', String(all));
    b.textContent = KINDS[k] + ' ' + cnt[k].on + '/' + cnt[k].n;
    b.title = KIND_HELP[k] + ' · 누르면 모두 ' + (all ? '거절' : '수락');
    b.onclick = () => { its.filter(x => x.kind === k).forEach(x => { tidy.dec[x.id] = !all; }); renderReview(); };
    kd.appendChild(b);
  }
  $('#missing').hidden = !tidy.parsed.missing;
  $('#missing').textContent = tidy.parsed.missing ? '답에 빠진 문장 ' + tidy.parsed.missing + '개는 그대로 둡니다.' : '';
}
function renderReview(){
  const p = tidy.parsed;
  renderKinds();
  let h = '';
  for(const para of tidy.paras){
    if(para.sep){ h += '<p class="sep">' + esc(para.text) + '</p>'; continue; }
    const parts = [];
    for(const s of para.sents){
      const op = p.ops[s.n] || {k: 'same'};
      if(op.k === 'same') parts.push(esc(s.t));
      else {
        const id = 's' + s.n;
        const inner = op.k === 'edit' ? diffHtml(s.t, op.t)
          : op.k === 'memo' ? esc(s.t) + '<span class="tag">조각으로' + (op.kw.length ? ' · ' + esc(op.kw.join(', ')) : '') + '</span>'
          : esc(s.t) + '<span class="tag">삭제</span>';
        parts.push(xspan(id, op.k, !!tidy.dec[id], inner));
      }
      p.ins.forEach((x, i) => { if(x.after === s.n) parts.push(xspan('i' + i, 'mat', !!tidy.dec['i' + i], esc(x.t) + '<span class="tag">' + esc(fragLabel(x.frag)) + '</span>')); });
    }
    h += '<p>' + parts.join(' ') + '</p>';
  }
  $('#tidyDoc').innerHTML = h;
}
function toggleX(el){
  const id = el.dataset.id, on = !tidy.dec[id];
  tidy.dec[id] = on;
  el.classList.toggle('on', on); el.setAttribute('aria-checked', String(on));
  const k = (el.className.match(/k-(\w+)/) || [])[1];
  el.title = KIND_HELP[k] + ' · 누르면 ' + (on ? '거절' : '수락');
  renderKinds();
}
$('#tidyDoc').addEventListener('click', e => { const x = e.target.closest('.x'); if(x) toggleX(x); });
$('#tidyDoc').addEventListener('keydown', e => { const x = e.target.closest('.x'); if(x && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); toggleX(x); } });
let undoSt = null, undoMsg = '';
$('#tidyApply').onclick = applyTidy;
function applyTidy(){
  if(!tidy || !tidy.parsed || !W.cur() || tidy.ms !== W.cur().id){ closeSheet('tidyDlg'); return; }
  const p = tidy.parsed, bs = blocks();
  const at = []; let from = 0;
  for(const para of tidy.paras){
    let f = -1;
    if(bs[para.i] && para.i >= from && norm(textOf(bs[para.i])) === norm(para.text)) f = para.i;
    else for(let j = from; j < bs.length; j++) if(norm(textOf(bs[j])) === norm(para.text)){ f = j; break; }
    at.push(f); if(f >= 0) from = f + 1;
  }
  const found = at.filter(x => x >= 0);
  if(!found.length){ $('#tidyErr').textContent = '정리할 문단을 원고에서 찾지 못했습니다. 그사이 글이 바뀌었다면 닫고 다시 눌러 주세요.'; return; }
  const htmlBefore = paper.innerHTML, ltBefore = JSON.parse(JSON.stringify(lt));
  const prevOut = bs[found[0]].previousElementSibling;
  const newFrags = [], used = new Map(), cnt = {edit: 0, del: 0, memo: 0, mat: 0};
  let skipped = 0;
  tidy.paras.forEach((para, k) => {
    if(para.sep) return;
    const outS = [], pf = [], pu = [], pc = {edit: 0, del: 0, memo: 0, mat: 0};
    let changed = false, memo = null;
    for(const s of para.sents){
      const op = p.ops[s.n] || {k: 'same'}, on = !!tidy.dec['s' + s.n];
      if(on && op.k === 'memo'){
        changed = true; pc.memo++;
        if(memo){ memo.t += ' ' + s.t; memo.k = [...new Set(memo.k.concat(op.kw))]; }
        else { memo = {id: newId(), t: s.t, k: op.kw.slice(), at: Date.now(), src: 'memo', used: 0}; pf.push(memo); }
      } else {
        memo = null;
        if(on && op.k === 'edit'){ outS.push(op.t); changed = true; pc.edit++; }
        else if(on && op.k === 'del'){ changed = true; pc.del++; }
        else outS.push(s.t);
      }
      p.ins.forEach((x, i) => {
        if(x.after !== s.n || !tidy.dec['i' + i]) return;
        outS.push(x.t); changed = true; pc.mat++; memo = null;
        const fm = (tidy.fragMap || []).find(f => f.num === x.frag); if(fm) pu.push(fm.id);
      });
    }
    if(!changed) return;
    const b = at[k] >= 0 ? bs[at[k]] : null;
    if(!b){ skipped++; return; }
    const text = outS.join(' ').trim();
    if(text) b.textContent = para.lead + text; else b.remove();
    newFrags.push(...pf); pu.forEach(id => used.set(id, (used.get(id) || 0) + 1));
    for(const key in pc) cnt[key] += pc[key];
  });
  let mark = null;
  for(let k = at.length - 1; k >= 0 && !mark; k--){ const b = at[k] >= 0 ? bs[at[k]] : null; if(b && b.isConnected && !isEmpty(b)) mark = norm(textOf(b)); }
  if(!mark){ let q = prevOut; while(q && isEmpty(q)) q = q.previousElementSibling; mark = q ? norm(textOf(q)) : null; }
  const kw = p.kw || {};
  for(const [id, n] of used){ const f = lt.frags.find(x => x.id === id); if(f) f.used = (f.used || 0) + n; }
  for(const num in kw){ const fm = (tidy.fragMap || []).find(f => f.num === +num); const f = fm && lt.frags.find(x => x.id === fm.id); if(f && !(f.k && f.k.length) && kw[num].length) f.k = kw[num]; }
  lt.frags = lt.frags.concat(newFrags); lt.mark = mark;
  normalizePaper();
  let last = null; for(let k = at.length - 1; k >= 0 && !last; k--){ const x = at[k] >= 0 ? bs[at[k]] : null; if(x && x.isConnected) last = x; }
  if(last){ const r = document.createRange(); r.selectNodeContents(last); r.collapse(false); setCaret(r); last.scrollIntoView({block: 'center'}); }
  const parts = [];
  for(const k of ['edit', 'del', 'memo', 'mat']) if(cnt[k]) parts.push(KINDS[k] + ' ' + cnt[k]);
  undoMsg = (parts.length ? '정리를 반영했습니다 · ' + parts.join(' · ') : '바꾼 곳 없이 정리를 마쳤습니다') + (skipped ? '. 그사이 바뀐 문단 ' + skipped + '개는 건너뛰었습니다' : '') + '.';
  tidy = null; closeSheet('tidyDlg');
  lastSug = null; W.onEdit(); W.outline(); saveLt(); renderFragCount();
  undoSt = {html: htmlBefore, lt: ltBefore};
  notice(undoMsg, '되돌리기', () => {
    if(!undoSt) return;
    paper.innerHTML = undoSt.html; lt = undoSt.lt; undoSt = null;
    $('#notice').hidden = true; W.onEdit(); W.outline(); saveLt(); renderFragCount(); toast('정리하기 전으로 되돌렸습니다', 3000);
  });
}

/* ================= bricks: 조각함 ================= */
function renderFragCount(){ const n = lt ? lt.frags.length : 0; $('#fragN').textContent = n ? String(n) : ''; }
const fmtDay = t => { const d = new Date(t); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일'; };
function renderFrags(){
  const ul = $('#frags'); ul.textContent = '';
  const fs = lt.frags;
  renderFragCount();
  if(!fs.length){ ul.innerHTML = '<li class="hint">아직 조각이 없습니다. 위에 생각을 적어 두거나, build할 때 원고 속 메모를 조각으로 옮길 수 있습니다.</li>'; return; }
  for(const f of fs.slice().reverse()){
    const li = document.createElement('li'); li.className = 'f';
    if(f.k && f.k.length){ const kk = document.createElement('div'); kk.className = 'fk'; f.k.forEach(w => { const s = document.createElement('span'); s.textContent = w; kk.appendChild(s); }); li.appendChild(kk); }
    const t = document.createElement('p'); t.className = 'ft'; t.textContent = f.t; li.appendChild(t);
    const m = document.createElement('div'); m.className = 'fm';
    const info = document.createElement('span');
    info.textContent = fmtDay(f.at) + ' · ' + (f.src === 'memo' ? '원고에서 옮김' : '직접 적음') + (f.used ? ' · 본문에 ' + f.used + '번 씀' : '');
    const del = document.createElement('button'); del.type = 'button'; del.className = 'ghost fdel'; del.textContent = '삭제';
    let armT;
    del.onclick = () => {
      if(!del.classList.contains('arm')){ del.classList.add('arm'); del.textContent = '정말 삭제'; armT = setTimeout(() => { del.classList.remove('arm'); del.textContent = '삭제'; }, 3000); return; }
      clearTimeout(armT); lt.frags = lt.frags.filter(x => x.id !== f.id); saveLt(); renderFrags();
    };
    m.append(info, del); li.appendChild(m); ul.appendChild(li);
  }
}
function saveNote(){
  const ta = $('#note'), t = ta.value.trim();
  ta.value = '';
  if(!t || !W.cur()) return;
  lt.frags.push({id: newId(), t, k: [], at: Date.now(), src: 'note', used: 0});
  saveLt(); renderFrags(); toast('조각으로 저장했습니다', 2500);
}
$('#fragBtn').onclick = () => { openSheet('fragDlg'); renderFrags(); if(!narrow()) $('#note').focus(); };
$('#noteSave').onclick = saveNote;
$('#note').addEventListener('input', e => { if(!e.isComposing && /\n[ \t]*\n$/.test($('#note').value)) saveNote(); });

/* ================= 스토밍: 브레인스토밍 → 8페이지즈 개요 → 인물표·연표 =================
   lt.storm = {brain, useMs, target, endroll, cur, out, hist, cast, time, sync, ctDirty, outAt, ctAt, view, at}
   out  = {read, logline, kw: [], people: [{name, role, note}], phases: {reason: {t, s, b: []}, …}, pin: {칸: true}}
   cast = [{id, name, role, age, desc, want, lack, arc, rel, mine}]   time = [{id, when, what, who, ph, mine}]
   개요는 결말을 못 박는 틀이 아니라 작가가 길을 찾을 때 보는 지도다. */
const PH = [
  {k: 'reason', n: '리즌', g: '기', w: 5, d: '독자가 작품 세계에 빠져들게 하는 첫머리'},
  {k: 'setup', n: '셋업', g: '기', w: 20, d: '주인공을 중심으로 주요 관계가 서고, 갈등과 엇갈림이 조금씩 드러난다'},
  {k: 'adhoc', n: '애드혹 패러다임', g: '승', w: 10, d: '인물들이 임시로 만든 틀. 관계가 뚜렷해지는 전반부의 클라이맥스'},
  {k: 'sag', n: '새그', g: '승', w: 15, d: '빠른 전개가 멎고 긴장이 풀리며 템포가 늦어진다. 일상이나 축제 같은 장면, 다음 파국의 전조'},
  {k: 'dead', n: '데드 센터', g: '전', w: 15, d: '주인공의 상황이 급전직하한다. 마이너스의 클라이맥스'},
  {k: 'dash', n: '대시업', g: '전', w: 10, d: '밑바닥에서 단숨에 상황을 호전시킨다'},
  {k: 'climax', n: '클라이맥스', g: '결', w: 15, d: '복잡해진 이야기가 단숨에 수렴한다. 가장 많은 지면과 촘촘한 묘사, 갑자기 느려지기도 한다'},
  {k: 'newb', n: '뉴 비기닝', g: '결', w: 5, d: '새로운 일상, 주요 인물의 성장'},
  {k: 'endroll', n: '엔드롤', g: '결', w: 5, d: '이야기가 끝난 뒤의 여운', opt: true}
];
const CURVE = [[0, 0], [5, .25], [9, .31], [13, .24], [17, .33], [21, .27], [25, .32], [35, .5], [38, .12], [42, .16], [46, .1], [50, .13], [58, -.32], [65, -.5], [75, .15], [85, .93], [88, 1], [90, .2], [95, .17], [100, .17]];
const CF = [['role', '자리'], ['age', '나이·신분'], ['desc', '외모·성격'], ['want', '바라는 것'], ['lack', '결핍·비밀'], ['arc', '변화 (처음 → 끝)'], ['rel', '관계']];
let stBusy = null, stRv = null, stCT = null, reflT = null;
const stOpen = new Set(), stAuto = new Set();
const stS = () => lt.storm || (lt.storm = {brain: '', useMs: true, target: 0, endroll: false, cur: null, out: null, hist: [], cast: null, time: null, sync: null, view: 'out', at: 0});
const stList = s => PH.filter(p => !p.opt || s.endroll);
const stTotal = s => stList(s).reduce((a, p) => a + p.w, 0);
const stAmt = (p, s) => s.target ? '약 ' + Math.max(1, Math.round(s.target * p.w / stTotal(s))) + '매' : Math.round(p.w / stTotal(s) * 100) + '%';
const phName = (k, s) => { if(k === 'pre') return '이야기 전'; const l = stList(s), i = l.findIndex(p => p.k === k); return i >= 0 ? (i + 1) + '. ' + l[i].n : ''; };
const toStr = v => typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
const toArr = v => Array.isArray(v) ? v : [];
const clone = x => JSON.parse(JSON.stringify(x));
function stNorm(j){
  j = j && typeof j === 'object' ? j : {};
  const o = {read: toStr(j.read), logline: toStr(j.logline), kw: toArr(j.kw).map(toStr).filter(Boolean).slice(0, 15),
    people: toArr(j.people).map(p => ({name: toStr(p && p.name), role: toStr(p && p.role), note: toStr(p && p.note)})).filter(p => p.name).slice(0, 12),
    phases: {}, pin: {}};
  const ph = j.phases && typeof j.phases === 'object' ? j.phases : {};
  for(const p of PH){ const x = ph[p.k]; if(x && typeof x === 'object') o.phases[p.k] = {t: toStr(x.t), s: toStr(x.s), b: toArr(x.b).map(toStr).filter(Boolean).slice(0, 8)}; }
  return o;
}
const derivePeople = cast => (cast || []).filter(c => c.name).map(c => ({name: c.name, role: c.role || '', note: [c.want, c.lack].filter(Boolean).join(' / ')}));
function stFill(s){
  if(!s || !s.out || !Array.isArray(s.cast)) return;
  if(!Array.isArray(s.time)) s.time = [];
  if(!s.sync) s.sync = {cast: clone(s.cast), time: clone(s.time)};
  s.out.phases = s.out.phases || {}; s.out.pin = s.out.pin || {};
  s.out.people = derivePeople(s.cast);
}
const keyGet = (o, k) => k.startsWith('ph:') ? (o.phases || {})[k.slice(3)] : o[k];
function keySet(o, k, v){ if(k.startsWith('ph:')){ o.phases = o.phases || {}; if(v === undefined) delete o.phases[k.slice(3)]; else o.phases[k.slice(3)] = v; } else o[k] = v; }
const peopleText = ps => (ps || []).map(p => [p.name, p.role, p.note].filter(Boolean).join(' | ')).join('\n');
function keyText(o, k){
  if(!o) return '';
  if(k === 'read' || k === 'logline') return o[k] || '';
  if(k === 'kw') return (o.kw || []).join(', ');
  if(k === 'people') return peopleText(o.people);
  const ph = (o.phases || {})[k.slice(3)];
  return ph ? [ph.t, ph.s].concat((ph.b || []).map(x => '· ' + x)).filter(Boolean).join('\n') : '';
}
function keyLabel(k, s){
  if(k === 'read') return '이야기의 뼈대'; if(k === 'logline') return '로그라인'; if(k === 'kw') return '핵심어'; if(k === 'people') return '인물';
  return phName(k.slice(3), s) || k;
}
const stKeys = s => ['read', 'logline', 'kw', 'people'].concat(stList(s).map(p => 'ph:' + p.k));
function pushHist(s, why){ if(!s.out) return; s.hist = [{at: Date.now(), why, out: clone(s.out)}].concat(s.hist || []).slice(0, 10); }
function msExcerpt(){
  const t = blocks().map(b => norm(textOf(b))).filter(Boolean).join('\n');
  return t.length <= 6000 ? t : t.slice(0, 2500) + '\n…(중략)…\n' + t.slice(-3000);
}
function outJson(s){
  const x = {read: s.out.read, logline: s.out.logline, kw: s.out.kw, people: s.out.people, phases: {}};
  stList(s).forEach(p => { if(s.out.phases[p.k]) x.phases[p.k] = s.out.phases[p.k]; });
  return JSON.stringify(x);
}
const pinNames = s => Object.keys((s.out && s.out.pin) || {}).filter(k => s.out.pin[k] && stKeys(s).includes(k)).map(k => k.startsWith('ph:') ? 'phases.' + k.slice(3) : k);
const ctJson = (cast, time, withIds) => JSON.stringify({
  cast: (cast || []).map(c => { const o = {}; if(withIds){ o.id = c.id; if(c.mine) o.mine = true; } ['name'].concat(CF.map(f => f[0])).forEach(f => { if(c[f]) o[f] = c[f]; }); return o; }),
  time: (time || []).map(t => { const o = {}; if(withIds){ o.id = t.id; if(t.mine) o.mine = true; } ['when', 'what', 'who', 'ph'].forEach(f => { if(t[f]) o[f] = t[f]; }); return o; })
});
function outFormat(s){ return JSON.stringify({read: '…', logline: '…', kw: ['…'], people: [{name: '…', role: '…', note: '…'}], phases: Object.fromEntries(stList(s).map(p => [p.k, {t: '…', s: '…', b: ['…']}]))}); }
function phaseLines(s){
  const L = ['', '[8페이지즈] 이야기의 굴곡을 단계로 나눈 틀이다. 결말을 못 박는 틀이 아니라 작가가 길을 찾을 때 보는 지도다.'];
  stList(s).forEach((p, i) => L.push((i + 1) + '. ' + p.n + ' (키 ' + p.k + ', 분량 ' + Math.round(p.w / stTotal(s) * 100) + '%): ' + p.d));
  L.push('높낮이: 클라이맥스의 정점은 애드혹 패러다임 정점의 두 배쯤이고, 데드 센터는 애드혹 정점만큼 깊이 떨어진다. 0 아래로 떨어지는 단계는 데드 센터뿐이다.');
  return L;
}
function materialLines(s){
  const L = ['', '[브레인스토밍]', s.brain.trim() || '(비어 있음)'];
  if(s.useMs){
    const fs = pickFrags(lt);
    if(fs.length){ L.push('', '[조각] 작가가 모아 둔 소재'); fs.forEach(f => L.push('- ' + (f.k.length ? '(' + f.k.join(', ') + ') ' : '') + clip(f.t.replace(/\s+/g, ' '), 300))); }
    const ex = msExcerpt(), title = $('#title').value.trim();
    if(ex) L.push('', '[지금까지 쓴 원고]' + (title ? ' 「' + title + '」' : ''), ex);
  }
  return L;
}
function stormPrompt(s, mode, ask){
  const L = [];
  L.push(mode === 'ask' ? '소설가가 세운 개요를 작가의 지시대로 고쳐 줘.' : '소설가의 브레인스토밍을 읽고 8페이지즈 구조로 소설 개요를 짜 줘.');
  L.push(...phaseLines(s));
  L.push('', '쓰는 법');
  L.push('- 작가가 적은 인물, 장면, 이미지, 문장, 질문을 최대한 살린다. 작가가 정하지 않은 것은 이야기에 필요한 만큼만 채우고, 작가가 쓴 것과 어긋나게 바꾸지 않는다.');
  L.push('- read: 이 이야기의 뼈대를 한두 문장으로. "무엇이 결핍된 인물이 어떤 장애물을 만나 무엇을 얻거나 잃는 이야기" 같은 꼴');
  L.push('- logline: 한 문장 로그라인');
  L.push('- kw: 브레인스토밍의 핵심어 5~10개');
  L.push('- people: 주요 인물 2~6명. name, role(이야기 속 자리), note(바라는 것, 결핍, 비밀 따위를 한두 구절로)');
  L.push('- phases: 단계마다 t(한 줄 요약), s(줄거리 2~4문장), b(그 단계에 꼭 들어갈 장면이나 요소 2~4개)');
  L.push('- 문장은 담백한 한국어로 쓴다. 교훈이나 평가를 덧붙이지 않는다.');
  if(s.target) L.push('- 목표 분량은 원고지 ' + s.target + '매다. 단계마다 분량에 맞는 만큼의 사건을 잡는다.');
  if(mode === 'again') L.push('- [지금 개요]에서 [고정] 칸은 작가가 정하거나 고친 것이다. 그대로 두고, 나머지 칸을 그것과 앞뒤가 맞게 새로 짠다. 고정 칸도 답에 그대로 적는다.');
  if(mode === 'ask') L.push('- [지금 개요]를 [작가의 지시]대로 고친다. 지시와 상관없는 칸은 글자 하나 바꾸지 말고 그대로 적는다. [고정] 칸은 지시가 그 칸을 콕 집어 말할 때만 바꾼다. 한 칸을 고쳐서 다른 칸과 어긋나면 그 칸도 맞춰 고친다.');
  if(s.cast && mode !== 'new') L.push('- [인물표]와 [연표]는 작가가 정리한 것이다. 개요가 이것과 어긋나지 않게 한다.');
  L.push('', '답은 JSON 하나만 쓴다. 형식:', outFormat(s));
  if(mode !== 'new' && s.out){
    L.push('', '[지금 개요]', outJson(s), '[고정] ' + (pinNames(s).join(', ') || '없음'));
    if(s.cast){ const ct = JSON.parse(ctJson(s.cast, s.time, false)); L.push('', '[인물표]', JSON.stringify(ct.cast), '', '[연표]', JSON.stringify(ct.time)); }
  }
  if(mode === 'ask') L.push('', '[작가의 지시]', ask);
  L.push(...materialLines(s));
  return L.join('\n');
}
function donePrompt(s){
  const L = ['소설 개요를 바탕으로 인물표와 연표를 정리해 줘.', ''];
  L.push('- cast(인물표): 개요와 브레인스토밍에 나오는 주요 인물과 꼭 필요한 주변 인물. 항목은 name, role(이야기 속 자리), age(나이·신분), desc(외모와 성격 한두 문장), want(바라는 것), lack(결핍이나 비밀), arc(이야기 처음과 끝의 변화를 "처음 → 끝" 꼴로), rel(다른 인물과의 관계).');
  L.push('- time(연표): 이야기 속 사건을 실제로 일어난 시간 순서대로 적는다(서술 순서가 아님). 이야기가 시작되기 전의 일도 필요한 만큼 넣는다. 항목은 when(때: 정해져 있으면 구체적으로, 아니면 "이야기 3년 전", "첫날 밤"처럼), what(일어난 일 한 문장), who(관련 인물 이름, 쉼표로), ph(이야기 전 일이면 "pre", 아니면 그 일이 나오는 단계 키).');
  L.push('- 개요, 브레인스토밍, 원고에 있는 것을 바탕으로 하고, 없는 사실은 이야기에 꼭 필요한 만큼만 채운다.');
  if(s.cast) L.push('- [지금 인물표]·[지금 연표]를 바탕으로 [개요]에 맞게 고친다. "mine": true 인 항목은 작가가 고친 것이니 그대로 적는다. 있던 항목은 id를 그대로 적고, 새 항목은 id를 비운다.');
  L.push('', '답은 JSON 하나만 쓴다. 형식:', JSON.stringify({cast: [{id: '', name: '…', role: '…', age: '…', desc: '…', want: '…', lack: '…', arc: '… → …', rel: '…'}], time: [{id: '', when: '…', what: '…', who: '…', ph: 'pre'}]}));
  L.push(...phaseLines(s));
  L.push('', '[개요]', outJson(s));
  if(s.cast){ const ct = JSON.parse(ctJson(s.cast, s.time, true)); L.push('', '[지금 인물표]', JSON.stringify(ct.cast), '', '[지금 연표]', JSON.stringify(ct.time)); }
  L.push(...materialLines(s));
  return L.join('\n');
}
function reflectPrompt(s, before, after){
  const L = ['작가가 소설의 인물표와 연표를 고쳤다. 고친 내용이 개요에 들어가도록 개요를 고쳐 줘.', ''];
  L.push('- [고치기 전]과 [고친 뒤]를 견주어 바뀐 것만 반영한다. 바뀐 것과 상관없는 칸은 글자 하나 바꾸지 말고 그대로 적는다.');
  L.push('- [고정] 칸은 작가가 정한 것이다. 이름이나 사실이 어긋나는 부분만 맞추고 나머지는 그대로 둔다.');
  L.push('- people은 [고친 뒤]의 인물표를 따른다.');
  L.push('', '답은 개요 JSON 하나만 쓴다. 형식:', outFormat(s));
  L.push(...phaseLines(s));
  L.push('', '[지금 개요]', outJson(s), '[고정] ' + (pinNames(s).join(', ') || '없음'));
  L.push('', '[고치기 전]', ctJson(before.cast, before.time, false));
  L.push('', '[고친 뒤]', ctJson(after.cast, after.time, false));
  return L.join('\n');
}
function setProg(t){ $('#stProg').textContent = t || ''; }
function setCT(text, acts){ stCT = {text, acts: acts || []}; const el = $('#stCT'); if(el) el.outerHTML = ctH(); }
function ctH(){
  if(!stCT || !stCT.text) return '<div id="stCT" hidden></div>';
  return '<div id="stCT"><span>' + esc(stCT.text) + '</span>' + stCT.acts.map(a => '<button type="button" data-act="' + a[0] + '">' + esc(a[1]) + '</button>').join('') + '</div>';
}
const stTier = () => prefs.tier === 'deep' ? 'deep' : prefs.tier === 'fast' ? 'fast' : 'mid';
async function sampleOutline(prompt, total, label, ctl){
  return AI.generateJson(prompt, {signal: ctl.signal, tier: stTier(), onText: ({text}) => {
    const n = (text.match(/"t"\s*:/g) || []).length;
    if(n) setProg(label + ' ' + Math.min(n, total) + ' / ' + total + '단계');
  }});
}
function stErr(e){ if(e && (e.code === 'no_key' || e.code === 'no_model')){ openAi('스토밍을 하려면 먼저 Gemini API 키가 필요합니다. 무료로 받을 수 있습니다.'); return AI.errorText(e); } return AI.errorText(e); }
async function runStorm(mode, ask){
  if(!W.cur() || stBusy) return;
  const s = stS();
  if(!s.out) mode = 'new';
  if(mode === 'new' && !s.brain.trim() && !(s.useMs && norm(plain()))){ setProg('브레인스토밍 칸에 떠오르는 것을 먼저 적어 주세요.'); $('#stBrain').focus(); return; }
  if(mode === 'ask' && !ask) return;
  if(!AI.hasKey()){ openAi('스토밍을 하려면 먼저 Gemini API 키가 필요합니다. 무료로 받을 수 있습니다.'); return; }
  stRv = null; renderStorm();
  const ctl = new AbortController(), ms = W.cur().id, total = stList(s).length;
  stBusy = {ctl, mode}; renderStormBusy();
  setProg(mode === 'ask' ? '지시를 읽는 중…' : '브레인스토밍을 읽는 중…');
  try{
    const j = await sampleOutline(stormPrompt(s, mode, ask), total, mode === 'ask' ? '고치는 중…' : '개요를 짜는 중…', ctl);
    if(!W.cur() || W.cur().id !== ms) return;
    const next = stNorm(j);
    if(Object.keys(next.phases).length < Math.min(6, total)) throw {code: 'invalid_json'};
    if(s.cast) next.people = derivePeople(s.cast);
    if(mode === 'ask'){
      const changed = stKeys(s).filter(k => keyText(s.out, k) !== keyText(next, k));
      if(!changed.length){ setProg('바꿀 칸이 없다는 답입니다. 지시를 조금 더 구체적으로 적어 보세요.'); return; }
      stRv = {ms, ask, next, changed, dec: Object.fromEntries(changed.map(k => [k, !(s.out.pin || {})[k]]))};
      const pinned = changed.filter(k => (s.out.pin || {})[k]).length;
      setProg('바뀐 칸 ' + changed.length + '개입니다.' + (pinned ? ' 고정한 칸 ' + pinned + '개는 「버리기」로 두었습니다.' : '') + ' 받을 것만 남기고 「고른 것 반영」을 누르세요.');
    } else if(mode === 'again'){
      pushHist(s, '다시 스토밍 전');
      const keep = s.out; next.pin = Object.assign({}, keep.pin);
      for(const k of stKeys(s)) if(next.pin[k] && keyGet(keep, k) !== undefined) keySet(next, k, clone(keyGet(keep, k)));
      s.out = next; s.outAt = s.at = Date.now(); stAuto.clear(); saveLt();
      setProg('고정한 칸은 그대로 두고 나머지를 새로 짰습니다. 앞 판은 「지난 판」에 있습니다.');
    } else {
      s.out = next; s.outAt = s.at = Date.now(); stAuto.clear(); saveLt();
      setProg('개요를 만들었습니다. 고칠 칸은 눌러서 바로 고치면 됩니다. 다 됐으면 맨 아래 「개요 완료」를 누르세요.');
      $('#stInBox').open = false;
    }
    s.view = 'out';
    renderStorm();
  }catch(e){
    if(e && e.code === 'cancelled') setProg('멈췄습니다. 개요는 그대로입니다.');
    else setProg(e && e.code === 'invalid_json' ? '답을 개요로 읽지 못했습니다. 다시 눌러 주세요.' : stErr(e));
  }finally{ stBusy = null; renderStormBusy(); }
}
function ctMerge(oldL, newL, fields){
  const kf = fields[0] === 'name' ? 'name' : 'what';
  const byId = new Map((oldL || []).map(x => [x.id, x])), byKey = new Map((oldL || []).map(x => [norm(x[kf]), x])), used = new Set(), out = [];
  for(const n of newL){
    let o = (n.id && byId.get(n.id)) || byKey.get(norm(n[kf]));
    if(o && used.has(o.id)) o = null;
    if(o && o.mine){ out.push(o); used.add(o.id); continue; }
    const x = {id: o ? o.id : newId() + out.length}; fields.forEach(f => { x[f] = n[f] || ''; });
    if(o) used.add(o.id);
    out.push(x);
  }
  (oldL || []).forEach((o, i) => { if(o.mine && !used.has(o.id)) out.splice(Math.min(i, out.length), 0, o); });
  return out;
}
async function runDone(){
  if(!W.cur() || stBusy) return;
  const s = stS(); if(!s.out) return;
  if(!AI.hasKey()){ openAi('먼저 Gemini API 키가 필요합니다.'); return; }
  if(s.ctDirty) await runReflect();
  if(stBusy) return;
  const ctl = new AbortController(), ms = W.cur().id, first = !s.cast;
  stBusy = {ctl, mode: 'done'}; renderStormBusy();
  setProg(first ? '개요를 읽고 인물과 연표를 정리하는 중…' : '바뀐 개요에 인물과 연표를 맞추는 중…');
  try{
    const j = await AI.generateJson(donePrompt(s), {signal: ctl.signal, tier: stTier(), onText: ({text}) => {
      const c = (text.match(/"name"\s*:/g) || []).length, t = (text.match(/"what"\s*:/g) || []).length;
      if(c || t) setProg('정리하는 중… 인물 ' + c + '명 · 연표 ' + t + '줄');
    }});
    if(!W.cur() || W.cur().id !== ms) return;
    const keys = new Set(['pre'].concat(stList(s).map(p => p.k)));
    const cast = toArr(j && j.cast).map(c => Object.assign({id: toStr(c && c.id), name: toStr(c && c.name)}, Object.fromEntries(CF.map(([f]) => [f, toStr(c && c[f])])))).filter(c => c.name);
    const time = toArr(j && j.time).map(t => ({id: toStr(t && t.id), when: toStr(t && t.when), what: toStr(t && t.what), who: toStr(t && t.who), ph: keys.has(toStr(t && t.ph)) ? toStr(t.ph) : ''})).filter(t => t.what);
    if(!cast.length && !time.length) throw {code: 'invalid_json'};
    s.cast = ctMerge(s.cast, cast, ['name'].concat(CF.map(f => f[0])));
    s.time = ctMerge(s.time, time, ['when', 'what', 'who', 'ph']);
    s.out.people = derivePeople(s.cast);
    s.sync = {cast: clone(s.cast), time: clone(s.time)}; s.ctDirty = false; s.ctAt = s.at = Date.now();
    s.view = 'cast'; stCT = null; saveLt(); renderStorm(); $('#stormBody').scrollTop = 0;
    setProg('인물 ' + s.cast.length + '명과 연표 ' + s.time.length + '줄을 정리했습니다. 인물이나 연표를 고치고 칸에서 나오면 개요에 저절로 반영됩니다.');
  }catch(e){
    if(e && e.code === 'cancelled') setProg('멈췄습니다.');
    else setProg(e && e.code === 'invalid_json' ? '답을 인물표·연표로 읽지 못했습니다. 다시 눌러 주세요.' : stErr(e));
  }finally{ stBusy = null; renderStormBusy(); }
}
function ctDirty(){ const s = stS(); s.ctDirty = true; s.at = Date.now(); markLt(); if(!stBusy || stBusy.mode !== 'reflect') setCT('인물·연표가 바뀌었습니다. 칸에서 나오면 개요에 반영합니다.'); }
function reflectSoon(ms){ clearTimeout(reflT); reflT = setTimeout(runReflect, ms == null ? 1500 : ms); }
async function runReflect(){
  clearTimeout(reflT);
  if(!W.cur()) return;
  const s = stS();
  if(!s.ctDirty || !s.out || !s.cast) return;
  if(stBusy){ reflectSoon(2500); return; }
  if(!AI.hasKey()){ setCT('Gemini API 키를 넣어야 개요에 반영됩니다.', [['reflect', '다시 반영']]); return; }
  const before = s.sync || {cast: [], time: []}, after = {cast: clone(s.cast), time: clone(s.time || [])};
  s.ctDirty = false;
  const ctl = new AbortController(), ms = W.cur().id;
  stBusy = {ctl, mode: 'reflect'}; renderStormBusy();
  setCT('인물·연표에서 고친 것을 개요에 반영하는 중…');
  try{
    const j = await sampleOutline(reflectPrompt(s, before, after), stList(s).length, '개요에 반영하는 중…', ctl);
    if(!W.cur() || W.cur().id !== ms) return;
    const next = stNorm(j);
    if(Object.keys(next.phases).length < Math.min(6, stList(s).length)) throw {code: 'invalid_json'};
    next.people = derivePeople(s.cast);
    const changed = stKeys(s).filter(k => k !== 'people' && keyText(s.out, k) !== keyText(next, k));
    s.sync = after;
    if(changed.length){
      pushHist(s, '인물·연표 반영 전');
      for(const k of changed) keySet(s.out, k, clone(keyGet(next, k)));
      changed.forEach(k => stAuto.add(k));
    }
    s.out.people = derivePeople(s.cast);
    s.outAt = Date.now(); s.ctAt = s.outAt + 1; s.at = s.ctAt; saveLt();
    setProg('');
    if(changed.length) setCT('개요 ' + changed.length + '칸에 반영했습니다: ' + changed.map(k => keyLabel(k, s)).join(', ') + '.', [['showAuto', '바뀐 칸 보기'], ['undoReflect', '되돌리기']]);
    else setCT('고친 내용은 개요와 어긋나지 않아서 개요는 그대로 두었습니다.');
    renderStorm();
  }catch(e){
    s.ctDirty = true;
    if(e && e.code === 'cancelled') setCT('반영을 멈췄습니다.', [['reflect', '다시 반영']]);
    else setCT('개요에 반영하지 못했습니다. ' + (e && e.code === 'invalid_json' ? '답을 읽지 못했습니다.' : AI.errorText(e)), [['reflect', '다시 반영']]);
  }finally{ stBusy = null; renderStormBusy(); }
}
function renderStormBusy(){
  const busy = !!stBusy;
  $('#stGo').disabled = busy; $('#stStop').hidden = !busy;
  ['#stAskBtn', '#stDone'].forEach(id => { const b = $(id); if(b) b.disabled = busy; });
}
const taH = (k, v, ph, label, cls, attr) => '<textarea class="st-ta' + (cls ? ' ' + cls : '') + '" rows="1" ' + (attr || 'data-key') + '="' + k + '" aria-label="' + esc(label) + '" placeholder="' + esc(ph || '') + '">' + esc(v || '') + '</textarea>';
const pinH = (k, s) => { const on = !!(s.out.pin || {})[k]; return '<button type="button" class="pin" data-pin="' + k + '" aria-pressed="' + on + '" title="고정한 칸은 다시 스토밍해도 바뀌지 않습니다">' + (on ? '고정됨' : '고정') + '</button>'; };
const newH = k => stAuto.has(k) ? '<span class="st-new">방금 반영</span>' : '';
function mapH(s){
  const list = stList(s), tot = stTotal(s), sx = 600 / tot, Y = y => (60 - y * 46).toFixed(1);
  let x0 = 0, seps = '', band = '';
  list.forEach(p => { if(p.k === s.cur) band = '<rect class="band" x="' + (x0 * sx).toFixed(1) + '" y="0" width="' + (p.w * sx).toFixed(1) + '" height="100"/>'; x0 += p.w; if(x0 < tot) seps += '<line x1="' + (x0 * sx).toFixed(1) + '" x2="' + (x0 * sx).toFixed(1) + '" y1="4" y2="96"/>'; });
  const pts = CURVE.filter(p => p[0] <= tot).map(([x, y]) => (x * sx).toFixed(1) + ',' + Y(y)).join(' ');
  const groups = [['기', 25], ['승', 25], ['전', 25], ['결', tot - 75]];
  return '<div class="st-map"><div class="st-groups">' + groups.map(([g, w]) => '<span style="flex:' + w + ' 1 0">' + g + '</span>').join('') + '</div>'
    + '<svg viewBox="0 0 600 100" preserveAspectRatio="none" aria-hidden="true">' + band + '<line class="zero" x1="0" x2="600" y1="60" y2="60"/>' + seps + '<polyline class="cv" points="' + pts + '"/></svg>'
    + '<div class="st-segs" role="group" aria-label="단계 펼치기">' + list.map((p, i) => '<button type="button" data-seg="' + p.k + '" style="flex:' + p.w + ' 1 0" class="' + (p.k === s.cur ? 'cur ' : '') + (s.out.phases[p.k] ? 'has' : '') + '" title="' + (i + 1) + '. ' + p.n + '" aria-label="' + (i + 1) + '. ' + p.n + ' 펼치기">' + (i + 1) + '</button>').join('') + '</div></div>';
}
function outViewH(s){
  const o = s.out, list = stList(s);
  let h = mapH(s);
  h += '<div class="st-card"><h3><span class="sp">이야기의 뼈대' + newH('read') + '</span>' + pinH('read', s) + '</h3>' + taH('read', o.read, '어떤 결핍을 가진 인물이 어떤 장애물을 만나…', '이야기의 뼈대') + '</div>';
  h += '<div class="st-card"><h3><span class="sp">로그라인' + newH('logline') + '</span>' + pinH('logline', s) + '</h3>' + taH('logline', o.logline, '한 문장 로그라인', '로그라인') + '</div>';
  if(s.cast) h += '<div class="st-card"><h3><span class="sp">인물</span><button type="button" data-view="cast">인물표 열기</button></h3><p class="st-people">' + esc((o.people || []).map(p => p.name + (p.role ? ' · ' + p.role : '')).join('   ')) + '</p></div>';
  else h += '<div class="st-card"><h3><span class="sp">인물 · 한 줄에 한 사람 (이름 | 자리 | 메모)</span>' + pinH('people', s) + '</h3>' + taH('people', peopleText(o.people), '이름 | 자리 | 바라는 것·결핍', '인물', 'ui') + '</div>';
  h += '<div class="st-card"><h3><span class="sp">핵심어 · 쉼표로 나눔' + newH('kw') + '</span>' + pinH('kw', s) + '</h3>' + taH('kw', (o.kw || []).join(', '), '핵심어', '핵심어', 'ui') + '</div>';
  let g = '';
  list.forEach((p, i) => {
    if(p.g !== g){ g = p.g; h += '<div class="st-grp">' + g + '</div>'; }
    const ph = o.phases[p.k] || {t: '', s: '', b: []}, cur = s.cur === p.k;
    h += '<details class="st-ph' + (cur ? ' cur' : '') + '" data-ph="' + p.k + '"' + (stOpen.has(p.k) ? ' open' : '') + '>'
      + '<summary><span class="st-n">' + (i + 1) + '</span><span class="st-nm">' + esc(p.n) + (cur ? '<span class="st-here">지금 여기</span>' : '') + newH('ph:' + p.k) + '</span><span class="st-w">' + stAmt(p, s) + '</span>' + pinH('ph:' + p.k, s) + '<span class="st-t">' + esc(ph.t) + '</span></summary>'
      + '<div class="st-body"><p class="st-def">' + esc(p.d) + '</p>'
      + '<div class="st-lb">한 줄</div>' + taH('ph:' + p.k + ':t', ph.t, '이 단계를 한 줄로', p.n + ' 한 줄')
      + '<div class="st-lb">줄거리</div>' + taH('ph:' + p.k + ':s', ph.s, '이 단계에서 일어나는 일', p.n + ' 줄거리')
      + '<div class="st-lb">꼭 들어갈 장면 · 한 줄에 하나</div>' + taH('ph:' + p.k + ':b', (ph.b || []).join('\n'), '장면이나 요소', p.n + ' 꼭 들어갈 장면', 'ui')
      + '<div class="st-acts"><button type="button" data-cur="' + p.k + '" aria-pressed="' + cur + '">' + (cur ? '지금 여기 풀기' : '지금 여기') + '</button></div></div></details>';
  });
  const stale = s.cast && (s.outAt || 0) > (s.ctAt || 0);
  h += '<div class="st-done"><button type="button" id="stDone" class="primary"' + (stBusy ? ' disabled' : '') + '>' + (s.cast ? '인물·연표 다시 맞추기' : '개요 완료 · 인물과 연표 정리') + '</button><span class="hint">'
    + (!s.cast ? '개요를 읽고 인물표와 연표를 만듭니다' : stale ? '개요가 바뀌었습니다. 누르면 인물·연표를 개요에 맞춥니다. 내가 고친 항목은 그대로 둡니다' : '개요와 인물·연표가 맞춰져 있습니다') + '</span></div>';
  h += '<div class="st-ask"><input id="stAsk" type="text" placeholder="말로 고치기: 예) 데드 센터에서 주인공이 무엇을 잃는지 더 분명하게" aria-label="말로 고치기" autocomplete="off"><button id="stAskBtn" type="button"' + (stBusy ? ' disabled' : '') + '>고치기</button></div>';
  const hist = s.hist || [];
  h += '<details class="st-hist"><summary>지난 판' + (hist.length ? ' ' + hist.length : '') + '</summary>' + (hist.length ? '<ul>' + hist.map((x, i) => '<li><span>' + esc(fmtWhen(x.at)) + ' · ' + esc(x.why || '') + '</span><button type="button" data-restore="' + i + '">이 판으로</button></li>').join('') + '</ul>' : '<p class="hint">스토밍하거나 고칠 때마다 앞 판을 열 개까지 남겨 둡니다.</p>') + '</details>';
  return h;
}
function castViewH(s){
  let h = '<p class="hint st-vhint">고치고 칸에서 나오면 개요에 저절로 반영됩니다. 내가 고친 인물은 「인물·연표 다시 맞추기」를 해도 그대로 둡니다.</p>';
  for(const c of s.cast){
    h += '<details class="st-ph st-c" data-cast="' + c.id + '"' + (stOpen.has('c:' + c.id) ? ' open' : '') + '><summary><span class="st-nm" data-cname="' + c.id + '">' + esc(c.name || '이름 없음') + '</span><span class="st-w" data-crole="' + c.id + '">' + esc(c.role) + '</span>' + (c.mine ? '<span class="st-mine">내가 고침</span>' : '<span></span>') + '<span class="st-t">' + esc(c.desc || c.want) + '</span></summary><div class="st-body">'
      + '<div class="st-lb">이름</div>' + taH(c.id + ':name', c.name, '이름', '이름', '', 'data-ck')
      + CF.map(([f, lb]) => '<div class="st-lb">' + lb + '</div>' + taH(c.id + ':' + f, c[f], lb, c.name + ' ' + lb, '', 'data-ck')).join('')
      + '<div class="st-acts"><button type="button" class="fdel" data-cdel="' + c.id + '">이 인물 지우기</button></div></div></details>';
  }
  h += '<div class="st-acts"><button type="button" id="stCastAdd">+ 인물 더하기</button></div>';
  return h;
}
function timeViewH(s){
  const opts = [['', '단계 없음'], ['pre', '이야기 전']].concat(stList(s).map((p, i) => [p.k, (i + 1) + '. ' + p.n]));
  let h = '<p class="hint st-vhint">이야기 속에서 실제로 일어난 차례입니다. 고치고 칸에서 나오면 개요에 저절로 반영됩니다.</p><div class="tl-list">';
  for(const t of s.time){
    h += '<div class="tl' + (t.ph === s.cur && t.ph ? ' cur' : '') + '" data-tl="' + t.id + '"><input class="tl-when" type="text" data-tk="' + t.id + ':when" value="' + esc(t.when) + '" placeholder="때" aria-label="때" autocomplete="off">'
      + taH(t.id + ':what', t.what, '일어난 일', '일어난 일', '', 'data-tk')
      + '<div class="tl-meta"><select data-tk="' + t.id + ':ph" aria-label="단계">' + opts.map(([v, l]) => '<option value="' + v + '"' + (t.ph === v ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>'
      + '<input type="text" data-tk="' + t.id + ':who" value="' + esc(t.who) + '" placeholder="누가" aria-label="누가" autocomplete="off">'
      + (t.mine ? '<span class="st-mine">내가 고침</span>' : '')
      + '<span class="tl-btns"><button type="button" class="ghost" data-tadd="' + t.id + '" title="아래에 한 줄 더하기" aria-label="아래에 한 줄 더하기">+ 줄</button><button type="button" class="ghost fdel" data-tdel="' + t.id + '" title="이 줄 지우기" aria-label="이 줄 지우기">지우기</button></span></div></div>';
  }
  h += '</div><div class="st-acts"><button type="button" id="stTimeAdd">+ 맨 끝에 한 줄</button></div>';
  return h;
}
function renderStorm(){
  if(!W.cur()) return;
  const s = stS();
  if(document.activeElement !== $('#stBrain')) $('#stBrain').value = s.brain || '';
  $('#stUseMs').checked = s.useMs !== false;
  if(document.activeElement !== $('#stTarget')) $('#stTarget').value = s.target || '';
  $('#stEnd').checked = !!s.endroll;
  $('#stGo').textContent = s.out ? '다시 storming' : 'storming';
  $('#stGoNote').textContent = s.out ? '고정한 칸은 그대로 두고 나머지를 새로 짭니다' : '브레인스토밍을 읽고 8페이지즈 개요를 짭니다';
  renderRv(s);
  const out = $('#stOut');
  out.hidden = !s.out;
  if(!s.out){ out.innerHTML = ''; $('#stInBox').hidden = false; $('.st-go').hidden = false; renderStormBtn(); renderBand(); return; }
  if(!s.cast) s.view = 'out';
  const view = s.view || 'out';
  $('#stInBox').hidden = view !== 'out'; $('.st-go').hidden = view !== 'out';
  let h = '';
  if(s.cast) h += '<div class="seg st-tabs" role="tablist" aria-label="스토밍 보기">' + [['out', '개요'], ['cast', '인물 ' + s.cast.length], ['time', '연표 ' + (s.time || []).length]].map(([v, l]) => '<button type="button" role="tab" class="seg-b' + (v === view ? ' on' : '') + '" aria-selected="' + (v === view) + '" data-view="' + v + '">' + l + '</button>').join('') + '</div>';
  h += ctH();
  h += view === 'cast' ? castViewH(s) : view === 'time' ? timeViewH(s) : outViewH(s);
  const askVal = $('#stAsk') ? $('#stAsk').value : '';
  out.innerHTML = h;
  if(askVal && $('#stAsk')) $('#stAsk').value = askVal;
  out.querySelectorAll('details[open] .st-ta, .st-card .st-ta, .tl .st-ta').forEach(grow);
  renderStormBtn(); renderBand();
}
function grow(t){ t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
function renderRv(s){
  const box = $('#stRv');
  if(!stRv || !W.cur() || stRv.ms !== W.cur().id || !s.out){ box.hidden = true; box.innerHTML = ''; return; }
  let h = '<p class="hint" style="margin:0 0 8px">「' + esc(stRv.ask) + '」대로 바뀐 칸입니다. 칸을 누르면 받기와 버리기가 바뀝니다.</p>';
  for(const k of stRv.changed){
    const on = !!stRv.dec[k];
    h += '<div class="st-rv' + (on ? '' : ' off') + '" data-rv="' + k + '" role="switch" tabindex="0" aria-checked="' + on + '"><h3><span class="sp">' + esc(keyLabel(k, s)) + ((s.out.pin || {})[k] ? ' · 고정한 칸' : '') + '</span><span class="tag">' + (on ? '받기' : '버리기') + '</span></h3><div class="doc">' + diffHtml(keyText(s.out, k), keyText(stRv.next, k)) + '</div></div>';
  }
  h += '<div class="st-acts"><button type="button" id="stRvNo">그만두기</button><button type="button" class="primary" id="stRvOk">고른 것 반영</button></div>';
  box.innerHTML = h; box.hidden = false;
}
function applyRv(){
  const s = stS();
  if(!stRv || !s.out) return;
  const acc = stRv.changed.filter(k => stRv.dec[k]);
  if(acc.length){
    pushHist(s, '말로 고치기 전: ' + clip(stRv.ask, 24));
    for(const k of acc) keySet(s.out, k, clone(keyGet(stRv.next, k)));
    if(s.cast) s.out.people = derivePeople(s.cast);
    s.outAt = s.at = Date.now(); saveLt();
  }
  stRv = null;
  renderStorm();
  if($('#stAsk')) $('#stAsk').value = '';
  setProg(acc.length ? acc.length + '칸을 고쳤습니다. 앞 판은 「지난 판」에 있습니다.' : '고치지 않았습니다.');
}
$('#stRv').addEventListener('click', e => {
  if(e.target.id === 'stRvOk'){ applyRv(); return; }
  if(e.target.id === 'stRvNo'){ stRv = null; renderStorm(); setProg('고치지 않았습니다.'); return; }
  const c = e.target.closest('.st-rv'); if(!c || !stRv) return;
  const k = c.dataset.rv; stRv.dec[k] = !stRv.dec[k]; renderRv(stS());
});
$('#stRv').addEventListener('keydown', e => { const c = e.target.closest('.st-rv'); if(c && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); c.click(); } });
function setPin(s, k, on){
  s.out.pin = s.out.pin || {};
  if(!!s.out.pin[k] === on) return;
  if(on) s.out.pin[k] = true; else delete s.out.pin[k];
  $('#stOut').querySelectorAll('[data-pin="' + k + '"]').forEach(b => { b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '고정됨' : '고정'; });
}
$('#stOut').addEventListener('input', e => {
  const s = stS(); if(!s.out) return;
  const t = e.target, v = t.value;
  if(t.dataset.key){
    const key = t.dataset.key;
    let top = key;
    if(key === 'kw') s.out.kw = v.split(/[,，、\n]/).map(x => x.trim()).filter(Boolean).slice(0, 15);
    else if(key === 'people') s.out.people = v.split('\n').map(l => { const [name, role, note] = l.split(/[|｜]/).map(x => (x || '').trim()); return {name: name || '', role: role || '', note: note || ''}; }).filter(p => p.name);
    else if(key.startsWith('ph:')){
      const [, k, f] = key.split(':'); top = 'ph:' + k;
      const ph = s.out.phases[k] || (s.out.phases[k] = {t: '', s: '', b: []});
      if(f === 'b') ph.b = v.split('\n').map(x => x.replace(/^\s*[·•\-*]\s*/, '').trim()).filter(Boolean);
      else ph[f] = v.trim();
      if(f === 't'){ const sum = t.closest('details').querySelector('.st-t'); if(sum) sum.textContent = ph.t; }
    } else s.out[key] = v.trim();
    setPin(s, top, true);
    if(stAuto.delete(top)){ const n = t.closest('.st-card, details') && t.closest('.st-card, details').querySelector('.st-new'); if(n) n.remove(); }
    s.outAt = s.at = Date.now(); if(t.tagName === 'TEXTAREA') grow(t); markLt();
    return;
  }
  if(t.dataset.ck && s.cast){
    const [id, f] = t.dataset.ck.split(':'), c = s.cast.find(x => x.id === id); if(!c) return;
    c[f] = v.trim(); c.mine = true;
    if(f === 'name'){ const n = $('#stOut').querySelector('[data-cname="' + id + '"]'); if(n) n.textContent = c.name || '이름 없음'; }
    if(f === 'role'){ const n = $('#stOut').querySelector('[data-crole="' + id + '"]'); if(n) n.textContent = c.role; }
    s.out.people = derivePeople(s.cast);
    grow(t); ctDirty(); return;
  }
  if(t.dataset.tk && s.time){
    const [id, f] = t.dataset.tk.split(':'), x = s.time.find(y => y.id === id); if(!x) return;
    x[f] = f === 'ph' ? v : v.trim(); x.mine = true;
    if(t.tagName === 'TEXTAREA') grow(t);
    ctDirty();
    if(f === 'ph') reflectSoon();
  }
});
$('#stOut').addEventListener('focusin', e => { if(e.target.closest('[data-ck],[data-tk]')) clearTimeout(reflT); });
$('#stOut').addEventListener('focusout', e => { if(e.target.closest('[data-ck],[data-tk]') && W.cur() && stS().ctDirty) reflectSoon(); });
$('#stOut').addEventListener('click', e => {
  const s = stS(); if(!s.out) return;
  const t = e.target;
  const pin = t.closest('[data-pin]');
  if(pin){ e.preventDefault(); e.stopPropagation(); setPin(s, pin.dataset.pin, pin.getAttribute('aria-pressed') !== 'true'); s.at = Date.now(); markLt(); return; }
  const vw = t.closest('[data-view]');
  if(vw){ s.view = vw.dataset.view; renderStorm(); $('#stormBody').scrollTop = 0; return; }
  const act = t.closest('[data-act]');
  if(act){
    const a = act.dataset.act;
    if(a === 'reflect'){ s.ctDirty = true; runReflect(); }
    else if(a === 'showAuto'){ s.view = 'out'; stAuto.forEach(k => { if(k.startsWith('ph:')) stOpen.add(k.slice(3)); }); renderStorm(); const f = $('#stOut').querySelector('.st-new'); if(f) f.scrollIntoView({block: 'center'}); }
    else if(a === 'undoReflect'){
      const i = (s.hist || []).findIndex(x => x.why === '인물·연표 반영 전');
      if(i === 0){ s.out = clone(s.hist[0].out); s.out.people = derivePeople(s.cast); s.hist.shift(); stAuto.clear(); s.outAt = s.at = Date.now(); saveLt(); stCT = null; renderStorm(); setProg('개요를 반영 전으로 되돌렸습니다. 인물·연표는 고친 그대로입니다.'); }
    }
    return;
  }
  const cur = t.closest('[data-cur]');
  if(cur){ s.cur = s.cur === cur.dataset.cur ? null : cur.dataset.cur; s.at = Date.now(); saveLt(); renderStorm(); return; }
  const seg = t.closest('[data-seg]');
  if(seg){ const k = seg.dataset.seg, d = $('#stOut').querySelector('details[data-ph="' + k + '"]'); if(d){ d.open = true; d.scrollIntoView({block: 'start', behavior: 'smooth'}); } return; }
  const rs = t.closest('[data-restore]');
  if(rs){
    const i = +rs.dataset.restore, item = (s.hist || [])[i]; if(!item) return;
    s.hist.splice(i, 1); pushHist(s, '되돌리기 전'); s.out = clone(item.out); if(s.cast) s.out.people = derivePeople(s.cast);
    stAuto.clear(); s.outAt = s.at = Date.now(); saveLt(); renderStorm();
    setProg(fmtWhen(item.at) + ' 판으로 되돌렸습니다.'); $('#stormBody').scrollTop = 0; return;
  }
  if(t.id === 'stAskBtn'){ const a = $('#stAsk').value.trim(); if(a) runStorm('ask', a); else $('#stAsk').focus(); return; }
  if(t.id === 'stDone'){ runDone(); return; }
  if(t.id === 'stCastAdd'){ const c = {id: newId(), name: '', mine: true}; CF.forEach(([f]) => { c[f] = ''; }); s.cast.push(c); stOpen.add('c:' + c.id); renderStorm(); const ta = $('#stOut').querySelector('[data-ck="' + c.id + ':name"]'); if(ta) ta.focus(); return; }
  const cdel = t.closest('[data-cdel]');
  if(cdel){
    if(!cdel.classList.contains('arm')){ cdel.classList.add('arm'); cdel.textContent = '정말 지우기'; setTimeout(() => { cdel.classList.remove('arm'); cdel.textContent = '이 인물 지우기'; }, 3000); return; }
    s.cast = s.cast.filter(c => c.id !== cdel.dataset.cdel); s.out.people = derivePeople(s.cast); ctDirty(); renderStorm(); reflectSoon(); return;
  }
  const tadd = t.closest('[data-tadd]');
  if(tadd || t.id === 'stTimeAdd'){
    const x = {id: newId(), when: '', what: '', who: '', ph: s.cur || '', mine: true};
    const i = tadd ? s.time.findIndex(y => y.id === tadd.dataset.tadd) : -1;
    if(i >= 0) s.time.splice(i + 1, 0, x); else s.time.push(x);
    renderStorm(); const w = $('#stOut').querySelector('[data-tk="' + x.id + ':when"]'); if(w) w.focus(); return;
  }
  const tdel = t.closest('[data-tdel]');
  if(tdel){ s.time = s.time.filter(y => y.id !== tdel.dataset.tdel); ctDirty(); renderStorm(); reflectSoon(); return; }
});
$('#stOut').addEventListener('keydown', e => { if(e.target.id === 'stAsk' && e.key === 'Enter' && !e.isComposing){ e.preventDefault(); const a = e.target.value.trim(); if(a) runStorm('ask', a); } });
$('#stOut').addEventListener('toggle', e => {
  const d = e.target; if(!d.matches || !d.matches('details.st-ph')) return;
  const k = d.dataset.ph || (d.dataset.cast && 'c:' + d.dataset.cast);
  if(d.open){ stOpen.add(k); d.querySelectorAll('.st-ta').forEach(grow); } else stOpen.delete(k);
}, true);
$('#stBrain').addEventListener('input', () => { stS().brain = $('#stBrain').value; markLt(); });
$('#stBrain').addEventListener('keydown', e => { if((e.ctrlKey || e.metaKey) && e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); runStorm(stS().out ? 'again' : 'new'); } });
$('#stUseMs').onchange = () => { stS().useMs = $('#stUseMs').checked; markLt(); };
$('#stTarget').addEventListener('input', () => { stS().target = Math.max(0, Math.min(5000, parseInt($('#stTarget').value, 10) || 0)); markLt(); renderStorm(); });
$('#stEnd').onchange = () => { stS().endroll = $('#stEnd').checked; markLt(); renderStorm(); };
$('#stGo').onclick = () => runStorm(stS().out ? 'again' : 'new');
$('#stStop').onclick = () => { if(stBusy) stBusy.ctl.abort(); };
function openStorm(k){
  if(!W.cur()) return;
  openSheet('stormDlg');
  if(k) stS().view = 'out';
  renderStorm();
  if(k){ const d = $('#stOut').querySelector('details[data-ph="' + k + '"]'); if(d){ d.open = true; setTimeout(() => d.scrollIntoView({block: 'start'}), 0); } }
  else if(!stS().out && !narrow()) $('#stBrain').focus();
}
$('#stormBtn').onclick = () => openStorm();
function renderStormBtn(){ $('#stormBtn').classList.toggle('has', !!(lt.storm && lt.storm.out)); }

/* ================= 위치 띠 ================= */
let bandT = null, bandChars = null;
function bandSoon(){ clearTimeout(bandT); bandT = setTimeout(renderBand, 250); }
function charsToCaret(){
  const sl = getSelection(); if(!sl.rangeCount) return null;
  const r = sl.getRangeAt(0); if(!paper.contains(r.endContainer)) return null;
  const rr = document.createRange(); rr.setStart(paper, 0); rr.setEnd(r.endContainer, r.endOffset);
  return rr.toString().replace(/\n/g, '').length;
}
function renderBand(){
  const b = $('#band'), s = lt && lt.storm;
  if(!s || !s.out){ b.hidden = true; b.innerHTML = ''; return; }
  const l = stList(s), tot = stTotal(s);
  const c = charsToCaret(); if(c != null) bandChars = c;
  const chars = bandChars != null ? Math.min(bandChars, countChars()) : countChars();
  const mae = chars / 200, target = s.target || 0, pct = target ? Math.min(100, mae / target * 100) : null;
  let amtK = null;
  if(pct != null){ let acc = 0; for(const p of l){ acc += p.w / tot * 100; if(pct <= acc + 1e-9){ amtK = p.k; break; } } if(!amtK) amtK = l[l.length - 1].k; }
  const ci = l.findIndex(p => p.k === s.cur), ai = l.findIndex(p => p.k === amtK);
  let h = '<div class="band-segs" role="group" aria-label="스토밍 단계">' + l.map((p, i) => '<button type="button" data-band="' + p.k + '" style="flex:' + p.w + ' 1 0" class="' + (p.k === s.cur ? 'cur' : '') + '" data-tip="' + (i + 1) + '. ' + esc(p.n) + (p.k === s.cur ? ' · 지금 여기' : '') + '" data-tip-d="' + esc((s.out.phases[p.k] || {}).t || p.d) + '" aria-label="' + (i + 1) + '. ' + esc(p.n) + ' 펼치기">' + (i + 1) + '</button>').join('');
  if(pct != null) h += '<i class="band-at" style="left:' + pct.toFixed(2) + '%" aria-hidden="true"></i>';
  h += '</div><span class="band-tx"><b>' + (ci >= 0 ? '지금 ' + (ci + 1) + '. ' + esc(l[ci].n) : '지금 여기 없음') + '</b> · ' + (target ? mae.toFixed(1) + ' / ' + target + '매' : '원고지 ' + mae.toFixed(1) + '매')
    + (ci >= 0 && ai >= 0 && ai !== ci ? '<span class="band-gap"> · 분량으로는 ' + (ai + 1) + '. ' + esc(l[ai].n) + ' 자리</span>' : '') + '</span>';
  b.innerHTML = h; b.hidden = false;
}
$('#band').addEventListener('click', e => { const k = e.target.closest('[data-band]'); if(k) openStorm(k.dataset.band); });
document.addEventListener('selectionchange', () => { if(lt.storm && lt.storm.out && document.activeElement === paper) bandSoon(); });
document.addEventListener('wongo:stats', () => { if(lt.storm && lt.storm.out) bandSoon(); });
/* 번개에 실을 개요: '지금 여기'가 있으면 그 단계와 그 단계의 연표를 자세히, 없으면 단계마다 한 줄씩 */
function stormForBolt(){
  const s = lt.storm;
  if(!s || !s.out) return [];
  const o = s.out, list = stList(s), L = ['', '[개요] 작가가 세운 지도다. 지금 대목이 어디로 가는지 참고만 하고, 뒤 단계의 사건을 앞당겨 쓰지 않는다.'];
  if(o.logline) L.push('로그라인: ' + o.logline);
  if(s.cast && s.cast.length) L.push('인물: ' + s.cast.map(c => c.name + (c.role ? '(' + c.role + ')' : '') + [c.age, c.desc, c.want && '바람: ' + c.want, c.lack && '결핍: ' + c.lack].filter(Boolean).map(x => ' ' + clip(x, 80)).join('')).join(' / '));
  else if(o.people && o.people.length) L.push('인물: ' + o.people.map(p => p.name + (p.role ? '(' + p.role + ')' : '') + (p.note ? ' ' + p.note : '')).join(' / '));
  const i = list.findIndex(p => p.k === s.cur);
  if(i >= 0){
    const p = list[i], ph = o.phases[p.k] || {};
    L.push('지금 단계: ' + (i + 1) + '. ' + p.n + ' — ' + p.d);
    if(ph.s || ph.t) L.push('이 단계의 줄거리: ' + (ph.s || ph.t));
    if(ph.b && ph.b.length) L.push('이 단계에 들어갈 것: ' + ph.b.join(' / '));
    const tl = (s.time || []).filter(t => t.ph === p.k).slice(0, 8);
    if(tl.length) L.push('이 단계의 연표: ' + tl.map(t => (t.when ? t.when + ' ' : '') + t.what).join(' / '));
    const nx = list[i + 1]; if(nx && o.phases[nx.k] && o.phases[nx.k].t) L.push('다음 단계(' + nx.n + '): ' + o.phases[nx.k].t);
  } else list.forEach((p, k) => { const ph = o.phases[p.k]; if(ph && ph.t) L.push((k + 1) + '. ' + p.n + ': ' + ph.t); });
  return L.map(x => clip(x, 900));
}

/* ================= 라이트닝 설정: Gemini API 키 · 모델 · 번개 속도 ================= */
let aiMsgT = null;
function aiMsg(text, err){ const m = $('#aiMsg'); m.textContent = text || ''; m.classList.toggle('err', !!err); }
function renderModels(list, picked){
  const sel = $('#aiModel'); sel.innerHTML = '';
  if(!list.length){ sel.innerHTML = '<option value="">(키를 넣고 「확인」을 누르면 목록이 옵니다)</option>'; sel.disabled = true; return; }
  sel.disabled = false;
  const cur = picked || AI.model();
  const sorted = list.slice().sort((a, b) => { const ia = AI.info(a.id), ib = AI.info(b.id); const ra = (ia.kind === 'flash-lite' ? 3 : ia.kind === 'flash' ? 2 : ia.kind === 'pro' ? 1 : 0), rb = (ib.kind === 'flash-lite' ? 3 : ib.kind === 'flash' ? 2 : ib.kind === 'pro' ? 1 : 0); return rb - ra || ib.ver - ia.ver || a.id.localeCompare(b.id); });
  for(const m of sorted){
    const o = document.createElement('option'); o.value = m.id;
    const i = AI.info(m.id);
    o.textContent = m.id + (i.kind === 'flash-lite' ? ' · 하루 한도 넉넉' : i.kind === 'pro' ? ' · 무료 등급에서 안 될 수 있음' : '');
    if(m.id === cur) o.selected = true;
    sel.appendChild(o);
  }
  if(!sel.value && sorted.length){ sel.value = sorted[0].id; }
}
function renderAi(){
  const has = AI.hasKey();
  $('#aiKey').value = AI.key();
  $('#aiState').textContent = has ? (AI.model() ? '쓰는 모델: ' + AI.model() : '키는 있는데 모델이 없습니다. 「확인」을 눌러 목록을 받아 주세요.') : '아직 키가 없습니다.';
  $('#aiForget').hidden = !has;
  renderModels(AI.models(), AI.model());
}
let aiBusy = false;
async function aiCheck(){
  if(aiBusy) return;
  const k = $('#aiKey').value.trim();
  if(!k){ aiMsg('키를 붙여 넣어 주세요.', true); $('#aiKey').focus(); return; }
  if(!/^[A-Za-z0-9_.\-]{20,}$/.test(k)){ aiMsg('키 모양이 아닙니다. AI Studio에서 복사한 키를 그대로 붙여 넣어 주세요 (AQ. 또는 AIza로 시작합니다).', true); return; }
  aiBusy = true; $('#aiCheck').disabled = true; aiMsg('키를 확인하고 모델 목록을 받는 중…');
  try{
    const list = await AI.listModels(k);
    if(!list.length) throw {code: 'model'};
    AI.setKey(k); AI.setModels(list);
    const keep = AI.model() && list.some(m => m.id === AI.model()) ? AI.model() : AI.pickModel(list.map(m => m.id));
    AI.setModel(keep);
    renderAi();
    aiMsg('키가 맞습니다. 모델 ' + list.length + '개 가운데 「' + keep + '」을(를) 골라 두었습니다. 바꾸려면 목록에서 고르세요.');
    if(aiAfter) aiAfter();
  }catch(e){
    aiMsg(e && e.code === 'auth' ? '이 키로는 들어갈 수 없습니다. 키를 다시 확인하거나 AI Studio에서 새 키를 만들어 주세요.' : e && e.code === 'network' ? '인터넷에 연결되어 있지 않습니다.' : AI.errorText(e), true);
  }finally{ aiBusy = false; $('#aiCheck').disabled = false; }
}
let aiAfter = null;
function openAi(why, after){
  aiAfter = after || null;
  openSheet('aiDlg');
  if(why){ $('#setAi').open = true; $('#setReset').open = false; }
  renderAi();
  aiMsg(why || '');
  if(!AI.hasKey()) setTimeout(() => $('#aiKey').focus(), 0);
}
function aiClosed(){ aiAfter = null; }
$('#aiCheck').onclick = aiCheck;
$('#aiKey').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); aiCheck(); } });
$('#aiModel').onchange = () => { AI.setModel($('#aiModel').value); renderAi(); aiMsg('모델을 「' + AI.model() + '」(으)로 바꿨습니다.'); };
$('#aiForget').onclick = () => { AI.setKey(''); AI.setModel(''); AI.setModels([]); renderAi(); aiMsg('이 기기에서 키를 지웠습니다.'); };
$('#aiShow').onclick = () => { const i = $('#aiKey'); i.type = i.type === 'password' ? 'text' : 'password'; $('#aiShow').textContent = i.type === 'password' ? '보기' : '가리기'; };
$('#setBtn').onclick = () => { if(narrow()) app.classList.remove('drawer'); openAi(); };

/* ================= 시작 ================= */
try{ document.execCommand('defaultParagraphSeparator', false, 'div'); }catch(e){}
renderPrefs();
loadLt();
window.__lightning = {splitSents, parseResp, cdiff, computeRange, stNorm, ctMerge, pickFrags, boltPrompt, tidyPrompt, stormPrompt, prefs};
})();
