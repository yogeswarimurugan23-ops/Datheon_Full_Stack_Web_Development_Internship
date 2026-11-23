'use strict';
/* Supabase Authentication + per-user tasks in PostgreSQL (public.tasks, protected by Row Level Security). */
(function () {
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const view = $('#authView'), banner = $('#authBanner'), EMAIL = /^\S+@\S+\.\S+$/;
  const cfg = window.supabaseConfig || {};
  const configured = !!cfg.url && !!cfg.anonKey && !/PASTE_/.test(cfg.url + cfg.anonKey);
  let sb, pendingNote = '', user = null, ready = false, recovering = false, loggingOut = false, current = '', chain = Promise.resolve();
  const synced = new Map();

  const lock = (on) => { view.hidden = !on; document.body.classList.toggle('locked', on); $('#profile').hidden = on; };
  const note = (m, ok) => { banner.textContent = m; banner.className = 'banner' + (ok ? ' ok' : ''); banner.hidden = !m; };
  const clearErrs = () => $$('#authView .err').forEach((e) => { e.textContent = ''; });
  const setErr = (id, m) => { const e = document.querySelector(`[data-for="${id}"]`); if (e) e.textContent = m; };

  /* Routes: #/login, #/signup, #/forgot (+ #/update after a reset link). Exactly one form is visible. */
  const ROUTES = ['login', 'signup', 'forgot', 'update'], TITLES = { login: 'Log in', signup: 'Create account', forgot: 'Forgot password', update: 'New password' };
  const route = () => { const m = location.hash.match(/^#\/(\w+)$/); const r = m && ROUTES.includes(m[1]) ? m[1] : 'login'; return r === 'update' && !recovering ? 'login' : r; };
  const baseTitle = document.title;
  function showRoute(name, focus) {
    current = name; $$('#authView form').forEach((f) => { f.hidden = f.dataset.view !== name; }); clearErrs(); note('');
    document.title = `TaskPulse - ${TITLES[name]}`;
    if (focus) { const i = $(`#authView form[data-view="${name}"] input`); if (i) i.focus(); }
  }
  window.addEventListener('hashchange', () => { if (!view.hidden && route() !== current) showRoute(route(), true); });

  const MSG = {
    invalid_credentials: 'Incorrect email or password.',
    email_not_confirmed: 'Please confirm your email first. Check your inbox for the confirmation link.',
    user_already_exists: 'An account with this email already exists. Try logging in instead.',
    email_exists: 'An account with this email already exists. Try logging in instead.',
    weak_password: 'Password is too weak. Use at least 8 characters with a letter and a number.',
    same_password: 'Choose a password different from your current one.',
    over_request_rate_limit: 'Too many attempts. Please wait a moment and try again.',
    over_email_send_rate_limit: 'Too many emails requested. Please wait a while and try again.',
    signup_disabled: 'Sign-ups are disabled for this project.',
    validation_failed: 'Please check the details you entered.'
  };
  const authMsg = (e) => MSG[e.code] || (/fetch|network/i.test(e.message || '') || e.name === 'AuthRetryableFetchError' ? 'Network error. Check your connection and try again.' : `Something went wrong (${e.code || e.message}). Please try again.`);
  const must = (r) => { if (r.error) throw r.error; return r.data; };
  async function run(form, fn) {
    if (form.dataset.busy) return;                       // block duplicate submissions
    form.dataset.busy = '1'; const b = form.querySelector('[type=submit]'), label = b.textContent; b.disabled = true; b.textContent = 'Please wait...';
    try { await fn(); } catch (e) { form.querySelector('.form-err').textContent = authMsg(e); }
    finally { b.disabled = false; b.textContent = label; delete form.dataset.busy; }
  }
  const nameOf = (u) => (u.user_metadata && u.user_metadata.full_name) || u.email.split('@')[0];
  function paintProfile(u) {
    const name = nameOf(u);
    $('#pName').textContent = name.split(' ')[0]; $('#pFull').textContent = name; $('#pEmail').textContent = u.email;
    $('#avatar').textContent = name[0].toUpperCase(); $('#greet').textContent = `Welcome back, ${name}!`;
  }

  /* ---------- Database sync (only changed tasks are written; removed tasks are deleted) ---------- */
  const isExpired = (e) => e.status === 401 || e.code === 'PGRST301' || /jwt expired/i.test(e.message || '');
  function dbMsg(e, verb) {
    if (e.code === '42P01' || e.code === 'PGRST205') return 'The tasks table is missing. Run supabase-setup.sql in your Supabase project.';
    if (e.code === '42501') return 'Not allowed by the database security policy. Re-run supabase-setup.sql.';
    if (/fetch|network/i.test(e.message || '')) return `Network error. Your change was not ${verb}. Check your connection.`;
    return `Could not ${verb === 'saved' ? 'save' : 'load'} your tasks. Please try again.`;
  }
  async function expire() {                              // session/token no longer valid: sign out locally, then show the login page
    pendingNote = 'Your session expired. Please log in again.'; loggingOut = true;
    try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { endSession(); }
    loggingOut = false;
  }
  const sig = (t, i) => JSON.stringify([t.title, t.description || '', t.category, t.priority, t.due || '', !!t.done, i, t.completedAt || null]);
  const toRow = (t, i, uid) => ({ id: t.id, user_id: uid, title: t.title, description: t.description || '', category: t.category, priority: t.priority,
    due_date: t.due || null, status: t.done ? 'completed' : 'active', position: i, created_at: new Date(t.createdAt || Date.now()).toISOString(),
    completed_at: t.completedAt ? new Date(t.completedAt).toISOString() : null });
  const fromRow = (r) => ({ id: r.id, title: r.title, description: r.description || '', category: r.category, priority: r.priority, due: r.due_date || '',
    done: r.status === 'completed', createdAt: Date.parse(r.created_at), completedAt: r.completed_at ? Date.parse(r.completed_at) : null });

  window.TaskStore = {
    save(tasks) {
      if (!ready || !user) { TP.toast('Your tasks are not synced yet. Please wait a moment.', 'error'); return Promise.resolve(false); }
      const uid = user.id, rows = tasks.map((t, i) => ({ s: sig(t, i), row: toRow(t, i, uid) })), ids = rows.map((r) => r.row.id);
      chain = chain.then(async () => {
        if (!user || user.id !== uid) return false;
        const up = rows.filter((r) => synced.get(r.row.id) !== r.s), gone = [...synced.keys()].filter((id) => !ids.includes(id));
        if (up.length) must(await sb.from('tasks').upsert(up.map((r) => r.row), { onConflict: 'id' }));
        if (gone.length) must(await sb.from('tasks').delete().in('id', gone).eq('user_id', uid));
        up.forEach((r) => synced.set(r.row.id, r.s)); gone.forEach((id) => synced.delete(id));
        return true;
      }).catch((e) => { if (isExpired(e)) expire(); else TP.toast(dbMsg(e, 'saved'), 'error'); return false; });
      return chain;
    }
  };

  /* ---------- Safe import of old browser-only tasks (the browser copy is never deleted) ---------- */
  const pick = (v, a, d) => (a.includes(v) ? v : d), UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const clean = (t) => !t || typeof t.title !== 'string' || !t.title.trim() ? null : {
    id: UUID.test(t.id || '') ? t.id : TP.uuid(), title: t.title.trim().slice(0, 80), description: String(t.description || '').slice(0, 300),
    category: pick(t.category, ['Work', 'Personal', 'Study'], 'Work'), priority: pick(t.priority, ['High', 'Medium', 'Low'], 'Medium'),
    due: /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? t.due : '', done: !!t.done, createdAt: Number(t.createdAt) || Date.now(), completedAt: Number(t.completedAt) || null };
  function maybeMigrate(u) {
    return new Promise((resolve) => {
      const flag = 'taskpulse.legacy.' + u.id;
      if (localStorage.getItem(flag)) return resolve();
      const legacy = TP.readLegacyTasks().map(clean).filter(Boolean);
      if (!legacy.length) return resolve();
      const dlg = $('#migrateDialog');
      $('#migrateText').textContent = `We found ${legacy.length} task(s) saved in this browser from before accounts. Add them to ${u.email}? Your browser copy is kept either way.`;
      const done = (f) => { dlg.close(); if (f) localStorage.setItem(flag, f); resolve(); };
      $('#mLater').onclick = () => done(); $('#mNever').onclick = () => done('skipped');
      $('#mImport').onclick = async () => {
        TP.setTasks([...TP.getTasks(), ...legacy]);
        if (await window.TaskStore.save(TP.getTasks())) { TP.toast(`Imported ${legacy.length} task(s)`); done('imported'); }
      };
      dlg.showModal();
    });
  }

  async function startSession(u) {
    user = u; ready = false; synced.clear(); paintProfile(u); lock(false); document.title = baseTitle;
    if (/^#\//.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    try {
      const rows = must(await sb.from('tasks').select('*').eq('user_id', u.id).order('position', { ascending: true }));
      if (!user || user.id !== u.id) return;
      const list = rows.map(fromRow); list.forEach((t, i) => synced.set(t.id, sig(t, i)));
      TP.setTasks(list); ready = true; await maybeMigrate(u);
    } catch (e) { TP.setTasks([]); if (isExpired(e)) expire(); else TP.toast(dbMsg(e, 'loaded'), 'error'); }
  }
  function endSession() {
    user = null; ready = false; synced.clear(); TP.setTasks([]); lock(true); $('#profileMenu').hidden = true;
    $$('#authView form').forEach((f) => f.reset()); showRoute(route());
    if (pendingNote) { note(pendingNote); pendingNote = ''; }
  }

  /* ---------- UI wiring ---------- */
  $$('[data-eye]').forEach((b) => b.addEventListener('click', () => { const i = $('#' + b.dataset.eye), show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show'; b.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); }));
  $('#profileBtn').addEventListener('click', (e) => { e.stopPropagation(); const m = $('#profileMenu'); m.hidden = !m.hidden; });
  document.addEventListener('click', () => { $('#profileMenu').hidden = true; });
  $('#logoutBtn').addEventListener('click', async () => { loggingOut = true; if (sb) await sb.auth.signOut(); loggingOut = false; });

  lock(true);
  if (!configured || !window.supabase) {
    view.classList.remove('pending'); showRoute(route());
    note(window.supabase ? 'Supabase is not configured yet. Open supabase-config.js and paste your Project URL and anon key (see README.md).' : 'Could not load the Supabase library. Check your internet connection and reload.');
    $$('#authView [type=submit]').forEach((b) => { b.disabled = true; });
    return;
  }
  // "Remember me": keep the session in localStorage (remembered) or sessionStorage (until the tab closes).
  const remembered = () => localStorage.getItem('taskpulse.remember') !== '0';
  const storage = { getItem: (k) => localStorage.getItem(k) ?? sessionStorage.getItem(k),
    setItem: (k, v) => { const [a, b] = remembered() ? [localStorage, sessionStorage] : [sessionStorage, localStorage]; a.setItem(k, v); b.removeItem(k); },
    removeItem: (k) => { localStorage.removeItem(k); sessionStorage.removeItem(k); } };
  sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { storage, flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

  $('#loginForm').addEventListener('submit', (e) => {
    e.preventDefault(); clearErrs();
    const email = $('#l-email').value.trim(), password = $('#l-pass').value; let bad = false;
    if (!EMAIL.test(email)) { setErr('l-email', 'Enter a valid email address.'); bad = true; }
    if (!password) { setErr('l-pass', 'Enter your password.'); bad = true; }
    if (bad) return;
    run(e.target, async () => { localStorage.setItem('taskpulse.remember', $('#l-remember').checked ? '1' : '0'); must(await sb.auth.signInWithPassword({ email, password })); });
  });
  $('#signupForm').addEventListener('submit', (e) => {
    e.preventDefault(); clearErrs();
    const name = $('#s-name').value.trim(), email = $('#s-email').value.trim(), p1 = $('#s-pass').value, p2 = $('#s-pass2').value; let bad = false;
    if (name.length < 2) { setErr('s-name', 'Enter your full name (at least 2 characters).'); bad = true; }
    if (!EMAIL.test(email)) { setErr('s-email', 'Enter a valid email address.'); bad = true; }
    if (p1.length < 8 || !/[A-Za-z]/.test(p1) || !/\d/.test(p1)) { setErr('s-pass', 'Use at least 8 characters with a letter and a number.'); bad = true; }
    if (p1 !== p2) { setErr('s-pass2', 'Passwords do not match.'); bad = true; }
    if (bad) return;
    run(e.target, async () => {
      localStorage.setItem('taskpulse.remember', '1');
      const d = must(await sb.auth.signUp({ email, password: p1, options: { data: { full_name: name } } }));
      if (d.user && Array.isArray(d.user.identities) && d.user.identities.length === 0) throw { code: 'user_already_exists' };   // Supabase hides duplicates this way
      if (!d.session) { location.hash = '#/login'; showRoute('login'); note('Account created. Check your email to confirm your address, then log in.', true); }
    });
  });
  $('#resetForm').addEventListener('submit', (e) => {
    e.preventDefault(); clearErrs(); const email = $('#r-email').value.trim();
    if (!EMAIL.test(email)) { setErr('r-email', 'Enter a valid email address.'); return; }
    run(e.target, async () => {
      must(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
      note(`If an account exists for ${email}, a reset link is on its way. Open it in this same browser. Check spam too.`, true);
    });
  });
  $('#updateForm').addEventListener('submit', (e) => {
    e.preventDefault(); clearErrs(); const p1 = $('#u-pass').value, p2 = $('#u-pass2').value; let bad = false;
    if (p1.length < 8 || !/[A-Za-z]/.test(p1) || !/\d/.test(p1)) { setErr('u-pass', 'Use at least 8 characters with a letter and a number.'); bad = true; }
    if (p1 !== p2) { setErr('u-pass2', 'Passwords do not match.'); bad = true; }
    if (bad) return;
    run(e.target, async () => {
      must(await sb.auth.updateUser({ password: p1 }));
      recovering = false; const s = must(await sb.auth.getSession()).session; if (s) { startSession(s.user); TP.toast('Password updated'); }
    });
  });

  // Never await Supabase calls inside this callback; defer instead.
  sb.auth.onAuthStateChange((event, session) => {
    view.classList.remove('pending');
    if (event === 'PASSWORD_RECOVERY') { recovering = true; setTimeout(() => { lock(true); location.hash = '#/update'; showRoute('update'); }, 0); return; }
    if (session && !recovering) {
      if (user && user.id === session.user.id) { user = session.user; return; }   // token refresh / tab focus: nothing to reload
      setTimeout(() => startSession(session.user), 0);
    } else if (!session) {
      const expired = !!user && !loggingOut;
      if (expired) pendingNote = 'Your session expired. Please log in again.';
      setTimeout(endSession, 0);
    }
  });
})();
