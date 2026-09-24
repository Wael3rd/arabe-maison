// Écrans de l'application enfant : profils, parcours, entraînement, ligue, profil.
import { $, esc, h, md, modal, toast, mascot, confetti, sfx, todayKey, weekKey, arWrap } from './util.js';
import { store } from './store.js';
import { tts } from './tts.js';
import { nodeState, buildSession, runSession, nodeXp, unitNodes } from './engine.js';
import { openParent, requirePin } from './parent.js';

const AVATARS = ['🦊', '🐱', '🐼', '🦁', '🐸', '🐧', '🦄', '🐯', '🐨', '🐙', '🦉', '🐬'];
const PCOLORS = ['#FFE3C2', '#D7F5E6', '#DDF0FB', '#F1ECFF', '#FFE3E4', '#FFF4C2'];
let tab = 'path';

const app = () => document.getElementById('app');

async function boot() {
  try { await store.loadContent(); }
  catch (e) { app().innerHTML = `<div class="profiles">${mascot('sad', 'mascot-l')}<h1>Impossible de charger les leçons</h1><p class="muted">Connecte la tablette à Internet une première fois.</p></div>`; return; }
  sfx.enabled = store.settings.sounds;
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  store.me ? render() : profilesScreen();
}

/* ---------------- profils ---------------- */
function profilesScreen() {
  const ps = store.profiles;
  app().innerHTML = '';
  const el = h(`<div class="profiles">${mascot('happy', 'mascot-l')}
    <h1>${ps.length ? 'Qui joue ?' : 'Bienvenue !'}</h1>
    ${ps.length ? '' : '<p class="muted" style="max-width:420px">Crée un profil pour chaque enfant : chacun aura sa progression, ses XP et sa série.</p>'}
    <div class="plist">${ps.map(p => `<button class="pcard" data-id="${p.id}"><span class="avatar" style="background:${p.color}">${p.avatar}</span>${esc(p.name)}<small>🔥 ${store.streak(p)} · ⚡ ${p.xp} XP</small></button>`).join('')}
      ${ps.length < 4 ? `<button class="pcard" data-new><span class="avatar" style="background:#F2EEE7">➕</span>Nouveau<small>profil</small></button>` : ''}</div>
    ${ps.length ? '<button class="link" data-parent>🔒 Espace parent</button>' : ''}</div>`);
  app().append(el);
  el.querySelectorAll('[data-id]').forEach(b => b.onclick = () => { store.select(b.dataset.id); tab = 'path'; render(); });
  el.querySelector('[data-new]')?.addEventListener('click', newProfile);
  el.querySelector('[data-parent]')?.addEventListener('click', () => openParent(profilesScreen));
}

function newProfile() {
  let av = AVATARS[store.profiles.length % AVATARS.length], col = PCOLORS[store.profiles.length % PCOLORS.length];
  const m = modal(`<h2>Nouveau profil</h2>
    <div class="field"><label>Prénom</label><input class="input" maxlength="20" data-n placeholder="Prénom"></div>
    <div class="field"><label>Avatar</label><div class="pick" data-av>${AVATARS.map(a => `<button class="${a === av ? 'on' : ''}" style="background:#F6F2EA">${a}</button>`).join('')}</div></div>
    <div class="field"><label>Couleur</label><div class="pick" data-col>${PCOLORS.map(c => `<button class="${c === col ? 'on' : ''}" style="background:${c}" data-c="${c}"></button>`).join('')}</div></div>
    <div class="row"><button class="btn ghost" data-x>Annuler</button><button class="btn" data-ok>Créer</button></div>`);
  m.querySelectorAll('[data-av] button').forEach(b => b.onclick = () => { av = b.textContent; m.querySelectorAll('[data-av] button').forEach(x => x.classList.toggle('on', x === b)); });
  m.querySelectorAll('[data-col] button').forEach(b => b.onclick = () => { col = b.dataset.c; m.querySelectorAll('[data-col] button').forEach(x => x.classList.toggle('on', x === b)); });
  m.querySelector('[data-x]').onclick = () => m.close();
  m.querySelector('[data-ok]').onclick = () => {
    const n = m.querySelector('[data-n]').value.trim();
    if (!n) return toast('Écris un prénom');
    const p = store.addProfile(n, av, col); m.close(); store.select(p.id); render();
  };
  setTimeout(() => m.querySelector('[data-n]').focus(), 100);
}

