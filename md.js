// Markdown <-> tasks. One task per line, Obsidian-friendly:
//   - [ ] 기저귀 주문 #가정 📅 2026-10-12 ^t4k2x9a
//   - [ ] 지결 상신 #회사 #공유 📅 2026-10-13 ^t8h2k1c
//   - [ ] 책장 정리 #가정 📅 2026-W42 ^t3m9q0z     (sometime this week)
//   - [ ] 보험 갱신 확인 #가정 📅 2026-10 ^t6w1r5d  (sometime this month)
//   - [ ] 권리금 제안 #회사 📅 2026-10-13 🔗 https://notion.so/… [[메모/권리금 제안|📝]] ^t7kcbu8
//   - [x] 지결 상신 #회사 📅 2026-10-13 ✅ 2026-10-14 ^t8h2k1c  (done on the 14th)
// 🔗 = linked documents, [[메모/…|📝]] = the task's note file (opens in Obsidian too),
// ✅ = the day it was finished, so each day can be looked back on.
// Work tasks carry a sharing level: no tag = 개인 (default, never goes to the
// team Notion page), #공유 = goes to Notion, #기밀 = hidden from logs/summaries too.
// Lines that aren't tasks (headings, notes) are kept untouched.
const Md = (() => {
  const TAG = { home: '가정', church: '교회', work: '회사' };
  const AREA = { 가정: 'home', 교회: 'church', 회사: 'work' };
  const SHARE_TAG = { shared: '공유', secret: '기밀' };
  const SHARE = { 공유: 'shared', 기밀: 'secret' };
  const TASK = /^- \[([ xX])\] (.*)$/;

  const newId = () => 't' + Math.random().toString(36).slice(2, 8);

  function parse(text, today) {
    return text.replace(/\r\n/g, '\n').split('\n').map(raw => {
      const m = raw.match(TASK);
      if (!m) return { raw };
      let rest = m[2], id, date, doneOn, area = 'home', share = 'private', note;
      const links = [];
      rest = rest.replace(/\s+\^([\w-]+)\s*$/, (_, x) => { id = x; return ''; });
      rest = rest.replace(/\s*\[\[(?:메모\/)?([^\]|]+)\|📝\]\]/, (_, x) => { note = x.trim(); return ''; });
      rest = rest.replace(/\s*🔗\s*(\S+)/g, (_, x) => { links.push(x); return ''; });
      rest = rest.replace(/\s*✅\s*(\d{4}-\d{2}-\d{2})(?=\s|$)/, (_, x) => { doneOn = x; return ''; });
      rest = rest.replace(/\s*📅\s*(\d{4}-(?:W\d{2}|\d{2}(?:-\d{2})?))(?=\s|$)/, (_, x) => { date = x; return ''; });
      rest = rest.replace(/\s*#(가정|교회|회사)(?=\s|$)/, (_, x) => { area = AREA[x]; return ''; });
      rest = rest.replace(/\s*#(공유|기밀)(?=\s|$)/, (_, x) => { share = SHARE[x]; return ''; });
      const t = { id: id || newId(), title: rest.trim(), area, share, date: date || today, done: m[1] !== ' ' };
      if (links.length) t.links = links;
      if (note) t.note = note;
      if (doneOn) t.doneOn = doneOn;
      return t;
    });
  }

  function line(t) {
    const share = t.area === 'work' && SHARE_TAG[t.share] ? ` #${SHARE_TAG[t.share]}` : '';
    const links = (t.links || []).map(u => ` 🔗 ${u}`).join('');
    const note = t.note ? ` [[메모/${t.note}|📝]]` : '';
    const doneOn = t.done && t.doneOn ? ` ✅ ${t.doneOn}` : '';
    return `- [${t.done ? 'x' : ' '}] ${t.title} #${TAG[t.area]}${share} 📅 ${t.date}${doneOn}${links}${note} ^${t.id}`;
  }

  function serialize(entries) {
    return entries.map(e => ('raw' in e ? e.raw : line(e))).join('\n');
  }

  return { parse, serialize, newId };
})();
