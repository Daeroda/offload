const AREAS = {
  home:   { label: '가정', next: 'church' },
  church: { label: '교회', next: 'work' },
  work:   { label: '회사', next: 'home' },
};

// Work tasks only. Default is 개인: nothing goes to the team Notion page unless
// the user marks it 공유 themselves.
const SHARES = {
  private: { label: '개인', next: 'shared', hint: '개인 — 노션에 올리지 않아요' },
  shared:  { label: '공유', next: 'secret', hint: '공유 — 팀 노션에 올라가요' },
  secret:  { label: '🔒 기밀', next: 'private', hint: '기밀 — 노션·요약 모두 제외' },
};

// Placeholder until AI classification: simple keyword guess, tap the chip to fix.
const KEYWORDS = {
  work: ['스테이벗', '지결', '지출결의', '정산', '회의', '위클리', '노션', '인턴', '지원사업', '계약', '대표님', '보고', '원장', '세금'],
  church: ['가정교회', '예배', '교회', '설교', '목장', '찬양', '주일'],
};
function guessArea(text) {
  for (const [area, words] of Object.entries(KEYWORDS)) {
    if (words.some(w => text.includes(w))) return area;
  }
  return 'home';
}

const $ = sel => document.querySelector(sel);
const DAY = ['일', '월', '화', '수', '목', '금', '토'];

// A task's `date` is one of: a day (2026-10-12), a week bucket (2026-W42,
// ISO week, Monday start) or a month bucket (2026-10).
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
const shiftDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const todayStr = () => ymd(new Date());
const thisWeek = () => isoWeek(new Date());
const nextWeek = () => isoWeek(shiftDays(7));
const thisMonth = () => todayStr().slice(0, 7);
const nextMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1); return ymd(d).slice(0, 7); };
const kindOf = s => (s.includes('W') ? 'week' : s.length === 7 ? 'month' : 'day');
const currentOf = kind => ({ day: todayStr, week: thisWeek, month: thisMonth })[kind]();
const isOverdue = t => !t.done && t.date < currentOf(kindOf(t.date));

function whenLabel(s) {
  const kind = kindOf(s);
  if (kind === 'week') {
    if (s === thisWeek()) return '이번 주';
    if (s === nextWeek()) return '다음 주';
    return s < thisWeek() ? '지난주' : `${+s.slice(6)}주차`;
  }
  if (kind === 'month') {
    if (s === thisMonth()) return '이번 달';
    if (s === nextMonth()) return '다음 달';
    return s < thisMonth() ? '지난달' : `${+s.slice(5)}월`;
  }
  const d = new Date(s + 'T00:00:00');
  const diff = Math.round((d - new Date(todayStr() + 'T00:00:00')) / 86400000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '내일';
  if (diff === -1) return '어제';
  return `${d.getMonth() + 1}/${d.getDate()} ${DAY[d.getDay()]}`;
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 1600);
}

// Bottom sheet for choosing when a task happens.
function openWhenMenu(t) {
  const sheet = $('#sheet');
  const options = [
    ['오늘', todayStr()], ['내일', ymd(shiftDays(1))],
    ['이번 주 안에', thisWeek()], ['다음 주 안에', nextWeek()],
    ['이번 달 안에', thisMonth()], ['다음 달 안에', nextMonth()],
  ];
  const list = $('#sheet-options');
  list.innerHTML = '';
  const pick = value => {
    closeSheet();
    if (!value || value === t.date) return;
    Store.update(t.id, kindOf(value) === 'day' ? { date: value } : { date: value, time: null });
    toast(`${whenLabel(value)}(으)로 옮겼어요${t.time && kindOf(value) !== 'day' ? ' (시간은 뺐어요)' : ''}`);
  };
  for (const [label, value] of options) {
    const b = document.createElement('button');
    b.textContent = label;
    if (value === t.date) b.className = 'current';
    b.onclick = () => pick(value);
    list.appendChild(b);
  }
  const date = $('#sheet-date');
  date.value = kindOf(t.date) === 'day' ? t.date : '';
  date.onchange = () => pick(date.value);
  $('#sheet-pick').onclick = () => {
    if (typeof date.showPicker === 'function') { try { date.showPicker(); return; } catch {} }
    date.focus();
  };
  sheet.hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; }
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });

