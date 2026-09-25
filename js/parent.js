// Espace parent : carnet papa, éditeur de contenu, profils, réglages, publication GitHub.
import { esc, h, md, modal, toast, ask, sha256, arWrap, sfx } from './util.js';
import { store } from './store.js';
import { tts } from './tts.js';
import { openSync } from './sync.js';

/* ---------------- code parent ---------------- */
export function requirePin() {
  return new Promise(res => {
    const creating = !store.pinHash;
    const m = modal(`<h2>🔒 ${creating ? 'Choisis un code parent' : 'Code parent'}</h2>
      <p class="muted">${creating ? 'Il protège l’espace parent et la validation des défis. 4 chiffres ou plus.' : 'Réservé à papa !'}</p>
      <input class="input" type="password" inputmode="numeric" autocomplete="off" data-pin style="font-size:28px;text-align:center;letter-spacing:.4em">
      ${creating ? '<input class="input" type="password" inputmode="numeric" autocomplete="off" data-pin2 placeholder="Confirme le code" style="margin-top:10px;text-align:center">' : ''}
      <div class="row"><button class="btn ghost" data-x>Annuler</button><button class="btn" data-ok>Valider</button></div>`,
      { onClose: () => res(false) });
    const inp = m.querySelector('[data-pin]');
    setTimeout(() => inp.focus(), 100);
    m.querySelector('[data-x]').onclick = () => m.close();
    const ok = async () => {
      const v = inp.value.trim();
      if (creating) {
        if (v.length < 4) return toast('Au moins 4 chiffres');
        if (v !== m.querySelector('[data-pin2]').value.trim()) return toast('Les deux codes sont différents');
        store.pinHash = await sha256('ar:' + v); m.remove(); res(true);
      } else if (await sha256('ar:' + v) === store.pinHash) { m.remove(); res(true); }
      else { inp.value = ''; toast('Code incorrect'); }
    };
    m.querySelector('[data-ok]').onclick = ok;
    inp.addEventListener('keydown', e => e.key === 'Enter' && !creating && ok());
  });
}

/* ---------------- structure ---------------- */
let ptab = 'carnet', onExit = null, root = null, editing = null;

export async function openParent(exitCb) {
  if (!(await requirePin())) return;
  onExit = exitCb;
  root = h('<div class="lesson" style="background:var(--bg);overflow:auto"></div>');
  document.body.append(root);
  draw();
}

function close() { root.remove(); root = null; editing = null; tts.stop(); onExit && onExit(); }

