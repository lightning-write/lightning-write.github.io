/* 라이트닝 라이트 — 서재: 읽던 문서와 번역한 책을 기억하고, 드라이브로 다른 기기와 잇는다
   - 이 기기: IndexedDB 'wongo-tr' — books(번역 책 전체), meta(목록·읽던 자리·드라이브 상태), blobs(읽기 모드로 연 문서 파일)
   - 드라이브: LWRITE/서재 (지우지 마세요). 번역 책은 「번역 · 제목 [id].json.gz」 하나, 읽기 모드 문서는 원래 이름으로 한 부.
     읽던 자리·진행·제목은 그 파일의 appProperties(pos·posAt·at·pct·t·tt·type·wpId·cv)에 두어, 자리만 바뀌면 파일은 다시 올리지 않는다.
   - 두 기기에서 같은 번역 책을 고쳤으면 문단마다 더 나중에 바뀐 쪽(ts), 표기표는 더 나중에 고친 쪽, 읽던 자리도 더 나중 것을 쓴다.
   - 다른 기기에서 온 항목은 처음엔 목록(stub)만 있고, 열 때 내용을 받는다.
   window.__lib */
(() => {
'use strict';
const W = window.__wongo;
if(!W || typeof document === 'undefined') return;
const $ = s => document.querySelector(s);
const toast = W.toast;
const BIG = 100 * 1048576;   // 이보다 큰 문서는 드라이브에 올리지 않고 이 기기에만 둔다

/* ================= 기기 보관함 ================= */
const DB = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((ok, bad) => {
    const r = indexedDB.open('wongo-tr', 2);
    r.onupgradeneeded = () => { const d = r.result; for(const n of ['books', 'meta', 'blobs']) if(!d.objectStoreNames.contains(n)) d.createObjectStore(n, {keyPath: 'id'}); };
    r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); dbp = null; }; ok(d); };
    r.onerror = () => { dbp = null; bad(r.error); };
  }));
  const run = async (names, mode, body) => {
    const d = await open();
    return new Promise((ok, bad) => {
      const t = d.transaction(names, mode); let out;
      t.oncomplete = () => ok(out); t.onerror = () => bad(t.error); t.onabort = () => bad(t.error);
      body(t, v => { out = v; });
    });
  };
  return {
    get: (st, id) => run(st, 'readonly', (t, set) => { const q = t.objectStore(st).get(id); q.onsuccess = () => set(q.result); }),
    all: st => run(st, 'readonly', (t, set) => { const q = t.objectStore(st).getAll(); q.onsuccess = () => set(q.result || []); }),
    put: (st, rec) => run(st, 'readwrite', t => { t.objectStore(st).put(rec); }),
    del: (st, id) => run(st, 'readwrite', t => { t.objectStore(st).delete(id); }),
    drop: id => run(['books', 'meta', 'blobs'], 'readwrite', t => { for(const n of ['books', 'meta', 'blobs']) t.objectStore(n).delete(id); }),
    /* 읽고-고치고-쓰기 한 번에. fn이 undefined를 돌려주면 그대로 둔다 */
    update: (st, id, fn) => run(st, 'readwrite', (t, set) => { const s = t.objectStore(st), q = s.get(id); q.onsuccess = () => { const nv = fn(q.result); if(nv !== undefined) s.put(nv); set(nv); }; })
  };
})();

const meta = id => DB.get('meta', id).catch(() => null);
async function metas(){ let ms = []; try{ ms = await DB.all('meta'); }catch(e){} return ms.filter(m => !m.deleted).map(m => Object.assign({type: 'tr'}, m)).sort((a, b) => (b.at || 0) - (a.at || 0)); }
const patchMeta = (id, up) => DB.update('meta', id, m => m ? Object.assign(m, typeof up === 'function' ? up(m) : up) : undefined);

/* ================= 번역 책: 합치기 =================
   문단마다 ts(번역·고침·지움이 일어난 때)를 비교해 더 나중 것을 쓴다. 같으면(옛 기록) 이 기기 것 */