// `doneOn` is the day a check-off is recorded for: today, or the day being
// looked back on in the day panel.
function taskItem(t, doneOn = todayStr()) {
  const li = document.createElement('li');
  li.className = t.done ? 'done' : '';
  li.innerHTML = `
    <button class="check" aria-label="완료 표시"></button>
    <span class="title"></span>
    <span class="marks"></span>
    <button class="date${isOverdue(t) ? ' overdue' : ''}" aria-label="언제 할지 바꾸기"></button>
    <button class="chip ${t.area}">${AREAS[t.area].label}</button>
    ${t.area === 'work' ? `<button class="share ${t.share || 'private'}" aria-label="공유 범위">${SHARES[t.share || 'private'].label}</button>` : ''}
    <button class="del" aria-label="삭제">×</button>`;
  const title = li.querySelector('.title');
  title.textContent = t.title;
  title.onclick = () => openDetail(t.id);

  const marks = li.querySelector('.marks');
  const link = (t.links || []).find(isWebLink);
  if (link) {
    const a = document.createElement('a');
    a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = '🔗'; a.setAttribute('aria-label', '연결된 문서 열기');
    marks.appendChild(a);
  }
  if (t.note) {
    const b = document.createElement('button');
    b.textContent = '📝'; b.setAttribute('aria-label', '메모 보기');
    b.onclick = () => openDetail(t.id);
    marks.appendChild(b);
  }

  const date = li.querySelector('.date');
  date.textContent = whenLabel(t.date) + (t.time ? ` ${t.time.slice(0, 5)}` : '');
  date.onclick = () => openWhenMenu(t);

  const shareBtn = li.querySelector('.share');
  if (shareBtn) shareBtn.onclick = () => {
    const next = SHARES[t.share || 'private'].next;
    Store.update(t.id, { share: next });
    toast(SHARES[next].hint);
  };
  li.querySelector('.check').onclick = () =>
    Store.update(t.id, t.done ? { done: false, doneOn: null } : { done: true, doneOn });
  li.querySelector('.chip').onclick = () => Store.update(t.id, { area: AREAS[t.area].next });
  li.querySelector('.del').onclick = () => Store.remove(t.id);
  return li;
}

// Shows a kind's current items, plus undone overdue ones and (for buckets) future ones.
function renderList(sel, kind) {
  const cur = currentOf(kind);
  const tasks = Store.list().filter(t =>
    kindOf(t.date) === kind &&
    (t.date === cur || (!t.done && (t.date < cur || kind !== 'day'))));
  tasks.sort((a, b) => a.done - b.done || a.date.localeCompare(b.date) || (a.time || '~').localeCompare(b.time || '~'));
  const ul = $(sel);
  ul.innerHTML = '';
  tasks.forEach(t => ul.appendChild(taskItem(t)));
  $(`${sel}-empty`).hidden = tasks.length > 0;
}