function draw() {
  const tabs = [['carnet', '📒 Carnet papa'], ['content', '✏️ Contenu'], ['kids', '👧 Enfants'], ['settings', '⚙️ Réglages'], ['github', '☁️ GitHub']];
  root.innerHTML = '';
  root.append(h(`<header class="topbar"><div class="who">🔒 Espace parent ${store.usingDraft ? '<span class="badge">brouillon</span>' : ''}</div><button class="btn small" data-close>Fermer</button></header>`));
  const main = h(`<main class="main" style="padding-bottom:40px"><div class="ptabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${ptab === k ? 'on' : ''}">${l}</button>`).join('')}</div></main>`);
  root.append(main);
  root.querySelector('[data-close]').onclick = close;
  main.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { ptab = b.dataset.t; editing = null; draw(); });
  ({ carnet, content: contentTab, kids, settings, github })[ptab](main);
}

/* ---------------- carnet papa (lecture du cours complet) ---------------- */
let carnetSel = 'guide';
function carnet(main) {
  const c = store.content;
  const opts = [['guide', "Mode d'emploi"], ...c.units.map(u => [u.id, `Leçon ${u.num} · ${u.title}`]), ['annexes', 'Annexes']];
  main.append(h(`<select class="input" data-sel>${opts.map(([k, l]) => `<option value="${k}" ${k === carnetSel ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`));
  main.querySelector('[data-sel]').onchange = e => { carnetSel = e.target.value; draw(); };
  const box = h('<div class="card md" style="margin-top:14px"></div>');
  if (carnetSel === 'guide') box.innerHTML = `<h2>Mode d'emploi</h2>${md(c.guide)}`;
  else if (carnetSel === 'annexes') box.innerHTML = `<h2>Annexes</h2><h3>Jeux réutilisables</h3>
    ${md('| Jeu | Règle | Matériel |\n| --- | --- | --- |\n' + c.games.map(g => `| ${g.name} | ${g.rule} | ${g.material} |`).join('\n'))}
    <h3>Corrigés</h3>${md(c.corrections)}<h3>Lexique : les 40 mots</h3>${md(c.lexique)}`;
  else {
    const u = c.units.find(x => x.id === carnetSel);
    const voc = u.vocab.length ? '| Français | Arabe standard | Lecture | Tunisien |\n| --- | --- | --- | --- |\n' + u.vocab.map(w => `| ${w.fr} | ${w.ar} | ${w.lat} | ${w.tn}${w.tnLat ? ` (${w.tnLat})` : ''}${w.note ? ` · ${w.note}` : ''} |`).join('\n') : '';
    box.innerHTML = `<h2>${u.icon} Leçon ${u.num} : ${esc(u.title)}</h2><p>${arWrap(esc(u.goal))}</p>
      ${voc ? `<h3>Vocabulaire</h3>${md(voc)}` : ''}${u.notes ? md(u.notes) : ''}
      ${u.dialogue.length ? `<h3>Dialogue</h3><ul>${u.dialogue.map(l => `<li><span class="ar">${esc(l.who)} : ${esc(l.ar)}</span><br><span class="muted">${esc(l.fr)} · 🇹🇳 ${esc(l.tnLat)}</span></li>`).join('')}</ul>` : ''}
      ${u.dialogueNote ? md(u.dialogueNote) : ''}
      ${u.exercises?.length ? `<h3>Exercices (cahier et oral)</h3>${md(u.exercises.map((e, i) => `${i + 1}. ${e}`).join('\n'))}` : ''}
      ${u.parcours ? `<h3>Parcours de la semaine</h3>${md(u.parcours)}` : ''}
      ${u.defi ? `<h3>Défi de la semaine</h3>${md(u.defi)}` : ''}
      ${u.apres ? `<h3>Et après ?</h3>${md(u.apres)}` : ''}
      <h3>Progression des enfants</h3>${store.profiles.map(p => { const ws = u.vocab.map(w => p.words[w.id]?.s || 0);
        return `<p><b>${esc(p.avatar)} ${esc(p.name)}</b> : ${ws.filter(s => s >= 3).length}/${u.vocab.length} mots bien connus${u.vocab.length ? ` · à revoir : ${u.vocab.filter(w => (p.words[w.id]?.s || 0) < 2 && p.words[w.id]).map(w => esc(w.fr)).join(', ') || 'rien'}` : ''}</p>`; }).join('')}`;
  }
  main.append(box);
}

/* ---------------- éditeur de contenu ---------------- */
const clone = o => JSON.parse(JSON.stringify(o));
const HARAKAT = ['َ', 'ُ', 'ِ', 'ْ', 'ّ', 'ً', 'ٌ', 'ٍ', 'ـ', '؟', '،'];
let lastAr = null;

