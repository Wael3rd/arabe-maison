// Synthèse vocale (Web Speech API) et reconnaissance vocale optionnelle.
import { store } from './store.js';
import { normAr } from './util.js';

/* ---------- karaoké : surligne chaque mot pendant la lecture ---------- */
const HIDE_IN = '.choice, .tile, .bank, .answer-line, .spelled, .blankline, input, textarea';
function findTarget(text) {
  const t = text.trim();
  const list = [...document.querySelectorAll('.ar')].filter(e =>
    !e.closest(HIDE_IN) && e.offsetParent !== null && (e.dataset.karaText ?? e.textContent).trim() === t);
  return list[list.length - 1] || null;
}

const kara = {
  el: null, spans: [], timers: [], idx: 0, t0: 0, est: 0,
  scale: (() => { try { return +localStorage.getItem('ar.karaScale') || 1; } catch { return 1; } })(),
  dur(span, rate) { return this.scale * (Math.max(1, normAr(span.textContent).length) * 85 + 140) / rate; },
  prepare(el) {
    if (el.dataset.karaText === undefined) el.dataset.karaText = el.textContent;
    const text = el.dataset.karaText;
    el.style.setProperty('--kc', getComputedStyle(el).color);
    el.textContent = '';
    this.spans = [];
    let pos = 0;
    for (const part of text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) el.append(part);
      else {
        const sp = document.createElement('span');
        sp.className = 'kw'; sp.textContent = part; sp.dataset.start = pos; sp.dataset.end = pos + part.length;
        el.append(sp); this.spans.push(sp);
      }
      pos += part.length;
    }
    el.classList.add('kara');
  },
  attach(u, el, text) {
    this.el = el; this.u = u; this.prepare(el);
    const mine = () => this.u === u;
    const rate = u.rate || 1;
    this.est = this.spans.reduce((a, sp) => a + this.dur(sp, rate), 0);
    const playFrom = i => {
      this.clearTimers();
      this.spans.forEach((sp, j) => { if (j < i) this.fill(sp, 0); });
      let t = 0;
      for (let j = i; j < this.spans.length; j++) {
        const sp = this.spans[j], d = this.dur(sp, rate);
        this.timers.push(setTimeout(() => { this.spans.forEach(x => x.classList.remove('cur')); this.fill(sp, d); this.idx = j; }, t));
        t += d;
      }
    };
    u.addEventListener('start', () => { if (!mine()) return; this.t0 = performance.now(); playFrom(0); });
    u.addEventListener('boundary', e => {
      if (!mine() || (e.name && e.name !== 'word')) return;
      const i = this.spans.findIndex(sp => e.charIndex >= +sp.dataset.start && e.charIndex < +sp.dataset.end);
      if (i > this.idx) playFrom(i);
    });
    u.addEventListener('end', () => {
      if (!mine()) return;
      const real = performance.now() - this.t0;
      if (this.t0 && this.est > 0 && real > 200) {
        this.scale = Math.min(3, Math.max(0.35, this.scale * (0.7 + 0.3 * real / this.est)));
        try { localStorage.setItem('ar.karaScale', this.scale.toFixed(3)); } catch {}
      }
      this.clearTimers(); this.spans.forEach(sp => { this.fill(sp, 120); sp.classList.remove('cur'); });
      const el0 = this.el;
      this.timers.push(setTimeout(() => { if (this.el === el0) this.reset(); }, 900));
    });
  },
  fill(sp, d) {
    sp.style.transitionDuration = Math.round(d) + 'ms';
    sp.classList.add('on');
    if (d > 0) sp.classList.add('cur');
    else sp.classList.remove('cur');
  },
  clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; },
  reset() {
    this.clearTimers();
    if (this.el) {
      const el = this.el;
      if (el.dataset.karaText !== undefined) el.textContent = el.dataset.karaText;
      el.classList.remove('kara');
    }
    this.el = null; this.u = null; this.spans = []; this.idx = 0; this.t0 = 0;
  },
};

const synth = window.speechSynthesis;
let voices = [];

function refresh() {
  voices = synth ? synth.getVoices() : [];
}
if (synth) {
  refresh();
  synth.addEventListener?.('voiceschanged', refresh);
}

export const tts = {
  get supported() { return !!synth; },
  arabicVoices() {
    refresh();
    return voices.filter(v => /^ar/i.test(v.lang));
  },
  voice() {
    const list = this.arabicVoices();
    return list.find(v => v.voiceURI === store.settings.voiceURI)
      || list.find(v => /ar[-_]SA/i.test(v.lang) && /google/i.test(v.name))
      || list.find(v => /ar[-_](SA|EG|AE)/i.test(v.lang))
      || list[0] || null;
  },
  /** Lit un texte arabe. slow = mode tortue. el = élément à surligner (karaoké), trouvé tout seul sinon. */
  speak(text, { slow = false, rate, el } = {}) {
    if (!synth || !text) return Promise.resolve();
    return new Promise(res => {
      try {
        synth.cancel();
        kara.reset();
        const u = new SpeechSynthesisUtterance(text.replace(/\.\.\./g, ''));
        const v = this.voice();
        if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'ar-SA';
        u.rate = rate ?? (slow ? 0.5 : store.settings.rate);
        const target = store.settings.karaoke !== false ? (el || findTarget(text)) : null;
        if (target) kara.attach(u, target, text);
        let done = false;
        const finish = () => { if (done) return; done = true; res(); };
        u.addEventListener('end', finish); u.addEventListener('error', () => { if (kara.u === u) kara.reset(); finish(); });
        synth.speak(u);
        setTimeout(finish, 15000);
      } catch (e) { console.warn(e); res(); }
    });
  },
  stop() { synth?.cancel(); kara.reset(); },
};

/* ---------- reconnaissance vocale (Chrome Android) ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const stt = {
  get supported() { return !!SR; },
  listen(lang = 'ar-TN') {
    return new Promise((resolve, reject) => {
      const r = new SR();
      r.lang = lang; r.interimResults = false; r.maxAlternatives = 5;
      let done = false;
      r.onresult = e => { done = true; resolve([...e.results[0]].map(a => a.transcript)); };
      r.onerror = e => { done = true; reject(e.error || e); };
      r.onend = () => { if (!done) resolve([]); };
      r.start();
      this.current = r;
    });
  },
  stop() { try { this.current?.stop(); } catch {} },
};
