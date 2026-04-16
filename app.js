/* ══════════════════════════════════════════════════════
   Cabinet de Psychothérapie — app.js
   ══════════════════════════════════════════════════════ */

'use strict';


// ════════════════════════════════════════════════════════
// DONNÉES & PERSISTANCE
// DB  → IndexedDB  (aucune limite pratique de taille)
// CFG → localStorage (léger, chargé en sync au démarrage)
// ════════════════════════════════════════════════════════

let DB = {
  patients:                [],
  seances:                 [],
  factures:                [],
  nextNum:                 1,
  indisponibilites:        [],
  indisponibilites_regles: []
};

let CFG = {
  prenom: '', nom: '', titre: '', formation: '',
  adresse: '', cp: '', ville: '', tel: '', email: '',
  siret: '', tvaNum: '', tvaMention: '',
  tarif: 60, delai: 30,
  iban: '', bic: '', banque: '',
  paiements: 'Espèces, chèque, virement bancaire',
  logo: '',            // base64 du logo (factures)
  gcalClientId:   '',
  gcalCalendarId: ''
};

// ── IndexedDB ──────────────────────────────────────────
const IDB_NAME    = 'psy-cabinet';
const IDB_VERSION = 1;
const IDB_STORE   = 'data';
const IDB_KEY     = 'db';

let _idb = null; // connexion ouverte une fois au démarrage

function idbOpen() {
  return new Promise((resolve, reject) => {
    if (_idb) { resolve(_idb); return; }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = e => { _idb = e.target.result; resolve(_idb); };
    req.onerror   = e => reject(e.target.error);
  });
}

function idbGet(key) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror   = e => reject(e.target.error);
  }));
}

function idbPut(key, value) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  }));
}

function idbDelete(key) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  }));
}

// ── Chargement initial (async, attendu avant tout rendu) ──
async function dbLoad() {
  // CFG : toujours localStorage (synchrone, petit)
  try {
    const c = localStorage.getItem('psy-cfg');
    if (c) CFG = { ...CFG, ...JSON.parse(c) };
  } catch (e) {}

  // DB : IndexedDB avec migration automatique depuis localStorage
  try {
    const stored = await idbGet(IDB_KEY);
    if (stored) {
      DB = stored;
    } else {
      // Migration one-shot : ancien psy-db localStorage → IndexedDB
      const legacy = localStorage.getItem('psy-db');
      if (legacy) {
        try {
          DB = JSON.parse(legacy);
          await idbPut(IDB_KEY, DB);
          localStorage.removeItem('psy-db');
          console.info('[Cabinet] Migration localStorage → IndexedDB OK.');
        } catch (e) { console.warn('[Cabinet] Migration échouée.', e); }
      }
    }
  } catch (e) {
    // Fallback localStorage si IDB indisponible (navigation privée Firefox, etc.)
    console.warn('[Cabinet] IndexedDB indisponible, fallback localStorage.', e);
    try {
      const d = localStorage.getItem('psy-db');
      if (d) DB = JSON.parse(d);
    } catch (e2) {}
  }

  // Garanties de structure (rétro-compatibilité)
  if (!DB.indisponibilites)        DB.indisponibilites        = [];
  if (!DB.indisponibilites_regles) DB.indisponibilites_regles = [];
  if (!DB.factures)                DB.factures                = [];
  if (!DB.patients)                DB.patients                = [];
  if (!DB.seances)                 DB.seances                 = [];
  if (!DB.nextNum)                 DB.nextNum                 = 1;
}

// ── Sauvegarde DB (async) ──────────────────────────────
async function dbSave() {
  try {
    await idbPut(IDB_KEY, DB);
  } catch (e) {
    console.warn('[Cabinet] dbSave IDB échoué, fallback localStorage.', e);
    try { localStorage.setItem('psy-db', JSON.stringify(DB)); } catch (e2) {}
  }
  // Planifier une sauvegarde Drive si connecté (debounce 30s)
  scheduleDriveSave();
}

// ── Sauvegarde CFG (sync) ──────────────────────────────
function cfgSave() {
  try { localStorage.setItem('psy-cfg', JSON.stringify(CFG)); } catch (e) {}
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }


// ════════════════════════════════════════════════════════
// UTILITAIRES
// ════════════════════════════════════════════════════════

const MOIS_LONG  = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const MOIS_SHORT = ['jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'];
const MOIS_NOMS  = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

function formatDate(d) {
  if (!d) return '—';
  const [y, m, j] = d.split('-');
  return `${parseInt(j)} ${MOIS_LONG[parseInt(m) - 1]} ${y}`;
}

function formatDateShort(d) {
  if (!d) return '—';
  const [y, m, j] = d.split('-');
  return `${parseInt(j)} ${MOIS_SHORT[parseInt(m) - 1]} ${y}`;
}

function today()       { return new Date().toISOString().split('T')[0]; }
function fmtMoney(n)   { return n.toFixed(2).replace('.', ',') + ' €'; }
function fmtNum(n)     { return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function toMin(h)      { const [hh, mm] = h.split(':').map(Number); return hh * 60 + mm; }

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function getPatientName(id, upper = true) {
  const p = DB.patients.find(p => p.id === id);
  if (!p) return '—';
  return upper ? `${p.prenom} ${p.nom.toUpperCase()}` : `${p.prenom} ${p.nom}`;
}

function toast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = 'toast' + (type ? ' ' + type : '');
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 3000);
}


// ════════════════════════════════════════════════════════
// LOGO
// ════════════════════════════════════════════════════════

function handleLogoUpload(pfx) {
  const file = document.getElementById(`${pfx}-logo-input`).files[0];
  if (!file) return;
  if (file.size > 500 * 1024) { alert('Logo trop volumineux (max 500 Ko).'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    CFG.logo = e.target.result;
    cfgSave();
    refreshLogoPreview(pfx);
    toast('Logo enregistré ✓', 'success');
  };
  reader.readAsDataURL(file);
}

function removeLogo(pfx) {
  CFG.logo = '';
  cfgSave();
  refreshLogoPreview(pfx);
  document.getElementById(`${pfx}-logo-input`).value = '';
  toast('Logo supprimé');
}

function refreshLogoPreview(pfx) {
  const img = document.getElementById(`${pfx}-logo-preview`);
  const ph  = document.getElementById(`${pfx}-logo-placeholder`);
  const rm  = document.getElementById(`${pfx}-logo-remove`);
  if (!img) return;
  if (CFG.logo) {
    img.src = CFG.logo;
    img.style.display = 'block';
    ph.style.display  = 'none';
    rm.style.display  = 'inline-flex';
  } else {
    img.src = '';
    img.style.display = 'none';
    ph.style.display  = '';
    rm.style.display  = 'none';
  }
}


// ════════════════════════════════════════════════════════
// CONFIGURATION & PARAMÈTRES
// ════════════════════════════════════════════════════════

function isConfigured() { return !!(CFG.prenom && CFG.nom && CFG.siret); }

function toggleTvaCustom(pfx) {
  const v = document.getElementById(`${pfx}-tva-mention`).value;
  document.getElementById(`${pfx}-tva-custom-group`).style.display = v === 'custom' ? 'block' : 'none';
}

function getTvaMention(pfx) {
  const v = document.getElementById(`${pfx}-tva-mention`).value;
  return v === 'custom' ? (document.getElementById(`${pfx}-tva-custom`).value.trim() || '') : v;
}

function collectCfg(pfx) {
  const g = id => document.getElementById(`${pfx}-${id}`).value.trim();
  return {
    prenom: g('prenom'), nom: g('nom'), titre: g('titre'), formation: g('formation'),
    adresse: g('adresse'), cp: g('cp'), ville: g('ville'), tel: g('tel'), email: g('email'),
    siret: g('siret'), tvaNum: g('tva-num'), tvaMention: getTvaMention(pfx),
    tarif:    parseFloat(document.getElementById(`${pfx}-tarif`).value) || 60,
    delai:    parseInt(document.getElementById(`${pfx}-delai`).value)   || 30,
    iban: g('iban'), bic: g('bic'), banque: g('banque'), paiements: g('paiements')
  };
}

function saveConfig() {
  const cfg = collectCfg('c');
  if (!cfg.prenom || !cfg.nom) { alert('Prénom et nom sont obligatoires.'); return; }
  if (!cfg.siret)              { alert('Le SIRET est obligatoire pour émettre des factures.'); return; }
  CFG = { ...CFG, ...cfg };   // préserve CFG.logo
  cfgSave();
  document.getElementById('setup-screen').classList.add('hidden');
  updateHeader();
  toast('Configuration enregistrée ✓', 'success');
  renderDashboard();
}

function saveSettings() {
  CFG = { ...CFG, ...collectCfg('s') };   // préserve CFG.logo
  const nn = parseInt(document.getElementById('s-next-num').value);
  if (nn > 0) DB.nextNum = nn;
  cfgSave(); void dbSave();
  updateHeader();
  toast('Paramètres enregistrés ✓', 'success');
}

function loadSettingsForm() {
  const fields = {
    prenom: 's-prenom', nom: 's-nom', titre: 's-titre', formation: 's-formation',
    adresse: 's-adresse', cp: 's-cp', ville: 's-ville', tel: 's-tel', email: 's-email',
    siret: 's-siret', tvaNum: 's-tva-num',
    iban: 's-iban', bic: 's-bic', banque: 's-banque', paiements: 's-paiements'
  };
  Object.entries(fields).forEach(([k, id]) => { const el = document.getElementById(id); if (el) el.value = CFG[k] || ''; });
  document.getElementById('s-tarif').value    = CFG.tarif;
  document.getElementById('s-delai').value    = CFG.delai || 30;
  document.getElementById('s-next-num').value = DB.nextNum;

  const sel   = document.getElementById('s-tva-mention');
  const known = Array.from(sel.options).map(o => o.value);
  if (known.includes(CFG.tvaMention)) {
    sel.value = CFG.tvaMention;
  } else if (CFG.tvaMention) {
    sel.value = 'custom';
    document.getElementById('s-tva-custom').value = CFG.tvaMention;
    document.getElementById('s-tva-custom-group').style.display = 'block';
  }

  // Google Agenda
  const cidEl = document.getElementById('s-gcal-client-id');
  if (cidEl && CFG.gcalClientId) cidEl.value = CFG.gcalClientId;
  const hint = document.getElementById('gcal-origin-hint');
  if (hint) hint.textContent = location.origin;
  renderGcalStatus();
  renderGdriveStatus();

  refreshLogoPreview('s');
}

// Ouvre l'import Google si connecté, sinon guide vers la connexion
function openGcalImportOrConnect() {
  const tok = gcalToken();
  const exp = parseInt(sessionStorage.getItem('psy-gcal-exp') || '0');
  if (tok && Date.now() < exp) {
    document.getElementById('gcal-date-from').value = today();
    document.getElementById('gcal-date-to').value   = addDays(today(), 30);
    openGcalImportPanel();
  } else if (CFG.gcalClientId) {
    if (confirm('Connexion à Google Agenda requise.\nVous allez être redirigé vers Google pour autoriser l\'accès en lecture.\nContinuer ?')) {
      gcalConnect();
    }
  } else {
    showPage('parametres', document.querySelectorAll('.nav-btn')[4]);
    toast('Configurez votre Client ID Google dans les paramètres.', '');
  }
}

function updateHeader() {
  if (!CFG.prenom) return;
  const ini = (CFG.prenom[0] + (CFG.nom[0] || '')).toUpperCase();
  document.getElementById('hdr-initials').textContent  = ini;
  document.getElementById('hdr-name').textContent      = `${CFG.prenom} ${CFG.nom.toUpperCase()}`;
  document.getElementById('hdr-sub').textContent       = CFG.titre || 'Cabinet de Psychothérapie';
  document.getElementById('dash-greeting').textContent = `Bonjour, ${CFG.prenom}`;
  document.title = `Cabinet ${CFG.prenom} ${CFG.nom}`;
}

async function resetApp() {
  if (!confirm('Supprimer TOUTES les données ? Action irréversible.')) return;
  try { await idbDelete(IDB_KEY); } catch (e) {}
  localStorage.removeItem('psy-db');   // au cas où le fallback était actif
  localStorage.removeItem('psy-cfg');
  location.reload();
}


// ════════════════════════════════════════════════════════
// EXPORT / IMPORT
// ════════════════════════════════════════════════════════

function exportData() {
  const data = { db: DB, cfg: CFG, exportedAt: new Date().toISOString(), version: '1.0' };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `cabinet-backup-${today()}.json`;
  a.click();
  toast('Export téléchargé ✓', 'success');
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = e => {
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.db || !data.cfg) throw new Error('Format invalide');
        if (!confirm('Remplacer toutes les données actuelles ?')) return;
        DB = data.db; CFG = { ...CFG, ...data.cfg };
        void dbSave(); cfgSave(); updateHeader(); renderDashboard();
        refreshLogoPreview('s');
        toast('Import réussi ✓', 'success');
      } catch (err) { alert('Fichier invalide : ' + err.message); }
    };
    reader.readAsText(e.target.files[0]);
  };
  input.click();
}

// Import depuis l'écran de configuration initiale
function importDataFromSetup() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = e => {
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.db || !data.cfg) throw new Error('Format invalide');
        DB  = data.db;
        CFG = { ...CFG, ...data.cfg };
        if (!DB.indisponibilites)        DB.indisponibilites        = [];
        if (!DB.indisponibilites_regles) DB.indisponibilites_regles = [];
        void dbSave(); cfgSave();
        // Basculer directement dans l'application
        document.getElementById('setup-screen').classList.add('hidden');
        updateHeader();
        refreshLogoPreview('s');
        renderDashboard();
        toast('Données importées avec succès ✓', 'success');
      } catch (err) { alert('Fichier invalide : ' + err.message); }
    };
    reader.readAsText(e.target.files[0]);
  };
  input.click();
}


// ════════════════════════════════════════════════════════
// GOOGLE DRIVE — Sauvegarde automatique
// Scope drive.file : l'app ne voit que ses propres fichiers
// Token séparé de Google Agenda (même Client ID, scope différent)
// ════════════════════════════════════════════════════════

const GDRIVE_SCOPE      = 'https://www.googleapis.com/auth/drive.file';
const GDRIVE_API        = 'https://www.googleapis.com/drive/v3';
const GDRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const GDRIVE_FILENAME   = 'cabinet-psychotherapie-backup.json';

// Token Drive en sessionStorage
function gdriveToken()      { return sessionStorage.getItem('psy-gdrive-token'); }
function gdriveSaveToken(t) { sessionStorage.setItem('psy-gdrive-token', t); }
function gdriveClearToken() {
  sessionStorage.removeItem('psy-gdrive-token');
  sessionStorage.removeItem('psy-gdrive-exp');
}
function gdriveAlive() {
  const tok = gdriveToken();
  const exp = parseInt(sessionStorage.getItem('psy-gdrive-exp') || '0');
  return !!(tok && Date.now() < exp);
}