function contentTab(main) {
  if (editing) return unitEditor(main);
  const c = store.content;
  main.append(h(`<div class="card" style="margin-bottom:14px">
    <b>Comment ça marche</b><p class="muted" style="margin:6px 0 0">Tes modifications sont enregistrées tout de suite sur cet appareil (brouillon) et visibles par les enfants.
    Publie-les sur GitHub pour qu’elles arrivent sur les autres appareils et soient sauvegardées.</p>
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:14px">
      <button class="btn small" data-pub ${store.usingDraft ? '' : 'disabled'}>☁️ Publier sur GitHub</button>
      <button class="btn small ghost" data-exp>⬇️ Exporter JSON</button>
      <label class="btn small ghost">⬆️ Importer JSON<input type="file" accept="application/json,.json" hidden data-imp></label>
      ${store.usingDraft ? '<button class="btn small red" data-drop>Abandonner le brouillon</button>' : ''}
    </div></div>`));
  const list = h('<div class="ulist"></div>');
  c.units.forEach((u, i) => list.append(h(`<div class="card urow"><span class="ic">${u.icon}</span><span class="t">${u.num}. ${esc(u.title)}<br><small class="muted">${u.vocab.length} mots · ${u.dialogue.length} répliques</small></span>
    <button class="iconbtn" data-up="${i}" ${i ? '' : 'disabled'}>⬆️</button><button class="iconbtn" data-down="${i}" ${i < c.units.length - 1 ? '' : 'disabled'}>⬇️</button>
    <button class="btn small blue" data-edit="${i}">Modifier</button></div>`)));
  main.append(list);
  main.append(h('<button class="btn ghost block" data-add style="margin-top:14px">➕ Ajouter une unité</button>'));

  const mutate = f => { const n = clone(store.content); f(n); n.units.forEach((u, i) => u.num = i + 1); store.saveDraft(n); draw(); };
  main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { editing = { idx: +b.dataset.edit, unit: clone(c.units[+b.dataset.edit]) }; draw(); });
  main.querySelectorAll('[data-up]').forEach(b => b.onclick = () => mutate(n => { const i = +b.dataset.up; [n.units[i - 1], n.units[i]] = [n.units[i], n.units[i - 1]]; }));
  main.querySelectorAll('[data-down]').forEach(b => b.onclick = () => mutate(n => { const i = +b.dataset.down; [n.units[i + 1], n.units[i]] = [n.units[i], n.units[i + 1]]; }));
  main.querySelector('[data-add]').onclick = () => mutate(n => n.units.push({ id: 'u' + Date.now().toString(36), num: 0, title: 'Nouvelle unité', icon: '🌟', color: '#2D9CDB', goal: '', vocab: [], notes: '', dialogue: [], dialogueNote: '', exercises: [], defi: '' }));
  main.querySelector('[data-pub]').onclick = publish;
  main.querySelector('[data-exp]').onclick = () => download('content.json', JSON.stringify(store.content, null, 1));
  main.querySelector('[data-imp]').onchange = async e => {
    try { const j = JSON.parse(await e.target.files[0].text()); if (!Array.isArray(j.units)) throw 0; store.saveDraft(j); toast('Contenu importé (brouillon)'); draw(); }
    catch { toast('Fichier JSON invalide'); }
  };
  main.querySelector('[data-drop]')?.addEventListener('click', async () => {
    if (await ask('Abandonner le brouillon ?', 'Tu reviens à la dernière version publiée.', { ok: 'Abandonner', danger: true })) { store.dropDraft(); draw(); }
  });
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function inp(label, key, val, { ar = false, area = false, ph = '' } = {}) {
  const cls = `input ${ar ? 'ar' : ''}`;
  return `<div class="field"><label>${label}</label>${area
    ? `<textarea class="${cls}" data-k="${key}" placeholder="${esc(ph)}" ${ar ? 'dir="rtl"' : ''}>${esc(val)}</textarea>`
    : `<input class="${cls}" data-k="${key}" value="${esc(val)}" placeholder="${esc(ph)}" ${ar ? 'dir="rtl"' : ''}>`}</div>`;
}

