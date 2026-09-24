// État persistant : contenu (publié ou brouillon), profils, progression, réglages.
import { todayKey, weekKey } from './util.js';

const K = { profiles: 'ar.profiles', settings: 'ar.settings', draft: 'ar.draft', current: 'ar.current', gh: 'ar.github', pin: 'ar.pin' };

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn('stockage impossible', e); }
}

export const DEFAULT_SETTINGS = {
  voiceURI: '', rate: 0.85, hearts: true, dailyGoal: 20, mic: true, sounds: true,
  unlockAll: false, speakTn: true, showLat: true, karaoke: true,
};

export const store = {
  content: null, published: null, usingDraft: false,
  profiles: load(K.profiles, []),
  settings: { ...DEFAULT_SETTINGS, ...load(K.settings, {}) },
  currentId: load(K.current, null),

  async loadContent() {
    let pub = null;
    try {
      const r = await fetch('content.json', { cache: 'no-cache' });
      if (r.ok) pub = await r.json();
    } catch (e) { console.warn('content.json hors ligne', e); }
    this.published = pub;
    const draft = load(K.draft, null);
    this.usingDraft = !!draft;
    this.content = draft || pub;
    if (!this.content) throw new Error('Contenu introuvable');
    return this.content;
  },
  saveDraft(c) { this.content = c; this.usingDraft = true; c.updatedAt = new Date().toISOString().slice(0, 10); save(K.draft, c); },
  dropDraft() { localStorage.removeItem(K.draft); this.usingDraft = false; this.content = this.published; },
  markPublished(c) { localStorage.removeItem(K.draft); this.usingDraft = false; this.published = c; this.content = c; },

  get github() { return load(K.gh, { owner: '', repo: '', branch: 'main', path: 'content.json', token: '' }); },
  set github(v) { save(K.gh, v); },
  get pinHash() { return load(K.pin, null); },
  set pinHash(v) { save(K.pin, v); },

  saveSettings() { save(K.settings, this.settings); },

  /* ---------- profils ---------- */
  get me() { return this.profiles.find(p => p.id === this.currentId) || null; },
  select(id) { this.currentId = id; save(K.current, id); },
  addProfile(name, avatar, color) {
    const p = { id: 'p' + Date.now().toString(36), name, avatar, color, xp: 0, days: {}, weeks: {},
      hearts: 5, heartsTs: Date.now(), done: {}, words: {}, freezes: 2, freezeWeek: weekKey(), frozen: {}, checks: {}, created: todayKey() };
    this.profiles.push(p); this.persist(); return p;
  },
  removeProfile(id) { this.profiles = this.profiles.filter(p => p.id !== id); if (this.currentId === id) this.currentId = null; this.persist(); },
  resetProfile(p) { Object.assign(p, { xp: 0, days: {}, weeks: {}, hearts: 5, done: {}, words: {}, frozen: {}, checks: {} }); this.persist(); },
  persist() { save(K.profiles, this.profiles); },

  /* ---------- cœurs ---------- */
  hearts(p = this.me) {
    if (!this.settings.hearts) return Infinity;
    const REFILL = 30 * 60e3;
    if (p.hearts < 5) {
      const gained = Math.floor((Date.now() - p.heartsTs) / REFILL);
      if (gained > 0) { p.hearts = Math.min(5, p.hearts + gained); p.heartsTs += gained * REFILL; this.persist(); }
    } else p.heartsTs = Date.now();
    return p.hearts;
  },
  loseHeart(p = this.me) {
    if (!this.settings.hearts) return;
    if (p.hearts >= 5) p.heartsTs = Date.now();
    p.hearts = Math.max(0, p.hearts - 1); this.persist();
  },
  gainHeart(p = this.me) { p.hearts = Math.min(5, p.hearts + 1); this.persist(); },
  nextHeartIn(p = this.me) { return Math.max(0, 30 * 60e3 - (Date.now() - p.heartsTs)); },

  /* ---------- XP, série ---------- */
  addXp(n, p = this.me) {
    const d = todayKey(), w = weekKey();
    p.xp += n; p.days[d] = (p.days[d] || 0) + n; p.weeks[w] = (p.weeks[w] || 0) + n;
    this.persist();
  },
  todayXp(p = this.me) { return p.days[todayKey()] || 0; },
  weekXp(p, w = weekKey()) { return p.weeks?.[w] || 0; },

  /** Série de jours : un jour compte s'il y a de l'XP ; un jour manqué consomme un gel (2 par semaine). */
  streak(p = this.me) {
    if (p.freezeWeek !== weekKey()) { p.freezes = 2; p.freezeWeek = weekKey(); this.persist(); }
    const d = new Date(); let n = 0;
    if (!p.days[todayKey(d)]) d.setDate(d.getDate() - 1); // la série d'hier tient encore aujourd'hui
    for (let i = 0; i < 1000; i++) {
      const k = todayKey(d);
      if (p.days[k]) n++;
      else if (p.frozen[k]) { /* jour gelé : ne casse pas, ne compte pas */ }
      else if (n > 0 && p.freezes > 0 && this.isPast(k) && this.recent(k) && p.days[this.prevDay(k)]) {
        p.frozen[k] = true; p.freezes--; this.persist();
      }
      else break;
      d.setDate(d.getDate() - 1);
      if (k < (p.created || '2000-01-01')) break;
    }
    return n;
  },
  isPast(k) { return k < todayKey(); },
  prevDay(k) { const d = new Date(k + 'T12:00:00'); d.setDate(d.getDate() - 1); return todayKey(d); },
  recent(k) { const y = new Date(); y.setDate(y.getDate() - 2); return k >= todayKey(y); },

  /* ---------- mots (répétition espacée simple) ---------- */
  word(id, p = this.me) { return p.words[id] || (p.words[id] = { s: 0, n: 0, t: 0 }); },
  mark(id, ok, p = this.me) {
    const w = this.word(id, p); w.n++; w.t = Date.now();
    w.s = Math.max(0, Math.min(5, w.s + (ok ? 1 : -1)));
  },

  /* ---------- nœuds ---------- */
  isDone(nodeId, p = this.me) { return !!p.done[nodeId]; },
  complete(nodeId, p = this.me) {
    const d = p.done[nodeId] || { n: 0, at: 0 };
    d.n++; d.at = Date.now(); p.done[nodeId] = d; this.persist();
  },
};
