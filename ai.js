/* 라이트닝 라이트 — AI 부르기 (Google Gemini API, 무료 등급)
   키는 이 기기(localStorage)에만 두고, 브라우저가 generativelanguage.googleapis.com 에 바로 요청한다. 서버는 없다.
   무료 등급은 보낸 글을 구글이 제품 개선에 쓸 수 있다(약관). 설정 창에 그 사실을 적어 두었다.
   window.__ai = {hasKey, key, setKey, model, setModel, listModels, pickModel, generate, generateJson, errorText} */
(() => {
'use strict';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const LS = 'wongo-ai-';
function lsGet(k, d){ try{ const v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } }
function lsSet(k, v){ try{ if(v == null || v === '') localStorage.removeItem(LS + k); else localStorage.setItem(LS + k, JSON.stringify(v)); }catch(e){} }

const key = () => String(lsGet('key', '') || '').trim();
const model = () => String(lsGet('model', '') || '').trim();
const err = (code, extra) => Object.assign({code}, extra || {});

/* 모델 이름에서 세대와 종류를 읽는다. 무료 등급은 Flash·Flash-Lite만 되고, 하루 한도는 Flash-Lite 쪽이 훨씬 넉넉하다 */
function info(name){
  const id = String(name || '').replace(/^models\//, '');
  const m = id.match(/^gemini-(\d+(?:\.\d+)?)-(flash-lite|flash|pro)/);
  const bad = /(image|tts|audio|live|native|embedding|robotics|computer-use|thinking|exp$|-exp-|8b|aqa|imagen|veo|learnlm|gemma)/.test(id);
  return {id, ver: m ? parseFloat(m[1]) : 0, kind: m ? m[2] : '', preview: /preview/.test(id), dated: /-\d{2}-\d{2}$|-\d{3,}$/.test(id), bad};
}
/* 목록에서 기본 모델 고르기: Flash-Lite 가운데 가장 새 것(정식판 우선) → 없으면 Flash → 없으면 아무 Gemini */
function pickModel(list){
  const c = (list || []).map(info).filter(x => !x.bad && x.kind);
  const rank = x => (x.kind === 'flash-lite' ? 300 : x.kind === 'flash' ? 200 : 100) + (x.preview ? 0 : 50) + (x.dated ? 0 : 20) + Math.min(19, x.ver);
  c.sort((a, b) => rank(b) - rank(a) || b.ver - a.ver);
  return c.length ? c[0].id : (list && list.length ? info(list[0]).id : 'gemini-2.5-flash-lite');
}
async function listModels(k){
  k = k || key();
  if(!k) throw err('no_key');
  let r;
  try{ r = await fetch(BASE + '/models?pageSize=200', {headers: {'x-goog-api-key': k}}); }
  catch(e){ throw err('network'); }
  if(!r.ok) throw await httpErr(r);
  const j = await r.json();
  const out = [];
  for(const m of j.models || []){
    const name = String(m.name || '').replace(/^models\//, '');
    if(!/^gemini/.test(name)) continue;
    if(!(m.supportedGenerationMethods || []).includes('generateContent')) continue;
    if(info(name).bad) continue;   // 이미지·음성·임베딩 같은 글쓰기용이 아닌 모델은 뺀다
    out.push({id: name, label: m.displayName || name, inLimit: m.inputTokenLimit || 0, outLimit: m.outputTokenLimit || 0});
  }
  return out;
}
async function httpErr(r){
  let j = null, text = '';
  try{ text = await r.text(); j = JSON.parse(text); }catch(e){}
  const msg = (j && j.error && (j.error.message || j.error.status)) || text.slice(0, 200) || '';
  const st = r.status;
  if(st === 429) return err('rate_limited', {status: st, msg});
  if(st === 401 || st === 403 || /API key|API_KEY|PERMISSION_DENIED|expired/i.test(msg)) return err('auth', {status: st, msg});
  if(st === 404) return err('model', {status: st, msg});
  if(st === 400 && /token|too long|exceeds|size/i.test(msg)) return err('prompt_too_large', {status: st, msg});
  if(st === 400 && /thinking/i.test(msg)) return err('thinking', {status: st, msg});
  if(st === 400 && /not found|not supported|unsupported|unavailable/i.test(msg)) return err('model', {status: st, msg});
  if(st === 503 || st === 500 || st === 502 || st === 504) return err('busy', {status: st, msg});
  return err('http', {status: st, msg});
}
/* 생각(thinking) 설정. 생각에 쓴 토큰도 maxOutputTokens에 함께 잡혀서, 생각이 길면 본문이 비어 온다.
   2.5 세대는 thinkingBudget(Flash·Flash-Lite는 0으로 끌 수 있음), 3 세대부터는 thinkingLevel.
   tier: 'fast' → minimal(거의 생각 안 함), 'mid' → low, 'deep' → high. Pro는 minimal이 없어 low */
function thinkingFor(id, tier){
  const i = info(id);
  if(!i.ver) return null;
  if(i.ver < 3) return i.kind === 'pro' ? {thinkingBudget: tier === 'deep' ? 4096 : 128} : {thinkingBudget: tier === 'deep' ? 2048 : 0};
  const lv = tier === 'deep' ? 'high' : tier === 'mid' ? 'low' : 'minimal';
  return {thinkingLevel: i.kind === 'pro' && lv === 'minimal' ? 'low' : lv};
}
function parseSse(buf, final){
  const out = []; let rest = buf.replace(/\r\n?/g, '\n');   // 구글은 조각을 \r\n\r\n 으로 나눠 보낸다
  if(final) rest += '\n\n';
  for(;;){
    const i = rest.indexOf('\n\n'); if(i < 0) break;
    const chunk = rest.slice(0, i); rest = rest.slice(i + 2);
    for(const line of chunk.split('\n')){ if(line.startsWith('data:')){ const d = line.slice(5).trim(); if(d && d !== '[DONE]') out.push(d); } }
  }
  return {events: out, rest};
}
/* generate(prompt, {signal, onText({text}), tier:'fast'|'mid'|'deep', json:true, maxTokens, temperature})
   → {text, truncated}. 흐르는 대로 onText에 지금까지의 글을 준다 */
async function generate(prompt, opt){
  opt = opt || {};
  const k = key(); if(!k) throw err('no_key');
  const id = opt.model || model(); if(!id) throw err('no_model');
  // 길이는 프롬프트로 조절하고, 한도는 넉넉히 둔다(생각 토큰이 함께 잡히므로)
  const gen = {temperature: opt.temperature == null ? (opt.json ? 0.6 : 0.9) : opt.temperature, maxOutputTokens: Math.max(8192, opt.maxTokens || 0)};
  if(opt.json) gen.responseMimeType = 'application/json';
  let think = thinkingFor(id, opt.tier || 'mid');
  const body = {contents: [{role: 'user', parts: [{text: String(prompt)}]}], generationConfig: gen,
    safetySettings: ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map(c => ({category: c, threshold: 'BLOCK_ONLY_HIGH'}))};
  const run = async (withThink, signal) => {
    const b = Object.assign({}, body, {generationConfig: Object.assign({}, gen, withThink && think ? {thinkingConfig: think} : {})});
    let r;
    try{ r = await fetch(BASE + '/models/' + encodeURIComponent(id) + ':streamGenerateContent?alt=sse', {method: 'POST', signal, headers: {'Content-Type': 'application/json', 'x-goog-api-key': k}, body: JSON.stringify(b)}); }
    catch(e){ throw (e && e.name === 'AbortError') ? err('cancelled') : err('network'); }
    if(!r.ok) throw await httpErr(r);
    return r;
  };
  /* 답이 오래 안 오면 멈춘다: 첫 글자까지 90초, 그 뒤로는 30초 동안 아무것도 안 오면 */
  const ctl = new AbortController();
  let timedOut = false, tm = null;
  const arm = ms => { clearTimeout(tm); tm = setTimeout(() => { timedOut = true; ctl.abort(); }, ms); };
  if(opt.signal){ if(opt.signal.aborted) ctl.abort(); else opt.signal.addEventListener('abort', () => ctl.abort(), {once: true}); }
  const sig = ctl.signal;
  const run0 = run;
  arm(90000);
  let r;
  try{
    try{ r = await run0(true, sig); }
    catch(e){
      if(!(e && e.code === 'thinking' && think)) throw e;
      // 이 모델이 그 생각 단계를 안 받으면: minimal → low로, 그래도 안 되면 생각 설정을 빼고
      if(think.thinkingLevel === 'minimal'){ think = {thinkingLevel: 'low'}; try{ r = await run0(true, sig); }catch(e2){ if(e2 && e2.code === 'thinking') r = await run0(false, sig); else throw e2; } }
      else r = await run0(false, sig);
    }
  }catch(e){ clearTimeout(tm); if(timedOut) throw err('timeout'); throw e; }
  const dec = new TextDecoder('utf-8');
  const reader = r.body.getReader();
  let buf = '', text = '', finish = '', blocked = '';
  try{
    for(;;){
      const {value, done} = await reader.read();
      if(!done){ buf += dec.decode(value, {stream: true}); arm(text ? 30000 : 90000); }
      const p = parseSse(buf, done); buf = p.rest;
      for(const d of p.events){
        let j; try{ j = JSON.parse(d); }catch(e){ continue; }
        if(j.promptFeedback && j.promptFeedback.blockReason) blocked = j.promptFeedback.blockReason;
        const c = j.candidates && j.candidates[0];
        if(!c) continue;
        if(c.finishReason) finish = c.finishReason;
        for(const part of (c.content && c.content.parts) || []) if(typeof part.text === 'string' && !part.thought) text += part.text;
      }
      if(opt.onText && text) opt.onText({text});
      if(done) break;
    }
  }catch(e){
    clearTimeout(tm);
    if(timedOut) throw err('timeout', {text});
    if(e && e.name === 'AbortError') throw err('cancelled', {text});
    throw err('network', {text});
  }
  clearTimeout(tm);
  if(blocked || finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' || finish === 'BLOCKLIST') throw err('refused', {text});
  if(!text.trim()){
    // 생각만 하다 한도가 끝난 경우: 생각을 줄이고 한도를 늘려 한 번 더
    if(finish === 'MAX_TOKENS' && !opt._retry) return generate(prompt, Object.assign({}, opt, {_retry: true, tier: 'fast', maxTokens: Math.max(16384, (opt.maxTokens || 0) * 2)}));
    throw err('empty_completion', {finish});
  }
  return {text, truncated: finish === 'MAX_TOKENS'};
}
/* 답을 JSON 하나로 받는다. 코드 블록 울타리나 앞뒤 잡글은 걷어 내고 읽는다 */
async function generateJson(prompt, opt){
  const res = await generate(prompt, Object.assign({}, opt, {json: true}));
  let t = res.text.trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if(a > 0 || b < t.length - 1) t = t.slice(Math.max(0, a), b >= 0 ? b + 1 : undefined);
  try{ return JSON.parse(t); }catch(e){ throw err('invalid_json', {text: res.text}); }
}
function errorText(e){
  const c = e && e.code;
  if(c === 'no_key') return 'AI 키가 아직 없습니다. 원고 목록 아래 톱니바퀴(설정) → 라이트닝에서 Gemini API 키를 넣어 주세요.';
  if(c === 'no_model') return '모델을 아직 고르지 않았습니다. 설정(톱니바퀴) → 라이트닝에서 모델을 골라 주세요.';
  if(c === 'auth') return 'AI 키가 맞지 않거나 쓸 수 없습니다. 설정(톱니바퀴) → 라이트닝에서 키를 확인해 주세요.';
  if(c === 'rate_limited') return '무료 사용량 한도에 닿았습니다 (분당 또는 하루). 잠시 뒤 다시 누르거나, 설정(톱니바퀴) → 라이트닝에서 하루 한도가 넉넉한 Flash-Lite 모델로 바꿔 보세요.';
  if(c === 'model') return '이 모델을 지금 쓸 수 없습니다. 설정(톱니바퀴) → 라이트닝에서 목록을 새로 받아 다른 모델을 골라 주세요.';
  if(c === 'refused') return 'AI가 이 대목은 쓰지 않겠다고 했습니다. 앞 글을 조금 바꿔 다시 해 보세요.';
  if(c === 'empty_completion') return '답이 비어 있었습니다' + (e.finish ? ' (' + e.finish + ')' : '') + '. 다시 눌러 주세요. 계속 이러면 설정(톱니바퀴) → 라이트닝에서 다른 모델을 골라 보세요.';
  if(c === 'prompt_too_large') return '보낼 글이 너무 깁니다. 고른 부분만 정리해 보세요.';
  if(c === 'invalid_json') return '답을 읽지 못했습니다. 다시 눌러 주세요.';
  if(c === 'busy') return 'AI 서버가 붐빕니다. 잠시 뒤 다시 눌러 주세요.';
  if(c === 'network') return '인터넷에 연결되어 있지 않거나 연결이 끊겼습니다. 다시 눌러 주세요.';
  if(c === 'cancelled') return '멈췄습니다.';
  if(c === 'timeout') return '답이 너무 오래 오지 않아 멈췄습니다. 다시 눌러 보고, 계속 이러면 설정(톱니바퀴) → 라이트닝에서 번개 속도를 「빠르게」로 하거나 다른 Flash-Lite 모델로 바꿔 보세요.';
  return 'AI를 부르지 못했습니다' + (e && e.status ? ' (' + e.status + ')' : '') + '. 다시 눌러 주세요.';
}
window.__ai = {
  hasKey: () => !!key(), key, setKey: v => lsSet('key', String(v || '').trim()),
  model, setModel: v => lsSet('model', String(v || '').trim()),
  models: () => lsGet('models', []), setModels: v => lsSet('models', Array.isArray(v) ? v : []),
  info, pickModel, listModels, generate, generateJson, errorText
};
})();