/* ---------------- structure principale ---------------- */
export function render() {
  const p = store.me;
  if (!p) return profilesScreen();
  const hearts = store.hearts(p);
  app().innerHTML = '';
  app().append(h(`<header class="topbar">
    <button class="who" data-switch><span class="avatar" style="background:${p.color}">${p.avatar}</span><span>${esc(p.name)}</span></button>
    <span class="stat fire ${store.todayXp(p) ? '' : 'off'}" title="Série">🔥 ${store.streak(p)}</span>
    <span class="stat xp" title="XP">⚡ ${p.xp}</span>
    ${store.settings.hearts ? `<span class="stat heart" title="Cœurs">❤️ ${hearts}</span>` : ''}
  </header>`));
  const main = h('<main class="main"></main>');
  app().append(main);
  ({ path: pathTab, practice: practiceTab, league: leagueTab, me: meTab })[tab](main);
  const nav = h(`<nav class="tabbar">${[['path', '🗺️', 'Parcours'], ['practice', '🏋️', 'Entraîne-toi'], ['league', '🏅', 'Ligue'], ['me', '🙂', 'Profil']]
    .map(([k, e, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}"><span>${e}</span>${l}</button>`).join('')}</nav>`);
  app().append(nav);
  nav.querySelectorAll('button').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); window.scrollTo(0, 0); });
  $('[data-switch]').onclick = () => { store.select(null); profilesScreen(); };
  if (store.usingDraft) main.prepend(h('<div class="tip" style="margin-top:0">✏️ Brouillon local actif : les modifications ne sont pas encore publiées sur GitHub.</div>'));
}

/* ---------------- onglet parcours ---------------- */
const SEANCES = {
  2: ['📖', 'Mardi : séance de 20 min avec papa', 'Lecture du vocabulaire à voix haute et premier dialogue.'],
  4: ['✍️', 'Jeudi : séance de 20 min avec papa', 'Écriture dans le cahier : copier, compléter, associer.'],
  6: ['🗣️', 'Samedi : la grande séance de 45 min', 'Oral, cahier fermé : jeux, dialogue en tunisien et défi de la semaine.'],
};

function pathTab(main) {
  const c = store.content, p = store.me;
  const { list, state, current } = nodeState(c, p);
  const goal = store.settings.dailyGoal, tx = store.todayXp(p);
  const cur = list.find(n => n.id === current);
  main.append(h(`<div class="card today"><div class="ring" style="--p:${Math.min(100, tx / goal * 100)}"><b>${tx}/${goal}</b></div>
    <div style="flex:1"><b>${tx >= goal ? 'Objectif du jour atteint ! 🎉' : 'Objectif du jour'}</b><div class="muted">${tx >= goal ? 'Tu peux continuer pour la ligue.' : `Encore ${goal - tx} XP aujourd'hui`}</div></div>
    ${cur ? '<button class="btn small" data-cont>Continuer</button>' : ''}</div>`));
  const s = SEANCES[new Date().getDay()];
  if (s) main.append(h(`<div class="seance"><span class="e">${s[0]}</span><div><b>${s[1]}</b><div class="muted">${s[2]}</div></div></div>`));
  main.querySelector('[data-cont]')?.addEventListener('click', () => openNode(cur));

  let offset = 0;
  for (const u of c.units) {
    const nodes = list.filter(n => n.unit === u);
    main.append(h(`<div class="unit-banner" style="background:${u.color}">
      <div><div class="n">Unité ${u.num}</div><h2>${esc(u.title)}</h2></div>
      <button class="guide" data-guide="${u.id}">📘 <b>Guide</b></button></div>`));
    const path = h('<div class="path"></div>');
    nodes.forEach(nd => {
      const st = state[nd.id];
      const x = Math.round(Math.sin(offset++ * 0.9) * 90);
      const wrap = h(`<div style="transform:translateX(${x}px)"><button class="node ${st === 'locked' ? 'locked' : ''} ${st === 'done' ? 'done' : ''} ${st === 'current' ? 'current' : ''}"
        style="--c:${u.color}" aria-label="${esc(nd.label)}">${st === 'locked' ? '🔒' : nd.icon}${st === 'current' ? `<span class="start">${nd === list[0] && !Object.keys(p.done).length ? 'Commencer' : 'Ici'}</span>` : ''}</button></div>`);
      wrap.firstElementChild.onclick = () => openNode(nd, st);
      path.append(wrap);
    });
    main.append(path);
  }
  main.querySelectorAll('[data-guide]').forEach(b => b.onclick = () => openGuide(c.units.find(u => u.id === b.dataset.guide)));
  setTimeout(() => main.querySelector('.node.current')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 200);
}

function openNode(nd, st) {
  if (!nd) return;
  st = st || nodeState(store.content).state[nd.id];
  const u = nd.unit, xp = st === 'done' ? 5 : nodeXp(nd);
  if (st === 'locked') {
    const m = modal(`<h2>${nd.icon} ${esc(nd.label)}</h2><p class="muted">Termine les étapes d'avant pour débloquer celle-ci.</p>
      <div class="row"><button class="btn ghost" data-x>OK</button></div>`);
    m.querySelector('[data-x]').onclick = () => m.close();
    return;
  }
  if (nd.type === 'defi') return openDefi(nd, st);
  if (nd.type === 'checklist') return openChecklist(nd, st);
  const m = modal(`<div class="muted" style="font-weight:800">UNITÉ ${u.num} · ${esc(u.title)}</div>
    <h2>${nd.icon} ${esc(nd.label)}</h2>
    <p class="muted">${nd.type === 'learn' ? `${nd.words.length} nouveaux mots : ${nd.words.map(w => esc(w.fr)).join(', ')}` : nd.type === 'tn' ? 'Passe de l\'arabe standard au tunisien de la maison.' : nd.type === 'dialogue' ? 'Construis les phrases du dialogue.' : 'Un mélange de tout ce que tu as appris.'}</p>
    <button class="btn block" data-start style="margin-top:12px">${st === 'done' ? 'Refaire' : 'Commencer'} +${xp} XP</button>`);
  m.querySelector('[data-start]').onclick = () => { m.close(); startNode(nd, st); };
}

function noHearts() {
  const wait = Math.ceil(store.nextHeartIn() / 60e3);
  const m = modal(`<div style="text-align:center">${mascot('sad', 'mascot-l')}</div><h2>Plus de cœurs !</h2>
    <p class="muted">Un cœur revient dans ${wait} min. Ou entraîne-toi sur tes mots pour en regagner un tout de suite.</p>
    <div class="row"><button class="btn ghost" data-x>Attendre</button><button class="btn blue" data-p>S'entraîner</button></div>`);
  m.querySelector('[data-x]').onclick = () => m.close();
  m.querySelector('[data-p]').onclick = () => { m.close(); startPractice(); };
}