// Connexion OAuth Drive
function gdriveConnect() {
  const clientId = CFG.gcalClientId;
  if (!clientId) {
    alert('Configurez d\'abord votre Client ID Google dans les paramètres (section Google Agenda).');
    return;
  }
  const state = 'gdrive-' + Date.now();
  sessionStorage.setItem('psy-gdrive-state', state);
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  location.origin + location.pathname,
    response_type: 'token',
    scope:         GDRIVE_SCOPE,
    state,
    prompt:        'select_account'
  });
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
}

function gdriveDisconnect() {
  gdriveClearToken();
  CFG.gdriveFileId = '';
  cfgSave();
  renderGdriveStatus();
  toast('Déconnecté de Google Drive');
}

// Requête Drive authentifiée
async function gdriveFetch(path, options = {}) {
  const tok = gdriveToken();
  if (!tok) throw new Error('Non connecté à Google Drive');
  const res = await fetch((options._upload ? GDRIVE_UPLOAD_API : GDRIVE_API) + path, {
    ...options,
    headers: { Authorization: 'Bearer ' + tok, ...(options.headers || {}) }
  });
  if (res.status === 401) { gdriveClearToken(); renderGdriveStatus(); throw new Error('Session Drive expirée, reconnectez-vous.'); }
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || 'Erreur Drive ' + res.status); }
  return res.status === 204 ? null : res.json();
}

// ── Sauvegarde vers Drive ──────────────────────────────
let _driveSaveTimer  = null;   // debounce handle
let _driveLastSaved  = 0;      // timestamp de la dernière sauvegarde réussie
let _driveSaving     = false;

// Planifie une sauvegarde Drive dans 30s (debounced)
function scheduleDriveSave() {
  if (!gdriveAlive()) return;
  clearTimeout(_driveSaveTimer);
  _driveSaveTimer = setTimeout(() => { void driveBackupNow(); }, 30_000);
}

// Sauvegarde immédiate
async function driveBackupNow() {
  if (!gdriveAlive()) { renderGdriveStatus(); return; }
  if (_driveSaving)   return;  // déjà en cours
  _driveSaving = true;
  renderGdriveStatus();

  try {
    const payload = JSON.stringify({ db: DB, cfg: CFG, exportedAt: new Date().toISOString(), version: '1.0' }, null, 2);
    const blob    = new Blob([payload], { type: 'application/json' });

    if (CFG.gdriveFileId) {
      // Mise à jour du fichier existant (PATCH multipart)
      await _driveUpload('PATCH', '/' + CFG.gdriveFileId, blob);
    } else {
      // Création du fichier + récupération de son ID
      const meta = JSON.stringify({ name: GDRIVE_FILENAME, mimeType: 'application/json' });
      const res  = await _driveUpload('POST', '', blob, meta);
      if (res?.id) { CFG.gdriveFileId = res.id; cfgSave(); }
    }

    _driveLastSaved = Date.now();
    toast('Sauvegarde Drive ✓', 'success');
  } catch (e) {
    toast('Drive : ' + e.message, 'danger');
    console.warn('[Cabinet] Drive backup échoué', e);
  } finally {
    _driveSaving = false;
    renderGdriveStatus();
  }
}

// Upload multipart Drive (création ou mise à jour)
async function _driveUpload(method, filePath, blob, metaJson = null) {
  const boundary = 'cab' + Date.now();
  const metaStr  = metaJson || JSON.stringify({ name: GDRIVE_FILENAME, mimeType: 'application/json' });
  const bodyParts = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaStr}\r\n`,
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
  ];
  const text     = await blob.text();
  const bodyEnd  = `\r\n--${boundary}--`;
  const fullBody = bodyParts.join('') + text + bodyEnd;

  const params   = new URLSearchParams({ uploadType: 'multipart' });
  const endpoint = method === 'POST'
    ? `/files?${params}&fields=id`
    : `/files${filePath}?${params}`;

  return gdriveFetch(endpoint, {
    _upload: true,
    method,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: fullBody
  });
}

// Restauration depuis Drive
async function driveRestore() {
  if (!gdriveAlive()) { alert('Connectez-vous à Google Drive d\'abord.'); return; }
  if (!confirm('Remplacer toutes les données locales par la sauvegarde Google Drive ?')) return;

  try {
    // Chercher le fichier par son ID mémorisé, ou le retrouver par nom
    let fileId = CFG.gdriveFileId;
    if (!fileId) {
      const q   = encodeURIComponent(`name='${GDRIVE_FILENAME}' and trashed=false`);
      const res = await gdriveFetch(`/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime%20desc`);
      fileId = res?.files?.[0]?.id;
    }
    if (!fileId) { alert('Aucune sauvegarde trouvée sur votre Drive.'); return; }

    const res  = await fetch(`${GDRIVE_API}/files/${fileId}?alt=media`, {
      headers: { Authorization: 'Bearer ' + gdriveToken() }
    });
    if (!res.ok) throw new Error('Lecture Drive échouée (' + res.status + ')');
    const data = await res.json();
    if (!data.db || !data.cfg) throw new Error('Format de sauvegarde invalide');

    DB  = data.db;
    CFG = { ...CFG, ...data.cfg };
    if (!DB.indisponibilites)        DB.indisponibilites        = [];
    if (!DB.indisponibilites_regles) DB.indisponibilites_regles = [];
    void dbSave(); cfgSave();
    updateHeader(); renderDashboard(); refreshLogoPreview('s');
    toast('Restauration depuis Drive réussie ✓', 'success');
  } catch (e) {
    alert('Restauration échouée : ' + e.message);
  }
}

// Statut Drive affiché dans les paramètres + badge header
function renderGdriveStatus() {
  const box   = document.getElementById('gdrive-status-box');
  const badge = document.getElementById('hdr-drive-badge');
  const alive = gdriveAlive();
  const hasId = !!CFG.gcalClientId;

  // Badge header
  if (badge) {
    if (_driveSaving) {
      badge.style.display = 'flex';
      badge.innerHTML = '⏳ Drive…';
    } else if (alive && _driveLastSaved) {
      badge.style.display = 'flex';
      badge.innerHTML = `☁ ${_fmtSince(_driveLastSaved)}`;
    } else if (alive) {
      badge.style.display = 'flex';
      badge.innerHTML = '☁ Drive connecté';
    } else {
      badge.style.display = 'none';
    }
  }

  if (!box) return;

  if (_driveSaving) {
    box.innerHTML = `<div class="info-box sage" style="font-size:13px;">
      ⏳ Sauvegarde en cours…
    </div>`;
    return;
  }
  if (alive) {
    const exp   = parseInt(sessionStorage.getItem('psy-gdrive-exp') || '0');
    const mins  = Math.round((exp - Date.now()) / 60000);
    const since = _driveLastSaved ? `— dernière sauvegarde : ${_fmtSince(_driveLastSaved)}` : '— pas encore sauvegardé cette session';
    box.innerHTML = `<div class="info-box sage">
      <strong>✓ Google Drive connecté</strong> ${since}<br>
      <span style="font-size:12px;color:var(--sage-dark);">Session valide encore ~${mins} min · Sauvegarde auto 30s après chaque modification.</span>
      <div style="margin-top:.5rem;display:flex;gap:.5rem;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm" onclick="driveBackupNow()">💾 Sauvegarder maintenant</button>
        <button class="btn btn-secondary btn-sm" onclick="driveRestore()">⬆ Restaurer depuis Drive</button>
        <button class="btn btn-secondary btn-sm" onclick="gdriveDisconnect()">Déconnecter</button>
      </div>
    </div>`;
  } else if (hasId) {
    box.innerHTML = `<div class="info-box terra" style="margin-bottom:.5rem;font-size:13px;">
      <strong>Non connecté</strong> — autorisez l'accès pour activer la sauvegarde automatique.
    </div>
    <button class="btn btn-primary btn-sm" onclick="gdriveConnect()">🔗 Connecter Google Drive</button>`;
  } else {
    box.innerHTML = `<p style="font-size:13px;color:var(--warm-mid);line-height:1.6;">
      Configurez d'abord votre Client ID Google (section Google Agenda ci-dessous).</p>`;
  }
}

function _fmtSince(ts) {
  const d = Math.round((Date.now() - ts) / 1000);
  if (d < 60)  return 'il y a quelques secondes';
  if (d < 3600) return `il y a ${Math.round(d / 60)} min`;
  return `il y a ${Math.round(d / 3600)} h`;
}

// Décompte Drive toutes les 30s
setInterval(() => {
  if (!gdriveAlive() && sessionStorage.getItem('psy-gdrive-token')) {
    gdriveClearToken();
  }
  renderGdriveStatus();   // rafraîchit badge header + bloc paramètres
}, 30_000);


// ════════════════════════════════════════════════════════
// GOOGLE AGENDA — Import lecture seule
// ════════════════════════════════════════════════════════

const GCAL_SCOPE    = 'https://www.googleapis.com/auth/calendar.readonly';
const GCAL_API      = 'https://www.googleapis.com/calendar/v3';

// Token stocké en sessionStorage (expire à la fermeture d'onglet)
function gcalToken()       { return sessionStorage.getItem('psy-gcal-token'); }
function gcalSaveToken(t)  { sessionStorage.setItem('psy-gcal-token', t); }
function gcalClearToken()  { sessionStorage.removeItem('psy-gcal-token'); sessionStorage.removeItem('psy-gcal-exp'); }

// Capture du token au retour OAuth — gère Calendar ET Drive
;(function catchOAuth() {
  if (!location.hash.includes('access_token')) return;
  const p   = new URLSearchParams(location.hash.slice(1));
  const tok = p.get('access_token'); if (!tok) return;
  const exp = parseInt(p.get('expires_in') || '3600');
  const st  = p.get('state') || '';
  history.replaceState(null, '', location.pathname);

  // ── Retour Drive ──
  if (st.startsWith('gdrive-')) {
    if (sessionStorage.getItem('psy-gdrive-state') && st !== sessionStorage.getItem('psy-gdrive-state')) return;
    gdriveSaveToken(tok);
    sessionStorage.setItem('psy-gdrive-exp', Date.now() + exp * 1000);
    sessionStorage.removeItem('psy-gdrive-state');
    setTimeout(() => {
      if (!isConfigured()) return;
      renderGdriveStatus();
      showPage('parametres', document.querySelectorAll('.nav-btn')[4]);
      toast('Google Drive connecté ✓ — sauvegarde automatique activée', 'success');
      // Déclencher une première sauvegarde immédiate
      void driveBackupNow();
    }, 300);
    return;
  }

  // ── Retour Calendar ──
  if (sessionStorage.getItem('psy-gcal-state') && st !== sessionStorage.getItem('psy-gcal-state')) return;
  gcalSaveToken(tok);
  sessionStorage.setItem('psy-gcal-exp', Date.now() + exp * 1000);
  sessionStorage.removeItem('psy-gcal-state');
  setTimeout(() => {
    if (!isConfigured()) return;
    showPage('seances', document.querySelectorAll('.nav-btn')[2]);
    openGcalImportPanel();
  }, 300);
})();

function gcalConnect() {
  const clientId = CFG.gcalClientId;
  if (!clientId) { alert('Veuillez d\'abord saisir votre Client ID Google dans les paramètres.'); return; }
  const state = 'gcal-' + Date.now();
  sessionStorage.setItem('psy-gcal-state', state);
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  location.origin + location.pathname,
    response_type: 'token',
    scope:         GCAL_SCOPE,
    state,
    prompt:        'select_account'
  });
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
}

function gcalDisconnect() {
  gcalClearToken();
  renderGcalStatus();
  toast('Déconnecté de Google Agenda');
}

function saveGcalClientId() {
  const id = document.getElementById('s-gcal-client-id')?.value.trim();
  if (!id) { alert('Client ID requis.'); return; }
  CFG.gcalClientId = id;
  cfgSave();
  renderGcalStatus();
  toast('Client ID enregistré ✓', 'success');
}

function renderGcalStatus() {
  const box = document.getElementById('gcal-status-box'); if (!box) return;
  const tok   = gcalToken();
  const exp   = parseInt(sessionStorage.getItem('psy-gcal-exp') || '0');
  const alive = tok && Date.now() < exp;
  const hasId = !!CFG.gcalClientId;

  if (alive) {
    const mins = Math.round((exp - Date.now()) / 60000);
    box.innerHTML = `<div class="info-box sage">
      <strong>✓ Connecté à Google Agenda</strong>
      — session valide encore <span id="gcal-countdown">~${mins} min</span><br>
      <div style="margin-top:.5rem;display:flex;gap:.5rem;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm" onclick="openGcalImportPanel()">📥 Importer des séances</button>
        <button class="btn btn-secondary btn-sm" onclick="gcalDisconnect()">Déconnecter</button>
      </div>
    </div>`;
  } else if (hasId) {
    box.innerHTML = `<div class="info-box terra" style="margin-bottom:.5rem;">
      <strong>Non connecté</strong> — autorisez l'accès en lecture à votre Google Agenda.
    </div>
    <button class="btn btn-primary btn-sm" onclick="gcalConnect()">🔗 Connecter Google Agenda</button>`;
  } else {
    box.innerHTML = `<p style="font-size:13px;color:var(--warm-mid);line-height:1.6;margin-bottom:.5rem;">
      Importez vos rendez-vous Google Agenda comme séances. Renseignez d'abord votre Client ID OAuth ci-dessous.</p>`;
  }
}

// Bannière discrète dans la page Séances si le token expire bientôt ou est expiré
function renderGcalExpiryBanner() {
  const banner = document.getElementById('gcal-expiry-banner'); if (!banner) return;
  const tok    = gcalToken();
  const exp    = parseInt(sessionStorage.getItem('psy-gcal-exp') || '0');
  const hasId  = !!CFG.gcalClientId;
  if (!hasId) { banner.style.display = 'none'; return; }

  const remaining = exp - Date.now();
  if (!tok || remaining <= 0) {
    banner.style.display = '';
    banner.innerHTML = `<div class="info-box terra" style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap;padding:.5rem .85rem;font-size:13px;">
      <span>📅 Session Google Agenda expirée.</span>
      <button class="btn btn-primary btn-sm" onclick="gcalConnect()">Reconnecter</button>
    </div>`;
  } else if (remaining < 10 * 60 * 1000) { // < 10 min
    const mins = Math.ceil(remaining / 60000);
    banner.style.display = '';
    banner.innerHTML = `<div class="info-box sage" style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap;padding:.5rem .85rem;font-size:13px;">
      <span>📅 Session Google Agenda : expire dans ${mins} min.</span>
      <button class="btn btn-primary btn-sm" onclick="gcalConnect()">Renouveler</button>
    </div>`;
  } else {
    banner.style.display = 'none';
  }
}