function unitEditor(main) {
  const u = editing.unit;
  const el = h(`<div>
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px"><button class="btn small ghost" data-back>← Retour</button>
      <h2 style="flex:1">Unité ${u.num}</h2><button class="btn small" data-save>Enregistrer</button></div>
    <div class="card" data-main>
      <div style="display:grid;grid-template-columns:3fr 1fr 1fr;gap:8px">${inp('Titre', 'title', u.title)}${inp('Icône (emoji)', 'icon', u.icon)}
        <div class="field"><label>Couleur</label><input type="color" class="input" data-k="color" value="${esc(u.color)}" style="height:50px;padding:4px"></div></div>
      ${inp('Objectif de la semaine', 'goal', u.goal, { area: true })}
      ${inp('Astuce de grammaire (affichée dans le guide, markdown)', 'notes', u.notes, { area: true })}
    </div>
    <div class="harakat card" style="position:sticky;top:70px;z-index:5;margin:14px 0">${HARAKAT.map(c => `<button data-h="${c}" title="Insérer">${c === 'ـ' ? 'ـ' : 'ـ' + c}</button>`).join('')}<span class="muted" style="align-self:center;font-size:13px">Voyelles : touche un champ arabe puis un bouton</span></div>
    <h3 class="section-t">Vocabulaire (${u.vocab.length})</h3><div data-vocab></div>
    <button class="btn ghost small" data-addw>➕ Ajouter un mot</button>
    <h3 class="section-t">Dialogue (${u.dialogue.length} répliques)</h3><div data-dia></div>
    <button class="btn ghost small" data-addl>➕ Ajouter une réplique</button>
    <div class="card" data-extra style="margin-top:18px">
      ${inp('Remarque sous le dialogue', 'dialogueNote', u.dialogueNote, { area: true })}
      ${inp('Exercices cahier / oral (un par ligne)', 'exercises', (u.exercises || []).join('\n'), { area: true })}
      ${inp('Défi de la semaine', 'defi', u.defi, { area: true })}
    </div>
    <div style="display:flex;gap:10px;margin-top:18px"><button class="btn red small" data-del>Supprimer l’unité</button><span style="flex:1"></span><button class="btn" data-save>Enregistrer</button></div>
  </div>`);
  main.append(el);

  const vbox = el.querySelector('[data-vocab]'), dbox = el.querySelector('[data-dia]');
  const drawVocab = () => {
    vbox.innerHTML = '';
    u.vocab.forEach((w, i) => {
      const r = h(`<div class="erow" data-i="${i}"><div class="g">${inp('Français', 'fr', w.fr)}${inp('Emoji (image)', 'emoji', w.emoji || '')}</div>
        <div class="g">${inp('Arabe standard (avec voyelles)', 'ar', w.ar, { ar: true })}${inp('Lecture', 'lat', w.lat)}</div>
        <div class="g">${inp('Tunisien (écriture arabe)', 'tn', w.tn, { ar: true })}${inp('Tunisien (lettres latines)', 'tnLat', w.tnLat)}</div>
        ${inp('Remarque', 'note', w.note || '')}
        <div class="acts"><button class="btn small ghost" data-say>🔊 Tester</button><button class="iconbtn" data-up>⬆️</button><button class="iconbtn" data-down>⬇️</button><button class="iconbtn" data-rm>🗑️</button></div></div>`);
      bindFields(r, w);
      r.querySelector('[data-say]').onclick = () => tts.speak(w.ar);
      r.querySelector('[data-up]').onclick = () => { if (i) { [u.vocab[i - 1], u.vocab[i]] = [u.vocab[i], u.vocab[i - 1]]; drawVocab(); } };
      r.querySelector('[data-down]').onclick = () => { if (i < u.vocab.length - 1) { [u.vocab[i + 1], u.vocab[i]] = [u.vocab[i], u.vocab[i + 1]]; drawVocab(); } };
      r.querySelector('[data-rm]').onclick = async () => { if (await ask('Supprimer ce mot ?', w.fr || w.ar, { ok: 'Supprimer', danger: true })) { u.vocab.splice(i, 1); drawVocab(); } };
      vbox.append(r);
    });
  };
  const drawDia = () => {
    dbox.innerHTML = '';
    u.dialogue.forEach((l, i) => {
      const r = h(`<div class="erow"><div class="g" style="grid-template-columns:90px 1fr"><div class="field"><label>Rôle</label><select class="input" data-k="who"><option ${l.who === 'أ' ? 'selected' : ''}>أ</option><option ${l.who === 'ب' ? 'selected' : ''}>ب</option></select></div>
        ${inp('Arabe standard', 'ar', l.ar, { ar: true })}</div>
        <div class="g">${inp('Traduction française', 'fr', l.fr)}${inp('Tunisien (lettres latines)', 'tnLat', l.tnLat)}</div>
        <div class="acts"><button class="btn small ghost" data-say>🔊 Tester</button><button class="iconbtn" data-rm>🗑️</button></div></div>`);
      bindFields(r, l);
      r.querySelector('[data-say]').onclick = () => tts.speak(l.ar);
      r.querySelector('[data-rm]').onclick = () => { u.dialogue.splice(i, 1); drawDia(); };
      dbox.append(r);
    });
  };
  drawVocab(); drawDia();
  bindFields(el.querySelector('[data-main]'), u);
  bindFields(el.querySelector('[data-extra]'), u, { exercises: v => v.split('\n').map(s => s.trim()).filter(Boolean) });
  el.querySelector('[data-addw]').onclick = () => { u.vocab.push({ id: `${u.id}w${Date.now().toString(36)}`, fr: '', ar: '', lat: '', tn: '', tnLat: '' }); drawVocab(); vbox.lastElementChild.scrollIntoView({ behavior: 'smooth' }); };
  el.querySelector('[data-addl]').onclick = () => { u.dialogue.push({ who: u.dialogue.length % 2 ? 'ب' : 'أ', ar: '', fr: '', tnLat: '' }); drawDia(); };
  el.querySelectorAll('[data-h]').forEach(b => b.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!lastAr) return toast('Touche d’abord un champ en arabe');
    const s = lastAr.selectionStart ?? lastAr.value.length;
    lastAr.value = lastAr.value.slice(0, s) + b.dataset.h + lastAr.value.slice(lastAr.selectionEnd ?? s);
    lastAr.setSelectionRange(s + 1, s + 1); lastAr.dispatchEvent(new Event('input'));
  }));
  el.querySelector('[data-back]').onclick = async () => {
    if (JSON.stringify(u) !== JSON.stringify(store.content.units[editing.idx]) && !(await ask('Quitter sans enregistrer ?', 'Les changements de cette unité seront perdus.', { ok: 'Quitter', danger: true }))) return;
    editing = null; draw();
  };
  el.querySelectorAll('[data-save]').forEach(b => b.onclick = () => {
    const bad = u.vocab.filter(w => !w.fr.trim() || !w.ar.trim());
    if (bad.length) return toast('Chaque mot doit avoir un français et un arabe');
    u.vocab.forEach(w => { if (!w.note) delete w.note; if (!w.emoji) delete w.emoji; });
    const n = clone(store.content); n.units[editing.idx] = clone(u); store.saveDraft(n);
    toast('Unité enregistrée (brouillon)'); editing = null; draw();
  });
  el.querySelector('[data-del]').onclick = async () => {
    if (!(await ask('Supprimer cette unité ?', `« ${u.title} » et sa progression disparaîtront du parcours.`, { ok: 'Supprimer', danger: true }))) return;
    const n = clone(store.content); n.units.splice(editing.idx, 1); n.units.forEach((x, i) => x.num = i + 1); store.saveDraft(n); editing = null; draw();
  };
}

