const GROUPS = ['Pierna','Espalda','Hombro','Tríceps','Bíceps','Pecho','Antebrazo','Cuello'];
const DAYS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const DAYS_SHORT = ['L','M','X','J','V','S','D']; // semana inicia lunes
const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

// ---------- estado ----------
const KEY = 'gymtrack.v1';
const pad = n => String(n).padStart(2,'0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d); };
const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };

function load(){
  let st = null;
  try { st = JSON.parse(localStorage.getItem(KEY)); } catch(e){}
  if (!st) st = { start: fmt(today()), schedule: {}, marks: {}, planOverride: {}, exercises: [], routines: [] };
  // migración: los planes por grupos pasan a ser rutinas
  if (!st.records) st.records = [];
  if (!st.sessions) st.sessions = [];
  st.records.forEach(r => {
    if ('cintura' in r){ if (r.abdomen == null) r.abdomen = r.cintura; delete r.cintura; }
    if ('brazos' in r){ if (r.bicep == null) r.bicep = r.brazos; delete r.brazos; }
  });
  if (!st.routines){
    st.routines = [];
    const toRoutine = v => {
      if (!Array.isArray(v)) return v ?? null;
      if (!v.length) return null;
      const name = v.join(' + ');
      let r = st.routines.find(x => x.name === name);
      if (!r){ r = { id: 'r'+Math.random().toString(36).slice(2,8), name, exerciseIds: [] }; st.routines.push(r); }
      return r.id;
    };
    for (const k in st.schedule) st.schedule[k] = toRoutine(st.schedule[k]);
    for (const k in st.planOverride) st.planOverride[k] = Array.isArray(st.planOverride[k]) && !st.planOverride[k].length ? 'rest' : toRoutine(st.planOverride[k]);
  }
  // limpieza única: quita las rutinas vacías que creó la migración automática (Pecho, Espalda, ...)
  if (!st.cleaned){
    const old = ['Pecho','Espalda','Pierna','Hombro','Bíceps + Tríceps'];
    const gone = st.routines.filter(r => !r.exerciseIds.length && old.includes(r.name)).map(r => r.id);
    st.routines = st.routines.filter(r => !gone.includes(r.id));
    for (const k in st.schedule) if (gone.includes(st.schedule[k])) st.schedule[k] = null;
    for (const k in st.planOverride) if (gone.includes(st.planOverride[k])) st.planOverride[k] = 'rest';
    st.cleaned = true;
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch(e){}
  }
  return st;
}
let S = load();
const save = () => { S._ts = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch(e){} markDirty(); };

// rutina que toca ese día (objeto) o null si es descanso
const routineById = id => S.routines.find(r => r.id === id) || null;
const planFor = d => {
  const o = S.planOverride[fmt(d)];
  if (o !== undefined) return o === 'rest' ? null : routineById(o);
  return routineById(S.schedule[d.getDay()]);
};
// descanso elegido a propósito (distinto de un día sin asignar)
const isRest = d => { const o = S.planOverride[fmt(d)]; return (o !== undefined ? o : S.schedule[d.getDay()]) === 'rest'; };
const planText = d => planFor(d)?.name || (isRest(d) ? 'Descanso' : 'Sin asignar');

// 'g' fue, 'r' no fue, 'y' no tocaba, '' sin definir (hoy/futuro/antes de empezar)
function status(d){
  const k = fmt(d), m = S.marks[k];
  if (m === 'went') return 'g';
  if (m === 'rest') return 'y';
  if (m === 'missed') return 'r';
  if (k < S.start) return '';
  if (planFor(d)) return d < today() ? 'r' : '';
  return isRest(d) ? 'y' : '';
}

function streak(){
  // retrocede desde hoy hasta la marca más antigua (aunque sea anterior al día en que empezaste a usar la app)
  const first = Object.keys(S.marks).concat(S.start).sort()[0];
  let n = 0, d = today();
  while (fmt(d) >= first){
    let s = status(d);
    if (s === '' && d < today() && fmt(d) < S.start && planFor(d)) s = 'r'; // día de rutina anterior sin marcar
    if (s === 'g') n++;
    else if (s === 'r') break;
    d.setDate(d.getDate()-1);
  }
  return n;
}

// ---------- utilidades DOM ----------
const $ = s => document.querySelector(s);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };

function longPress(node, onShort, onLong){
  let t, fired = false, moved = false;
  const start = e => { fired = false; moved = false; t = setTimeout(()=>{ fired = true; navigator.vibrate?.(20); onLong(); }, 500); };
  const end = () => { clearTimeout(t); };
  node.addEventListener('touchstart', start, {passive:true});
  node.addEventListener('touchmove', ()=>{ moved = true; end(); }, {passive:true});
  node.addEventListener('touchend', end);
  node.addEventListener('mousedown', start);
  node.addEventListener('mouseup', end);
  node.addEventListener('mouseleave', end);
  node.addEventListener('click', e => { if (fired || moved) { e.preventDefault(); return; } onShort(); });
  node.addEventListener('contextmenu', e => e.preventDefault());
}

function openSheet(html, full){
  const sh = $('#sheet');
  sh.innerHTML = `<div class="panel ${full?'full':''}">${html}</div>`;
  sh.classList.remove('hidden');
  sh.onclick = e => { if (e.target === sh) closeSheet(); };
  const panel = sh.firstChild;
  // respaldo para iOS: si el 'click' de un botón no llega, el 'pointerup' lo dispara (y se ignora el click real duplicado)
  let synthAt = 0;
  panel.addEventListener('pointerup', ev => {
    if (ev.pointerType === 'mouse') return;
    const t = ev.target.closest('button, .photo, .ph-img, .video-pick');
    if (!t || t.disabled || t.classList.contains('star')) return;
    synthAt = Date.now(); t.click();
  });
  panel.addEventListener('click', ev => {
    if (ev.isTrusted && Date.now() - synthAt < 700){ ev.stopPropagation(); ev.preventDefault(); }
  }, true);
  return panel;
}
function closeSheet(){ $('#sheet').classList.add('hidden'); $('#sheet').innerHTML=''; }

// ---------- navegación ----------
let tab = 'inicio', cat = null, homeM = null;
document.querySelectorAll('#nav button').forEach(b => b.onclick = () => { tab = b.dataset.tab; cat = null; render(); });

function render(){
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const app = $('#app');
  app.innerHTML = '';
  if (tab === 'inicio') renderHome(app);
  else if (tab === 'ejercicios') cat ? renderCategory(app) : renderCats(app);
  else if (tab === 'rutinas') renderRoutines(app);
  else renderRegistro(app);
  window.scrollTo(0,0);
}

// ---------- INICIO ----------
function renderHome(app){
  const t = today(), k = fmt(t);
  const done = status(t) === 'g';

  // racha
  app.append(el(`<div><div class="streak"><span class="flame">🔥</span><span class="num">${streak()}</span></div></div>`));

  // semana (lunes a domingo)
  const mon = new Date(t); mon.setDate(t.getDate() - ((t.getDay()+6)%7));
  const wk = el(`<div class="week"></div>`);
  for (let i=0;i<7;i++){
    const d = new Date(mon); d.setDate(mon.getDate()+i);
    wk.append(el(`<div class="${status(d)} ${fmt(d)===k?'today':''}">${DAYS_SHORT[i]}</div>`));
  }
  app.append(wk);

  // hoy
  const card = el(`<div class="today-card">
    <div class="day">${DAYS[t.getDay()]}, ${t.getDate()} de ${MONTHS[t.getMonth()]}</div>
    <div class="plan-row"><div class="plan">${esc(planText(t))}</div>${planFor(t) ? `<button class="go">${S.active && S.active.date === k ? 'Continuar' : 'Iniciar'}</button>` : ''}</div>
    ${todayExercises(t)}
    <button class="att ${done?'done':''}">${done?'✓ Asistido':'Asistido'}</button>
    <div class="hint">Toca = fui al gym · Mantén presionado = editar el día</div>
  </div>`);
  card.querySelector('.go')?.addEventListener('click', () => startWorkout(planFor(t)));
  longPress(card.querySelector('.att'), () => {
    if (S.marks[k] === 'went') delete S.marks[k]; else S.marks[k] = 'went';
    save(); render();
  }, () => editDay(t));
  app.append(card);

  // calendario mensual
  const cal = el(`<div class="cal"></div>`);
  const vm = homeM || { y: t.getFullYear(), m: t.getMonth() };
  cal.append(monthView(vm.y, vm.m, true, dir => {
    const n = new Date(vm.y, vm.m + dir, 1); homeM = { y: n.getFullYear(), m: n.getMonth() }; render();
  }));
  cal.append(el(`<div class="hint" style="margin-top:10px">Toca un día para elegir qué rutina toca o si es descanso</div>`));
  cal.append(el(`<div class="legend"><span><i class="g"></i>Fui</span><span><i class="r"></i>No fui</span><span><i class="y"></i>No tocaba</span></div>`));
  app.append(cal);

  const total = dayStats(firstDay(), t);
  app.append(el(`<div class="cal" style="margin-top:14px">${statsBlock(total, 'Desde que empezaste · ' + longDate(fmt(firstDay())))}</div>`));

  const bk = el(`<button class="hist-btn" style="margin-top:10px"><span>☁️ Cuenta y respaldo</span><small class="sync-small"></small></button>`);
  bk.onclick = openBackup; setTimeout(paintSync, 0);
  const n = attendedDays().length;
  const hb = el(`<button class="hist-btn"><span>📖 Historial de entrenamientos</span><small>${n} día${n===1?'':'s'}</small></button>`);
  hb.onclick = openLog;
  app.append(hb, bk);
}

