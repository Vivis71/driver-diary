/* shifts.js — недели, смены и журнал.
   Подключается из index.html. Здесь вся логика смен: кнопки «Начало недели / Начало смены / Конец смены»,
   журнал (книжечка), правка записей, контроль 144 часов. Сюда же добавлять будущие правила (9/10/15 ч и т.д.).
   Использует из index.html: userProfile, profiles, currentProfileIndex, saveProfilesStorage, showToast, updateDashboard. */

// ================= НЕДЕЛИ И СМЕНЫ: журнал =================
// Структура: userProfile.weeks = [{ start:'ДД.ММ.ГГГГ ЧЧ:ММ', end:null|строка, shifts:[{start, end}] }]
// Последняя неделя считается текущей. Старые поля weekStart/shiftStart/shiftEnd держим синхронными (для главного экрана и паузы).
const WEEK_MS = 144 * 3600 * 1000;
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
    const now = fmtDT(Date.now());
    const cur = curWeek();
    if (cur && !cur.end) cur.end = fmtDT(weekLastClosedEnd(cur));
    userProfile.weeks.push({ start: now, end: null, shifts: [{ start: now, end: null }] });
    persistJournal();
    showToast(`✅ Неделя начата, смена открыта:\n${now}`);
}
function doStartShift() {
    const cur = curWeek();
    const now = fmtDT(Date.now());
    cur.shifts.push({ start: now, end: null });
    persistJournal();
    showToast(`✅ Смена начата:\n${now}`);
}
function startShiftAction() {
    const cur = curWeek();
    if (!cur) { startWeekNow(); return; }
    if (weekExpired(cur, Date.now())) {
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
    const now = fmtDT(Date.now());
    last.end = now;
    persistJournal();
    showToast(`⏹ Смена завершена:\n${now}`);
}

// --- окно журнала ---
let jOpen = {};
function openJournal() {
    ensureWeeks(userProfile);
    jOpen = {};
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
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 2px;border-top:1px solid #33343d;font-size:14px;">
        <span style="width:18px;color:#6b7280;font-size:12px;">${si + 1}</span>
        <span style="flex:1;color:#f3f4f6;">${noYearStr(s.start)} → ${endTxt}</span>
        <span style="color:#9ca3af;font-size:12px;min-width:36px;text-align:right;">${tail}</span>
        <button onclick="editShift(${wi},${si})" aria-label="Изменить" style="width:28px;height:28px;border-radius:8px;border:1px solid #3d3e4a;background:transparent;color:#9ca3af;font-size:13px;">&#9998;</button>
    </div>`;
}
function renderJournal() {
    const weeks = userProfile.weeks;
    const box = document.getElementById('journalBody');
    if (!weeks.length) {
        box.innerHTML = '<div style="color:#9ca3af;font-size:13px;padding:14px 4px;text-align:center;">Записей пока нет. Нажмите «Начало недели».</div>';
        return;
    }
    const ci = weeks.length - 1, cw = weeks[ci];
    let h = `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#1e1f26;border:1px solid #33343d;border-radius:10px;margin-bottom:4px;">
        <span style="font-size:14px;font-weight:600;color:#ff9f0a;">Неделя · с ${noYearStr(cw.start)}</span>
        <span style="display:flex;align-items:center;gap:8px;"><span style="font-size:12px;color:${weekExpired(cw, Date.now()) ? '#fbbf24' : '#34d399'};">${weekExpired(cw, Date.now()) ? '144 ч прошло' : 'идёт'}</span>
        <button onclick="editWeek(${ci})" aria-label="Изменить неделю" style="width:28px;height:28px;border-radius:8px;border:1px solid #3d3e4a;background:transparent;color:#9ca3af;font-size:13px;">&#9998;</button></span></div>`;
    if (!cw.shifts.length) h += '<div style="color:#9ca3af;font-size:13px;padding:8px 4px;">Смен пока нет</div>';
    cw.shifts.forEach((s, si) => { h += jShiftRow(ci, si, cw, true); });
    if (ci > 0) {
        h += '<div style="color:#9ca3af;font-size:11px;letter-spacing:.04em;text-transform:uppercase;margin:14px 2px 4px;">Прошлые недели</div>';
        for (let wi = ci - 1; wi >= 0; wi--) {
            const w = weeks[wi];
            let total = 0;
            w.shifts.forEach(s => { const a = parseDT(s.start), b = parseDT(s.end); if (a !== null && b !== null && b > a) total += (b - a); });
            const mins = Math.round(total / 60000);
            const endTxt = w.end ? noYearStr(w.end).split(' ')[0] : '—';
            const open = !!jOpen[wi];
            h += `<div onclick="jToggle(${wi})" style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:#1e1f26;border:1px solid #33343d;border-radius:10px;margin-top:6px;font-size:13px;color:#f3f4f6;">
                <span>${noYearStr(w.start).split(' ')[0]} → ${endTxt}</span>
                <span style="color:#9ca3af;font-size:12px;">${w.shifts.length} смен · ${Math.floor(mins / 60)}:${jPad(mins % 60)} ч ${open ? '&#8964;' : '&#8250;'}</span></div>`;
            if (open) {
                h += `<div style="padding:0 4px 4px;">`;
                h += `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 2px;font-size:12px;color:#9ca3af;"><span>Начало недели: ${noYearStr(w.start)}</span><button onclick="editWeek(${wi})" aria-label="Изменить неделю" style="width:28px;height:28px;border-radius:8px;border:1px solid #3d3e4a;background:transparent;color:#9ca3af;font-size:13px;">&#9998;</button></div>`;
                w.shifts.forEach((s, si) => { h += jShiftRow(wi, si, w, false); });
                h += '</div>';
            }
        }
    }
    box.innerHTML = h;
}
function jToggle(wi) { jOpen[wi] = !jOpen[wi]; renderJournal(); }

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
            year: (x.ms !== null && x.ms !== undefined) ? new Date(x.ms).getFullYear() : new Date().getFullYear()
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
        h += `<div style="color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin:8px 0 4px;">${f.label}<span style="color:#6b7280;"> · год ${f.year}${f.optional ? ' · можно пусто' : ''}</span></div>
            <div onclick="tmPick(${i})" style="background:#16171c;border:1.5px solid ${on ? '#ff9f0a' : '#3d3e4a'};border-radius:10px;padding:9px;text-align:center;font-size:24px;font-weight:700;letter-spacing:.05em;min-height:50px;">${f.digits ? tmFmt(f.digits) : '<span style="color:#4b5563;">ДД.ММ ЧЧ:ММ</span>'}</div>`;
    });
    h += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:10px;">';
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '&#9003;'].forEach(k => {
        h += `<button onclick="tmKey('${k}')" style="background:#2d3748;border:1px solid #4b5563;border-radius:10px;color:#e5e7eb;font-size:21px;font-weight:600;padding:10px 0;">${k}</button>`;
    });
    h += `</div><div style="min-height:30px;margin-top:8px;font-size:13px;text-align:center;color:#fb7185;">${t.msg}</div>
        <div style="display:flex;gap:8px;margin-top:6px;">
            <button onclick="tmSave()" style="flex:1;border-radius:12px;padding:12px 4px;font-size:14px;font-weight:600;background:#ff9f0a;border:1.5px solid #ff9f0a;color:#1f1300;">Сохранить</button>
            <button onclick="tmClose()" style="flex:1;border-radius:12px;padding:12px 4px;font-size:14px;font-weight:600;background:transparent;border:1.5px solid #4b5563;color:#e5e7eb;">Отмена</button>
        </div>`;
    if (t.onDelete) h += `<button onclick="tmDelete()" style="width:100%;margin-top:8px;border-radius:12px;padding:10px;font-size:13px;font-weight:600;background:transparent;border:1px solid rgba(251,113,133,.5);color:#fb7185;">Удалить запись</button>`;
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
        const expired = weekExpired(curWeek(), Date.now());
        weekInfo.innerHTML = expired
            ? `<span style="color:#fbbf24;">Неделя: ${noYear(userProfile.weekStart)} → ${noYear(endStr)}</span><span style="display:block;font-size:12px;line-height:1.3;color:#fbbf24;padding-bottom:5px;">Прошло 144 ч, начните новую неделю</span>`
            : `Неделя: <span style="color:#f3f4f6;">${noYear(userProfile.weekStart)}</span> → <span style="color:#fbbf24;">${noYear(endStr)}</span>`;
    } else {
        weekInfo.innerText = "Неделя: не начата";
    }

    const shiftInfo = document.getElementById('displayShiftStart');
    if (userProfile.shiftStart) {
        shiftInfo.innerHTML = `Смена началась: <span style="color:#f3f4f6;">${noYear(userProfile.shiftStart)}</span>`;
    } else {
        shiftInfo.innerText = "Смена началась: —";
    }

    const shiftEndInfo = document.getElementById('displayShiftEnd');
    if (userProfile.shiftEnd) {
        shiftEndInfo.innerHTML = `Смена закончена: <span style="color:#f3f4f6;">${noYear(userProfile.shiftEnd)}</span>`;
    } else {
        shiftEndInfo.innerText = "Смена закончена: —";
    }

}

