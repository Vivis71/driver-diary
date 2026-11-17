/* shifts.js — недели, смены и журнал.
   Подключается из index.html. Здесь вся логика смен: кнопки «Начало недели / Начало смены / Конец смены»,
   журнал (книжечка), правка записей, контроль 144 часов. Сюда же добавлять будущие правила (9/10/15 ч и т.д.).
   Использует из index.html: userProfile, profiles, currentProfileIndex, saveProfilesStorage, showToast, updateDashboard. */

// ================= НЕДЕЛИ И СМЕНЫ: журнал =================
// Структура: userProfile.weeks = [{ start:'ДД.ММ.ГГГГ ЧЧ:ММ', end:null|строка, shifts:[{start, end}] }]
// Последняя неделя считается текущей. Старые поля weekStart/shiftStart/shiftEnd держим синхронными (для главного экрана и паузы).
const WEEK_MS = 144 * 3600 * 1000;
// «Сейчас» по Варшаве: возвращает мс такие, что локальные геттеры Date (getHours и т.д.) дают варшавские часы
function nowW() {
    const p = {};
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
    return new Date(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute).getTime();
}
const jPad = n => String(n).padStart(2, '0');
const noYearStr = str => String(str).replace(/\.(\d{4})(?= )/, '');
function parseDT(s) {
    if (!s) return null;
    const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/.exec(s);
    return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).getTime() : null;
}
function fmtDT(ms) {
    const d = new Date(ms);
    return `${jPad(d.getDate())}.${jPad(d.getMonth() + 1)}.${d.getFullYear()} ${jPad(d.getHours())}:${jPad(d.getMinutes())}`;
}
function ensureWeeks(p) {
    if (!p || Array.isArray(p.weeks)) return;
    p.weeks = [];
    if (p.weekStart) {
        const w = { start: p.weekStart, end: null, shifts: [] };
        if (p.shiftStart) w.shifts.push({ start: p.shiftStart, end: p.shiftEnd || null });
        p.weeks.push(w);
    }
}
function syncLegacy(p) {
    const w = p.weeks[p.weeks.length - 1];
    if (!w) { p.weekStart = null; p.shiftStart = null; p.shiftEnd = null; return; }
    p.weekStart = w.start;
    const s = w.shifts[w.shifts.length - 1];
    p.shiftStart = s ? s.start : null;
    p.shiftEnd = s ? (s.end || null) : null;
}
function persistJournal() {
    syncLegacy(userProfile);
    profiles[currentProfileIndex] = userProfile;
    saveProfilesStorage();
    updateDashboard();
}
function curWeek() {
    ensureWeeks(userProfile);
    return userProfile.weeks[userProfile.weeks.length - 1] || null;
}
function weekLastClosedEnd(w) {
    let best = parseDT(w.start);
    w.shifts.forEach(s => { const e = parseDT(s.end); if (e !== null && e > best) best = e; });
    return best;
}
function weekExpired(w, nowMs) {
    const s = w ? parseDT(w.start) : null;
    return s !== null && (nowMs - s) > WEEK_MS;
}
function durStr(a, b) {
    const mins = Math.max(0, Math.round((b - a) / 60000));
    return `${Math.floor(mins / 60)}:${jPad(mins % 60)}`;
}

// --- универсальное подтверждение ---
let flowYes = null;
function flowConfirm(title, text, yesText, onYes) {
    flowYes = onYes;
    document.getElementById('flowTitle').innerText = title;
    document.getElementById('flowText').innerText = text;
    document.getElementById('flowYes').innerText = yesText || 'Да';
    document.getElementById('flowModal').style.display = 'flex';
}
function flowClose(ok) {
    document.getElementById('flowModal').style.display = 'none';
    const f = flowYes; flowYes = null;
    if (ok && f) f();
}

