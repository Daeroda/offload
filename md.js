// Markdown <-> tasks. One task per line, Obsidian-friendly:
//   - [ ] 기저귀 주문 #가정 📅 2026-10-12 ^t4k2x9a
// Lines that aren't tasks (headings, notes) are kept untouched.
const Md = (() => {
  const TAG = { home: '가정', church: '교회', work: '회사' };
  const AREA = { 가정: 'home', 교회: 'church', 회사: 'work' };
  const TASK = /^- \[([ xX])\] (.*)$/;

  const newId = () => 't' + Math.random().toString(36).slice(2, 8);

  function parse(text, today) {
    return text.replace(/\r\n/g, '\n').split('\n').map(raw => {
      const m = raw.match(TASK);
      if (!m) return { raw };
      let rest = m[2], id, date, area = 'home';
      rest = rest.replace(/\s+\^([\w-]+)\s*$/, (_, x) => { id = x; return ''; });
      rest = rest.replace(/\s*📅\s*(\d{4}-\d{2}-\d{2})/, (_, x) => { date = x; return ''; });
      rest = rest.replace(/\s*#(가정|교회|회사)(?=\s|$)/, (_, x) => { area = AREA[x]; return ''; });
      return { id: id || newId(), title: rest.trim(), area, date: date || today, done: m[1] !== ' ' };
    });
  }

  const line = t => `- [${t.done ? 'x' : ' '}] ${t.title} #${TAG[t.area]} 📅 ${t.date} ^${t.id}`;

  function serialize(entries) {
    return entries.map(e => ('raw' in e ? e.raw : line(e))).join('\n');
  }

  return { parse, serialize, newId };
})();
