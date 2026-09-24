// Parcours (nœuds), génération des séances et exercices façon « petites bouchées ».
import { esc, h, shuffle, pick, sample, arLetters, tokensAr, tokensFr, normAr, normFr, similarity, mascot, sfx, ask, arWrap } from './util.js';
import { store } from './store.js';
import { tts, stt } from './tts.js';

/* =========================================================
   1. LE PARCOURS
   ========================================================= */
const NODE_ICON = { learn: '⭐', tn: '🇹🇳', dialogue: '💬', defi: '🎁', review: '🏆', checklist: '✅' };
const NODE_LABEL = { learn: 'Nouveaux mots', tn: 'Parle tunisien', dialogue: 'Dialogue', defi: 'Défi de la semaine', review: "Révision de l'unité", checklist: 'Auto-évaluation' };

export function unitNodes(unit) {
  const nodes = [];
  const v = unit.vocab || [];
  if (v.length) {
    const n = Math.max(1, Math.ceil(v.length / 5));
    const size = Math.ceil(v.length / n);
    for (let i = 0; i < n; i++) {
      nodes.push({ id: `${unit.id}-learn${i + 1}`, type: 'learn', part: i + 1, of: n, words: v.slice(i * size, (i + 1) * size), before: v.slice(0, i * size) });
    }
    if (v.some(w => w.tnLat)) nodes.push({ id: `${unit.id}-tn`, type: 'tn' });
    if (unit.dialogue?.length) nodes.push({ id: `${unit.id}-dialogue`, type: 'dialogue', lines: unit.dialogue });
    if (unit.defi) nodes.push({ id: `${unit.id}-defi`, type: 'defi' });
    nodes.push({ id: `${unit.id}-review`, type: 'review' });
  } else {
    const d = unit.dialogue || [];
    const half = Math.ceil(d.length / 2);
    if (d.length) nodes.push({ id: `${unit.id}-conv1`, type: 'dialogue', part: 1, lines: d.slice(0, half) });
    if (d.length > half) nodes.push({ id: `${unit.id}-conv2`, type: 'dialogue', part: 2, lines: d.slice(half) });
    nodes.push({ id: `${unit.id}-global`, type: 'review', global: true });
    if (unit.checklist?.length) nodes.push({ id: `${unit.id}-checklist`, type: 'checklist' });
    if (unit.defi) nodes.push({ id: `${unit.id}-defi`, type: 'defi' });
  }
  nodes.forEach(nd => { nd.unit = unit; nd.icon = NODE_ICON[nd.type]; nd.label = NODE_LABEL[nd.type] + (nd.part && nd.of > 1 ? ` ${nd.part}/${nd.of}` : nd.part && nd.type === 'dialogue' && !unit.vocab?.length ? ` ${nd.part}` : ''); });
  return nodes;
}

export function allNodes(content) { return content.units.flatMap(unitNodes); }

export function nodeState(content, p = store.me) {
  const list = allNodes(content);
  let current = null;
  const state = {};
  for (const nd of list) {
    if (store.isDone(nd.id, p)) state[nd.id] = 'done';
    else if (!current) { current = nd.id; state[nd.id] = 'current'; }
    else state[nd.id] = store.settings.unlockAll ? 'open' : 'locked';
  }
  return { list, state, current };
}

export function nodeXp(nd) { return { learn: 10, tn: 10, dialogue: 10, review: 15, defi: 20, checklist: 20 }[nd.type] || 10; }

/* =========================================================
   2. GÉNÉRATION DES EXERCICES
   ========================================================= */
const allWords = c => c.units.flatMap(u => u.vocab || []);
const single = w => w.ar && !/[\s/]/.test(w.ar.trim()) && !w.ar.startsWith('ـ') && !/\.\.\./.test(w.ar);

function distract(w, pool, key, n) {
  const seen = new Set([norm(key, w[key])]);
  const out = [];
  for (const x of shuffle(pool)) {
    if (!x[key]) continue;
    const k = norm(key, x[key]);
    if (seen.has(k)) continue;
    seen.add(k); out.push(x);
    if (out.length >= n) break;
  }
  return out;
}
const norm = (key, v) => (key === 'ar' || key === 'tn' ? normAr(v) : normFr(v));