function startNode(nd, st) {
  if (store.settings.hearts && store.hearts() <= 0) return noHearts();
  const ex = buildSession(nd, store.content);
  if (!ex.length) return toast('Pas encore d’exercices ici');
  runSession(ex, { onEnd: r => {
    if (!r) return render();
    if (!r.success) return endScreen({ fail: true });
    const before = store.todayXp();
    const xp = (st === 'done' ? 5 : nodeXp(nd)) + (r.mistakes === 0 ? 5 : 0);
    store.addXp(xp); store.complete(nd.id);
    endScreen({ xp, r, goalHit: before < store.settings.dailyGoal && store.todayXp() >= store.settings.dailyGoal });
  } });
}

function practicePool() {
  const c = store.content, p = store.me;
  const seen = c.units.flatMap(u => unitNodes(u)).filter(n => n.type === 'learn' && store.isDone(n.id, p)).flatMap(n => n.words);
  return seen.length >= 4 ? seen : c.units[0].vocab;
}
function startPractice() {
  const ex = buildSession(null, store.content, { practice: true, pool: practicePool() });
  runSession(ex, { practice: true, onEnd: r => {
    if (!r) return render();
    const before = store.todayXp();
    store.addXp(10); store.gainHeart();
    endScreen({ xp: 10, r, heart: true, goalHit: before < store.settings.dailyGoal && store.todayXp() >= store.settings.dailyGoal });
  } });
}

