/* ══════════════════════════════════════════════════════
   Cabinet de Psychothérapie — backup.js
   1. Suivi des sauvegardes + rappel (bandeau, date du dernier export)
   2. Sauvegarde chiffrée automatique dans un dossier choisi
      (File System Access API — Chrome / Edge sur ordinateur)
   Dépend de : data.js (DB, CFG, idb*, encryptPayload, decryptEnvelope,
               askBackupPassword), utils.js (toast), settings.js (isConfigured)
   ══════════════════════════════════════════════════════ */

'use strict';


// ════════════════════════════════════════════════════════
// 1. SUIVI DES SAUVEGARDES & RAPPEL
// Seuls des horodatages sont stockés (localStorage) — jamais de données patient.
// ════════════════════════════════════════════════════════

const BACKUP_META_KEY    = 'psy-backup-meta';
const BACKUP_REMIND_DAYS = 7;
const BACKUP_DAY_MS      = 86400000;
const BACKUP_KIND_LABEL  = { export: 'export manuel', folder: 'dossier automatique', drive: 'Google Drive' };

let _changeCounter = 0;   // incrémenté à chaque modification des données (session en cours)

function _bmGet() {
  try { return JSON.parse(localStorage.getItem(BACKUP_META_KEY)) || {}; } catch (e) { return {}; }
}
function _bmSet(patch) {
  try { localStorage.setItem(BACKUP_META_KEY, JSON.stringify({ ..._bmGet(), ...patch })); } catch (e) {}
}

// Appelé par dbSave() / cfgSave() à chaque modification
function onDataChanged() {
  _changeCounter++;
  _bmSet({ changed: Date.now() });
  scheduleFolderSave();
}

// Appelé après toute sauvegarde réussie : kind = 'export' | 'folder' | 'drive'
function recordBackup(kind) {
  const now = Date.now();
  _bmSet({ [kind]: now, last: now, lastKind: kind, snooze: 0 });
  renderBackupBanner();
  renderBackupInfo();
}

function lastBackupTs() {
  const m = _bmGet();
  return Math.max(m.export || 0, m.drive || 0, m.folder || 0);
}

function fmtAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60)    return 'à l’instant';
  if (s < 3600)  return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return `il y a ${d} jour${d > 1 ? 's' : ''}`;
}

// Date locale AAAA-MM-JJ (today() est en UTC : décalé d'un jour autour de minuit)
function _localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _hasData() {
  return !!(DB.patients?.length || DB.seances?.length || DB.factures?.length);
}

// Faut-il rappeler de sauvegarder ?
function needsBackupReminder() {
  if (!isConfigured() || !_hasData()) return false;
  const m = _bmGet(), now = Date.now(), last = lastBackupTs();
  if (m.snooze && now < m.snooze) return false;
  if (!last) return true;                                   // jamais sauvegardé
  if (now - last < BACKUP_REMIND_DAYS * BACKUP_DAY_MS) return false;
  return (m.changed || 0) > last;                           // inutile d'insister si rien n'a changé
}


// ── Bandeau (haut de page) ─────────────────────────────
let _bannerDismissed = false;   // « Plus tard » pour la reprise du dossier, valable pour la session

function _btn(label, cls, fn) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'btn ' + cls + ' btn-sm'; b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

