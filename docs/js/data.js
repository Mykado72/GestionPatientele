/* ══════════════════════════════════════════════════════
   Cabinet de Psychothérapie — data.js
   État (DB/CFG), persistance IndexedDB/localStorage, export & import des sauvegardes.
   Dépend de : (rien — chargé en premier)
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
    req.onsuccess = e => {
      _idb = e.target.result;
      // Connexion fermée par le navigateur ou mise à niveau par un autre onglet : on rouvrira à la demande
      _idb.onclose         = () => { _idb = null; };
      _idb.onversionchange = () => { _idb.close(); _idb = null; };
      resolve(_idb);
    };
    req.onerror   = e => reject(e.target.error);
    req.onblocked = () => reject(new Error('Ouverture de la base bloquée par un autre onglet.'));
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
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    // La donnée n'est réellement écrite qu'à la fin de la transaction
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error || tx.error);
    tx.onabort    = () => reject(tx.error || new Error('Écriture annulée (espace disque insuffisant ?)'));
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
  // Si un coffre chiffré existe, rien n'est lu en clair : l'écran de verrouillage prend le relais
  if (await vaultExists()) return 'locked';

  // CFG : localStorage (synchrone, petit)
  try {
    const c = localStorage.getItem('psy-cfg');
    if (c) CFG = sanitizeCfg(JSON.parse(c), CFG);
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

  // Validation / normalisation des données chargées (défense en profondeur contre les données altérées)
  try { DB = sanitizeDb(DB, false); } catch (e) { console.warn('[Cabinet] Base invalide, réinitialisée en mémoire.', e); }
  return 'ready';
}

// ── Sauvegarde DB (async) ──────────────────────────────
async function dbSave() {
  if (_staleTab) {
    toast('Données modifiées dans un autre onglet : rechargez la page avant de continuer.', 'danger');
    return;
  }
  announceSave();
  onDataChanged();   // rappel de sauvegarde + sauvegarde automatique dans le dossier
  if (_vaultOn) {
    try { await vaultPersist(); } catch (e) { console.error('[Cabinet] Écriture du coffre échouée.', e); toast('Erreur de sauvegarde locale', 'danger'); }
    scheduleDriveSave();
    return;
  }
  try {
    await idbPut(IDB_KEY, DB);
  } catch (e) {
    console.warn('[Cabinet] dbSave IDB échoué, fallback localStorage.', e);
    try { localStorage.setItem('psy-db', JSON.stringify(DB)); }
    catch (e2) { toast('⚠ Sauvegarde locale impossible (espace insuffisant ?). Exportez vos données.', 'danger'); }
  }
  maybeRequestPersistence();
  // Planifier une sauvegarde Drive si connecté (debounce 30s)
  scheduleDriveSave();
}

// ── Sauvegarde CFG (sync) ──────────────────────────────
function cfgSave() {
  onDataChanged();
  if (_vaultOn) { void vaultPersist().catch(e => console.error('[Cabinet] Écriture du coffre échouée.', e)); return; }
  try { localStorage.setItem('psy-cfg', JSON.stringify(CFG)); } catch (e) {}
}

function uid() {
  const r = crypto.getRandomValues(new Uint8Array(6));
  return Date.now().toString(36) + Array.from(r, b => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
}


// ════════════════════════════════════════════════════════
// PERSISTANCE DU STOCKAGE NAVIGATEUR
// Par défaut, un navigateur peut effacer IndexedDB sans prévenir quand l'espace
// manque (stockage « best-effort »). navigator.storage.persist() l'en empêche.
// ════════════════════════════════════════════════════════

let _persistAsked = false;

async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (e) { return false; }
}

// Tentative discrète (une fois par session) après le premier enregistrement
function maybeRequestPersistence() {
  if (_persistAsked) return;
  _persistAsked = true;
  void requestPersistence().then(() => renderStorageStatus());
}

async function storageStatus() {
  const out = { supported: !!navigator.storage?.persist, persisted: false, usage: null, quota: null };
  try { if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted(); } catch (e) {}
  try {
    if (navigator.storage?.estimate) { const e = await navigator.storage.estimate(); out.usage = e.usage ?? null; out.quota = e.quota ?? null; }
  } catch (e) {}
  return out;
}

function _fmtBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return n + ' o';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' Ko';
  if (n < 1073741824) return (n / 1048576).toFixed(1).replace('.', ',') + ' Mo';
  return (n / 1073741824).toFixed(1).replace('.', ',') + ' Go';
}

async function renderStorageStatus() {
  const box = document.getElementById('storage-status-box');
  if (!box) return;
  const st = await storageStatus();
  box.textContent = '';
  const info = document.createElement('div');
  info.className = 'info-box ' + (st.persisted ? 'sage' : 'terra');
  info.style.fontSize = '13px';
  const line = document.createElement('div');
  if (st.persisted) line.textContent = '✓ Stockage persistant : le navigateur ne supprimera pas vos données automatiquement.';
  else if (st.supported) line.textContent = '⚠ Stockage non garanti : le navigateur peut effacer les données si l’espace manque. Faites des sauvegardes régulières.';
  else line.textContent = '⚠ Ce navigateur ne propose pas le stockage persistant. Faites des sauvegardes régulières.';
  info.appendChild(line);
  if (st.usage != null) {
    const u = document.createElement('div');
    u.style.cssText = 'font-size:12px;margin-top:.35rem;';
    u.textContent = `Espace utilisé : ${_fmtBytes(st.usage)}` + (st.quota ? ` sur ${_fmtBytes(st.quota)} disponibles` : '');
    info.appendChild(u);
  }
  if (!st.persisted && st.supported) {
    const b = document.createElement('button');
    b.className = 'btn btn-primary btn-sm'; b.style.marginTop = '.6rem';
    b.textContent = 'Demander le stockage persistant';
    b.addEventListener('click', async () => {
      const ok = await requestPersistence();
      await renderStorageStatus();
      if (!ok) toast('Refusé par le navigateur. Installez l’application (PWA) ou ajoutez-la aux favoris, puis réessayez.');
    });
    info.appendChild(b);
  }
  box.appendChild(info);
}

// ── Plusieurs onglets : empêche un onglet périmé d'écraser des données plus récentes
let _staleTab = false;
let _bc = null;
try {
  _bc = new BroadcastChannel('psy-cabinet');
  _bc.onmessage = ev => {
    if (ev.data === 'saved' && !_staleTab) {
      _staleTab = true;
      toast('Données modifiées dans un autre onglet : rechargez cette page.', 'danger');
    }
  };
} catch (e) { /* BroadcastChannel indisponible : on ignore */ }
function announceSave() { try { _bc?.postMessage('saved'); } catch (e) {} }