function bindFields(scope, obj, transforms = {}) {
  scope.querySelectorAll('[data-k]').forEach(f => {
    if (f.classList.contains('ar')) f.addEventListener('focus', () => lastAr = f);
    const k = f.dataset.k;
    const set = () => { obj[k] = transforms[k] ? transforms[k](f.value) : f.value; };
    f.addEventListener('input', set); f.addEventListener('change', set);
  });
}

/* ---------------- enfants ---------------- */
function kids(main) {
  if (!store.profiles.length) main.append(h('<p class="muted">Aucun profil pour l’instant.</p>'));
  store.profiles.forEach(p => {
    const c = h(`<div class="card" style="margin-bottom:12px"><div style="display:flex;gap:12px;align-items:center">
      <span class="avatar" style="background:${p.color}">${p.avatar}</span><input class="input" value="${esc(p.name)}" data-name style="flex:1"></div>
      <p class="muted">⚡ ${p.xp} XP · 🔥 ${store.streak(p)} jours · ${Object.keys(p.done).length} étapes · ${Object.values(p.words).filter(w => w.s >= 3).length} mots bien connus · ❤️ ${store.hearts(p) === Infinity ? '∞' : store.hearts(p)}</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px"><button class="btn small ghost" data-heal>❤️ Remplir les cœurs</button>
      <button class="btn small ghost" data-exp>⬇️ Sauvegarder la progression</button>
      <button class="btn small red" data-reset>Remettre à zéro</button><button class="btn small red" data-del>Supprimer</button></div></div>`);
    c.querySelector('[data-name]').onchange = e => { p.name = e.target.value.trim() || p.name; store.persist(); };
    c.querySelector('[data-heal]').onclick = () => { p.hearts = 5; store.persist(); toast('Cœurs remplis'); draw(); };
    c.querySelector('[data-exp]').onclick = () => download(`progression-${p.name}.json`, JSON.stringify(p));
    c.querySelector('[data-reset]').onclick = async () => { if (await ask('Remettre à zéro ?', `Toute la progression de ${p.name} sera effacée.`, { ok: 'Effacer', danger: true })) { store.resetProfile(p); draw(); } };
    c.querySelector('[data-del]').onclick = async () => { if (await ask('Supprimer ce profil ?', p.name, { ok: 'Supprimer', danger: true })) { store.removeProfile(p.id); draw(); } };
    main.append(c);
  });
  main.append(h(`<label class="btn small ghost">⬆️ Restaurer une progression<input type="file" accept=".json" hidden data-imp></label>`));
  main.querySelector('[data-imp]').onchange = async e => {
    try { const p = JSON.parse(await e.target.files[0].text()); if (!p.id || !p.words) throw 0;
      store.profiles = store.profiles.filter(x => x.id !== p.id).concat(p); store.persist(); toast('Progression restaurée'); draw(); }
    catch { toast('Fichier invalide'); }
  };
}