// días que tocaban (con rutina asignada): cuántos fui y cuántos no. Los días sin rutina no cuentan como "no fui".
function dayStats(from, to){
  let went = 0, missed = 0, extra = 0;
  const end = today() < to ? today() : to;
  for (let d = new Date(from); d <= end; d.setDate(d.getDate()+1)){
    const st = status(d), req = !!planFor(d);
    if (st === 'g'){ req ? went++ : extra++; }
    else if (st === 'r' && req) missed++;
  }
  const total = went + missed;
  return { went, missed, total, extra, pct: total ? Math.round(went/total*100) : null };
}
const monthStats = (y, m) => dayStats(new Date(y,m,1), new Date(y,m+1,0));
const firstDay = () => parse(Object.keys(S.marks).concat(S.start).sort()[0]);

function statsBlock(st, label){
  return `<div class="stats">
    ${label ? `<div class="stats-label">${label}</div>` : ''}
    <div class="stats-row">
      <div class="stat-box ok"><b>${st.went}</b><span>Fui</span></div>
      <div class="stat-box bad"><b>${st.missed}</b><span>No fui</span></div>
      <div class="stat-box"><b>${st.pct == null ? '—' : st.pct + '%'}</b><span>Cumplido</span></div>
    </div>
    <div class="stats-note">${st.total ? `De ${st.total} día${st.total===1?'':'s'} que tocaban` : 'Aún no hay días que tocaran'}${st.extra ? ` · +${st.extra} extra (sin rutina)` : ''}</div>
  </div>`;
}

function monthView(y, m, editable, onNav){
  const wrap = el(`<div></div>`);
  const first = new Date(y,m,1), days = new Date(y,m+1,0).getDate();
  const g = el(`<div class="grid"></div>`);
  DAYS_SHORT.forEach(n => g.append(el(`<div class="dn">${n}</div>`)));
  for (let i=0;i<(first.getDay()+6)%7;i++) g.append(el(`<div class="d empty"></div>`));
  for (let i=1;i<=days;i++){
    const d = new Date(y,m,i), s = status(d);
    const c = el(`<div class="d ${s} ${fmt(d)===fmt(today())?'today':''}">${i}${planFor(d)?'<u></u>':''}</div>`);
    if (editable) c.onclick = () => editDay(d);
    g.append(c);
  }
  const st = monthStats(y, m);
  if (editable){
    const h = el(`<div class="mhead"><button class="mnav" aria-label="Mes anterior">‹</button><button class="mtitle">${MONTHS[m]} ${y}<small>ver todos los meses ›</small></button><button class="mnav" aria-label="Mes siguiente">›</button></div>`);
    const [prev, title, next] = h.children;
    prev.onclick = () => onNav(-1); next.onclick = () => onNav(1);
    title.onclick = openHistory;
    wrap.append(h, g, el(statsBlock(st)));
  } else {
    wrap.append(el(`<h3>${MONTHS[m]} ${y} <small>${st.total ? `Fui ${st.went} de ${st.total} · ${st.pct}%` : 'sin días que tocaran'}</small></h3>`), g);
  }
  return wrap;
}

function openHistory(){
  const t = today(), f = firstDay();
  const p = openSheet(`<h2>Asistencia</h2>`, true);
  p.append(el(statsBlock(dayStats(f, t), `Desde ${longDate(fmt(f))}`)));
  const startIdx = f.getFullYear()*12 + f.getMonth(), endIdx = t.getFullYear()*12 + t.getMonth();
  for (let i=endIdx; i>=startIdx; i--){
    const b = el(`<div class="month-block"></div>`);
    b.append(monthView(Math.floor(i/12), i%12, false));
    p.append(b);
  }
  p.append(el(`<div class="row"><button class="btn" id="x">Cerrar</button></div>`));
  p.querySelector('#x').onclick = closeSheet;
}

function todayExercises(d){
  const r = planFor(d);
  if (!r) return '';
  const names = r.exerciseIds.map(id => S.exercises.find(e => e.id === id)?.name).filter(Boolean);
  return names.length ? `<div class="ex-list">${names.map(n => `<span>${esc(n)}</span>`).join('')}</div>` : '';
}

function editDay(d){
  const k = fmt(d);
  const cur = S.planOverride[k];
  let plan = cur !== undefined ? cur : (S.schedule[d.getDay()] ?? null); // id de rutina, 'rest' o null (sin asignar)
  let mark = S.marks[k] ?? '';
  const p = openSheet(`
    <h2>${DAYS[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()]}</h2>
    <label>¿Qué toca este día?</label><div class="chips" id="chips"></div>
    ${S.routines.length ? '' : '<div class="hint" style="text-align:left;margin-top:8px">Aún no tienes rutinas. Créalas en la pestaña Rutinas.</div>'}
    <label>Asistencia</label>
    <div class="chips" id="opts"></div>
    <div class="row"><button class="btn" id="c">Cancelar</button><button class="btn pri" id="ok">Guardar</button></div>
    <button class="btn" id="all" style="width:100%;margin-top:10px">Aplicar a todos los ${DAYS[d.getDay()]}</button>
  `);
  const chips = p.querySelector('#chips');
  const drawChips = () => { chips.innerHTML='';
    [...S.routines.map(r => [r.id, r.name]), ['rest','😴 Descanso']].forEach(([id,name]) => {
      const c = el(`<button class="chip ${plan===id?'on':''}">${esc(name)}</button>`);
      c.onclick = () => { plan = plan === id ? null : id; drawChips(); }; // tocar la seleccionada la quita
      chips.append(c);
    });};
  drawChips();
  const optBox = p.querySelector('#opts');
  const drawOpts = () => { optBox.innerHTML='';
    [['','Automático'],['went','🟢 Fui'],['missed','🔴 No fui'],['rest','🟡 No tocaba']].forEach(([v,n]) => {
      const c = el(`<button class="chip ${mark===v?'on':''}">${n}</button>`);
      c.onclick = () => { mark = (mark === v) ? '' : v; drawOpts(); };
      optBox.append(c);
    });};
  drawOpts();
  const setMark = () => { if (mark) S.marks[k] = mark; else delete S.marks[k]; };
  p.querySelector('#c').onclick = closeSheet;
  p.querySelector('#ok').onclick = () => { if (plan === null) delete S.planOverride[k]; else S.planOverride[k] = plan; setMark(); save(); closeSheet(); render(); };
  p.querySelector('#all').onclick = () => {
    S.schedule[d.getDay()] = plan; delete S.planOverride[k];
    setMark(); save(); closeSheet(); render();
  };
}

// ---------- RUTINAS ----------
function renderRoutines(app){
  app.append(el(`<h1>Rutinas</h1>`));
  if (!S.routines.length) app.append(el(`<div class="empty-msg">Aún no tienes rutinas.<br>Toca + para crear la primera.</div>`));
  S.routines.forEach(r => {
    const days = [1,2,3,4,5,6,0].filter(i => S.schedule[i] === r.id).map(i => DAYS[i].slice(0,3)).join(', ');
    const names = r.exerciseIds.map(id => S.exercises.find(e => e.id === id)?.name).filter(Boolean);
    const c = el(`<div class="ex" style="display:block">
      <div class="nm">${esc(r.name)}</div>
      <div class="ln">${names.length} ejercicio${names.length===1?'':'s'}${days?` · ${days}`:''}</div>
      ${names.length ? `<div class="ex-list">${names.map(n=>`<span>${esc(n)}</span>`).join('')}</div>` : ''}
    </div>`);
    c.onclick = () => editRoutine(r);
    app.append(c);
  });
  const fab = el(`<button class="fab">+</button>`);
  fab.onclick = () => editRoutine({id:null, name:'', exerciseIds:[]});
  app.append(fab);
}

