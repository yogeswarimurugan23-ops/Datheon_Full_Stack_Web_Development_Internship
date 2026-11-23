'use strict';

/* ================= STATE ================= */
let tasks = [];                       // the single source of truth
const filters = { status: 'all', cat: 'all', sort: 'manual', view: 'all', q: '' };
let editId = null, deleteId = null, dragId = null;

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ================= STORAGE (cloud sync lives in auth.js) ================= */
const LEGACY_KEY = 'orbit.tasks.v1';     // tasks saved in this browser before accounts existed (never deleted automatically)
const uuid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
function persist() { if (window.TaskStore) window.TaskStore.save(tasks); }
function readLegacyTasks() { try { const r = JSON.parse(localStorage.getItem(LEGACY_KEY)); return Array.isArray(r) ? r : []; } catch (e) { return []; } }
window.TP = { uuid, getTasks: () => tasks, setTasks: (a) => { tasks = a; render(); }, readLegacyTasks, toast: (m, t) => toast(m, t) };

/* ================= HELPERS ================= */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const fmtDate = (s) => new Date(s + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const isOverdue = (t) => !t.done && t.due && t.due < todayStr();
const isToday = (t) => t.due === todayStr();
const isUpcoming = (t) => !t.done && t.due && t.due > todayStr();

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 300); }, 2600);
}

/* ================= FILTERING ================= */
function getVisible() {
  let list = tasks.filter((t) => {
    if (filters.status === 'active' && t.done) return false;
    if (filters.status === 'done' && !t.done) return false;
    if (filters.cat !== 'all' && t.category !== filters.cat) return false;
    if (filters.q && !t.title.toLowerCase().includes(filters.q)) return false;
    if (filters.view === 'today' && !isToday(t)) return false;
    if (filters.view === 'upcoming' && !isUpcoming(t)) return false;
    if (filters.view === 'overdue' && !isOverdue(t)) return false;
    return true;
  });
  if (filters.sort === 'due') {
    list = [...list].sort((a, b) => (a.due || '9999') .localeCompare(b.due || '9999'));
  }
  return list;
}

/* ================= RENDER ================= */
function taskHTML(t) {
  const over = isOverdue(t);
  return `<li class="task ${t.done ? 'done' : ''}" draggable="true" data-id="${t.id}">
    <button class="check" data-act="toggle" aria-label="${t.done ? 'Mark as active' : 'Mark as completed'}">
      <svg viewBox="0 0 20 20"><path d="M4 10l4 4 8-9"/></svg></button>
    <div class="body">
      <h3>${esc(t.title)}</h3>
      ${t.description ? `<p>${esc(t.description)}</p>` : ''}
      <div class="meta">
        <span class="chip c-${t.category}">${t.category}</span>
        <span class="chip p-${t.priority}">${t.priority}</span>
        <span class="muted">${t.done ? 'Completed' : 'Active'}</span>
        ${t.due ? `<span class="${over ? 'flag' : 'muted'}">${over ? 'Overdue · ' : ''}Due ${fmtDate(t.due)}</span>` : '<span class="muted">No due date</span>'}
      </div>
    </div>
    <div class="acts">
      <button data-act="edit">Edit</button>
      <button class="del" data-act="delete">Delete</button>
    </div></li>`;
}

function render() {
  const total = tasks.length, done = tasks.filter((t) => t.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  setNum('#s-total', total);
  setNum('#s-active', total - done);
  setNum('#s-done', done);
  setNum('#s-pct', pct, '%');
  $('#barFill').style.width = pct + '%';
  $('.bar').setAttribute('aria-valuenow', pct);

  setNum('#s-over', tasks.filter(isOverdue).length);
  renderAnalytics();
  if (window.heroSync) window.heroSync();
  $('#n-all').textContent = total;
  $('#n-today').textContent = tasks.filter(isToday).length;
  $('#n-upcoming').textContent = tasks.filter(isUpcoming).length;
  $('#n-overdue').textContent = tasks.filter(isOverdue).length;

  const recent = [...tasks].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);
  $('#recent').innerHTML = recent.length
    ? recent.map((t) => `<li><span class="${t.done ? 'done-t' : ''}">${esc(t.title)}</span><small>${t.category}</small></li>`).join('')
    : '<li class="muted">Nothing yet. Add your first task to get started.</li>';

  const list = getVisible();
  $('#list').innerHTML = list.map(taskHTML).join('');
  $('#empty').hidden = list.length > 0;
  $('#emptyMsg').textContent = tasks.length
    ? 'No tasks match these filters. Try clearing the search or filters.'
    : 'Your space is clear. Use Quick Add Task to create your first task.';
}