// Décompte live affiché dans les paramètres (toutes les 30 s)
setInterval(() => {
  const el  = document.getElementById('gcal-countdown'); if (!el) return;
  const exp = parseInt(sessionStorage.getItem('psy-gcal-exp') || '0');
  const rem = exp - Date.now();
  if (rem <= 0) {
    renderGcalStatus();    // rafraîchit tout le bloc si expiré
    renderGcalExpiryBanner();
  } else {
    el.textContent = `~${Math.round(rem / 60000)} min`;
  }
}, 30000);

async function gcalFetch(path) {
  const tok = gcalToken();
  if (!tok) throw new Error('Non connecté');
  const r = await fetch(GCAL_API + path, { headers: { Authorization: 'Bearer ' + tok } });
  if (r.status === 401) { gcalClearToken(); renderGcalStatus(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || 'Erreur ' + r.status); }
  return r.json();
}

// Ouvre le panneau d'import Google Agenda
async function openGcalImportPanel() {
  const log = document.getElementById('gcal-import-log');
  document.getElementById('modal-gcal-import').classList.remove('hidden');
  document.getElementById('gcal-step-calendars').style.display = '';
  document.getElementById('gcal-step-events').style.display    = 'none';
  if (log) log.textContent = '⏳ Chargement des calendriers…';

  try {
    const data = await gcalFetch('/users/me/calendarList');

    // Filtrer les calendriers utiles : exclure anniversaires, fériés, contacts
    const EXCLUS = ['#holiday', '#contacts', '#birthdays'];
    const cals   = (data.items || []).filter(c =>
      c.accessRole !== 'freeBusyReader' &&
      !EXCLUS.some(x => (c.id || '').includes(x))
    );

    // Trier : principal en premier, puis alphabétique
    cals.sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0) || (a.summary || '').localeCompare(b.summary || ''));

    const lastUsed = CFG.gcalCalendarId || '';
    const cards    = document.getElementById('gcal-cal-cards');

    cards.innerHTML = cals.map(c => {
      const color    = c.backgroundColor || '#6b8f71';
      const isSelected = c.id === lastUsed || (!lastUsed && c.primary);
      return `<label class="gcal-cal-card${isSelected ? ' selected' : ''}" onclick="selectGcalCal(this, '${escAttr(c.id)}')">
        <input type="radio" name="gcal-cal" value="${escAttr(c.id)}" ${isSelected ? 'checked' : ''} style="display:none;">
        <span class="gcal-cal-dot" style="background:${color};"></span>
        <span class="gcal-cal-name">${escHtml(c.summary)}</span>
        ${c.primary ? '<span class="gcal-cal-badge">Principal</span>' : ''}
        ${c.description ? `<span class="gcal-cal-desc">${escHtml(c.description)}</span>` : ''}
      </label>`;
    }).join('');

    // Pré-sélectionner le calendrier dans le champ caché
    const presel = cals.find(c => c.id === lastUsed) || cals.find(c => c.primary) || cals[0];
    if (presel) document.getElementById('gcal-cal-select').value = presel.id;

    if (log) log.textContent = `${cals.length} calendrier(s) trouvé(s).`;
  } catch (e) {
    if (log) log.textContent = '✕ ' + e.message;
  }
}

function selectGcalCal(label, calId) {
  // Mettre à jour la sélection visuelle
  document.querySelectorAll('.gcal-cal-card').forEach(l => l.classList.remove('selected'));
  label.classList.add('selected');
  document.getElementById('gcal-cal-select').value = calId;
}

function escAttr(s) { return (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

async function gcalLoadEvents() {
  const calId = document.getElementById('gcal-cal-select').value;
  const from  = document.getElementById('gcal-date-from').value;
  const to    = document.getElementById('gcal-date-to').value;
  const log   = document.getElementById('gcal-import-log');

  if (!calId) { alert('Sélectionnez un calendrier.'); return; }
  if (!from || !to) { alert('Sélectionnez une plage de dates.'); return; }
  if (from > to)    { alert('La date de début doit être avant la date de fin.'); return; }

  // Mémoriser le calendrier choisi pour la prochaine fois
  CFG.gcalCalendarId = calId;
  cfgSave();

  if (log) log.textContent = '⏳ Chargement des événements…';
  try {
    const params = new URLSearchParams({
      timeMin:      new Date(from).toISOString(),
      timeMax:      new Date(to + 'T23:59:59').toISOString(),
      singleEvents: 'true', orderBy: 'startTime', maxResults: '500'
    });
    const data   = await gcalFetch(`/calendars/${encodeURIComponent(calId)}/events?${params}`);
    const events = (data.items || []).filter(e => e.start?.dateTime);

    if (!events.length) {
      if (log) log.textContent = 'Aucun événement avec horaire dans cette période.';
      return;
    }

    buildRapprochement(events);
    document.getElementById('gcal-step-calendars').style.display = 'none';
    document.getElementById('gcal-step-events').style.display    = '';
    if (log) log.textContent = `${events.length} événement(s) chargé(s).`;
  } catch (e) {
    if (log) log.textContent = '✕ ' + e.message;
    toast(e.message, 'danger');
  }
}

// Construit le tableau de rapprochement événement ↔ patient
function buildRapprochement(events) {
  const alreadyImported = new Set(DB.seances.map(s => s.gcalEventId).filter(Boolean));

  const rows = events.map(ev => {
    const start    = new Date(ev.start.dateTime);
    const end      = new Date(ev.end.dateTime);
    const dateStr  = start.toISOString().split('T')[0];
    const heure    = start.toTimeString().slice(0, 5);
    const duree    = Math.round((end - start) / 60000);
    const titre    = ev.summary || '(sans titre)';
    const done     = alreadyImported.has(ev.id);

    // Tentative de rapprochement automatique par nom
    const matchedPat   = findPatientByName(titre);
    const matchScore   = matchedPat ? getMatchScore(titre, matchedPat) : 0;
    const matchLabel   = matchScore === 3 ? '✓ prénom + nom'
                       : matchScore === 2 ? '✓ nom complet'
                       : matchScore === 1 ? '~ nom seul' : '';
    const patOptions = DB.patients.map(p =>
      `<option value="${p.id}"${matchedPat?.id === p.id ? ' selected' : ''}>${p.prenom} ${p.nom.toUpperCase()}</option>`
    ).join('');

    return { ev, dateStr, heure, duree, titre, done, matchedPat, matchScore, matchLabel, patOptions };
  });

  // Stocker pour utilisation lors de la confirmation
  window._gcalRows = rows;

  const tbody = document.getElementById('gcal-events-tbody');
  tbody.innerHTML = rows.map((r, i) => `
    <tr class="${r.done ? 'gcal-row-done' : ''}">
      <td style="text-align:center;">
        <input type="checkbox" class="gcal-cb" data-idx="${i}" ${r.done ? 'disabled checked' : 'checked'} style="width:auto;accent-color:var(--sage);">
      </td>
      <td style="font-size:13px;">${formatDate(r.dateStr)}</td>
      <td style="font-size:13px;">${r.heure} · ${r.duree} min</td>
      <td>
        <div style="font-size:13px;font-weight:500;">${escHtml(r.titre)}</div>
        ${r.done ? '<span style="font-size:11px;color:var(--sage-dark);">✓ déjà importé</span>' : ''}
      </td>
      <td>
        ${r.done ? '<span style="font-size:12px;color:var(--warm-mid);">—</span>' : `
        <select class="gcal-pat-sel" data-idx="${i}" style="font-size:12px;max-width:160px;">
          <option value="">— Nouveau patient —</option>
          ${r.patOptions}
        </select>
        ${r.matchedPat
          ? `<div style="font-size:11px;margin-top:2px;color:${r.matchScore === 3 ? 'var(--sage-dark)' : r.matchScore === 2 ? 'var(--sage)' : 'var(--warning)'};">${r.matchLabel}</div>`
          : '<div style="font-size:11px;color:var(--terra);margin-top:2px;">Aucun patient trouvé</div>'
        }`}
      </td>
    </tr>`).join('');
}

// Cherche un patient dont le nom complet apparaît dans le titre de l'événement
// Normalise une chaîne : minuscules, sans accents, sans ponctuation
function normStr(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').trim();
}

// Extrait les mots significatifs (≥ 2 caractères) d'une chaîne normalisée
function wordSet(s) {
  return new Set(normStr(s).split(/\s+/).filter(w => w.length >= 2));
}

// Cherche le patient le plus probable dans le titre d'un événement Google.
// Stratégie par priorité décroissante :
//   3 — prénom ET nom tous les deux présents comme mots entiers dans le titre
//   2 — nom complet "prénom nom" ou "nom prénom" présent comme sous-séquence de mots
//   1 — nom seul présent comme mot entier (fallback, accepté seulement si ≥ 3 caractères)
//   0 — pas de match
// En cas d'égalité de score, on préfère le patient dont le nom est le plus long
//    (pour éviter qu'un prénom court comme "Al" colle à tout le monde).
function findPatientByName(titre) {
  const t     = normStr(titre);
  const tWords = wordSet(titre);

  let best = null, bestScore = 0;

  DB.patients.forEach(p => {
    const nom    = normStr(p.nom);
    const prenom = normStr(p.prenom);

    let score = 0;

    // Score 3 : prénom ET nom présents comme mots indépendants
    if (nom.length >= 2 && prenom.length >= 2 && tWords.has(nom) && tWords.has(prenom)) {
      score = 3;
    }
    // Score 2 : séquence "prénom nom" ou "nom prénom" dans le titre
    else if (
      (nom.length >= 2 && prenom.length >= 2) &&
      (t.includes(prenom + ' ' + nom) || t.includes(nom + ' ' + prenom))
    ) {
      score = 2;
    }
    // Score 1 : nom seul comme mot entier (uniquement si nom ≥ 3 caractères pour éviter faux positifs)
    else if (nom.length >= 3 && tWords.has(nom)) {
      score = 1;
    }

    if (score === 0) return;

    // En cas d'égalité, privilégier le match le plus "long" (nom + prénom)
    const len = nom.length + prenom.length;
    if (score > bestScore || (score === bestScore && len > (normStr(best.nom).length + normStr(best.prenom).length))) {
      best = p; bestScore = score;
    }
  });

  return best;
}

// Retourne le score de match entre un titre et un patient (même logique que findPatientByName)
function getMatchScore(titre, p) {
  const t      = normStr(titre);
  const tWords = wordSet(titre);
  const nom    = normStr(p.nom);
  const prenom = normStr(p.prenom);
  if (nom.length >= 2 && prenom.length >= 2 && tWords.has(nom) && tWords.has(prenom)) return 3;
  if (nom.length >= 2 && prenom.length >= 2 && (t.includes(prenom + ' ' + nom) || t.includes(nom + ' ' + prenom))) return 2;
  if (nom.length >= 3 && tWords.has(nom)) return 1;
  return 0;
}

function gcalSelectAll(checked) {
  document.querySelectorAll('.gcal-cb:not(:disabled)').forEach(cb => cb.checked = checked);
}

function gcalConfirmImport() {
  const rows    = window._gcalRows || [];
  const checked = Array.from(document.querySelectorAll('.gcal-cb:checked:not(:disabled)')).map(cb => parseInt(cb.dataset.idx));
  if (!checked.length) { alert('Sélectionnez au moins un événement.'); return; }

  let imported = 0, created = 0, skipped = 0;
  const newPatients = {};  // titre → patientId (pour éviter doublons si même nom sur plusieurs events)

  checked.forEach(i => {
    const r   = rows[i];
    const sel = document.querySelector(`.gcal-pat-sel[data-idx="${i}"]`);
    let patientId = sel ? sel.value : '';

    // Créer un nouveau patient si non lié
    if (!patientId) {
      const key = r.titre.trim().toLowerCase();
      if (newPatients[key]) {
        patientId = newPatients[key];
      } else {
        // Essayer de déduire prénom / nom depuis le titre
        const parts = r.titre.trim().split(/\s+/);
        const newP  = {
          id:        uid(),
          createdAt: new Date().toISOString(),
          prenom:    parts[0] || r.titre,
          nom:       parts.slice(1).join(' ') || '',
          tarif:     CFG.tarif || 60,
          statut:    'actif',
          motif: '', notes: '', historique: '', diagnosticAT: '', supervision: '',
          tel: '', email: '', adresse: '', naissance: ''
        };
        DB.patients.push(newP);
        patientId = newP.id;
        newPatients[key] = newP.id;
        created++;
      }
    }

    // Vérifier doublon par date+heure
    const existsAlready = DB.seances.find(s => s.date === r.dateStr && s.heure === r.heure && s.patientId === patientId);
    if (existsAlready) { skipped++; return; }

    DB.seances.push({
      id:          uid(),
      patientId,
      date:        r.dateStr,
      heure:       r.heure,
      duree:       r.duree,
      tarif:       patientId ? (DB.patients.find(p => p.id === patientId)?.tarif || CFG.tarif) : CFG.tarif,
      statut:      'planifié',
      paiement:    '',
      notes:       r.titre !== 'Séance' ? r.titre : '',
      facture:     null,
      gcalEventId: r.ev.id
    });
    imported++;
  });

  void dbSave();
  document.getElementById('modal-gcal-import').classList.add('hidden');
  renderSeances(); renderDashboard();

  const msg = [`${imported} séance(s) importée(s)`];
  if (created)  msg.push(`${created} patient(s) créé(s)`);
  if (skipped)  msg.push(`${skipped} doublon(s) ignoré(s)`);
  toast(msg.join(' · ') + ' ✓', 'success');
}


// ════════════════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════════════════

// Mémorise la page précédente pour le retour depuis la fiche patient
let _ficheReturnPage = 'patients';

function showPage(id, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  if (btn) btn.classList.add('active');
  if (id === 'dashboard')       renderDashboard();
  if (id === 'patients')        renderPatients();
  if (id === 'seances')         { populateFilterPat(); renderSeances(); renderGcalExpiryBanner(); }
  if (id === 'factures')        renderFactures();
  if (id === 'parametres')      loadSettingsForm();
  if (id === 'patient-detail')  { /* contenu déjà injecté par viewPatient */ }
}

function showPatientPage(returnPage = 'patients') {
  _ficheReturnPage = returnPage;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-patient-detail').classList.add('active');
  // Activer le bouton nav Patients visuellement
  document.querySelectorAll('.nav-btn')[1]?.classList.add('active');
}

function closeFichePatient() {
  const navBtns = document.querySelectorAll('.nav-btn');
  const pages   = { patients: 1, seances: 2, dashboard: 0 };
  const idx     = pages[_ficheReturnPage] ?? 1;
  showPage(_ficheReturnPage, navBtns[idx]);
  window.scrollTo(0, 0);
}

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  if (id === 'modal-patient') resetPatientForm();
  if (id === 'modal-seance')  resetSeanceForm();
  if (id === 'modal-facture') initFactureModal();
}

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function showTab(tabId, btn) {
  const modal = btn.closest('.modal');
  modal.querySelectorAll('[data-tab]').forEach(t => t.style.display = 'none');
  document.getElementById(tabId).style.display = 'block';
  modal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) o.classList.add('hidden'); });
});