function editRoutine(r){
  const isNew = !r.id;
  let ids = [...r.exerciseIds];
  const p = openSheet(`
    <h2>${isNew?'Nueva rutina':'Editar rutina'}</h2>
    <label>Nombre</label><input id="nm" value="${esc(r.name)}" placeholder="Pecho y tríceps">
    <label>Ejercicios</label><div id="exs"></div>
    <div class="row">${isNew?'':'<button class="btn del" id="del">Borrar</button>'}<button class="btn" id="c">Cancelar</button><button class="btn pri" id="ok">Guardar</button></div>
  `, true);
  const box = p.querySelector('#exs');
  if (!S.exercises.length) box.append(el(`<div class="hint" style="text-align:left">Primero agrega ejercicios en la pestaña Ejercicios.</div>`));
  GROUPS.forEach(g => {
    const list = S.exercises.filter(e => e.group === g);
    if (!list.length) return;
    box.append(el(`<div class="stat" style="margin:10px 0 6px">${g}</div>`));
    const ch = el(`<div class="chips"></div>`);
    list.forEach(e => {
      const c = el(`<button class="chip ${ids.includes(e.id)?'on':''}">${esc(e.name)}</button>`);
      c.onclick = () => { ids = ids.includes(e.id) ? ids.filter(x=>x!==e.id) : [...ids, e.id]; c.classList.toggle('on'); };
      ch.append(c);
    });
    box.append(ch);
  });
  p.querySelector('#c').onclick = closeSheet;
  p.querySelector('#del')?.addEventListener('click', () => {
    if (!confirm('¿Borrar esta rutina?')) return;
    S.routines = S.routines.filter(x => x.id !== r.id);
    for (const k in S.schedule) if (S.schedule[k] === r.id) S.schedule[k] = null;
    for (const k in S.planOverride) if (S.planOverride[k] === r.id) S.planOverride[k] = 'rest';
    save(); closeSheet(); render();
  });
  p.querySelector('#ok').onclick = () => {
    const name = p.querySelector('#nm').value.trim();
    if (!name) { p.querySelector('#nm').focus(); return; }
    if (isNew) S.routines.push({ id: 'r'+Date.now(), name, exerciseIds: ids });
    else Object.assign(S.routines.find(x => x.id === r.id), { name, exerciseIds: ids });
    save(); closeSheet(); render();
  };
}

// ---------- EJERCICIOS ----------
function renderCats(app){
  app.append(el(`<h1>Ejercicios</h1>`));
  const g = el(`<div class="cats"></div>`);
  GROUPS.forEach(name => {
    const n = S.exercises.filter(e => e.group===name).length;
    const c = el(`<button class="cat">${name}<small>${n} ejercicio${n===1?'':'s'}</small></button>`);
    c.onclick = () => { cat = name; render(); };
    g.append(c);
  });
  app.append(g);
}

function renderCategory(app){
  const back = el(`<button class="back">‹ Categorías</button>`);
  back.onclick = () => { cat = null; render(); };
  app.append(back, el(`<h1>${cat}</h1>`));
  const list = S.exercises.filter(e => e.group===cat);
  if (!list.length) app.append(el(`<div class="empty-msg">Aún no hay ejercicios.<br>Toca + para agregar uno.</div>`));
  list.forEach(e => {
    const card = el(`<div class="ex">
      <div class="img" style="${e.img?`background-image:url(${e.img})`:''}">${e.img?'':'Imagen'}</div>
      <div class="info">
        <div class="nm">${esc(e.name)}</div>
        <div class="ln">Grupo: <b>${e.group}</b></div>
        <div class="ln">PR: <b>${e.kg ? `${e.kg} kg × ${e.reps||'—'}` : '—'}</b></div>
        <div class="ln">Estímulo: <span class="stars-ro">${'★'.repeat(e.stars||0)}<i>${'★'.repeat(5-(e.stars||0))}</i></span></div>
      </div></div>`);
    card.onclick = () => editExercise(e);
    app.append(card);
  });
  const fab = el(`<button class="fab">+</button>`);
  fab.onclick = () => editExercise({id:null, group:cat, name:'', pr:'', stim:'', img:''});
  app.append(fab);
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function editExercise(e){
  const isNew = !e.id;
  const p = openSheet(`
    <h2>${isNew?'Nuevo ejercicio':'Editar ejercicio'}</h2>
    <div class="photo" id="ph">Toca para elegir imagen</div>
    <input type="file" accept="image/*" id="file" hidden>
    <label>Nombre</label><input id="nm" value="${esc(e.name)}" placeholder="Press de banca">
    <label>Grupo</label><select id="gr">${GROUPS.map(g=>`<option ${g===e.group?'selected':''}>${g}</option>`).join('')}</select>
    <label>PR (récord personal)</label>
    <div class="pr-row">
      <div><input id="kg" type="number" inputmode="decimal" min="0" step="any" value="${e.kg??''}" placeholder="0"><small>kg</small></div>
      <span>×</span>
      <div><input id="rp" type="number" inputmode="numeric" min="0" step="1" value="${e.reps??''}" placeholder="0"><small>repeticiones</small></div>
    </div>
    <label>Estímulo</label><div class="stars" id="stars"></div>
    <div class="row">${isNew?'':'<button class="btn del" id="del">Borrar</button>'}<button class="btn" id="c">Cancelar</button><button class="btn pri" id="ok">Guardar</button></div>
  `);
  let stars = e.stars || 0;
  const starBox = p.querySelector('#stars');
  const starBtns = [];
  const paintStars = () => starBtns.forEach((b, i) => b.classList.toggle('on', i < stars));
  const drawStars = () => {
    if (!starBtns.length) for (let i = 1; i <= 5; i++){
      const b = el(`<span class="star" role="button" aria-label="${i} estrellas">★</span>`);
      let lastT = 0;
      const press = ev => {                      // pointerup + click: el primero que llegue gana
        if (Date.now() - lastT < 350) return; lastT = Date.now();
        ev.preventDefault();
        stars = (stars === i) ? 0 : i;           // tocar la misma estrella la quita
        paintStars();
      };
      b.addEventListener('pointerup', press);
      b.addEventListener('click', press);
      starBtns.push(b); starBox.append(b);
    }
    paintStars();
  };
  drawStars();
  let img = e.img || '';
  const ph = p.querySelector('#ph'), file = p.querySelector('#file');
  const showImg = () => { ph.style.backgroundImage = img ? `url(${img})` : ''; ph.textContent = img ? '' : 'Toca para elegir imagen'; };
  showImg();
  ph.onclick = () => file.click();
  file.onchange = () => {
    const f = file.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { const im = new Image(); im.onload = () => {
      const s = Math.min(1, 600/Math.max(im.width, im.height));
      const c = document.createElement('canvas'); c.width = im.width*s; c.height = im.height*s;
      c.getContext('2d').drawImage(im,0,0,c.width,c.height);
      img = c.toDataURL('image/jpeg', .75); showImg();
    }; im.src = r.result; };
    r.readAsDataURL(f);
  };
  p.querySelector('#c').onclick = closeSheet;
  p.querySelector('#del')?.addEventListener('click', () => {
    if (!confirm('¿Borrar este ejercicio?')) return;
    S.exercises = S.exercises.filter(x => x.id !== e.id); save(); closeSheet(); render();
  });
  p.querySelector('#ok').onclick = () => {
    const name = p.querySelector('#nm').value.trim();
    if (!name) { p.querySelector('#nm').focus(); return; }
    const data = { id: e.id || String(Date.now()), name, group: p.querySelector('#gr').value,
      kg: p.querySelector('#kg').value, reps: p.querySelector('#rp').value, stars, img };
    if (isNew) S.exercises.push(data); else S.exercises = S.exercises.map(x => x.id===e.id ? data : x);
    save(); closeSheet(); cat = data.group; render();
  };
}


// ---------- REGISTRO (medidas + fotos + video) ----------
const MEAS = [['cuello','Cuello'],['hombros','Hombros'],['pecho','Pecho'],['abdomen','Abdomen'],['bicep','Bicep'],['antebrazo','Antebrazo'],['gluteos','Glúteos'],['cuadriceps','Cuadriceps'],['pantorrilla','Pantorrilla']];
const PHOTOS = [['espalda','Espalda'],['pecho','Pecho'],['piernas','Piernas']];
let recSel = null, measSel = null;

// fotos y video viven en IndexedDB (pesan demasiado para localStorage)
const idb = new Promise((res, rej) => {
  try {
    const r = indexedDB.open('gymtrack-media', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('m');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  } catch(e){ rej(e); }
});
const mediaTx = (mode, fn) => idb.then(db => new Promise((res, rej) => {
  const t = db.transaction('m', mode), rq = fn(t.objectStore('m'));
  t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error);
}));
const mediaPut = (k, b) => mediaTx('readwrite', st => st.put(b, k));
const mediaGet = k => mediaTx('readonly', st => st.get(k)).catch(() => null);
const mediaDel = k => mediaTx('readwrite', st => st.delete(k)).catch(() => null);
// versiones: cada foto/video lleva una versión dentro del estado para saber qué subir o bajar de la nube
const putMedia = async (k, b) => { await mediaPut(k, b); S.mediaVer = S.mediaVer || {}; S.mediaVer[k] = Date.now(); meta.have[k] = S.mediaVer[k]; };
const delMedia = async k => { await mediaDel(k); S.mediaVer = S.mediaVer || {}; S.mediaVer[k] = -Date.now(); meta.have[k] = S.mediaVer[k]; };

const monthLabel = id => { const [y,m] = id.split('-').map(Number); return `${MONTHS[m-1].slice(0,3)} ${y}`; };
const monthLong = id => { const [y,m] = id.split('-').map(Number); return `${MONTHS[m-1]} ${y}`; };

function resizeImage(file, max = 1200){
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const k = Math.min(1, max / Math.max(im.width, im.height));
      const c = document.createElement('canvas'); c.width = im.width*k; c.height = im.height*k;
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? res(b) : rej(), 'image/jpeg', .8);
    };
    im.onerror = rej; im.src = url;
  });
}


