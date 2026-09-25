// Écran « Synchro voix et karaoké » : vitesse de la voix, départ et rythme du surlignage,
// réglage automatique au doigt.
import { esc, h, toast } from './util.js';
import { store, DEFAULT_SETTINGS } from './store.js';
import { tts, kara } from './tts.js';

const REACTION = 170; // délai moyen entre le son entendu et le tap, retiré des mesures

function samples() {
  const c = store.content;
  const lines = c.units.flatMap(u => u.dialogue || []).map(l => l.ar);
  const long = [...lines].sort((a, b) => b.split(' ').length - a.split(' ').length)[0] || 'اليَوْم السَّبْت، لا مَدْرَسة.';
  const mid = lines.find(l => l.split(' ').length >= 4 && l.split(' ').length <= 6) || 'أَيْنَ الكِتاب ؟';
  return [
    ['Mot', c.units[0]?.vocab?.[0]?.ar || 'السَّلامُ عَلَيْكُم'],
    ['Phrase courte', mid],
    ['Phrase longue', long],
  ];
}

export function openSync(onClose) {
  const s = store.settings;
  const S = samples();
  let cur = 1, loop = false, loopTimer = null;
  const root = h(`<div class="lesson" style="background:var(--bg);overflow:auto">
    <header class="topbar"><div class="who">🎚️ Synchro voix et karaoké</div><button class="btn small" data-close>Fermer</button></header>
    <main class="main" style="padding-bottom:40px">
      <div class="card sync-stage">
        <div class="chips">${S.map(([l], i) => `<button data-s="${i}" class="${i === cur ? 'on' : ''}">${l}</button>`).join('')}<button data-s="rnd">🎲 Au hasard</button></div>
        <div class="ar sync-text" data-text></div>
        <div class="sync-play">
          <button class="speak" data-play aria-label="Écouter">🔊</button>
          <button class="speak slow" data-slow aria-label="Écouter lentement">🐢</button>
          <label class="loop"><input type="checkbox" data-loop> En boucle</label>
        </div>
        <p class="muted sync-mode" data-mode></p>
      </div>

      <div class="card" style="margin-top:14px">
        <h3>🗣️ Voix</h3>
        ${slider('rate', 'Vitesse de lecture', 0.5, 1.3, 0.05, v => `×${(+v).toFixed(2)}`)}
        ${slider('slowRate', 'Vitesse du mode tortue 🐢', 0.3, 0.8, 0.05, v => `×${(+v).toFixed(2)}`)}
        <h3 style="margin-top:18px">🟠 Surlignage</h3>
        ${slider('karaOffset', 'Départ (attente avant le 1er mot)', 0, 1500, 25, v => `${v} ms`)}
        ${slider('karaPct', 'Rythme du surlignage', 40, 250, 5, v => `${v} %`, Math.round(100 / (s.karaScale || 1)))}
        <label class="switch"><span><b>Ajustement automatique du rythme</b><br><small class="muted">Se recale tout seul après chaque lecture. Coupe-le si tu règles le rythme à la main.</small></span><input type="checkbox" data-auto ${s.karaAuto !== false ? 'checked' : ''}></label>
      </div>

      <div class="card" style="margin-top:14px">
        <h3>👆 Synchro au doigt</h3>
        <p class="muted">Appuie sur Démarrer, puis tape la grande zone <b>à chaque mot que tu entends</b>. L'appli calcule le départ et le rythme toute seule.</p>
        <button class="tap-pad" data-pad disabled><span data-padtxt>Choisis une phrase puis appuie sur Démarrer</span></button>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
          <button class="btn small blue" data-tapgo>▶️ Démarrer</button>
          <button class="btn small" data-apply disabled>Appliquer</button>
          <span class="muted" data-res style="align-self:center"></span>
        </div>
      </div>

      <div style="margin-top:18px;display:flex;justify-content:flex-end"><button class="btn small ghost" data-reset>Valeurs par défaut</button></div>
    </main></div>`);
  document.body.append(root);
  const $ = sel => root.querySelector(sel);
  const textEl = $('[data-text]');

  function slider(key, label, min, max, step, fmt, value) {
    const v = value ?? s[key];
    return `<div class="field sync-field"><label>${label} <b data-v="${key}">${fmt(v)}</b></label>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-k="${key}" data-fmt="${esc(fmt.toString())}"></div>`;
  }
  const FMT = { rate: v => `×${(+v).toFixed(2)}`, slowRate: v => `×${(+v).toFixed(2)}`, karaOffset: v => `${v} ms`, karaPct: v => `${v} %` };

  const setText = t => { tts.stop(); delete textEl.dataset.karaText; textEl.textContent = t; };
  setText(S[cur][1]);

  const showMode = () => {
    $('[data-mode]').textContent = kara.lastBmode
      ? '✅ Ta voix envoie un repère à chaque mot : le surlignage la suit, seul le « Départ » compte.'
      : 'ℹ️ Ta voix n’envoie pas de repères de mots : le surlignage suit le « Rythme » réglé ci-dessous.';
  };
  const play = (slow = false) => {
    clearTimeout(loopTimer);
    tts.speak(textEl.dataset.karaText ?? textEl.textContent, { el: textEl, slow, onEnd: () => {
      setTimeout(showMode, 50);
      if (loop && root.isConnected) loopTimer = setTimeout(() => play(slow), 1200);
    } });
  };

  root.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
    root.querySelectorAll('[data-s]').forEach(x => x.classList.toggle('on', x === b));
    if (b.dataset.s === 'rnd') {
      const all = store.content.units.flatMap(u => [...(u.dialogue || []).map(l => l.ar), ...(u.vocab || []).map(w => w.ar)]);
      setText(all[Math.floor(Math.random() * all.length)]);
    } else { cur = +b.dataset.s; setText(S[cur][1]); }
    play();
  });
  $('[data-play]').onclick = () => play(false);
  $('[data-slow]').onclick = () => play(true);
  $('[data-loop]').onchange = e => { loop = e.target.checked; if (loop) play(); else clearTimeout(loopTimer); };

  root.querySelectorAll('input[type=range][data-k]').forEach(r => r.addEventListener('input', () => {
    const k = r.dataset.k, v = +r.value;
    $(`[data-v="${k}"]`).textContent = FMT[k](v);
    if (k === 'karaPct') {
      s.karaScale = +(100 / v).toFixed(3);
      if (s.karaAuto !== false) { s.karaAuto = false; $('[data-auto]').checked = false; }
    } else s[k] = v;
    store.saveSettings();
  }));
  root.querySelectorAll('input[type=range][data-k]').forEach(r => r.addEventListener('change', () => play(r.dataset.k === 'slowRate')));
  $('[data-auto]').onchange = e => { s.karaAuto = e.target.checked; store.saveSettings(); };
  const refreshSliders = () => root.querySelectorAll('input[type=range][data-k]').forEach(r => {
    const k = r.dataset.k, v = k === 'karaPct' ? Math.round(100 / (s.karaScale || 1)) : s[k];
    r.value = v; $(`[data-v="${k}"]`).textContent = FMT[k](v);
  });

  /* ---------- synchro au doigt ---------- */
  let taps = [], t0 = 0, words = [], result = null;
  const pad = $('[data-pad]'), padTxt = $('[data-padtxt]');
  $('[data-tapgo]').onclick = () => {
    const text = textEl.dataset.karaText ?? textEl.textContent;
    words = text.split(/\s+/).filter(Boolean);
    if (words.length < 3) { toast('Choisis une phrase d’au moins 3 mots'); return; }
    taps = []; t0 = 0; result = null; $('[data-apply]').disabled = true; $('[data-res]').textContent = '';
    pad.disabled = false; pad.classList.add('armed');
    padTxt.innerHTML = `<span class="ar">${words.map((w, i) => `<span data-w="${i}">${esc(w)}</span>`).join(' ')}</span><br><small>Tape à chaque mot entendu</small>`;
    tts.speak(text, { noKara: true, onStart: t => { t0 = t; }, onEnd: () => setTimeout(finishTaps, 400) });
  };
  pad.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!t0 || taps.length >= words.length) return;
    taps.push(performance.now() - t0 - REACTION);
    pad.querySelector(`[data-w="${taps.length - 1}"]`)?.classList.add('hit');
    pad.classList.remove('flash'); void pad.offsetWidth; pad.classList.add('flash');
  });
  function finishTaps() {
    pad.disabled = true; pad.classList.remove('armed');
    if (taps.length < 3) { $('[data-res]').textContent = `Seulement ${taps.length} tap${taps.length > 1 ? 's' : ''} : recommence en tapant à chaque mot.`; return; }
    const rate = s.rate;
    const cum = []; let acc = 0;
    words.forEach(w => { cum.push(acc); acc += kara.dur1(w, rate); });
    const n = taps.length, xs = cum.slice(0, n), ys = taps;
    const mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
    let num = 0, den = 0;
    xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
    const scale = Math.min(3, Math.max(0.35, den ? num / den : 1));
    const offset = Math.round(Math.min(1500, Math.max(0, my - scale * mx)) / 25) * 25;
    result = { scale, offset };
    $('[data-res]').textContent = `Départ ${offset} ms · rythme ${Math.round(100 / scale)} %`;
    $('[data-apply]').disabled = false;
    padTxt.innerHTML += '<br><b>Mesure terminée</b>';
  }
  $('[data-apply]').onclick = () => {
    if (!result) return;
    s.karaOffset = result.offset; s.karaScale = +result.scale.toFixed(3); s.karaAuto = false;
    $('[data-auto]').checked = false; store.saveSettings(); refreshSliders();
    toast('Réglage appliqué, écoute le résultat'); setTimeout(() => play(), 300);
  };

  $('[data-reset]').onclick = () => {
    ['rate', 'slowRate', 'karaOffset', 'karaScale', 'karaAuto'].forEach(k => s[k] = DEFAULT_SETTINGS[k]);
    store.saveSettings(); refreshSliders(); $('[data-auto]').checked = true; toast('Valeurs par défaut rétablies');
  };
  $('[data-close]').onclick = () => { clearTimeout(loopTimer); loop = false; tts.stop(); root.remove(); onClose && onClose(); };
  showMode(); if (!kara.lastBmode) $('[data-mode]').textContent = 'Écoute une phrase pour vérifier que l’orange suit bien la voix.';
}
