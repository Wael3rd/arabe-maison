// Synchronisation de la progression entre appareils (tablette, téléphone...).
// La progression de tous les profils vit dans un fichier progression.json d'un dépôt GitHub
// privé. Chaque appareil fusionne sa version avec celle du dépôt, sans jamais perdre de progrès :
//  - XP, jours, semaines : compteurs par appareil, additionnés (pas de double comptage) ;
//  - étapes terminées, défis, cases cochées, jours gelés : union ;
//  - mots : la révision la plus récente l'emporte ; cœurs : le dernier changement l'emporte ;
//  - remise à zéro (rev) et suppression (gone) : propagées à tous les appareils.
import { store, normalizeProfile, zeroCounter } from './store.js';

const FILE = 'progression.json';
const KEY = { device: 'ar.device', synced: 'ar.syncedOnce', last: 'ar.lastSync' };
export const DEFAULT_PROG_REPO = 'arabe-maison-progression';

const ls = {
  get: (k, f = null) => { try { const v = localStorage.getItem(k); return v === null ? f : JSON.parse(v); } catch { return f; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

export const deviceId = (() => {
  let id = ls.get(KEY.device);
  if (!id) { id = 'd' + Math.random().toString(36).slice(2, 10); ls.set(KEY.device, id); }
  return id;
})();
const deviceName = () => /Mobile/i.test(navigator.userAgent) ? 'téléphone' : 'tablette';

export const cloud = {
  status: 'off',            // off | idle | syncing | ok | error
  error: '',
  last: ls.get(KEY.last, 0),
  onRemote: null,           // appelé quand la progression a changé grâce à un autre appareil
  onStatus: null,
  get enabled() { const g = store.github; return !!(g.owner && g.token && (g.progRepo ?? DEFAULT_PROG_REPO)); },
  repo() { const g = store.github; return `${g.owner}/${g.progRepo ?? DEFAULT_PROG_REPO}`; },
};

/* ---------------- API GitHub ---------------- */
function b64encode(str) {
  const bytes = new TextEncoder().encode(str); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b) { return new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, '')), c => c.charCodeAt(0))); }