/* ---------------- réglages ---------------- */
function settings(main) {
  const s = store.settings;
  const voices = tts.arabicVoices();
  const sw = (k, label, help = '') => `<label class="switch"><span><b>${label}</b>${help ? `<br><small class="muted">${help}</small>` : ''}</span><input type="checkbox" data-s="${k}" ${s[k] ? 'checked' : ''}></label>`;
  main.append(h(`<div><div class="card">
    <h3>🔊 Voix arabe</h3>
    ${voices.length ? `<select class="input" data-voice style="margin-top:10px"><option value="">Automatique</option>${voices.map(v => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === s.voiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}</select>`
      : `<div class="tip">Aucune voix arabe trouvée sur cet appareil. Sur Android : <b>Paramètres › Accessibilité › Synthèse vocale</b> (ou <b>Système › Langues › Synthèse vocale</b>), moteur <b>Google</b>, puis ⚙️ › <b>Installer les données vocales</b> › Arabe. Redémarre ensuite l’appli.</div>`}
    <button class="btn blue block" data-sync style="margin-top:14px">🎚️ Synchro voix et karaoké</button>
    <p class="muted" style="margin:8px 0 0;font-size:14px">Vitesse de lecture, départ et rythme du surlignage, réglage au doigt.</p>
    <div style="display:flex;gap:10px;margin-top:10px"><button class="btn small ghost" data-test>▶️ Tester la voix</button><button class="btn small ghost" data-testtn>▶️ Tester le tunisien</button></div>
  </div>
  <div class="card" style="margin-top:14px">
    ${sw('hearts', 'Cœurs', '5 cœurs, un de moins par erreur, un revient toutes les 30 min.')}
    ${sw('sounds', 'Sons')}
    ${sw('mic', 'Exercices de prononciation (micro)', 'Reconnaissance vocale de Chrome, ne fait jamais perdre de cœur.')}
    ${sw('speakTn', 'Lire aussi le tunisien à voix haute', 'Avec la voix arabe standard : prononciation approximative.')}
    ${sw('showLat', 'Afficher la lecture en lettres latines')}
    ${sw('karaoke', 'Mode karaoké', 'Les mots s’allument au fur et à mesure de la lecture.')}
    ${sw('unlockAll', 'Débloquer tout le parcours', 'Pour sauter des étapes ou suivre le rythme des séances papa.')}
    <div class="field" style="margin-top:12px"><label>Objectif quotidien</label><select class="input" data-goal>${[10, 20, 30, 50].map(n => `<option ${n === s.dailyGoal ? 'selected' : ''} value="${n}">${n} XP par jour</option>`).join('')}</select></div>
  </div>
  <div class="card" style="margin-top:14px"><button class="btn small ghost" data-pin>Changer le code parent</button>
    <button class="btn small ghost" data-update>🔄 Rechercher une mise à jour de l’appli</button></div></div>`));
  main.querySelectorAll('[data-s]').forEach(i => i.onchange = () => { s[i.dataset.s] = i.checked; store.saveSettings(); });
  main.querySelector('[data-voice]')?.addEventListener('change', e => { s.voiceURI = e.target.value; store.saveSettings(); tts.speak('مَرْحَباً'); });
  main.querySelector('[data-sync]').onclick = () => openSync();
  main.querySelector('[data-test]').onclick = () => tts.speak('السَّلامُ عَلَيْكُم، كَيْفَ حالُكَ ؟');
  main.querySelector('[data-testtn]').onclick = () => tts.speak('عسلامة، شنيّة أحوالك ؟');
  main.querySelector('[data-goal]').onchange = e => { s.dailyGoal = +e.target.value; store.saveSettings(); };
  main.querySelector('[data-pin]').onclick = async () => { const old = store.pinHash; store.pinHash = null; if (!(await requirePin())) { store.pinHash = old; toast('Code inchangé'); } else toast('Nouveau code enregistré'); };
  main.querySelector('[data-update]').onclick = async () => {
    const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); toast('Vérification faite. Relance l’appli si une version est arrivée.');
  };
  main.querySelector('[data-s="sounds"]').addEventListener('change', () => sfx.enabled = s.sounds);
}