// --- действия ---
function confirmStartWeek() {
    document.getElementById('weekModal').classList.remove('hidden');
}
function closeWeekModal(ok) {
    document.getElementById('weekModal').classList.add('hidden');
    if (ok) startWeekNow();
}
// Новая неделя: прошлая закрывается по концу её последней закрытой смены
function startWeekNow() {
    ensureWeeks(userProfile);
    const now = fmtDT(nowW());
    const cur = curWeek();
    if (cur && !cur.end) cur.end = fmtDT(weekLastClosedEnd(cur));
    userProfile.weeks.push({ start: now, end: null, shifts: [{ start: now, end: null }] });
    persistJournal();
    showToast(`✅ Неделя начата, смена открыта:\n${now}`);
}
function doStartShift() {
    const cur = curWeek();
    const now = fmtDT(nowW());
    cur.shifts.push({ start: now, end: null });
    persistJournal();
    showToast(`✅ Смена начата:\n${now}`);
}
function startShiftAction() {
    const cur = curWeek();
    if (!cur) { startWeekNow(); return; }
    if (weekExpired(cur, nowW())) {
        flowConfirm('Начать новую неделю?', `С начала недели (${noYearStr(cur.start)}) прошло больше 144 часов. Неделя начнётся сейчас вместе со сменой.`, 'Начать', startWeekNow);
        return;
    }
    const last = cur.shifts[cur.shifts.length - 1];
    if (last && !last.end) {
        flowConfirm('Предыдущая смена не закрыта', `Смена с ${noYearStr(last.start)} без конца. Начать новую? У предыдущей в журнале останется прочерк.`, 'Начать новую', doStartShift);
        return;
    }
    doStartShift();
}
function endShiftAction() {
    const cur = curWeek();
    const last = cur && cur.shifts[cur.shifts.length - 1];
    if (!last || last.end) { showToast('Нет открытой смены'); return; }
    const now = fmtDT(nowW());
    last.end = now;
    persistJournal();
    showToast(`⏹ Смена завершена:\n${now}`);
}

// --- окно журнала ---
let jOpen = {};
function openJournal() {
    ensureWeeks(userProfile);
    jOpen = {}; jView = 'list';
    renderJournal();
    document.getElementById('journalModal').style.display = 'flex';
}
function closeJournal() { document.getElementById('journalModal').style.display = 'none'; }
function jShiftRow(wi, si, w, isCurWeek) {
    const s = w.shifts[si];
    const a = parseDT(s.start), b = parseDT(s.end);
    const lastShift = si === w.shifts.length - 1;
    let tail = '';
    if (b !== null && a !== null) tail = durStr(a, b);
    else if (isCurWeek && lastShift) tail = 'идёт';
    const endTxt = s.end ? noYearStr(s.end) : '<span style="color:#fbbf24;">—</span>';
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 2px;border-top:1px solid #343a52;font-size:14px;">
        <span style="width:18px;color:#7d86a0;font-size:12px;">${si + 1}</span>
        <span style="flex:1;color:#e9ecf4;">${noYearStr(s.start)} → ${endTxt}</span>
        <span style="color:#a3acc2;font-size:12px;min-width:36px;text-align:right;">${tail}</span>
        <button onclick="editShift(${wi},${si})" aria-label="Изменить" style="width:28px;height:28px;border-radius:8px;border:1px solid #454d6b;background:transparent;color:#a3acc2;font-size:13px;">&#9998;</button>
    </div>`;
}
function renderJournal() {
    const weeks = userProfile.weeks;
    const box = document.getElementById('journalBody');
    if (!weeks.length) {
        box.innerHTML = '<div style="color:#a3acc2;font-size:13px;padding:14px 4px;text-align:center;">Записей пока нет. Нажмите «Начало недели».</div>';
        return;
    }
    const tab = (v, t) => `<button onclick="jSetView('${v}')" style="flex:1;padding:8px;border-radius:9px;font-size:13px;font-weight:600;border:1px solid #454d6b;background:${jView === v ? '#f5a524' : 'transparent'};color:${jView === v ? '#1f1300' : '#a3acc2'};">${t}</button>`;
    const tabs = `<div style="display:flex;gap:8px;margin-bottom:10px;">${tab('list', 'Список')}${tab('chart', 'График')}</div>`;
    if (jView === 'chart') { box.innerHTML = tabs + '<div id="wkBox"></div>'; renderWeeksChart(document.getElementById('wkBox')); return; }
    const ci = weeks.length - 1, cw = weeks[ci];
    let h = tabs + `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#262b3d;border:1px solid #343a52;border-radius:10px;margin-bottom:4px;">
        <span style="font-size:14px;font-weight:600;color:#f5a524;">Неделя · с ${noYearStr(cw.start)}</span>
        <span style="display:flex;align-items:center;gap:8px;"><span style="font-size:12px;color:${weekExpired(cw, nowW()) ? '#fbbf24' : '#3fbf8a'};">${weekExpired(cw, nowW()) ? '144 ч прошло' : 'идёт'}</span>
        <button onclick="editWeek(${ci})" aria-label="Изменить неделю" style="width:28px;height:28px;border-radius:8px;border:1px solid #454d6b;background:transparent;color:#a3acc2;font-size:13px;">&#9998;</button></span></div>`;
    if (!cw.shifts.length) h += '<div style="color:#a3acc2;font-size:13px;padding:8px 4px;">Смен пока нет</div>';
    cw.shifts.forEach((s, si) => { h += jShiftRow(ci, si, cw, true); });
    if (ci > 0) {
        h += '<div style="color:#a3acc2;font-size:11px;letter-spacing:.04em;text-transform:uppercase;margin:14px 2px 4px;">Прошлые недели</div>';
        for (let wi = ci - 1; wi >= 0; wi--) {
            const w = weeks[wi];
            let total = 0;
            w.shifts.forEach(s => { const a = parseDT(s.start), b = parseDT(s.end); if (a !== null && b !== null && b > a) total += (b - a); });
            const mins = Math.round(total / 60000);
            const endTxt = w.end ? noYearStr(w.end).split(' ')[0] : '—';
            const open = !!jOpen[wi];
            h += `<div onclick="jToggle(${wi})" style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:#262b3d;border:1px solid #343a52;border-radius:10px;margin-top:6px;font-size:13px;color:#e9ecf4;">
                <span>${noYearStr(w.start).split(' ')[0]} → ${endTxt}</span>
                <span style="color:#a3acc2;font-size:12px;">${w.shifts.length} смен · ${Math.floor(mins / 60)}:${jPad(mins % 60)} ч ${open ? '&#8964;' : '&#8250;'}</span></div>`;
            if (open) {
                h += `<div style="padding:0 4px 4px;">`;
                h += `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 2px;font-size:12px;color:#a3acc2;"><span>Начало недели: ${noYearStr(w.start)}</span><button onclick="editWeek(${wi})" aria-label="Изменить неделю" style="width:28px;height:28px;border-radius:8px;border:1px solid #454d6b;background:transparent;color:#a3acc2;font-size:13px;">&#9998;</button></div>`;
                w.shifts.forEach((s, si) => { h += jShiftRow(wi, si, w, false); });
                h += '</div>';
            }
        }
    }
    box.innerHTML = h;
}
function jToggle(wi) { jOpen[wi] = !jOpen[wi]; renderJournal(); }