function renderBackupBanner() {
  const host = document.getElementById('backup-banner');
  if (!host) return;
  host.textContent = '';
  if (!isConfigured()) return;

  let box = null;

  if (_folderOn && (_folderState === 'needs-access' || _folderState === 'error') && !_bannerDismissed) {
    const paused = _folderState === 'needs-access';
    box = document.createElement('div');
    box.className = 'info-box terra backup-banner';
    const txt = document.createElement('div'); txt.className = 'bb-text';
    const strong = document.createElement('strong');
    strong.textContent = paused ? 'Sauvegarde automatique en pause. ' : 'La sauvegarde dans le dossier a échoué. ';
    txt.append(strong, paused
      ? (_dir ? `Autorisez l’accès au dossier « ${_folderLabel()} » pour reprendre (votre mot de passe sera demandé).`
              : `Sélectionnez à nouveau le dossier « ${_folderLabel()} » pour reprendre (votre mot de passe sera demandé).`)
      : (_folderError || 'Réessayez ou choisissez un autre dossier dans les Paramètres.'));
    const acts = document.createElement('div'); acts.className = 'bb-actions';
    acts.append(_btn(paused ? (_dir ? 'Reprendre' : 'Choisir le dossier') : 'Réessayer', 'btn-primary', () => { void folderReconnect(); }),
                _btn('Plus tard', 'btn-secondary', () => { _bannerDismissed = true; renderBackupBanner(); }));
    box.append(txt, acts);
  } else if (needsBackupReminder()) {
    const last = lastBackupTs();
    box = document.createElement('div');
    box.className = 'info-box terra backup-banner';
    const txt = document.createElement('div'); txt.className = 'bb-text';
    const strong = document.createElement('strong');
    strong.textContent = last ? `Dernière sauvegarde : ${fmtAgo(last)}. ` : 'Vous n’avez encore jamais sauvegardé vos données. ';
    txt.append(strong, 'Elles ne sont stockées que dans ce navigateur : un export chiffré les met à l’abri.');
    const acts = document.createElement('div'); acts.className = 'bb-actions';
    acts.append(_btn('🔐 Exporter chiffré', 'btn-primary', () => { void exportEncryptedData(); }));
    if (folderSupported() && !_folderOn) {
      acts.append(_btn('Automatiser…', 'btn-secondary', () => showPage('parametres', document.querySelectorAll('.nav-btn')[4])));
    }
    acts.append(_btn('Plus tard', 'btn-secondary', () => { _bmSet({ snooze: Date.now() + BACKUP_DAY_MS }); renderBackupBanner(); }));
    box.append(txt, acts);
  }

  if (box) { box.setAttribute('role', 'region'); box.setAttribute('aria-label', 'Rappel de sauvegarde'); host.appendChild(box); }
}

// Ligne « Dernière sauvegarde » dans Paramètres › Sauvegarde des données
function renderBackupInfo() {
  const el = document.getElementById('backup-last-line');
  if (!el) return;
  const m = _bmGet(), last = lastBackupTs();
  if (!last) { el.textContent = 'Aucune sauvegarde enregistrée sur cet appareil pour le moment.'; return; }
  const kind = BACKUP_KIND_LABEL[m.lastKind] ? ` (${BACKUP_KIND_LABEL[m.lastKind]})` : '';
  el.textContent = `Dernière sauvegarde : ${fmtAgo(last)}${kind} — ${new Date(last).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}`;
}


// ════════════════════════════════════════════════════════
// 2. SAUVEGARDE AUTOMATIQUE DANS UN DOSSIER
// • Fichier chiffré (AES-256-GCM, même format que « Exporter chiffré ») :
//   restaurable via Importer des données.
// • Une copie par jour, les 10 derniers jours conservés.
// • Le navigateur redemande l'autorisation d'accès au dossier à chaque ouverture,
//   et le mot de passe n'est conservé qu'en mémoire.
// ════════════════════════════════════════════════════════

const FOLDER_IDB_KEY = 'backup-dir-handle';
const FOLDER_FILE_RE = /^cabinet-auto-\d{4}-\d{2}-\d{2}\.cabinet\.enc$/;
const FOLDER_KEEP    = 10;

let _dir          = null;     // FileSystemDirectoryHandle
let _folderPass   = null;     // mot de passe — mémoire uniquement
let _folderState  = 'none';   // none | unsupported | needs-access | active | error
let _folderOn     = false;    // un dossier a été configuré (même si le navigateur ne l'a pas mémorisé)
let _folderError  = '';
let _folderSaving = false;
let _folderDirty  = false;
let _folderTimer  = null;
let _folderLastSave = 0;

function folderSupported() { return typeof window.showDirectoryPicker === 'function'; }
function _folderLabel()    { return _dir ? _dir.name : (_bmGet().folderName || 'dossier'); }

function _folderRefresh() { renderFolderBackupStatus(); renderBackupBanner(); }

async function _folderPerm(request) {
  if (!_dir) return 'denied';
  const opts = { mode: 'readwrite' };
  try {
    let p = _dir.queryPermission ? await _dir.queryPermission(opts) : 'granted';
    if (p !== 'granted' && request && _dir.requestPermission) p = await _dir.requestPermission(opts);
    return p;
  } catch (e) { return 'denied'; }
}