function endScreen({ xp, r, fail, heart, goalHit }) {
  const el = fail
    ? h(`<div class="endscreen">${mascot('sad', 'mascot-l')}<h1 style="color:var(--red)">Plus de cœurs…</h1>
        <p class="muted">Ce n'est pas grave, on apprend en se trompant ! Entraîne-toi pour regagner un cœur.</p>
        <button class="btn block" style="max-width:360px">Continuer</button></div>`)
    : h(`<div class="endscreen">${mascot('happy', 'mascot-l')}<h1>${r.mistakes === 0 ? 'Leçon parfaite !' : 'Leçon terminée !'}</h1>
        <div class="stats">
          <div class="st" style="--c:var(--gold-d)"><div>XP gagnés</div><div>⚡ ${xp}</div></div>
          <div class="st" style="--c:var(--green)"><div>Précision</div><div>🎯 ${Math.max(0, Math.round(100 * r.total / (r.total + r.mistakes)))}%</div></div>
          <div class="st" style="--c:var(--blue)"><div>Temps</div><div>⏱️ ${Math.floor(r.seconds / 60)}:${String(r.seconds % 60).padStart(2, '0')}</div></div>
        </div>
        ${heart ? '<p><b>❤️ +1 cœur regagné !</b></p>' : ''}${goalHit ? '<p><b>🎉 Objectif du jour atteint !</b></p>' : ''}
        <p class="muted">🔥 Série : ${store.streak()} jour${store.streak() > 1 ? 's' : ''}</p>
        <button class="btn block" style="max-width:360px">Continuer</button></div>`);
  document.body.append(el);
  if (!fail) { sfx.win(); confetti(); }
  el.querySelector('.btn').onclick = () => { el.remove(); render(); };
}

/* ---------------- guide d'unité ---------------- */
export function openGuide(u) {
  const vrow = w => `<div class="vrow"><span class="emo">${w.emoji || ''}</span><div class="fr">${esc(w.fr)}<small>${esc(w.lat)}${w.tnLat ? ` · 🇹🇳 ${esc(w.tnLat)}` : ''}</small></div>
    <span class="ar">${esc(w.ar)}</span><button class="speak" data-say="${esc(w.ar)}">🔊</button></div>`;
  const m = modal(`<div class="muted" style="font-weight:800">GUIDE · UNITÉ ${u.num}</div><h2>${u.icon} ${esc(u.title)}</h2>
    <p>${esc(u.goal)}</p>
    ${u.notes ? `<div class="tip md">💡 ${md(u.notes)}</div>` : ''}
    ${u.vocab?.length ? `<h3 class="section-t">Vocabulaire</h3><div class="vocab-list">${u.vocab.map(vrow).join('')}</div>` : ''}
    ${u.dialogue?.length ? `<h3 class="section-t">Dialogue</h3><div class="vocab-list">${u.dialogue.map(l => `<div class="vrow"><b>${esc(l.who)}</b><div class="fr">${esc(l.fr)}<small>🇹🇳 ${esc(l.tnLat)}</small></div><span class="ar" style="font-size:22px;max-width:55%">${esc(l.ar)}</span><button class="speak" data-say="${esc(l.ar)}">🔊</button></div>`).join('')}</div>` : ''}
    ${u.dialogueNote ? `<div class="md muted">${md(u.dialogueNote)}</div>` : ''}
    <div class="row"><button class="btn ghost" data-x>Fermer</button></div>`);
  m.querySelectorAll('[data-say]').forEach(b => b.onclick = () => tts.speak(b.dataset.say));
  m.querySelector('[data-x]').onclick = () => m.close();
}