// --- график недель ---
/* ---------- недели: полоски по дням ---------- */
var WKD = 86400000, wkOpen = null, wkSel = null;
var BED = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#10110f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left:3px"><path d="M7 9m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M22 17v-3h-20"/><path d="M2 8v9"/><path d="M12 14v-5h7a3 3 0 0 1 3 3v2"/></svg>';
function wkParse(t){ var m = /^(\d\d)\.(\d\d)\.(\d{4}) (\d\d):(\d\d)$/.exec(t || ''); return m ? Date.UTC(+m[3], +m[2]-1, +m[1], +m[4], +m[5]) : null; }
function wkNow(){
  var p = {}; new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Warsaw', hourCycle:'h23', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'})
    .formatToParts(new Date()).forEach(function(x){ p[x.type] = x.value; });
  return Date.UTC(+p.year, +p.month-1, +p.day, +p.hour, +p.minute);
}
function wkHM(ms){ var m = Math.round(ms / 60000); return Math.floor(m / 60) + ':' + jPad(m % 60); }
function wkClk(ms){ var d = new Date(ms); return jPad(d.getUTCHours()) + ':' + jPad(d.getUTCMinutes()); }
function wkIsoWeek(ms){
  var d = new Date(ms + 2 * WKD), day = (d.getUTCDay() + 6) % 7;
  var th = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  var f = new Date(Date.UTC(th.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((th - f) / WKD - 3 + ((f.getUTCDay() + 6) % 7)) / 7);
}
function wkAll(){
  var ws = userProfile.weeks || [];
  return ws.map(function(w){
    return {start: wkParse(w.start), shifts: (w.shifts || []).map(function(x){ return {a: wkParse(x.start), b: wkParse(x.end)}; }).filter(function(x){ return x.a !== null; }).sort(function(x, y){ return x.a - y.a; })};
  }).filter(function(w){ return w.start !== null; });
}
function wkDn(i){ var m = /^(\d{4})-(\d\d)-(\d\d)/.exec(i || ''); return m ? Math.floor(Date.UTC(+m[1], +m[2]-1, +m[3]) / WKD) : 0; }
function wkFmt(n){ var d = new Date(n * WKD); return jPad(d.getUTCDate()) + '.' + jPad(d.getUTCMonth() + 1); }
function wdName(n){ return ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][new Date(n * WKD).getUTCDay()]; }
function wkCads(){ return (userProfile.schedule && userProfile.schedule.cadences) || []; }
function wkCadOf(ms){
  var d = Math.floor(ms / WKD), best = -1, cs = wkCads();
  cs.forEach(function(c, i){ if (wkDn(c.start) <= d && (best < 0 || wkDn(c.start) >= wkDn(cs[best].start))) best = i; });
  return best;
}
function wkBuild(g, gi, now){
  var w = g.weeks[gi], c = g.cad >= 0 ? wkCads()[g.cad] : null;
  var nextIn = g.weeks[gi + 1] || null;
  var a = w.start;
  if (gi === 0 && c){ var cs = wkDn(c.start) * WKD; if (cs < a) a = cs; }
  var lastEnd = w.start; w.shifts.forEach(function(x){ if (x.b !== null && x.b > lastEnd) lastEnd = x.b; else if (x.a > lastEnd) lastEnd = x.a; });
  var stop, ongoing = false;
  if (nextIn) stop = nextIn.start;
  else if (c && c.end){ stop = Math.max((wkDn(c.end) + 1) * WKD, lastEnd); }
  else { stop = Math.max(now, lastEnd); ongoing = true; }
  var segs = [], t = a, work = 0;
  w.shifts.forEach(function(x, i){
    var b = x.b, unk = false;
    if (b === null){
      var nx = w.shifts[i + 1];
      if (nx){ b = nx.a; unk = true; }
      else if (ongoing){ b = stop; }
      else { b = stop; unk = true; }
    }
    if (b < x.a) b = x.a;
    var aa = Math.max(x.a, a), bb = Math.min(b, stop);
    if (aa < t) aa = t;
    if (bb <= aa) return;
    if (aa > t) segs.push({a: t, b: aa, k: 'r'});
    segs.push({a: aa, b: bb, k: 'w', unk: unk});
    if (!unk) work += bb - aa;
    t = bb;
  });
  if (stop > t) segs.push({a: t, b: stop, k: 'r'});
  return {a: a, stop: stop, segs: segs, work: work, n: w.shifts.length, week: w, ongoing: ongoing};
}
function wkBars(bd, Wpx){
  var a = bd.a, stop = bd.stop, segs = bd.segs;
  var d0 = Math.floor(a / WKD) * WKD, d1 = Math.floor((stop - 1) / WKD) * WKD;
  var pieces = [];
  for (var dd = d0; dd <= d1; dd += WKD){
    segs.forEach(function(sg, si){
      var x = Math.max(sg.a, dd), y = Math.min(sg.b, dd + WKD);
      if (y > x) pieces.push({d: dd, si: si, x: x, y: y, k: sg.k, unk: sg.unk});
    });
  }
  segs.forEach(function(sg, si){
    var best = null;
    pieces.forEach(function(q){ if (q.si === si && (!best || q.y - q.x > best.y - best.x)) best = q; });
    if (best) best.dur = true;
  });
  var h = '<div class="wkg"><span></span><div class="wksc">';
  for (var hh = 0; hh <= 24; hh += 3) h += '<span style="left:' + (hh / 24 * 100) + '%;transform:translateX(' + (hh === 0 ? 0 : hh === 24 ? -100 : -50) + '%)">' + hh + '</span>';
  h += '<span style="left:' + (5 / 24 * 100) + '%;transform:translateX(-50%);color:#f0707a;font-weight:600">5</span></div></div>';
  for (var d = d0; d <= d1; d += WKD){
    var bar = '', lbl = '';
    pieces.filter(function(q){ return q.d === d; }).forEach(function(q){
      var l = (q.x - d) / WKD * 100, w = (q.y - q.x) / WKD * 100, px = w / 100 * Wpx;
      var col = q.k === 'w' ? '#f5a524' : '#3fbf8a';
      var bg = q.unk ? 'repeating-linear-gradient(45deg,#f5a524 0 5px,#8a5d10 5px 10px)' : col;
      bar += '<div class="p" style="left:' + l + '%;width:' + w + '%;background:' + bg + '"></div>';
      if (q.dur && px >= 30){
        var sg = segs[q.si], txt = q.unk ? '?' : wkHM(sg.b - sg.a);
        var bed = (q.k === 'r' && px >= 56) ? BED : '';
        lbl += '<div class="lb" style="left:' + l + '%;width:' + w + '%"><span style="background:' + (q.unk ? '#c98a1a' : col) + '">' + txt + bed + '</span></div>';
      }
      if (q.x > d){
        var late = l > 76, first = q.x === a;
        lbl += '<div class="tm" style="' + (late ? 'right:calc(' + (100 - l) + '% + 2px)' : 'left:calc(' + l + '% + 2px)') + '"><span style="color:' + (first && late ? '#e9ecf4' : '#10110f') + '">' + wkClk(q.x) + '</span></div>';
      }
    });
    if (stop < d + WKD && stop > d){
      var ls = (stop - d) / WKD * 100, lt = ls > 85;
      lbl += '<div class="tm" style="' + (lt ? 'right:calc(' + (100 - ls) + '% + 2px)' : 'left:calc(' + ls + '% + 2px)') + '"><span style="color:' + (lt ? '#10110f' : '#e9ecf4') + '">' + wkClk(stop) + '</span></div>';
    }
    var n = Math.floor(d / WKD);
    h += '<div class="wkg"><span class="dl">' + wdName(n) + ' <i>' + jPad(new Date(d).getUTCDate()) + '</i></span><div class="wkb">' + bar + '<div class="n5" style="left:calc(' + (5 / 24 * 100) + '% - 1px)"></div>' + lbl + '</div></div>';
  }
  return h;
}

