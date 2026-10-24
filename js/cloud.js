// Compte famille et synchronisation de la progression entre appareils.
// Chaque famille se connecte avec son compte Google (Firebase Authentication). La progression de
// ses profils vit dans Firestore : familles/{uid} (suppressions, code parent) et
// familles/{uid}/profils/{id} (un document par enfant). Chaque appareil fusionne sa version avec
// celle du compte, sans jamais perdre de progrès :
//  - XP, jours, semaines : compteurs par appareil, additionnés (pas de double comptage) ;
//  - étapes terminées, défis, cases cochées, jours gelés : union ;
//  - mots : la révision la plus récente l'emporte ; cœurs : le dernier changement l'emporte ;
//  - remise à zéro (rev) et suppression (gone) : propagées à tous les appareils.
// Chaque écriture se fait dans une transaction (relire, fusionner, écrire) : deux appareils qui
// écrivent en même temps ne s'écrasent pas. Les changements des autres appareils arrivent en direct.
// À la première connexion d'un appareil, ses profils locaux sont ajoutés au compte (un profil du
// même prénom qu'un profil du compte est fusionné avec lui).
import { store, normalizeProfile, zeroCounter } from './store.js';
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
const KEY = { device: 'ar.device', last: 'ar.lastSync' };

const ls = {
  get: (k, f = null) => { try { const v = localStorage.getItem(k); return v === null ? f : JSON.parse(v); } catch { return f; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: k => { try { localStorage.removeItem(k); } catch {} },
};

export const deviceId = (() => {
  let id = ls.get(KEY.device);
  if (!id) { id = 'd' + Math.random().toString(36).slice(2, 10); ls.set(KEY.device, id); }
  return id;
})();

export const cloud = {
  status: 'off',            // off | idle | syncing | ok | error
  error: '',
  last: ls.get(KEY.last, 0),
  user: null,               // { uid, email, name } une fois connecté
  ready: false,             // l'état de connexion est connu
  configured: !!firebaseConfig?.apiKey,
  onRemote: null,           // la progression a changé grâce à un autre appareil
  onStatus: null,           // l'état de la synchro ou du compte a changé
  onParent: null,
  get enabled() { return !!this.user; },
};
const syncedKey = () => 'ar.syncedOnce:' + (cloud.user?.uid || '');

/* ---------------- Firebase (chargé à la demande, l'appli marche sans) ---------------- */
let fb = null, auth = null, db = null;
async function loadFirebase() {
  if (fb) return fb;
  if (!cloud.configured) throw new Error('Compte pas encore configuré');
  const [app, a, f] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')]);
  const inst = app.initializeApp(firebaseConfig);
  auth = a.getAuth(inst); auth.languageCode = 'fr';
  db = f.getFirestore(inst);
  fb = { ...a, ...f };
  return fb;
}
/** Pour les tests : remplace le chargement du SDK. */
export function _useFirebase(mock) { fb = mock.fb; auth = mock.auth; db = mock.db; cloud.configured = true; }

const famRef = () => fb.doc(db, 'familles', cloud.user.uid);
const profRef = id => fb.doc(db, 'familles', cloud.user.uid, 'profils', id);
const profCol = () => fb.collection(db, 'familles', cloud.user.uid, 'profils');

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
  if (!ls.get(syncedKey())) {
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


const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------------- boucle de synchro ---------------- */
let running = null, again = false, pushTimer = null, pollTimer = null, liveTimer = null, unsubs = [];

function setStatus(st, err = '') { cloud.status = st; cloud.error = err; cloud.onStatus?.(); cloud.onParent?.(); }

function explain(e) {
  const c = e?.code || '';
  if (c.includes('permission-denied')) return 'Accès refusé par la base (règles Firestore à vérifier).';
  if (c.includes('unavailable') || !navigator.onLine) return 'Pas de connexion pour l’instant.';
  return e?.message || String(e);
}

export function syncNow() {
  if (!cloud.user || !navigator.onLine) { if (!cloud.user) setStatus('off'); return Promise.resolve(false); }
  if (running) { again = true; return running; }
  running = (async () => {
    let changed = false;
    setStatus('syncing');
    try {
      // 1. Lire le compte et fusionner dans les profils locaux.
      const famSnap = await fb.getDoc(famRef());
      const fam = famSnap.exists() ? famSnap.data() : {};
      const snap = await fb.getDocs(profCol());
      const remote = {};
      snap.forEach(d => { try { remote[d.id] = JSON.parse(d.data().p); } catch {} });
      changed = applyRemote({ gone: fam.gone || {}, profiles: remote });
      syncPin(fam);
      store.persist(true);
      ls.set(syncedKey(), true);

      // 2. Écrire ce qui diffère, chaque profil dans une transaction (relire, fusionner, écrire).
      for (const p of store.profiles) {
        if (remote[p.id] && sameJson(remote[p.id], toRemote(p))) continue;
        await fb.runTransaction(db, async tx => {
          const d = await tx.get(profRef(p.id));
          if (d.exists()) { try { const r = JSON.parse(d.data().p); if (store.gone[r.id]) return; mergeInto(p, r); } catch {} }
          tx.set(profRef(p.id), { p: JSON.stringify(toRemote(p)), at: Date.now(), by: deviceId });
        });
      }
      store.persist(true);

      // 3. Suppressions et code parent.
      const goneIds = Object.keys(store.gone);
      for (const id of goneIds) if (remote[id]) await fb.deleteDoc(profRef(id));
      const famNext = { gone: store.gone, pin: store.pinHash || null, pinAt: store.pinAt || 0, email: cloud.user.email || '' };
      if (!sameJson({ g: fam.gone || {}, p: fam.pin || null, a: fam.pinAt || 0 }, { g: famNext.gone, p: famNext.pin, a: famNext.pinAt }))
        await fb.setDoc(famRef(), { ...famNext, at: Date.now() }, { merge: true });

      cloud.last = Date.now(); ls.set(KEY.last, cloud.last);
      setStatus('ok');
    } catch (e) {
      console.warn('synchro', e);
      setStatus('error', explain(e));
    }
    running = null;
    if (changed) cloud.onRemote?.();
    if (again) { again = false; return syncNow(); }
    return changed;
  })();
  return running;
}

/** Code parent : le plus récent (appareil ou compte) l'emporte, ainsi un nouvel appareil le récupère. */
function syncPin(fam) {
  if (fam.pin && (fam.pinAt || 0) > (store.pinAt || 0)) store.adoptPin(fam.pin, fam.pinAt || 0);
}

/** À appeler après chaque sauvegarde locale : envoi groupé quelques secondes plus tard. */
function schedulePush() {
  if (!cloud.user) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(syncNow, 3000);
}

/* ---------------- compte ---------------- */
function startLive() {
  stopLive();
  const kick = () => { clearTimeout(liveTimer); liveTimer = setTimeout(syncNow, 800); };
  unsubs.push(fb.onSnapshot(profCol(), s => { if (!s.metadata.hasPendingWrites) kick(); }, () => {}));
  unsubs.push(fb.onSnapshot(famRef(), s => { if (!s.metadata.hasPendingWrites) kick(); }, () => {}));
}
function stopLive() { unsubs.forEach(u => { try { u(); } catch {} }); unsubs = []; }

function onUser(u) {
  const before = cloud.user?.uid;
  cloud.user = u ? { uid: u.uid, email: u.email || '', name: u.displayName || '' } : null;
  cloud.ready = true;
  if (cloud.user) { if (before !== cloud.user.uid) startLive(); syncNow(); }
  else { stopLive(); setStatus('off'); }
  cloud.onStatus?.(); cloud.onParent?.();
}

/** Connexion Google. Renvoie true si connecté. */
export async function signIn() {
  await loadFirebase();
  const provider = new fb.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try { await fb.signInWithPopup(auth, provider); return true; }
  catch (e) {
    const c = e?.code || '';
    if (c.includes('popup-blocked') || c.includes('operation-not-supported')) { await fb.signInWithRedirect(auth, provider); return false; }
    if (c.includes('popup-closed') || c.includes('cancelled-popup')) return false;
    throw e;
  }
}

/** Revérifie l'identité du parent avec Google (code parent oublié). */
export async function reauth() {
  await loadFirebase();
  if (!auth.currentUser) return false;
  try { await fb.reauthenticateWithPopup(auth.currentUser, new fb.GoogleAuthProvider()); return true; }
  catch { return false; }
}

/** Déconnexion : les profils de ce compte quittent l'appareil (ils restent dans le compte). */
export async function signOutAccount() {
  await syncNow().catch(() => {});
  await loadFirebase();
  stopLive();
  await fb.signOut(auth);
  store.clearProfiles();
}

export function initCloud() {
  store.onChange = schedulePush;
  setStatus('off');
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
    else if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; syncNow(); }
  });
  window.addEventListener('online', () => syncNow());
  clearInterval(pollTimer);
  pollTimer = setInterval(() => document.visibilityState === 'visible' && syncNow(), 5 * 60e3);
  if (!cloud.configured) { cloud.ready = true; return false; }
  loadFirebase().then(() => {
    fb.getRedirectResult(auth).catch(() => {});
    fb.onAuthStateChanged(auth, onUser);
  }).catch(e => { console.warn('Compte indisponible (hors ligne ?)', e); cloud.ready = true; cloud.onStatus?.(); });
  return false;
}