// ════════════════════════════════════════════════════════
// PATIENTS
// ════════════════════════════════════════════════════════

function resetPatientForm(p = null) {
  document.getElementById('p-edit-id').value = '';
  document.getElementById('mp-title').textContent = 'Nouveau patient';
  ['p-prenom', 'p-nom', 'p-tel', 'p-email', 'p-adresse', 'p-motif', 'p-notes'].forEach(f => {
    document.getElementById(f).value = p ? (p[f.replace('p-', '')] || '') : '';
  });
  document.getElementById('p-tarif').value       = p ? p.tarif       : (CFG.tarif || 60);
  document.getElementById('p-statut').value      = p ? p.statut      : 'actif';
  document.getElementById('p-naissance').value   = p ? (p.naissance  || '') : '';
  document.getElementById('p-historique').value  = p ? (p.historique || '') : '';
  document.getElementById('p-diagnosticAT').value= p ? (p.diagnosticAT || '') : '';
  document.getElementById('p-supervision').value = p ? (p.supervision || '') : '';
  showTab('tab-infos', document.querySelector('#modal-patient .tab-btn'));
}

function savePatient() {
  const prenom = document.getElementById('p-prenom').value.trim();
  const nom    = document.getElementById('p-nom').value.trim();
  if (!prenom || !nom) { alert('Prénom et nom requis.'); return; }

  const id   = document.getElementById('p-edit-id').value;
  const data = {
    prenom, nom,
    naissance:    document.getElementById('p-naissance').value,
    tel:          document.getElementById('p-tel').value.trim(),
    email:        document.getElementById('p-email').value.trim(),
    adresse:      document.getElementById('p-adresse').value.trim(),
    tarif:        parseFloat(document.getElementById('p-tarif').value) || CFG.tarif || 60,
    statut:       document.getElementById('p-statut').value,
    motif:        document.getElementById('p-motif').value.trim(),
    notes:        document.getElementById('p-notes').value.trim(),
    historique:   document.getElementById('p-historique').value.trim(),
    diagnosticAT: document.getElementById('p-diagnosticAT').value.trim(),
    supervision:  document.getElementById('p-supervision').value.trim()
  };

  if (id) {
    const idx = DB.patients.findIndex(p => p.id === id);
    if (idx > -1) { data.id = id; data.createdAt = DB.patients[idx].createdAt; DB.patients[idx] = data; }
  } else {
    data.id = uid(); data.createdAt = new Date().toISOString();
    DB.patients.push(data);
  }
  void dbSave(); closeModal('modal-patient'); renderPatients();
  toast('Patient enregistré ✓', 'success');
}

function editPatient(id) {
  const p = DB.patients.find(p => p.id === id); if (!p) return;
  openModal('modal-patient');
  document.getElementById('p-edit-id').value = id;
  document.getElementById('mp-title').textContent = 'Modifier le patient';
  resetPatientForm(p);
  document.getElementById('p-edit-id').value = id;
}

function deletePatient(id) {
  if (!confirm('Supprimer ce patient ? Ses séances resteront enregistrées.')) return;
  DB.patients = DB.patients.filter(p => p.id !== id);
  void dbSave(); closeFichePatient(); renderPatients();
  toast('Patient supprimé');
}

function viewPatient(id, returnPage) {
  const p       = DB.patients.find(p => p.id === id); if (!p) return;
  const seances = DB.seances.filter(s => s.patientId === id).sort((a, b) => b.date.localeCompare(a.date));
  const ini     = (p.prenom[0] + p.nom[0]).toUpperCase();
  const age     = p.naissance ? Math.floor((Date.now() - new Date(p.naissance)) / 31557600000) + ' ans' : '';

  // Mettre à jour le titre et les actions en haut
  document.getElementById('fiche-page-title').textContent = `${p.prenom} ${p.nom.toUpperCase()}`;
  document.getElementById('fiche-page-actions').innerHTML = `
    <button class="btn btn-secondary btn-sm" onclick="editPatientFromFiche('${id}')">✎ Modifier</button>
    <button class="btn btn-danger btn-sm" onclick="deletePatient('${id}')">Supprimer</button>`;

  const seancesHTML = !seances.length
    ? '<div style="color:var(--warm-mid);font-size:13px;padding:.5rem 0;">Aucune séance enregistrée</div>'
    : seances.map(s => `
      <div class="seance-line-fiche" onclick="viewSeanceFromFiche('${s.id}','${id}')">
        <span class="sl-date">${formatDateShort(s.date)}</span>
        <span class="sl-heure">${s.heure}</span>
        <span class="badge badge-${s.statut}" style="font-size:10px;">${s.statut}</span>
        ${s.paiement ? `<span style="font-size:11px;color:var(--warm-mid);">${s.paiement}</span>` : ''}
        <span class="sl-amount">${s.tarif} €</span>
        <span class="sl-actions">
          <button class="btn btn-secondary btn-xs" onclick="event.stopPropagation();editSeanceFromFiche('${s.id}','${id}')">✎</button>
        </span>
      </div>`).join('');

  document.getElementById('fiche-content').innerHTML = `
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap;">
      <div class="avatar" style="width:56px;height:56px;font-size:20px;">${ini}</div>
      <div style="flex:1;">
        <div style="font-family:var(--font-serif);font-size:22px;">${p.prenom} ${p.nom.toUpperCase()}</div>
        <div style="font-size:12px;color:var(--warm-mid);margin-top:2px;">${age}${p.motif ? ' · ' + p.motif : ''}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1.25rem;font-size:13px;">
      ${p.tel     ? `<div><span style="color:var(--warm-mid);">Tél :</span> ${p.tel}</div>` : ''}
      ${p.email   ? `<div><span style="color:var(--warm-mid);">Email :</span> ${p.email}</div>` : ''}
      ${p.adresse ? `<div style="grid-column:1/-1"><span style="color:var(--warm-mid);">Adresse :</span> ${p.adresse}</div>` : ''}
      <div><span style="color:var(--warm-mid);">Tarif :</span> ${p.tarif} € / séance</div>
      <div><span style="color:var(--warm-mid);">Statut :</span> <span class="badge badge-${p.statut === 'actif' ? 'actif' : 'annulé'}">${p.statut}</span></div>
    </div>

    ${p.notes ? `<div class="section-title">Notes générales</div><div class="notes-block" style="margin-bottom:1.25rem;">${escHtml(p.notes)}</div>` : ''}

    <!-- Sections suivi thérapeutique -->
    <div class="suivi-tabs-fiche">
      <div class="tab-group" style="margin-bottom:.75rem;">
        <button class="tab-btn active" onclick="showFicheTab('fiche-tab-historique',this)">Historique</button>
        <button class="tab-btn" onclick="showFicheTab('fiche-tab-diagat',this)">Diagnostic AT</button>
        <button class="tab-btn" onclick="showFicheTab('fiche-tab-supervision',this)">Supervision</button>
      </div>
      <div id="fiche-tab-historique">
        ${ficheTab(p, 'historique', 'Historique', '')}
      </div>
      <div id="fiche-tab-diagat" style="display:none;">
        ${ficheTab(p, 'diagnosticAT', 'Diagnostic AT', '')}
      </div>
      <div id="fiche-tab-supervision" style="display:none;">
        ${ficheTab(p, 'supervision', 'Supervision', '')}
      </div>
    </div>

    <!-- Séances -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem;margin-top:1.25rem;">
      <div class="section-title" style="margin-bottom:0;">Séances (${seances.length})</div>
      <button class="btn btn-primary btn-sm" onclick="addSeanceForPatient('${id}')">+ Ajouter séance</button>
    </div>
    <div id="fiche-seances-list">${seancesHTML}</div>`;

  showPatientPage(returnPage || _ficheReturnPage || 'patients');
  window.scrollTo(0, 0);
}

// Échappe le HTML pour l'affichage sécurisé dans les notes-blocks
function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

// Génère le HTML d'un onglet suivi dans la fiche patient
function ficheTab(p, field, label, placeholder) {
  const content = p[field] || '';
  if (!content) {
    return `<div class="suivi-empty">
      <span style="color:var(--warm-mid);font-size:13px;">Aucun contenu — utilisez le bouton ✎ Modifier pour renseigner cet onglet,<br>ou ajoutez des notes depuis une séance.</span>
    </div>`;
  }
  // Afficher les entrées horodatées (format "── [date] ──\n...") ou le texte libre
  return `<div class="notes-block suivi-content">${escHtml(content)}</div>`;
}

