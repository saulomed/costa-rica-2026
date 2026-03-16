// ─── GIST SYNC MODULE ───
// Sincroniza estado dos TODOs via GitHub Gist privado

const GistSync = (() => {
  const GIST_ID_KEY = 'cr2026_gist_id';
  const PAT_KEY = 'cr2026_gist_pat';
  const FILENAME = 'cr2026-state.json';

  let _debounceTimer = null;
  let _status = 'idle'; // idle | syncing | synced | error
  let _onStatusChange = null;

  function getCredentials() {
    const gistId = localStorage.getItem(GIST_ID_KEY);
    const pat = localStorage.getItem(PAT_KEY);
    return (gistId && pat) ? { gistId, pat } : null;
  }

  function isConfigured() {
    return getCredentials() !== null;
  }

  function saveCredentials(gistId, pat) {
    localStorage.setItem(GIST_ID_KEY, gistId.trim());
    localStorage.setItem(PAT_KEY, pat.trim());
  }

  function clearCredentials() {
    localStorage.removeItem(GIST_ID_KEY);
    localStorage.removeItem(PAT_KEY);
    _setStatus('idle');
  }

  function _setStatus(status) {
    _status = status;
    if (_onStatusChange) _onStatusChange(status);
  }

  function onStatusChange(cb) {
    _onStatusChange = cb;
  }

  function getStatus() {
    return _status;
  }

  async function gistLoad() {
    const creds = getCredentials();
    if (!creds) return null;

    const res = await fetch(`https://api.github.com/gists/${creds.gistId}`, {
      headers: { Authorization: `Bearer ${creds.pat}` }
    });

    if (!res.ok) throw new Error(`Gist GET falhou: ${res.status}`);

    const data = await res.json();
    const file = data.files[FILENAME];
    if (!file || !file.content) return {};

    return JSON.parse(file.content);
  }

  async function gistSave(state) {
    const creds = getCredentials();
    if (!creds) return;

    state._ts = Date.now();

    const res = await fetch(`https://api.github.com/gists/${creds.gistId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${creds.pat}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        files: { [FILENAME]: { content: JSON.stringify(state) } }
      })
    });

    if (!res.ok) throw new Error(`Gist PATCH falhou: ${res.status}`);
  }

  function gistMerge(local, remote) {
    if (!remote || Object.keys(remote).length === 0) return local;
    if (!local || Object.keys(local).length === 0) return remote;

    const localTs = local._ts || 0;
    const remoteTs = remote._ts || 0;

    return remoteTs > localTs ? remote : local;
  }

  async function testConnection() {
    await gistLoad();
    return true;
  }

  async function syncOnLoad() {
    if (!isConfigured()) return false;

    _setStatus('syncing');
    try {
      const local = JSON.parse(localStorage.getItem('cr2026_todos') || '{}');
      const remote = await gistLoad();
      const merged = gistMerge(local, remote);

      // Salva o estado mergeado localmente (sem _ts no localStorage)
      const toStore = Object.assign({}, merged);
      delete toStore._ts;
      localStorage.setItem('cr2026_todos', JSON.stringify(toStore));

      // Salva no Gist com _ts
      await gistSave(merged);

      _setStatus('synced');
      return true;
    } catch (e) {
      console.error('Sync load falhou:', e);
      _setStatus('error');
      return false;
    }
  }

  function debouncedSave() {
    if (!isConfigured()) return;

    _setStatus('syncing');
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(async () => {
      try {
        const local = JSON.parse(localStorage.getItem('cr2026_todos') || '{}');
        const state = Object.assign({}, local, { _ts: Date.now() });
        await gistSave(state);
        _setStatus('synced');
      } catch (e) {
        console.error('Sync save falhou:', e);
        _setStatus('error');
      }
    }, 2000);
  }

  return {
    isConfigured,
    saveCredentials,
    clearCredentials,
    testConnection,
    syncOnLoad,
    debouncedSave,
    onStatusChange,
    getStatus
  };
})();
