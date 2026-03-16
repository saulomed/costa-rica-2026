// ─── GIST SYNC MODULE ───
// Sincroniza estado completo (TODOs + bookings + car) via GitHub Gist privado

const GistSync = (() => {
  const GIST_ID_KEY = 'cr2026_gist_id';
  const PAT_KEY = 'cr2026_gist_pat';
  const FILENAME = 'cr2026-state.json';

  // Todas as keys do localStorage que devem ser sincronizadas
  const SYNC_KEYS = ['cr2026_todos', 'cr2026_bookings', 'cr2026_car_booking'];

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

  // Coleta todos os dados locais num único objeto
  function _getLocalState() {
    const state = {};
    SYNC_KEYS.forEach(key => {
      try {
        const raw = localStorage.getItem(key);
        if (raw) state[key] = JSON.parse(raw);
      } catch {}
    });
    return state;
  }

  // Aplica o estado remoto no localStorage
  function _applyState(state) {
    SYNC_KEYS.forEach(key => {
      if (state[key] !== undefined && state[key] !== null) {
        localStorage.setItem(key, JSON.stringify(state[key]));
      }
    });
  }

  // Migra formato antigo (flat: {todoId: true, _ts}) → novo ({cr2026_todos: {...}, _ts})
  function _migrateFormat(data) {
    if (!data || typeof data !== 'object') return data;
    // Se já tem alguma SYNC_KEY, está no formato novo
    if (SYNC_KEYS.some(k => data[k] !== undefined)) return data;
    // Se está vazio ou só tem _ts, nada a migrar
    const keys = Object.keys(data).filter(k => k !== '_ts');
    if (keys.length === 0) return data;
    // Formato antigo: todo IDs flat no topo → mover para cr2026_todos
    const todos = {};
    keys.forEach(k => { todos[k] = data[k]; });
    return { cr2026_todos: todos, _ts: data._ts || 0 };
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

    const parsed = JSON.parse(file.content);
    return _migrateFormat(parsed);
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
      const local = _getLocalState();
      local._ts = local._ts || 0;
      const remote = await gistLoad();
      const merged = gistMerge(local, remote);

      // Aplica o estado mergeado no localStorage
      _applyState(merged);

      // Salva no Gist no formato novo (garante migração)
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
        const state = _getLocalState();
        state._ts = Date.now();
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
