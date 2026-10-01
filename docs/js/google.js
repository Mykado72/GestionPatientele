/* ══════════════════════════════════════════════════════
   Cabinet de Psychothérapie — google.js
   Google Drive (sauvegarde auto) et Google Agenda (import lecture seule), retour OAuth.
   Dépend de : data.js, utils.js ; appelle showPage/isConfigured (ui/) à l’exécution
   ══════════════════════════════════════════════════════ */

'use strict';


// ════════════════════════════════════════════════════════
// GOOGLE DRIVE — Sauvegarde automatique
// Scope drive.file : l'app ne voit que ses propres fichiers
// Token séparé de Google Agenda (même Client ID, scope différent)
// ════════════════════════════════════════════════════════

const GDRIVE_SCOPE      = 'https://www.googleapis.com/auth/drive.file';
const GDRIVE_API        = 'https://www.googleapis.com/drive/v3';
const GDRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const GDRIVE_FILENAME   = 'cabinet-psychotherapie-backup.json';

// État OAuth imprévisible (anti-CSRF) et comparaison à durée constante
function oauthRandomState(prefix) {
  const r = crypto.getRandomValues(new Uint8Array(24));
  return prefix + Array.from(r, b => b.toString(16).padStart(2, '0')).join('');
}
function constEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

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
  const state = oauthRandomState('gdrive-');
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

function revokeGoogleToken(tok) {
  if (!tok) return;
  fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'token=' + encodeURIComponent(tok)
  }).catch(() => {});
}