function widen(pool, content, min = 6) {
  if (pool.length >= min) return pool;
  return [...pool, ...sample(allWords(content).filter(x => !pool.includes(x)), min - pool.length)];
}

const X = {
  intro: w => ({ type: 'intro', w, words: [w] }),
  pickAr: (w, pool) => {
    const ds = distract(w, pool, 'ar', 3);
    const opts = shuffle([w, ...ds]);
    const pic = opts.every(o => o.emoji) && new Set(opts.map(o => o.emoji)).size === opts.length;
    return { type: 'pickAr', w, opts: pic ? opts : opts.slice(0, 3).includes(w) ? opts.slice(0, 3) : shuffle([w, ...ds.slice(0, 2)]), pic, words: [w] };
  },
  pickFr: (w, pool) => ({ type: 'pickFr', w, opts: shuffle([w, ...distract(w, pool, 'fr', 3)]), words: [w] }),
  listen: (w, pool) => ({ type: 'listen', w, opts: shuffle([w, ...distract(w, pool, 'ar', 3)]), words: [w] }),
  read: (w, pool) => ({ type: 'read', w, opts: shuffle([w, ...distract(w, pool, 'lat', 3)]), words: [w] }),
  tn2std: (w, pool) => w.tnLat ? ({ type: 'tn2std', w, opts: shuffle([w, ...distract(w, pool.filter(x => x.tnLat), 'ar', 3)]), words: [w] }) : null,
  std2tn: (w, pool) => w.tnLat ? ({ type: 'std2tn', w, opts: shuffle([w, ...distract(w, pool.filter(x => x.tnLat), 'tnLat', 3)]), words: [w] }) : null,
  match: ws => ws.length >= 3 ? ({ type: 'match', pairs: ws.slice(0, 5), words: ws.slice(0, 5) }) : null,
  matchTn: ws => { ws = ws.filter(w => w.tnLat); return ws.length >= 3 ? ({ type: 'matchTn', pairs: ws.slice(0, 5), words: ws.slice(0, 5) }) : null; },
  spell: (w, pool) => {
    if (!single(w)) return null;
    const letters = arLetters(w.ar.replace(/[؟?!.]/g, '').trim());
    if (letters.length < 2 || letters.length > 8) return null;
    const extra = shuffle(pool.filter(x => x !== w && single(x)).flatMap(x => arLetters(x.ar)))
      .filter(l => !letters.includes(l)).slice(0, letters.length > 5 ? 2 : 3);
    return { type: 'spell', w, letters, bank: shuffle([...letters, ...extra]), words: [w] };
  },
  speak: w => (store.settings.mic && stt.supported && !X._micOff) ? { type: 'speak', w, words: [w] } : null,
  buildAr: (line, lines) => {
    const ans = tokensAr(line.ar);
    const other = [...new Set(lines.filter(l => l !== line).flatMap(l => tokensAr(l.ar)))].filter(t => !ans.some(a => normAr(a) === normAr(t)));
    return { type: 'buildAr', line, ans, bank: shuffle([...ans, ...sample(other, ans.length > 6 ? 2 : 3)]) };
  },
  listenBuild: (line, lines) => ({ ...X.buildAr(line, lines), type: 'listenBuild' }),
  buildFr: (line, lines) => {
    const ans = tokensFr(line.fr);
    const other = [...new Set(lines.filter(l => l !== line).flatMap(l => tokensFr(l.fr)))].filter(t => !ans.some(a => normFr(a) === normFr(t)));
    return { type: 'buildFr', line, ans, bank: shuffle([...ans, ...sample(other, 3)]) };
  },
  fill: (line, lines) => {
    const toks = tokensAr(line.ar);
    const idx = shuffle(toks.map((t, i) => i).filter(i => normAr(toks[i]).length >= 3))[0];
    if (idx === undefined) return null;
    const other = [...new Set(lines.filter(l => l !== line).flatMap(l => tokensAr(l.ar)))].filter(t => normAr(t) !== normAr(toks[idx]) && normAr(t).length >= 2);
    if (other.length < 2) return null;
    return { type: 'fill', line, toks, idx, opts: shuffle([toks[idx], ...sample(other, 2)]) };
  },
  tnLine: (line, lines) => {
    if (!line.tnLat) return null;
    const others = shuffle(lines.filter(l => l !== line && l.fr !== line.fr)).slice(0, 2);
    if (others.length < 2) return null;
    return { type: 'tnLine', line, opts: shuffle([line, ...others]) };
  },
};