// figura corporal en capas (img/): silueta, zona naranja por músculo, líneas.
// zones-map.png guarda en el canal rojo el índice del músculo para saber qué se tocó.
const ZONES = ['hombros','pecho','bicep','antebrazo','cuadriceps','pantorrilla','cuello','abdomen','gluteos'];
const BODY_W = 448, BODY_H = 646;
const zoneMap = new Promise(res => {
  const im = new Image();
  im.onload = () => {
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0);
    res(x);
  };
  im.onerror = () => res(null);
  im.src = 'img/zones-map.png';
});
async function zoneAt(px, py){
  const ctx = await zoneMap; if (!ctx) return null;
  const at = (x, y) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= BODY_W || y >= BODY_H) return null;
    const d = ctx.getImageData(x, y, 1, 1).data;
    return d[3] ? ZONES[d[0]-1] : null;
  };
  let z = at(px, py); if (z) return z;
  for (const r of [4, 8]) for (let a = 0; a < 8; a++){   // margen de error del dedo
    z = at(px + r*Math.cos(a*Math.PI/4), py + r*Math.sin(a*Math.PI/4)); if (z) return z;
  }
  return null;
}
const bodyLayers = () => `<img class="bl" src="img/body-base.png" alt="" draggable="false">` +
  ZONES.map(k => `<img class="bl zone" data-k="${k}" src="img/z-${k}.png" alt="" draggable="false">`).join('') +
  `<img class="bl" src="img/body-lines.png" alt="" draggable="false">`;

function renderRegistro(app){
  const recs = [...S.records].sort((a,b) => b.id.localeCompare(a.id));
  app.append(el(`<h1>Registro</h1>`));
  if (!recs.length){
    app.append(el(`<div class="empty-msg">Aún no tienes registros.<br>Toca + para guardar tus medidas, fotos y video del mes.</div>`));
  } else {
    if (!recs.find(r => r.id === recSel)) recSel = recs[0].id;
    const tabs = el(`<div class="month-tabs"></div>`);
    recs.forEach(r => {
      const b = el(`<button class="chip ${r.id===recSel?'on':''}">${monthLabel(r.id)}</button>`);
      b.onclick = () => { recSel = r.id; render(); };
      tabs.append(b);
    });
    app.append(tabs);

    const r = recs.find(x => x.id === recSel);
    const prev = recs.find(x => x.id < r.id); // mes anterior registrado
    const card = el(`<div class="reg-card">
      <div class="reg-left">
        <div class="reg-title">${monthLong(r.id)}</div>
        <div class="body-wrap">${bodyLayers()}</div>
        <div class="readout" id="ro"></div>
        <button class="fotos-link">Fotos</button>
      </div>
      <div class="video-box" id="vbox">${r.has?.video ? '' : 'Sin video'}</div>
    </div>`);
    const ro = card.querySelector('#ro'), wrap = card.querySelector('.body-wrap'), layers = [...card.querySelectorAll('.zone')];
    const showMeas = () => {
      layers.forEach(p => p.classList.toggle('on', p.dataset.k === measSel));
      if (!measSel){ ro.innerHTML = '<span class="mute">Toca un músculo</span>'; return; }
      const name = MEAS.find(m => m[0] === measSel)[1];
      const v = r[measSel], pv = prev?.[measSel];
      const has = v !== '' && v != null;
      const diff = (has && pv !== '' && pv != null) ? Math.round((v - pv)*10)/10 : null;
      ro.innerHTML = `<span class="mute">${name}</span><b>${has ? v + ' cm' : 'Sin medir'}</b>` +
        (diff ? `<small class="delta">${diff > 0 ? '+' : ''}${diff} vs mes anterior</small>` : '');
    };
    wrap.onclick = async e => {
      const b = wrap.getBoundingClientRect();
      const z = await zoneAt((e.clientX - b.left) / b.width * BODY_W, (e.clientY - b.top) / b.height * BODY_H);
      measSel = (z && z !== measSel) ? z : null;
      showMeas();
    };
    showMeas();
    card.querySelector('.fotos-link').onclick = () => showPhotos(r);
    app.append(card);
    if (r.has?.video) mediaGet(`${r.id}:video`).then(b => {
      const box = $('#vbox'); if (!b || !box) return;
      box.innerHTML = '';
      const v = document.createElement('video');
      v.src = URL.createObjectURL(b); v.controls = true; v.playsInline = true; v.preload = 'metadata';
      box.append(v);
    });
    const ed = el(`<button class="btn" style="width:100%;margin-top:12px">Editar este mes</button>`);
    ed.onclick = () => editRecord(r);
    app.append(ed);
  }
  const fab = el(`<button class="fab">+</button>`);
  fab.onclick = () => editRecord({ id: null });
  app.append(fab);
}

function showPhotos(r){
  const has = PHOTOS.filter(([k]) => r.has?.[k]);
  const p = openSheet(`<h2>Fotos · ${monthLong(r.id)}</h2>
    ${has.length ? '' : '<div class="hint" style="text-align:left">No hay fotos en este mes.</div>'}
    <div class="photo-grid">${has.map(([k,n]) => `<div><div class="ph-img" data-k="${k}"></div><small>${n}</small></div>`).join('')}</div>
    <div class="row"><button class="btn" id="x">Cerrar</button></div>`, true);
  p.querySelector('#x').onclick = closeSheet;
  has.forEach(([k]) => mediaGet(`${r.id}:${k}`).then(b => {
    const n = p.querySelector(`.ph-img[data-k="${k}"]`);
    if (!b || !n) return;
    const url = URL.createObjectURL(b);
    n.style.backgroundImage = `url(${url})`;
    n.onclick = () => openViewer(url);
  }));
}