function mergeTr(a, b){
  if(!b || !b.paras) return a;
  if(!a || !a.paras) return b;
  const out = Object.assign({}, a, {tr: {}, ed: {}, fail: {}, ts: {}});
  const A = {tr: a.tr || {}, ed: a.ed || {}, fail: a.fail || {}, ts: a.ts || {}}, Bb = {tr: b.tr || {}, ed: b.ed || {}, fail: b.fail || {}, ts: b.ts || {}};
  const keys = new Set([].concat(...[A, Bb].map(x => [...Object.keys(x.tr), ...Object.keys(x.ts), ...Object.keys(x.fail)])));
  for(const k of keys){
    const ta = A.ts[k] || 0, tb = Bb.ts[k] || 0;
    const s = tb > ta ? Bb : ta > tb ? A : (A.tr[k] != null || A.fail[k] ? A : Bb);
    if(s.tr[k] != null) out.tr[k] = s.tr[k];
    if(s.ed[k]) out.ed[k] = 1;
    if(s.fail[k] && s.tr[k] == null) out.fail[k] = 1;
    if(ta || tb) out.ts[k] = Math.max(ta, tb);
  }
  if((b.glossAt || 0) > (a.glossAt || 0)){ out.gloss = b.gloss || ''; out.glossAt = b.glossAt; }
  out.trTitle = a.trTitle || b.trTitle || '';
  return out;
}
const trKey = r => JSON.stringify([r.tr || {}, r.ed || {}, r.fail || {}, r.gloss || '', r.trTitle || '']);

/* ================= 번역 책 (translate.js가 부른다) ================= */
let live = null;   // 번역 화면에 지금 열린 책: {id, merge(remote)}
async function trGet(id){ try{ return await DB.get('books', id); }catch(e){ return null; } }
async function trSave(rec, info){
  await DB.put('books', rec);
  const now = Date.now();
  await DB.update('meta', rec.id, m => Object.assign({type: 'tr', id: rec.id, fileId: null, cv: ''}, m || {}, {
    type: 'tr', title: rec.title, trTitle: rec.trTitle || '', pct: info.pct, chs: info.chs, at: now, dirty: true, dirtyAt: now, stub: false, deleted: false
  }));
  soon(120000); render();
}
/* 다른 기기에서 온 번역 책: 내용을 받아 둔다 */
async function trFetch(id){
  const m = await meta(id); if(!m || !m.fileId) return null;
  const rec = await download(m.fileId, true);
  if(!rec || rec.id !== id) return null;
  await DB.put('books', rec);
  await patchMeta(id, {stub: false, cv: m.cv, dirty: false});
  return rec;
}

/* ================= 읽기 모드 문서 (books.js가 부른다) ================= */
async function hashBlob(b){
  try{ const h = new Uint8Array(await crypto.subtle.digest('SHA-256', await b.arrayBuffer())); return 'r' + [...h.slice(0, 12)].map(x => x.toString(16).padStart(2, '0')).join(''); }
  catch(e){ return 'r' + b.size.toString(16) + '-' + String(b.name || '').length; }
}
/* 읽기 모드로 연 파일을 서재에 둔다. 같은 파일(내용이 같음)이면 같은 항목 → 읽던 자리가 이어진다 */
async function rememberRd(f, info){
  const id = info.id || await hashBlob(f), now = Date.now();
  let has = null; try{ has = await DB.get('blobs', id); }catch(e){}
  if(!has && f.size <= BIG * 2){ try{ await DB.put('blobs', {id, blob: f}); }catch(e){ /* 기기 저장 공간 부족: 목록만 */ } }
  await DB.update('meta', id, m => {
    const base = Object.assign({type: 'rd', id, fileId: null, cv: ''}, m || {});
    return Object.assign(base, {type: 'rd', title: base.stub || !base.title ? info.title : base.title, name: f.name, kind: info.kind, size: f.size, at: now, stub: false, deleted: false,
      big: f.size > BIG, dirty: !base.fileId && f.size <= BIG, dirtyAt: base.dirtyAt || now});
  });
  soon(3000); render();
  return id;
}
async function rdFile(id){
  const m = await meta(id); if(!m) return null;
  let rec = null; try{ rec = await DB.get('blobs', id); }catch(e){}
  let blob = rec && rec.blob;
  if(!blob){
    if(!m.fileId) throw {code: 'nofile'};
    const D = drive(); if(!D) throw {code: navigator.onLine === false ? 'network' : 'auth'};
    toast('드라이브에서 받는 중…' + (m.size ? ' (' + (m.size / 1048576).toFixed(1) + 'MB)' : ''), 60000);
    blob = await D.media(m.fileId);
    $('#toast').hidden = true;
    try{ await DB.put('blobs', {id, blob}); }catch(e){}
    await patchMeta(id, {stub: false});
  }
  return new File([blob], m.name || m.title || '문서', {type: blob.type || ''});
}