/* ---------------- défi & auto-évaluation (validés par papa) ---------------- */
function openDefi(nd, st) {
  const u = nd.unit;
  const m = modal(`<div style="text-align:center;font-size:64px">🎁</div><h2>Défi de la semaine · Unité ${u.num}</h2>
    <div class="md">${md(u.defi)}</div>
    <p class="muted">Le défi se lance le samedi et dure toute la semaine. Quand il est réussi, papa le valide.</p>
    <div class="row"><button class="btn ghost" data-x>Plus tard</button>${st === 'done' ? '<button class="btn" disabled>Validé ✓</button>' : `<button class="btn gold" data-ok>Papa valide (+${nodeXp(nd)} XP)</button>`}</div>`);
  m.querySelector('[data-x]').onclick = () => m.close();
  m.querySelector('[data-ok]')?.addEventListener('click', async () => {
    if (!(await requirePin())) return;
    m.close(); store.addXp(nodeXp(nd)); store.complete(nd.id); sfx.win(); confetti(); toast(`Défi validé ! +${nodeXp(nd)} XP`); render();
  });
}

function openChecklist(nd, st) {
  const u = nd.unit, p = store.me;
  p.checks = p.checks || {};
  const m = modal(`<h2>✅ Auto-évaluation</h2><p class="muted">Coche ce que tu sais faire. Papa valide à l'oral.</p>
    <div>${u.checklist.map((c, i) => `<label class="switch"><span>${esc(c)}</span><input type="checkbox" data-i="${i}" ${p.checks[u.id + i] ? 'checked' : ''}></label>`).join('')}</div>
    <div class="row"><button class="btn ghost" data-x>Fermer</button>${st === 'done' ? '<button class="btn" disabled>Validé ✓</button>' : `<button class="btn gold" data-ok>Papa valide (+${nodeXp(nd)} XP)</button>`}</div>`);
  m.querySelectorAll('input').forEach(i => i.onchange = () => { p.checks[u.id + i.dataset.i] = i.checked; store.persist(); });
  m.querySelector('[data-x]').onclick = () => m.close();
  m.querySelector('[data-ok]')?.addEventListener('click', async () => {
    if (u.checklist.some((_, i) => !p.checks[u.id + i])) return toast('Coche toutes les cases d’abord');
    if (!(await requirePin())) return;
    m.close(); store.addXp(nodeXp(nd)); store.complete(nd.id); sfx.win(); confetti(); toast('Bravo, cours terminé ! 🏆'); render();
  });
}

/* ---------------- entraînement ---------------- */
function practiceTab(main) {
  const p = store.me, pool = practicePool();
  const strong = pool.filter(w => store.word(w.id).s >= 3).length;
  main.append(h(`<div class="card" style="display:flex;gap:16px;align-items:center">${mascot('happy')}
    <div style="flex:1"><h2>Entraînement personnalisé</h2><p class="muted" style="margin:4px 0 12px">Les mots que tu connais le moins bien reviennent en priorité. Gagne ❤️ +1.</p>
    <button class="btn blue" data-p>C'est parti</button></div></div>`));
  main.querySelector('[data-p]').onclick = startPractice;
  main.append(h(`<h3 class="section-t">Mes mots (${strong}/${pool.length} bien connus)</h3>`));
  const list = h('<div class="vocab-list"></div>');
  pool.slice().sort((a, b) => store.word(a.id).s - store.word(b.id).s).forEach(w => {
    const s = store.word(w.id).s;
    list.append(h(`<div class="vrow"><span class="emo">${w.emoji || ''}</span><div class="fr">${esc(w.fr)}<small>${'●'.repeat(s)}${'○'.repeat(5 - s)}</small></div><span class="ar">${esc(w.ar)}</span><button class="speak" data-say="${esc(w.ar)}">🔊</button></div>`));
  });
  main.append(list);
  main.append(h('<h3 class="section-t">Guides des unités</h3>'));
  const g = h('<div class="ulist"></div>');
  store.content.units.forEach(u => g.append(h(`<button class="card urow" data-u="${u.id}"><span class="ic">${u.icon}</span><span class="t">Unité ${u.num} · ${esc(u.title)}</span>📘</button>`)));
  main.append(g);
  main.querySelectorAll('[data-say]').forEach(b => b.onclick = () => tts.speak(b.dataset.say));
  g.querySelectorAll('[data-u]').forEach(b => b.onclick = () => openGuide(store.content.units.find(u => u.id === b.dataset.u)));
}

