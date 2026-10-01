/* ══════════════════════════════════════════════════════
   Cabinet de Psychothérapie — security.js
   Échappement HTML, validation des données importées, logo sûr,
   verrouillage de l'application et chiffrement des données au repos.
   Dépend de : data.js, utils.js (appelé à l'exécution uniquement)
   ══════════════════════════════════════════════════════ */

'use strict';


// ════════════════════════════════════════════════════════
// ÉCHAPPEMENT
// ════════════════════════════════════════════════════════

// Échappe tout texte libre avant insertion dans innerHTML (contenu ET attributs)
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}


// ════════════════════════════════════════════════════════
// VALIDATION DES DONNÉES (import, restauration, chargement)
// ════════════════════════════════════════════════════════

const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_RE    = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE    = /^([01]\d|2[0-3]):[0-5]\d$/;

const STATUTS_PATIENT = ['actif', 'inactif', 'suivi-terminé'];
const STATUTS_SEANCE  = ['planifié', 'honoré', 'réglée', 'facturé', 'annulé'];
const MODES_PAIEMENT  = ['', 'Espèces', 'Chèque', 'Virement', 'Carte bancaire'];
const MAX_TEXT        = 5000;
const MAX_RICH        = 200000;
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

class DataValidationError extends Error {}

function _bad(msg) { throw new DataValidationError(msg); }

function _str(v, max = MAX_TEXT) {
  if (v == null) return '';
  if (typeof v !== 'string') v = String(v);
  return v.slice(0, max);
}
function _num(v, min, max, dflt) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt;
}
function _int(v, min, max, dflt) { return Math.trunc(_num(v, min, max, dflt)); }
function _enum(v, list, dflt) { return list.includes(v) ? v : dflt; }
function _date(v, required = false) {
  if (v == null || v === '') { if (required) _bad('Date manquante'); return ''; }
  if (typeof v !== 'string' || !DATE_RE.test(v) || isNaN(new Date(v))) _bad('Date invalide');
  return v;
}
function _time(v, required = false) {
  if (v == null || v === '') { if (required) _bad('Heure manquante'); return ''; }
  if (typeof v !== 'string' || !TIME_RE.test(v)) _bad('Heure invalide');
  return v;
}
function _id(v) {
  if (typeof v !== 'string' || !SAFE_ID_RE.test(v)) _bad('Identifiant invalide');
  return v;
}
function _rich(v) { return sanitizeRichHtml(_str(v, MAX_RICH)); }

