const AREAS = {
  home:   { label: '가정', next: 'church' },
  church: { label: '교회', next: 'work' },
  work:   { label: '회사', next: 'home' },
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

function renderToday() {
  const today = todayStr();
  const tasks = Store.list().filter(t => t.date === today || (!t.done && t.date < today));
  tasks.sort((a, b) => a.done - b.done);

  const ul = $('#today');
  ul.innerHTML = '';
  for (const t of tasks) {
    const li = document.createElement('li');
    li.className = t.done ? 'done' : '';
    li.innerHTML = `
      <button class="check" aria-label="완료 표시"></button>
      <span class="title"></span>
      <button class="chip ${t.area}">${AREAS[t.area].label}</button>
      <button class="del" aria-label="삭제">×</button>`;
    const title = li.querySelector('.title');
    title.textContent = t.title;
    title.onclick = () => editTitle(title, t);
    li.querySelector('.check').onclick = () => Store.update(t.id, { done: !t.done });
    li.querySelector('.chip').onclick = () => Store.update(t.id, { area: AREAS[t.area].next });
    li.querySelector('.del').onclick = () => Store.remove(t.id);
    ul.appendChild(li);
  }
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

function renderWeek() {
  const ul = $('#week');
  ul.innerHTML = '';
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const tasks = Store.list();

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const key = ymd(d);
    const items = [
      ...fixedEvents(d),
      ...tasks.filter(t => t.date === key && !t.done && key !== todayStr()).map(t => t.title),
    ];
    if (!items.length) continue;
    const li = document.createElement('li');
    if (key === todayStr()) li.className = 'today-row';
    li.innerHTML = `<span class="day">${d.getMonth() + 1}/${d.getDate()} ${DAY[d.getDay()]}</span><span class="title"></span>`;
    li.querySelector('.title').textContent = items.join(' · ');
    ul.appendChild(li);
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
