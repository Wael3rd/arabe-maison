// Petites fonctions partagées : DOM, hasard, markdown, toasts, modales, sons, mascotte.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Enveloppe les passages en écriture arabe dans un span RTL avec la bonne police. */
export function arWrap(html) {
  return html.replace(/([؀-ۿݐ-ݿ][؀-ۿݐ-ݿ\s.,،؟!…:'"«»()ـً-ْ]*[؀-ۿً-ْـ؟])|([؀-ۿ])/g,
    m => `<span class="ar">${m}</span>`);
}

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function shuffle(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export const pick = a => a[Math.floor(Math.random() * a.length)];
export const sample = (a, n) => shuffle(a).slice(0, n);

export function todayKey(d = new Date()) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
export function weekKey(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // lundi
  return todayKey(x);
}

/* ---------- normalisation pour comparer de l'arabe ---------- */
const HARAKAT = /[ً-ْٰـ]/g;
export function normAr(s) {
  return String(s).replace(HARAKAT, '').replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/[^ء-ي\s]/g, '').replace(/\s+/g, ' ').trim();
}
export function normFr(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function similarity(a, b) {
  if (!a.length && !b.length) return 1;
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[m][n] / Math.max(m, n);
}

/** Découpe un mot arabe en lettres (lettre + ses voyelles courtes). */
export function arLetters(word) {
  const out = [];
  for (const ch of word.replace(/ـ/g, '')) {
    if (/[ً-ْٰ]/.test(ch) && out.length) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

/** Découpe une phrase en tuiles (sans la ponctuation isolée). */
export function tokensAr(s) {
  return s.split(/\s+/).map(t => t.replace(/[.,،؟!:]+$/g, '')).filter(t => t && !/^[.,،؟!:?]+$/.test(t));
}
export function tokensFr(s) {
  return s.replace(/([.,!?:;])/g, ' ').split(/\s+/).filter(Boolean);
}

/* ---------- mini markdown (livret, notes) ---------- */
export function md(src = '') {
  const inline = s => arWrap(esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[(.+?)\]\((https?:[^)]+)\)/g, '<a class="link" href="$2" target="_blank" rel="noopener">$1</a>'));
  const blocks = String(src).replace(/\r/g, '').split(/\n{2,}/);
  return blocks.map(b => {
    const lines = b.split('\n');
    if (lines.every(l => l.trim().startsWith('|'))) {
      const rows = lines.filter(l => !/^\|\s*-{2,}/.test(l.trim())).map(l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
      const [head, ...body] = rows;
      return `<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }
    if (lines.every(l => /^\s*[-*] /.test(l))) return `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*[-*] (\[ \] )?/, ''))}</li>`).join('')}</ul>`;
    if (lines.every(l => /^\s*\d+\. /.test(l))) return `<ol>${lines.map(l => `<li>${inline(l.replace(/^\s*\d+\. /, ''))}</li>`).join('')}</ol>`;
    const hm = b.match(/^(#{1,4}) (.+)/);
    if (hm) return `<h3>${inline(hm[2])}</h3>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}

/* ---------- toasts & modales ---------- */
export function toast(msg, ms = 2400) {
  const el = h(`<div class="toast">${esc(msg)}</div>`);
  document.getElementById('toast-root').append(el);
  setTimeout(() => el.remove(), ms);
}

export function modal(html, { onClose, dismiss = true } = {}) {
  const root = document.getElementById('modal-root');
  const back = h(`<div class="modal-back"><div class="modal" role="dialog">${html}</div></div>`);
  const close = () => { back.remove(); onClose && onClose(); };
  if (dismiss) back.addEventListener('click', e => { if (e.target === back) close(); });
  root.append(back);
  back.close = close;
  return back;
}

export function ask(title, body, { ok = 'OK', cancel = 'Annuler', danger = false } = {}) {
  return new Promise(res => {
    const m = modal(`<h2>${esc(title)}</h2><p class="muted">${esc(body)}</p>
      <div class="row"><button class="btn ghost" data-a="0">${esc(cancel)}</button><button class="btn ${danger ? 'red' : ''}" data-a="1">${esc(ok)}</button></div>`,
      { onClose: () => res(false) });
    m.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { m.remove(); res(b.dataset.a === '1'); });
  });
}

/* ---------- sons (synthétisés, aucun fichier) ---------- */
let actx;
function tone(freq, t0, dur, type = 'sine', vol = .18) {
  actx = actx || new (window.AudioContext || window.webkitAudioContext)();
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, actx.currentTime + t0);
  g.gain.exponentialRampToValueAtTime(vol, actx.currentTime + t0 + .02);
  g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + t0 + dur);
  o.connect(g).connect(actx.destination);
  o.start(actx.currentTime + t0); o.stop(actx.currentTime + t0 + dur + .05);
}
export const sfx = {
  enabled: true,
  ok() { if (!this.enabled) return; tone(660, 0, .12, 'triangle'); tone(990, .09, .22, 'triangle'); },
  bad() { if (!this.enabled) return; tone(220, 0, .18, 'square', .07); tone(170, .12, .25, 'square', .07); },
  tap() { if (!this.enabled) return; tone(520, 0, .05, 'sine', .06); },
  win() { if (!this.enabled) return; [523, 659, 784, 1046].forEach((f, i) => tone(f, i * .12, .3, 'triangle', .16)); },
};

export function confetti() {
  const c = h('<canvas class="confetti"></canvas>');
  document.body.append(c);
  const ctx = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
  const cols = ['#22B573', '#2D9CDB', '#FF9F1C', '#FF5A5F', '#FFC83D', '#9B6DFF'];
  const ps = Array.from({ length: 120 }, () => ({ x: Math.random() * c.width, y: -20 - Math.random() * c.height * .5,
    vx: (Math.random() - .5) * 3, vy: 2 + Math.random() * 4, r: Math.random() * 6.28, s: 6 + Math.random() * 8, c: pick(cols) }));
  let f = 0;
  (function loop() {
    ctx.clearRect(0, 0, c.width, c.height);
    ps.forEach(p => { p.x += p.vx; p.y += p.vy; p.r += .1; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); });
    if (++f < 170) requestAnimationFrame(loop); else c.remove();
  })();
}

/* ---------- Fennec, la mascotte (dessin original) ---------- */
export function mascot(mood = 'happy', cls = 'mascot-s') {
  const mouth = {
    happy: '<path d="M88 132 Q100 146 112 132" stroke="#5B3A1E" stroke-width="5" fill="none" stroke-linecap="round"/>',
    wow: '<ellipse cx="100" cy="137" rx="9" ry="11" fill="#5B3A1E"/><ellipse cx="100" cy="141" rx="5" ry="5" fill="#FF7A8A"/>',
    sad: '<path d="M88 142 Q100 130 112 142" stroke="#5B3A1E" stroke-width="5" fill="none" stroke-linecap="round"/>',
  }[mood];
  const eyes = mood === 'happy'
    ? '<path d="M70 106 Q78 96 86 106" stroke="#2F2A26" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M114 106 Q122 96 130 106" stroke="#2F2A26" stroke-width="6" fill="none" stroke-linecap="round"/>'
    : '<circle cx="78" cy="104" r="10" fill="#2F2A26"/><circle cx="122" cy="104" r="10" fill="#2F2A26"/><circle cx="81" cy="100" r="3.5" fill="#fff"/><circle cx="125" cy="100" r="3.5" fill="#fff"/>';
  return `<svg class="${cls}" viewBox="0 0 200 200" aria-hidden="true">
    <path d="M52 92 L22 12 Q20 4 28 8 L92 62 Z" fill="#E9A15B"/><path d="M58 82 L36 26 L84 66 Z" fill="#FFD9B8"/>
    <path d="M148 92 L178 12 Q180 4 172 8 L108 62 Z" fill="#E9A15B"/><path d="M142 82 L164 26 L116 66 Z" fill="#FFD9B8"/>
    <ellipse cx="100" cy="176" rx="46" ry="18" fill="#E9A15B"/>
    <path d="M40 104 Q40 58 100 56 Q160 58 160 104 Q160 150 100 164 Q40 150 40 104 Z" fill="#F4B96E"/>
    <path d="M62 120 Q100 108 138 120 Q132 158 100 164 Q68 158 62 120 Z" fill="#FFF3E3"/>
    ${eyes}<ellipse cx="100" cy="124" rx="11" ry="8" fill="#2F2A26"/>${mouth}
    <circle cx="62" cy="128" r="8" fill="#FF9E8A" opacity=".55"/><circle cx="138" cy="128" r="8" fill="#FF9E8A" opacity=".55"/>
  </svg>`;
}

export async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