// Affichage des onglets dans la fiche patient (généré dynamiquement)
function showFicheTab(tabId, btn) {
  const container = btn.closest('.suivi-tabs-fiche');
  container.querySelectorAll('[id^="fiche-tab-"]').forEach(t => t.style.display = 'none');
  document.getElementById(tabId).style.display = '';
  container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// Ouvre le modal de suivi depuis une séance
function openSuiviSeance(seanceId) {
  const s = DB.seances.find(s => s.id === seanceId); if (!s) return;
  const p = DB.patients.find(p => p.id === s.patientId); if (!p) return;

  document.getElementById('suivi-seance-id').value  = seanceId;
  document.getElementById('suivi-patient-id').value = p.id;
  document.getElementById('suivi-seance-title').textContent = `Suivi — ${p.prenom} ${p.nom.toUpperCase()} · séance du ${formatDate(s.date)}`;

  // Vider les champs de nouvelle note
  ['sv-historique-new', 'sv-diagat-new', 'sv-supervision-new'].forEach(id => {
    document.getElementById(id).value = '';
  });

  // Afficher le contenu existant
  renderSuiviExisting('sv-historique-existing',  p.historique  || '');
  renderSuiviExisting('sv-diagat-existing',       p.diagnosticAT || '');
  renderSuiviExisting('sv-supervision-existing',  p.supervision || '');

  // Reset tabs
  showTab('sv-tab-historique', document.querySelector('#modal-suivi-seance .tab-btn'));
  document.getElementById('modal-suivi-seance').classList.remove('hidden');
}

function renderSuiviExisting(containerId, content) {
  const el = document.getElementById(containerId);
  el.innerHTML = content
    ? `<div class="suivi-section-hint" style="margin-top:.5rem;">Contenu actuel :</div><div class="notes-block suivi-content">${escHtml(content)}</div>`
    : `<div style="color:var(--warm-mid);font-size:12px;margin-top:.5rem;font-style:italic;">Aucun contenu existant.</div>`;
}

function saveSuiviSeance() {
  const seanceId  = document.getElementById('suivi-seance-id').value;
  const patientId = document.getElementById('suivi-patient-id').value;
  const s = DB.seances.find(s => s.id === seanceId);
  const p = DB.patients.find(p => p.id === patientId);
  if (!p) return;

  const dateStamp = formatDate(s ? s.date : today());
  let changed = false;

  // Pour chaque section : si une nouvelle note est saisie, la préfixer horodatée
  const sections = [
    { newId: 'sv-historique-new',  field: 'historique'   },
    { newId: 'sv-diagat-new',      field: 'diagnosticAT' },
    { newId: 'sv-supervision-new', field: 'supervision'  }
  ];

  sections.forEach(({ newId, field }) => {
    const newText = document.getElementById(newId).value.trim();
    if (!newText) return;
    const stamp   = `── ${dateStamp} ──\n${newText}`;
    p[field]      = p[field] ? stamp + '\n\n' + p[field] : stamp;
    changed       = true;
  });

  if (!changed) { toast('Aucune note à enregistrer.'); return; }

  void dbSave();
  document.getElementById('modal-suivi-seance').classList.add('hidden');
  toast('Notes de suivi enregistrées ✓', 'success');

  // Rafraîchir la fiche si elle est affichée
  const returnTo = document.getElementById('s-return-patient').value;
  if (returnTo === patientId && document.getElementById('page-patient-detail').classList.contains('active')) {
    viewPatient(patientId);
  }
}

function editPatientFromFiche(id) { editPatient(id); }

function addSeanceForPatient(patientId) {
  openModal('modal-seance');
  setTimeout(() => {
    document.getElementById('s-patient').value = patientId;
    const p = DB.patients.find(p => p.id === patientId);
    if (p) document.getElementById('s-tarif').value = p.tarif;
    document.getElementById('s-return-patient').value = patientId;
  }, 50);
}

function viewSeanceFromFiche(sid, pid) { document.getElementById('s-return-patient').value = pid; viewSeance(sid, pid); }
function editSeanceFromFiche(sid, pid) { document.getElementById('s-return-patient').value = pid; editSeance(sid); }

function refreshFicheSeances(patientId) {
  const el      = document.getElementById('fiche-seances-list'); if (!el) return;
  const seances = DB.seances.filter(s => s.patientId === patientId).sort((a, b) => b.date.localeCompare(a.date));
  if (!seances.length) {
    el.innerHTML = '<div style="color:var(--warm-mid);font-size:13px;padding:.5rem 0;">Aucune séance enregistrée</div>';
    return;
  }
  el.innerHTML = seances.map(s => `
    <div class="seance-line-fiche" onclick="viewSeanceFromFiche('${s.id}','${patientId}')">
      <span class="sl-date">${formatDateShort(s.date)}</span>
      <span class="sl-heure">${s.heure}</span>
      <span class="badge badge-${s.statut}" style="font-size:10px;">${s.statut}</span>
      ${s.paiement ? `<span style="font-size:11px;color:var(--warm-mid);">${s.paiement}</span>` : ''}
      <span class="sl-amount">${s.tarif} €</span>
      <span class="sl-actions">
        <button class="btn btn-secondary btn-xs" onclick="event.stopPropagation();editSeanceFromFiche('${s.id}','${patientId}')">✎</button>
      </span>
    </div>`).join('');
}

function renderPatients() {
  const q  = document.getElementById('search-patients').value.toLowerCase();
  const st = document.getElementById('filter-patient-statut').value;
  const el = document.getElementById('patients-list');

  const filtered = DB.patients.filter(p => {
    const matchQ = (p.prenom + ' ' + p.nom).toLowerCase().includes(q) || (p.motif || '').toLowerCase().includes(q);
    return matchQ && (!st || p.statut === st);
  });

  if (!filtered.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="ei">◈</div>
      <p>${DB.patients.length === 0 ? 'Aucun patient enregistré' : `Aucun résultat pour « ${q} »`}</p>
      ${DB.patients.length === 0 ? `<button class="btn btn-primary" onclick="openModal('modal-patient')">+ Ajouter un patient</button>` : ''}
    </div>`;
    return;
  }

  el.innerHTML = filtered.map(p => {
    const ini = (p.prenom[0] + p.nom[0]).toUpperCase();
    const nb  = DB.seances.filter(s => s.patientId === p.id && s.statut === 'honoré').length;
    return `<div class="patient-card" onclick="viewPatient('${p.id}')">
      <div class="avatar">${ini}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:15px;font-weight:500;">${p.prenom} ${p.nom.toUpperCase()}</div>
        <div style="font-size:12px;color:var(--warm-mid);margin-top:2px;">${p.motif || 'Motif non précisé'} · ${nb} séance${nb > 1 ? 's' : ''}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
        <span class="badge badge-${p.statut === 'actif' ? 'actif' : 'annulé'}" style="font-size:10px;">${p.statut}</span>
        <span style="font-family:var(--font-serif);font-size:16px;">${p.tarif} €</span>
      </div>
    </div>`;
  }).join('');
}


// ════════════════════════════════════════════════════════
// SÉANCES
// ════════════════════════════════════════════════════════

function resetSeanceForm() {
  document.getElementById('s-edit-id').value        = '';
  document.getElementById('s-return-patient').value = '';
  document.getElementById('ms-title').textContent   = 'Nouvelle séance';
  populateSelectPat('s-patient');
  document.getElementById('s-date').value     = today();
  document.getElementById('s-heure').value    = '10:00';
  document.getElementById('s-duree').value    = '60';
  document.getElementById('s-tarif').value    = CFG.tarif || 60;
  document.getElementById('s-statut').value   = 'planifié';
  document.getElementById('s-paiement').value = '';
  document.getElementById('s-notes').value    = '';
  document.getElementById('s-recurrence').checked = false;
  toggleRecurrence();
}

function toggleRecurrence() {
  const on = document.getElementById('s-recurrence').checked;
  document.getElementById('recurrence-box').style.display = on ? 'block' : 'none';
  if (on) updateRecurrencePreview();
}

function switchRecMode(mode, btn) {
  document.getElementById('rec-tab-intervalle').style.display = mode === 'intervalle' ? '' : 'none';
  document.getElementById('rec-tab-jourhebdo').style.display  = mode === 'jourhebdo'  ? '' : 'none';
  document.querySelectorAll('#recurrence-box .tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateRecurrencePreview();
}

function getRecMode() {
  const el = document.getElementById('rec-tab-jourhebdo');
  return (el && el.style.display !== 'none') ? 'jourhebdo' : 'intervalle';
}

function calcDatesJourHebdo(startDate) {
  const jours    = Array.from(document.querySelectorAll('#rec-jours-semaine input:checked')).map(cb => parseInt(cb.value));
  if (!jours.length) return [];
  const freq     = parseInt(document.getElementById('s-rec-semaine-freq').value) || 1;
  const count    = parseInt(document.getElementById('s-rec-count-hebdo').value)  || 4;
  const debutStr = document.getElementById('s-rec-debut-hebdo').value || startDate;
  if (!debutStr) return [];

  const results    = [];
  const debut      = new Date(debutStr);
  const lundiDebut = new Date(debut);
  lundiDebut.setDate(debut.getDate() - ((debut.getDay() + 6) % 7));

  let semaine = 0;
  while (results.length < count) {
    const ds = new Date(lundiDebut);
    ds.setDate(lundiDebut.getDate() + semaine * 7);
    jours.forEach(dow => {
      if (results.length >= count) return;
      const date = new Date(ds);
      date.setDate(ds.getDate() + (dow - 1 + 7) % 7);
      const str = date.toISOString().split('T')[0];
      if (str >= debutStr) results.push(str);
    });
    semaine += freq;
    if (semaine > 500) break;
  }
  return results.sort((a, b) => a.localeCompare(b)).slice(0, count);
}

function updateRecurrencePreview() {
  const startDate = document.getElementById('s-date').value;
  const mode      = getRecMode();

  if (mode === 'jourhebdo') {
    const dates = calcDatesJourHebdo(startDate);
    document.getElementById('rec-preview').innerHTML = dates.length
      ? `<strong>${dates.length} séances</strong> planifiées :<br>${dates.map(formatDateShort).join(' · ')}`
      : '';
    return;
  }
  const freq  = parseInt(document.getElementById('s-rec-freq').value)  || 7;
  const count = parseInt(document.getElementById('s-rec-count').value) || 4;
  if (!startDate || count < 1) { document.getElementById('rec-preview').textContent = ''; return; }
  const dates = [formatDateShort(startDate)];
  for (let i = 1; i < count; i++) dates.push(formatDateShort(addDays(startDate, freq * i)));
  document.getElementById('rec-preview').innerHTML = `<strong>${count} séances</strong> planifiées :<br>${dates.join(' · ')}`;
}

document.getElementById('s-patient').addEventListener('change', function () {
  const p = DB.patients.find(p => p.id === this.value);
  if (p) document.getElementById('s-tarif').value = p.tarif;
});

function saveSeance() {
  const patientId = document.getElementById('s-patient').value;
  const date      = document.getElementById('s-date').value;
  const heure     = document.getElementById('s-heure').value;
  if (!patientId || !date || !heure) { alert('Patient, date et heure sont requis.'); return; }

  const id       = document.getElementById('s-edit-id').value;
  const returnTo = document.getElementById('s-return-patient').value;
  const duree    = parseInt(document.getElementById('s-duree').value);
  const base     = {
    patientId, date, heure, duree,
    tarif:    parseFloat(document.getElementById('s-tarif').value) || 60,
    statut:   document.getElementById('s-statut').value,
    paiement: document.getElementById('s-paiement').value,
    notes:    document.getElementById('s-notes').value.trim()
  };

  // Vérification : jour indisponible
  const indispoJour = (DB.indisponibilites || []).find(i => i.date === date && !i.heureDebut);
  const regleJour   = getIndispoRegleForDate(date);
  if (indispoJour || (regleJour && !regleJour.heureDebut)) {
    const motif = (indispoJour || regleJour)?.motif;
    if (!confirm(`⚠ Le ${formatDate(date)} est marqué indisponible${motif ? ` (${motif})` : ''}.\nContinuer quand même ?`)) return;
  }

  // Vérification : créneau indisponible
  const startMin    = toMin(heure), endMin = startMin + duree;
  const indispoSlot = (DB.indisponibilites || []).find(i => {
    if (i.date !== date || !i.heureDebut) return false;
    const ie = toMin(i.heureFin || i.heureDebut) + (i.duree || 60);
    return startMin < ie && endMin > toMin(i.heureDebut);
  });
  if (indispoSlot) {
    if (!confirm(`⚠ Ce créneau chevauche une indisponibilité (${indispoSlot.heureDebut}${indispoSlot.motif ? ' — ' + indispoSlot.motif : ''}).\nContinuer quand même ?`)) return;
  }

  // Vérification : chevauchement avec d'autres séances
  const recur = !id && document.getElementById('s-recurrence').checked;
  const mode  = getRecMode();
  let datesToCheck = [date];
  if (recur) {
    datesToCheck = mode === 'jourhebdo'
      ? calcDatesJourHebdo(date)
      : Array.from({ length: parseInt(document.getElementById('s-rec-count').value) || 1 },
          (_, i) => addDays(date, (parseInt(document.getElementById('s-rec-freq').value) || 7) * i));
  }
  const conflicts = [];
  datesToCheck.forEach(d => {
    DB.seances.filter(s => s.date === d && s.id !== id && s.statut !== 'annulé').forEach(s => {
      if (startMin < toMin(s.heure) + s.duree && endMin > toMin(s.heure)) conflicts.push(s);
    });
  });
  if (conflicts.length) {
    const detail = conflicts.map(s => `• ${formatDate(s.date)} à ${s.heure} (${getPatientName(s.patientId, false)}, ${s.duree} min)`).join('\n');
    if (!confirm(`⚠ Chevauchement avec ${conflicts.length} séance(s) :\n${detail}\n\nContinuer quand même ?`)) return;
  }

  // Enregistrement
  if (id) {
    const idx = DB.seances.findIndex(s => s.id === id);
    if (idx > -1) { base.id = id; base.facture = DB.seances[idx].facture; DB.seances[idx] = base; }
  } else if (recur) {
    if (mode === 'jourhebdo') {
      const dates = calcDatesJourHebdo(date);
      if (!dates.length) { alert('Sélectionnez au moins un jour de semaine.'); return; }
      dates.forEach(d => DB.seances.push({ ...base, id: uid(), facture: null, date: d }));
    } else {
      const freq2  = parseInt(document.getElementById('s-rec-freq').value)  || 7;
      const count2 = parseInt(document.getElementById('s-rec-count').value) || 1;
      for (let i = 0; i < count2; i++) DB.seances.push({ ...base, id: uid(), facture: null, date: addDays(date, freq2 * i) });
    }
  } else {
    base.id = uid(); base.facture = null; DB.seances.push(base);
  }

  void dbSave(); closeModal('modal-seance');
  if (returnTo) viewPatient(returnTo, _ficheReturnPage); else { renderSeances(); renderDashboard(); }
  toast('Séance(s) enregistrée(s) ✓', 'success');
}

function editSeance(id) {
  const s = DB.seances.find(s => s.id === id); if (!s) return;
  openModal('modal-seance');
  setTimeout(() => {
    document.getElementById('s-edit-id').value       = id;
    document.getElementById('ms-title').textContent  = 'Modifier la séance';
    document.getElementById('s-patient').value       = s.patientId;
    document.getElementById('s-date').value          = s.date;
    document.getElementById('s-heure').value         = s.heure;
    document.getElementById('s-duree').value         = s.duree;
    document.getElementById('s-tarif').value         = s.tarif;
    document.getElementById('s-statut').value        = s.statut;
    document.getElementById('s-paiement').value      = s.paiement || '';
    document.getElementById('s-notes').value         = s.notes    || '';
    document.getElementById('s-recurrence').checked = false;
    toggleRecurrence();
  }, 50);
}

function deleteSeance(id) {
  if (!confirm('Supprimer cette séance ?')) return;
  const returnTo = document.getElementById('s-return-patient').value;
  DB.seances = DB.seances.filter(s => s.id !== id);
  void dbSave(); closeModal('modal-seance-view');
  if (returnTo) { refreshFicheSeances(returnTo); renderDashboard(); }
  else { renderSeances(); renderDashboard(); }
  toast('Séance supprimée');
}

function marquerStatut(id, statut) {
  const s = DB.seances.find(s => s.id === id); if (!s) return;
  if (statut === 'réglée') { openModalReglement(id); return; }
  s.statut = statut; void dbSave();
  const returnTo = document.getElementById('s-return-patient').value;
  closeModal('modal-seance-view');
  if (returnTo) { refreshFicheSeances(returnTo); viewSeanceFromFiche(id, returnTo); }
  else { renderSeances(); renderDashboard(); }
  toast('Statut mis à jour ✓', 'success');
}

function openModalReglement(seanceId) {
  const s = DB.seances.find(s => s.id === seanceId); if (!s) return;
  document.getElementById('reg-seance-id').value = seanceId;
  document.getElementById('reg-date').value      = s.dateReglement || s.date;
  document.getElementById('reg-paiement').value  = s.paiement || '';
  document.getElementById('modal-reglement').classList.remove('hidden');
}

function confirmerReglement() {
  const seanceId = document.getElementById('reg-seance-id').value;
  const s        = DB.seances.find(s => s.id === seanceId); if (!s) return;
  const dateReg  = document.getElementById('reg-date').value;
  if (!dateReg) { alert('Veuillez indiquer la date de règlement.'); return; }
  s.statut        = 'réglée';
  s.dateReglement = dateReg;
  s.paiement      = document.getElementById('reg-paiement').value;
  void dbSave();
  document.getElementById('modal-reglement').classList.add('hidden');
  const returnTo = document.getElementById('s-return-patient').value;
  closeModal('modal-seance-view');
  if (returnTo) { refreshFicheSeances(returnTo); viewSeanceFromFiche(seanceId, returnTo); }
  else { renderSeances(); renderDashboard(); }
  toast('Séance marquée réglée ✓', 'success');
}

function viewSeance(id, returnPatientId = '') {
  const s = DB.seances.find(s => s.id === id); if (!s) return;
  if (returnPatientId) document.getElementById('s-return-patient').value = returnPatientId;
  const pn = getPatientName(s.patientId);

  const btns = `
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1.25rem;border-top:1px solid var(--beige-mid);padding-top:1.25rem;">
      <button class="btn btn-secondary btn-sm" onclick="closeModal('modal-seance-view');editSeance('${id}')">✎ Modifier</button>
      <button class="btn btn-secondary btn-sm" onclick="openSuiviSeance('${id}')">📋 Suivi</button>
      ${s.statut === 'planifié' ? `
        <button class="btn btn-success btn-sm" onclick="marquerStatut('${id}','honoré')">✓ Honorée</button>
        <button class="btn btn-info btn-sm" onclick="openModalReglement('${id}')">💶 Honorée et Réglée</button>
        <button class="btn btn-danger btn-sm" onclick="marquerStatut('${id}','annulé')">✕ Annuler</button>` : ''}
      ${s.statut === 'honoré' ? `<button class="btn btn-info btn-sm" onclick="marquerStatut('${id}','réglée')">💶 Marquer réglée</button>` : ''}
      ${s.statut === 'réglée' && !s.facture ? `<button class="btn btn-primary btn-sm" onclick="closeModal('modal-seance-view');genFactureFromSeance('${id}')">📄 Générer facture</button>` : ''}
      ${s.statut === 'réglée' &&  s.facture ? `<button class="btn btn-secondary btn-sm" onclick="closeModal('modal-seance-view');viewFacture('${s.facture}')">📄 Voir la facture</button>` : ''}
      <button class="btn btn-danger btn-xs" style="margin-left:auto;" onclick="deleteSeance('${id}')">Supprimer</button>
    </div>`;

  document.getElementById('seance-view-content').innerHTML = `
    <h2 class="modal-title">Séance du ${formatDate(s.date)}</h2>
    <div style="display:grid;gap:.75rem;font-size:14px;">
      <div style="display:flex;gap:.75rem;"><span style="color:var(--warm-mid);min-width:110px;">Patient</span><strong>${pn}</strong></div>
      <div style="display:flex;gap:.75rem;"><span style="color:var(--warm-mid);min-width:110px;">Date & Heure</span><span>${formatDate(s.date)} à ${s.heure}</span></div>
      <div style="display:flex;gap:.75rem;"><span style="color:var(--warm-mid);min-width:110px;">Durée</span><span>${s.duree} min</span></div>
      <div style="display:flex;gap:.75rem;"><span style="color:var(--warm-mid);min-width:110px;">Tarif</span><span style="font-family:var(--font-serif);font-size:17px;">${s.tarif} €</span></div>
      <div style="display:flex;gap:.75rem;align-items:center;"><span style="color:var(--warm-mid);min-width:110px;">Statut</span><span class="badge badge-${s.statut}">${s.statut}</span></div>
      ${s.paiement      ? `<div style="display:flex;gap:.75rem;"><span style="color:var(--warm-mid);min-width:110px;">Paiement</span><span>${s.paiement}</span></div>` : ''}
      ${s.dateReglement ? `<div style="display:flex;gap:.75rem;"><span style="color:var(--warm-mid);min-width:110px;">Réglé le</span><span>${formatDate(s.dateReglement)}</span></div>` : ''}
      ${s.facture       ? `<div style="display:flex;gap:.75rem;align-items:center;"><span style="color:var(--warm-mid);min-width:110px;">Facture</span><span class="badge badge-réglée">Facturée</span></div>` : ''}
    </div>
    ${s.notes ? `<div style="margin-top:1rem;"><div class="section-title">Notes</div><div class="notes-block">${s.notes}</div></div>` : ''}
    ${btns}`;

  document.getElementById('modal-seance-view').classList.remove('hidden');
}

function genFactureFromSeance(seanceId) {
  const s = DB.seances.find(s => s.id === seanceId); if (!s) return;
  openModal('modal-facture');
  setTimeout(() => {
    document.getElementById('f-patient').value = s.patientId;
    populateFactureSeances();
    setTimeout(() => {
      const cb = document.querySelector(`.f-cb[value="${seanceId}"]`);
      if (cb) { cb.checked = true; updateFTotal(); }
    }, 50);
  }, 100);
}

function populateFilterPat() {
  document.getElementById('filter-pat').innerHTML = '<option value="">Tous les patients</option>' +
    DB.patients.map(p => `<option value="${p.id}">${p.prenom} ${p.nom.toUpperCase()}</option>`).join('');
}

function populateSelectPat(selId) {
  document.getElementById(selId).innerHTML = '<option value="">— Sélectionner —</option>' +
    DB.patients.map(p => `<option value="${p.id}">${p.prenom} ${p.nom.toUpperCase()}</option>`).join('');
}

function renderSeances() {
  const st   = document.getElementById('filter-statut').value;
  const pid  = document.getElementById('filter-pat').value;
  const fdat = document.getElementById('filter-date').value;

  let list = [...DB.seances].sort((a, b) => a.date.localeCompare(b.date) || a.heure.localeCompare(b.heure));
  if (st)   list = list.filter(s => s.statut === st);
  if (pid)  list = list.filter(s => s.patientId === pid);
  if (fdat) list = list.filter(s => s.date === fdat);

  const el               = document.getElementById('seances-list');
  const indisposDuFiltre = fdat ? (DB.indisponibilites || []).filter(i => i.date === fdat) : [];

  if (!list.length && !indisposDuFiltre.length) {
    el.innerHTML = `<div class="empty-state"><div class="ei">◷</div><p>Aucune séance${fdat ? ' ce jour' : ''}</p>
      <button class="btn btn-primary" onclick="openModal('modal-seance')">+ Ajouter</button></div>`;
    return;
  }

  const mkBlock = (i, prefix = '') => {
    const txt = `${prefix ? prefix + ' — ' : ''}Indisponible${i.heureDebut ? ' ' + i.heureDebut + (i.heureFin ? '–' + i.heureFin : '') : ' — journée entière'}${i.motif ? ' · ' + i.motif : ''}`;
    return `<div class="indispo-block"><span>⛔ ${txt}</span><button class="btn btn-danger btn-xs" onclick="deleteIndispo('${i.id}')">Supprimer</button></div>`;
  };

  let html = '';
  indisposDuFiltre.forEach(i => { html += mkBlock(i); });

  let lastDate = null;
  list.forEach(s => {
    if (!fdat && s.date !== lastDate) {
      (DB.indisponibilites || []).filter(i => i.date === s.date).forEach(i => { html += mkBlock(i, formatDate(s.date)); });
      lastDate = s.date;
    }
    const [, m, j] = s.date.split('-');
    html += `<div class="rdv-item" onclick="viewSeance('${s.id}')">
      <div class="rdv-date"><div class="day">${parseInt(j)}</div><div class="month">${MOIS_SHORT[parseInt(m) - 1]}</div></div>
      <div style="flex:1;">
        <div style="font-size:14px;font-weight:500;">${getPatientName(s.patientId)}</div>
        <div style="font-size:12px;color:var(--warm-mid);margin-top:2px;">${s.heure} · ${s.duree} min${s.paiement ? ' · ' + s.paiement : ''}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
        <span class="badge badge-${s.statut}">${s.statut}</span>
        <span style="font-family:var(--font-serif);font-size:17px;">${s.tarif} €</span>
      </div>
    </div>`;
  });

  if (!fdat) {
    const datesAvec = new Set(list.map(s => s.date));
    (DB.indisponibilites || []).filter(i => !datesAvec.has(i.date)).sort((a, b) => a.date.localeCompare(b.date))
      .forEach(i => { html += mkBlock(i, formatDate(i.date)); });
  }

  el.innerHTML = html;

  // Règles récurrentes
  const summaryEl = document.getElementById('indispo-regles-summary');
  if (!summaryEl) return;
  const regles = DB.indisponibilites_regles || [];
  if (!regles.length) { summaryEl.innerHTML = ''; return; }
  const JOURS   = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'];
  const freqLbl = f => f <= 1 ? 'toutes les semaines' : `1 semaine sur ${f}`;
  summaryEl.innerHTML = `<div style="margin-top:1.5rem;">
    <div class="section-title" style="margin-bottom:.5rem;">Règles d'indisponibilité récurrentes</div>
    ${regles.map(r => `<div class="indispo-block">
      <span>🔁 <strong>${r.jours.map(j => JOURS[j]).join(', ')}</strong>, ${freqLbl(r.freq)}${r.heureDebut ? ` · ${r.heureDebut}${r.heureFin ? '–' + r.heureFin : ''}` : ' · journée entière'}${r.motif ? ' · <em>' + r.motif + '</em>' : ''}<br>
      <small style="color:var(--warm-mid);">${formatDate(r.debut)}${r.fin ? ' → ' + formatDate(r.fin) : ' → indéfiniment'}</small></span>
      <button class="btn btn-danger btn-xs" onclick="deleteIndispoRegle('${r.id}')">Supprimer</button>
    </div>`).join('')}
  </div>`;
}


// ════════════════════════════════════════════════════════
// INDISPONIBILITÉS
// ════════════════════════════════════════════════════════

function openModalIndispo() {
  document.getElementById('indispo-date').value        = document.getElementById('filter-date').value || today();
  document.getElementById('indispo-rec-debut').value   = today();
  document.getElementById('indispo-rec-fin').value     = '';
  document.getElementById('indispo-heure-debut').value = '';
  document.getElementById('indispo-heure-fin').value   = '';
  document.getElementById('indispo-motif').value       = '';
  document.getElementById('indispo-journee').checked   = true;
  document.getElementById('indispo-rec-freq').value    = '1';
  document.querySelectorAll('#indispo-jours-semaine input').forEach(cb => cb.checked = false);
  switchIndispoType('ponctuelle', document.querySelector('#modal-indispo .tab-btn'));
  toggleIndispoJournee();
  document.getElementById('modal-indispo').classList.remove('hidden');
}

function switchIndispoType(type, btn) {
  document.getElementById('indispo-tab-ponctuelle').style.display = type === 'ponctuelle' ? '' : 'none';
  document.getElementById('indispo-tab-recurrente').style.display = type === 'recurrente' ? '' : 'none';
  document.querySelectorAll('#modal-indispo .tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function toggleIndispoJournee() {
  const full = document.getElementById('indispo-journee').checked;
  document.getElementById('indispo-créneau-group').style.display = full ? 'none' : 'flex';
}

function saveIndispo() {
  const full       = document.getElementById('indispo-journee').checked;
  const heureDebut = full ? null : document.getElementById('indispo-heure-debut').value;
  const heureFin   = full ? null : document.getElementById('indispo-heure-fin').value;
  const motif      = document.getElementById('indispo-motif').value.trim();
  const isRec      = document.querySelector('#indispo-tab-recurrente').style.display !== 'none';

  if (isRec) {
    const jours = Array.from(document.querySelectorAll('#indispo-jours-semaine input:checked')).map(cb => parseInt(cb.value));
    if (!jours.length) { alert('Sélectionnez au moins un jour.'); return; }
    const debut = document.getElementById('indispo-rec-debut').value;
    if (!debut) { alert('Date de début requise.'); return; }
    DB.indisponibilites_regles.push({
      id: uid(), jours,
      freq:  parseInt(document.getElementById('indispo-rec-freq').value) || 1,
      debut, fin: document.getElementById('indispo-rec-fin').value || null,
      heureDebut, heureFin, motif
    });
    const JOURS = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'];
    toast(`Règle récurrente enregistrée (${jours.map(j => JOURS[j]).join(', ')}) ✓`, 'success');
  } else {
    const date = document.getElementById('indispo-date').value;
    if (!date) { alert('Date requise.'); return; }
    DB.indisponibilites.push({ id: uid(), date, heureDebut, heureFin, motif });
    toast('Indisponibilité enregistrée ✓', 'success');
  }

  void dbSave();
  document.getElementById('modal-indispo').classList.add('hidden');
  renderSeances(); renderCalendar();
}

function deleteIndispo(id) {
  if (!confirm('Supprimer cette indisponibilité ?')) return;
  DB.indisponibilites = DB.indisponibilites.filter(i => i.id !== id);
  void dbSave(); renderSeances(); renderCalendar();
  toast('Indisponibilité supprimée');
}

function deleteIndispoRegle(id) {
  if (!confirm('Supprimer cette règle récurrente ?')) return;
  DB.indisponibilites_regles = DB.indisponibilites_regles.filter(r => r.id !== id);
  void dbSave(); renderSeances(); renderCalendar();
  toast('Règle supprimée');
}

// Retourne la règle récurrente couvrant une date, ou null
function getIndispoRegleForDate(dateStr) {
  const d      = new Date(dateStr);
  const dow    = d.getDay();
  const lundi  = new Date(d);
  lundi.setDate(d.getDate() - ((d.getDay() + 6) % 7));

  for (const r of (DB.indisponibilites_regles || [])) {
    if (!r.jours.includes(dow))   continue;
    if (dateStr < r.debut)        continue;
    if (r.fin && dateStr > r.fin) continue;
    if (r.freq <= 1) return r;
    const lundiDebut = new Date(r.debut);
    lundiDebut.setDate(lundiDebut.getDate() - ((lundiDebut.getDay() + 6) % 7));
    const diffSemaines = Math.round((lundi - lundiDebut) / (7 * 86400000));
    if (diffSemaines % r.freq === 0) return r;
  }
  return null;
}


// ════════════════════════════════════════════════════════
// FACTURES
// ════════════════════════════════════════════════════════

function initFactureModal() {
  populateSelectPat('f-patient');
  const ech = new Date(); ech.setDate(ech.getDate() + (CFG.delai || 30));
  document.getElementById('f-date').value     = today();
  document.getElementById('f-echeance').value = ech.toISOString().split('T')[0];
  document.getElementById('f-objet').value    = 'Séances de psychothérapie';
  document.getElementById('f-total-preview').textContent = '0,00 €';
  document.getElementById('f-seances-select').innerHTML  = `<div style="color:var(--warm-mid);font-size:13px;padding:.5rem;">Sélectionnez un patient d'abord</div>`;
  document.getElementById('cfg-warn').style.display = (!CFG.siret || !CFG.adresse) ? 'block' : 'none';
}

function populateFactureSeances() {
  const pId   = document.getElementById('f-patient').value;
  const c     = document.getElementById('f-seances-select');
  const toutes = document.getElementById('f-filtre-toutes')?.checked;

  if (!pId) {
    c.innerHTML = `<div style="color:var(--warm-mid);font-size:13px;padding:.5rem;">Sélectionnez un patient d'abord</div>`;
    document.getElementById('f-total-preview').textContent = '0,00 €';
    return;
  }

  // En mode "Toutes" : toutes les séances non encore facturées, quel que soit le statut
  // En mode normal : uniquement honorées et réglées
  const seances = DB.seances.filter(s => {
    if (s.patientId !== pId || s.facture) return false;
    if (toutes) return s.statut !== 'annulé';
    return s.statut === 'réglée' || s.statut === 'honoré';
  }).sort((a, b) => a.date.localeCompare(b.date));

  if (!seances.length) {
    const msg = toutes
      ? 'Aucune séance non facturée pour ce patient.'
      : 'Aucune séance honorée/réglée non facturée. Cochez "Toutes les séances" pour voir les séances planifiées.';
    c.innerHTML = `<div style="color:var(--warm-mid);font-size:13px;padding:.5rem;">${msg}</div>`;
    document.getElementById('f-total-preview').textContent = '0,00 €';
    return;
  }

  c.innerHTML = seances.map(s => `
    <label style="display:flex;align-items:center;gap:.75rem;padding:.5rem;cursor:pointer;border-radius:6px;"
      onmouseover="this.style.background='var(--beige)'" onmouseout="this.style.background=''">
      <input type="checkbox" class="f-cb" value="${s.id}" data-tarif="${s.tarif}" onchange="updateFTotal()" style="width:auto;accent-color:var(--sage);">
      <span style="flex:1;font-size:13px;">
        ${formatDate(s.date)} à ${s.heure} — ${s.duree} min
        ${s.paiement ? `<span style="color:var(--warm-mid);"> · ${s.paiement}</span>` : `<span style="color:var(--terra);font-size:11px;"> · règlement non défini</span>`}
        <span class="badge badge-${s.statut}" style="font-size:10px;margin-left:4px;">${s.statut}</span>
      </span>
      <span style="font-family:var(--font-serif);font-size:15px;">${s.tarif} €</span>
    </label>`).join('');
  updateFTotal();
}

function updateFTotal() {
  const total = Array.from(document.querySelectorAll('.f-cb:checked')).reduce((a, cb) => a + parseFloat(cb.dataset.tarif), 0);
  document.getElementById('f-total-preview').textContent = fmtMoney(total);
}

function genererFacture() {
  const pId = document.getElementById('f-patient').value;
  const cbs = document.querySelectorAll('.f-cb:checked');
  if (!pId || !cbs.length) { alert('Sélectionnez un patient et au moins une séance.'); return; }
  if (!CFG.siret)           { alert('SIRET requis. Complétez vos paramètres.'); return; }

  const ids     = Array.from(cbs).map(cb => cb.value);
  const seances = ids.map(id => DB.seances.find(s => s.id === id)).filter(Boolean);

  // Vérifier les séances sans mode de paiement
  const sansMode = seances.filter(s => !s.paiement);
  if (sansMode.length) {
    // Ouvrir le modal de confirmation du mode de paiement
    document.getElementById('fp-nb-seances').textContent = sansMode.length;
    document.getElementById('fp-paiement').value = '';
    document.getElementById('modal-facture-paiement').classList.remove('hidden');
    // Stocker les IDs pour reprise après confirmation
    document.getElementById('modal-facture-paiement').dataset.ids = JSON.stringify(ids);
    document.getElementById('modal-facture-paiement').dataset.pId = pId;
    return;
  }

  _doGenererFacture(pId, ids);
}

function confirmerPaiementEtFacturer() {
  const paiement = document.getElementById('fp-paiement').value;
  if (!paiement) { alert('Sélectionnez un mode de règlement.'); return; }

  const modal   = document.getElementById('modal-facture-paiement');
  const ids     = JSON.parse(modal.dataset.ids || '[]');
  const pId     = modal.dataset.pId;

  // Appliquer le mode de paiement aux séances concernées
  ids.forEach(id => {
    const s = DB.seances.find(s => s.id === id);
    if (s && !s.paiement) s.paiement = paiement;
  });

  modal.classList.add('hidden');
  _doGenererFacture(pId, ids);
}

function _doGenererFacture(pId, ids) {
  const seances = ids.map(id => DB.seances.find(s => s.id === id)).filter(Boolean);
  const total   = seances.reduce((a, s) => a + s.tarif, 0);

  // Numérotation ANNEE-MM-JJ-XX (date de la première séance)
  const firstDate    = [...seances].sort((a, b) => a.date.localeCompare(b.date))[0]?.date || today();
  const [fy, fm, fj] = firstDate.split('-');
  const num          = `${fy}-${fm}-${fj}-${String(DB.nextNum).padStart(2, '0')}`;
  DB.nextNum++;

  const paiements = [...new Set(seances.map(s => s.paiement).filter(Boolean))];
  const f = {
    id: uid(), num, patientId: pId, seancesIds: ids,
    date:             document.getElementById('f-date').value,
    echeance:         document.getElementById('f-echeance').value,
    objet:            document.getElementById('f-objet').value,
    paiementsSeances: paiements, total,
    createdAt:        new Date().toISOString()
  };

  DB.factures.push(f);
  // Marquer les séances comme "facturée" (statut distinct)
  ids.forEach(id => {
    const s = DB.seances.find(s => s.id === id);
    if (s) { s.facture = f.id; s.statut = 'facturé'; }
  });

  void dbSave(); closeModal('modal-facture'); renderFactures();
  toast(`Facture ${num} générée ✓`, 'success');
  setTimeout(() => viewFacture(f.id), 300);
}

// Construit le HTML de la facture (aperçu + impression)
function buildInvoice(f) {
  const p       = DB.patients.find(p => p.id === f.patientId);
  const seances = f.seancesIds.map(sid => DB.seances.find(s => s.id === sid)).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
  const pName   = p ? `${p.prenom} ${p.nom.toUpperCase()}` : '—';
  const isTVA   = CFG.tvaMention && !CFG.tvaMention.startsWith('Exonéré') && !CFG.tvaMention.startsWith('TVA non applicable');
  const ht      = isTVA ? f.total / 1.20 : f.total;
  const tva     = isTVA ? f.total - f.total / 1.20 : 0;
  const adr     = [CFG.adresse, CFG.cp && CFG.ville ? `${CFG.cp} ${CFG.ville}` : ''].filter(Boolean).join('<br>');

  // Infos de règlement (dédupliquées) — statut réglée ou facturé
  const toutesReglees = seances.every(s => s.statut === 'réglée' || s.statut === 'facturé');
  const regUniques    = [...new Map(
    seances.filter(s => (s.statut === 'réglée' || s.statut === 'facturé') && s.dateReglement)
           .map(s => [`${s.dateReglement}|${s.paiement || ''}`, { date: s.dateReglement, mode: s.paiement || '' }])
  ).values()];

  // Section totaux
  const totalSection = `<div class="inv-total-section">
    <div class="inv-total-row">
      <span class="inv-total-label">Total HT</span>
      <span class="inv-total-value">${fmtMoney(ht)}</span>
    </div>
    ${isTVA ? `<div class="inv-total-row"><span class="inv-total-label">TVA (20 %)</span><span class="inv-total-value">${fmtMoney(tva)}</span></div>` : ''}
    <div class="inv-total-row" style="border-top:1px solid var(--beige-mid);padding-top:.5rem;margin-top:.25rem;">
      <span class="inv-total-label inv-grand-total-label">${toutesReglees && regUniques.length ? 'Total TTC' : 'Total TTC à régler'}</span>
      <span class="inv-total-value inv-grand-total-value">${fmtMoney(f.total)}</span>
    </div>
  </div>`;

  // Modalités de règlement : uniquement les modes réels, jamais le fallback CFG.paiements
  const regModes = f.paiementsSeances?.length ? f.paiementsSeances.join(', ') : '';
  const regLine  = toutesReglees && regUniques.length
    ? (regUniques.length === 1
        ? `<span style="color:var(--sage-dark);font-weight:500;">✓ Réglé le ${formatDate(regUniques[0].date)}${regUniques[0].mode ? `, ${fmtMoney(f.total)} par ${regUniques[0].mode}` : ` — ${fmtMoney(f.total)}`}</span><br>`
        : regUniques.map(r => `<span style="color:var(--sage-dark);font-weight:500;">✓ Réglé le ${formatDate(r.date)}${r.mode ? ' par ' + r.mode : ''}</span>`).join('<br>') + '<br>')
    : (regModes ? `Mode de règlement : ${regModes}<br>` : '');

  const payBlock = `<div class="inv-payment-block">
    <strong>Modalités de règlement</strong><br>
    ${regLine}
    ${CFG.iban ? `IBAN : ${CFG.iban}<br>` : ''}
    ${CFG.bic  ? `BIC : ${CFG.bic}${CFG.banque ? ' (' + CFG.banque + ')' : ''}<br>` : ''}
    Référence Facture : ${f.num} – ${pName}
  </div>`;

  const lignes = seances.map(s => `<tr>
    <td>${formatDate(s.date)}</td>
    <td>${f.objet || 'Séance de psychothérapie'} – ${s.duree} min</td>
    <td style="text-align:center;">1</td>
    <td style="text-align:right;font-family:var(--font-serif);">${fmtMoney(s.tarif)}</td>
    <td style="text-align:right;font-family:var(--font-serif);">${fmtMoney(s.tarif)}</td>
  </tr>`).join('');

  // Logo limité à 64px de hauteur pour ne pas envahir l'en-tête
  const logoHtml = CFG.logo
    ? `<img src="${CFG.logo}" alt="Logo" style="max-height:128px;max-width:300px;object-fit:contain;flex-shrink:0;">`
    : '';

  return `<div class="invoice-preview" id="printable-invoice">
    <div class="inv-header">
      <div style="display:flex;align-items:flex-start;gap:.85rem;">
        ${logoHtml}
        <div>
          <div class="inv-logo-name">${CFG.prenom} ${CFG.nom.toUpperCase()}</div>
          <div class="inv-logo-sub">${CFG.titre || 'Psychothérapeute'}${CFG.formation ? ' · ' + CFG.formation : ''}</div>
          <div style="margin-top:.75rem;font-size:12px;color:var(--warm-mid);line-height:1.7;">
            ${adr}${CFG.tel ? '<br>' + CFG.tel : ''}${CFG.email ? '<br>' + CFG.email : ''}
          </div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:10px;color:var(--warm-mid);font-weight:500;text-transform:uppercase;letter-spacing:.06em;">Facture</div>
        <div style="font-size:20px;font-family:var(--font-serif);color:var(--warm-dark);margin:.2rem 0;">${f.num}</div>
        <div style="font-size:12px;color:var(--warm-mid);line-height:1.7;">
          Émise le : ${formatDate(f.date)}<br>
          Échéance : ${formatDate(f.echeance)}
        </div>
      </div>
    </div>

    <div class="inv-parties">
      <div>
        <div class="inv-party-label">Émetteur</div>
        <div class="inv-party-name">${CFG.prenom} ${CFG.nom.toUpperCase()}</div>
        <div class="inv-party-detail">
          ${CFG.titre || ''}<br>
          SIRET : ${CFG.siret}
          ${CFG.tvaNum ? '<br>N° TVA : ' + CFG.tvaNum : ''}
        </div>
      </div>
      <div>
        <div class="inv-party-label">Destinataire / Patient</div>
        <div class="inv-party-name">${pName}</div>
        <div class="inv-party-detail">${p?.adresse || '<em style="color:var(--warm-light);">Adresse non renseignée</em>'}</div>
      </div>
    </div>

    <table class="inv-table">
      <thead><tr>
        <th style="width:18%;">Date</th>
        <th>Désignation</th>
        <th style="width:8%;text-align:center;">Qté</th>
        <th style="width:16%;text-align:right;">P.U. HT</th>
        <th style="width:16%;text-align:right;">Montant HT</th>
      </tr></thead>
      <tbody>${lignes}</tbody>
    </table>

    ${totalSection}
    ${CFG.tvaMention ? `<div class="inv-legal">${CFG.tvaMention}</div>` : ''}
    ${payBlock}
  </div>`;
}

function viewFacture(id) {
  const f = DB.factures.find(f => f.id === id); if (!f) return;
  document.getElementById('facture-view-content').innerHTML = buildInvoice(f);
  document.getElementById('modal-facture-view').dataset.factureId = id;
  document.getElementById('modal-facture-view').classList.remove('hidden');
}

function printFacture() {
  const id  = document.getElementById('modal-facture-view').dataset.factureId;
  const f   = DB.factures.find(f => f.id === id);
  const p   = f ? DB.patients.find(p => p.id === f.patientId) : null;
  const nom = p ? p.nom.toUpperCase().replace(/\s+/g, '-') : 'PATIENT';
  const s0  = f ? DB.seances.find(s => f.seancesIds.includes(s.id)) : null;
  const ds  = s0 ? s0.date.replace(/-/g, '') : (f?.date.replace(/-/g, '') || '');

  const content = document.getElementById('printable-invoice').outerHTML;
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Facture-${nom}-${ds}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
  <style>
  :root{--sage:#6b8f71;--sage-dark:#4a6b50;--sage-pale:#e8f0e9;--sage-light:#a8c4a2;--beige:#f7f3ee;--beige-mid:#ede5d8;--warm-dark:#3d3530;--warm-mid:#7a6e67;--warm-light:#b8afa8;--font-serif:'Cormorant Garamond',Georgia,serif;--font-sans:'DM Sans',system-ui,sans-serif;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:var(--font-sans);color:var(--warm-dark);padding:2cm;}
  .invoice-preview{max-width:100%;}
  .inv-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:2rem;}
  .inv-logo-name{font-family:var(--font-serif);font-size:22px;font-weight:400;color:var(--sage-dark);}
  .inv-logo-sub{font-size:11px;color:var(--warm-mid);text-transform:uppercase;letter-spacing:.08em;margin-top:2px;}
  .inv-parties{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1.75rem;padding:1.25rem;background:var(--beige);border-radius:8px;}
  .inv-party-label{font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:.08em;color:var(--warm-mid);margin-bottom:.4rem;}
  .inv-party-name{font-size:14px;font-weight:500;margin-bottom:.2rem;}
  .inv-party-detail{font-size:12px;color:var(--warm-mid);line-height:1.6;}
  .inv-table{width:100%;border-collapse:collapse;margin-bottom:1.5rem;font-size:13px;}
  .inv-table th{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--warm-mid);font-weight:500;border-bottom:1.5px solid var(--beige-mid);padding:.5rem .75rem;text-align:left;}
  .inv-table td{padding:.75rem;border-bottom:1px solid var(--beige-mid);}
  .inv-total-section{border-top:1.5px solid var(--beige-mid);padding-top:1rem;margin-bottom:1rem;}
  .inv-total-row{display:flex;justify-content:flex-end;margin-bottom:.4rem;}
  .inv-total-label{font-size:12px;color:var(--warm-mid);min-width:160px;text-align:right;margin-right:1rem;}
  .inv-total-value{font-size:14px;font-weight:500;min-width:90px;text-align:right;}
  .inv-grand-total-label{font-size:13px;font-weight:500;color:var(--warm-dark);}
  .inv-grand-total-value{font-family:var(--font-serif);font-size:22px;color:var(--sage-dark);}
  .inv-legal{font-size:11px;color:var(--warm-mid);background:var(--beige);padding:.6rem .85rem;border-radius:4px;margin-bottom:1rem;line-height:1.6;}
  .inv-payment-block{background:var(--sage-pale);border:1px solid var(--sage-light);border-radius:8px;padding:.75rem 1rem;font-size:12px;margin-bottom:1rem;line-height:1.7;}
  .inv-payment-block strong{color:var(--sage-dark);}
  </style></head><body>${content}</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 600);
}