// Noms des sauvegardes automatiques présentes, de la plus récente à la plus ancienne
async function _folderList() {
  const names = [];
  for await (const [name, h] of _dir.entries()) {
    if (h.kind === 'file' && FOLDER_FILE_RE.test(name)) names.push(name);
  }
  return names.sort().reverse();
}

async function _folderLatestEnvelope() {
  for (const n of await _folderList()) {
    try {
      const file = await (await _dir.getFileHandle(n)).getFile();
      if (file.size > MAX_IMPORT_BYTES) continue;
      const env = JSON.parse(await file.text());
      if (isEncryptedEnvelope(env)) return env;
    } catch (e) { /* fichier illisible : on essaie le précédent */ }
  }
  return null;
}

async function _folderPrune() {
  try {
    for (const n of (await _folderList()).slice(FOLDER_KEEP)) await _dir.removeEntry(n);
  } catch (e) { console.warn('[Cabinet] Nettoyage des anciennes sauvegardes échoué.', e); }
}

// Obtient le mot de passe de la session. Si le dossier contient déjà des sauvegardes,
// on exige le MÊME mot de passe (vérifié par déchiffrement) : une faute de frappe ne
// doit pas produire en silence des sauvegardes illisibles.
async function _folderEnsurePassword() {
  if (_folderPass) return true;
  const latest = await _folderLatestEnvelope();
  if (latest) {
    for (;;) {
      const pass = await askBackupPassword({
        title: '🔐 Sauvegarde automatique',
        text: 'Ce dossier contient déjà des sauvegardes chiffrées. Saisissez leur mot de passe pour les poursuivre.',
        confirm: false, confirmLabel: 'Valider'
      });
      if (pass === null) return false;
      try { await decryptEnvelope(latest, pass); _folderPass = pass; return true; }
      catch (e) { alert('Mot de passe incorrect : il ne correspond pas aux sauvegardes déjà présentes dans ce dossier.'); }
    }
  }
  const pass = await askBackupPassword({
    title: '🔐 Sauvegarde automatique',
    text: 'Vos données sont chiffrées sur cet appareil avant d’être écrites dans le dossier. Choisissez un mot de passe (12 caractères minimum) et conservez-le : sans lui, la restauration est impossible. Il vous sera redemandé à chaque ouverture.',
    confirm: true, confirmLabel: 'Activer'
  });
  if (pass === null) return false;
  _folderPass = pass;
  return true;
}

// ── Démarrage (après déverrouillage éventuel du coffre) ──
let _backupInitDone = false;

async function initBackup() {
  if (_backupInitDone) return;
  _backupInitDone = true;

  if (!folderSupported()) {
    _folderState = 'unsupported';
  } else {
    try { _dir = await idbGet(FOLDER_IDB_KEY); } catch (e) { _dir = null; }
    // Certains contextes (ex. page ouverte en file://) ne mémorisent pas le dossier : on garde
    // alors le souvenir « un dossier était configuré » et on propose de le re-sélectionner.
    _folderOn = !!_dir || !!_bmGet().folderOn;
    // Même avec une autorisation encore valide, le mot de passe manque : action de l'utilisateur requise
    _folderState = _folderOn ? 'needs-access' : 'none';
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (_folderDirty && _folderState === 'active') { clearTimeout(_folderTimer); void folderBackupNow('auto'); }
    } else {
      renderBackupBanner();
    }
  });
  setInterval(renderBackupBanner, 30 * 60 * 1000);

  _folderRefresh();
  renderBackupInfo();
}

// ── Choix du dossier ───────────────────────────────────
async function folderChoose() {
  if (!folderSupported()) return;
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: 'cabinet-backup', mode: 'readwrite' });
  } catch (e) {
    if (e?.name !== 'AbortError') toast('Impossible d’ouvrir ce dossier : ' + (e?.message || e), 'danger');
    return;
  }
  const prev = _dir, prevPass = _folderPass;
  _dir = handle; _folderPass = null;
  let ok = false;
  try { ok = await _folderEnsurePassword(); }
  catch (e) { toast('Dossier illisible : ' + (e?.message || e), 'danger'); }
  if (!ok) { _dir = prev; _folderPass = prevPass; _folderRefresh(); return; }

  try { await idbPut(FOLDER_IDB_KEY, handle); }
  catch (e) { toast('Ce navigateur ne mémorise pas le dossier : il faudra le sélectionner à nouveau à chaque ouverture.'); }
  _folderOn = true;
  _bmSet({ folderOn: true, folderName: handle.name });

  _folderState = 'active'; _folderError = ''; _bannerDismissed = false;
  _folderRefresh();
  await folderBackupNow('manual');
}

