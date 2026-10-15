// Google Calendar sync, one way: 할 일.md -> the primary calendar. Only tasks with
// a time (⏰) become events. Each event's id is derived from the task id and it
// carries a private "offload" property, so any device can find, update or remove
// it without keeping its own record. Events moved in Google Calendar are not read back.
const Calendar = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
  const BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
  const WINDOW_DAYS = 14; // events older than this are left alone
  const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';

  let status = 'off';
  const ready = () => Drive.hasScope(SCOPE);

  // Calendar ids allow only 0-9 and a-v; hex of the task id fits.
  const eventId = taskId => 'ofl' + [...taskId].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');

  const pad = n => String(n).padStart(2, '0');
  const local = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

  // '14:00-15:00' or just '14:00' (one hour). An end before the start runs past midnight.
  function span(date, time) {
    const [a, b] = time.split('-');
    const start = new Date(`${date}T${a}:00`);
    let end = b ? new Date(`${date}T${b}:00`) : new Date(start.getTime() + 3600_000);
    if (end <= start) end = new Date(end.getTime() + 86400_000);
    return [local(start), local(end)];
  }

  function hash(s) {
    let h = 5381;
    for (const c of s) h = (h * 33 + c.codePointAt(0)) >>> 0;
    return h.toString(36);
  }

  function eventFor(t) {
    const [start, end] = span(t.date, t.time);
    const ev = {
      id: eventId(t.id),
      status: 'confirmed',
      summary: (t.done ? '✓ ' : '') + t.title,
      description: 'Offload 앱에서 만든 일정이에요. 시간은 앱에서 바꿔 주세요.',
      start: { dateTime: start, timeZone: TZ },
      end: { dateTime: end, timeZone: TZ },
      // 기밀: people the calendar is shared with only see "busy".
      visibility: t.area === 'work' && t.share === 'secret' ? 'private' : 'default',
    };
    ev.extendedProperties = { private: { offload: '1', sig: hash(JSON.stringify(ev)) } };
    return ev;
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      cache: 'no-store',
      headers: { Authorization: `Bearer ${Drive.token()}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    return res;
  }

  async function listOurs(from) {
    const found = new Map();
    let page = '';
    do {
      const q = new URLSearchParams({
        privateExtendedProperty: 'offload=1',
        timeMin: new Date(`${from}T00:00:00`).toISOString(),
        maxResults: '2500',
        fields: 'nextPageToken,items(id,extendedProperties)',
      });
      if (page) q.set('pageToken', page);
      const res = await api(`${BASE}?${q}`);
      if (!res.ok) throw new Error(`calendar ${res.status}`);
      const data = await res.json();
      for (const e of data.items || []) found.set(e.id, e.extendedProperties?.private?.sig);
      page = data.nextPageToken;
    } while (page);
    return found;
  }

  // PUT also revives an event that was deleted before; a brand-new one needs POST.
  async function upsert(ev) {
    let res = await api(`${BASE}/${ev.id}`, { method: 'PUT', body: JSON.stringify(ev) });
    if (res.status === 404) res = await api(BASE, { method: 'POST', body: JSON.stringify(ev) });
    if (!res.ok) throw new Error(`calendar ${res.status}`);
  }

  async function remove(id) {
    const res = await api(`${BASE}/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`calendar ${res.status}`);
  }

  let running = null, again = false, latest = [];
  function sync(tasks) {
    latest = tasks;
    if (!ready()) { status = 'off'; return Promise.resolve(); }
    if (running) { again = true; return running; }
    running = (async () => {
      try {
        do {
          again = false;
          const from = new Date(); from.setDate(from.getDate() - WINDOW_DAYS);
          const fromStr = local(from).slice(0, 10);
          const want = new Map(latest
            .filter(t => t.time && t.date.length === 10 && t.date >= fromStr)
            .map(t => { const ev = eventFor(t); return [ev.id, ev]; }));
          const have = await listOurs(fromStr);
          for (const [id, ev] of want) {
            if (have.get(id) !== ev.extendedProperties.private.sig) await upsert(ev);
          }
          for (const id of have.keys()) if (!want.has(id)) await remove(id);
        } while (again);
        status = 'synced';
      } catch {
        status = 'error';
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return { SCOPE, sync, ready, status: () => status };
})();