// Окна журнала (подтверждение, журнал, правка времени) вставляются в страницу отсюда
(function () {
    const html = `    <!-- Универсальное подтверждение (недели и смены) -->
    <div id="flowModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);align-items:center;justify-content:center;padding:16px;z-index:80;">
        <div style="background:#25262c;border:1px solid #3d3e4a;border-radius:16px;padding:16px;max-width:320px;width:100%;text-align:center;">
            <div id="flowTitle" style="font-size:16px;font-weight:700;color:#facc15;"></div>
            <p id="flowText" style="font-size:12px;color:#d1d5db;margin:10px 0 14px;line-height:1.45;white-space:pre-line;"></p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <button onclick="flowClose(false)" style="background:#32333d;color:#d1d5db;border-radius:12px;padding:10px;font-size:12px;font-weight:600;">Отмена</button>
                <button id="flowYes" onclick="flowClose(true)" style="background:#ff9f0a;color:#1f1300;border-radius:12px;padding:10px;font-size:12px;font-weight:700;">Да</button>
            </div>
        </div>
    </div>
    <!-- Журнал недель и смен -->
    <div id="journalModal" onclick="if(event.target===this)closeJournal()" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);align-items:flex-end;justify-content:center;padding:12px;z-index:60;">
        <div style="background:#26272f;border:1px solid #33343d;border-radius:16px;padding:14px;width:100%;max-width:420px;max-height:88vh;display:flex;flex-direction:column;">
            <div style="font-size:17px;font-weight:600;margin-bottom:10px;">Журнал</div>
            <div id="journalBody" style="overflow-y:auto;"></div>
            <button onclick="closeJournal()" style="margin-top:12px;border:1.5px solid #4b5563;background:transparent;color:#e5e7eb;border-radius:12px;padding:12px;font-size:14px;font-weight:600;">Закрыть</button>
        </div>
    </div>
    <!-- Правка времени -->
    <div id="timeModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);align-items:flex-end;justify-content:center;padding:12px;z-index:70;">
        <div id="timeBody" style="background:#26272f;border:1px solid #33343d;border-radius:16px;padding:14px;width:100%;max-width:420px;max-height:94vh;overflow-y:auto;"></div>
    </div>

`;
    document.body.insertAdjacentHTML('beforeend', html);
})();