// Conserve les champs inconnus uniquement s'ils sont de simples valeurs (jamais d'objets imbriqués)
function _extras(o, known) {
  const out = {};
  for (const k of Object.keys(o)) {
    if (known.includes(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    const v = o[k];
    if (v === null || ['number', 'boolean'].includes(typeof v)) out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, MAX_TEXT);
  }
  return out;
}

// Chaque fiche invalide : strict → exception (import) ; non strict → ignorée (chargement local)
function _each(arr, fn, strict, label) {
  if (arr == null) return [];
  if (!Array.isArray(arr)) _bad(label + ' : format invalide');
  const out = [];
  for (const item of arr) {
    try {
      if (!item || typeof item !== 'object' || Array.isArray(item)) _bad(label + ' : entrée invalide');
      out.push(fn(item));
    } catch (e) {
      if (strict) throw e;
      console.warn('[Cabinet] Entrée ignorée (' + label + ') :', e.message);
    }
  }
  return out;
}

const _PAT_KEYS = ['id','createdAt','prenom','nom','naissance','tel','email','adresse','tarif','statut','motif','notes','historique','diagnosticAT','supervision'];
const _SEA_KEYS = ['id','patientId','date','heure','duree','tarif','statut','paiement','notes','facture','gcalEventId','dateReglement'];
const _FAC_KEYS = ['id','num','patientId','seancesIds','date','echeance','objet','paiementsSeances','total','createdAt'];
const _IND_KEYS = ['id','date','heureDebut','heureFin','motif'];
const _REG_KEYS = ['id','jours','freq','debut','fin','heureDebut','heureFin','motif'];

function sanitizeDb(db, strict = true) {
  if (!db || typeof db !== 'object' || Array.isArray(db)) _bad('Base de données invalide');

  const patients = _each(db.patients, p => ({
    ..._extras(p, _PAT_KEYS),
    id: _id(p.id),
    createdAt: _str(p.createdAt, 40),
    prenom: _str(p.prenom, 200), nom: _str(p.nom, 200),
    naissance: _date(p.naissance),
    tel: _str(p.tel, 50), email: _str(p.email, 200), adresse: _str(p.adresse, 500),
    tarif: _num(p.tarif, 0, 100000, 60),
    statut: _enum(p.statut, STATUTS_PATIENT, 'actif'),
    motif: _str(p.motif, 1000),
    notes: _rich(p.notes), historique: _rich(p.historique),
    diagnosticAT: _rich(p.diagnosticAT), supervision: _rich(p.supervision)
  }), strict, 'patients');

  const seances = _each(db.seances, s => ({
    ..._extras(s, _SEA_KEYS),
    id: _id(s.id), patientId: _id(s.patientId),
    date: _date(s.date, true), heure: _time(s.heure, true),
    duree: _int(s.duree, 1, 1440, 60),
    tarif: _num(s.tarif, 0, 100000, 60),
    statut: _enum(s.statut, STATUTS_SEANCE, 'planifié'),
    paiement: _enum(s.paiement || '', MODES_PAIEMENT, ''),
    notes: _rich(s.notes),
    facture: s.facture ? _id(s.facture) : null,
    gcalEventId: s.gcalEventId ? _str(s.gcalEventId, 200) : undefined,
    dateReglement: _date(s.dateReglement) || undefined
  }), strict, 'séances');

  const factures = _each(db.factures, f => ({
    ..._extras(f, _FAC_KEYS),
    id: _id(f.id),
    num: _str(f.num, 40),
    patientId: _id(f.patientId),
    seancesIds: (Array.isArray(f.seancesIds) ? f.seancesIds : _bad('Facture : séances invalides')).map(_id),
    date: _date(f.date, true), echeance: _date(f.echeance),
    objet: _str(f.objet, 300),
    paiementsSeances: (Array.isArray(f.paiementsSeances) ? f.paiementsSeances : []).map(m => _enum(m, MODES_PAIEMENT, '')).filter(Boolean),
    total: _num(f.total, 0, 10000000, 0),
    createdAt: _str(f.createdAt, 40)
  }), strict, 'factures');

  const indisponibilites = _each(db.indisponibilites, i => ({
    ..._extras(i, _IND_KEYS),
    id: _id(i.id), date: _date(i.date, true),
    heureDebut: _time(i.heureDebut) || null, heureFin: _time(i.heureFin) || null,
    motif: _str(i.motif, 300)
  }), strict, 'indisponibilités');

  const indisponibilites_regles = _each(db.indisponibilites_regles, r => ({
    ..._extras(r, _REG_KEYS),
    id: _id(r.id),
    jours: (Array.isArray(r.jours) ? r.jours : _bad('Règle : jours invalides')).map(j => _int(j, 0, 6, 0)),
    freq: _int(r.freq, 1, 52, 1),
    debut: _date(r.debut, true), fin: _date(r.fin) || null,
    heureDebut: _time(r.heureDebut) || null, heureFin: _time(r.heureFin) || null,
    motif: _str(r.motif, 300)
  }), strict, 'règles');

  return {
    ..._extras(db, ['patients','seances','factures','nextNum','indisponibilites','indisponibilites_regles']),
    patients, seances, factures, indisponibilites, indisponibilites_regles,
    nextNum: _int(db.nextNum, 1, 1e9, 1)
  };
}

// Logo : uniquement une image raster en data: URL (jamais de SVG, d'URL distante ni de javascript:)
const LOGO_RE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
function safeLogo(src) {
  return typeof src === 'string' && src.length < 800000 && LOGO_RE.test(src) ? src : '';
}

const CLIENT_ID_RE = /^[\w.-]{10,200}\.apps\.googleusercontent\.com$/;
const DRIVE_ID_RE  = /^[\w-]{10,100}$/;

function sanitizeCfg(cfg, base) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) _bad('Paramètres invalides');
  const out = { ...base };
  const textKeys = ['prenom','nom','titre','formation','adresse','cp','ville','tel','email','siret','tvaNum','tvaMention','iban','bic','banque','paiements'];
  textKeys.forEach(k => { if (k in cfg) out[k] = _str(cfg[k], 500); });
  out.tarif = _num(cfg.tarif, 0, 100000, base.tarif ?? 60);
  out.delai = _int(cfg.delai, 0, 3650, base.delai ?? 30);
  out.logo  = safeLogo(cfg.logo);
  out.gcalClientId   = CLIENT_ID_RE.test(cfg.gcalClientId || '') ? cfg.gcalClientId : '';
  out.gcalCalendarId = _str(cfg.gcalCalendarId, 300);
  out.gdriveFileId   = DRIVE_ID_RE.test(cfg.gdriveFileId || '') ? cfg.gdriveFileId : '';
  return out;
}