// ── Reprise après une nouvelle ouverture (geste utilisateur requis) ──
async function folderReconnect() {
  if (!_dir) { await folderChoose(); return; }
  const perm = await _folderPerm(true);
  if (perm !== 'granted') {
    _folderState = 'needs-access';
    _folderRefresh();
    toast('Accès au dossier refusé. Autorisez-le pour reprendre la sauvegarde automatique.', 'danger');
    return;
  }
  let ok = false;
  try { ok = await _folderEnsurePassword(); }
  catch (e) { _folderError = e?.name === 'NotFoundError' ? 'Dossier introuvable (déplacé ou supprimé ?). Choisissez-en un autre.' : (e?.message || String(e)); _folderState = 'error'; _folderRefresh(); return; }
  if (!ok) { _folderRefresh(); return; }
  _folderState = 'active'; _folderError = ''; _bannerDismissed = false;
  _folderRefresh();
  await folderBackupNow('manual');
}

// ── Écriture ───────────────────────────────────────────
function scheduleFolderSave() {
  _folderDirty = true;
  if (_folderState !== 'active') return;
  clearTimeout(_folderTimer);
  // Regroupe les modifications (30 s) et n'écrit pas plus d'une fois par minute
  const wait = Math.max(30000, _folderLastSave + 60000 - Date.now());
  _folderTimer = setTimeout(() => { void folderBackupNow('auto'); }, wait);
}

async function folderBackupNow(reason = 'auto') {
  if (!_dir || _folderState !== 'active' || !_folderPass) return false;
  if (!isConfigured()) return false;                       // jamais d'écrasement après une réinitialisation
  if (_folderSaving) { _folderDirty = true; return false; }
  _folderSaving = true;
  renderFolderBackupStatus();
  const counterAtStart = _changeCounter;
  let saved = false;
  try {
    if (await _folderPerm(false) !== 'granted') {
      _folderState = 'needs-access'; _folderDirty = true;
      return false;
    }
    const envelope = await encryptPayload(_folderPass, getBackupPayload());
    const name = `cabinet-auto-${_localDate()}.cabinet.enc`;
    const fh = await _dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();   // écriture dans un fichier temporaire, validée à la fermeture
    try { await w.write(JSON.stringify(envelope)); await w.close(); }
    catch (e) { try { await w.abort(); } catch (_) {} throw e; }
    await _folderPrune();

    saved = true;
    _folderLastSave = Date.now(); _folderError = '';
    if (_changeCounter === counterAtStart) _folderDirty = false;
    recordBackup('folder');
    if (reason === 'manual') toast('Sauvegarde dans le dossier ✓', 'success');
    return true;
  } catch (e) {
    console.warn('[Cabinet] Sauvegarde dans le dossier échouée.', e);
    _folderError = e?.name === 'NotFoundError' ? 'Dossier introuvable (déplacé ou supprimé ?). Choisissez-en un autre.'
                 : e?.name === 'NotAllowedError' ? 'Accès au dossier refusé par le navigateur.'
                 : (e?.message || String(e));
    _folderState = 'error';
    toast('Sauvegarde dans le dossier impossible : ' + _folderError, 'danger');
    return false;
  } finally {
    _folderSaving = false;
    _folderRefresh();
    if (saved && _folderDirty && _folderState === 'active') scheduleFolderSave();
  }
}

async function folderDisable() {
  if (!confirm('Désactiver la sauvegarde automatique ?\nLes fichiers déjà présents dans le dossier ne seront pas supprimés.')) return;
  clearTimeout(_folderTimer);
  _dir = null; _folderPass = null; _folderOn = false; _folderState = folderSupported() ? 'none' : 'unsupported'; _folderError = '';
  _bmSet({ folderOn: false, folderName: '' });
  try { await idbDelete(FOLDER_IDB_KEY); } catch (e) {}
  _folderRefresh();
  toast('Sauvegarde automatique désactivée');
}