const tryAll = (...fs) => { for (const f of fs) { const r = f(); if (r) return r; } return null; };

export function buildSession(nd, content, opts = {}) {
  const unit = nd?.unit;
  const out = [];
  const push = e => e && out.push(e);
  const weak = ws => [...ws].sort((a, b) => store.word(a.id).s - store.word(b.id).s || store.word(a.id).t - store.word(b.id).t);

  if (opts.practice) {
    const words = weak(opts.pool).slice(0, 8);
    const pool = widen(opts.pool, content);
    push(X.match(shuffle(words).slice(0, 5)));
    words.forEach((w, i) => push(tryAll(
      () => [X.listen, X.spell, X.pickFr, X.tn2std, X.read, X.pickAr][i % 6](w, pool), () => X.pickFr(w, pool))));
    push(X.speak(pick(words)));
    return out;
  }

  if (nd.type === 'learn') {
    const pool = widen(unit.vocab, content);
    const news = nd.words, olds = nd.before;
    news.forEach(w => { push(X.intro(w)); push(pick([X.pickAr, X.pickFr])(w, pool)); });
    push(X.match(shuffle([...news, ...sample(olds, Math.max(0, 5 - news.length))])));
    shuffle(news).forEach((w, i) => push(tryAll(() => [X.listen, X.read, X.spell, X.tn2std][i % 4](w, pool), () => X.listen(w, pool))));
    sample(olds, 2).forEach(w => push(pick([X.pickFr, X.listen, X.spell])(w, pool) || X.pickFr(w, pool)));
    push(X.speak(pick(news)));
    return out;
  }
  if (nd.type === 'tn') {
    const tnw = unit.vocab.filter(w => w.tnLat);
    const pool = widen(tnw, content);
    push(X.matchTn(shuffle(tnw)));
    sample(tnw, 6).forEach((w, i) => push(i % 2 ? X.std2tn(w, pool) : X.tn2std(w, pool)));
    const lines = unit.dialogue || [];
    sample(lines, 2).forEach(l => push(X.tnLine(l, lines)));
    push(X.matchTn(sample(tnw, 5)));
    return out;
  }
  if (nd.type === 'dialogue') {
    const lines = nd.lines, all = unit.dialogue;
    const makers = [X.buildAr, X.listenBuild, X.buildFr];
    lines.forEach((l, i) => push(makers[i % 3](l, all)));
    sample(lines, 2).forEach(l => push(X.fill(l, all)));
    sample(lines, 2).forEach(l => push(X.tnLine(l, all)));
    push(X.speak({ id: null, ar: pick(lines.filter(l => tokensAr(l.ar).length <= 5).length ? lines.filter(l => tokensAr(l.ar).length <= 5) : lines).ar }));
    return out;
  }
  if (nd.type === 'review') {
    const src = nd.global ? allWords(content) : unit.vocab;
    const words = nd.global ? sample(src, 12) : weak(src).slice(0, 10);
    const pool = widen(src, content);
    push(X.match(sample(words, 5)));
    words.forEach((w, i) => push(tryAll(() => [X.listen, X.spell, X.std2tn, X.pickAr, X.read, X.tn2std][i % 6](w, pool), () => X.pickFr(w, pool))));
    const lines = nd.global ? content.units.flatMap(u => u.dialogue || []) : (unit.dialogue || []);
    if (lines.length > 2) sample(lines, 2).forEach((l, i) => push(i ? X.listenBuild(l, lines) : X.buildAr(l, lines)));
    push(X.matchTn(sample(words, 5)));
    push(X.speak(pick(words)));
    return out;
  }
  return out;
}