// Point d'entrée unique pour toute donnée venant de l'extérieur (fichier, Drive)
function sanitizeBackup(data, strict = true) {
  if (!data || typeof data !== 'object' || !data.db || !data.cfg) _bad('Format de sauvegarde invalide');
  return { db: sanitizeDb(data.db, strict), cfg: sanitizeCfg(data.cfg, CFG) };
}


// ════════════════════════════════════════════════════════
// COFFRE — chiffrement des données au repos (AES-256-GCM)
// Clé dérivée de la phrase secrète (PBKDF2-SHA-256) et conservée
// uniquement en mémoire (CryptoKey non extractible).
// ════════════════════════════════════════════════════════

const VAULT_IDB_KEY   = 'vault';
const VAULT_ITER      = 600000;
const VAULT_MIN_PASS  = 12;
const INACTIVITY_MS   = 10 * 60 * 1000;

let _vaultOn   = false;
let _vaultKey  = null;
let _vaultSalt = null;
let _vaultQueue = Promise.resolve();

function vaultEnabled() { return _vaultOn; }

async function vaultSerialize() {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify({ db: DB, cfg: CFG }));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, _vaultKey, pt);
  return {
    format: 'cabinet-vault', version: 1, kdf: 'PBKDF2-SHA-256', iterations: VAULT_ITER,
    salt: bytesToBase64(_vaultSalt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ct))
  };
}

// Écritures sérialisées pour éviter qu'une sauvegarde plus ancienne écrase une plus récente
function vaultPersist() {
  // La file reste utilisable après une erreur (sinon une écriture ratée bloquerait toutes les suivantes)
  const job = _vaultQueue.then(async () => { await idbPut(VAULT_IDB_KEY, await vaultSerialize()); });
  _vaultQueue = job.catch(() => {});
  return job;
}

async function vaultExists() {
  try { return !!(await idbGet(VAULT_IDB_KEY)); } catch (e) { return false; }
}

async function vaultUnlock(passphrase) {
  const v = await idbGet(VAULT_IDB_KEY);
  if (!v || v.format !== 'cabinet-vault' || v.version !== 1) throw new Error('Coffre introuvable ou format inconnu.');
  if (!Number.isInteger(v.iterations) || v.iterations < 100000) throw new Error('Paramètres du coffre invalides.');
  const salt = base64ToBytes(v.salt), iv = base64ToBytes(v.iv), ct = base64ToBytes(v.ciphertext);
  const key  = await deriveBackupKey(passphrase, salt, v.iterations);
  const pt   = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);   // échoue si mauvaise phrase
  const data = JSON.parse(new TextDecoder().decode(pt));
  const clean = sanitizeBackup(data, false);
  DB = clean.db; CFG = clean.cfg;
  _vaultKey = key; _vaultSalt = salt; _vaultOn = true;
}

async function _vaultKeyFromNewPass(pass) {
  _vaultSalt = crypto.getRandomValues(new Uint8Array(16));
  _vaultKey  = await deriveBackupKey(pass, _vaultSalt, VAULT_ITER);
}