/* ================= CRUD ================= */
function openForm(id = null) {
  editId = id;
  const t = tasks.find((x) => x.id === id);
  $('#dialogTitle').textContent = t ? 'Edit task' : 'New task';
  $('#f-title').value = t ? t.title : '';
  $('#f-desc').value = t ? t.description : '';
  $('#f-cat').value = t ? t.category : 'Work';
  $('#f-pri').value = t ? t.priority : 'Medium';
  $('#f-due').value = t ? t.due : '';
  $('#formError').textContent = '';
  $('#taskDialog').showModal();
  $('#f-title').focus();
}

function saveTask(e) {
  e.preventDefault();
  const title = $('#f-title').value.trim();
  if (!title) { $('#formError').textContent = 'Enter a task title to save.'; return; }
  const data = { title, description: $('#f-desc').value.trim(), category: $('#f-cat').value, priority: $('#f-pri').value, due: $('#f-due').value };
  if (editId) {                                              // UPDATE
    Object.assign(tasks.find((x) => x.id === editId), data);
    toast('Task updated');
  } else {                                                   // CREATE
    tasks.unshift({ id: uuid(), done: false, createdAt: Date.now(), ...data });
    toast('Task added');
  }
  persist();
  $('#taskDialog').close();
  render();
}

function toggleTask(id) {
  const t = tasks.find((x) => x.id === id);
  t.done = !t.done; t.completedAt = t.done ? Date.now() : null;
  persist();
  render();
  if (t.done) {
    const li = document.querySelector(`.task[data-id="${id}"]`);
    if (li) li.classList.add('just-done');
    toast('Task completed');
  } else toast('Task marked active');
}

function askDelete(id) {
  deleteId = id;
  $('#confirmText').textContent = `"${tasks.find((x) => x.id === id).title}" will be removed permanently.`;
  $('#confirmDialog').showModal();
}

function confirmDelete() {
  const id = deleteId;
  $('#confirmDialog').close();
  const li = document.querySelector(`.task[data-id="${id}"]`);
  const finish = () => { tasks = tasks.filter((x) => x.id !== id); persist(); render(); toast('Task deleted'); };
  if (li) { li.classList.add('removing'); setTimeout(finish, 350); } else finish();
}

function clearCompleted() {
  const n = tasks.filter((t) => t.done).length;
  if (!n) { toast('No completed tasks to clear'); return; }
  tasks = tasks.filter((t) => !t.done);
  persist(); render();
  toast(`Cleared ${n} completed task${n > 1 ? 's' : ''}`);
}

/* ================= EVENTS ================= */
function bindEvents() {
  $('#quickAdd').onclick = () => openForm();
  $('#taskForm').addEventListener('submit', saveTask);
  $('#cancelBtn').onclick = () => $('#taskDialog').close();
  $('#confirmNo').onclick = () => $('#confirmDialog').close();
  $('#confirmYes').onclick = confirmDelete;
  $('#clearDone').onclick = clearCompleted;
  $('#getStarted').onclick = () => { $('#tasksSection').scrollIntoView({ behavior: 'smooth' }); setTimeout(() => openForm(), 600); };
  $$('#links a').forEach((a) => a.addEventListener('click', () => document.body.classList.remove('menu-open')));

  $('#search').addEventListener('input', (e) => { filters.q = e.target.value.trim().toLowerCase(); render(); });
  $('#catFilter').onchange = (e) => { filters.cat = e.target.value; render(); };
  $('#sortBy').onchange = (e) => { filters.sort = e.target.value; render(); };

  $$('.tab').forEach((b) => b.onclick = () => {
    filters.status = b.dataset.status;
    $$('.tab').forEach((x) => x.classList.toggle('active', x === b));
    render();
  });
  $$('.nav').forEach((b) => b.onclick = () => {
    filters.view = b.dataset.view;
    $$('.nav').forEach((x) => x.classList.toggle('active', x === b));
    $('#listTitle').textContent = b.firstChild.textContent.trim() + (b.dataset.view === 'all' ? '' : ' tasks');
    document.body.classList.remove('menu-open');
    render();
    $('#tasksSection').scrollIntoView({ behavior: 'smooth' });
  });

  $('#menuBtn').onclick = () => document.body.classList.add('menu-open');
  $('#scrim').onclick = () => document.body.classList.remove('menu-open');

  // Task list actions (event delegation)
  const list = $('#list');
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const id = btn.closest('.task').dataset.id;
    if (btn.dataset.act === 'toggle') toggleTask(id);
    if (btn.dataset.act === 'edit') openForm(id);
    if (btn.dataset.act === 'delete') askDelete(id);
  });

  // Drag and drop reordering
  list.addEventListener('dragstart', (e) => {
    const li = e.target.closest('.task'); if (!li) return;
    if (filters.sort !== 'manual') { e.preventDefault(); toast('Switch to Manual order to reorder tasks'); return; }
    dragId = li.dataset.id; li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId);
  });
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    $$('.task.over').forEach((x) => x.classList.remove('over'));
    const li = e.target.closest('.task'); if (li && li.dataset.id !== dragId) li.classList.add('over');
  });
  list.addEventListener('drop', (e) => {
    e.preventDefault();
    const target = e.target.closest('.task');
    if (!target || !dragId || target.dataset.id === dragId) return;
    const from = tasks.findIndex((t) => t.id === dragId);
    const [moved] = tasks.splice(from, 1);
    tasks.splice(tasks.findIndex((t) => t.id === target.dataset.id), 0, moved);
    persist(); render(); toast('Task order saved');
  });
  list.addEventListener('dragend', () => { dragId = null; $$('.task').forEach((x) => x.classList.remove('dragging', 'over')); });

  // Close dialogs when clicking the backdrop
  $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
}

