// Google Drive access. Scope is drive.file: the app only sees the folder the user
// picks once and the files it creates there — not the rest of the Drive.
const Drive = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const FILE_NAME = '할 일.md';
  const NEW_FILE = '# 할 일\n\nOffload 앱이 관리하는 파일이에요. 옵시디온에서 고쳐도 앱에 반영돼요.\n\n';
  const KEY = { token: 'offload.drive.token', file: 'offload.drive.file' };

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

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token()}`, ...(opts.headers || {}) },
    });
    if (res.status === 401) { set(KEY.token, null); throw new Error('auth'); }
    if (res.status === 404) { set(KEY.file, null); throw new Error('missing'); }
    if (!res.ok) throw new Error(`drive ${res.status}`);
    return res;
  }

  async function findOrCreateFile(folderId) {
    const q = encodeURIComponent(`'${folderId}' in parents and name = '${FILE_NAME}' and trashed = false`);
    const found = await (await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`)).json();
    if (found.files.length) return found.files[0].id;

    const body = new FormData();
    body.append('metadata', new Blob([JSON.stringify({ name: FILE_NAME, parents: [folderId], mimeType: 'text/markdown' })], { type: 'application/json' }));
    body.append('file', new Blob([NEW_FILE], { type: 'text/markdown' }));
    const created = await (await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', body })).json();
    return created.id;
  }

  async function connect() {
    const folder = await pickFolder();
    set(KEY.file, await findOrCreateFile(folder.id));
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

  return { init, signIn, connect, read, write, isLinked, canSync };
})();
