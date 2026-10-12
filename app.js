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
    Store.update(t.id, { date: value });
    toast(`${whenLabel(value)}(으)로 옮겼어요`);
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

function taskItem(t) {
  const li = document.createElement('li');
  li.className = t.done ? 'done' : '';
  li.innerHTML = `
    <button class="check" aria-label="완료 표시"></button>
    <span class="title"></span>
    <button class="date${isOverdue(t) ? ' overdue' : ''}" aria-label="언제 할지 바꾸기"></button>
    <button class="chip ${t.area}">${AREAS[t.area].label}</button>
    ${t.area === 'work' ? `<button class="share ${t.share || 'private'}" aria-label="공유 범위">${SHARES[t.share || 'private'].label}</button>` : ''}
    <button class="del" aria-label="삭제">×</button>`;
  const title = li.querySelector('.title');
  title.textContent = t.title;
  title.onclick = () => editTitle(title, t);

  const date = li.querySelector('.date');
  date.textContent = whenLabel(t.date);
  date.onclick = () => openWhenMenu(t);

  const shareBtn = li.querySelector('.share');
  if (shareBtn) shareBtn.onclick = () => {
    const next = SHARES[t.share || 'private'].next;
    Store.update(t.id, { share: next });
    toast(SHARES[next].hint);
  };
  li.querySelector('.check').onclick = () => Store.update(t.id, { done: !t.done });
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
  tasks.sort((a, b) => a.done - b.done || a.date.localeCompare(b.date));
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

function editTitle(el, t) {
  if (el.isContentEditable) return;
  el.contentEditable = 'true';
  el.focus();
  document.getSelection().selectAllChildren(el);
  document.getSelection().collapseToEnd();

  let finished = false;
  const finish = save => {
    if (finished) return;
    finished = true;
    const text = el.textContent.trim();
    if (save && text && text !== t.title) {
      Store.update(t.id, { title: text });
      toast('고쳤어요');
    }
    renderToday();
    renderWeek();
  };
  el.onkeydown = e => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') finish(false);
  };
  el.onblur = () => finish(true);
}

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

    const head = document.createElement('li');
    head.className = 'day-head';
    head.textContent = `${d.getMonth() + 1}/${d.getDate()} (${DAY[d.getDay()]})`;
    ul.appendChild(head);
    for (const ev of events) {
      const li = document.createElement('li');
      li.className = 'event';
      li.textContent = ev;
      ul.appendChild(li);
    }
    dayTasks.forEach(t => ul.appendChild(taskItem(t)));
  }
}

// Where new captures go. Stays on the chosen target so several items can be
// dumped in a row; resets to 오늘 when the app is reopened.
const TARGETS = {
  day:   { label: '오늘', value: todayStr },
  week:  { label: '이번 주 안에', value: thisWeek },
  month: { label: '이번 달 안에', value: thisMonth },
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
  const title = input.value.trim();
  if (!title) return;
  const area = guessArea(title);
  Store.add({ id: Md.newId(), title, area, date: TARGETS[target].value(), done: false });
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

function renderSync() {
  const s = Store.status();
  const n = Store.pendingCount();
  $('#sync-text').textContent = SYNC_TEXT[s] + (n && s !== 'synced' ? ` (대기 ${n}개)` : '');
  const btn = $('#sync-btn');
  btn.hidden = !(s === 'local' || s === 'expired' || s === 'error');
  btn.textContent = s === 'local' ? '구글 드라이브 연결' : '다시 연결';
  $('#sync').dataset.state = s;
}

function render() {
  // Don't rebuild the list under someone who is editing a title.
  if (!document.activeElement || !document.activeElement.isContentEditable) {
    renderToday();
    renderWeek();
  }
  renderSync();
}

$('#sync-btn').addEventListener('click', async () => {
  try {
    await Drive.signIn();
    if (!Drive.isLinked()) await Drive.connect();
    await Store.sync();
    if (Store.status() === 'synced') toast('드라이브와 연결됐어요');
  } catch (e) {
    toast(e.message === 'cancel' ? '폴더 선택을 취소했어요' : '연결하지 못했어요');
    render();
  }
});

function focusInput() { setTimeout(() => $('#input').focus(), 50); }
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { render(); Store.sync(); focusInput(); }
});

Store.onChange(render);
renderTargets();
render();
focusInput();
Drive.init().then(() => Store.sync()).catch(() => render());

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