// ── Bloc « Sauvegarde automatique dans un dossier » (Paramètres) ──
function renderFolderBackupStatus() {
  const box = document.getElementById('folder-backup-box');
  if (!box) return;
  box.textContent = '';

  const p = (txt, style) => { const e = document.createElement('p'); e.style.cssText = style || 'font-size:13px;color:var(--warm-mid);line-height:1.6;margin-bottom:.75rem;'; e.textContent = txt; return e; };
  const row = () => { const r = document.createElement('div'); r.style.cssText = 'display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.6rem;'; return r; };
  const info = (cls) => { const d = document.createElement('div'); d.className = 'info-box ' + cls; d.style.cssText = 'font-size:13px;margin-bottom:0;'; return d; };

  if (_folderState === 'unsupported') {
    const d = info('terra');
    d.textContent = 'Cette fonction nécessite Chrome ou Edge sur ordinateur (indisponible sur Firefox et Safari). En attendant, utilisez « Exporter chiffré » régulièrement : le rappel vous y invitera.';
    box.appendChild(d);
    return;
  }

  if (!_folderOn) {
    box.appendChild(p('Une copie chiffrée de vos données est écrite automatiquement dans le dossier de votre choix après chaque modification : clé USB, disque externe ou dossier synchronisé (OneDrive, Dropbox…). Une copie par jour est conservée pendant 10 jours.'));
    box.appendChild(p('Astuce : choisissez un sous-dossier dédié (Chrome peut refuser Documents, Bureau ou Téléchargements). Un dossier situé sur le même disque que le navigateur ne protège pas d’une panne de ce disque.', 'font-size:12px;color:var(--warm-light);line-height:1.6;margin-bottom:.75rem;'));
    const r = row(); r.style.marginTop = '0';
    r.appendChild(_btn('📁 Choisir un dossier…', 'btn-primary', () => { void folderChoose(); }));
    box.appendChild(r);
    return;
  }

  const name = _folderLabel();
  if (_folderState === 'active') {
    const d = info('sage');
    d.appendChild(Object.assign(document.createElement('strong'), { textContent: '✓ Actif ' }));
    d.append(`— dossier « ${name} »`);
    const l = document.createElement('div'); l.style.cssText = 'font-size:12px;margin-top:.25rem;';
    l.textContent = _folderSaving ? 'Sauvegarde en cours…'
      : _folderLastSave ? `Dernière sauvegarde dans le dossier : ${fmtAgo(_folderLastSave)}`
      : 'En attente de la première sauvegarde.';
    d.appendChild(l);
    const r = row();
    r.append(_btn('💾 Sauvegarder maintenant', 'btn-primary', () => { void folderBackupNow('manual'); }),
             _btn('Changer de dossier', 'btn-secondary', () => { void folderChoose(); }),
             _btn('Désactiver', 'btn-secondary', () => { void folderDisable(); }));
    d.appendChild(r);
    box.appendChild(d);
    return;
  }

  // needs-access | error
  const paused = _folderState === 'needs-access';
  const d = info('terra');
  d.appendChild(Object.assign(document.createElement('strong'), { textContent: paused ? '⏸ En pause ' : '⚠ Échec ' }));
  d.append(paused
    ? (_dir ? `— dossier « ${name} ». À chaque ouverture, le navigateur demande de réautoriser l’accès, puis votre mot de passe.`
            : `— dossier « ${name} ». Le navigateur ne l’a pas mémorisé : sélectionnez-le à nouveau, puis saisissez votre mot de passe.`)
    : `— ${_folderError || 'la dernière sauvegarde a échoué.'}`);
  const r = row();
  r.append(_btn(paused ? (_dir ? 'Reprendre' : 'Choisir le dossier') : 'Réessayer', 'btn-primary', () => { void folderReconnect(); }),
           _btn('Changer de dossier', 'btn-secondary', () => { void folderChoose(); }),
           _btn('Désactiver', 'btn-secondary', () => { void folderDisable(); }));
  d.appendChild(r);
  box.appendChild(d);
}