function renderToday() {
  renderList('#today', 'day');
  renderList('#bucket-week', 'week');
  renderList('#bucket-month', 'month');
  const d = new Date();
  $('#today-label').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY[d.getDay()]})`;
}

// Only real web links become clickable; anything else in the file stays text.
const isWebLink = u => /^https?:\/\/\S+$/i.test(u);
function linkLabel(u) {
  try {
    const url = new URL(u);
    const host = url.hostname.replace(/^www\./, '');
    if (host.endsWith('notion.so') || host.endsWith('notion.site')) return '노션 문서';
    if (host === 'docs.google.com') return '구글 문서';
    if (host === 'drive.google.com') return '구글 드라이브';
    return host;
  } catch { return u; }
}

// Detail panel: title, linked documents and the task's note.
let detailId = null;
const detailTask = () => Store.list().find(t => t.id === detailId);
const autosize = el => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };

async function openDetail(id) {
  detailId = id;
  const t = detailTask();
  if (!t) return;
  const title = $('#detail-title');
  title.value = t.title;
  renderDetailLinks();
  renderDetailTime();
  const note = $('#detail-note');
  note.value = t.note ? Notes.text(t.note) : '';
  $('#detail').hidden = false;
  autosize(title);
  if (!t.note) { renderNoteState(); return; }
  // Read-only until the latest version arrives, so typing never lands on a stale copy.
  note.readOnly = true;
  renderNoteState();
  try {
    const text = await Notes.open(t.note);
    if (detailId === id) note.value = text;
  } catch { toast('메모를 불러오지 못했어요'); }
  note.readOnly = false;
  renderNoteState();
}

// Time slot: only for a task on a day. Setting one puts it on Google Calendar.
function renderDetailTime() {
  const t = detailTask();
  if (!t) return;
  const onDay = kindOf(t.date) === 'day';
  const [start = '', end = ''] = (t.time || '').split('-');
  for (const el of [$('#detail-start'), $('#detail-end')]) el.disabled = !onDay;
  if (document.activeElement !== $('#detail-start')) $('#detail-start').value = start;
  if (document.activeElement !== $('#detail-end')) $('#detail-end').value = end;
  $('#detail-time-clear').hidden = !t.time;
  $('#detail-time-state').textContent = !onDay ? '· 날짜를 정하면 넣을 수 있어요'
    : !t.time ? '· 넣으면 구글 캘린더에 올라가요'
    : !Calendar.ready() ? '· 캘린더 연결이 필요해요'
    : Calendar.status() === 'error' ? '· 캘린더에 올리지 못했어요' : '· 구글 캘린더에 올라가요';
}

const addHour = hhmm => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

function saveDetailTime(changed) {
  const t = detailTask();
  if (!t) return;
  const start = $('#detail-start').value;
  let end = $('#detail-end').value;
  if (!start) { if (changed === 'start' && t.time) Store.update(t.id, { time: null }); return; }
  // A new or moved start keeps an hour-long slot unless the end is still after it.
  if (!end || end <= start) end = addHour(start);
  const time = `${start}-${end}`;
  if (time !== t.time) {
    Store.update(t.id, { time });
    toast(Calendar.ready() ? '캘린더에 올릴게요' : '시간을 넣었어요 · 캘린더는 다시 연결이 필요해요');
  }
}

$('#detail-start').addEventListener('change', () => saveDetailTime('start'));
$('#detail-end').addEventListener('change', () => saveDetailTime('end'));
$('#detail-time-clear').addEventListener('click', () => {
  const t = detailTask();
  if (t) { Store.update(t.id, { time: null }); toast('시간을 뺐어요 · 캘린더에서도 지울게요'); }
});

function closeDetail() {
  if ($('#detail').hidden) return;
  saveDetailTitle();
  $('#detail').hidden = true;
  detailId = null;
  Notes.flush();
}

function saveDetailTitle() {
  const t = detailTask();
  const text = $('#detail-title').value.replace(/\s+/g, ' ').trim();
  if (t && text && text !== t.title) { Store.update(t.id, { title: text }); toast('고쳤어요'); }
}

function renderDetailLinks() {
  const t = detailTask();
  const ul = $('#detail-links');
  ul.innerHTML = '';
  for (const u of (t && t.links) || []) {
    const li = document.createElement('li');
    const a = document.createElement(isWebLink(u) ? 'a' : 'span');
    if (isWebLink(u)) { a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    a.textContent = linkLabel(u);
    a.title = u;
    const del = document.createElement('button');
    del.textContent = '×'; del.className = 'del'; del.setAttribute('aria-label', '링크 빼기');
    del.onclick = () => Store.update(t.id, { links: t.links.filter(x => x !== u) });
    li.append(a, del);
    ul.appendChild(li);
  }
}

function renderNoteState() {
  const t = detailTask();
  const el = $('#detail-note-state');
  if (!t || !t.note) { el.textContent = ''; return; }
  el.textContent = $('#detail-note').readOnly ? '· 불러오는 중…'
    : !Notes.pending(t.note) ? `· 옵시디언 메모/${t.note}`
    : Drive.canSync() ? '· 저장 중…' : '· 이 기기에 저장됨';
}

$('#detail-title').addEventListener('input', e => autosize(e.target));
$('#detail-title').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); e.target.blur(); }
});
$('#detail-title').addEventListener('blur', saveDetailTitle);
$('#detail-close').addEventListener('click', closeDetail);
$('#detail').addEventListener('click', e => { if (e.target.id === 'detail') closeDetail(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (detailId) closeDetail(); else closeDay();
});

$('#detail-link-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#detail-link');
  const u = input.value.trim();
  const t = detailTask();
  if (!t || !u) return;
  if (!isWebLink(u)) { toast('https:// 로 시작하는 링크만 넣을 수 있어요'); return; }
  if (!(t.links || []).includes(u)) Store.update(t.id, { links: [...(t.links || []), u] });
  input.value = '';
});

$('#detail-note').addEventListener('input', e => {
  const t = detailTask();
  if (!t) return;
  let name = t.note;
  if (!name) {
    if (!e.target.value.trim()) return;
    name = Notes.nameFor(t.title, Store.list().map(x => x.note).filter(Boolean));
    Store.update(t.id, { note: name });
  }
  Notes.edit(name, e.target.value);
});

Notes.onChange(name => {
  const t = detailTask();
  if (!t || t.note !== name) return;
  const note = $('#detail-note');
  // A save may have merged in an Obsidian edit; show it unless the user is typing.
  if (document.activeElement !== note && Notes.text(name) !== note.value) note.value = Notes.text(name);
  renderNoteState();
});

// Fixed events the user told us about. Calendar sync replaces this later.
function fixedEvents(date) {
  const ev = [];
  const dow = date.getDay();
  const nth = Math.ceil(date.getDate() / 7);
  if (dow === 6 && nth !== 1) ev.push('가정교회 17:30');
  if (dow === 0 && nth === 1) ev.push('가정교회 (예배 후, 우리 집)');
  if (dow === 3) ev.push('재택 (기본)');
  return ev;
}

// Tapping a day opens that day's panel.
function dayHead(d, extra = '') {
  const head = document.createElement('li');
  head.className = 'day-head';
  const b = document.createElement('button');
  b.textContent = `${d.getMonth() + 1}/${d.getDate()} (${DAY[d.getDay()]})${extra} ›`;
  b.onclick = () => openDay(ymd(d));
  head.appendChild(b);
  return head;
}

// Next 7 days after today, one row per task so each can be moved.
function renderWeek() {
  const ul = $('#week');
  ul.innerHTML = '';
  const tasks = Store.list();

  for (let i = 1; i <= 7; i++) {
    const d = shiftDays(i);
    const key = ymd(d);
    const events = fixedEvents(d);
    const dayTasks = tasks.filter(t => t.date === key && !t.done);
    if (!events.length && !dayTasks.length) continue;

    ul.appendChild(dayHead(d));
    for (const ev of events) {
      const li = document.createElement('li');
      li.className = 'event';
      li.textContent = ev;
      ul.appendChild(li);
    }
    dayTasks.forEach(t => ul.appendChild(taskItem(t)));
  }
}

// Last 7 days, newest first, done and undone, so finished work stays visible.
// Undone ones also show up under 오늘 as overdue.
function renderPast() {
  const ul = $('#past-list');
  ul.innerHTML = '';
  const tasks = Store.list();
  let done = 0, total = 0;

  for (let i = 1; i <= 7; i++) {
    const d = shiftDays(-i);
    const key = ymd(d);
    const dayTasks = tasks.filter(t => t.date === key).sort((a, b) => b.done - a.done);
    if (!dayTasks.length) continue;
    total += dayTasks.length;
    done += dayTasks.filter(t => t.done).length;

    ul.appendChild(dayHead(d, i === 1 ? ' · 어제' : ''));
    dayTasks.forEach(t => ul.appendChild(taskItem(t)));
  }
  $('#past-label').textContent = total ? `${total}개 중 ${done}개 끝냄` : '';
  $('#past-list-empty').hidden = total > 0;
}

// Day panel: what got done that day, what was left, and the day's journal.
// Tasks finished before ✅ dates were recorded count for their scheduled day.
let dayKey = null;
const finishedOn = t => t.doneOn || (kindOf(t.date) === 'day' ? t.date : null);

function renderDay() {
  const key = dayKey;
  const d = new Date(key + 'T00:00:00');
  const rel = { 0: ' · 오늘', 1: ' · 내일', [-1]: ' · 어제' }[whenOffset(key)] || '';
  $('#day-title').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY[d.getDay()]})${rel}`;
  const tasks = Store.list();
  const done = tasks.filter(t => t.done && finishedOn(t) === key);
  const left = tasks.filter(t => !t.done && t.date === key);
  const stampOn = key < todayStr() ? key : todayStr();
  for (const [sel, list] of [['#day-done', done], ['#day-left', left]]) {
    const ul = $(sel);
    ul.innerHTML = '';
    list.forEach(t => ul.appendChild(taskItem(t, stampOn)));
    $(`${sel}-empty`).hidden = list.length > 0;
  }
  $('#day-left-label').textContent = key < todayStr() ? '못 한 일' : '할 일';
  renderDayNoteState();
}
const whenOffset = key =>
  Math.round((new Date(key + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 86400000);

async function openDay(key) {
  if (dayKey && dayKey !== key) Journal.flush();
  dayKey = key;
  const note = $('#day-note');
  note.value = Journal.body(key);
  renderDay();
  $('#day').hidden = false;
  // Read-only until the latest version arrives, so typing never lands on a stale copy.
  note.readOnly = true;
  renderDayNoteState();
  try {
    const text = await Journal.open(key);
    if (dayKey === key) note.value = text;
  } catch { toast('일지를 불러오지 못했어요'); }
  if (dayKey === key) note.readOnly = false;
  renderDayNoteState();
}

function closeDay() {
  if ($('#day').hidden) return;
  $('#day').hidden = true;
  dayKey = null;
  Journal.flush();
}

function renderDayNoteState() {
  if (!dayKey) return;
  $('#day-note-state').textContent = $('#day-note').readOnly ? '· 불러오는 중…'
    : !Journal.pending(dayKey) ? `· 옵시디언 일지/${dayKey}`
    : Drive.canSync() ? '· 저장 중…' : '· 이 기기에 저장됨';
}

$('#day-note').addEventListener('input', e => { if (dayKey) Journal.write(dayKey, e.target.value); });
Journal.onChange(day => {
  if (day !== dayKey) return;
  const note = $('#day-note');
  if (document.activeElement !== note && !note.readOnly && Journal.body(day) !== note.value) note.value = Journal.body(day);
  renderDayNoteState();
});
const moveDay = n => { const d = new Date(dayKey + 'T00:00:00'); d.setDate(d.getDate() + n); openDay(ymd(d)); };
$('#day-prev').addEventListener('click', () => moveDay(-1));
$('#day-next').addEventListener('click', () => moveDay(1));
$('#day-close').addEventListener('click', closeDay);
$('#day').addEventListener('click', e => { if (e.target.id === 'day') closeDay(); });
$('#today-journal').addEventListener('click', () => openDay(todayStr()));

// Where new captures go. Stays on the chosen target so several items can be
// dumped in a row; resets to 오늘 when the app is reopened.
const TARGETS = {
  day:   { label: '오늘', value: todayStr },
  week:  { label: '이번 주 안에', value: thisWeek },
  month: { label: '이번 달 안에', value: thisMonth },
  idea:  { label: '아이디어' },
};
let target = 'day';
function renderTargets() {
  document.querySelectorAll('#targets button').forEach(b => {
    b.classList.toggle('on', b.dataset.target === target);
  });
}
document.querySelectorAll('#targets button').forEach(b => {
  b.onclick = () => { target = b.dataset.target; renderTargets(); $('#input').focus(); };
});

$('#capture').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#input');
  // A pasted link becomes the task's document instead of part of the title.
  const links = input.value.match(/https?:\/\/\S+/gi) || [];
  const title = input.value.replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim() || (links.length ? linkLabel(links[0]) : '');
  if (!title) return;
  if (target === 'idea') {
    Ideas.add(input.value.replace(/\s+/g, ' ').trim(), todayStr());
    input.value = '';
    input.focus();
    toast('아이디어에 담았어요');
    return;
  }
  const area = guessArea(title);
  const task = { id: Md.newId(), title, area, date: TARGETS[target].value(), done: false };
  if (links.length) task.links = links;
  Store.add(task);
  input.value = '';
  input.focus();
  toast(`${TARGETS[target].label} · ${AREAS[area].label}에 담았어요`);
});