var jView = 'list', wkOpen = null;
(function(){ var st = document.createElement('style'); st.textContent = '.wkrow{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 4px;border-top:1px solid #343a52;font-size:13px;cursor:pointer;-webkit-tap-highlight-color:transparent}\n.wkrow:first-child{border-top:0}\n.wkrow .r{font-size:12px;color:#a3acc2;white-space:nowrap}\n.wkrow.cur .t{color:#f5a524;font-weight:600}\n.wkbody{padding:4px 0 10px}\n.wkg{display:grid;grid-template-columns:44px 1fr;gap:0 6px;align-items:center;margin-bottom:4px}\n.wkg .dl{font-size:12px}.wkg .dl i{font-style:normal;color:#a3acc2}\n.wkb{position:relative;height:34px;background:#1b2030;border-radius:4px;overflow:hidden}\n.wkb .p{position:absolute;top:0;bottom:0}\n.wkb .lb{position:absolute;top:0;bottom:0;display:flex;align-items:center;justify-content:center}\n.wkb .lb span{display:flex;align-items:center;padding:0 4px;border-radius:4px;font-size:12px;font-weight:700;color:#10110f;line-height:18px}\n.wkb .tm{position:absolute;top:0;bottom:0;display:flex;align-items:center}\n.wkb .tm span{writing-mode:vertical-rl;transform:rotate(180deg);font-size:10.5px;font-weight:500;line-height:1}\n.wkb .n5{position:absolute;top:0;bottom:0;width:2px;background:repeating-linear-gradient(180deg,#f0505f 0 3px,transparent 3px 5px)}\n.wksc{position:relative;height:13px;font-size:11px;color:#a3acc2;margin-bottom:3px}\n.wksc span{position:absolute}\n.wklg{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:8px;font-size:11px;color:#a3acc2}\n.wklg i{display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:-1px;margin-right:4px}'; document.head.appendChild(st); })();
function jSetView(v){ jView = v; if (v === 'chart') wkOpen = null; renderJournal(); }
function renderWeeksChart(box){
  var all = wkAll();
  if (!all.length){ box.innerHTML = ''; return; }
  var cs = wkCads(), groups = [];
  all.forEach(function(w){
    var ci = wkCadOf(w.start), g = null;
    groups.forEach(function(x){ if (x.cad === ci) g = x; });
    if (!g){ g = {cad: ci, weeks: []}; groups.push(g); }
    g.weeks.push(w);
  });
  groups.sort(function(x, y){ return x.weeks[0].start - y.weeks[0].start; });
  var g = groups[groups.length - 1];
  var ft = '';
  if (g.cad >= 0) ft = '<div style="font-size:12px;color:#a3acc2;margin:2px 2px 4px;">Каденция с ' + wkFmt(wkDn(cs[g.cad].start)) + '</div>';
  if (wkOpen === null || wkOpen >= g.weeks.length) wkOpen = g.weeks.length - 1;
  var now = wkNow(), html = ft;
  var Wpx = Math.max(180, (box.clientWidth || 300) - 50);
  g.weeks.forEach(function(w, gi){
    var bd = wkBuild(g, gi, now), isCur = bd.ongoing, open = gi === wkOpen;
    var endD = Math.floor((bd.stop - 1) / WKD);
    var tt = wkFmt(Math.floor(bd.week.start / WKD)) + ' → ' + wkFmt(endD);
    var sum = bd.n + ' ' + (bd.n === 1 ? 'смена' : bd.n >= 2 && bd.n <= 4 ? 'смены' : 'смен') + ' · ' + wkHM(bd.work) + ' ч';
    html += '<div class="wkrow' + (isCur ? ' cur' : '') + '" data-i="' + gi + '"><span class="t">Неделя ' + wkIsoWeek(bd.week.start) + ' <span style="color:#a3acc2;font-weight:400">· ' + tt + '</span></span><span class="r">' + sum + ' <span style="font-size:15px">' + (open ? '⌄' : '›') + '</span></span></div>';
    if (open) html += '<div class="wkbody">' + wkBars(bd, Wpx) + '</div>';
  });
  html += '<div class="wklg"><span><i style="background:#f5a524"></i>работа</span><span><i style="background:#3fbf8a"></i>отдых</span><span><i style="background:repeating-linear-gradient(45deg,#f5a524 0 3px,#8a5d10 3px 6px)"></i>смена без конца</span><span style="color:#f0707a">5:00</span></div>';
  box.innerHTML = html;
  box.querySelectorAll('.wkrow').forEach(function(r){
    r.onclick = function(){ var i = +r.getAttribute('data-i'); wkOpen = (wkOpen === i) ? -1 : i; renderWeeksChart(box); };
  });
}