async function api(method, path, body) {
  const r = await fetch(`https://api.github.com/repos/${cloud.repo()}${path}`, {
    method, cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${store.github.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.message || String(r.status)); e.status = r.status; throw e; }
  return j;
}

async function fetchDoc() {
  try {
    const f = await api('GET', `/contents/${FILE}?t=${Date.now()}`);
    return { doc: JSON.parse(b64decode(f.content)), sha: f.sha };
  } catch (e) {
    // 404 : fichier pas encore créé (ou dépôt vide)… ou dépôt inaccessible, qu'on distingue ici.
    if (e.status === 404 && await repoExists()) return { doc: null, sha: null };
    throw e;
  }
}
async function repoExists() { try { await api('GET', ''); return true; } catch { return false; } }

/* ---------------- fusion ---------------- */
const maxMap = (a = {}, b = {}) => { const o = { ...a }; for (const k in b) o[k] = Math.max(o[k] || 0, b[k] || 0); return o; };
const maxCounter = (a, b) => ({ xp: Math.max(a?.xp || 0, b?.xp || 0), days: maxMap(a?.days, b?.days), weeks: maxMap(a?.weeks, b?.weeks) });
const clone = o => JSON.parse(JSON.stringify(o));

function recompute(p) {
  const all = [p.mine, ...Object.entries(p.dev).filter(([d]) => d !== deviceId).map(([, c]) => c)];
  p.xp = 0; p.days = {}; p.weeks = {};
  for (const c of all) {
    p.xp += c.xp || 0;
    for (const k in c.days) p.days[k] = (p.days[k] || 0) + c.days[k];
    for (const k in c.weeks) p.weeks[k] = (p.weeks[k] || 0) + c.weeks[k];
  }
}

/** Profil local à partir de sa version distante. */
function fromRemote(r) {
  const p = normalizeProfile(clone(r));
  p.mine = maxCounter(zeroCounter(), r.dev?.[deviceId]);
  p.dev = clone(r.dev || {}); delete p.dev[deviceId];
  recompute(p);
  return p;
}

/** Fusionne la version distante r dans le profil local p (modifié sur place). */
function mergeInto(p, r) {
  if ((r.rev || 0) > (p.rev || 0)) {               // remis à zéro sur un autre appareil
    const keep = { id: p.id };
    for (const k of Object.keys(p)) delete p[k];
    Object.assign(p, fromRemote(r), keep);
    return;
  }
  if ((p.rev || 0) > (r.rev || 0)) return;          // remis à zéro ici : notre version fait foi
  if ((r.imt || 0) > (p.imt || 0)) Object.assign(p, { name: r.name, avatar: r.avatar, color: r.color, imt: r.imt });
  if (r.created && (!p.created || r.created < p.created)) p.created = r.created;
  for (const [d, c] of Object.entries(r.dev || {})) {
    if (d === deviceId) p.mine = maxCounter(p.mine, c);
    else p.dev[d] = maxCounter(p.dev[d], c);
  }
  recompute(p);
  for (const [id, d] of Object.entries(r.done || {})) {
    const l = p.done[id];
    p.done[id] = l ? { n: Math.max(l.n || 0, d.n || 0), at: Math.max(l.at || 0, d.at || 0) } : clone(d);
  }
  for (const [id, w] of Object.entries(r.words || {})) if (!p.words[id] || (w.t || 0) > (p.words[id].t || 0)) p.words[id] = clone(w);
  for (const [k, v] of Object.entries(r.checks || {})) if (v) p.checks[k] = true;
  for (const [k, v] of Object.entries(r.frozen || {})) if (v) p.frozen[k] = true;
  if (r.freezeWeek > (p.freezeWeek || '')) { p.freezeWeek = r.freezeWeek; p.freezes = r.freezes; }
  else if (r.freezeWeek === p.freezeWeek) p.freezes = Math.min(p.freezes ?? 2, r.freezes ?? 2);
  if ((r.hmt || 0) > (p.hmt || 0)) Object.assign(p, { hearts: r.hearts, heartsTs: r.heartsTs, hmt: r.hmt });
}

function toRemote(p) {
  const { mine, dev, ...rest } = p;
  return { ...clone(rest), dev: { ...clone(dev), [deviceId]: clone(mine) } };
}

const norm = s => (s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Applique le document distant sur store.profiles. Renvoie true si la progression locale a changé. */
function applyRemote(doc) {
  const before = JSON.stringify(store.profiles);
  const gone = { ...(doc.gone || {}), ...store.gone };
  store.gone = gone; store.saveGone();
  const remote = Object.fromEntries(Object.entries(doc.profiles || {}).filter(([id]) => !gone[id]));
  store.profiles = store.profiles.filter(p => !gone[p.id]);
  if (store.currentId && gone[store.currentId]) store.select(null);

  // Premier jumelage : un profil créé ici avec le même prénom qu'un profil distant devient ce profil.
  if (!ls.get(KEY.synced)) {
    const taken = new Set(store.profiles.map(p => p.id));
    for (const p of store.profiles) {
      if (remote[p.id]) continue;
      const twin = Object.values(remote).find(r => !taken.has(r.id) && norm(r.name) === norm(p.name));
      if (!twin) continue;
      const old = p.id;
      Object.assign(p, { id: twin.id, rev: twin.rev || 0, name: twin.name, avatar: twin.avatar, color: twin.color, imt: twin.imt || 0 });
      taken.add(twin.id);
      if (store.currentId === old) store.select(twin.id);
    }
  }
  for (const r of Object.values(remote)) {
    const p = store.profiles.find(x => x.id === r.id);
    if (p) mergeInto(p, r); else store.profiles.push(fromRemote(r));
  }
  return JSON.stringify(store.profiles) !== before;
}

function buildDoc(prev) {
  return {
    schema: 1,
    updatedAt: new Date().toISOString(),
    gone: store.gone,
    profiles: Object.fromEntries(store.profiles.map(p => [p.id, toRemote(p)])),
    devices: { ...(prev?.devices || {}), [deviceId]: { name: deviceName(), seen: new Date().toISOString() } },
  };
}
const same = (a, b) => {
  if (!a) return false;
  const strip = d => JSON.stringify({ g: d.gone, p: d.profiles });
  return strip(a) === strip(b);
};

/* ---------------- boucle de synchro ---------------- */
let running = null, again = false, pushTimer = null, pollTimer = null;

function setStatus(st, err = '') { cloud.status = st; cloud.error = err; cloud.onStatus?.(); cloud.onParent?.(); }

export function syncNow() {
  if (!cloud.enabled || !navigator.onLine) { if (!cloud.enabled) setStatus('off'); return Promise.resolve(false); }
  if (running) { again = true; return running; }
  running = (async () => {
    let changed = false;
    setStatus('syncing');
    try {
      for (let tries = 0; tries < 4; tries++) {
        const { doc, sha } = await fetchDoc();
        if (doc) changed = applyRemote(doc) || changed;
        store.persist(true);
        ls.set(KEY.synced, true);
        const next = buildDoc(doc);
        if (same(doc, next)) break;
        try {
          await api('PUT', `/contents/${FILE}`, { message: `Progression (${deviceName()})`, content: b64encode(JSON.stringify(next)), ...(sha ? { sha } : {}) });
          break;
        } catch (e) { if (e.status !== 409 && e.status !== 422) throw e; } // quelqu'un a écrit entre-temps : on recommence
      }
      cloud.last = Date.now(); ls.set(KEY.last, cloud.last);
      setStatus('ok');
    } catch (e) {
      setStatus('error', e.status === 404 ? `Dépôt ${cloud.repo()} introuvable, ou le jeton n'y a pas accès.`
        : e.status === 401 ? 'Jeton refusé (expiré ou incorrect).'
        : e.status === 403 ? 'Le jeton n’a pas le droit d’écrire dans le dépôt de progression.' : e.message);
    }
    running = null;
    if (changed) cloud.onRemote?.();
    if (again) { again = false; return syncNow(); }
    return changed;
  })();
  return running;
}

/** À appeler après chaque sauvegarde locale : envoi groupé quelques secondes plus tard. */
function schedulePush() {
  if (!cloud.enabled) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(syncNow, 4000);
}

/** Lien qui configure un autre appareil (GitHub + code parent) en un clic. */
export function pairingLink() {
  const payload = { g: store.github, pin: store.pinHash };
  return `${location.origin}${location.pathname}#pair=${encodeURIComponent(b64encode(JSON.stringify(payload)))}`;
}

function readPairing() {
  const m = location.hash.match(/#pair=([^&]+)/);
  if (!m) return false;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const { g, pin } = JSON.parse(b64decode(decodeURIComponent(m[1])));
    if (!g?.token) return false;
    store.github = { ...store.github, ...g };
    if (pin) store.pinHash = pin;
    return true;
  } catch { return false; }
}

export function initCloud() {
  const paired = readPairing();
  store.onChange = schedulePush;
  setStatus(cloud.enabled ? 'idle' : 'off');
  const poll = () => { clearInterval(pollTimer); pollTimer = setInterval(() => document.visibilityState === 'visible' && syncNow(), 90e3); };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
    else if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; syncNow(); }
  });
  window.addEventListener('online', () => syncNow());
  poll();
  syncNow();
  return paired;
}