const SYNC_TEXT = {
  local: '이 기기에만 저장 중',
  expired: '드라이브 연결이 끊겼어요',
  syncing: '드라이브와 맞추는 중…',
  synced: '드라이브에 저장됨',
  error: '저장 실패 — 다시 시도할게요',
};

// Timed tasks exist but the sign-in predates calendar sync (or it was declined).
const calendarNeeded = () => Drive.canSync() && !Calendar.ready() && Store.list().some(t => t.time && !t.done);

function renderSync() {
  const s = Store.status();
  const n = Store.pendingCount();
  const cal = calendarNeeded();
  $('#sync-text').textContent = SYNC_TEXT[s] + (n && s !== 'synced' ? ` (대기 ${n}개)` : '')
    + (s === 'synced' && cal ? ' · 캘린더 연결 필요' : '')
    + (s === 'synced' && Calendar.status() === 'error' ? ' · 캘린더 저장 실패' : '');
  const btn = $('#sync-btn');
  btn.hidden = !(s === 'local' || s === 'expired' || s === 'error' || cal);
  btn.textContent = s === 'local' ? '구글 드라이브 연결' : s === 'synced' && cal ? '캘린더 연결' : '다시 연결';
  $('#sync').dataset.state = s;
}

// Ideas box at the bottom, newest first. #오프로드 ones went to Offload 백로그.
function renderIdeas() {
  const ul = $('#ideas-list');
  ul.innerHTML = '';
  const ideas = Ideas.list();
  for (const i of ideas) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="title"></span>
      ${i.offload ? '<span class="tag-offload" title="Offload 백로그로 옮겼어요">Offload</span>' : ''}
      <span class="when"></span>
      <button class="del" aria-label="삭제">×</button>`;
    const title = li.querySelector('.title');
    title.textContent = i.text;
    title.onclick = () => editIdea(title, i);
    li.querySelector('.when').textContent = whenLabel(i.date);
    li.querySelector('.del').onclick = () => Ideas.remove(i.id);
    ul.appendChild(li);
  }
  $('#ideas-label').textContent = ideas.length ? `${ideas.length}개` : '';
  $('#ideas-list-empty').hidden = ideas.length > 0;
}

// Tap an idea to fix it in place. Enter or leaving saves, Esc cancels.
let editingIdea = false;
function editIdea(el, i) {
  if (el.isContentEditable) return;
  editingIdea = true;
  el.contentEditable = 'plaintext-only';
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  el.focus();
  getSelection().selectAllChildren(el);
  getSelection().collapseToEnd();
  let cancel = false;
  el.onkeydown = e => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { cancel = true; el.blur(); }
  };
  el.onblur = () => {
    editingIdea = false;
    el.contentEditable = 'false';
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    if (!cancel && text && text !== i.text) { Ideas.edit(i.id, text); toast('고쳤어요'); }
    else renderIdeas();
  };
}

function render() {
  renderToday();
  renderWeek();
  renderPast();
  if (!editingIdea) renderIdeas();
  renderSync();
  if (detailId) { renderDetailLinks(); renderDetailTime(); renderNoteState(); }
  if (dayKey) renderDay();
}

// Tasks first (the note link lives in 할 일.md), then any notes typed offline,
// then the next two weeks' journal files.
const journalDays = () => Array.from({ length: Journal.AHEAD }, (_, i) => ymd(shiftDays(i)));
const syncAll = () => Store.sync()
  .then(() => Promise.all([Notes.flush(), Journal.flush(), Ideas.sync()]))
  .then(() => Drive.canSync() && Journal.ensureAhead(journalDays()))
  .catch(() => {});

$('#sync-btn').addEventListener('click', async () => {
  try {
    await Drive.signIn();
    if (!Drive.isLinked()) await Drive.connect();
    await syncAll();
    if (Store.status() === 'synced') toast('드라이브와 연결됐어요');
  } catch (e) {
    toast(e.message === 'cancel' ? '폴더 선택을 취소했어요' : '연결하지 못했어요');
    render();
  }
});

function focusInput() { setTimeout(() => $('#input').focus(), 50); }
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { render(); syncAll(); if (!detailId && !dayKey) focusInput(); }
});

// Calendar follows 할 일.md once it's saved to Drive, a moment after changes settle.
let calTimer = null;
Store.onChange(() => {
  if (Store.status() !== 'synced') return;
  clearTimeout(calTimer);
  calTimer = setTimeout(() => Calendar.sync(Store.list()).then(render), 800);
});

Store.onChange(render);
Ideas.onChange(() => { if (!editingIdea) renderIdeas(); });
renderTargets();
render();
focusInput();
Drive.init().then(syncAll).catch(() => render());

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