async function vaultEnable() {
  if (_vaultOn) return;
  if (!window.crypto?.subtle) { alert('Le chiffrement n’est pas disponible dans ce navigateur.'); return; }
  const pass = await askBackupPassword({
    title: '🔒 Activer le verrouillage',
    text: 'Choisissez une phrase secrète (12 caractères minimum). Vos données seront chiffrées sur cet appareil et l’application se verrouillera après 10 minutes d’inactivité. Sans cette phrase, les données sont IRRÉCUPERABLES : faites d’abord une sauvegarde chiffrée.',
    confirm: true, confirmLabel: 'Activer'
  });
  if (pass === null) return;
  try {
    await _vaultKeyFromNewPass(pass);
    _vaultOn = true;
    await vaultPersist();
    // Vérification de relecture avant de supprimer les données en clair
    const check = await idbGet(VAULT_IDB_KEY);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(check.iv) }, _vaultKey, base64ToBytes(check.ciphertext));
    if (!JSON.parse(new TextDecoder().decode(pt)).db) throw new Error('Vérification du coffre échouée.');
    try { await idbDelete(IDB_KEY); } catch (e) {}
    try { localStorage.removeItem('psy-db'); localStorage.removeItem('psy-cfg'); } catch (e) {}
    startInactivityLock();
    renderSecurityStatus();
    toast('Verrouillage activé ✓', 'success');
  } catch (err) {
    _vaultOn = false; _vaultKey = null; _vaultSalt = null;
    console.error('[Cabinet] Activation du coffre échouée.', err);
    alert('Impossible d’activer le verrouillage : ' + err.message);
  }
}

async function vaultChangePassphrase() {
  if (!_vaultOn) return;
  const pass = await askBackupPassword({
    title: '🔑 Changer la phrase secrète',
    text: 'Choisissez la nouvelle phrase secrète (12 caractères minimum).',
    confirm: true, confirmLabel: 'Changer'
  });
  if (pass === null) return;
  const oldKey = _vaultKey, oldSalt = _vaultSalt;
  try {
    await _vaultKeyFromNewPass(pass);
    await vaultPersist();
    toast('Phrase secrète modifiée ✓', 'success');
  } catch (err) {
    _vaultKey = oldKey; _vaultSalt = oldSalt;
    alert('Échec : ' + err.message);
  }
}

async function vaultDisable() {
  if (!_vaultOn) return;
  if (!confirm('Désactiver le verrouillage ? Vos données seront de nouveau stockées en clair sur cet appareil.')) return;
  try {
    await idbPut(IDB_KEY, DB);
    cfgSaveClear();
    await idbDelete(VAULT_IDB_KEY);
    _vaultOn = false; _vaultKey = null; _vaultSalt = null;
    stopInactivityLock();
    renderSecurityStatus();
    toast('Verrouillage désactivé');
  } catch (err) {
    alert('Échec : ' + err.message);
  }
}

// Écrit CFG en clair (utilisé uniquement à la désactivation du coffre)
function cfgSaveClear() { localStorage.setItem('psy-cfg', JSON.stringify(CFG)); }


// ════════════════════════════════════════════════════════
// VERROUILLAGE — écran + inactivité
// ════════════════════════════════════════════════════════

let _lastActivity = Date.now();
let _lockTimer    = null;
const _activityEvents = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
const _bumpActivity = () => { _lastActivity = Date.now(); };

function startInactivityLock() {
  stopInactivityLock();
  _lastActivity = Date.now();
  _activityEvents.forEach(ev => window.addEventListener(ev, _bumpActivity, { passive: true }));
  document.addEventListener('visibilitychange', _checkLockOnVisible);
  _lockTimer = setInterval(() => { if (Date.now() - _lastActivity > INACTIVITY_MS) lockNow(); }, 15000);
}

function stopInactivityLock() {
  clearInterval(_lockTimer); _lockTimer = null;
  _activityEvents.forEach(ev => window.removeEventListener(ev, _bumpActivity));
  document.removeEventListener('visibilitychange', _checkLockOnVisible);
}

function _checkLockOnVisible() {
  if (!document.hidden && Date.now() - _lastActivity > INACTIVITY_MS) lockNow();
}

// Verrouillage : purge des jetons Google, puis rechargement qui vide toute la mémoire (DB, CFG, clé)
function lockNow() {
  if (!_vaultOn) return;
  ['psy-gdrive-token', 'psy-gdrive-exp', 'psy-gdrive-state', 'psy-gcal-token', 'psy-gcal-exp', 'psy-gcal-state']
    .forEach(k => sessionStorage.removeItem(k));
  location.reload();
}