// --- правка времени: цифровая клавиатура ДДММЧЧММ, год берётся из записи ---
let tmState = null;
function dtDigits(ms) { const d = new Date(ms); return jPad(d.getDate()) + jPad(d.getMonth() + 1) + jPad(d.getHours()) + jPad(d.getMinutes()); }
function tmFmt(dg) {
    return dg.slice(0, 2) + (dg.length > 2 ? '.' + dg.slice(2, 4) : '') + (dg.length > 4 ? ' ' + dg.slice(4, 6) : '') + (dg.length > 6 ? ':' + dg.slice(6, 8) : '');
}
function tmParse(f) {
    if (f.digits.length === 0) return f.optional ? { ok: true, ms: null } : { ok: false, err: `Заполните: ${f.label}` };
    if (f.digits.length < 8) return { ok: false, err: `${f.label}: нужно 8 цифр (ДДММЧЧММ)` };
    const d = +f.digits.slice(0, 2), m = +f.digits.slice(2, 4), h = +f.digits.slice(4, 6), mi = +f.digits.slice(6, 8);
    if (m < 1 || m > 12) return { ok: false, err: `${f.label}: месяц 01–12` };
    const dim = new Date(f.year, m, 0).getDate();
    if (d < 1 || d > dim) return { ok: false, err: `${f.label}: в этом месяце нет такого дня` };
    if (h > 23 || mi > 59) return { ok: false, err: `${f.label}: время некорректно` };
    return { ok: true, ms: new Date(f.year, m - 1, d, h, mi).getTime() };
}
function openTimeEdit(title, fields, onSave, onDelete) {
    tmState = {
        title, onSave, onDelete, active: 0, msg: '',
        f: fields.map(x => ({
            label: x.label, optional: !!x.optional,
            digits: (x.ms !== null && x.ms !== undefined) ? dtDigits(x.ms) : '',
            year: (x.ms !== null && x.ms !== undefined) ? new Date(x.ms).getFullYear() : new Date(nowW()).getFullYear()
        }))
    };
    renderTimeEdit();
    document.getElementById('timeModal').style.display = 'flex';
}
function renderTimeEdit() {
    const t = tmState;
    let h = `<div style="font-size:17px;font-weight:600;margin-bottom:8px;">${t.title}</div>`;
    t.f.forEach((f, i) => {
        const on = i === t.active;
        h += `<div style="color:#a3acc2;font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin:8px 0 4px;">${f.label}<span style="color:#7d86a0;"> · год ${f.year}${f.optional ? ' · можно пусто' : ''}</span></div>
            <div onclick="tmPick(${i})" style="background:#1c2030;border:1.5px solid ${on ? '#f5a524' : '#454d6b'};border-radius:10px;padding:9px;text-align:center;font-size:24px;font-weight:700;letter-spacing:.05em;min-height:50px;">${f.digits ? tmFmt(f.digits) : '<span style="color:#454d6b;">ДД.ММ ЧЧ:ММ</span>'}</div>`;
    });
    h += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:10px;">';
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '&#9003;'].forEach(k => {
        h += `<button onclick="tmKey('${k}')" style="background:#2f3550;border:1px solid #454d6b;border-radius:10px;color:#e9ecf4;font-size:21px;font-weight:600;padding:10px 0;">${k}</button>`;
    });
    h += `</div><div style="min-height:30px;margin-top:8px;font-size:13px;text-align:center;color:#f0707a;">${t.msg}</div>
        <div style="display:flex;gap:8px;margin-top:6px;">
            <button onclick="tmSave()" style="flex:1;border-radius:12px;padding:12px 4px;font-size:14px;font-weight:600;background:#f5a524;border:1.5px solid #f5a524;color:#1f1300;">Сохранить</button>
            <button onclick="tmClose()" style="flex:1;border-radius:12px;padding:12px 4px;font-size:14px;font-weight:600;background:transparent;border:1.5px solid #454d6b;color:#e9ecf4;">Отмена</button>
        </div>`;
    if (t.onDelete) h += `<button onclick="tmDelete()" style="width:100%;margin-top:8px;border-radius:12px;padding:10px;font-size:13px;font-weight:600;background:transparent;border:1px solid rgba(240,112,122,.5);color:#f0707a;">Удалить запись</button>`;
    document.getElementById('timeBody').innerHTML = h;
}
function tmPick(i) { tmState.active = i; renderTimeEdit(); }
function tmKey(k) {
    const f = tmState.f[tmState.active];
    if (k === 'C') f.digits = '';
    else if (k === '&#9003;') f.digits = f.digits.slice(0, -1);
    else if (f.digits.length < 8) f.digits += k;
    tmState.msg = '';
    renderTimeEdit();
}
function tmClose() { document.getElementById('timeModal').style.display = 'none'; tmState = null; }
function tmSave() {
    const vals = [];
    for (const f of tmState.f) {
        const r = tmParse(f);
        if (!r.ok) { tmState.msg = r.err; renderTimeEdit(); return; }
        vals.push(r.ms);
    }
    const err = tmState.onSave(vals);
    if (err) { tmState.msg = err; renderTimeEdit(); return; }
    tmClose();
    renderJournal();
}
function tmDelete() {
    const del = tmState.onDelete;
    flowConfirm('Удалить запись?', 'Это действие нельзя отменить.', 'Удалить', () => { del(); tmClose(); renderJournal(); });
}
function editShift(wi, si) {
    const w = userProfile.weeks[wi], s = w.shifts[si];
    openTimeEdit('Смена ' + (si + 1), [
        { label: 'Начало', ms: parseDT(s.start) },
        { label: 'Конец', ms: parseDT(s.end), optional: true }
    ], vals => {
        if (vals[1] !== null && vals[1] < vals[0]) return 'Конец раньше начала';
        s.start = fmtDT(vals[0]); s.end = vals[1] === null ? null : fmtDT(vals[1]);
        w.shifts.sort((a, b) => parseDT(a.start) - parseDT(b.start));
        persistJournal();
        return null;
    }, () => { w.shifts.splice(si, 1); persistJournal(); });
}
function editWeek(wi) {
    const w = userProfile.weeks[wi];
    openTimeEdit('Начало недели', [{ label: 'Начало', ms: parseDT(w.start) }], vals => {
        w.start = fmtDT(vals[0]);
        persistJournal();
        return null;
    }, () => {
        userProfile.weeks.splice(wi, 1);
        const last = userProfile.weeks[userProfile.weeks.length - 1];
        if (last) last.end = null;
        persistJournal();
    });
}