/* =========================================================
   3. RENDU DES EXERCICES
   ========================================================= */
const spk = (text, cls = '') => `<button class="speak ${cls}" data-say="${esc(text)}" aria-label="Écouter">${cls.includes('slow') ? '🐢' : '🔊'}</button>`;
const arSpan = (s, cls = '') => `<span class="ar ${cls}">${esc(s)}</span>`;
const LAT = w => store.settings.showLat && w.lat ? `<div class="lat">${esc(w.lat)}</div>` : '';

function bindSpeak(el) {
  el.querySelectorAll('[data-say]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); tts.speak(b.dataset.say, { slow: b.classList.contains('slow') });
  }));
}

/** Chaque rendu renvoie { el, check?() → {ok, sol}, auto?: true } et appelle ready(bool). */
const R = {
  intro(ex, ready) {
    const w = ex.w;
    const el = h(`<div><h1>Nouveau mot</h1><div class="card-intro">
      ${w.emoji ? `<div class="emo">${w.emoji}</div>` : ''}
      <div class="ar">${esc(w.ar)}</div>${w.lat ? `<div class="lat" style="font-size:20px">${esc(w.lat)}</div>` : ''}
      <div class="fr" style="margin-top:10px">${esc(w.fr)}</div>
      <div class="bigspeak" style="margin:16px 0 0">${spk(w.ar)}${spk(w.ar, 'slow')}</div>
      ${w.tnLat || w.tn ? `<div class="tnbox"><span class="flag">🇹🇳</span><div><b>En tunisien</b><br>${w.tn ? arSpan(w.tn) : ''} ${w.tnLat ? `<span class="lat">${esc(w.tnLat)}</span>` : ''}</div>${w.tn && store.settings.speakTn ? spk(w.tn) : ''}</div>` : ''}
      ${w.note ? `<div class="note-hint muted">${arWrap(esc(w.note))}</div>` : ''}
    </div></div>`);
    bindSpeak(el); setTimeout(() => tts.speak(w.ar), 250); ready(true, 'Continuer');
    return { el, check: () => ({ ok: true, silent: true }) };
  },

  pickAr(ex, ready) {
    const el = h(`<div><h1>Lequel veut dire « ${esc(ex.w.fr)} » ?</h1>
      <div class="choices ${ex.pic ? 'grid' : ''}">${ex.opts.map((o, i) => ex.pic
        ? `<button class="choice pic" data-i="${i}"><span class="emo">${o.emoji}</span>${arSpan(o.ar)}</button>`
        : `<button class="choice" data-i="${i}"><span class="k">${i + 1}</span>${arSpan(o.ar)}</button>`).join('')}</div></div>`);
    return choiceLogic(el, ex, ready, o => o === ex.w, o => tts.speak(o.ar));
  },

  pickFr(ex, ready) {
    const w = ex.w;
    const el = h(`<div><h1>Que veut dire ce mot ?</h1>
      <div class="prompt">${mascot('wow')}<div class="bubble">${spk(w.ar)}${arSpan(w.ar)}</div></div>
      <div class="choices">${ex.opts.map((o, i) => `<button class="choice" data-i="${i}"><span class="k">${i + 1}</span>${esc(o.fr)}</button>`).join('')}</div></div>`);
    bindSpeak(el); setTimeout(() => tts.speak(w.ar), 250);
    return choiceLogic(el, ex, ready, o => o === w);
  },

  listen(ex, ready) {
    const w = ex.w;
    const el = h(`<div><h1>Écoute et choisis ce que tu entends</h1>
      <div class="bigspeak">${spk(w.ar)}${spk(w.ar, 'slow')}</div>
      <div class="choices grid">${ex.opts.map((o, i) => `<button class="choice" data-i="${i}">${arSpan(o.ar)}</button>`).join('')}</div></div>`);
    bindSpeak(el); setTimeout(() => tts.speak(w.ar), 300);
    return choiceLogic(el, ex, ready, o => o === w);
  },

  read(ex, ready) {
    const w = ex.w;
    const el = h(`<div><h1>Comment ça se lit ?</h1>
      <div class="prompt">${mascot('wow')}<div class="bubble">${arSpan(w.ar)}</div></div>
      <div class="choices grid">${ex.opts.map((o, i) => `<button class="choice" data-i="${i}" style="justify-content:center">${esc(o.lat)}</button>`).join('')}</div></div>`);
    return choiceLogic(el, ex, ready, o => o === w, null, () => tts.speak(w.ar));
  },

  tn2std(ex, ready) {
    const w = ex.w;
    const el = h(`<div><h1>Papa dit en tunisien… et en arabe standard ?</h1>
      <div class="prompt">${mascot('happy')}<div class="bubble">🇹🇳 <b>${esc(w.tnLat)}</b>${w.tn ? ' ' + arSpan(w.tn) : ''}</div></div>
      <div class="choices grid">${ex.opts.map((o, i) => `<button class="choice" data-i="${i}">${arSpan(o.ar)}</button>`).join('')}</div></div>`);
    if (store.settings.speakTn && w.tn) setTimeout(() => tts.speak(w.tn), 250);
    return choiceLogic(el, ex, ready, o => o === w, o => tts.speak(o.ar));
  },

  std2tn(ex, ready) {
    const w = ex.w;
    const el = h(`<div><h1>Comment on le dit à la maison, en tunisien ?</h1>
      <div class="prompt">${mascot('wow')}<div class="bubble">${spk(w.ar)}${arSpan(w.ar)}<small class="muted">(${esc(w.fr)})</small></div></div>
      <div class="choices grid">${ex.opts.map((o, i) => `<button class="choice" data-i="${i}" style="justify-content:center">🇹🇳 ${esc(o.tnLat)}</button>`).join('')}</div></div>`);
    bindSpeak(el);
    return choiceLogic(el, ex, ready, o => o === w, null, null, 'tn');
  },

  match(ex, ready, api, tn = false) {
    const L = shuffle(ex.pairs), Rr = shuffle(ex.pairs);
    const right = w => tn ? `🇹🇳 ${esc(w.tnLat)}` : esc(w.fr);
    const el = h(`<div><h1>${tn ? 'Associe le standard et le tunisien' : 'Associe les paires'}</h1>
      <div class="pairs"><div class="col">${L.map(w => `<button class="choice" data-side="l" data-id="${esc(w.id)}">${arSpan(w.ar)}</button>`).join('')}</div>
      <div class="col">${Rr.map(w => `<button class="choice" data-side="r" data-id="${esc(w.id)}">${right(w)}</button>`).join('')}</div></div></div>`);
    let sel = null, left = ex.pairs.length;
    el.querySelectorAll('.choice').forEach(b => b.addEventListener('click', () => {
      if (b.classList.contains('gone')) return;
      if (b.dataset.side === 'l') tts.speak(ex.pairs.find(w => w.id === b.dataset.id).ar);
      if (!sel || sel.dataset.side === b.dataset.side) {
        el.querySelectorAll(`.choice[data-side="${b.dataset.side}"]`).forEach(x => x.classList.remove('sel'));
        b.classList.add('sel'); sel = b; return;
      }
      if (sel.dataset.id === b.dataset.id) {
        sfx.tap(); [sel, b].forEach(x => { x.classList.remove('sel'); x.classList.add('ok'); setTimeout(() => x.classList.add('gone'), 250); });
        store.mark(b.dataset.id, true); sel = null;
        if (--left === 0) setTimeout(() => api.autoDone(), 450);
      } else {
        sfx.bad(); const a = sel; [a, b].forEach(x => { x.classList.remove('sel'); x.classList.add('bad'); setTimeout(() => x.classList.remove('bad'), 450); });
        store.mark(b.dataset.id, false); api.mistakeNoHeart(); sel = null;
      }
    }));
    ready(false);
    return { el, auto: true };
  },
  matchTn(ex, ready, api) { return R.match(ex, ready, api, true); },

  spell(ex, ready) {
    const w = ex.w;
    const el = h(`<div><h1>Écris « ${esc(w.fr)} » en arabe</h1>
      <div class="bigspeak" style="margin:0 0 10px">${spk(w.ar)}</div>
      <div class="spelled"></div><div class="bank rtl">${ex.bank.map((l, i) => `<button class="tile ar" data-i="${i}">${esc(l)}</button>`).join('')}</div></div>`);
    bindSpeak(el);
    const picked = [];
    const out = el.querySelector('.spelled');
    const draw = () => { out.textContent = picked.map(i => ex.bank[i]).join(''); ready(picked.length > 0); };
    el.querySelectorAll('.tile').forEach(t => t.addEventListener('click', () => { sfx.tap(); picked.push(+t.dataset.i); t.classList.add('used'); draw(); }));
    out.addEventListener('click', () => { const i = picked.pop(); if (i !== undefined) el.querySelector(`.tile[data-i="${i}"]`).classList.remove('used'); draw(); });
    ready(false);
    return { el, check: () => ({ ok: normAr(picked.map(i => ex.bank[i]).join('')) === normAr(ex.letters.join('')) && picked.map(i => ex.bank[i]).join('') === ex.letters.join(''), sol: arSpan(w.ar) }) };
  },

  speak(ex, ready, api) {
    const w = ex.w;
    const el = h(`<div><h1>Lis à voix haute</h1>
      <div class="prompt">${mascot('happy')}<div class="bubble">${spk(w.ar)}${arSpan(w.ar)}</div></div>
      <button class="mic" aria-label="Parler">🎤</button><p class="muted" style="text-align:center">Appuie sur le micro, puis lis la phrase.</p>
      <div style="text-align:center;margin-top:10px"><button class="link" data-skip>Je ne peux pas parler maintenant</button></div></div>`);
    bindSpeak(el);
    let heard = null;
    const mic = el.querySelector('.mic');
    mic.addEventListener('click', async () => {
      mic.classList.add('on');
      try {
        const alts = await stt.listen('ar-SA');
        const target = normAr(w.ar);
        heard = alts.length ? Math.max(...alts.map(a => similarity(normAr(a), target))) : 0;
        el.querySelector('p').textContent = alts[0] ? `J'ai entendu : ${alts[0]}` : "Je n'ai rien entendu, réessaie.";
        ready(alts.length > 0);
      } catch (e) { el.querySelector('p').textContent = 'Micro indisponible (' + e + ').'; }
      mic.classList.remove('on');
    });
    el.querySelector('[data-skip]').addEventListener('click', () => { X._micOff = true; setTimeout(() => X._micOff = false, 15 * 60e3); api.skip(); });
    ready(false);
    return { el, check: () => ({ ok: heard >= 0.6, noHeart: true, sol: arSpan(w.ar) }) };
  },

  buildAr(ex, ready, api, mode = 'fr') {
    const line = ex.line;
    const head = mode === 'listen'
      ? `<h1>Écris ce que tu entends</h1><div class="bigspeak">${spk(line.ar)}${spk(line.ar, 'slow')}</div>`
      : `<h1>Traduis cette phrase</h1><div class="prompt">${mascot('happy')}<div class="bubble">${esc(line.fr)}</div></div>`;
    return tiles(h(`<div>${head}</div>`), ex, ready, true, mode === 'listen' ? () => tts.speak(line.ar) : null);
  },
  listenBuild(ex, ready, api) { return R.buildAr(ex, ready, api, 'listen'); },
  buildFr(ex, ready) {
    const line = ex.line;
    const el = h(`<div><h1>Traduis cette phrase</h1><div class="prompt">${mascot('wow')}<div class="bubble">${spk(line.ar)}${arSpan(line.ar)}</div></div></div>`);
    setTimeout(() => tts.speak(line.ar), 250);
    return tiles(el, ex, ready, false);
  },

  fill(ex, ready) {
    const shown = ex.toks.map((t, i) => i === ex.idx ? '<span class="gap">&nbsp;</span>' : esc(t)).join(' ');
    const el = h(`<div><h1>Complète la phrase</h1><div class="blankline ar">${shown}</div>
      <p class="muted" style="text-align:center;margin-top:-12px">${esc(ex.line.fr)}</p>
      <div class="choices grid">${ex.opts.map((o, i) => `<button class="choice" data-i="${i}">${arSpan(o)}</button>`).join('')}</div></div>`);
    const res = choiceLogic(el, { opts: ex.opts }, ready, o => normAr(o) === normAr(ex.toks[ex.idx]), o => { el.querySelector('.gap').textContent = o; });
    const inner = res.check;
    res.check = () => ({ ...inner(), sol: arSpan(ex.line.ar) });
    return res;
  },

  tnLine(ex, ready) {
    const el = h(`<div><h1>Papa te dit ça en tunisien. Ça veut dire ?</h1>
      <div class="prompt">${mascot('happy')}<div class="bubble">🇹🇳 <b>${esc(ex.line.tnLat)}</b></div></div>
      <div class="choices">${ex.opts.map((o, i) => `<button class="choice" data-i="${i}"><span class="k">${i + 1}</span>${esc(o.fr)}</button>`).join('')}</div></div>`);
    return choiceLogic(el, ex, ready, o => o === ex.line, null, null, 'fr');
  },
};