function showLockScreen() {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.id = 'lock-screen';
    ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:var(--beige);display:flex;align-items:center;justify-content:center;padding:1rem;';

    const card = document.createElement('div');
    card.className = 'setup-card';
    card.style.maxWidth = '420px';

    const h = document.createElement('h2');
    h.className = 'modal-title'; h.textContent = '🔒 Cabinet verrouillé';
    const p = document.createElement('p');
    p.style.cssText = 'font-size:13px;color:var(--warm-mid);line-height:1.6;margin-bottom:1rem;';
    p.textContent = 'Saisissez votre phrase secrète pour déchiffrer les données.';

    const form = document.createElement('form');
    const grp = document.createElement('div'); grp.className = 'form-group';
    const input = document.createElement('input');
    input.type = 'password'; input.autocomplete = 'current-password'; input.required = true;
    input.setAttribute('aria-label', 'Phrase secrète');
    grp.appendChild(input);
    const err = document.createElement('div');
    err.style.cssText = 'color:var(--danger);font-size:12px;min-height:18px;margin-bottom:.5rem;';
    err.setAttribute('role', 'alert');
    const btn = document.createElement('button');
    btn.type = 'submit'; btn.className = 'btn btn-primary'; btn.style.width = '100%'; btn.textContent = 'Déverrouiller';
    form.append(grp, err, btn);
    card.append(h, p, form);
    ov.appendChild(card);
    document.body.appendChild(ov);
    input.focus();

    let busy = false;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (busy) return;
      const wait = parseInt(sessionStorage.getItem('psy-lock-until') || '0') - Date.now();
      if (wait > 0) { err.textContent = `Trop d’essais. Réessayez dans ${Math.ceil(wait / 1000)} s.`; return; }
      busy = true; btn.disabled = true; err.textContent = '';
      try {
        await vaultUnlock(input.value);
        sessionStorage.removeItem('psy-lock-fails');
        sessionStorage.removeItem('psy-lock-until');
        input.value = '';
        ov.remove();
        startInactivityLock();
        resolve();
      } catch (ex) {
        const fails = parseInt(sessionStorage.getItem('psy-lock-fails') || '0') + 1;
        sessionStorage.setItem('psy-lock-fails', String(fails));
        if (fails >= 3) sessionStorage.setItem('psy-lock-until', String(Date.now() + Math.min(2 ** (fails - 2), 60) * 1000));
        err.textContent = 'Phrase secrète incorrecte.';
        input.select();
        busy = false; btn.disabled = false;
      }
    });
  });
}

// Bloc « Sécurité » de la page Paramètres
function renderSecurityStatus() {
  const box = document.getElementById('security-status-box');
  if (!box) return;
  box.textContent = '';
  const mk = (txt, cls, fn) => {
    const b = document.createElement('button');
    b.className = 'btn ' + cls + ' btn-sm'; b.textContent = txt; b.addEventListener('click', fn);
    return b;
  };
  const info = document.createElement('div');
  info.className = 'info-box ' + (_vaultOn ? 'sage' : 'terra');
  info.style.fontSize = '13px';
  const row = document.createElement('div');
  row.style.cssText = 'margin-top:.6rem;display:flex;gap:.5rem;flex-wrap:wrap;';
  if (_vaultOn) {
    info.textContent = '✓ Données chiffrées sur cet appareil (AES-256). Verrouillage automatique après 10 min d’inactivité.';
    row.append(mk('🔒 Verrouiller maintenant', 'btn-primary', lockNow),
               mk('🔑 Changer la phrase secrète', 'btn-secondary', vaultChangePassphrase),
               mk('Désactiver', 'btn-secondary', vaultDisable));
  } else {
    info.textContent = '⚠ Vos données sont stockées en clair sur cet appareil. Activez le verrouillage pour les chiffrer et protéger l’accès.';
    row.append(mk('🔒 Activer le verrouillage', 'btn-primary', vaultEnable));
  }
  info.appendChild(row);
  box.appendChild(info);
}