/* ---------------- ligue ---------------- */
function leagueTab(main) {
  const ps = [...store.profiles].sort((a, b) => store.weekXp(b) - store.weekXp(a));
  const d = new Date(); const left = 7 - ((d.getDay() + 6) % 7);
  main.append(h(`<div style="text-align:center">${mascot('wow', 'mascot-l')}<h2>Ligue de la maison</h2>
    <p class="muted">Classement des XP de la semaine · fin dans ${left} jour${left > 1 ? 's' : ''}</p></div>`));
  const medals = ['🥇', '🥈', '🥉', '4'];
  const l = h('<div class="league"></div>');
  ps.forEach((p, i) => l.append(h(`<div class="card lrow" style="${p.id === store.currentId ? 'border-color:var(--blue);background:var(--blue-l)' : ''}">
    <span class="rk">${medals[i] || i + 1}</span><span class="avatar" style="background:${p.color}">${p.avatar}</span>
    <span class="nm">${esc(p.name)}</span><span class="x">⚡ ${store.weekXp(p)} XP</span></div>`)));
  main.append(l);
  const last = new Date(); last.setDate(last.getDate() - 7);
  const lw = weekKey(last);
  const prev = [...store.profiles].sort((a, b) => store.weekXp(b, lw) - store.weekXp(a, lw));
  if (prev.some(p => store.weekXp(p, lw))) main.append(h(`<p class="muted" style="text-align:center;margin-top:20px">Semaine dernière : 🏆 ${esc(prev[0].name)} avec ${store.weekXp(prev[0], lw)} XP</p>`));
}

/* ---------------- profil ---------------- */
function meTab(main) {
  const p = store.me;
  const known = Object.values(p.words).filter(w => w.s >= 3).length;
  const lessons = Object.keys(p.done).length;
  const days = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  const monday = new Date(weekKey() + 'T12:00:00');
  store.streak(p);
  const week = days.map((d, i) => { const x = new Date(monday); x.setDate(x.getDate() + i); const k = todayKey(x);
    return `<div class="${p.days[k] ? 'on' : p.frozen[k] ? 'fz' : ''}"><i>${p.days[k] ? '🔥' : p.frozen[k] ? '🧊' : ''}</i>${d}</div>`; }).join('');
  main.append(h(`<div style="display:flex;gap:16px;align-items:center;margin-bottom:10px">
    <span class="avatar" style="background:${p.color};width:84px;height:84px;font-size:46px">${p.avatar}</span>
    <div><h2 style="font-size:26px">${esc(p.name)}</h2><div class="muted">Depuis le ${esc(p.created || '')}</div></div></div>`));
  main.append(h(`<div class="grid2">
    <div class="card kpi"><span class="e">🔥</span><div><b>${store.streak(p)}</b><small>jours de série</small></div></div>
    <div class="card kpi"><span class="e">⚡</span><div><b>${p.xp}</b><small>XP au total</small></div></div>
    <div class="card kpi"><span class="e">🧠</span><div><b>${known}</b><small>mots bien connus</small></div></div>
    <div class="card kpi"><span class="e">⭐</span><div><b>${lessons}</b><small>étapes réussies</small></div></div></div>`));
  main.append(h(`<div class="card" style="margin-top:14px"><b>Cette semaine</b> <span class="muted">· 🧊 ${p.freezes} gel${p.freezes > 1 ? 's' : ''} de série en réserve</span><div class="week" style="margin-top:10px">${week}</div></div>`));
  main.append(h(`<div style="display:grid;gap:14px;margin-top:22px">
    <button class="btn ghost block" data-sw>Changer de joueur</button>
    <button class="btn ghost block" data-parent>🔒 Espace parent</button></div>`));
  main.querySelector('[data-sw]').onclick = () => { store.select(null); profilesScreen(); };
  main.querySelector('[data-parent]').onclick = () => openParent(render);
}

boot();