// visor a pantalla completa: pellizca para hacer zoom, arrastra para moverte, doble toque = zoom
function openViewer(url){
  const v = el(`<div class="viewer"><img src="${url}" draggable="false"><button class="viewer-x">✕</button></div>`);
  const img = v.querySelector('img');
  let sc = 1, tx = 0, ty = 0, lastTap = 0;
  const apply = () => { img.style.transform = `translate(${tx}px,${ty}px) scale(${sc})`; };
  const clamp = () => {
    if (sc <= 1){ sc = 1; tx = 0; ty = 0; return; }
    const mx = (img.clientWidth*sc - innerWidth)/2, my = (img.clientHeight*sc - innerHeight)/2;
    tx = Math.max(-Math.max(mx,0), Math.min(Math.max(mx,0), tx));
    ty = Math.max(-Math.max(my,0), Math.min(Math.max(my,0), ty));
  };
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  let d0 = 0, sc0 = 1, px = 0, py = 0;
  v.addEventListener('touchstart', e => {
    if (e.touches.length === 2){ d0 = dist(e.touches); sc0 = sc; }
    else if (e.touches.length === 1){
      px = e.touches[0].clientX; py = e.touches[0].clientY;
      const now = Date.now();
      if (now - lastTap < 300 && e.target === img){ sc = sc > 1 ? 1 : 2.5; clamp(); apply(); }
      lastTap = now;
    }
  }, {passive:true});
  v.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 2){ sc = Math.max(1, Math.min(6, sc0 * dist(e.touches)/d0)); }
    else if (e.touches.length === 1 && sc > 1){
      tx += e.touches[0].clientX - px; ty += e.touches[0].clientY - py;
      px = e.touches[0].clientX; py = e.touches[0].clientY;
    }
    clamp(); apply();
  }, {passive:false});
  v.addEventListener('wheel', e => { e.preventDefault(); sc = Math.max(1, Math.min(6, sc - e.deltaY/300)); clamp(); apply(); }, {passive:false});
  const close = () => v.remove();
  v.querySelector('.viewer-x').onclick = close;
  document.body.append(v);
}

function editRecord(r){
  const isNew = !r.id;
  const nowMonth = fmt(today()).slice(0,7);
  const pending = {};                 // clave -> Blob | null (quitar)
  const has = { ...(r.has || {}) };
  const p = openSheet(`
    <h2>${isNew ? 'Nuevo registro' : 'Editar ' + monthLong(r.id)}</h2>
    ${isNew ? `<label>Mes</label><input id="mo" type="month" value="${nowMonth}">` : ''}
    <label>Medidas (cm)</label>
    <div class="meas-grid">${MEAS.map(([k,n]) => `<div><input id="m-${k}" type="number" inputmode="decimal" min="0" step="any" value="${r[k] ?? ''}" placeholder="0"><small>${n}</small></div>`).join('')}</div>
    <label>Fotos <span class="stat">· mantén presionada una para eliminarla</span></label>
    <div class="photo-grid">${PHOTOS.map(([k,n]) => `<div><div class="ph-img pick" data-k="${k}">Agregar</div><small>${n}</small><input type="file" accept="image/*" hidden data-f="${k}"></div>`).join('')}</div>
    <label>Video (cuerpo completo) <span class="stat">· mantén presionado para eliminarlo</span></label>
    <div class="video-pick" id="vp"></div>
    <input type="file" accept="video/*" hidden id="vf">
    <div class="row">${isNew ? '' : '<button class="btn del" id="del">Borrar</button>'}<button class="btn" id="c">Cancelar</button><button class="btn pri" id="ok">Guardar</button></div>
  `, true);

  const showPhoto = async k => {
    const n = p.querySelector(`.ph-img[data-k="${k}"]`);
    const b = pending[k] !== undefined ? pending[k] : (has[k] && r.id ? await mediaGet(`${r.id}:${k}`) : null);
    n.style.backgroundImage = b ? `url(${URL.createObjectURL(b)})` : '';
    n.textContent = b ? '' : 'Agregar';
  };
  PHOTOS.forEach(([k]) => {
    const tile = p.querySelector(`.ph-img[data-k="${k}"]`), inp = p.querySelector(`input[data-f="${k}"]`);
    longPress(tile, () => inp.click(), () => {
      const tiene = pending[k] !== undefined ? !!pending[k] : !!has[k];
      if (tiene && confirm('¿Eliminar esta foto?')){ pending[k] = null; has[k] = false; showPhoto(k); }
    });
    inp.onchange = async () => { const f = inp.files[0]; if (!f) return; pending[k] = await resizeImage(f); has[k] = true; showPhoto(k); };
    showPhoto(k);
  });
  const vp = p.querySelector('#vp'), vf = p.querySelector('#vf');
  const showVideo = () => {
    const tiene = pending.video !== undefined ? !!pending.video : !!has.video;
    vp.textContent = tiene ? '✓ Video cargado · toca para cambiarlo' : 'Toca para elegir el video';
    vp.classList.toggle('on', tiene);
  };
  longPress(vp, () => vf.click(), () => {
    const tiene = pending.video !== undefined ? !!pending.video : !!has.video;
    if (tiene && confirm('¿Eliminar el video?')){ pending.video = null; has.video = false; showVideo(); }
  });
  vf.onchange = () => { const f = vf.files[0]; if (!f) return; pending.video = f; has.video = true; showVideo(); };
  showVideo();

  p.querySelector('#c').onclick = closeSheet;
  p.querySelector('#del')?.addEventListener('click', async () => {
    if (!confirm('¿Borrar este registro con sus fotos y video?')) return;
    for (const k of [...PHOTOS.map(x => x[0]), 'video']) await delMedia(`${r.id}:${k}`);
    S.records = S.records.filter(x => x.id !== r.id); save(); closeSheet(); render();
  });
  p.querySelector('#ok').onclick = async () => {
    const id = isNew ? (p.querySelector('#mo').value || nowMonth) : r.id;
    const btn = p.querySelector('#ok'); btn.textContent = 'Guardando…'; btn.disabled = true;
    try {
      for (const k in pending) {
        if (pending[k]) await putMedia(`${id}:${k}`, pending[k]); else await delMedia(`${id}:${k}`);
      }
    } catch(e){
      alert('No se pudo guardar una foto o el video (¿poco espacio?).');
      btn.textContent = 'Guardar'; btn.disabled = false; return;
    }
    const data = { id, has: { ...(S.records.find(x => x.id === id)?.has || {}), ...has } };
    MEAS.forEach(([k]) => data[k] = p.querySelector(`#m-${k}`).value);
    S.records = S.records.filter(x => x.id !== id).concat(data);
    recSel = id; save(); closeSheet(); render();
  };
}


// ---------- ENTRENAMIENTO (iniciar rutina) ----------
let workoutTimer = null;
const shortDate = d => { const x = parse(d); return `${x.getDate()} ${MONTHS[x.getMonth()].slice(0,3)}`; };
const fmtTime = sec => `${Math.floor(sec/60)}:${pad(sec%60)}`;

function lastSession(exId){
  for (let i = S.sessions.length-1; i >= 0; i--){
    const sets = S.sessions[i].sets[exId];
    if (sets && sets.length) return { date: S.sessions[i].date, sets };
  }
  return null;
}
const lastSets = exId => lastSession(exId)?.sets || null;
const LEVEL_NAMES = ['', 'Rojo', 'Amarillo', 'Verde'];