function renderFactures() {
  const el = document.getElementById('factures-list');
  if (!DB.factures.length) {
    el.innerHTML = `<div class="card"><div class="empty-state"><div class="ei">◻</div><p>Aucune facture générée</p>
      <button class="btn btn-primary" onclick="openModal('modal-facture')">+ Créer une facture</button></div></div>`;
    return;
  }
  const sorted  = [...DB.factures].sort((a, b) => b.date.localeCompare(a.date));
  const totalCA = DB.factures.reduce((a, f) => a + f.total, 0);
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.25rem;">
      <div class="stat-card"><div class="stat-label">Factures émises</div><div class="stat-value">${DB.factures.length}</div></div>
      <div class="stat-card"><div class="stat-label">CA total facturé</div><div class="stat-value" style="font-size:22px;">${fmtNum(totalCA)} €</div></div>
    </div>
    <div class="card" style="padding:0;">
      ${sorted.map(f => {
        const pn = getPatientName(f.patientId);
        const pm = f.paiementsSeances?.length ? f.paiementsSeances.join(', ') : '—';
        return `<div class="invoice-row" onclick="viewFacture('${f.id}')">
          <div style="font-size:13px;font-weight:500;color:var(--sage-dark);min-width:100px;">${f.num}</div>
          <div style="flex:1;">
            <div style="font-size:14px;">${pn}</div>
            <div style="font-size:12px;color:var(--warm-mid);">${formatDate(f.date)} · ${f.seancesIds.length} séance${f.seancesIds.length > 1 ? 's' : ''} · ${pm}</div>
          </div>
          <div style="font-family:var(--font-serif);font-size:18px;text-align:right;">${fmtMoney(f.total)}</div>
        </div>`;
      }).join('')}
    </div>`;
}


// ════════════════════════════════════════════════════════
// TABLEAU DE BORD
// ════════════════════════════════════════════════════════

let calDate = new Date();
function calNav(dir) { calDate.setMonth(calDate.getMonth() + dir); renderCalendar(); }

function renderDashboard() {
  const now = new Date(), mo = now.getMonth(), yr = now.getFullYear();

  document.getElementById('st-p').textContent = DB.patients.filter(p => p.statut === 'actif').length;

  const seancesMois    = DB.seances.filter(s => { const d = new Date(s.date); return d.getMonth() === mo && d.getFullYear() === yr; });
  const honoreesMois   = seancesMois.filter(s => s.statut === 'honoré' || s.statut === 'réglée');
  const planifieesMois = seancesMois.filter(s => s.statut === 'planifié');
  document.getElementById('st-s').textContent = `${honoreesMois.length} / ${honoreesMois.length + planifieesMois.length}`;

  const regléesNF  = DB.seances.filter(s => s.statut === 'réglée' && !s.facture).length;
  const honoréesNF = DB.seances.filter(s => s.statut === 'honoré' && !s.facture).length;
  const totalFact  = regléesNF + honoréesNF;
  document.getElementById('st-f').textContent = `${regléesNF} / ${totalFact}`;
  const cardF = document.getElementById('st-f-card');
  cardF.style.cursor = totalFact > 0 ? 'pointer' : '';
  cardF.onclick      = totalFact > 0 ? showAFacturerModal : null;
  cardF.title        = totalFact > 0 ? 'Voir les séances à facturer' : '';
  cardF.classList.toggle('stat-card-clickable', totalFact > 0);

  const caR = honoreesMois.filter(s => s.statut === 'réglée').reduce((a, s) => a + s.tarif, 0);
  const caT = seancesMois.filter(s => s.statut !== 'annulé').reduce((a, s) => a + s.tarif, 0);
  document.getElementById('st-ca').textContent = `${fmtNum(caR)} / ${fmtNum(caT)} €`;

  renderCalendar(); renderUpcoming();
}

function goToPatients(statut) {
  showPage('patients', document.querySelectorAll('.nav-btn')[1]);
  document.getElementById('filter-patient-statut').value = statut || '';
  document.getElementById('search-patients').value = '';
  renderPatients();
}

function goToSeancesMois() {
  showPage('seances', document.querySelectorAll('.nav-btn')[2]);
  const now     = new Date();
  const moisStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  document.getElementById('filter-date').value   = '';
  document.getElementById('filter-statut').value = '';
  populateFilterPat();
  renderSeancesMois(moisStr);
}

function renderSeancesMois(moisStr) {
  const st  = document.getElementById('filter-statut').value;
  const pid = document.getElementById('filter-pat').value;
  let list  = [...DB.seances].filter(s => s.date.startsWith(moisStr)).sort((a, b) => a.date.localeCompare(b.date) || a.heure.localeCompare(b.heure));
  if (st)  list = list.filter(s => s.statut === st);
  if (pid) list = list.filter(s => s.patientId === pid);

  const [yr, mo] = moisStr.split('-');
  const label    = `${MOIS_NOMS[parseInt(mo) - 1]} ${yr}`;
  const el       = document.getElementById('seances-list');

  let html = `<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem;font-size:13px;color:var(--sage-dark);background:var(--sage-pale);border:1px solid var(--sage-light);border-radius:var(--radius-sm);padding:.4rem .75rem;">
    📅 Filtre : <strong>${label}</strong>
    <button class="btn btn-secondary btn-xs" style="margin-left:auto;" onclick="renderSeances()">✕ Retirer</button>
  </div>`;

  if (!list.length) {
    html += `<div class="empty-state"><div class="ei">◷</div><p>Aucune séance en ${label}</p></div>`;
  } else {
    list.forEach(s => {
      const [, m, j] = s.date.split('-');
      html += `<div class="rdv-item" onclick="viewSeance('${s.id}')">
        <div class="rdv-date"><div class="day">${parseInt(j)}</div><div class="month">${MOIS_SHORT[parseInt(m) - 1]}</div></div>
        <div style="flex:1;">
          <div style="font-size:14px;font-weight:500;">${getPatientName(s.patientId)}</div>
          <div style="font-size:12px;color:var(--warm-mid);margin-top:2px;">${s.heure} · ${s.duree} min${s.paiement ? ' · ' + s.paiement : ''}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
          <span class="badge badge-${s.statut}">${s.statut}</span>
          <span style="font-family:var(--font-serif);font-size:17px;">${s.tarif} €</span>
        </div>
      </div>`;
    });
  }
  el.innerHTML = html;
}

function showCaModal() {
  const now        = new Date(), mo = now.getMonth(), yr = now.getFullYear();
  const label      = `${MOIS_NOMS[mo]} ${yr}`;
  const seancesMois = DB.seances.filter(s => {
    const d = new Date(s.date);
    return d.getMonth() === mo && d.getFullYear() === yr && s.statut !== 'annulé';
  }).sort((a, b) => a.date.localeCompare(b.date));

  const reglees    = seancesMois.filter(s => s.statut === 'réglée');
  const honorees   = seancesMois.filter(s => s.statut === 'honoré');
  const planifiees = seancesMois.filter(s => s.statut === 'planifié');
  const caR = reglees.reduce((a, s) => a + s.tarif, 0);
  const caH = honorees.reduce((a, s) => a + s.tarif, 0);
  const caP = planifiees.reduce((a, s) => a + s.tarif, 0);
  const caT = caR + caH + caP;
  const pct = caT > 0 ? Math.min(100, caR / caT * 100) : 0;

  const lignes = ls => !ls.length
    ? '<div style="color:var(--warm-mid);font-size:13px;padding:.4rem 0;">Aucune</div>'
    : ls.map(s => `<div style="display:flex;align-items:center;gap:.75rem;padding:.45rem 0;border-bottom:1px solid var(--beige-mid);font-size:13px;">
        <span style="min-width:100px;color:var(--warm-mid);">${formatDateShort(s.date)}</span>
        <span style="flex:1;">${getPatientName(s.patientId, false)}</span>
        ${s.paiement ? `<span style="font-size:11px;color:var(--warm-mid);">${s.paiement}</span>` : ''}
        <span style="font-family:var(--font-serif);font-size:15px;">${fmtMoney(s.tarif)}</span>
      </div>`).join('');

  const bloc = (titre, col, ls, total, icon) => `<div style="margin-bottom:1.25rem;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.4rem;">
      <div style="font-weight:500;font-size:13px;color:${col};">${icon} ${titre} (${ls.length})</div>
      <div style="font-family:var(--font-serif);font-size:18px;color:${col};">${fmtMoney(total)}</div>
    </div>
    <div style="border-left:3px solid ${col};padding-left:.75rem;">${lignes(ls)}</div>
  </div>`;

  document.getElementById('modal-ca-title').textContent = `CA — ${label}`;
  document.getElementById('modal-ca-content').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin-bottom:1.5rem;">
      <div class="stat-card" style="padding:.75rem;"><div class="stat-label">Encaissé</div><div style="font-family:var(--font-serif);font-size:22px;color:var(--success);">${fmtMoney(caR)}</div></div>
      <div class="stat-card" style="padding:.75rem;"><div class="stat-label">À encaisser</div><div style="font-family:var(--font-serif);font-size:22px;color:var(--info);">${fmtMoney(caH)}</div></div>
      <div class="stat-card" style="padding:.75rem;"><div class="stat-label">Total prévu</div><div style="font-family:var(--font-serif);font-size:22px;color:var(--sage-dark);">${fmtMoney(caT)}</div></div>
    </div>
    <div style="margin-bottom:1.5rem;">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--warm-mid);margin-bottom:.3rem;">
        <span>Encaissé ${Math.round(pct)} %</span><span>${fmtMoney(caR)} / ${fmtMoney(caT)}</span>
      </div>
      <div style="background:var(--beige-mid);border-radius:8px;height:10px;overflow:hidden;">
        <div style="height:100%;border-radius:8px;background:var(--success);width:${pct}%;transition:width .4s;"></div>
      </div>
    </div>
    ${bloc('Séances réglées', 'var(--success)', reglees, caR, '✓')}
    ${bloc('Séances honorées (non réglées)', 'var(--info)', honorees, caH, '◷')}
    ${planifiees.length ? bloc('Séances planifiées', 'var(--warm-mid)', planifiees, caP, '📅') : ''}`;
  document.getElementById('modal-ca').classList.remove('hidden');
}

