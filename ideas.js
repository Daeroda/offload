// Ideas box: 아이디어.md next to 할 일.md. Insights from books, sermons and videos,
// and ideas for Offload itself, one per line:
//   - 일보다 리듬이 먼저 📅 2026-10-14 ^i3k9x2a
//   - 할 일을 길게 누르면 메모 바로 열기 #오프로드 📅 2026-10-14 ^i7q1m0c
// #오프로드 = the agent picked it up into Offload 백로그.md.
// Like Store: saved locally first, and queued adds/removes are replayed on top of
// the latest Drive file, so edits made in Obsidian or by the agent are kept.
const Ideas = (() => {
  const NAME = '아이디어';
  const NEW_FILE = '# 아이디어\n\n떠오른 생각, 인사이트, Offload 개선 아이디어. Offload 앱이 관리하는 파일이에요. `#오프로드`는 에이전트가 Offload 백로그로 옮긴 것이에요.\n\n';
  const KEY = { cache: 'offload.ideas.cache.v1', pending: 'offload.ideas.pending.v1', file: 'offload.ideas.file' };
  const IDEA = /^- (.*?)((?:\s+#오프로드)?)\s+📅\s*(\d{4}-\d{2}-\d{2})\s+\^([\w-]+)\s*$/;

  const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  let items = load(KEY.cache) || [];
  let pending = load(KEY.pending) || [];
  let listeners = [];
  const emit = () => listeners.forEach(fn => fn());
  const persist = () => { save(KEY.cache, items); save(KEY.pending, pending); };

  const newId = () => 'i' + Math.random().toString(36).slice(2, 8);
  const line = i => `- ${i.text}${i.offload ? ' #오프로드' : ''} 📅 ${i.date} ^${i.id}`;

  function parse(text) {
    return text.replace(/\r\n/g, '\n').split('\n').map(raw => {
      const m = raw.match(IDEA);
      return m ? { raw, id: m[4], text: m[1].trim(), offload: !!m[2], date: m[3] } : { raw };
    });
  }

  // Works on parsed lines, so lines that aren't ideas stay untouched.
  function apply(lines, op) {
    if (op.type === 'add') {
      if (lines.some(l => l.id === op.item.id)) return lines;
      let i = lines.length;
      while (i > 0 && lines[i - 1].raw.trim() === '') i--;
      return [...lines.slice(0, i), { raw: line(op.item), ...op.item }, ...lines.slice(i)];
    }
    if (op.type === 'remove') return lines.filter(l => l.id !== op.id);
    return lines;
  }
  const toItems = lines => lines.filter(l => l.id).map(({ raw, ...i }) => i);

  function commit(op) {
    items = toItems(apply(items.map(i => ({ raw: line(i), ...i })), op));
    pending.push(op);
    persist();
    emit();
    sync();
  }

  async function fileId() {
    const cached = load(KEY.file);
    if (cached) return cached;
    const id = (await Drive.findNote(NAME, '')) || await Drive.createNote(NAME, NEW_FILE, '');
    save(KEY.file, id);
    return id;
  }

  let running = null, again = false;
  function sync() {
    if (!Drive.canSync()) return Promise.resolve();
    if (running) { again = true; return running; }
    running = (async () => {
      try {
        do {
          again = false;
          const id = await fileId();
          let text;
          try { text = await Drive.readNote(id); }
          catch (e) { if (e.message === 'missing') save(KEY.file, null); throw e; }
          const ops = pending.slice();
          const merged = ops.reduce(apply, parse(text));
          const out = merged.map(l => l.raw).join('\n');
          if (out !== text.replace(/\r\n/g, '\n')) await Drive.writeNote(id, out);
          pending = pending.slice(ops.length);
          items = toItems(pending.reduce(apply, merged));
          persist();
        } while (again);
      } catch {} finally {
        running = null;
        emit();
      }
    })();
    return running;
  }

  return {
    list: () => items.slice().reverse(),
    add: (text, date) => commit({ type: 'add', item: { id: newId(), text, offload: false, date } }),
    remove: id => commit({ type: 'remove', id }),
    sync,
    pendingCount: () => pending.length,
    onChange: fn => listeners.push(fn),
  };
})();