function startWorkout(routine){
  const k = fmt(today());
  if (!S.active || S.active.date !== k || S.active.routineId !== routine.id){
    const sets = {};
    routine.exerciseIds.forEach(id => {
      const ex = S.exercises.find(e => e.id === id); if (!ex) return;
      const prev = lastSets(id);
      sets[id] = prev ? prev.map(x => ({ kg: x.kg, reps: x.reps, level: 0 }))
                      : [0,1,2].map(() => ({ kg: ex.kg || '', reps: ex.reps || '', level: 0 }));
    });
    S.active = { date: k, routineId: routine.id, start: Date.now(), sets };
    save();
  }
  const A = S.active;
  Object.values(A.sets).flat().forEach(x => { if (x.level === undefined) x.level = x.done ? 3 : 0; });
  const w = el(`<div class="workout">
    <div class="w-head"><div><div class="w-name">${esc(routine.name)}</div><div class="w-time" id="wt">0:00</div></div><button class="w-x">✕</button></div>
    <div class="w-body" id="wb"></div>
    <div class="w-foot"><button class="btn pri" id="wf">Terminar rutina</button></div>
  </div>`);
  document.body.append(w);
  const wb = w.querySelector('#wb');
  const tick = () => { w.querySelector('#wt').textContent = fmtTime(Math.floor((Date.now() - A.start)/1000)); };
  tick(); clearInterval(workoutTimer); workoutTimer = setInterval(tick, 1000);
  const closeW = () => { clearInterval(workoutTimer); w.remove(); render(); };

  const draw = () => {
    const y = wb.scrollTop; wb.innerHTML = '';
    const ids = Object.keys(A.sets);
    wb.append(el(`<div class="w-legend">Toca el cuadro de cada serie: 1 vez 🔴 · 2 veces 🟡 · 3 veces 🟢 · otra vez para quitar</div>`));
    if (!ids.length) wb.append(el(`<div class="empty-msg">Esta rutina no tiene ejercicios.<br>Agrégalos en la pestaña Rutinas.</div>`));
    ids.forEach(id => {
      const ex = S.exercises.find(e => e.id === id);
      const last = lastSession(id);
      const card = el(`<div class="w-ex">
        <div class="nm">${esc(ex.name)}</div>
        <div class="w-info">
          <div><span>🏆 PR</span><b>${ex.kg ? `${ex.kg} kg × ${ex.reps || '—'}` : 'Sin PR'}</b></div>
          <div><span>Última vez${last ? ' · ' + shortDate(last.date) : ''}</span><b>${last ? last.sets.map(x => `${x.kg}×${x.reps}`).join('  ·  ') : 'Sin registro'}</b></div>
        </div>
        <div class="w-cols"><span>Serie</span><span>kg</span><span>Reps</span><span></span></div>
        <div class="w-sets"></div>
        <div class="w-btns"><button class="w-del">− Serie</button><button class="w-add">+ Serie</button></div>
      </div>`);
      const box = card.querySelector('.w-sets');
      A.sets[id].forEach((st, i) => {
        const row = el(`<div class="w-set ${st.level ? 'done' : ''}"><span>${i+1}</span>
          <input type="number" inputmode="decimal" step="any" min="0" value="${st.kg}" placeholder="0">
          <input type="number" inputmode="numeric" min="0" value="${st.reps}" placeholder="0">
          <button class="chk l${st.level}" aria-label="${LEVEL_NAMES[st.level] || 'Sin marcar'}"></button></div>`);
        const [kg, reps] = row.querySelectorAll('input');
        kg.oninput = () => { st.kg = kg.value; save(); };
        reps.oninput = () => { st.reps = reps.value; save(); };
        row.querySelector('.chk').onclick = () => { st.level = (st.level + 1) % 4; save(); draw(); }; // 1 rojo, 2 amarillo, 3 verde, 4 = quitar
        box.append(row);
      });
      const delBtn = card.querySelector('.w-del');
      delBtn.disabled = A.sets[id].length <= 1;
      delBtn.onclick = () => { if (A.sets[id].length > 1){ A.sets[id].pop(); save(); draw(); } }; // quita la última serie
      card.querySelector('.w-add').onclick = () => {
        const l = A.sets[id][A.sets[id].length-1];
        A.sets[id].push({ kg: l ? l.kg : '', reps: l ? l.reps : '', level: 0 }); save(); draw();
      };
      wb.append(card);
    });
    wb.scrollTop = y;
  };
  draw();

  w.querySelector('.w-x').onclick = closeW; // la sesión queda guardada: se retoma con "Continuar"
  w.querySelector('#wf').onclick = () => {
    const doneCount = Object.values(A.sets).flat().filter(x => x.level).length;
    if (!doneCount && !confirm('No marcaste ninguna serie. ¿Terminar de todos modos?')) return;
    const log = {};
    const prs = [];
    for (const id in A.sets){
      log[id] = A.sets[id].filter(x => x.level && x.kg !== '' && x.reps !== '').map(x => ({ kg: +x.kg, reps: +x.reps, level: x.level }));
      const ex = S.exercises.find(e => e.id === id);
      log[id].forEach(x => {
        const pk = +ex.kg || 0, pr = +ex.reps || 0;
        if (x.kg > pk || (x.kg === pk && x.reps > pr)){ ex.kg = String(x.kg); ex.reps = String(x.reps); if (!prs.includes(ex.name)) prs.push(ex.name); }
      });
      if (!log[id].length) delete log[id];
    }
    S.sessions.push({ id: String(Date.now()), date: A.date, routineId: A.routineId, name: routine.name,
      seconds: Math.floor((Date.now() - A.start)/1000), sets: log });
    S.marks[A.date] = 'went';
    S.active = null; save();
    clearInterval(workoutTimer); w.remove(); render();
    if (prs.length) setTimeout(() => alert('🏆 ¡Nuevo PR en: ' + prs.join(', ') + '!'), 100);
  };
}


// ---------- HISTORIAL (días que fui al gym) ----------
const attendedDays = () => {
  const set = new Set(S.sessions.map(x => x.date));
  for (const k in S.marks) if (S.marks[k] === 'went') set.add(k);
  return [...set].sort().reverse();
};
const longDate = k => { const d = parse(k); return `${DAYS[d.getDay()].slice(0,3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0,3)} ${d.getFullYear()}`; };

function openLog(){
  const days = attendedDays();
  const w = el(`<div class="workout">
    <div class="w-head"><div><div class="w-name">Historial</div><div class="w-time" style="color:var(--mute)">${days.length} día${days.length===1?'':'s'} entrenados · mantén presionado un día para editarlo</div></div><button class="w-x">✕</button></div>
    <div class="w-body"></div>
  </div>`);
  w.querySelector('.w-x').onclick = () => { w.remove(); render(); };
  const body = w.querySelector('.w-body');
  const reload = () => { const y = body.scrollTop; w.remove(); openLog(); const nb = document.querySelector('.workout .w-body'); if (nb) nb.scrollTop = y; };
  if (!days.length) body.append(el(`<div class="empty-msg">Aún no hay entrenamientos.<br>Aquí aparecerán los días que vayas al gym.</div>`));

  let lastMonth = '';
  days.forEach(k => {
    if (k.slice(0,7) !== lastMonth){
      lastMonth = k.slice(0,7);
      const cnt = days.filter(x => x.startsWith(lastMonth)).length;
      body.append(el(`<div class="log-month">${monthLong(lastMonth)} <small>${cnt} día${cnt===1?'':'s'}</small></div>`));
    }
    const sess = S.sessions.filter(x => x.date === k);
    const title = sess.length ? sess.map(x => x.name).join(' + ') : (planFor(parse(k))?.name || 'Asistido');
    const secs = sess.reduce((a, x) => a + (x.seconds || 0), 0);
    const nSets = sess.reduce((a, x) => a + Object.values(x.sets).flat().length, 0);
    const meta = sess.length ? [secs ? `${Math.max(1, Math.round(secs/60))} min` : '', `${nSets} series`].filter(Boolean).join(' · ') : 'sin detalle';
    const card = el(`<div class="log-day">
      <button class="log-sum"><div><div class="log-date">${longDate(k)}</div><div class="log-title">${esc(title)}</div></div><div class="log-meta">${meta}<span class="chev">›</span></div></button>
      <div class="log-detail"></div>
    </div>`);
    const det = card.querySelector('.log-detail');
    if (!sess.length) det.append(el(`<div class="hint" style="text-align:left">Marcaste este día como asistido, pero no se registró la rutina.</div>`));
    sess.forEach(x => {
      for (const id in x.sets){
        const ex = S.exercises.find(e => e.id === id);
        const row = el(`<div class="log-ex"><div class="nm">${esc(ex?.name || 'Ejercicio eliminado')}</div><div class="log-sets">${
          x.sets[id].map(st => `<span class="set-chip l${st.level || 0}">${st.kg} kg × ${st.reps}</span>`).join('')}</div></div>`);
        det.append(row);
      }
      if (!Object.keys(x.sets).length) det.append(el(`<div class="hint" style="text-align:left">No se marcó ninguna serie.</div>`));
    });
    longPress(card.querySelector('.log-sum'), () => card.classList.toggle('open'), () => dayMenu(k, reload)); // mantener presionado = editar / eliminar
    body.append(card);
  });
  document.body.append(w);
}


function dayMenu(k, reload){
  const p = openSheet(`<h2>${longDate(k)}</h2>
    <button class="opt" id="e">✏️ Editar</button>
    <button class="opt" id="d" style="color:var(--red)">🗑 Eliminar este día</button>
    <div class="row"><button class="btn" id="c">Cancelar</button></div>`);
  p.querySelector('#c').onclick = closeSheet;
  p.querySelector('#e').onclick = () => { closeSheet(); editLogDay(k, reload); };
  p.querySelector('#d').onclick = () => {
    if (!confirm(`¿Eliminar ${longDate(k)} del historial? Se borran sus series y la asistencia de ese día.`)) return;
    S.sessions = S.sessions.filter(x => x.date !== k);
    if (S.marks[k] === 'went') delete S.marks[k];
    save(); closeSheet(); reload();
  };
}

