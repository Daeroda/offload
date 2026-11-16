// Markdown files the app owns in a Drive folder: task notes in 메모/, one journal
// per day in 일지/. Obsidian opens them too. Like the task list, typing is saved
// locally first and uploaded when Drive is reachable. `base` is the Drive text we
// last saw; if Obsidian changed the file in the meantime, both versions are kept
// instead of overwriting.
const keepBoth = (remote, typed) => `${remote}\n\n---\n(앱에서 쓴 내용)\n${typed}`;
const makeNotes = (dir, KEY, merge = keepBoth) => {
  let drafts = {};
  try { drafts = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(drafts)); } catch {} };
  const norm = s => (s || '').replace(/\r\n/g, '\n').trimEnd();
  const dirty = name => { const d = drafts[name]; return !!d && norm(d.text) !== norm(d.base); };

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
    const id = d?.id || await Drive.findNote(name, dir);
    const text = id ? await Drive.readNote(id) : '';
    // Update the draft in place: a save that is still running holds this object.
    Object.assign(drafts[name] || (drafts[name] = {}), { id, base: id ? text : null, text });
    persist();
    return text;
  }

  let timers = {};
  let listeners = [];
  const emit = name => listeners.forEach(fn => fn(name));

  function edit(name, text) {
    // In place, not a copy: an upload still running must update this same draft's
    // base. With a copy, the next save saw a stale base, took it for an edit made
    // elsewhere and kept both versions — every few keystrokes, since Korean typing
    // changes the last letter, so new text never just extends the old.
    const d = drafts[name] || (drafts[name] = { id: null, base: null });
    d.text = text;
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
      if (!d.id) d.id = await Drive.findNote(name, dir);
      let out = typed;
      if (!d.id) {
        d.id = await Drive.createNote(name, out, dir);
      } else {
        const remote = await Drive.readNote(d.id);
        // Typing on top of what's on Drive (e.g. an empty journal) isn't a conflict.
        if (norm(remote) !== norm(d.base) && !norm(typed).startsWith(norm(remote))) {
          out = merge(norm(remote), typed);
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
};

const Notes = makeNotes('메모', 'offload.notes.v1');

// Journal: 일지/2026-10-14.md. The top part lists that day's tasks when opened in
// Obsidian (a search of 할 일.md); the app shows and edits only what's under
// "## 일지" and draws the tasks itself.
const Journal = (() => {
  const DIR = '일지';
  const AHEAD = 14;
  const ENSURED = 'offload.journal.ensured';
  // Both sides changed (another device, or Obsidian): keep what was typed here
  // and add only the paragraphs from the other side it doesn't already have —
  // never the whole file again with its header.
  function mergeJournal(remote, typed) {
    const [head, mine] = split(typed);
    const paras = t => t.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const have = paras(mine);
    // A paragraph cut short mid-typing still counts as the same one.
    const known = p => have.some(h => h.includes(p) || p.includes(h) || h.startsWith(p.slice(0, -2)));
    const extra = paras(split(remote)[1]).filter(p => p !== MARK && !known(p));
    if (!extra.length) return typed;
    return `${head}${mine.trimEnd()}\n\n${MARK}\n\n${extra.join('\n\n')}\n`;
  }
  const MARK = '(다른 곳에서 쓴 내용)';
  const base = makeNotes(DIR, 'offload.journal.v1', mergeJournal);

  const template = day => [
    '## 할 일', '',
    '```query', `path:"할 일.md" ("📅 ${day}" OR "✅ ${day}")`, '```', '',
    '## 일지', '', '',
  ].join('\n');

  // [the part above the journal, the journal itself]
  function split(text) {
    const m = text.match(/^## 일지[ \t]*(?:\n|$)/m);
    if (!m) return ['', text];
    const i = m.index + m[0].length;
    return [text.slice(0, i), text.slice(i).replace(/^\n+/, '')];
  }

  const body = day => split(base.text(day))[1];
  function write(day, text) {
    const [head] = split(base.text(day) || template(day));
    base.edit(day, head ? `${head.endsWith('\n') ? head : head + '\n'}\n${text}` : text);
  }

  // The app can only see files it created, so it makes the next two weeks' files
  // ahead of time. Obsidian's daily note then opens the existing file instead of
  // making one the app can't see. Once a day per device is enough.
  // Opening the app can start several syncs at once (load, coming back to the
  // tab, going online). Only one check may run, or both create the same files.
  let ensuring = null;
  function ensureAhead(days) {
    if (!ensuring) ensuring = ensureNow(days).finally(() => { ensuring = null; });
    return ensuring;
  }
  async function ensureNow(days) {
    try { if (localStorage.getItem(ENSURED) === days[0]) return; } catch {}
    const have = new Set(await Drive.listNames(DIR));
    for (const day of days) {
      if (!have.has(`${day}.md`)) await Drive.createNote(day, template(day), DIR);
    }
    try { localStorage.setItem(ENSURED, days[0]); } catch {}
  }

  // Days that have something written under "## 일지", newest first. An empty
  // file is just the template, so one folder listing with sizes is enough to
  // tell them apart without opening every file. Unsaved local writing counts too.
  const EMPTY = new TextEncoder().encode(template('2000-01-01')).length;
  async function written(upTo) {
    const days = new Set();
    if (Drive.canSync()) {
      for (const f of await Drive.listFiles(DIR)) {
        const m = f.name.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
        if (m && f.size > EMPTY + 2) days.add(m[1]);
      }
    }
    let local = {};
    try { local = JSON.parse(localStorage.getItem('offload.journal.v1')) || {}; } catch {}
    for (const day of Object.keys(local)) {
      if (body(day).trim()) days.add(day);
    }
    return [...days].filter(d => d <= upTo).sort().reverse();
  }

  // 돌아보기 reads past journals one at a time (once per app session each), so a
  // long list doesn't fire a burst of Drive requests. `done` redraws as they come.
  const loaded = new Set();
  let queue = Promise.resolve();
  function preload(days, done) {
    if (!Drive.canSync()) return;
    for (const day of days) {
      if (loaded.has(day)) { queue = queue.then(() => done(day)); continue; }
      loaded.add(day);
      queue = queue.then(() => base.open(day)).then(() => done(day), () => loaded.delete(day));
    }
  }

  return {
    AHEAD, ensureAhead, body, write, preload, written,
    open: async day => split(await base.open(day))[1],
    flush: base.flush,
    pending: base.pending,
    onChange: base.onChange,
  };
})();