function choiceLogic(el, ex, ready, isRight, onTap, afterCheck, solKey) {
  let chosen = null;
  bindSpeak(el);
  el.querySelectorAll('.choice').forEach(b => b.addEventListener('click', () => {
    el.querySelectorAll('.choice').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel'); chosen = ex.opts[+b.dataset.i]; sfx.tap(); onTap && onTap(chosen); ready(true);
  }));
  ready(false);
  return {
    el,
    check() {
      const ok = isRight(chosen);
      const right = ex.opts.find(isRight);
      el.querySelectorAll('.choice').forEach((b, i) => { if (ex.opts[i] === chosen) b.classList.add(ok ? 'ok' : 'bad'); });
      afterCheck && afterCheck();
      let sol = '';
      if (typeof right === 'string') sol = arSpan(right);
      else if (right) sol = solKey === 'tn' ? `🇹🇳 ${esc(right.tnLat)}` : solKey === 'fr' ? esc(right.fr)
        : ex.type === 'pickFr' ? esc(right.fr) : ex.type === 'read' ? esc(right.lat) : `${arSpan(right.ar)} <span class="lat">${esc(right.lat || '')}</span>`;
      return { ok, sol };
    },
  };
}

function tiles(el, ex, ready, rtl, onMount) {
  const line = h(`<div class="answer-line ${rtl ? 'rtl' : ''}"></div>`);
  const bank = h(`<div class="bank ${rtl ? 'rtl' : ''}">${ex.bank.map((t, i) => `<button class="tile ${rtl ? 'ar' : ''}" data-i="${i}">${esc(t)}</button>`).join('')}</div>`);
  el.append(line, bank); bindSpeak(el);
  const picked = [];
  bank.querySelectorAll('.tile').forEach(t => t.addEventListener('click', () => {
    sfx.tap(); if (rtl) tts.speak(ex.bank[+t.dataset.i]);
    picked.push(+t.dataset.i); t.classList.add('used');
    const c = h(`<button class="tile ${rtl ? 'ar' : ''}" data-i="${t.dataset.i}">${esc(ex.bank[+t.dataset.i])}</button>`);
    c.addEventListener('click', () => { picked.splice(picked.indexOf(+c.dataset.i), 1); c.remove(); t.classList.remove('used'); ready(picked.length > 0); });
    line.append(c); ready(true);
  }));
  onMount && setTimeout(onMount, 300);
  ready(false);
  return {
    el,
    check() {
      const got = picked.map(i => ex.bank[i]);
      const ok = rtl ? normAr(got.join(' ')) === normAr(ex.ans.join(' ')) : normFr(got.join(' ')) === normFr(ex.ans.join(' '));
      return { ok, sol: rtl ? arSpan(ex.line.ar) : esc(ex.line.fr) };
    },
  };
}

