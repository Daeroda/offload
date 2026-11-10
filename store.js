// Local-first store. Every change is applied to the local copy immediately (so
// capture never waits on the network) and queued as an operation. Sync replays
// queued operations on top of the latest Drive file, so edits made in Obsidian
// and on other devices are kept.
const Store = (() => {
  const KEY = { cache: 'offload.cache.v2', pending: 'offload.pending.v1', legacy: 'offload.tasks.v1' };
  const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  let entries = load(KEY.cache) || [];
  let pending = load(KEY.pending) || [];
  let listeners = [];
  let status = 'local';

  // v1 kept tasks only in this browser; queue them so they upload on first sync.
  const legacy = load(KEY.legacy);
  if (legacy && legacy.length) {
    for (const t of legacy) {
      const task = { id: Md.newId(), title: t.title, area: t.area, date: t.date, done: t.done };
      entries.push(task);
      pending.push({ type: 'add', task });
    }
    try { localStorage.removeItem(KEY.legacy); } catch {}
    persist();
  }

  function persist() { save(KEY.cache, entries); save(KEY.pending, pending); }
  function emit() { listeners.forEach(fn => fn()); }

  function apply(list, op) {
    if (op.type === 'add') {
      if (list.some(e => e.id === op.task.id)) return list;
      let i = list.length;
      while (i > 0 && 'raw' in list[i - 1] && list[i - 1].raw.trim() === '') i--;
      return [...list.slice(0, i), op.task, ...list.slice(i)];
    }
    if (op.type === 'update') return list.map(e => (e.id === op.id ? { ...e, ...op.patch } : e));
    if (op.type === 'remove') return list.filter(e => e.id !== op.id);
    return list;
  }

  function commit(op) {
    entries = apply(entries, op);
    pending.push(op);
    persist();
    emit();
    sync();
  }

  // A failed save retries by itself, waiting longer each time. Phones often have no
  // network for a moment right after the app comes back from the background.
  const RETRY = [2, 5, 15, 30, 60];
  let retryTimer = null, attempt = 0, lastError = '';
  function why(e) {
    if (e instanceof TypeError || !navigator.onLine) return 'network';
    const m = /drive (\d+)/.exec(e && e.message);
    if (m && (m[1] === '403' || m[1] === '429')) return 'limit';
    if (m) return 'drive';
    return 'other';
  }
  function scheduleRetry() {
    clearTimeout(retryTimer);
    const wait = RETRY[Math.min(attempt, RETRY.length - 1)];
    attempt++;
    retryTimer = setTimeout(sync, wait * 1000);
  }

  let running = null, again = false;
  function sync() {
    clearTimeout(retryTimer);
    if (!Drive.canSync()) { status = Drive.isLinked() ? 'expired' : 'local'; emit(); return Promise.resolve(); }
    if (running) { again = true; return running; }
    running = (async () => {
      status = 'syncing'; emit();
      try {
        do {
          again = false;
          const text = await Drive.read();
          const ops = pending.slice();
          const merged = ops.reduce(apply, Md.parse(text, todayStr()));
          const out = Md.serialize(merged);
          if (out !== text.replace(/\r\n/g, '\n')) await Drive.write(out);
          pending = pending.slice(ops.length);
          entries = pending.reduce(apply, merged);
          persist();
        } while (again);
        status = 'synced';
        attempt = 0;
        lastError = '';
      } catch (e) {
        status = Drive.canSync() ? 'error' : 'expired';
        lastError = why(e);
        console.warn('Offload save failed:', lastError, e);
        if (status === 'error') scheduleRetry();
      } finally {
        running = null;
        emit();
      }
    })();
    return running;
  }

  return {
    list: () => entries.filter(e => !('raw' in e)),
    add: task => commit({ type: 'add', task }),
    update: (id, patch) => commit({ type: 'update', id, patch }),
    remove: id => commit({ type: 'remove', id }),
    sync,
    status: () => status,
    lastError: () => lastError,
    pendingCount: () => pending.length,
    onChange: fn => listeners.push(fn),
  };
})();
