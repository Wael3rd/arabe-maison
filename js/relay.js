// Relais du jeton GitHub entre appareils.
// Quand le jeton change sur un appareil (espace parent › Enregistrer), le nouveau jeton est déposé
// dans relais-jeton.json du dépôt du cours, chiffré (AES-GCM) avec une clé dérivée de l'ANCIEN jeton.
// Un appareil dont le jeton est refusé lit ce fichier (public, servi par GitHub Pages), retrouve
// l'entrée qui correspond à son jeton, la déchiffre et adopte le nouveau. Les entrées forment une
// chaîne : un appareil resté éteint pendant plusieurs changements remonte la chaîne jusqu'au bout.
// Le fichier ne révèle rien sans l'ancien jeton (identifiant = empreinte, contenu chiffré).
import { store } from './store.js';

const FILE = 'relais-jeton.json';
const PENDING = 'ar.relayPending';
const enc = new TextEncoder();

const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const sha = s => crypto.subtle.digest('SHA-256', enc.encode(s));

async function keysFor(token) {
  const kid = toHex(await sha('arabe-maison/kid:' + token)).slice(0, 32);
  const key = await crypto.subtle.importKey('raw', await sha('arabe-maison/key:' + token), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { kid, key };
}

const ls = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/* ---------- écriture (appareil où le jeton vient d'être changé) ---------- */

async function gh(method, path, body) {
  const g = store.github;
  const r = await fetch(`https://api.github.com/repos/${g.owner}/${g.repo}${path}`, {
    method, cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${g.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.message || String(r.status)); e.status = r.status; throw e; }
  return j;
}

/** À appeler quand le jeton passe de oldToken à newToken. Garde la demande en attente si le réseau manque. */
export function noteTokenChange(oldToken, newToken) {
  if (!oldToken || !newToken || oldToken === newToken) return;
  const list = (ls.get(PENDING) || []).filter(p => p.old !== oldToken);
  list.push({ old: oldToken, new: newToken });
  ls.set(PENDING, list);
  flushRelay();
}

let flushing = null;
/** Publie les changements de jeton en attente (appelé aussi après chaque synchro réussie). */
export function flushRelay() {
  const list = ls.get(PENDING);
  const g = store.github;
  if (!list?.length || !g.owner || !g.repo || !g.token || !navigator.onLine) return Promise.resolve(false);
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      const branch = g.branch || 'main';
      let doc = { v: 1, entries: [] }, fileSha;
      try {
        const f = await gh('GET', `/contents/${FILE}?ref=${encodeURIComponent(branch)}&t=${Date.now()}`);
        doc = JSON.parse(atob(f.content.replace(/\n/g, ''))); fileSha = f.sha;
      } catch (e) { if (e.status !== 404) throw e; }
      for (const p of list) {
        const { kid, key } = await keysFor(p.old);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(p.new));
        doc.entries = (doc.entries || []).filter(x => x.kid !== kid);
        doc.entries.push({ kid, iv: toB64(iv), ct: toB64(ct), at: new Date().toISOString().slice(0, 10) });
      }
      doc.entries = doc.entries.slice(-12);
      await gh('PUT', `/contents/${FILE}`, {
        message: 'Relais du jeton (chiffré)', branch,
        content: btoa(JSON.stringify(doc, null, 1)), ...(fileSha ? { sha: fileSha } : {}),
      });
      ls.set(PENDING, null);
      return true;
    } catch (e) { console.warn('Relais du jeton non publié', e); return false; }
    finally { flushing = null; }
  })();
  return flushing;
}

/* ---------- lecture (appareil dont le jeton est refusé) ---------- */

async function fetchRelay() {
  const g = store.github;
  const urls = [`${FILE}?t=${Date.now()}`];
  if (g.owner && g.repo) urls.push(`https://raw.githubusercontent.com/${g.owner}/${g.repo}/${g.branch || 'main'}/${FILE}?t=${Date.now()}`);
  for (const u of urls) {
    try { const r = await fetch(u, { cache: 'no-store' }); if (r.ok) return await r.json(); } catch {}
  }
  return null;
}

/** Cherche un jeton plus récent dans le relais. Renvoie true si le jeton local a été remplacé. */
export async function adoptFromRelay() {
  const start = store.github.token;
  if (!start) return false;
  const doc = await fetchRelay();
  if (!doc?.entries?.length) return false;
  let token = start;
  for (let hop = 0; hop < 12; hop++) {
    const { kid, key } = await keysFor(token);
    const e = doc.entries.find(x => x.kid === kid);
    if (!e) break;
    try {
      token = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(e.iv) }, key, fromB64(e.ct)));
    } catch { break; }
  }
  if (token === start) return false;
  store.github = { ...store.github, token };
  return true;
}
