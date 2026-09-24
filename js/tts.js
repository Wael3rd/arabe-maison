// Synthèse vocale (Web Speech API) et reconnaissance vocale optionnelle.
import { store } from './store.js';

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
  /** Lit un texte arabe. slow = mode tortue. */
  speak(text, { slow = false, rate } = {}) {
    if (!synth || !text) return Promise.resolve();
    return new Promise(res => {
      try {
        synth.cancel();
        const u = new SpeechSynthesisUtterance(text.replace(/\.\.\./g, ''));
        const v = this.voice();
        if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'ar-SA';
        u.rate = rate ?? (slow ? 0.5 : store.settings.rate);
        u.onend = u.onerror = () => res();
        synth.speak(u);
        setTimeout(res, 6000);
      } catch (e) { console.warn(e); res(); }
    });
  },
  stop() { synth?.cancel(); },
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
