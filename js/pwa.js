/* ══════════════════════════════════════════════════════
   Cabinet de Psychothérapie — pwa.js
   Progressive Web App : service worker, installation, mises à jour.
   Dépend de : utils.js (toast)
   ══════════════════════════════════════════════════════ */

'use strict';

let _swReg            = null;   // ServiceWorkerRegistration
let _installPrompt    = null;   // événement beforeinstallprompt différé
let _swVersion        = '';     // version du cache actif (affichage paramètres)
let _updateReady      = false;  // un nouveau SW attend l'accord de l'utilisateur
let _reloadingForSw   = false;  // évite les boucles de rechargement


// ── Détection du contexte ──────────────────────────────
function pwaIsStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
function pwaIsIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function pwaBrowser() {
  const ua = navigator.userAgent;
  if (/firefox|fxios/i.test(ua)) return 'firefox';
  if (/edg\//i.test(ua))        return 'edge';
  if (/chrome|chromium|crios/i.test(ua)) return 'chrome';
  if (/safari/i.test(ua))        return 'safari';
  return 'autre';
}
function pwaSecureOrigin() {
  return location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}
function pwaSwSupported() {
  // Les service workers exigent HTTPS (ou localhost)
  return 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
}


// ── Initialisation (appelée par main.js) ───────────────
function initPwa() {
  // Invitation à installer (Chrome, Edge, Android…)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _installPrompt = e;
    renderPwaStatus();
  });
  window.addEventListener('appinstalled', () => {
    _installPrompt = null;
    toast('Application installée ✓', 'success');
    renderPwaStatus();
  });

  // Mode hors connexion : simple information, les données sont locales
  window.addEventListener('offline', () => toast('Hors connexion — vos données restent disponibles'));
  window.addEventListener('online',  () => toast('Connexion rétablie', 'success'));

  if (!pwaSwSupported()) { renderPwaStatus(); return; }

  // Quand un nouveau SW prend le contrôle (après acceptation), on recharge une seule fois
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (_reloadingForSw) return;
    _reloadingForSw = true;
    location.reload();
  });

  navigator.serviceWorker.register('sw.js').then((reg) => {
    _swReg = reg;

    // Un SW déjà en attente (mise à jour téléchargée lors d'une visite précédente)
    if (reg.waiting && navigator.serviceWorker.controller) _flagUpdate();

    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) _flagUpdate();
        if (nw.state === 'activated') void _readSwVersion();
      });
    });

    // Recherche périodique de mise à jour (app laissée ouverte longtemps) + au retour au premier plan
    setInterval(() => { void reg.update().catch(() => {}); }, 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void reg.update().catch(() => {});
    });

    navigator.serviceWorker.ready.then(() => { void _readSwVersion(); renderPwaStatus(); });
  }).catch((err) => {
    console.warn('[Cabinet] Service worker non enregistré :', err);
    renderPwaStatus();
  });

  renderPwaStatus();
}


// ── Version du cache actif ─────────────────────────────
async function _readSwVersion() {
  try {
    const sw = _swReg && (_swReg.active || navigator.serviceWorker.controller);
    if (!sw) return;
    _swVersion = await new Promise((resolve) => {
      const ch = new MessageChannel();
      const t  = setTimeout(() => resolve(''), 1500);
      ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data && e.data.version || ''); };
      sw.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
    });
    renderPwaStatus();
  } catch (e) { /* non bloquant */ }
}


// ── Mise à jour ────────────────────────────────────────
function _flagUpdate() {
  _updateReady = true;
  showUpdateBar();
  renderPwaStatus();
}

