// Google Drive access. Scope is drive.file: the app only sees the folder the user
// picks once and the files it creates there — not the rest of the Drive.
const Drive = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const FILE_NAME = '할 일.md';
  const NEW_FILE = '# 할 일\n\nOffload 앱이 관리하는 파일이에요. 옵시디온에서 고쳐도 앱에 반영돼요.\n\n';
  const FOLDER = 'application/vnd.google-apps.folder';
  const KEY = { token: 'offload.drive.token', file: 'offload.drive.file', notes: 'offload.drive.notes', dirs: 'offload.drive.dirs' };

  const get = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const set = (k, v) => {
    try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {}
  };

  let tokenClient = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src; s.async = true; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function token() {
    const t = get(KEY.token);
    return t && t.exp > Date.now() + 60_000 ? t.value : null;
  }
  const isLinked = () => !!get(KEY.file);
  const canSync = () => isLinked() && !!token();

  async function init() {
    await loadScript('https://accounts.google.com/gsi/client');
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID, scope: SCOPE, callback: () => {},
    });
  }

  // Must be called directly from a tap, or the login popup gets blocked.
  function signIn() {
    return new Promise((resolve, reject) => {
      if (!tokenClient) return reject(new Error('not ready'));
      tokenClient.callback = r => {
        if (r.error) return reject(new Error(r.error));
        set(KEY.token, { value: r.access_token, exp: Date.now() + r.expires_in * 1000 });
        resolve();
      };
      tokenClient.error_callback = err => reject(new Error(err.type || 'popup'));
      tokenClient.requestAccessToken({ prompt: isLinked() ? '' : 'consent' });
    });
  }

  async function pickFolder() {
    await loadScript('https://apis.google.com/js/api.js');
    await new Promise(r => gapi.load('picker', r));
    return new Promise((resolve, reject) => {
      const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes('application/vnd.google-apps.folder');
      new google.picker.PickerBuilder()
        .setTitle('Offload 폴더를 골라 주세요')
        .addView(view)
        .setOAuthToken(token())
        .setDeveloperKey(CONFIG.API_KEY)
        .setAppId(CONFIG.APP_ID)
        .setCallback(d => {
          if (d.action === google.picker.Action.PICKED) resolve(d.docs[0]);
          if (d.action === google.picker.Action.CANCEL) reject(new Error('cancel'));
        })
        .build()
        .setVisible(true);
    });
  }

  // A 404 on the main file means it's gone, so the link is reset. Notes pass
  // keepLink so a missing note never unlinks 할 일.md.
  async function api(url, opts = {}, keepLink = false) {
    const res = await fetch(url, {
      ...opts,
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token()}`, ...(opts.headers || {}) },
    });
    if (res.status === 401) { set(KEY.token, null); throw new Error('auth'); }
    if (res.status === 404) { if (!keepLink) set(KEY.file, null); throw new Error('missing'); }
    if (!res.ok) throw new Error(`drive ${res.status}`);
    return res;
  }

  const quote = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  async function findIn(folderId, name, mimeType) {
    const q = encodeURIComponent(`'${folderId}' in parents and name = '${quote(name)}' and trashed = false` +
      (mimeType ? ` and mimeType = '${mimeType}'` : ''));
    const found = await (await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, {}, true)).json();
    return found.files.length ? found.files[0].id : null;
  }

  async function createIn(folderId, name, text) {
    const body = new FormData();
    body.append('metadata', new Blob([JSON.stringify({ name, parents: [folderId], mimeType: 'text/markdown' })], { type: 'application/json' }));
    body.append('file', new Blob([text], { type: 'text/markdown' }));
    const created = await (await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', body }, true)).json();
    return created.id;
  }

  async function findOrCreateFile(folderId) {
    return (await findIn(folderId, FILE_NAME)) || createIn(folderId, FILE_NAME, NEW_FILE);
  }

  // 메모/ and 일지/ sit next to 할 일.md. The app creates them, so drive.file can see them.
  async function folder(dir) {
    const cached = { ...(get(KEY.notes) ? { 메모: get(KEY.notes) } : {}), ...(get(KEY.dirs) || {}) };
    if (cached[dir]) return cached[dir];
    const meta = await (await api(`https://www.googleapis.com/drive/v3/files/${get(KEY.file)}?fields=parents`)).json();
    const parent = meta.parents[0];
    let id = await findIn(parent, dir, FOLDER);
    if (!id) {
      id = (await (await api('https://www.googleapis.com/drive/v3/files?fields=id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: dir, mimeType: FOLDER, parents: [parent] }),
      }, true)).json()).id;
    }
    set(KEY.dirs, { ...cached, [dir]: id });
    set(KEY.notes, null);
    return id;
  }

  const findNote = async (name, dir) => findIn(await folder(dir), `${name}.md`);
  const createNote = async (name, text, dir) => createIn(await folder(dir), `${name}.md`, text);
  // Names of the files the app can see in a folder (only ones it created).
  async function listNames(dir) {
    const q = encodeURIComponent(`'${await folder(dir)}' in parents and trashed = false`);
    const res = await (await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(name)&pageSize=1000`, {}, true)).json();
    return res.files.map(f => f.name);
  }
  const readNote = async id => (await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {}, true)).text();
  const writeNote = (id, text) => api(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    body: text,
  }, true);

  async function connect() {
    const picked = await pickFolder();
    set(KEY.notes, null);
    set(KEY.dirs, null);
    set(KEY.file, await findOrCreateFile(picked.id));
  }

  async function read() {
    return (await api(`https://www.googleapis.com/drive/v3/files/${get(KEY.file)}?alt=media`)).text();
  }

  async function write(text) {
    await api(`https://www.googleapis.com/upload/drive/v3/files/${get(KEY.file)}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      body: text,
    });
  }

  return { init, signIn, connect, read, write, isLinked, canSync, findNote, createNote, listNames, readNote, writeNote };
})();