// Отображение блока «Неделя / Смена началась / Смена закончена» на главной
function renderShiftInfo() {
    ensureWeeks(userProfile);
    syncLegacy(userProfile);
    const noYear = noYearStr;
    const weekInfo = document.getElementById('displayWeekStart');
    if (userProfile.weekStart) {
        const parts = userProfile.weekStart.split(' ');
        const dParts = parts[0].split('.');
        const tParts = parts[1].split(':');
        let endDate = new Date(dParts[2], dParts[1] - 1, dParts[0], tParts[0], tParts[1]);
        endDate.setTime(endDate.getTime() + (144 * 60 * 60 * 1000));
        const endStr = `${String(endDate.getDate()).padStart(2, '0')}.${String(endDate.getMonth() + 1).padStart(2, '0')}.${endDate.getFullYear()} ${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;
        const expired = weekExpired(curWeek(), nowW());
        weekInfo.innerHTML = expired
            ? `<span style="color:#fbbf24;">Неделя: ${noYear(userProfile.weekStart)} → ${noYear(endStr)}</span><span style="display:block;font-size:12px;line-height:1.3;color:#fbbf24;padding-bottom:5px;">Прошло 144 ч, начните новую неделю</span>`
            : `Неделя: <span style="color:#e9ecf4;">${noYear(userProfile.weekStart)}</span> → <span style="color:#fbbf24;">${noYear(endStr)}</span>`;
    } else {
        weekInfo.innerText = "Неделя: не начата";
    }

    const shiftInfo = document.getElementById('displayShiftStart');
    if (userProfile.shiftStart) {
        shiftInfo.innerHTML = `Смена началась: <span style="color:#e9ecf4;">${noYear(userProfile.shiftStart)}</span>`;
    } else {
        shiftInfo.innerText = "Смена началась: —";
    }

    const shiftEndInfo = document.getElementById('displayShiftEnd');
    if (userProfile.shiftEnd) {
        shiftEndInfo.innerHTML = `Смена закончена: <span style="color:#e9ecf4;">${noYear(userProfile.shiftEnd)}</span>`;
    } else {
        shiftEndInfo.innerText = "Смена закончена: —";
    }

}

// Окна журнала (подтверждение, журнал, правка времени) вставляются в страницу отсюда
(function () {
    const html = `    <!-- Универсальное подтверждение (недели и смены) -->
    <div id="flowModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);align-items:center;justify-content:center;padding:16px;z-index:80;">
        <div style="background:#262b3d;border:1px solid #454d6b;border-radius:16px;padding:16px;max-width:320px;width:100%;text-align:center;">
            <div id="flowTitle" style="font-size:16px;font-weight:700;color:#facc15;"></div>
            <p id="flowText" style="font-size:12px;color:#c9cfdf;margin:10px 0 14px;line-height:1.45;white-space:pre-line;"></p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <button onclick="flowClose(false)" style="background:#2f3550;color:#c9cfdf;border-radius:12px;padding:10px;font-size:12px;font-weight:600;">Отмена</button>
                <button id="flowYes" onclick="flowClose(true)" style="background:#f5a524;color:#1f1300;border-radius:12px;padding:10px;font-size:12px;font-weight:700;">Да</button>
            </div>
        </div>
    </div>
    <!-- Журнал недель и смен -->
    <div id="journalModal" onclick="if(event.target===this)closeJournal()" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);align-items:flex-end;justify-content:center;padding:12px;z-index:60;">
        <div style="background:#262b3d;border:1px solid #343a52;border-radius:16px;padding:14px;width:100%;max-width:420px;max-height:88vh;display:flex;flex-direction:column;">
            <div style="font-size:17px;font-weight:600;margin-bottom:10px;">Журнал</div>
            <div id="journalBody" style="overflow-y:auto;"></div>
            <button onclick="closeJournal()" style="margin-top:12px;border:1.5px solid #454d6b;background:transparent;color:#e9ecf4;border-radius:12px;padding:12px;font-size:14px;font-weight:600;">Закрыть</button>
        </div>
    </div>
    <!-- Правка времени -->
    <div id="timeModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);align-items:flex-end;justify-content:center;padding:12px;z-index:70;">
        <div id="timeBody" style="background:#262b3d;border:1px solid #343a52;border-radius:16px;padding:14px;width:100%;max-width:420px;max-height:94vh;overflow-y:auto;"></div>
    </div>

`;
    document.body.insertAdjacentHTML('beforeend', html);
})();