// ════════════════════════════════════════════════════════
// EXPORT / IMPORT
// ════════════════════════════════════════════════════════

function exportData() {
  if (!confirm('⚠ Ce fichier contiendra des données de santé NON CHIFFRÉES.\nPréférez « Exporter chiffré ». Continuer quand même ?')) return;
  const data = { db: DB, cfg: CFG, exportedAt: new Date().toISOString(), version: '1.0' };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cabinet-backup-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Export téléchargé ✓', 'success');
  recordBackup('export');
}

const ENCRYPTED_BACKUP_VERSION = 1;
const ENCRYPTED_BACKUP_ITERATIONS = 600000;

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveBackupKey(password, salt, iterations = ENCRYPTED_BACKUP_ITERATIONS) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getBackupPayload() {
  return { db: DB, cfg: CFG, exportedAt: new Date().toISOString(), version: '1.0' };
}

async function encryptPayload(password, payload) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(password, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    format: 'cabinet-backup-encrypted', version: ENCRYPTED_BACKUP_VERSION,
    algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA-256', iterations: ENCRYPTED_BACKUP_ITERATIONS,
    salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

async function exportEncryptedData() {
  if (!window.crypto?.subtle) {
    alert('Le chiffrement n’est pas disponible dans ce navigateur.');
    return;
  }
  const password = await askBackupPassword({
    title: '🔐 Export chiffré',
    text: 'Choisissez un mot de passe pour protéger cette sauvegarde.',
    confirm: true,
    confirmLabel: 'Chiffrer et exporter'
  });
  if (password === null) return;
  try {
    const envelope = await encryptPayload(password, getBackupPayload());
    downloadBlob(new Blob([JSON.stringify(envelope)], { type: 'application/octet-stream' }), `cabinet-backup-${today()}.cabinet.enc`);
    toast('Sauvegarde chiffrée créée ✓', 'success');
    recordBackup('export');
  } catch (err) {
    console.error('[Cabinet] Export chiffré échoué.', err);
    alert('Impossible de créer la sauvegarde chiffrée : ' + err.message);
  }
}

function isEncryptedEnvelope(e) { return e?.format === 'cabinet-backup-encrypted'; }

async function decryptEnvelope(envelope, password) {
  if (envelope?.format !== 'cabinet-backup-encrypted' || envelope?.version !== ENCRYPTED_BACKUP_VERSION || envelope?.algorithm !== 'AES-256-GCM' || envelope?.kdf !== 'PBKDF2-SHA-256') {
    throw new Error('Format de sauvegarde chiffrée non reconnu.');
  }
  if (!Number.isInteger(envelope.iterations) || envelope.iterations < 100000 || envelope.iterations > 10000000) throw new Error('Paramètres de dérivation invalides.');
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw new Error('Sauvegarde chiffrée corrompue ou incomplète.');
  const key = await deriveBackupKey(password, salt, envelope.iterations);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  const data = JSON.parse(new TextDecoder().decode(plaintext));
  if (!data.db || !data.cfg) throw new Error('Données de sauvegarde invalides.');
  return data;
}

async function decryptEncryptedBackup(file, password) {
  return decryptEnvelope(JSON.parse(await file.text()), password);
}

function applyImportedData(data, fromSetup = false) {
  const clean = sanitizeBackup(data, true);   // lève une exception si le fichier est invalide ou malveillant
  DB = clean.db;
  CFG = clean.cfg;
  void dbSave();
  cfgSave();
  if (fromSetup) document.getElementById('setup-screen').classList.add('hidden');
  updateHeader();
  refreshLogoPreview('s');
  renderDashboard();
}

function askBackupPassword({ title, text, confirm = false, confirmLabel = 'Valider' }) {
  return new Promise(resolve => {
    const overlay = document.getElementById('modal-backup-password');
    const titleEl = document.getElementById('backup-password-title');
    const textEl = document.getElementById('backup-password-text');
    const pwdEl = document.getElementById('backup-password');
    const confirmGroup = document.getElementById('backup-password-confirm-group');
    const confirmEl = document.getElementById('backup-password-confirm');
    const submitEl = document.getElementById('backup-password-submit');
    const cancelEl = document.getElementById('backup-password-cancel');
    const formEl = document.getElementById('backup-password-form');
    titleEl.textContent = title;
    textEl.textContent = text;
    confirmGroup.style.display = confirm ? '' : 'none';
    submitEl.textContent = confirmLabel;
    pwdEl.value = '';
    confirmEl.value = '';
    overlay.classList.remove('hidden');
    let done = false;
    const finish = value => {
      if (done) return;
      done = true;
      overlay.classList.add('hidden');
      formEl.onsubmit = null;
      cancelEl.onclick = null;
      overlay.onclick = null;
      resolve(value);
    };
    cancelEl.onclick = () => finish(null);
    formEl.onsubmit = event => {
      event.preventDefault();
      const password = pwdEl.value;
      const minLen = confirm ? VAULT_MIN_PASS : 1;
      if (password.length < minLen) { alert(`Le mot de passe doit comporter au moins ${minLen} caractères.`); pwdEl.focus(); return; }
      if (confirm && password !== confirmEl.value) { alert('Les deux mots de passe ne correspondent pas.'); confirmEl.focus(); return; }
      finish(password);
    };
    overlay.onclick = event => { if (event.target === overlay) finish(null); };
    setTimeout(() => pwdEl.focus(), 0);
  });
}

function isEncryptedBackupFile(file) { return /\.cabinet\.enc$/i.test(file.name) || /\.enc$/i.test(file.name); }

async function importBackupFile(file) {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('Fichier trop volumineux.');
  if (isEncryptedBackupFile(file)) {
    const password = await askBackupPassword({
      title: '🔓 Importer une sauvegarde chiffrée',
      text: 'Saisissez le mot de passe utilisé lors de l’export.',
      confirm: false,
      confirmLabel: 'Déchiffrer'
    });
    if (password === null) return null;
    return decryptEncryptedBackup(file, password);
  }
  const data = JSON.parse(await file.text());
  if (!data.db || !data.cfg) throw new Error('Format invalide');
  return data;
}

function showBackupImportError(err) {
  console.error('[Cabinet] Import échoué.', err);
  const cryptoError = err?.name === 'OperationError' || /decrypt|incorrect|corrupt/i.test(err?.message || '');
  alert(cryptoError ? 'Mot de passe incorrect ou sauvegarde chiffrée illisible.' : 'Fichier invalide : ' + err.message);
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.enc,.cabinet.enc,application/json,application/octet-stream';
  input.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = await importBackupFile(file);
      if (!data) return;
      if (!confirm('Remplacer toutes les données actuelles ?')) return;
      applyImportedData(data);
      toast('Import réussi ✓', 'success');
    } catch (err) { showBackupImportError(err); }
  };
  input.click();
}

function importDataFromSetup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.enc,.cabinet.enc,application/json,application/octet-stream';
  input.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = await importBackupFile(file);
      if (!data) return;
      applyImportedData(data, true);
      toast('Données importées avec succès ✓', 'success');
    } catch (err) { showBackupImportError(err); }
  };
  input.click();
}