function editLogDay(k, reload){
  const draft = S.sessions.filter(x => x.date === k).map(x => JSON.parse(JSON.stringify(x)));
  let date = k;
  const p = openSheet(`<h2>Editar día</h2>
    <label>Fecha</label><input type="date" id="dt" value="${k}">
    <div id="ss"></div>
    <div class="row"><button class="btn" id="c">Cancelar</button><button class="btn pri" id="ok">Guardar</button></div>`, true);
  p.querySelector('#dt').onchange = e => { if (e.target.value) date = e.target.value; };
  const box = p.querySelector('#ss');
  const draw = () => {
    box.innerHTML = '';
    if (!draft.length) box.append(el(`<div class="hint" style="text-align:left;margin-top:12px">Este día solo tiene la asistencia marcada, sin series registradas. Puedes cambiarle la fecha.</div>`));
    draft.forEach(ses => {
      const sb = el(`<div class="ed-ses"><label>Rutina</label><input class="ed-name" value="${esc(ses.name)}"></div>`);
      sb.querySelector('.ed-name').oninput = e => { ses.name = e.target.value; };
      Object.keys(ses.sets).forEach(id => {
        const ex = S.exercises.find(e => e.id === id);
        const arr = ses.sets[id];
        const card = el(`<div class="w-ex"><div class="nm">${esc(ex?.name || 'Ejercicio eliminado')}</div>
          <div class="w-cols"><span>Serie</span><span>kg</span><span>Reps</span><span></span></div><div class="w-sets"></div>
          <div class="w-btns"><button class="w-del">− Serie</button><button class="w-add">+ Serie</button></div>
          <button class="w-add" style="margin-top:8px;color:var(--red)" data-rm>Quitar ejercicio</button></div>`);
        const sets = card.querySelector('.w-sets');
        arr.forEach((st, i) => {
          const row = el(`<div class="w-set"><span>${i+1}</span>
            <input type="number" inputmode="decimal" step="any" min="0" value="${st.kg}">
            <input type="number" inputmode="numeric" min="0" value="${st.reps}">
            <button class="chk l${st.level || 0}"></button></div>`);
          const [kg, reps] = row.querySelectorAll('input');
          kg.oninput = () => { st.kg = kg.value; }; reps.oninput = () => { st.reps = reps.value; };
          row.querySelector('.chk').onclick = e => { st.level = ((st.level || 0) + 1) % 4; e.currentTarget.className = 'chk l' + st.level; };
          sets.append(row);
        });
        card.querySelector('.w-add:not([data-rm])').onclick = () => { const l = arr[arr.length-1]; arr.push({ kg: l ? l.kg : '', reps: l ? l.reps : '', level: 0 }); draw(); };
        const del = card.querySelector('.w-del'); del.disabled = arr.length <= 1;
        del.onclick = () => { if (arr.length > 1){ arr.pop(); draw(); } };
        card.querySelector('[data-rm]').onclick = () => { if (confirm('¿Quitar este ejercicio del día?')){ delete ses.sets[id]; draw(); } };
        sb.append(card);
      });
      box.append(sb);
    });
  };
  draw();
  p.querySelector('#c').onclick = closeSheet;
  p.querySelector('#ok').onclick = () => {
    const clean = draft.map(ses => {
      const sets = {};
      for (const id in ses.sets){
        const arr = ses.sets[id].filter(x => x.kg !== '' && x.reps !== '').map(x => ({ kg: +x.kg, reps: +x.reps, level: x.level || 0 }));
        if (arr.length) sets[id] = arr;
      }
      return { ...ses, name: ses.name.trim() || 'Rutina', date, sets };
    });
    S.sessions = S.sessions.filter(x => x.date !== k).concat(clean);
    if (date !== k && S.marks[k] === 'went'){ delete S.marks[k]; S.marks[date] = 'went'; }
    save(); closeSheet(); reload();
  };
}


// ---------- RESPALDO (exportar / importar todo: datos + fotos + video) ----------
const blobToData = b => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
const mediaKeys = () => mediaTx('readonly', st => st.getAllKeys()).then(k => k || []).catch(() => []);

async function exportBackup(btn){
  btn.disabled = true; btn.textContent = 'Preparando…';
  try {
    const media = {};
    for (const k of await mediaKeys()){ const b = await mediaGet(k); if (b) media[k] = await blobToData(b); }
    const data = JSON.stringify({ app: 'gymtrack', version: 1, exported: new Date().toISOString(), state: S, media });
    const file = new File([data], `gymtrack-respaldo-${fmt(today())}.json`, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })){
      try { await navigator.share({ files: [file], title: 'Respaldo Gym Track' }); btn.textContent = '✓ Listo'; return; }
      catch(e){ if (e.name === 'AbortError'){ btn.disabled = false; btn.textContent = 'Exportar respaldo'; return; } }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name;
    document.body.append(a); a.click(); a.remove();
    btn.textContent = '✓ Descargado';
  } catch(e){ alert('No se pudo crear el respaldo.'); btn.textContent = 'Exportar respaldo'; }
  btn.disabled = false;
}

let reloadApp = () => location.reload();
async function importBackup(file){
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== 'gymtrack' || !d.state) throw new Error('formato');
    if (!confirm(`Esto REEMPLAZA todos los datos actuales de esta app por los del respaldo (${d.exported?.slice(0,10) || 'sin fecha'}). ¿Continuar?`)) return;
    for (const k of await mediaKeys()) await mediaDel(k);
    d.state.mediaVer = {};
    for (const k in (d.media || {})){ await mediaPut(k, await (await fetch(d.media[k])).blob()); d.state.mediaVer[k] = Date.now(); }
    d.state._ts = Date.now();
    localStorage.setItem(KEY, JSON.stringify(d.state));
    meta.dirty = true; meta.have = {}; meta.up = {}; saveMeta();
    alert('Respaldo importado ✓'); reloadApp();
  } catch(e){ alert('Ese archivo no es un respaldo válido de Gym Track.'); }
}

function openBackup(){
  const p = openSheet(`<h2>Cuenta y respaldo</h2>
    <div id="acct"></div>
    <label style="margin-top:18px">Respaldo manual</label>
    <p class="hint" style="text-align:left;line-height:1.5">Guarda en un archivo todas tus rutinas, ejercicios, historial, medidas, fotos y video.</p>
    <button class="btn" id="ex" style="width:100%;margin-top:6px">Exportar respaldo</button>
    <button class="btn" id="im" style="width:100%;margin-top:10px">Importar respaldo</button>
    <input type="file" id="imf" accept=".json,application/json" hidden>
    <div class="row"><button class="btn" id="c">Cerrar</button></div>`);
  drawAccount(p.querySelector('#acct'));
  p.querySelector('#ex').onclick = e => exportBackup(e.currentTarget);
  const f = p.querySelector('#imf');
  p.querySelector('#im').onclick = () => f.click();
  f.onchange = () => { if (f.files[0]) importBackup(f.files[0]); };
  p.querySelector('#c').onclick = closeSheet;
}

// instalar como app: la app abre sin internet
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')){
  navigator.serviceWorker.register('sw.js').catch(() => {});
}


// ---------- SINCRONIZACIÓN entre dispositivos (Supabase, por REST) ----------
const SYNC = { url: 'https://wcocekujwvcotthaxnxn.supabase.co', key: 'sb_publishable_Xkib7jLw7J9EVoyHfAXFeA_PwF54Gq0' };   // URL del proyecto y clave "anon" (pública; los datos los protege la seguridad por usuario)
const META_KEY = 'gymtrack.sync', AUTH_KEY = 'gymtrack.auth';
const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch(e){ return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} };
// meta = estado de sincronización de ESTE dispositivo: baseTs = versión de la nube que ya tenemos, dirty = hay cambios sin subir
var meta = lsGet(META_KEY, null) || { baseTs: 0, dirty: false, up: {}, have: {}, fail: {}, last: 0 };
meta.up = meta.up || {}; meta.have = meta.have || {}; meta.fail = meta.fail || {};
var auth = lsGet(AUTH_KEY, null);
const saveMeta = () => lsSet(META_KEY, meta);
const syncOn = () => !!(SYNC.url && SYNC.key);
let syncing = false, syncStatus = 'idle', syncDetail = '', syncTimer = null;

function markDirty(){ meta.dirty = true; saveMeta(); scheduleSync(); }
function scheduleSync(){ if (!syncOn() || !auth) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(), 2000); }

const statusText = () => !syncOn() ? '' : !auth ? 'sin iniciar sesión' :
  ({ syncing: 'sincronizando…', ok: meta.dirty ? 'cambios pendientes' : '✓ sincronizado', offline: 'sin conexión', error: 'error al sincronizar', idle: meta.dirty ? 'cambios pendientes' : (meta.last ? '✓ sincronizado' : '') })[syncStatus];
function paintSync(){
  document.querySelectorAll('.sync-small').forEach(n => n.textContent = statusText());
  document.querySelectorAll('.sync-status').forEach(n => n.textContent = statusText() + (syncDetail ? ' · ' + syncDetail : '') + (meta.last ? ` · última: ${new Date(meta.last).toLocaleTimeString('es', {hour:'2-digit', minute:'2-digit'})}` : ''));
}
function setStatus(st, detail){ syncStatus = st; syncDetail = detail || ''; paintSync(); }