function gdriveDisconnect() {
  revokeGoogleToken(gdriveToken());
  _drivePass = null;
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
let _drivePass       = null;   // mot de passe de chiffrement des sauvegardes Drive — mémoire uniquement

// Planifie une sauvegarde Drive dans 30s (debounced)
function scheduleDriveSave() {
  if (!gdriveAlive() || !_drivePass) return;
  clearTimeout(_driveSaveTimer);
  _driveSaveTimer = setTimeout(() => { void driveBackupNow(); }, 30_000);
}

// Sauvegarde immédiate
async function driveBackupNow() {
  if (!gdriveAlive()) { renderGdriveStatus(); return; }
  if (_driveSaving)   return;  // déjà en cours

  // Les données de santé ne quittent jamais l'appareil en clair : chiffrement obligatoire
  if (!_drivePass) {
    const pass = await askBackupPassword({
      title: '🔐 Chiffrement de la sauvegarde Drive',
      text: 'Vos données sont chiffrées sur cet appareil avant envoi à Google Drive. Choisissez un mot de passe (12 caractères minimum) et conservez-le : sans lui, la restauration est impossible.',
      confirm: true, confirmLabel: 'Chiffrer et sauvegarder'
    });
    if (pass === null) { toast('Sauvegarde Drive annulée'); return; }
    _drivePass = pass;
  }

  _driveSaving = true;
  renderGdriveStatus();

  try {
    const envelope = await encryptPayload(_drivePass, getBackupPayload());
    const blob     = new Blob([JSON.stringify(envelope)], { type: 'application/json' });

    if (CFG.gdriveFileId) {
      // Mise à jour du fichier existant (PATCH multipart)
      await _driveUpload('PATCH', '/' + encodeURIComponent(CFG.gdriveFileId), blob);
    } else {
      // Création du fichier + récupération de son ID
      const meta = JSON.stringify({ name: GDRIVE_FILENAME, mimeType: 'application/json' });
      const res  = await _driveUpload('POST', '', blob, meta);
      if (res?.id) { CFG.gdriveFileId = res.id; cfgSave(); }
    }

    _driveLastSaved = Date.now();
    recordBackup('drive');
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

    if (!DRIVE_ID_RE.test(fileId)) throw new Error('Identifiant de fichier Drive invalide');
    const res  = await fetch(`${GDRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, {
      headers: { Authorization: 'Bearer ' + gdriveToken() }
    });
    if (!res.ok) throw new Error('Lecture Drive échouée (' + res.status + ')');
    let data = await res.json();

    if (isEncryptedEnvelope(data)) {
      const pass = await askBackupPassword({
        title: '🔓 Restaurer depuis Drive',
        text: 'Saisissez le mot de passe de chiffrement de la sauvegarde.',
        confirm: false, confirmLabel: 'Déchiffrer'
      });
      if (pass === null) return;
      data = await decryptEnvelope(data, pass);
      _drivePass = pass;
    }
    // (une ancienne sauvegarde en clair reste restaurable ; elle sera rechiffrée au prochain envoi)
    applyImportedData(data);   // validation stricte + persistance + rafraîchissement
    toast('Restauration depuis Drive réussie ✓', 'success');
  } catch (e) {
    const cryptoErr = e?.name === 'OperationError';
    alert(cryptoErr ? 'Mot de passe incorrect ou sauvegarde illisible.' : 'Restauration échouée : ' + e.message);
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

// Capture du retour OAuth : on extrait le jeton de l'URL immédiatement (et on nettoie l'historique),
// mais il n'est validé et enregistré qu'après le chargement/déverrouillage des données.
let _pendingOAuth = null;
;(function catchOAuth() {
  if (!location.hash.includes('access_token')) return;
  const p   = new URLSearchParams(location.hash.slice(1));
  const tok = p.get('access_token'); if (!tok) return;
  _pendingOAuth = {
    tok,
    exp:   parseInt(p.get('expires_in') || '3600'),
    st:    p.get('state') || '',
    type:  (p.get('token_type') || '').toLowerCase()
  };
  history.replaceState(null, '', location.pathname);
})();

async function processOAuthReturn() {
  const o = _pendingOAuth; _pendingOAuth = null;
  if (!o) return;

  const kind = o.st.startsWith('gdrive-') ? 'gdrive' : o.st.startsWith('gcal-') ? 'gcal' : null;
  if (!kind) return;

  // État obligatoire et strictement identique à celui émis avant la redirection
  const expected = sessionStorage.getItem(`psy-${kind}-state`);
  sessionStorage.removeItem(`psy-${kind}-state`);
  if (!expected || !constEq(expected, o.st) || o.type !== 'bearer') {
    toast('Connexion Google refusée (état de session invalide)', 'danger');
    return;
  }

  // Le jeton doit avoir été émis pour NOTRE client OAuth avec le bon périmètre
  try {
    const r    = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(o.tok));
    const info = await r.json();
    const want = kind === 'gdrive' ? GDRIVE_SCOPE : GCAL_SCOPE;
    const aud  = info.aud || info.azp;
    if (!r.ok || !CFG.gcalClientId || aud !== CFG.gcalClientId || !String(info.scope || '').split(' ').includes(want)) {
      throw new Error('jeton non conforme');
    }
  } catch (e) {
    toast('Jeton Google non valide : connexion annulée', 'danger');
    return;
  }

  const exp = Math.min(Math.max(o.exp || 0, 60), 3600);

  if (kind === 'gdrive') {
    gdriveSaveToken(o.tok);
    sessionStorage.setItem('psy-gdrive-exp', Date.now() + exp * 1000);
    if (!isConfigured()) return;
    renderGdriveStatus();
    showPage('parametres', document.querySelectorAll('.nav-btn')[4]);
    toast('Google Drive connecté ✓ — sauvegarde chiffrée activée', 'success');
    void driveBackupNow();
    return;
  }

  gcalSaveToken(o.tok);
  sessionStorage.setItem('psy-gcal-exp', Date.now() + exp * 1000);
  if (!isConfigured()) return;
  showPage('seances', document.querySelectorAll('.nav-btn')[2]);
  openGcalImportPanel();
}

function gcalConnect() {
  const clientId = CFG.gcalClientId;
  if (!clientId) { alert('Veuillez d\'abord saisir votre Client ID Google dans les paramètres.'); return; }
  const state = oauthRandomState('gcal-');
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
  revokeGoogleToken(gcalToken());
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
      const color    = /^#[0-9a-fA-F]{6}$/.test(c.backgroundColor || '') ? c.backgroundColor : '#6b8f71';
      const isSelected = c.id === lastUsed || (!lastUsed && c.primary);
      return `<label class="gcal-cal-card${isSelected ? ' selected' : ''}" data-calid="${esc(c.id)}" onclick="selectGcalCal(this, this.dataset.calid)">
        <input type="radio" name="gcal-cal" value="${esc(c.id)}" ${isSelected ? 'checked' : ''} style="display:none;">
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
      `<option value="${esc(p.id)}"${matchedPat?.id === p.id ? ' selected' : ''}>${esc(p.prenom)} ${esc(p.nom.toUpperCase())}</option>`
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
