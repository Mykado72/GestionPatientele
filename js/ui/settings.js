/* ══════════════════════════════════════════════════════
   Cabinet de Psychothérapie — ui/settings.js
   Logo, configuration initiale et page Paramètres.
   Dépend de : data.js, utils.js
   ══════════════════════════════════════════════════════ */

'use strict';


// ════════════════════════════════════════════════════════
// LOGO
// ════════════════════════════════════════════════════════

function handleLogoUpload(pfx) {
  const file = document.getElementById(`${pfx}-logo-input`).files[0];
  if (!file) return;
  if (file.size > 500 * 1024) { alert('Logo trop volumineux (max 500 Ko).'); return; }
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { alert('Format non pris en charge (PNG, JPEG, GIF ou WebP uniquement).'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const logo = safeLogo(e.target.result);
    if (!logo) { alert('Image invalide.'); return; }
    CFG.logo = logo;
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
  if (safeLogo(CFG.logo)) {
    img.src = safeLogo(CFG.logo);
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
  renderSecurityStatus();
  renderStorageStatus();
  renderPwaStatus();
  renderBackupInfo();
  renderFolderBackupStatus();

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
  try { await idbDelete(VAULT_IDB_KEY); } catch (e) {}
  try { await idbDelete(FOLDER_IDB_KEY); } catch (e) {}
  localStorage.removeItem(BACKUP_META_KEY);
  localStorage.removeItem('psy-db');   // au cas où le fallback était actif
  localStorage.removeItem('psy-cfg');
  sessionStorage.clear();              // jetons Google, état de verrouillage
  location.reload();
}