/* ---------------- GitHub ---------------- */
function b64encode(str) {
  const bytes = new TextEncoder().encode(str); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b) { return new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, '')), c => c.charCodeAt(0))); }

async function gh(method, url, body) {
  const g = store.github;
  const r = await fetch(`https://api.github.com/repos/${g.owner}/${g.repo}${url}`, {
    method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${g.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${j.message || ''}`);
  return j;
}

async function publish() {
  const g = store.github;
  if (!g.owner || !g.repo || !g.token) { ptab = 'github'; draw(); return toast('Configure GitHub d’abord'); }
  try {
    toast('Publication…');
    let sha;
    try { sha = (await gh('GET', `/contents/${g.path}?ref=${encodeURIComponent(g.branch)}`)).sha; } catch (e) { if (!String(e).startsWith('Error: 404')) throw e; }
    const c = clone(store.content); c.updatedAt = new Date().toISOString().slice(0, 10);
    await gh('PUT', `/contents/${g.path}`, { message: `Contenu du cours mis à jour (${c.updatedAt})`, content: b64encode(JSON.stringify(c, null, 1)), branch: g.branch, ...(sha ? { sha } : {}) });
    store.markPublished(c);
    toast('Publié ! GitHub Pages met à jour le site en 1 à 2 minutes.', 4000);
    draw();
  } catch (e) { toast('Échec : ' + e.message, 5000); }
}

function github(main) {
  const g = store.github;
  main.append(h(`<div><div class="card">
    <h3>☁️ Sauvegarde du contenu sur GitHub</h3>
    <p class="muted">Le fichier <code>content.json</code> de ton dépôt GitHub Pages est la version officielle du cours. L’éditeur le met à jour directement via l’API GitHub.</p>
    <div class="grid2">${[['owner', 'Compte GitHub', 'Wael3rd'], ['repo', 'Dépôt', 'arabe-maison'], ['branch', 'Branche', 'main'], ['path', 'Chemin du fichier', 'content.json']]
      .map(([k, l, ph]) => `<div class="field"><label>${l}</label><input class="input" data-g="${k}" value="${esc(g[k] || '')}" placeholder="${ph}"></div>`).join('')}</div>
    <div class="field"><label>Jeton d’accès (fine-grained token)</label><input class="input" type="password" data-g="token" value="${esc(g.token || '')}" placeholder="github_pat_…"></div>
    <div style="display:flex;flex-wrap:wrap;gap:10px"><button class="btn small" data-save>Enregistrer</button><button class="btn small blue" data-test>Tester la connexion</button>
      <button class="btn small ghost" data-pull>⬇️ Récupérer la version publiée</button><button class="btn small ghost" data-pub ${store.usingDraft ? '' : 'disabled'}>☁️ Publier le brouillon</button></div>
  </div>
  <div class="card md" style="margin-top:14px">${md(`**Créer le jeton (une seule fois)**

1. Sur github.com : photo de profil › **Settings** › **Developer settings** › **Personal access tokens** › **Fine-grained tokens** › **Generate new token**.
2. Nom : « arabe tablette », expiration : 1 an. **Repository access** : *Only select repositories* › ton dépôt du cours.
3. **Permissions** › Repository permissions › **Contents : Read and write**. Rien d’autre.
4. Copie le jeton ici. Il reste uniquement sur cet appareil ; le code parent protège cet écran.`)}</div></div>`));
  const read = () => { const v = { ...store.github }; main.querySelectorAll('[data-g]').forEach(i => v[i.dataset.g] = i.value.trim()); v.path = v.path || 'content.json'; v.branch = v.branch || 'main'; store.github = v; };
  main.querySelector('[data-save]').onclick = () => { read(); toast('Enregistré'); };
  main.querySelector('[data-test]').onclick = async () => {
    read();
    try { const r = await gh('GET', ''); toast(`Connexion OK : ${r.full_name}${r.permissions?.push ? ' (écriture autorisée)' : ' (lecture seule !)'}`, 4000); }
    catch (e) { toast('Échec : ' + e.message, 5000); }
  };
  main.querySelector('[data-pub]').onclick = () => { read(); publish(); };
  main.querySelector('[data-pull]').onclick = async () => {
    read();
    try {
      const f = await gh('GET', `/contents/${store.github.path}?ref=${encodeURIComponent(store.github.branch)}`);
      const c = JSON.parse(b64decode(f.content));
      if (store.usingDraft && !(await ask('Remplacer le brouillon ?', 'Ton brouillon local sera remplacé par la version publiée sur GitHub.', { ok: 'Remplacer', danger: true }))) return;
      store.markPublished(c); toast('Version publiée chargée'); draw();
    } catch (e) { toast('Échec : ' + e.message, 5000); }
  };
}