/* ================= VISUAL EFFECTS ================= */
function initEffects() {
  // Ripple on every button
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.btn,.tab,.acts button');
    if (!b) return;
    const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2;
    const span = document.createElement('span');
    span.className = 'ripple';
    span.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
    b.style.position = b.style.position || 'relative';
    b.appendChild(span); setTimeout(() => span.remove(), 600);
  });

  if (!matchMedia('(hover:hover) and (pointer:fine)').matches) return;   // desktop-only effects

  // Smooth cursor glow
  const glow = $('#glow'); let gx = 0, gy = 0, tx = 0, ty = 0;
  addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; glow.style.opacity = 1; });
  (function follow() { gx += (tx - gx) * 0.12; gy += (ty - gy) * 0.12; glow.style.transform = `translate(${gx}px,${gy}px)`; requestAnimationFrame(follow); })();

  // Magnetic buttons + 3D card tilt
  document.addEventListener('pointermove', (e) => {
    const m = e.target.closest('.magnetic');
    $$('.magnetic').forEach((el) => { if (el !== m) el.style.transform = ''; });
    if (m) { const r = m.getBoundingClientRect(); m.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.18}px,${(e.clientY - r.top - r.height / 2) * 0.25}px)`; }
    const card = e.target.closest('.tilt, .task');
    $$('.tilt, .task').forEach((el) => { if (el !== card) { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); } });
    if (card) {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--ry', ((e.clientX - r.left) / r.width - 0.5) * 8 + 'deg');
      card.style.setProperty('--rx', (0.5 - (e.clientY - r.top) / r.height) * 8 + 'deg');
    }
  });
}

/* ================= ANALYTICS ================= */
const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function setNum(sel, v, suf = '') {                      // animated counter (one animation per element)
  const el = $(sel), from = parseInt(el.textContent) || 0;
  cancelAnimationFrame(el._raf);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || from === v) { el.textContent = v + suf; return; }
  let t0 = null;
  const step = (t) => { if (t0 === null) t0 = t; const p = Math.min(Math.max((t - t0) / 600, 0), 1);
    el.textContent = Math.round(from + (v - from) * p) + suf; if (p < 1) el._raf = requestAnimationFrame(step); };
  el._raf = requestAnimationFrame(step);
}
function weekData() {
  return [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); const k = dayKey(d);
    return { label: d.toLocaleDateString(undefined, { weekday: 'short' }), c: tasks.filter((t) => dayKey(t.createdAt) === k).length,
      d: tasks.filter((t) => t.completedAt && dayKey(t.completedAt) === k).length }; });
}
function renderAnalytics() {
  const data = weekData(), max = Math.max(1, ...data.map((x) => Math.max(x.c, x.d)));
  const html = data.map((x) => `<div class="col" title="${x.label}: ${x.c} created, ${x.d} completed"><div class="bars"><i class="b1" style="height:${x.c / max * 100}%"></i><i class="b2" style="height:${x.d / max * 100}%"></i></div><small>${x.label}</small></div>`).join('');
  $('#chart').innerHTML = html; $('#chart2').innerHTML = html;
  const up = tasks.filter((t) => !t.done && t.due && t.due >= todayStr()).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 5);
  $('#upcoming').innerHTML = up.length ? up.map((t) => `<li><span>${esc(t.title)}</span><small class="muted">${fmtDate(t.due)}</small></li>`).join('') : '<li class="muted">No upcoming deadlines.</li>';
  const total = tasks.length, done = tasks.filter((t) => t.done).length, pct = total ? Math.round(done / total * 100) : 0;
  $('#donut').style.setProperty('--p', pct); $('#donutPct').textContent = pct + '%';
  $('#dl1').textContent = `Completed ${done}`; $('#dl2').textContent = `Pending ${total - done}`;
  $('#cats').innerHTML = ['Work', 'Personal', 'Study'].map((c) => { const n = tasks.filter((t) => t.category === c).length;
    return `<div class="catrow"><span>${c}</span><div class="bar"><i style="width:${total ? n / total * 100 : 0}%"></i></div><b>${n}</b></div>`; }).join('');
}

function initNav() {                                     // active link indicator
  const map = { home: '#home', dashboard: '#dashboard', tasksSection: '#dashboard', analyticsSec: '#analyticsSec', about: '#about' };
  const update = () => { let cur = '#home';
    Object.keys(map).forEach((id) => { if ($('#' + id).getBoundingClientRect().top <= innerHeight * 0.35) cur = map[id]; });
    $$('#links a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === cur)); };
  addEventListener('scroll', update, { passive: true }); update();
}

/* ================= REVEAL + LOADER ================= */
function initReveal() {
  const els = $$('.reveal');
  if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
  const io = new IntersectionObserver((en) => en.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { threshold: 0.1 });
  els.forEach((e) => io.observe(e));
}

/* ================= THREE.JS HERO ================= */
function initScene() {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, mobile = innerWidth < 768;
  let renderer = null;
  try { if (window.THREE) renderer = new THREE.WebGLRenderer({ canvas: $('#bg'), alpha: true, antialias: !mobile }); } catch (e) { renderer = null; }
  if (!renderer) { document.body.classList.add('no-webgl'); return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1 : 1.75));
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100); camera.position.z = 13;

  // Reflection environment (coloured light bars baked with PMREM)
  const env = new THREE.Scene(); env.background = new THREE.Color(0x02040f);
  [[0x2f6bff, -6, 3, 2], [0x22d3ee, 6, -2, 3], [0xffffff, 0, 6, -3], [0x8b5cf6, 0, -5, 4]].forEach(([c, x, y, z]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(6, 1.2, 1.2), new THREE.MeshBasicMaterial({ color: c })); m.position.set(x, y, z); env.add(m); });
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(env).texture; pm.dispose();
  const glowLight = new THREE.PointLight(0x22d3ee, 2.5, 14); glowLight.position.set(0, -1.6, 2); scene.add(glowLight);
  const key = new THREE.DirectionalLight(0xffffff, 0.8); key.position.set(4, 5, 6); scene.add(key);

  const hero = new THREE.Group(); scene.add(hero);

  // Holographic dashboard: its screen is drawn from the REAL task data
  const sc = document.createElement('canvas'); sc.width = 640; sc.height = 400; const sx = sc.getContext('2d');
  const screenTex = new THREE.CanvasTexture(sc); let dirty = true;
  function drawScreen() {
    const total = tasks.length, done = tasks.filter((t) => t.done).length, pct = total ? Math.round(done / total * 100) : 0;
    const g = sx.createLinearGradient(0, 0, 640, 400); g.addColorStop(0, '#071336'); g.addColorStop(1, '#161046');
    sx.fillStyle = g; sx.fillRect(0, 0, 640, 400);
    sx.fillStyle = '#22d3ee'; sx.font = '700 34px sans-serif'; sx.fillText('\u2713', 24, 54);
    sx.fillStyle = '#e8eeff'; sx.font = '700 28px sans-serif'; sx.fillText('TaskPulse', 62, 52);
    sx.textAlign = 'right'; sx.fillStyle = '#b9c6ee'; sx.font = '20px sans-serif';
    sx.fillText(!total ? 'Add your first task' : pct >= 50 ? "You're doing great!" : "Let's get going!", 616, 50); sx.textAlign = 'center';
    const over = tasks.filter(isOverdue).length, tiles = [['Total Tasks', total, '#7aa2ff'], ['Active', total - done, '#22d3ee'], ['Completed', done, '#34d399'], ['Overdue', over, '#ff5c7a']];
    tiles.forEach(([l, v, c], i) => { const x = 24 + i * 150; sx.fillStyle = 'rgba(90,130,255,.16)'; sx.fillRect(x, 80, 136, 112);
      sx.fillStyle = c; sx.beginPath(); sx.arc(x + 68, 110, 12, 0, 7); sx.fill();
      sx.fillStyle = '#fff'; sx.font = '700 40px sans-serif'; sx.fillText(String(v), x + 68, 160); sx.fillStyle = '#9fb0dd'; sx.font = '17px sans-serif'; sx.fillText(l, x + 68, 182); });
    sx.fillStyle = 'rgba(90,130,255,.12)'; sx.fillRect(24, 208, 230, 170);
    sx.lineWidth = 16; sx.strokeStyle = 'rgba(255,255,255,.12)'; sx.beginPath(); sx.arc(90, 288, 46, 0, 7); sx.stroke();
    sx.strokeStyle = '#22d3ee'; sx.beginPath(); sx.arc(90, 288, 46, -Math.PI / 2, -Math.PI / 2 + 6.283 * pct / 100); sx.stroke();
    sx.fillStyle = '#fff'; sx.font = '700 26px sans-serif'; sx.fillText(pct + '%', 90, 297);
    sx.textAlign = 'left'; sx.fillStyle = '#e8eeff'; sx.font = '700 19px sans-serif'; sx.fillText('Productivity', 150, 282); sx.fillStyle = '#9fb0dd'; sx.font = '16px sans-serif'; sx.fillText('completed', 150, 306);
    const wk = weekData(), mx = Math.max(1, ...wk.map((x) => x.d)); sx.textAlign = 'center';
    wk.forEach((x, i) => { const bx = 290 + i * 48, hh = 12 + x.d / mx * 110, gr = sx.createLinearGradient(0, 370 - hh, 0, 370); gr.addColorStop(0, '#a855f7'); gr.addColorStop(1, '#2f9bff');
      sx.fillStyle = gr; sx.fillRect(bx, 366 - hh, 26, hh); sx.fillStyle = '#9fb0dd'; sx.font = '15px sans-serif'; sx.fillText(x.label, bx + 13, 392); });
    sx.textAlign = 'left'; screenTex.needsUpdate = true;
  }
  window.heroSync = () => { dirty = true; if (reduce) { frame(0); } };
  const panel = new THREE.Group(); panel.position.y = 0.5; hero.add(panel);
  panel.add(new THREE.Mesh(new THREE.BoxGeometry(4.3, 2.8, 0.14), new THREE.MeshPhysicalMaterial({ color: 0x0a1535, metalness: 1, roughness: 0.18, clearcoat: 1 })));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.5), new THREE.MeshBasicMaterial({ map: screenTex })); screen.position.z = 0.08; panel.add(screen);
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.5), new THREE.MeshPhysicalMaterial({ color: 0x9cc8ff, roughness: 0, transparent: true, opacity: 0.1, envMapIntensity: 2.5 })); cover.position.z = 0.1; panel.add(cover);

  const dark = new THREE.MeshPhysicalMaterial({ color: 0x0a1230, metalness: 1, roughness: 0.25, clearcoat: 1 });
  const neon = (c, r, y) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 10, 100), new THREE.MeshBasicMaterial({ color: c })); m.rotation.x = Math.PI / 2; m.position.y = y; hero.add(m); return m; };
  [[3.3, 3.45, 0.26, -2.35], [2.7, 2.85, 0.2, -2.15], [1.95, 2.1, 0.16, -2]].forEach(([a, b, h2, y]) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(a, b, h2, 64), dark); c.position.y = y; hero.add(c); });
  const edge = neon(0x22d3ee, 3.47, -2.3); neon(0x8b5cf6, 2.87, -2.1); neon(0x22d3ee, 2.12, -1.95);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.3, 2.4, 40, 1, true), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
  beam.position.y = -0.8; hero.add(beam);
  const gc = document.createElement('canvas'); gc.width = gc.height = 128; const gg = gc.getContext('2d'), gr = gg.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(34,211,238,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); gg.fillStyle = gr; gg.fillRect(0, 0, 128, 128);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(gc), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pool.rotation.x = -Math.PI / 2; pool.position.y = -2.1; hero.add(pool);
  // Low-poly rocks around the platform
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x0b1535, metalness: 0.5, roughness: 0.55, flatShading: true });
  for (let i = 0; i < (mobile ? 8 : 16); i++) { const r = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5 + Math.random() * 0.9, 0), rockMat), a = Math.random() * 6.283, d = 3.9 + Math.random() * 2.6;
    r.position.set(Math.cos(a) * d, -2.9 + Math.random() * 0.4, Math.sin(a) * d - 1); r.scale.y = 0.6 + Math.random() * 0.5; r.rotation.set(Math.random() * 3, Math.random() * 3, 0); hero.add(r); }

  const rings = [0x22d3ee, 0x2f6bff, 0x8b5cf6].map((c, i) => {
    const r = new THREE.Mesh(new THREE.TorusGeometry(3.4 + i * 0.45, 0.025, 12, mobile ? 72 : 140), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending }));
    r.rotation.set(1.35 + i * 0.28, i * 0.6, 0); r.position.y = 0.3; hero.add(r); return r; });

  // Floating 3D props: checklist, calendar + clock, hourglass, target, crystals
  const floaters = [], place = (o, x, y, z, ry = 0, rz = 0) => { o.position.set(x, y, z); o.rotation.y = ry; o.rotation.z = rz; hero.add(o); floaters.push({ o, y, ry, p: Math.random() * 6 }); return o; };
  const tex = (w, h2, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h2; draw(c.getContext('2d')); return new THREE.CanvasTexture(c); };
  const slab = (w, h2, map) => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h2, 0.1), new THREE.MeshPhysicalMaterial({ color: 0x1a3fa8, metalness: 0.6, roughness: 0.15, clearcoat: 1 })));
    const f = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, h2 * 0.9), new THREE.MeshBasicMaterial({ map, transparent: true })); f.position.z = 0.06; g.add(f); return g; };
  place(slab(1.2, 1.6, tex(128, 170, (g) => { g.fillStyle = '#0d2a78'; g.fillRect(0, 0, 128, 170); g.strokeStyle = '#7fe9ff'; g.lineWidth = 8; g.lineCap = 'round';
    [30, 75, 120].forEach((y) => { g.beginPath(); g.moveTo(14, y); g.lineTo(24, y + 10); g.lineTo(40, y - 8); g.stroke(); g.beginPath(); g.moveTo(56, y); g.lineTo(112, y); g.stroke(); }); })), -3.5, 2.5, 0.4, 0.5, 0.2);
  const cal = slab(1.5, 1.3, tex(160, 140, (g) => { g.fillStyle = '#1b3fb5'; g.fillRect(0, 0, 160, 140); const cs = ['#4f8bff', '#8b5cf6', '#22d3ee', '#a855f7'];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) { g.fillStyle = cs[(r + c) % 4]; g.fillRect(12 + c * 36, 30 + r * 34, 28, 26); } }));
  const clock = new THREE.Mesh(new THREE.CircleGeometry(0.38, 32), new THREE.MeshBasicMaterial({ map: tex(128, 128, (g) => { g.fillStyle = '#0e3a8a'; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill(); g.strokeStyle = '#7fe9ff'; g.lineWidth = 8; g.stroke(); g.lineCap = 'round'; g.beginPath(); g.moveTo(64, 28); g.lineTo(64, 64); g.lineTo(88, 76); g.stroke(); }) }));
  clock.position.set(0.7, -0.5, 0.1); cal.add(clock); place(cal, 3.5, 2.8, -0.3, -0.5, -0.12);
  const hg = new THREE.Group(), glass = new THREE.MeshPhysicalMaterial({ color: 0x9cc8ff, roughness: 0, transparent: true, opacity: 0.28, envMapIntensity: 2.5, side: THREE.DoubleSide });
  hg.add(new THREE.Mesh(new THREE.LatheGeometry([[0.01, -1], [0.62, -0.95], [0.62, -0.55], [0.07, 0], [0.62, 0.55], [0.62, 0.95], [0.01, 1]].map(([x, y]) => new THREE.Vector2(x, y)), 28), glass));
  [-1, 1].forEach((y) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.14, 28), dark); c.position.y = y; hg.add(c); });
  const sand = new THREE.MeshStandardMaterial({ color: 0xffb27a, emissive: 0xff7a3a, emissiveIntensity: 0.5 });
  const s1 = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.6, 20), sand); s1.position.y = -0.65; const s2 = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.4, 20), sand); s2.position.y = 0.55; s2.rotation.x = Math.PI; hg.add(s1, s2);
  hg.scale.setScalar(0.85); place(hg, -3.7, -0.7, 1.2, 0.3, -0.35);
  const tg = new THREE.Group(); [[0.95, 0x6d4bff], [0.7, 0xe8eeff], [0.45, 0x6d4bff], [0.2, 0x22d3ee]].forEach(([r, c], i) => { const d = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.12, 40), new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.4, roughness: 0.2, clearcoat: 1 })); d.rotation.x = Math.PI / 2; d.position.z = i * 0.015; tg.add(d); });
  const arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 8), new THREE.MeshBasicMaterial({ color: 0x22d3ee })); arrow.rotation.set(0.9, 0, 0.9); arrow.position.set(0.4, 0.4, 0.55); tg.add(arrow);
  place(tg, 4.1, -0.7, 0.6, -0.6);
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0x5be7ff, emissive: 0x0b6ea0, metalness: 0.3, roughness: 0.1, flatShading: true });
  [[-2.3, -1.4, 2.2, 0.32], [4.4, 1.9, -1, 0.22], [4.6, -2.3, 1.6, 0.26], [2.2, 3.4, -1.2, 0.18]].forEach(([x, y, z, sc2]) => { const c = new THREE.Mesh(new THREE.OctahedronGeometry(sc2), crystalMat); c.scale.y = 1.5; place(c, x, y, z); });

  // Particles
  const n = mobile ? 180 : 520, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, r = 3 + Math.random() * 4; pos.set([Math.cos(a) * r, (Math.random() - 0.5) * 6, Math.sin(a) * r], i * 3); }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x9fd8ff, size: 0.05, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending })); hero.add(dust);

  let mx = 0, my = 0, smx = 0, smy = 0, sp = 0, running = true;
  addEventListener('pointermove', (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; });
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize); resize();

  function frame(t) {
    if (dirty) { drawScreen(); dirty = false; }
    const s = Math.min(scrollY / innerHeight, 1.6); sp += (s - sp) * 0.08; smx += (mx - smx) * 0.05; smy += (my - smy) * 0.05;
    const wide = innerWidth > 900, k = mobile ? 0.62 : 1;
    // scroll transform: the whole scene drifts back, shrinks and turns as you scroll down
    hero.position.set(wide ? 3.1 * (1 - Math.min(sp, 1)) : 0, (wide ? 0 : 1.6) + sp * 1.5, -sp * 6);
    hero.scale.setScalar(k * (1 - sp * 0.25));
    hero.rotation.set(smy * 0.3 + sp * 0.5 + 0.12, smx * 0.7 + sp * 1.3, 0);
    panel.position.y = 0.5 + Math.sin(t / 1300) * 0.18; panel.rotation.set(0.05, -0.3 + Math.sin(t / 3200) * 0.15, -0.04);
    rings.forEach((r, i) => { r.rotation.z = t / (3200 + i * 900) * (i % 2 ? -1 : 1); });
    floaters.forEach((f) => { f.o.position.y = f.y + Math.sin(t / 1000 + f.p) * 0.2; f.o.rotation.y = f.ry + Math.sin(t / 2500 + f.p) * 0.3; });
    dust.rotation.y = t / 9000; beam.material.opacity = 0.1 + Math.sin(t / 700) * 0.03;
    $('#bg').style.opacity = Math.max(0.3, 1 - sp * 0.6);
    renderer.render(scene, camera);
  }
  const loop = (t) => { if (!running) return; frame(t); requestAnimationFrame(loop); };
  if (reduce) { frame(0); addEventListener('scroll', () => frame(0)); addEventListener('resize', () => frame(0)); }
  else { requestAnimationFrame(loop); document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) requestAnimationFrame(loop); }); }
}

/* ================= INIT ================= */
document.addEventListener('DOMContentLoaded', () => {
  $('#today-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  bindEvents();
  render();
  initEffects();
  initScene();
  initReveal();
  initNav();
  setTimeout(() => document.body.classList.add('ready'), 900);
});
