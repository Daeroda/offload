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

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const todayStr = () => ymd(new Date());

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 1600);
}

function dateLabel(date) {
  const today = todayStr();
  const d = new Date(date + 'T00:00:00');
  const diff = Math.round((d - new Date(today + 'T00:00:00')) / 86400000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '내일';
  if (diff === -1) return '어제';
  return `${d.getMonth() + 1}/${d.getDate()} ${DAY[d.getDay()]}`;
}

function taskItem(t) {
  const li = document.createElement('li');
  const overdue = !t.done && t.date < todayStr();
  li.className = t.done ? 'done' : '';
  li.innerHTML = `
    <button class="check" aria-label="완료 표시"></button>
    <span class="title"></span>
    <label class="date${overdue ? ' overdue' : ''}"><span></span><input type="date" aria-label="날짜 바꾸기"></label>
    <button class="chip ${t.area}">${AREAS[t.area].label}</button>
    ${t.area === 'work' ? `<button class="share ${t.share || 'private'}" aria-label="공유 범위">${SHARES[t.share || 'private'].label}</button>` : ''}
    <button class="del" aria-label="삭제">×</button>`;
  const shareBtn = li.querySelector('.share');
  if (shareBtn) shareBtn.onclick = () => {
    const next = SHARES[t.share || 'private'].next;
    Store.update(t.id, { share: next });
    toast(SHARES[next].hint);
  };
  const title = li.querySelector('.title');
  title.textContent = t.title;
  title.onclick = () => editTitle(title, t);

  const date = li.querySelector('.date input');
  li.querySelector('.date span').textContent = dateLabel(t.date);
  date.value = t.date;
  // An invisible date input only opens its calendar on some browsers (PC Chrome
  // ignores clicks on the text part), so open it explicitly.
  li.querySelector('.date').onclick = e => {
    if (typeof date.showPicker !== 'function') return;
    e.preventDefault();
    try { date.showPicker(); } catch {}
  };
  date.onchange = () => {
    if (!date.value || date.value === t.date) return;
    Store.update(t.id, { date: date.value });
    toast(`${dateLabel(date.value)}로 옮겼어요`);
  };

  li.querySelector('.check').onclick = () => Store.update(t.id, { done: !t.done });
  li.querySelector('.chip').onclick = () => Store.update(t.id, { area: AREAS[t.area].next });
  li.querySelector('.del').onclick = () => Store.remove(t.id);
  return li;
}

function renderToday() {
  const today = todayStr();
  const tasks = Store.list().filter(t => t.date === today || (!t.done && t.date < today));
  tasks.sort((a, b) => a.done - b.done);

  const ul = $('#today');
  ul.innerHTML = '';
  tasks.forEach(t => ul.appendChild(taskItem(t)));
  $('#today-empty').hidden = tasks.length > 0;

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
    const d = new Date();
    d.setDate(d.getDate() + i);
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

$('#capture').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#input');
  const title = input.value.trim();
  if (!title) return;
  const area = guessArea(title);
  Store.add({
    id: Md.newId(), title, area, date: todayStr(), done: false,
  });
  input.value = '';
  input.focus();
  toast(`${AREAS[area].label}에 담았어요`);
  renderToday();
  renderWeek();
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
render();
focusInput();
Drive.init().then(() => Store.sync()).catch(() => render());

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