/* ================= 읽던 자리 ================= */
async function setPos(id, pos, extra){
  const now = Date.now();
  await patchMeta(id, Object.assign({}, extra || {}, {pos, posAt: now, at: now, posDirty: true}));
  soon(5000);
}

/* ================= 지우기 ================= */
async function forget(id){
  const m = await meta(id);
  if(!m) return;
  await DB.del('books', id).catch(() => {}); await DB.del('blobs', id).catch(() => {});
  if(m.fileId) await DB.put('meta', {id, type: m.type, deleted: true, fileId: m.fileId}); else await DB.del('meta', id);
  try{ localStorage.removeItem('wongo-tr-pos-' + id); }catch(e){}
  soon(500); render();
}

/* ================= 드라이브 ================= */
const drive = () => { const L = W.Drive && W.Drive.lib; return L && L.ready() ? L : null; };
const enc8 = new TextEncoder();
function cut(s, bytes){ s = String(s == null ? '' : s); while(enc8.encode(s).length > bytes) s = s.slice(0, -1); return s; }
function props(m){
  // appProperties는 키+값이 124바이트를 넘지 못한다
  return {kind: 'lib', type: m.type, wpId: m.id, t: cut(m.title, 100), tt: cut(m.trTitle || '', 100), k: cut(m.kind || '', 20), pct: String(m.pct || 0),
    at: String(m.at || 0), pos: cut(m.pos ? JSON.stringify(m.pos) : '', 110), posAt: String(m.posAt || 0), cv: String(m.cv || ''), sz: String(m.size || 0), pp: String(m.pages || 0)};
}
async function gz(text){
  if(typeof CompressionStream === 'undefined') return {blob: new Blob([text], {type: 'application/json'}), gz: false};
  const b = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  return {blob: new Blob([b], {type: 'application/gzip'}), gz: true};
}
async function download(fileId, json){
  const D = drive(); if(!D) throw {code: navigator.onLine === false ? 'network' : 'auth'};
  const b = await D.media(fileId);
  if(!json) return b;
  const head = new Uint8Array(await b.slice(0, 2).arrayBuffer());
  let text;
  if(head[0] === 0x1f && head[1] === 0x8b) text = await new Response(b.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  else text = await b.text();
  return JSON.parse(text);
}
const safe = s => String(s || '').replace(/[\\/]/g, ' ').replace(/[\[\]]/g, ' ').slice(0, 90);
let running = false, again = false, soonT = null, lastErr = null;
function soon(ms){ clearTimeout(soonT); soonT = setTimeout(sync, ms); }
async function sync(){
  const D = drive(); if(!D) return;
  if(running){ again = true; return; }
  running = true; let changed = false;
  try{
    const folder = await D.ensureLib();
    const files = await D.find("'" + folder + "' in parents and trashed=false and appProperties has { key='kind' and value='lib' }", 'id,name,size,appProperties');
    const remote = new Map();
    for(const f of files){ const id = f.appProperties && f.appProperties.wpId; if(id && !remote.has(id)) remote.set(id, f); }
    const all = await DB.all('meta');
    const known = new Map(all.map(m => [m.id, m]));
    // 1. 이 기기에서 지운 것 → 드라이브 휴지통
    for(const m of all.filter(x => x.deleted)){
      for(const fid of new Set([m.fileId, remote.get(m.id) && remote.get(m.id).id].filter(Boolean))){
        try{ await D.patch(fid, {trashed: true}); }catch(e){ if(e.code !== 'notfound') throw e; }
      }
      await DB.del('meta', m.id); remote.delete(m.id); known.delete(m.id);
    }
    // 2. 드라이브에 있는 것: 새 항목은 목록만, 있던 항목은 자리·진행을 맞추고 번역은 합친다
    for(const [id, f] of remote){
      const p = f.appProperties || {}, m = known.get(id);
      let rpos = null; try{ rpos = p.pos ? JSON.parse(p.pos) : null; }catch(e){}
      const rposAt = +p.posAt || 0;
      if(!m){
        await DB.put('meta', {id, type: p.type === 'rd' ? 'rd' : 'tr', title: p.t || f.name, trTitle: p.tt || '', name: f.name, kind: p.k || '', size: +p.sz || +f.size || 0,
          pct: +p.pct || 0, pages: +p.pp || 0, at: +p.at || 0, pos: rpos, posAt: rposAt, fileId: f.id, cv: p.cv || '', stub: true, dirty: false, posDirty: false});
        changed = true; continue;
      }
      const up = {fileId: f.id};
      if(rposAt > (m.posAt || 0)){ up.pos = rpos; up.posAt = rposAt; up.posDirty = false; up.pct = +p.pct || m.pct || 0; if(+p.pp) up.pages = +p.pp; changed = true; }
      if((+p.at || 0) > (m.at || 0)) up.at = +p.at;
      if(m.type !== 'rd' && p.cv && p.cv !== m.cv){
        if(m.stub){ Object.assign(up, {cv: p.cv, pct: +p.pct || 0, trTitle: p.tt || m.trTitle, title: p.t || m.title}); changed = true; }
        else {
          const r = await download(f.id, true);
          if(r && r.id === id){
            if(live && live.id === id && live.merge(r)){ up.cv = p.cv; up.dirty = true; up.dirtyAt = 0; }   // 열려 있는 책은 화면의 기록에 합친다
            else {
              const loc = await trGet(id), mg = mergeTr(loc, r);
              await DB.put('books', mg);
              up.cv = p.cv; up.dirty = trKey(mg) !== trKey(r); up.dirtyAt = 0;
              up.trTitle = mg.trTitle || m.trTitle;
            }
            changed = true;
          }
        }
      }
      await patchMeta(id, up);
    }
    // 3. 다른 기기에서 지운 것(드라이브에 없음): 이 기기에서 올릴 것이 남지 않았으면 지운다
    for(const m of await DB.all('meta')){
      if(m.deleted || !m.fileId || remote.has(m.id)) continue;
      if(m.dirty && !m.stub) await patchMeta(m.id, {fileId: null});
      else { await DB.drop(m.id); changed = true; if(live && live.id === m.id && live.gone) live.gone(); }
    }
    // 4. 올리기: 내용이 바뀐 것은 파일째, 자리만 바뀐 것은 appProperties만
    for(const m0 of await DB.all('meta')){
      const m = Object.assign({type: 'tr'}, m0);
      if(m.deleted || m.stub || m.big) continue;
      const busy = live && live.id === m.id && Date.now() - (m.dirtyAt || 0) < 90000;   // 번역하는 동안은 1분 반에 한 번만
      if((m.dirty || !m.fileId) && !busy){   // 아직 드라이브에 없는 것(옛 판에서 번역한 책 포함)도 올린다
        let blob, mime, name, gzOn = false;
        if(m.type === 'rd'){
          const b = await DB.get('blobs', m.id); if(!b || !b.blob) continue;
          blob = b.blob; mime = b.blob.type || 'application/octet-stream'; name = safe(m.name || m.title);
        } else {
          const rec = await trGet(m.id); if(!rec) continue;
          const z = await gz(JSON.stringify(rec)); blob = z.blob; mime = z.blob.type; gzOn = z.gz;
          name = '번역 · ' + safe(m.trTitle || m.title) + ' [' + m.id + '].json' + (gzOn ? '.gz' : '');
        }
        const cv = m.type === 'rd' ? (m.cv || String(Date.now())) : String(Date.now());
        const ap = props(Object.assign({}, m, {cv}));
        let res;
        if(m.fileId){
          try{ res = await D.upload(m.fileId, {name, appProperties: ap}, blob, mime); }
          catch(e){ if(e.code === 'notfound') res = await D.upload(null, {name, parents: [folder], mimeType: mime, appProperties: ap}, blob, mime); else throw e; }
        } else res = await D.upload(null, {name, parents: [folder], mimeType: mime, appProperties: ap}, blob, mime);
        await patchMeta(m.id, cur => ({fileId: res.id, cv, dirty: (cur.dirtyAt || 0) > (m.dirtyAt || 0), posDirty: (cur.posAt || 0) > (m.posAt || 0)}));
      } else if(m.posDirty && m.fileId){
        try{ await D.patch(m.fileId, {appProperties: props(m)}); }
        catch(e){ if(e.code === 'notfound'){ await patchMeta(m.id, {fileId: null, dirty: true}); continue; } throw e; }
        await patchMeta(m.id, cur => ({posDirty: (cur.posAt || 0) > (m.posAt || 0)}));
      }
    }
    lastErr = null;
  }catch(e){
    lastErr = e;
    if(e && e.code === 'notfound') W.Drive.lib.forget();
    if(e && e.code !== 'auth' && e.code !== 'network') console.warn('서재 동기화 실패', e);
  }finally{
    running = false;
    render();
    if(again){ again = false; soon(1000); }
  }
  return changed;
}
document.addEventListener('wongo:synced', () => sync());

/* ================= 열기 메뉴의 「이어 읽기」와 서재 창 ================= */
const day = t => { const d = new Date(t || 0); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일'; };
const label = m => m.type === 'tr' ? (m.trTitle || m.title || '번역한 책') : (m.title || m.name || '문서');
function sub(m, long){
  const bits = [];
  if(m.type === 'tr') bits.push('번역 ' + (m.pct || 0) + '%' + (m.trTitle && m.title ? ' · ' + m.title : ''));
  else {
    bits.push((m.kind || '').toUpperCase() || '문서');
    if(m.pos && m.pos.pg) bits.push(m.pos.pg + (m.pages ? ' / ' + m.pages : '') + '쪽');
    else if(m.pct) bits.push(m.pct + '%');
  }
  if(m.at) bits.push(day(m.at));
  if(long){
    if(m.stub) bits.push('다른 기기에서 · 열면 받아 옵니다');
    else if(m.big) bits.push('용량이 커서 이 기기에만');
    else if(m.fileId) bits.push('드라이브에 있음');
    else bits.push(W.Drive && W.Drive.connected() ? '드라이브에 올리는 중' : '이 기기에만 · 드라이브에 연결하면 올라갑니다');
  } else if(m.stub) bits.push('다른 기기에서');
  return bits.join(' · ');
}
async function open(m){
  W.closePops(); closeDlg();
  try{
    if(m.type === 'tr') await window.__tr.openSaved(m.id);
    else { const f = await rdFile(m.id); if(f) await window.__books.readFile(f, m.title || m.name, {libId: m.id}); }
  }catch(e){
    $('#toast').hidden = true;
    toast(e && e.code === 'nofile' ? '이 문서의 파일이 이 기기에 없습니다. 파일을 다시 열어 주세요.' : e && e.code === 'network' ? '인터넷에 연결된 뒤 드라이브에서 받을 수 있습니다.' : e && e.code === 'auth' ? '드라이브 연결이 만료되었습니다. 원고 목록 아래 「다시 연결」을 누른 뒤 열어 주세요.' : '열지 못했습니다.', 7000);
  }
}
function row(m, long){
  const r = document.createElement('div'); r.className = 'lib-row';
  const b = document.createElement('button'); b.type = 'button'; b.className = 'mi'; b.setAttribute('role', 'menuitem');
  b.innerHTML = '<span class="lib-k"></span><b></b><small></small>';
  b.children[0].textContent = m.type === 'tr' ? '번역' : '읽기';
  b.children[1].textContent = '「' + label(m) + '」';
  b.children[2].textContent = sub(m, long);
  b.onclick = () => open(m);
  r.appendChild(b);
  if(long){
    const x = document.createElement('button'); x.type = 'button'; x.className = 'tr-x'; x.textContent = '✕';
    x.title = '서재에서 지우기'; x.setAttribute('aria-label', '「' + label(m) + '」 서재에서 지우기');
    x.onclick = async e => {
      e.stopPropagation();
      if(x.dataset.sure !== '1'){ x.dataset.sure = '1'; x.textContent = '지우기'; setTimeout(() => { x.dataset.sure = ''; x.textContent = '✕'; }, 4000); return; }
      await forget(m.id); renderDlg();
    };
    r.appendChild(x);
  }
  return r;
}
let renderT = null;
function render(){ clearTimeout(renderT); renderT = setTimeout(renderNow, 50); }
async function renderNow(){
  const box = $('#libRecent'); if(!box) return;
  const ms = await metas();
  $('#libBox').hidden = !ms.length;
  box.textContent = '';
  for(const m of ms.slice(0, 4)) box.appendChild(row(m, false));
  $('#libAll').lastChild.textContent = '모두 ' + ms.length + '개 · 지우기';
  if(!$('#libDlg').hidden && !$('#libList [data-sure="1"]')) renderDlg();   // ✕를 한 번 누른 채면 다시 그리지 않는다
}
async function renderDlg(){
  const ms = await metas(), ul = $('#libList');
  ul.textContent = '';
  if(!ms.length){ const p = document.createElement('p'); p.className = 'hint'; p.textContent = '아직 없습니다. 열기 → 읽기 모드나 번역 모드로 연 문서가 여기 쌓입니다.'; ul.appendChild(p); }
  for(const m of ms) ul.appendChild(row(m, true));
  $('#libState').textContent = !(W.Drive && W.Drive.connected()) ? '드라이브에 연결되어 있지 않아 이 기기에만 있습니다. 원고 목록 아래 「드라이브 연결」을 누르면 다른 기기와 이어집니다.'
    : lastErr ? (lastErr.code === 'network' ? '인터넷 연결을 기다리는 중입니다.' : '드라이브와 맞추지 못했습니다. 잠시 뒤 다시 합니다.') : '드라이브 \'LWRITE/서재\' 폴더와 맞춰 둡니다.';
}
function openDlg(){ W.closePops(); $('#libDlg').hidden = false; renderDlg(); if(drive()) sync(); }
function closeDlg(){ $('#libDlg').hidden = true; }
$('#libAll').onclick = openDlg;
$('#libClose').onclick = closeDlg;
$('#libDlg').addEventListener('click', e => { if(e.target.id === 'libDlg') closeDlg(); });
document.addEventListener('keydown', e => { if(e.key === 'Escape' && !$('#libDlg').hidden){ e.preventDefault(); e.stopPropagation(); closeDlg(); } }, true);
// 열기 메뉴를 열 때 드라이브의 서재를 한 번 훑는다(마지막으로 훑은 지 20초가 넘었으면)
let lastLook = 0;
$('#openBtn').addEventListener('click', () => { render(); if(drive() && Date.now() - lastLook > 20000){ lastLook = Date.now(); sync(); } });
render();

window.__lib = {DB, meta, metas, trGet, trSave, trFetch, rememberRd, rdFile, setPos, forget, sync, soon, render, mergeTr, hashBlob, open,
  get live(){ return live; }, set live(v){ live = v; }};
})();
