/* MYWONGO 스토밍 보기 · 위치 띠
   라이트닝 페이지(claude.ai)에서 세운 스토밍 개요(원고 기록의 lt.storm)를 앱에서 읽기 전용으로 보여 준다.
   개요·인물·연표를 고치는 것은 라이트닝 페이지에서 한다.
   위치 띠: 원고 위 얇은 띠에 이야기상 위치('지금 여기' 단계, 남색 칸)와 분량상 위치(목표 매수 대비 눈금)를 나란히 보인다.
   둘이 어긋나면 늘어지거나 서두르고 있다는 신호일 수 있다. */
(() => {
'use strict';
const W = window.__wongo;
if(!W || typeof document === 'undefined') return;
const $ = s => document.querySelector(s);
const paper = $('#paper');
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 8페이지즈 (+1 엔드롤). 라이트닝 페이지와 같은 값
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
const list = s => PH.filter(p => !p.opt || s.endroll);
const total = s => list(s).reduce((a, p) => a + p.w, 0);
const amt = (p, s) => s.target ? '약 ' + Math.max(1, Math.round(s.target * p.w / total(s))) + '매' : Math.round(p.w / total(s) * 100) + '%';
const phName = (k, s) => { if(k === 'pre') return '이야기 전'; const l = list(s), i = l.findIndex(p => p.k === k); return i >= 0 ? (i + 1) + '. ' + l[i].n : ''; };

let storm = null, view = 'out';
async function load(){
  const c = W.cur(), r = c ? await W.DB.get(c.id) : null;
  storm = r && r.lt && r.lt.storm && r.lt.storm.out ? r.lt.storm : null;
  $('#stormBtn').classList.toggle('has', !!storm);
  renderBand();
  if(!$('#svDlg').hidden) renderPanel();
}

/* ---------- 위치 띠 ---------- */
function charsToCaret(){
  const s = getSelection();
  if(!s.rangeCount) return null;
  const r = s.getRangeAt(0);
  if(!paper.contains(r.endContainer)) return null;
  const rr = document.createRange(); rr.setStart(paper, 0); rr.setEnd(r.endContainer, r.endOffset);
  return rr.toString().replace(/\n/g, '').length;
}
let lastChars = null, bandT = null;
function bandSoon(){ clearTimeout(bandT); bandT = setTimeout(renderBand, 250); }
function renderBand(){
  const b = $('#band');
  if(!storm){ b.hidden = true; b.innerHTML = ''; return; }
  const l = list(storm), tot = total(storm);
  const c = charsToCaret();
  if(c != null) lastChars = c;
  const chars = lastChars != null ? lastChars : paper.innerText.replace(/\n/g, '').length;
  const mae = chars / 200, target = storm.target || 0;
  const pct = target ? Math.min(100, mae / target * 100) : null;
  let amtK = null;
  if(pct != null){ let acc = 0; for(const p of l){ acc += p.w / tot * 100; if(pct <= acc + 1e-9){ amtK = p.k; break; } } if(!amtK) amtK = l[l.length - 1].k; }
  const ci = l.findIndex(p => p.k === storm.cur), ai = l.findIndex(p => p.k === amtK);
  let h = '<div class="band-segs" role="group" aria-label="스토밍 단계">' + l.map((p, i) => '<button type="button" data-k="' + p.k + '" style="flex:' + p.w + ' 1 0" class="' + (p.k === storm.cur ? 'cur' : '') + '" data-tip="' + (i + 1) + '. ' + esc(p.n) + (p.k === storm.cur ? ' · 지금 여기' : '') + '" data-tip-d="' + esc((storm.out.phases[p.k] || {}).t || p.d) + '" aria-label="' + (i + 1) + '. ' + esc(p.n) + ' 보기">' + (i + 1) + '</button>').join('');
  if(pct != null) h += '<i class="band-at" style="left:' + pct.toFixed(2) + '%" aria-hidden="true"></i>';
  h += '</div><span class="band-tx"><b>' + (ci >= 0 ? '지금 ' + (ci + 1) + '. ' + esc(l[ci].n) : '지금 여기 없음') + '</b> · ' + (target ? mae.toFixed(1) + ' / ' + target + '매' : '원고지 ' + mae.toFixed(1) + '매')
    + (ci >= 0 && ai >= 0 && ai !== ci ? '<span class="band-gap"> · 분량으로는 ' + (ai + 1) + '. ' + esc(l[ai].n) + ' 자리</span>' : '') + '</span>';
  b.innerHTML = h; b.hidden = false;
}
$('#band').addEventListener('click', e => { const k = e.target.closest('[data-k]'); if(k) openPanel(k.dataset.k); });
document.addEventListener('selectionchange', () => { if(storm && document.activeElement === paper) bandSoon(); });

/* ---------- 스토밍 보기 (읽기 전용) ---------- */
function mapH(s){
  const l = list(s), tot = total(s), sx = 600 / tot, Y = y => (60 - y * 46).toFixed(1);
  let x0 = 0, seps = '', band = '';
  l.forEach(p => { if(p.k === s.cur) band = '<rect class="bandr" x="' + (x0 * sx).toFixed(1) + '" y="0" width="' + (p.w * sx).toFixed(1) + '" height="100"/>'; x0 += p.w; if(x0 < tot) seps += '<line x1="' + (x0 * sx).toFixed(1) + '" x2="' + (x0 * sx).toFixed(1) + '" y1="4" y2="96"/>'; });
  const pts = CURVE.filter(p => p[0] <= tot).map(([x, y]) => (x * sx).toFixed(1) + ',' + Y(y)).join(' ');
  return '<div class="sv-map"><div class="sv-groups">' + [['기', 25], ['승', 25], ['전', 25], ['결', tot - 75]].map(([g, w]) => '<span style="flex:' + w + ' 1 0">' + g + '</span>').join('') + '</div>'
    + '<svg viewBox="0 0 600 100" preserveAspectRatio="none" aria-hidden="true">' + band + '<line class="zero" x1="0" x2="600" y1="60" y2="60"/>' + seps + '<polyline class="cv" points="' + pts + '"/></svg>'
    + '<div class="sv-segs">' + l.map((p, i) => '<button type="button" data-seg="' + p.k + '" style="flex:' + p.w + ' 1 0" class="' + (p.k === s.cur ? 'cur' : '') + '" data-tip="' + (i + 1) + '. ' + esc(p.n) + '" aria-label="' + (i + 1) + '. ' + esc(p.n) + ' 펼치기">' + (i + 1) + '</button>').join('') + '</div></div>';
}
function outH(s){
  const o = s.out, l = list(s);
  let h = mapH(s);
  if(o.read) h += '<div class="sv-card"><h3>이야기의 뼈대</h3><p>' + esc(o.read) + '</p></div>';
  if(o.logline) h += '<div class="sv-card"><h3>로그라인</h3><p>' + esc(o.logline) + '</p></div>';
  const ps = s.cast && s.cast.length ? s.cast.map(c => c.name + (c.role ? ' · ' + c.role : '')) : (o.people || []).map(p => p.name + (p.role ? ' · ' + p.role : '') + (p.note ? ' — ' + p.note : ''));
  if(ps.length) h += '<div class="sv-card"><h3>인물</h3><p class="ui">' + esc(ps.join('\n')) + '</p></div>';
  if(o.kw && o.kw.length) h += '<div class="sv-card"><h3>핵심어</h3><p class="ui">' + esc(o.kw.join(', ')) + '</p></div>';
  let g = '';
  l.forEach((p, i) => {
    if(p.g !== g){ g = p.g; h += '<div class="sv-grp">' + g + '</div>'; }
    const ph = o.phases[p.k] || {}, cur = s.cur === p.k;
    const tl = (s.time || []).filter(t => t.ph === p.k);
    h += '<details class="sv-ph' + (cur ? ' cur' : '') + '" data-ph="' + p.k + '"><summary><span class="sv-n">' + (i + 1) + '</span><span class="sv-nm">' + esc(p.n) + (cur ? '<span class="sv-here">지금 여기</span>' : '') + '</span><span class="sv-w">' + amt(p, s) + '</span><span class="sv-t">' + esc(ph.t || '비어 있음') + '</span></summary>'
      + '<div class="sv-b"><p class="sv-def">' + esc(p.d) + '</p>'
      + (ph.s ? '<div class="sv-lb">줄거리</div><p>' + esc(ph.s) + '</p>' : '')
      + (ph.b && ph.b.length ? '<div class="sv-lb">꼭 들어갈 장면</div><ul>' + ph.b.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '')
      + (tl.length ? '<div class="sv-lb">연표</div><ul>' + tl.map(t => '<li>' + esc((t.when ? t.when + ' · ' : '') + t.what) + '</li>').join('') + '</ul>' : '')
      + '</div></details>';
  });
  return h;
}
function castH(s){
  return s.cast.map(c => '<details class="sv-ph"><summary><span class="sv-nm">' + esc(c.name) + '</span><span class="sv-w">' + esc(c.role) + '</span><span></span><span class="sv-t">' + esc(c.desc || c.want) + '</span></summary><div class="sv-b">'
    + CF.filter(([f]) => c[f]).map(([f, lb]) => '<div class="sv-lb">' + lb + '</div><p>' + esc(c[f]) + '</p>').join('') + '</div></details>').join('');
}
function timeH(s){
  return '<ul class="sv-tl">' + (s.time || []).map(t => '<li class="' + (t.ph && t.ph === s.cur ? 'cur' : '') + '"><span class="w">' + esc(t.when) + '</span><span class="x">' + esc(t.what) + '</span><span class="m">' + esc([phName(t.ph, s), t.who].filter(Boolean).join(' · ')) + '</span></li>').join('') + '</ul>';
}
function renderPanel(openK){
  const body = $('#svBody'), tabs = $('#svTabs');
  if(!storm){
    tabs.innerHTML = '';
    body.innerHTML = '<p class="hint sv-note">이 원고에는 아직 스토밍 개요가 없습니다. 라이트닝 페이지에서 스토밍한 뒤 raining 하면, 앱의 \'라이트닝에서 받기\'로 받아 여기서 볼 수 있습니다.</p>';
    return;
  }
  if(!storm.cast && view !== 'out') view = 'out';
  tabs.innerHTML = storm.cast ? [['out', '개요'], ['cast', '인물 ' + storm.cast.length], ['time', '연표 ' + (storm.time || []).length]].map(([v, l]) => '<button type="button" role="tab" class="seg-b' + (v === view ? ' on' : '') + '" aria-selected="' + (v === view) + '" data-view="' + v + '">' + l + '</button>').join('') : '';
  body.innerHTML = '<p class="hint sv-note">라이트닝 페이지에서 세운 스토밍입니다. 고치는 것은 라이트닝 페이지에서 합니다.</p>' + (view === 'cast' ? castH(storm) : view === 'time' ? timeH(storm) : outH(storm));
  if(openK){ const d = body.querySelector('details[data-ph="' + openK + '"]'); if(d){ d.open = true; setTimeout(() => d.scrollIntoView({block: 'start'}), 0); } }
}
async function openPanel(k){
  W.closePops();
  await load();
  if(k) view = 'out';
  $('#svDlg').hidden = false;
  renderPanel(k || (storm && storm.cur));
}
function closePanel(){ $('#svDlg').hidden = true; }
$('#stormBtn').onclick = () => openPanel();
$('#svClose').onclick = closePanel;
$('#svDlg').addEventListener('click', e => { if(e.target.id === 'svDlg') closePanel(); });
$('#svTabs').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if(b){ view = b.dataset.view; renderPanel(); $('#svBody').scrollTop = 0; } });
$('#svBody').addEventListener('click', e => { const b = e.target.closest('[data-seg]'); if(b){ const d = $('#svBody').querySelector('details[data-ph="' + b.dataset.seg + '"]'); if(d){ d.open = true; d.scrollIntoView({block: 'start', behavior: 'smooth'}); } } });
document.addEventListener('keydown', e => { if(e.key === 'Escape' && !$('#svDlg').hidden){ closePanel(); e.stopPropagation(); } }, true);

document.addEventListener('wongo:open', load);
document.addEventListener('wongo:stats', () => { if(storm) bandSoon(); });
load();
})();