function showAFacturerModal() {
  const seances = DB.seances
    .filter(s => (s.statut === 'réglée' || s.statut === 'honoré') && !s.facture)
    .sort((a, b) => a.date.localeCompare(b.date) || a.heure.localeCompare(b.heure));

  const byPatient = {};
  seances.forEach(s => { if (!byPatient[s.patientId]) byPatient[s.patientId] = []; byPatient[s.patientId].push(s); });

  const html = Object.entries(byPatient).map(([pid, ss]) => {
    const pn    = getPatientName(pid);
    const total = ss.reduce((a, s) => a + s.tarif, 0);
    const rows  = ss.map(s => `
      <div style="display:flex;align-items:center;gap:.6rem;padding:.4rem .5rem;font-size:13px;border-bottom:1px solid var(--beige-mid);">
        <span style="min-width:115px;color:var(--warm-mid);">${formatDateShort(s.date)} ${s.heure}</span>
        <span class="badge badge-${s.statut}" style="font-size:10px;">${s.statut}</span>
        ${s.paiement ? `<span style="font-size:11px;color:var(--warm-mid);">${s.paiement}</span>` : ''}
        <span style="margin-left:auto;font-family:var(--font-serif);">${s.tarif} €</span>
      </div>`).join('');
    return `<div style="margin-bottom:1rem;border:1px solid var(--beige-mid);border-radius:var(--radius-sm);overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.6rem .85rem;background:var(--beige);">
        <strong style="font-size:14px;">${pn}</strong>
        <div style="display:flex;align-items:center;gap:.75rem;">
          <span style="font-family:var(--font-serif);font-size:15px;color:var(--sage-dark);">${fmtMoney(total)}</span>
          <button class="btn btn-primary btn-sm" onclick="closeModal('modal-a-facturer');openModal('modal-facture');setTimeout(()=>{document.getElementById('f-patient').value='${pid}';populateFactureSeances();setTimeout(()=>{document.querySelectorAll('.f-cb').forEach(cb=>cb.checked=true);updateFTotal();},60);},120);">📄 Facturer</button>
        </div>
      </div>
      ${rows}
    </div>`;
  }).join('');

  document.getElementById('a-facturer-content').innerHTML = html || '<div style="color:var(--warm-mid);font-size:13px;">Aucune séance à facturer.</div>';
  document.getElementById('modal-a-facturer').classList.remove('hidden');
}

