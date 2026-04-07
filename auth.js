/**
 * auth.js — Autenticação Google via Firebase + controle de acesso por email
 *
 * Permissões:
 *   'full'     → acesso total (todos os links e documentos)
 *   'readonly' → visualiza o site, mas links de documentos ficam desabilitados
 *
 * Gestão de usuários:
 *   Usuários com 'full' podem adicionar/remover outros usuários via painel admin.
 *   A whitelist é armazenada no Firestore (coleção 'authorized_users').
 *   Fallback para lista hardcoded caso Firestore esteja indisponível.
 *
 * Uso: incluir Firebase SDK (app + auth + firestore) + este script em cada página HTML
 */
(function () {
  // ╔════════════════════════════════════════════════════════╗
  // ║  CONFIGURAÇÃO — preencha com os dados do seu projeto  ║
  // ╚════════════════════════════════════════════════════════╝
  const FIREBASE_CONFIG = {
    apiKey:            'AIzaSyBbeh2HctomTSJHsGKsECbT_DhCRues6_Y',
    authDomain:        'costa-rica-2026-2cb65.firebaseapp.com',
    projectId:         'costa-rica-2026-2cb65',
    storageBucket:     'costa-rica-2026-2cb65.firebasestorage.app',
    messagingSenderId: '383883760273',
    appId:             '1:383883760273:web:54c823740ed03dd07fa530'
  };

  // ╔════════════════════════════════════════════════════════╗
  // ║  WHITELIST FALLBACK — usado se Firestore indisponível ║
  // ╚════════════════════════════════════════════════════════╝
  const FALLBACK_USERS = {
    'saulomed@gmail.com':              'full',
    'lorenatablada@gmail.com':         'full',
    'devcansadosaulo@gmail.com':       'readonly',
    'wifesa@gmail.com':                'readonly',
    'victormop10@gmail.com':           'readonly',
    'micheledevasconcelos@gmail.com':  'readonly',
    'ricardoteix@gmail.com':           'readonly'
  };

  // ── Padrões de links restritos para 'readonly' ──
  const RESTRICTED_PATTERNS = [
    /^documentos\//,
    /drive\.google\.com/,
    /docs\.google\.com/,
    /notion\.so/
  ];

  // ── Estado ──
  let currentUser = null;
  let currentPermission = null;
  let allowedUsers = Object.assign({}, FALLBACK_USERS);
  let firestoreAvailable = false;
  let db = null;

  // ══════════════════════════════════════════════════════
  //  INICIALIZAÇÃO
  // ══════════════════════════════════════════════════════
  function init() {
    if (typeof firebase === 'undefined') {
      console.error('[auth] Firebase SDK não carregado');
      return;
    }

    // Inicializa Firebase (evita duplicata)
    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }

    // Inicializa Firestore se disponível
    if (typeof firebase.firestore === 'function') {
      db = firebase.firestore();
      firestoreAvailable = true;
    }

    injectStyles();
    createOverlay();

    // Carrega usuários do Firestore e depois escuta auth
    loadUsersFromFirestore().then(function () {
      firebase.auth().onAuthStateChanged(function (user) {
        if (user) {
          handleSignedIn(user);
        } else {
          showLogin();
        }
      });
    });
  }

  // ══════════════════════════════════════════════════════
  //  FIRESTORE — GESTÃO DE USUÁRIOS
  // ══════════════════════════════════════════════════════
  function loadUsersFromFirestore() {
    if (!firestoreAvailable) return Promise.resolve();

    return db.collection('authorized_users').get()
      .then(function (snapshot) {
        if (snapshot.empty) {
          // Primeira vez: popula Firestore com a lista fallback
          return seedFirestoreUsers();
        }
        // Carrega usuários do Firestore
        allowedUsers = {};
        snapshot.forEach(function (doc) {
          var data = doc.data();
          allowedUsers[doc.id] = data.permission || 'readonly';
        });
      })
      .catch(function (err) {
        console.warn('[auth] Firestore indisponível, usando lista local:', err.message);
        firestoreAvailable = false;
      });
  }

  function seedFirestoreUsers() {
    var batch = db.batch();
    Object.keys(FALLBACK_USERS).forEach(function (email) {
      var ref = db.collection('authorized_users').doc(email);
      batch.set(ref, {
        permission: FALLBACK_USERS[email],
        addedBy: 'system',
        addedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    return batch.commit().then(function () {
      allowedUsers = Object.assign({}, FALLBACK_USERS);
    });
  }

  function addUserToFirestore(email, permission) {
    if (!firestoreAvailable) return Promise.reject(new Error('Firestore indisponível'));
    var ref = db.collection('authorized_users').doc(email);
    return ref.set({
      permission: permission,
      addedBy: currentUser.email,
      addedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      allowedUsers[email] = permission;
    });
  }

  function updateUserInFirestore(email, permission) {
    if (!firestoreAvailable) return Promise.reject(new Error('Firestore indisponível'));
    var ref = db.collection('authorized_users').doc(email);
    return ref.update({
      permission: permission,
      updatedBy: currentUser.email,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      allowedUsers[email] = permission;
    });
  }

  function removeUserFromFirestore(email) {
    if (!firestoreAvailable) return Promise.reject(new Error('Firestore indisponível'));
    var ref = db.collection('authorized_users').doc(email);
    return ref.delete().then(function () {
      delete allowedUsers[email];
    });
  }

  // ══════════════════════════════════════════════════════
  //  AUTH HANDLERS
  // ══════════════════════════════════════════════════════
  function handleSignedIn(user) {
    var email = user.email.toLowerCase();
    var permission = allowedUsers[email];

    if (!permission) {
      showAccessDenied(email);
      return;
    }

    currentUser = user;
    currentPermission = permission;

    // Libera o conteúdo
    document.body.classList.remove('auth-pending');
    document.body.classList.add('auth-ready');
    document.body.setAttribute('data-auth-level', permission);

    // Atualiza overlay para user bar
    showUserBar(user, permission);

    // Aplica restrições para readonly
    if (permission === 'readonly') {
      applyReadonlyRestrictions();
    }
  }

  function signIn() {
    var provider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().signInWithPopup(provider).catch(function (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        console.error('[auth] Erro no login:', err);
        var errEl = document.getElementById('auth-error');
        if (errEl) errEl.textContent = 'Erro ao fazer login. Tente novamente.';
      }
    });
  }

  function signOut() {
    firebase.auth().signOut().then(function () {
      currentUser = null;
      currentPermission = null;
      document.body.classList.add('auth-pending');
      document.body.classList.remove('auth-ready');
      document.body.removeAttribute('data-auth-level');
      showLogin();
    });
  }

  // ══════════════════════════════════════════════════════
  //  RESTRIÇÕES PARA READONLY
  // ══════════════════════════════════════════════════════
  function applyReadonlyRestrictions() {
    var links = document.querySelectorAll('a[href]');
    links.forEach(function (a) {
      var href = a.getAttribute('href') || '';
      var isRestricted = RESTRICTED_PATTERNS.some(function (pattern) {
        return pattern.test(href);
      });

      if (isRestricted) {
        a.classList.add('auth-restricted-link');
        a.setAttribute('data-original-href', href);
        a.removeAttribute('href');
        a.setAttribute('tabindex', '-1');
        a.title = 'Acesso restrito — somente visualização';
        a.addEventListener('click', function (e) {
          e.preventDefault();
          showRestrictedToast();
        });
      }
    });
  }

  var toastTimeout = null;
  function showRestrictedToast() {
    var existing = document.getElementById('auth-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id = 'auth-toast';
    toast.textContent = '🔒 Acesso restrito — você está no modo somente leitura';
    document.body.appendChild(toast);

    clearTimeout(toastTimeout);
    requestAnimationFrame(function () { toast.classList.add('visible'); });
    toastTimeout = setTimeout(function () {
      toast.classList.remove('visible');
      setTimeout(function () { toast.remove(); }, 300);
    }, 3000);
  }

  // ══════════════════════════════════════════════════════
  //  UI — OVERLAY DE LOGIN
  // ══════════════════════════════════════════════════════
  function createOverlay() {
    var overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.innerHTML =
      '<div class="auth-card">' +
        '<div class="auth-logo">🌿</div>' +
        '<h1 class="auth-title">Costa Rica 2026</h1>' +
        '<p class="auth-subtitle">Saulo & Lorena</p>' +
        '<p class="auth-desc">Faça login com sua conta Google para acessar o roteiro.</p>' +
        '<button id="auth-google-btn" class="auth-google-btn">' +
          '<svg class="auth-google-icon" viewBox="0 0 24 24" width="20" height="20">' +
            '<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>' +
            '<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>' +
            '<path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>' +
            '<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>' +
          '</svg>' +
          'Entrar com Google' +
        '</button>' +
        '<p id="auth-error" class="auth-error"></p>' +
        '<div id="auth-denied" class="auth-denied" style="display:none">' +
          '<p class="auth-denied-msg">⛔ Acesso não autorizado</p>' +
          '<p class="auth-denied-email"></p>' +
          '<button class="auth-try-again">Tentar com outra conta</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    document.getElementById('auth-google-btn').addEventListener('click', signIn);
  }

  function showLogin() {
    var overlay = document.getElementById('auth-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    overlay.querySelector('.auth-card').style.display = '';
    overlay.querySelector('#auth-denied').style.display = 'none';
    overlay.querySelector('#auth-google-btn').style.display = '';
    overlay.querySelector('#auth-error').textContent = '';
    // Remove user bar se existir
    var bar = document.getElementById('auth-user-bar');
    if (bar) bar.remove();
    // Remove admin panel se existir
    var panel = document.getElementById('admin-panel');
    if (panel) panel.remove();
  }

  function showAccessDenied(email) {
    var overlay = document.getElementById('auth-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    document.body.classList.add('auth-pending');
    document.body.classList.remove('auth-ready');

    overlay.querySelector('#auth-google-btn').style.display = 'none';
    overlay.querySelector('.auth-desc').style.display = 'none';
    var denied = overlay.querySelector('#auth-denied');
    denied.style.display = '';
    denied.querySelector('.auth-denied-email').textContent = email;
    denied.querySelector('.auth-try-again').onclick = function () {
      firebase.auth().signOut().then(function () { showLogin(); });
    };
  }

  function showUserBar(user, permission) {
    var overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.style.display = 'none';

    // Remove bar existente
    var existing = document.getElementById('auth-user-bar');
    if (existing) existing.remove();

    var label = permission === 'full' ? 'Acesso total' : 'Somente leitura';
    var badge = permission === 'full'
      ? '<span class="auth-badge auth-badge-full">🔓 ' + label + '</span>'
      : '<span class="auth-badge auth-badge-readonly">👁️ ' + label + '</span>';

    var adminBtn = permission === 'full' && firestoreAvailable
      ? '<button class="auth-admin-btn" title="Gerenciar usuários">👥</button>'
      : '';

    var bar = document.createElement('div');
    bar.id = 'auth-user-bar';
    bar.innerHTML =
      '<div class="auth-bar-inner">' +
        '<img class="auth-avatar" src="' + (user.photoURL || '') + '" alt="" referrerpolicy="no-referrer">' +
        '<span class="auth-bar-name">' + (user.displayName || user.email) + '</span>' +
        badge +
        adminBtn +
        '<button class="auth-logout-btn" title="Sair">Sair</button>' +
      '</div>';

    document.body.appendChild(bar);
    bar.querySelector('.auth-logout-btn').addEventListener('click', signOut);

    var adminBtnEl = bar.querySelector('.auth-admin-btn');
    if (adminBtnEl) {
      adminBtnEl.addEventListener('click', toggleAdminPanel);
    }
  }

  // ══════════════════════════════════════════════════════
  //  PAINEL DE ADMINISTRAÇÃO DE USUÁRIOS
  // ══════════════════════════════════════════════════════
  function toggleAdminPanel() {
    var existing = document.getElementById('admin-panel');
    if (existing) {
      existing.remove();
      return;
    }
    createAdminPanel();
  }

  function createAdminPanel() {
    var panel = document.createElement('div');
    panel.id = 'admin-panel';

    var html =
      '<div class="admin-panel-inner">' +
        '<div class="admin-header">' +
          '<h2 class="admin-title">Gerenciar Usuários</h2>' +
          '<button class="admin-close-btn" title="Fechar">&times;</button>' +
        '</div>' +
        '<div class="admin-add-form">' +
          '<input type="email" id="admin-email-input" class="admin-input" placeholder="email@exemplo.com">' +
          '<select id="admin-permission-select" class="admin-select">' +
            '<option value="readonly">Somente leitura</option>' +
            '<option value="full">Acesso total</option>' +
          '</select>' +
          '<button id="admin-add-btn" class="admin-add-btn">Adicionar</button>' +
        '</div>' +
        '<p id="admin-feedback" class="admin-feedback"></p>' +
        '<div class="admin-user-list" id="admin-user-list"></div>' +
      '</div>';

    panel.innerHTML = html;
    document.body.appendChild(panel);

    panel.querySelector('.admin-close-btn').addEventListener('click', function () {
      panel.remove();
    });

    document.getElementById('admin-add-btn').addEventListener('click', handleAddUser);
    document.getElementById('admin-email-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') handleAddUser();
    });

    renderUserList();
  }

  function renderUserList() {
    var container = document.getElementById('admin-user-list');
    if (!container) return;

    var emails = Object.keys(allowedUsers).sort();
    var html = '';

    emails.forEach(function (email) {
      var perm = allowedUsers[email];
      var isSelf = currentUser && email === currentUser.email.toLowerCase();
      var permLabel = perm === 'full' ? 'Acesso total' : 'Somente leitura';
      var permClass = perm === 'full' ? 'admin-perm-full' : 'admin-perm-readonly';

      html +=
        '<div class="admin-user-row" data-email="' + email + '">' +
          '<div class="admin-user-info">' +
            '<span class="admin-user-email">' + email + (isSelf ? ' (você)' : '') + '</span>' +
            '<span class="admin-user-perm ' + permClass + '">' + permLabel + '</span>' +
          '</div>' +
          '<div class="admin-user-actions">' +
            (isSelf ? '' :
              '<select class="admin-change-perm" data-email="' + email + '">' +
                '<option value="readonly"' + (perm === 'readonly' ? ' selected' : '') + '>Somente leitura</option>' +
                '<option value="full"' + (perm === 'full' ? ' selected' : '') + '>Acesso total</option>' +
              '</select>' +
              '<button class="admin-remove-btn" data-email="' + email + '" title="Remover usuário">🗑️</button>'
            ) +
          '</div>' +
        '</div>';
    });

    container.innerHTML = html;

    // Bind change permission events
    container.querySelectorAll('.admin-change-perm').forEach(function (select) {
      select.addEventListener('change', function () {
        var email = this.getAttribute('data-email');
        var newPerm = this.value;
        showAdminFeedback('Atualizando...', 'info');
        updateUserInFirestore(email, newPerm).then(function () {
          showAdminFeedback('Permissão de ' + email + ' atualizada para "' + (newPerm === 'full' ? 'Acesso total' : 'Somente leitura') + '"', 'success');
          renderUserList();
        }).catch(function (err) {
          showAdminFeedback('Erro ao atualizar: ' + err.message, 'error');
        });
      });
    });

    // Bind remove events
    container.querySelectorAll('.admin-remove-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var email = this.getAttribute('data-email');
        if (!confirm('Remover acesso de ' + email + '?')) return;
        showAdminFeedback('Removendo...', 'info');
        removeUserFromFirestore(email).then(function () {
          showAdminFeedback(email + ' removido com sucesso', 'success');
          renderUserList();
        }).catch(function (err) {
          showAdminFeedback('Erro ao remover: ' + err.message, 'error');
        });
      });
    });
  }

  function handleAddUser() {
    var emailInput = document.getElementById('admin-email-input');
    var permSelect = document.getElementById('admin-permission-select');
    var email = (emailInput.value || '').trim().toLowerCase();
    var permission = permSelect.value;

    if (!email) {
      showAdminFeedback('Digite um email válido', 'error');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showAdminFeedback('Formato de email inválido', 'error');
      return;
    }

    if (allowedUsers[email]) {
      showAdminFeedback('Este email já está cadastrado', 'error');
      return;
    }

    showAdminFeedback('Adicionando...', 'info');
    addUserToFirestore(email, permission).then(function () {
      emailInput.value = '';
      var permLabel = permission === 'full' ? 'Acesso total' : 'Somente leitura';
      showAdminFeedback(email + ' adicionado com "' + permLabel + '"', 'success');
      renderUserList();
    }).catch(function (err) {
      showAdminFeedback('Erro ao adicionar: ' + err.message, 'error');
    });
  }

  function showAdminFeedback(msg, type) {
    var el = document.getElementById('admin-feedback');
    if (!el) return;
    el.textContent = msg;
    el.className = 'admin-feedback admin-feedback-' + type;
  }

  // ══════════════════════════════════════════════════════
  //  ESTILOS
  // ══════════════════════════════════════════════════════
  function injectStyles() {
    var css =
      /* Gate — esconde conteúdo enquanto auth não resolve */
      'body.auth-pending > *:not(#auth-overlay):not(#auth-user-bar) {' +
        'display: none !important;' +
      '}' +

      /* Overlay */
      '#auth-overlay {' +
        'position: fixed; inset: 0; z-index: 99999;' +
        'display: flex; align-items: center; justify-content: center;' +
        'background: linear-gradient(135deg, #1a3a2a 0%, #2d5a3f 50%, #3d7a5a 100%);' +
        'font-family: "DM Sans", sans-serif;' +
      '}' +

      '.auth-card {' +
        'background: #fefdfb; border-radius: 20px; padding: 3rem 2.5rem;' +
        'text-align: center; max-width: 400px; width: 90%;' +
        'box-shadow: 0 20px 60px rgba(0,0,0,0.3);' +
      '}' +

      '.auth-logo { font-size: 3rem; margin-bottom: 0.5rem; }' +

      '.auth-title {' +
        'font-family: "Playfair Display", serif; font-size: 1.8rem;' +
        'color: #1a3a2a; margin: 0 0 0.25rem;' +
      '}' +

      '.auth-subtitle {' +
        'color: #6b6560; font-size: 1rem; margin: 0 0 1.5rem;' +
      '}' +

      '.auth-desc {' +
        'color: #6b6560; font-size: 0.9rem; margin: 0 0 1.5rem; line-height: 1.5;' +
      '}' +

      '.auth-google-btn {' +
        'display: inline-flex; align-items: center; gap: 0.75rem;' +
        'background: #fff; color: #3c4043; border: 1px solid #dadce0;' +
        'border-radius: 8px; padding: 0.75rem 1.5rem; font-size: 0.95rem;' +
        'font-family: "DM Sans", sans-serif; font-weight: 500;' +
        'cursor: pointer; transition: all 0.2s;' +
        'box-shadow: 0 1px 3px rgba(0,0,0,0.08);' +
      '}' +

      '.auth-google-btn:hover {' +
        'background: #f7f8f8; box-shadow: 0 2px 8px rgba(0,0,0,0.12);' +
      '}' +

      '.auth-google-icon { flex-shrink: 0; }' +

      '.auth-error { color: #e85d3a; font-size: 0.85rem; margin-top: 1rem; min-height: 1.2em; }' +

      '.auth-denied-msg {' +
        'color: #e85d3a; font-weight: 600; font-size: 1.1rem; margin: 0 0 0.5rem;' +
      '}' +

      '.auth-denied-email {' +
        'color: #6b6560; font-size: 0.85rem; margin: 0 0 1.25rem;' +
        'word-break: break-all;' +
      '}' +

      '.auth-try-again {' +
        'background: #1a3a2a; color: #fff; border: none; border-radius: 8px;' +
        'padding: 0.6rem 1.25rem; font-size: 0.9rem; cursor: pointer;' +
        'font-family: "DM Sans", sans-serif; transition: background 0.2s;' +
      '}' +
      '.auth-try-again:hover { background: #2d5a3f; }' +

      /* User bar */
      '#auth-user-bar {' +
        'position: fixed; top: 0; right: 0; z-index: 9999;' +
        'padding: 0.5rem 1rem;' +
      '}' +

      '.auth-bar-inner {' +
        'display: flex; align-items: center; gap: 0.5rem;' +
        'background: rgba(26,58,42,0.92); backdrop-filter: blur(8px);' +
        'border-radius: 50px; padding: 0.35rem 0.75rem;' +
        'font-family: "DM Sans", sans-serif; font-size: 0.8rem; color: #fefdfb;' +
        'box-shadow: 0 2px 12px rgba(0,0,0,0.2);' +
      '}' +

      '.auth-avatar {' +
        'width: 24px; height: 24px; border-radius: 50%;' +
        'border: 1.5px solid rgba(255,255,255,0.3);' +
      '}' +

      '.auth-bar-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }' +

      '.auth-badge {' +
        'font-size: 0.7rem; padding: 0.15rem 0.5rem; border-radius: 50px; font-weight: 500;' +
      '}' +
      '.auth-badge-full { background: rgba(92,168,122,0.3); color: #a8e6c3; }' +
      '.auth-badge-readonly { background: rgba(212,168,67,0.3); color: #f5e6c8; }' +

      '.auth-admin-btn {' +
        'background: rgba(255,255,255,0.15); border: none; color: #fefdfb;' +
        'border-radius: 50px; padding: 0.2rem 0.5rem; font-size: 0.8rem;' +
        'cursor: pointer; transition: background 0.2s; line-height: 1;' +
      '}' +
      '.auth-admin-btn:hover { background: rgba(255,255,255,0.3); }' +

      '.auth-logout-btn {' +
        'background: rgba(255,255,255,0.15); border: none; color: #fefdfb;' +
        'border-radius: 50px; padding: 0.2rem 0.6rem; font-size: 0.75rem;' +
        'cursor: pointer; font-family: "DM Sans", sans-serif; transition: background 0.2s;' +
      '}' +
      '.auth-logout-btn:hover { background: rgba(255,255,255,0.25); }' +

      /* Links restritos */
      '.auth-restricted-link {' +
        'opacity: 0.4 !important; cursor: not-allowed !important;' +
        'text-decoration: line-through !important; pointer-events: auto;' +
      '}' +

      /* Toast */
      '#auth-toast {' +
        'position: fixed; bottom: 2rem; left: 50%; transform: translateX(-50%) translateY(20px);' +
        'background: rgba(26,58,42,0.95); color: #fefdfb; padding: 0.75rem 1.5rem;' +
        'border-radius: 50px; font-family: "DM Sans", sans-serif; font-size: 0.85rem;' +
        'z-index: 99998; opacity: 0; transition: all 0.3s ease;' +
        'box-shadow: 0 4px 20px rgba(0,0,0,0.3);' +
      '}' +
      '#auth-toast.visible { opacity: 1; transform: translateX(-50%) translateY(0); }' +

      /* ── Admin Panel ── */
      '#admin-panel {' +
        'position: fixed; top: 3.5rem; right: 1rem; z-index: 99998;' +
        'font-family: "DM Sans", sans-serif;' +
      '}' +

      '.admin-panel-inner {' +
        'background: #fefdfb; border-radius: 16px; padding: 1.5rem;' +
        'width: 380px; max-width: calc(100vw - 2rem);' +
        'max-height: calc(100vh - 5rem); overflow-y: auto;' +
        'box-shadow: 0 8px 40px rgba(0,0,0,0.25);' +
        'border: 1px solid rgba(26,58,42,0.1);' +
      '}' +

      '.admin-header {' +
        'display: flex; justify-content: space-between; align-items: center;' +
        'margin-bottom: 1rem; padding-bottom: 0.75rem;' +
        'border-bottom: 1px solid #e8e5e1;' +
      '}' +

      '.admin-title {' +
        'font-family: "Playfair Display", serif; font-size: 1.1rem;' +
        'color: #1a3a2a; margin: 0;' +
      '}' +

      '.admin-close-btn {' +
        'background: none; border: none; font-size: 1.4rem; color: #6b6560;' +
        'cursor: pointer; padding: 0 0.25rem; line-height: 1;' +
      '}' +
      '.admin-close-btn:hover { color: #1a3a2a; }' +

      '.admin-add-form {' +
        'display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.5rem;' +
      '}' +

      '.admin-input {' +
        'flex: 1; min-width: 150px; padding: 0.5rem 0.75rem; border: 1px solid #dadce0;' +
        'border-radius: 8px; font-size: 0.85rem; font-family: "DM Sans", sans-serif;' +
        'outline: none; transition: border-color 0.2s;' +
      '}' +
      '.admin-input:focus { border-color: #2d5a3f; }' +

      '.admin-select {' +
        'padding: 0.5rem 0.5rem; border: 1px solid #dadce0; border-radius: 8px;' +
        'font-size: 0.8rem; font-family: "DM Sans", sans-serif;' +
        'background: #fff; cursor: pointer; outline: none;' +
      '}' +

      '.admin-add-btn {' +
        'background: #1a3a2a; color: #fff; border: none; border-radius: 8px;' +
        'padding: 0.5rem 1rem; font-size: 0.85rem; cursor: pointer;' +
        'font-family: "DM Sans", sans-serif; font-weight: 500; transition: background 0.2s;' +
      '}' +
      '.admin-add-btn:hover { background: #2d5a3f; }' +

      '.admin-feedback {' +
        'font-size: 0.8rem; margin: 0.25rem 0 0.75rem; min-height: 1.2em;' +
      '}' +
      '.admin-feedback-success { color: #2d7a4f; }' +
      '.admin-feedback-error { color: #e85d3a; }' +
      '.admin-feedback-info { color: #6b6560; }' +

      '.admin-user-list {' +
        'display: flex; flex-direction: column; gap: 0.5rem;' +
      '}' +

      '.admin-user-row {' +
        'display: flex; justify-content: space-between; align-items: center;' +
        'padding: 0.6rem 0.75rem; background: #f8f7f5; border-radius: 10px;' +
        'gap: 0.5rem;' +
      '}' +

      '.admin-user-info {' +
        'display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; flex: 1;' +
      '}' +

      '.admin-user-email {' +
        'font-size: 0.8rem; color: #1a3a2a; font-weight: 500;' +
        'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' +
      '}' +

      '.admin-user-perm {' +
        'font-size: 0.7rem; font-weight: 500;' +
      '}' +
      '.admin-perm-full { color: #2d7a4f; }' +
      '.admin-perm-readonly { color: #b08a2e; }' +

      '.admin-user-actions {' +
        'display: flex; align-items: center; gap: 0.35rem; flex-shrink: 0;' +
      '}' +

      '.admin-change-perm {' +
        'padding: 0.25rem 0.35rem; border: 1px solid #dadce0; border-radius: 6px;' +
        'font-size: 0.7rem; font-family: "DM Sans", sans-serif;' +
        'background: #fff; cursor: pointer; outline: none;' +
      '}' +

      '.admin-remove-btn {' +
        'background: none; border: none; font-size: 0.85rem; cursor: pointer;' +
        'padding: 0.15rem 0.3rem; border-radius: 6px; transition: background 0.2s;' +
        'line-height: 1;' +
      '}' +
      '.admin-remove-btn:hover { background: rgba(232,93,58,0.1); }' +

      /* Mobile */
      '@media (max-width: 600px) {' +
        '.auth-bar-name { display: none; }' +
        '.auth-card { padding: 2rem 1.5rem; }' +
        '#admin-panel { top: 3.5rem; right: 0.5rem; left: 0.5rem; }' +
        '.admin-panel-inner { width: auto; }' +
      '}';

    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── Inicializar ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // API pública
  window.CostaRicaAuth = {
    getUser: function () { return currentUser; },
    getPermission: function () { return currentPermission; },
    signOut: signOut
  };
})();