async function authReq(path, body){
  const r = await fetch(`${SYNC.url}/auth/v1/${path}`, { method: 'POST', headers: { apikey: SYNC.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(({ invalid_credentials: 'Correo o contraseña incorrectos', user_already_exists: 'Ese correo ya tiene cuenta: inicia sesión', weak_password: 'La contraseña es muy corta (mínimo 6)' })[j.error_code] || j.msg || j.error_description || j.message || 'Error de conexión');
  return j;
}
function setSession(j){
  auth = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, uid: j.user.id, email: j.user.email };
  lsSet(AUTH_KEY, auth);
  if (meta.uid && meta.uid !== auth.uid) meta = { baseTs: 0, dirty: true, up: {}, have: {}, fail: {}, last: 0 };  // otra cuenta: no mezclar
  meta.uid = auth.uid; saveMeta();
}
async function signUp(email, pw){
  const j = await authReq('signup', { email, password: pw });
  if (!j.access_token) throw new Error('En Supabase desactiva "Confirm email" (Authentication → Sign In / Providers → Email) y vuelve a intentar.');
  setSession(j);
}
const signIn = async (email, pw) => setSession(await authReq('token?grant_type=password', { email, password: pw }));
function signOut(){
  auth = null; try { localStorage.removeItem(AUTH_KEY); } catch(e){}
  setStatus('idle');
}
async function token(){
  if (!auth) throw new Error('sin sesión');
  if (Date.now() > auth.expires_at - 60000){
    try { setSession(await authReq('token?grant_type=refresh_token', { refresh_token: auth.refresh_token })); }
    catch(e){ if (navigator.onLine && /refresh|invalid|expired|not found/i.test(e.message)){ auth = null; try { localStorage.removeItem(AUTH_KEY); } catch(_){} } throw e; }
  }
  return auth.access_token;
}
async function api(path, opts = {}){
  const t = await token();
  return fetch(`${SYNC.url}${path}`, { ...opts, headers: { apikey: SYNC.key, Authorization: 'Bearer ' + t, ...(opts.headers || {}) } });
}
const mediaPath = key => `/storage/v1/object/media/${auth.uid}/${key.replace(':', '_')}`;

async function pushMedia(vers){
  let skipped = 0;
  for (const key in vers){
    const v = vers[key];
    if (meta.up[key] === v || meta.fail[key] === v) continue;
    try {
      if (v > 0){
        const b = await mediaGet(key);
        if (b){
          const r = await api(mediaPath(key), { method: 'POST', headers: { 'Content-Type': b.type || 'application/octet-stream', 'x-upsert': 'true' }, body: b });
          if (!r.ok) throw new Error(r.status === 413 ? 'archivo demasiado grande' : 'HTTP ' + r.status);
        }
      } else {
        await api(mediaPath(key), { method: 'DELETE' });
      }
      meta.up[key] = v; delete meta.fail[key];
    } catch(e){ meta.fail[key] = v; skipped++; }
    saveMeta();
  }
  return skipped;
}

async function push(){
  const snap = { ...S, active: null };            // la rutina en curso no se comparte
  const sent = S._ts || (S._ts = Date.now());
  snap._ts = sent;
  const skipped = await pushMedia({ ...(S.mediaVer || {}) });
  const r = await api('/rest/v1/gym_data', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: auth.uid, state: snap, ts: sent }) });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' (¿ya ejecutaste el SQL de configuración?)');
  meta.baseTs = sent;
  if (S._ts === sent) meta.dirty = false;
  saveMeta();
  if (skipped) syncDetail = `${skipped} archivo(s) no se pudieron subir`;
}

async function applyRemote(remote){
  const st = remote.state;
  for (const key in (st.mediaVer || {})){
    const v = st.mediaVer[key];
    if (meta.have[key] === v) continue;
    if (v > 0){
      const r = await api(mediaPath(key).replace('/object/', '/object/authenticated/'));
      if (!r.ok) continue;
      await mediaPut(key, await r.blob());
    } else await mediaDel(key);
    meta.have[key] = v; meta.up[key] = v;
  }
  const active = S.active;
  st.active = active || null;
  localStorage.setItem(KEY, JSON.stringify(st));
  S = load();
  meta.baseTs = remote.ts; meta.dirty = false; saveMeta();
  if (!document.querySelector('.workout, .sheet:not(.hidden), .viewer')) render();
}

async function syncNow(){
  if (!syncOn() || !auth || syncing) return;
  syncing = true; setStatus('syncing');
  try {
    if (!meta.dirty){   // revisión barata: si la nube no cambió, no se descarga nada
      const q = await api(`/rest/v1/gym_data?select=ts&user_id=eq.${auth.uid}`);
      if (q.ok){ const row = (await q.json())[0]; if (row && row.ts === meta.baseTs){ meta.last = Date.now(); saveMeta(); setStatus('ok', syncDetail); return; } }
    }
    const r = await api(`/rest/v1/gym_data?select=state,ts&user_id=eq.${auth.uid}`);
    if (!r.ok) throw new Error('HTTP ' + r.status + ' (¿ya ejecutaste el SQL de configuración?)');
    const remote = (await r.json())[0];
    if (!remote) await push();
    else if (remote.ts === meta.baseTs){ if (meta.dirty) await push(); }
    else if (!meta.dirty) await applyRemote(remote);
    else if (confirm('Hay cambios en la nube y también en este dispositivo.\n\nAceptar = usar los datos de la nube (se pierden los cambios de aquí)\nCancelar = usar los de este dispositivo (reemplaza la nube)')) await applyRemote(remote);
    else await push();
    meta.last = Date.now(); saveMeta(); setStatus('ok', syncDetail);
  } catch(e){
    setStatus(navigator.onLine ? 'error' : 'offline', navigator.onLine ? e.message : '');
  } finally { syncing = false; paintSync(); }
}

function drawAccount(box){
  box.innerHTML = '';
  if (!syncOn()){ box.append(el(`<p class="hint" style="text-align:left">La sincronización todavía no está configurada en esta app.</p>`)); return; }
  if (auth){
    const v = el(`<div><label>Sincronización activa</label><div class="acct-mail">${esc(auth.email)}</div>
      <div class="hint sync-status" style="text-align:left;margin:6px 0 10px"></div>
      <div class="row" style="margin-top:0"><button class="btn pri" id="sn">Sincronizar ahora</button><button class="btn del" id="so">Cerrar sesión</button></div></div>`);
    v.querySelector('#sn').onclick = () => syncNow();
    v.querySelector('#so').onclick = () => { if (confirm('¿Cerrar sesión? Tus datos se quedan en este dispositivo.')){ signOut(); drawAccount(box); } };
    box.append(v); paintSync(); return;
  }
  const f = el(`<div><label>Entra para sincronizar tus datos entre dispositivos</label>
    <input id="em" type="email" inputmode="email" autocapitalize="none" autocomplete="email" placeholder="correo@ejemplo.com">
    <input id="pw" type="password" autocomplete="current-password" placeholder="Contraseña (mínimo 6)" style="margin-top:8px">
    <div class="hint" id="err" style="text-align:left;color:var(--red);min-height:16px;margin-top:6px"></div>
    <div class="row" style="margin-top:6px"><button class="btn pri" id="in">Iniciar sesión</button><button class="btn" id="up">Crear cuenta</button></div></div>`);
  const go = fn => async e => {
    const email = f.querySelector('#em').value.trim(), pw = f.querySelector('#pw').value, err = f.querySelector('#err'), btn = e.currentTarget;
    if (!email || pw.length < 6){ err.textContent = 'Escribe tu correo y una contraseña de al menos 6 caracteres.'; return; }
    btn.disabled = true; err.textContent = '';
    try { await fn(email, pw); drawAccount(box); syncNow(); }
    catch(x){ err.textContent = x.message; btn.disabled = false; }
  };
  f.querySelector('#in').onclick = go(signIn);
  f.querySelector('#up').onclick = go(signUp);
  box.append(f);
}

// sincroniza al abrir, al volver a la app y al recuperar internet
window.addEventListener('online', () => syncNow());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
window.addEventListener('focus', () => syncNow());                                  // al volver a la ventana (Mac/iPad con varias ventanas)
setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 30000);  // y cada 30 s mientras la app está abierta
setTimeout(() => { paintSync(); syncNow(); }, 300);

render();