function showUpdateBar() {
  if (document.getElementById('pwa-update-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'pwa-update-bar';
  bar.setAttribute('role', 'status');

  const msg = document.createElement('span');
  msg.textContent = 'Une nouvelle version est disponible.';

  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'btn btn-primary btn-sm';
  ok.textContent = 'Mettre à jour';
  ok.addEventListener('click', applyUpdate);

  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'btn btn-secondary btn-sm';
  later.textContent = 'Plus tard';
  later.addEventListener('click', () => bar.remove());

  bar.append(msg, ok, later);
  document.body.appendChild(bar);
}

function applyUpdate() {
  const w = _swReg && _swReg.waiting;
  if (!w) { location.reload(); return; }
  // Le rechargement verrouille le coffre chiffré (la phrase secrète sera redemandée)
  w.postMessage({ type: 'SKIP_WAITING' });
}


// ── Installation ───────────────────────────────────────
async function pwaInstall() {
  if (!_installPrompt) return;
  _installPrompt.prompt();
  try { await _installPrompt.userChoice; } catch (e) {}
  _installPrompt = null;
  renderPwaStatus();
}


// ── Bloc « Application » dans les paramètres ───────────
function renderPwaStatus() {
  const box = document.getElementById('pwa-status-box');
  if (!box) return;

  const rows = [];

  // 1. Installation
  const P = '<p style="font-size:13px;color:var(--warm-mid);line-height:1.6;">';
  const br = pwaBrowser();
  if (pwaIsStandalone()) {
    rows.push('<div class="info-box sage" style="margin-bottom:.6rem;"><strong>✓ Application installée</strong> — vous l\'utilisez en mode application.</div>');
  } else if (_installPrompt) {
    rows.push(P + 'Installez l\'application sur cet appareil pour la lancer comme une application classique, en plein écran et sans barre de navigateur.</p>' +
              '<button type="button" class="btn btn-primary btn-sm" id="pwa-install-btn">⬇ Installer l\'application</button>');
  } else if (location.protocol === 'file:') {
    rows.push(P + 'L’application est ouverte depuis un fichier local : elle fonctionne déjà sans connexion Internet. L’installation en tant qu’application (icône dédiée, mises à jour automatiques) n’est possible que si elle est hébergée en HTTPS — ce n’est pas nécessaire pour l’usage actuel.</p>');
  } else if (!pwaSecureOrigin()) {
    rows.push('<div class="info-box terra" style="margin-bottom:0;"><strong>⚠ Installation impossible depuis cette adresse.</strong><br>' +
              'La page est ouverte en <code>' + location.protocol + '//</code>. Une application ne peut être installée que si elle est servie en <strong>HTTPS</strong> (ou via <code>localhost</code>). ' +
              'Hébergez le dossier (GitHub Pages, Netlify…) puis ouvrez l\'adresse <code>https://…</code>.</div>');
  } else if (pwaIsIOS()) {
    rows.push(P + 'Pour installer sur iPhone / iPad : ouvrez cette page dans <strong>Safari</strong>, touchez <strong>Partager</strong> (carré avec une flèche), puis <strong>« Sur l\'écran d\'accueil »</strong>.</p>');
  } else if (br === 'firefox') {
    rows.push(P + '<strong>Firefox sur ordinateur ne permet pas d\'installer les applications web.</strong> Ouvrez cette adresse dans <strong>Chrome</strong> ou <strong>Edge</strong> pour l\'installer.</p>');
  } else if (br === 'safari') {
    rows.push(P + 'Dans Safari (macOS) : menu <strong>Fichier → Ajouter au Dock</strong>.</p>');
  } else if (br === 'edge') {
    rows.push(P + 'Le navigateur ne propose pas encore l\'installation automatiquement. Dans Edge : icône d\'installation à droite de la barre d\'adresse, ou menu <strong>⋯ → Applications → Installer ce site en tant qu\'application</strong>.<br><span style="font-size:12px;">Si l\'application est déjà installée sur cet ordinateur, Edge ne la propose plus : cherchez-la dans le menu Démarrer.</span></p>');
  } else {
    rows.push(P + 'Le navigateur ne propose pas encore l\'installation automatiquement. Dans Chrome : icône d\'installation (écran avec une flèche) à droite de la barre d\'adresse, ou menu <strong>⋮ → Enregistrer et partager → Installer la page en tant qu\'application</strong>.<br><span style="font-size:12px;">Si l\'application est déjà installée sur cet ordinateur, Chrome ne la propose plus : cherchez-la dans le menu Démarrer.</span></p>');
  }

  // 2. Hors connexion
  let offline;
  if (location.protocol === 'file:') {
    offline = '<span style="color:var(--sage-dark);">✓ Fonctionne hors connexion (fichiers locaux)</span>';
  } else if (!pwaSwSupported()) {
    offline = '<span style="color:var(--warm-mid);">Mode hors connexion indisponible : l\'application doit être ouverte en HTTPS.</span>';
  } else if (_swReg && (_swReg.active || navigator.serviceWorker.controller)) {
    offline = '<span style="color:var(--sage-dark);">✓ Disponible hors connexion</span>' + (_swVersion ? ' <span style="color:var(--warm-light);">· version ' + _swVersion + '</span>' : '');
  } else {
    offline = '<span style="color:var(--warm-mid);">Préparation du mode hors connexion…</span>';
  }
  rows.push('<div style="font-size:12px;margin-top:.75rem;">' + offline + '</div>');

  // 3. Mise à jour
  if (_updateReady) {
    rows.push('<div style="margin-top:.6rem;"><button type="button" class="btn btn-primary btn-sm" id="pwa-update-btn">↻ Installer la mise à jour</button></div>');
  } else if (_swReg) {
    rows.push('<div style="margin-top:.6rem;"><button type="button" class="btn btn-secondary btn-sm" id="pwa-check-btn">Rechercher une mise à jour</button></div>');
  }

  box.innerHTML = rows.join('');

  const bi = document.getElementById('pwa-install-btn');
  if (bi) bi.addEventListener('click', pwaInstall);
  const bu = document.getElementById('pwa-update-btn');
  if (bu) bu.addEventListener('click', applyUpdate);
  const bc = document.getElementById('pwa-check-btn');
  if (bc) bc.addEventListener('click', async () => {
    try {
      await _swReg.update();
      if (_updateReady) return;
      if (_swReg.installing || _swReg.waiting) toast('Nouvelle version en cours de téléchargement…');
      else toast('Vous utilisez la dernière version ✓', 'success');
    } catch (e) {
      toast('Impossible de vérifier (hors connexion ?)', 'danger');
    }
  });
}
