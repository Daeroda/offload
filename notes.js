// Task notes: one markdown file per task in 메모/, so Obsidian opens them too.
// Like the task list, typing is saved locally first and uploaded when Drive is
// reachable. `base` is the Drive text we last saw; if Obsidian changed the file
// in the meantime, both versions are kept instead of overwriting.
const Notes = (() => {
  const KEY = 'offload.notes.v1';
  let drafts = {};
  try { drafts = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(drafts)); } catch {} };
  const norm = s => (s || '').replace(/\r\n/g, '\n').trimEnd();
  const dirty = name => { const d = drafts[name]; return !!d && (d.base == null || norm(d.text) !== norm(d.base)); };

  // File names come from the task title; strip what Drive/Obsidian links can't hold.
  function nameFor(title, taken) {
    const base = title.replace(/[\\/:*?"<>|#^[\]'`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50) || '메모';
    let name = base;
    for (let i = 2; taken.includes(name); i++) name = `${base} (${i})`;
    return name;
  }

  async function open(name) {
    const d = drafts[name];
    if (dirty(name) || !Drive.canSync()) return d ? d.text : '';
    const id = d?.id || await Drive.findNote(name);
    const text = id ? await Drive.readNote(id) : '';
    drafts[name] = { id, base: id ? text : null, text };
    persist();
    return text;
  }

  let timers = {};
  let listeners = [];
  const emit = name => listeners.forEach(fn => fn(name));

  function edit(name, text) {
    drafts[name] = { ...(drafts[name] || { id: null, base: null }), text };
    persist();
    clearTimeout(timers[name]);
    timers[name] = setTimeout(() => save(name).catch(() => emit(name)), 800);
    emit(name);
  }

  const saving = {};
  async function save(name) {
    if (!Drive.canSync() || !dirty(name)) return;
    if (saving[name]) return saving[name].then(() => save(name));
    saving[name] = (async () => {
      const d = drafts[name];
      const typed = d.text;
      if (!d.id) d.id = await Drive.findNote(name);
      let out = typed;
      if (!d.id) {
        d.id = await Drive.createNote(name, out);
      } else {
        const remote = await Drive.readNote(d.id);
        if (norm(remote) !== norm(d.base) && norm(remote) !== norm(typed)) {
          out = `${norm(remote)}\n\n---\n(앱에서 쓴 내용)\n${typed}`;
        }
        await Drive.writeNote(d.id, out);
      }
      // Keep anything typed while the upload was running.
      d.base = out;
      if (d.text === typed) d.text = out;
      persist();
    })().finally(() => { delete saving[name]; emit(name); });
    return saving[name];
  }

  const flush = () => Promise.all(Object.keys(drafts).filter(dirty).map(n => save(n).catch(() => {})));

  return {
    nameFor, open, edit, flush,
    text: name => drafts[name]?.text ?? '',
    pending: dirty,
    onChange: fn => listeners.push(fn),
  };
})();