function renderCalendar() {
  const todayD  = new Date();
  const yr      = calDate.getFullYear(), mo = calDate.getMonth();
  const moisStr = `${yr}-${String(mo + 1).padStart(2, '0')}`;
  document.getElementById('cal-title').textContent = `${MOIS_NOMS[mo]} ${yr}`;

  const fo  = (new Date(yr, mo, 1).getDay() + 6) % 7;
  const dim = new Date(yr, mo + 1, 0).getDate();

  // Séances du mois
  const rdvMap = {};
  DB.seances.filter(s => s.date.startsWith(moisStr)).forEach(s => {
    const j = parseInt(s.date.split('-')[2]);
    if (!rdvMap[j]) rdvMap[j] = [];
    rdvMap[j].push(s);
  });

  // Jours indisponibles
  const indispoSet = new Set(
    (DB.indisponibilites || []).filter(i => i.date.startsWith(moisStr)).map(i => parseInt(i.date.split('-')[2]))
  );
  for (let d = 1; d <= dim; d++) {
    if (getIndispoRegleForDate(`${moisStr}-${String(d).padStart(2, '0')}`)) indispoSet.add(d);
  }

  const jNoms = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];
  let h = jNoms.map(j => `<div class="cal-day-name">${j}</div>`).join('');
  for (let i = 0; i < fo; i++) h += '<div class="cal-day empty"></div>';
  for (let d = 1; d <= dim; d++) {
    const isToday = d === todayD.getDate() && mo === todayD.getMonth() && yr === todayD.getFullYear();
    const hasRdv  = !!rdvMap[d];
    const isIndi  = indispoSet.has(d);
    const ds      = `${moisStr}-${String(d).padStart(2, '0')}`;
    const click   = hasRdv ? `onclick="goToSeancesByDate('${ds}')" title="${rdvMap[d].length} séance(s)"` : '';
    const cls     = ['cal-day', isToday ? 'today' : '', hasRdv ? 'has-rdv clickable' : '', isIndi ? 'is-indispo' : ''].filter(Boolean).join(' ');
    h += `<div class="${cls}" ${click}>${d}</div>`;
  }
  document.getElementById('calendar').innerHTML = h;
}

function goToSeancesByDate(dateStr) {
  showPage('seances', document.querySelectorAll('.nav-btn')[2]);
  document.getElementById('filter-date').value = dateStr;
  renderSeances();
}

function renderUpcoming() {
  const now = today();
  const up  = DB.seances
    .filter(s => s.date >= now && s.statut === 'planifié')
    .sort((a, b) => a.date.localeCompare(b.date) || a.heure.localeCompare(b.heure))
    .slice(0, 8);
  const el = document.getElementById('upcoming-list');
  if (!up.length) { el.innerHTML = '<div style="color:var(--warm-mid);font-size:13px;">Aucune séance à venir</div>'; return; }
  el.innerHTML = up.map(s => {
    const [, m, j] = s.date.split('-');
    return `<div style="display:flex;align-items:center;gap:.75rem;padding:.55rem 0;border-bottom:1px solid var(--beige-mid);font-size:13px;cursor:pointer;" onclick="viewSeance('${s.id}')">
      <span style="color:var(--warm-mid);font-size:12px;min-width:75px;">${parseInt(j)} ${MOIS_SHORT[parseInt(m) - 1]} ${s.heure}</span>
      <span style="font-weight:500;">${getPatientName(s.patientId, false)}</span>
    </div>`;
  }).join('');
}


// ════════════════════════════════════════════════════════
// INITIALISATION
// ════════════════════════════════════════════════════════

// Manifest PWA (généré dynamiquement pour compatibilité GitHub Pages)
const _manifest = { name: 'Cabinet Psychothérapie', short_name: 'Cabinet Psy', start_url: '.', display: 'standalone', background_color: '#f7f3ee', theme_color: '#6b8f71' };
document.getElementById('manifest-link').setAttribute('href', URL.createObjectURL(new Blob([JSON.stringify(_manifest)], { type: 'application/manifest+json' })));

// dbLoad est async (IndexedDB) — on attend qu'elle soit terminée avant tout rendu
(async () => {
  await dbLoad();

  if (isConfigured()) {
    document.getElementById('setup-screen').classList.add('hidden');
    updateHeader();
    refreshLogoPreview('s');
    renderDashboard();
  } else {
    document.getElementById('setup-screen').classList.remove('hidden');
  }
})();