/* =========================================================
   4. LA SÉANCE (file d'exercices, cœurs, combo, fin)
   ========================================================= */
export function runSession(exercises, { onEnd, practice = false }) {
  const root = h(`<div class="lesson">
    <div class="lesson-top"><button class="iconbtn" data-quit aria-label="Quitter">✕</button>
      <div class="bar"><i></i></div><div class="stat heart ${store.settings.hearts ? '' : 'hidden'}">❤️ <span></span></div></div>
    <div class="ex"></div>
    <div class="footer"><div class="in"><div class="fb"></div><button class="btn" data-go disabled>Vérifier</button></div></div></div>`);
  document.body.append(root);
  const exEl = root.querySelector('.ex'), bar = root.querySelector('.bar i'), foot = root.querySelector('.footer'),
    fb = root.querySelector('.fb'), go = root.querySelector('[data-go]'), heartEl = root.querySelector('.stat.heart span');
  const queue = [...exercises], total = exercises.length;
  const retried = new Set();
  let done = 0, mistakes = 0, combo = 0, bestCombo = 0, cur = null, phase = 'answer', startT = Date.now();

  const showHearts = () => { heartEl.textContent = store.hearts(); };
  showHearts();

  const api = {
    autoDone: () => { done++; next(); },
    mistakeNoHeart: () => { mistakes++; combo = 0; },
    skip: () => { done++; next(); },
  };

  function ready(ok, label) { if (phase === 'answer') { go.disabled = !ok; go.textContent = label || 'Vérifier'; } }

  function next() {
    bar.style.width = Math.min(100, (done / total) * 100) + '%';
    foot.className = 'footer'; fb.innerHTML = '';
    const ex = queue.shift();
    if (!ex) return finish(true);
    phase = 'answer'; go.disabled = true; go.textContent = 'Vérifier';
    cur = { ex, r: R[ex.type](ex, ready, api) };
    exEl.innerHTML = ''; exEl.append(cur.r.el); exEl.scrollTop = 0;
    foot.classList.toggle('hidden', !!cur.r.auto);
  }

  go.addEventListener('click', () => {
    if (phase === 'answer') {
      const res = cur.r.check();
      if (res.silent) { done++; return next(); }
      phase = 'feedback';
      (cur.ex.words || []).forEach(w => w.id && store.mark(w.id, res.ok));
      if (res.ok) {
        sfx.ok(); combo++; bestCombo = Math.max(bestCombo, combo); done++;
        foot.className = 'footer ok';
        const cheer = pick(['Bravo !', 'Excellent !', 'Parfait !', 'Super !', 'ممتاز !', 'Yaatik essa7a !']);
        fb.innerHTML = `<div class="ico">✅</div><div><h3>${arWrap(esc(cheer))}</h3>${combo >= 3 ? `<div class="muted">${combo} d'affilée 🔥</div>` : ''}</div>`;
        if ([5, 10, 15].includes(combo)) { const c = h(`<div class="combo">🔥 ${combo} bonnes réponses d'affilée !</div>`); root.append(c); setTimeout(() => c.remove(), 1400); }
      } else {
        sfx.bad(); combo = 0; mistakes++;
        if (!res.noHeart) { store.loseHeart(); showHearts(); }
        foot.className = 'footer bad';
        fb.innerHTML = `<div class="ico">❌</div><div><h3>${res.noHeart ? 'Presque !' : 'Bonne réponse :'}</h3><div class="sol">${res.sol || ''}</div></div>`;
        if (res.noHeart) done++;
        else if (!retried.has(cur.ex)) { retried.add(cur.ex); queue.push(cur.ex); } else done++;
      }
      go.disabled = false; go.textContent = 'Continuer';
      if (store.settings.hearts && store.hearts() <= 0 && !practice) return setTimeout(() => finish(false), 900);
    } else if (!ended) next();
  });

  root.querySelector('[data-quit]').addEventListener('click', async () => {
    if (await ask('Quitter la leçon ?', 'Tu vas perdre ta progression dans cette leçon.', { ok: 'Quitter', cancel: 'Continuer', danger: true })) { tts.stop(); root.remove(); onEnd && onEnd(null); }
  });

  let ended = false;
  function finish(success) {
    if (ended) return; ended = true;
    tts.stop(); root.remove();
    onEnd && onEnd({ success, mistakes, bestCombo, seconds: Math.round((Date.now() - startT) / 1000), total });
  }
  next();
}
