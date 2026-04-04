/* ══════════════════════════════════════════════
   Cabinet de Psychothérapie — Logique applicative
   ══════════════════════════════════════════════ */

'use strict';

// ════════════════════════════════════════
// DATA STORE
// ════════════════════════════════════════
let DB = { patients: [], seances: [], factures: [], nextNum: 1 };
let CFG = {
  prenom:'', nom:'', titre:'', formation:'',
  adresse:'', cp:'', ville:'', tel:'', email:'',
  siret:'', tvaNum:'', tvaMention:'', tarif: 60, delai: 30,
  iban:'', bic:'', banque:'', paiements:'Espèces, chèque, virement bancaire'
};

function dbLoad() {
  try { const d = localStorage.getItem('psy-db');  if (d) DB  = JSON.parse(d); } catch(e) {}
  try { const c = localStorage.getItem('psy-cfg'); if (c) CFG = { ...CFG, ...JSON.parse(c) }; } catch(e) {}
}
function dbSave()  { try { localStorage.setItem('psy-db',  JSON.stringify(DB));  } catch(e) {} }
function cfgSave() { try { localStorage.setItem('psy-cfg', JSON.stringify(CFG)); } catch(e) {} }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ════════════════════════════════════════
// UTILS
// ════════════════════════════════════════
const MOIS_LONG  = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const MOIS_SHORT = ['jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'];
const MOIS_NOMS  = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

function formatDate(d) {
  if (!d) return '—';
  const [y, m, j] = d.split('-');
  return parseInt(j) + ' ' + MOIS_LONG[parseInt(m)-1] + ' ' + y;
}
function formatDateShort(d) {
  if (!d) return '—';
  const [y, m, j] = d.split('-');
  return parseInt(j) + ' ' + MOIS_SHORT[parseInt(m)-1] + ' ' + y;
}
function today() { return new Date().toISOString().split('T')[0]; }
function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}
function fmtMoney(n) { return n.toFixed(2).replace('.', ',') + ' €'; }
function fmtNum(n)   { return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

function toast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 3000);
}

function getPatientName(id, upper = true) {
  const p = DB.patients.find(p => p.id === id);
  if (!p) return '—';
  return upper ? p.prenom + ' ' + p.nom.toUpperCase() : p.prenom + ' ' + p.nom;
}

// ════════════════════════════════════════
// CONFIG / SETUP
// ════════════════════════════════════════
function isConfigured() { return !!(CFG.prenom && CFG.nom && CFG.siret); }

function toggleTvaCustom(pfx) {
  const v = document.getElementById(pfx + '-tva-mention').value;
  document.getElementById(pfx + '-tva-custom-group').style.display = v === 'custom' ? 'block' : 'none';
}

function getTvaMention(pfx) {
  const v = document.getElementById(pfx + '-tva-mention').value;
  return v === 'custom' ? (document.getElementById(pfx + '-tva-custom').value.trim() || '') : v;
}

function collectCfg(pfx) {
  return {
    prenom:     document.getElementById(pfx+'-prenom').value.trim(),
    nom:        document.getElementById(pfx+'-nom').value.trim(),
    titre:      document.getElementById(pfx+'-titre').value.trim(),
    formation:  document.getElementById(pfx+'-formation').value.trim(),
    adresse:    document.getElementById(pfx+'-adresse').value.trim(),
    cp:         document.getElementById(pfx+'-cp').value.trim(),
    ville:      document.getElementById(pfx+'-ville').value.trim(),
    tel:        document.getElementById(pfx+'-tel').value.trim(),
    email:      document.getElementById(pfx+'-email').value.trim(),
    siret:      document.getElementById(pfx+'-siret').value.trim(),
    tvaNum:     document.getElementById(pfx+'-tva-num').value.trim(),
    tvaMention: getTvaMention(pfx),
    tarif:      parseFloat(document.getElementById(pfx+'-tarif').value) || 60,
    delai:      parseInt(document.getElementById(pfx+'-delai').value) || 30,
    iban:       document.getElementById(pfx+'-iban').value.trim(),
    bic:        document.getElementById(pfx+'-bic').value.trim(),
    banque:     document.getElementById(pfx+'-banque').value.trim(),
    paiements:  document.getElementById(pfx+'-paiements').value.trim()
  };
}

function saveConfig() {
  const cfg = collectCfg('c');
  if (!cfg.prenom || !cfg.nom) { alert('Prénom et nom sont obligatoires.'); return; }
  if (!cfg.siret) { alert('Le SIRET est obligatoire pour émettre des factures.'); return; }
  CFG = cfg;
  cfgSave();
  document.getElementById('setup-screen').classList.add('hidden');
  updateHeader();
  toast('Configuration enregistrée ✓', 'success');
  renderDashboard();
}

function saveSettings() {
  const cfg = collectCfg('s');
  CFG = { ...CFG, ...cfg };
  const nn = parseInt(document.getElementById('s-next-num').value);
  if (nn > 0) DB.nextNum = nn;
  cfgSave(); dbSave();
  updateHeader();
  toast('Paramètres enregistrés ✓', 'success');
}

function loadSettingsForm() {
  const map = {
    prenom:'s-prenom', nom:'s-nom', titre:'s-titre', formation:'s-formation',
    adresse:'s-adresse', cp:'s-cp', ville:'s-ville', tel:'s-tel', email:'s-email',
    siret:'s-siret', tvaNum:'s-tva-num', iban:'s-iban', bic:'s-bic',
    banque:'s-banque', paiements:'s-paiements'
  };
  Object.entries(map).forEach(([k, id]) => { const el = document.getElementById(id); if (el) el.value = CFG[k] || ''; });
  document.getElementById('s-tarif').value  = CFG.tarif;
  document.getElementById('s-delai').value  = CFG.delai || 30;
  document.getElementById('s-next-num').value = DB.nextNum;
  const sel = document.getElementById('s-tva-mention');
  const known = Array.from(sel.options).map(o => o.value);
  if (known.includes(CFG.tvaMention)) {
    sel.value = CFG.tvaMention;
  } else if (CFG.tvaMention) {
    sel.value = 'custom';
    document.getElementById('s-tva-custom').value = CFG.tvaMention;
    document.getElementById('s-tva-custom-group').style.display = 'block';
  }
}

function updateHeader() {
  if (!CFG.prenom) return;
  const ini = (CFG.prenom[0] + (CFG.nom[0] || '')).toUpperCase();
  document.getElementById('hdr-initials').textContent = ini;
  document.getElementById('hdr-name').textContent     = CFG.prenom + ' ' + CFG.nom.toUpperCase();
  document.getElementById('hdr-sub').textContent      = CFG.titre || 'Cabinet de Psychothérapie';
  document.getElementById('dash-greeting').textContent = 'Bonjour, ' + CFG.prenom;
  document.title = 'Cabinet ' + CFG.prenom + ' ' + CFG.nom;
}

function resetApp() {
  if (!confirm('Supprimer TOUTES les données ? Action irréversible.')) return;
  localStorage.removeItem('psy-db');
  localStorage.removeItem('psy-cfg');
  location.reload();
}

// ════════════════════════════════════════
// EXPORT / IMPORT
// ════════════════════════════════════════
function exportData() {
  const data = { db: DB, cfg: CFG, exportedAt: new Date().toISOString(), version: '1.0' };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'cabinet-backup-' + today() + '.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('Export téléchargé ✓', 'success');
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.db || !data.cfg) throw new Error('Format invalide');
        if (!confirm('Remplacer toutes les données actuelles par celles du fichier importé ?')) return;
        DB  = data.db;
        CFG = { ...CFG, ...data.cfg };
        dbSave(); cfgSave();
        updateHeader();
        renderDashboard();
        toast('Import réussi ✓', 'success');
      } catch(err) {
        alert('Fichier invalide : ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════
function showPage(id, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  btn.classList.add('active');
  if (id === 'dashboard')   renderDashboard();
  if (id === 'patients')    renderPatients();
  if (id === 'seances')     { populateFilterPat(); renderSeances(); }
  if (id === 'factures')    renderFactures();
  if (id === 'parametres')  loadSettingsForm();
}

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  if (id === 'modal-patient')  resetPatientForm();
  if (id === 'modal-seance')   resetSeanceForm();
  if (id === 'modal-facture')  initFactureModal();
}
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function showTab(tabId, btn) {
  const modal = btn.closest('.modal');
  modal.querySelectorAll('[data-tab]').forEach(t => t.style.display = 'none');
  document.getElementById(tabId).style.display = 'block';
  modal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// Close on backdrop click
document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) o.classList.add('hidden'); });
});

// ════════════════════════════════════════
// PATIENTS
// ════════════════════════════════════════
function resetPatientForm(p = null) {
  document.getElementById('p-edit-id').value = '';
  document.getElementById('mp-title').textContent = 'Nouveau patient';
  ['p-prenom','p-nom','p-tel','p-email','p-adresse','p-motif','p-notes'].forEach(f => {
    document.getElementById(f).value = p ? (p[f.replace('p-','')] || '') : '';
  });
  document.getElementById('p-tarif').value   = p ? p.tarif   : (CFG.tarif || 60);
  document.getElementById('p-statut').value  = p ? p.statut  : 'actif';
  document.getElementById('p-naissance').value = p ? (p.naissance || '') : '';
  const firstTab = document.querySelector('#modal-patient .tab-btn');
  showTab('tab-infos', firstTab);
}

function savePatient() {
  const prenom = document.getElementById('p-prenom').value.trim();
  const nom    = document.getElementById('p-nom').value.trim();
  if (!prenom || !nom) { alert('Prénom et nom requis.'); return; }

  const id   = document.getElementById('p-edit-id').value;
  const data = {
    prenom, nom,
    naissance: document.getElementById('p-naissance').value,
    tel:       document.getElementById('p-tel').value.trim(),
    email:     document.getElementById('p-email').value.trim(),
    adresse:   document.getElementById('p-adresse').value.trim(),
    tarif:     parseFloat(document.getElementById('p-tarif').value) || CFG.tarif || 60,
    statut:    document.getElementById('p-statut').value,
    motif:     document.getElementById('p-motif').value.trim(),
    notes:     document.getElementById('p-notes').value.trim()
  };

  if (id) {
    const idx = DB.patients.findIndex(p => p.id === id);
    if (idx > -1) { data.id = id; data.createdAt = DB.patients[idx].createdAt; DB.patients[idx] = data; }
  } else {
    data.id = uid(); data.createdAt = new Date().toISOString();
    DB.patients.push(data);
  }
  dbSave();
  closeModal('modal-patient');
  renderPatients();
  toast('Patient enregistré ✓', 'success');
}

function editPatient(id) {
  const p = DB.patients.find(p => p.id === id); if (!p) return;
  openModal('modal-patient');
  document.getElementById('p-edit-id').value = id;
  document.getElementById('mp-title').textContent = 'Modifier le patient';
  resetPatientForm(p);
  document.getElementById('p-edit-id').value = id; // reset clears it
}

function deletePatient(id) {
  if (!confirm('Supprimer ce patient ? Ses séances resteront enregistrées.')) return;
  DB.patients = DB.patients.filter(p => p.id !== id);
  dbSave();
  closeModal('modal-fiche');
  renderPatients();
  toast('Patient supprimé');
}

function viewPatient(id) {
  const p = DB.patients.find(p => p.id === id); if (!p) return;
  const seances = DB.seances.filter(s => s.patientId === id).sort((a,b) => b.date.localeCompare(a.date));
  const ini = (p.prenom[0] + p.nom[0]).toUpperCase();
  const age = p.naissance ? Math.floor((Date.now() - new Date(p.naissance)) / 31557600000) + ' ans' : '';

  const seancesHTML = seances.length === 0
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
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
        <button class="btn btn-secondary btn-sm" onclick="editPatientFromFiche('${id}')">✎ Modifier</button>
        <button class="btn btn-danger btn-sm" onclick="deletePatient('${id}')">Supprimer</button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1.25rem;font-size:13px;">
      ${p.tel    ? `<div><span style="color:var(--warm-mid);">Tél :</span> ${p.tel}</div>` : ''}
      ${p.email  ? `<div><span style="color:var(--warm-mid);">Email :</span> ${p.email}</div>` : ''}
      ${p.adresse? `<div style="grid-column:1/-1"><span style="color:var(--warm-mid);">Adresse :</span> ${p.adresse}</div>` : ''}
      <div><span style="color:var(--warm-mid);">Tarif :</span> ${p.tarif} € / séance</div>
      <div><span style="color:var(--warm-mid);">Statut :</span> <span class="badge badge-${p.statut === 'actif' ? 'actif' : 'annulé'}">${p.statut}</span></div>
    </div>

    ${p.notes ? `<div class="section-title">Notes thérapeutiques</div><div class="notes-block" style="margin-bottom:1.25rem;">${p.notes}</div>` : ''}

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem;">
      <div class="section-title" style="margin-bottom:0;">Séances (${seances.length})</div>
      <button class="btn btn-primary btn-sm" onclick="addSeanceForPatient('${id}')">+ Ajouter séance</button>
    </div>
    <div id="fiche-seances-list">${seancesHTML}</div>
  `;
  document.getElementById('modal-fiche').classList.remove('hidden');
}

function editPatientFromFiche(id) {
  closeModal('modal-fiche');
  editPatient(id);
}

function addSeanceForPatient(patientId) {
  closeModal('modal-fiche');
  openModal('modal-seance');
  setTimeout(() => {
    document.getElementById('s-patient').value = patientId;
    const p = DB.patients.find(p => p.id === patientId);
    if (p) document.getElementById('s-tarif').value = p.tarif;
    // remember to reopen fiche after save
    document.getElementById('s-return-patient').value = patientId;
  }, 50);
}

function viewSeanceFromFiche(seanceId, patientId) {
  document.getElementById('s-return-patient').value = patientId;
  viewSeance(seanceId, patientId);
}

function editSeanceFromFiche(seanceId, patientId) {
  document.getElementById('s-return-patient').value = patientId;
  editSeance(seanceId);
}

function refreshFicheSeances(patientId) {
  const p = DB.patients.find(p => p.id === patientId); if (!p) return;
  const seances = DB.seances.filter(s => s.patientId === patientId).sort((a,b) => b.date.localeCompare(a.date));
  const el = document.getElementById('fiche-seances-list');
  if (!el) return;
  if (seances.length === 0) {
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
  const q = document.getElementById('search-patients').value.toLowerCase();
  const el = document.getElementById('patients-list');
  const filtered = DB.patients.filter(p =>
    (p.prenom + ' ' + p.nom).toLowerCase().includes(q) ||
    (p.motif || '').toLowerCase().includes(q)
  );
  if (filtered.length === 0) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="ei">◈</div>
      <p>${DB.patients.length === 0 ? 'Aucun patient enregistré' : 'Aucun résultat pour « ' + q + ' »'}</p>
      ${DB.patients.length === 0 ? '<button class="btn btn-primary" onclick="openModal(\'modal-patient\')">+ Ajouter un patient</button>' : ''}
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

// ════════════════════════════════════════
// SÉANCES
// ════════════════════════════════════════
function resetSeanceForm() {
  document.getElementById('s-edit-id').value = '';
  document.getElementById('s-return-patient').value = '';
  document.getElementById('ms-title').textContent = 'Nouvelle séance';
  populateSelectPat('s-patient');
  document.getElementById('s-date').value    = today();
  document.getElementById('s-heure').value   = '10:00';
  document.getElementById('s-duree').value   = '60';
  document.getElementById('s-tarif').value   = CFG.tarif || 60;
  document.getElementById('s-statut').value  = 'planifié';
  document.getElementById('s-paiement').value= '';
  document.getElementById('s-notes').value   = '';
  // Récurrence
  document.getElementById('s-recurrence').checked = false;
  toggleRecurrence();
}

function toggleRecurrence() {
  const on = document.getElementById('s-recurrence').checked;
  document.getElementById('recurrence-box').style.display = on ? 'block' : 'none';
  if (on) updateRecurrencePreview();
}

function updateRecurrencePreview() {
  const startDate = document.getElementById('s-date').value;
  const freq  = parseInt(document.getElementById('s-rec-freq').value)  || 7;
  const count = parseInt(document.getElementById('s-rec-count').value) || 4;
  if (!startDate || count < 1) { document.getElementById('rec-preview').textContent = ''; return; }
  let dates = [];
  for (let i = 1; i < count; i++) dates.push(formatDateShort(addDays(startDate, freq * i)));
  document.getElementById('rec-preview').innerHTML =
    `<strong>${count} séances</strong> planifiées :<br>` +
    [formatDateShort(startDate), ...dates].join(' · ');
}

document.getElementById('s-patient').addEventListener('change', function() {
  const p = DB.patients.find(p => p.id === this.value);
  if (p) document.getElementById('s-tarif').value = p.tarif;
});

function saveSeance() {
  const patientId = document.getElementById('s-patient').value;
  const date      = document.getElementById('s-date').value;
  const heure     = document.getElementById('s-heure').value;
  if (!patientId || !date || !heure) { alert('Patient, date et heure sont requis.'); return; }

  const id      = document.getElementById('s-edit-id').value;
  const returnTo = document.getElementById('s-return-patient').value;
  const base    = {
    patientId, date, heure,
    duree:    parseInt(document.getElementById('s-duree').value),
    tarif:    parseFloat(document.getElementById('s-tarif').value) || 60,
    statut:   document.getElementById('s-statut').value,
    paiement: document.getElementById('s-paiement').value,
    notes:    document.getElementById('s-notes').value.trim()
  };

  if (id) {
    // Edition
    const idx = DB.seances.findIndex(s => s.id === id);
    if (idx > -1) { base.id = id; base.facture = DB.seances[idx].facture; DB.seances[idx] = base; }
  } else {
    // Nouvelle(s) séance(s)
    const recur = document.getElementById('s-recurrence').checked;
    if (recur) {
      const freq  = parseInt(document.getElementById('s-rec-freq').value)  || 7;
      const count = parseInt(document.getElementById('s-rec-count').value) || 1;
      for (let i = 0; i < count; i++) {
        const s = { ...base, id: uid(), facture: null, date: addDays(date, freq * i) };
        DB.seances.push(s);
      }
    } else {
      base.id = uid(); base.facture = null;
      DB.seances.push(base);
    }
  }

  dbSave();
  closeModal('modal-seance');

  if (returnTo) {
    viewPatient(returnTo);
  } else {
    renderSeances();
    renderDashboard();
  }
  toast('Séance(s) enregistrée(s) ✓', 'success');
}

function editSeance(id) {
  const s = DB.seances.find(s => s.id === id); if (!s) return;
  openModal('modal-seance');
  setTimeout(() => {
    document.getElementById('s-edit-id').value    = id;
    document.getElementById('ms-title').textContent = 'Modifier la séance';
    document.getElementById('s-patient').value    = s.patientId;
    document.getElementById('s-date').value       = s.date;
    document.getElementById('s-heure').value      = s.heure;
    document.getElementById('s-duree').value      = s.duree;
    document.getElementById('s-tarif').value      = s.tarif;
    document.getElementById('s-statut').value     = s.statut;
    document.getElementById('s-paiement').value   = s.paiement || '';
    document.getElementById('s-notes').value      = s.notes || '';
    document.getElementById('s-recurrence').checked = false;
    toggleRecurrence();
  }, 50);
}

function deleteSeance(id) {
  if (!confirm('Supprimer cette séance ?')) return;
  const returnTo = document.getElementById('s-return-patient').value;
  DB.seances = DB.seances.filter(s => s.id !== id);
  dbSave();
  closeModal('modal-seance-view');
  if (returnTo) {
    refreshFicheSeances(returnTo);
  } else {
    renderSeances();
    renderDashboard();
  }
  toast('Séance supprimée');
}

function marquerStatut(id, statut) {
  const s = DB.seances.find(s => s.id === id); if (!s) return;
  s.statut = statut;
  dbSave();
  const returnTo = document.getElementById('s-return-patient').value;
  closeModal('modal-seance-view');
  if (returnTo) {
    refreshFicheSeances(returnTo);
    viewSeanceFromFiche(id, returnTo);
  } else {
    renderSeances(); renderDashboard();
  }
  toast('Statut mis à jour ✓', 'success');
}

function viewSeance(id, returnPatientId = '') {
  const s = DB.seances.find(s => s.id === id); if (!s) return;
  if (returnPatientId) document.getElementById('s-return-patient').value = returnPatientId;
  const pn = getPatientName(s.patientId);
  const isTodayOrPast = s.date <= today();
  const retId = document.getElementById('s-return-patient').value;

  const actionBtns = `
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1.25rem;border-top:1px solid var(--beige-mid);padding-top:1.25rem;">
      <button class="btn btn-secondary btn-sm" onclick="closeModal('modal-seance-view');editSeance('${id}')">✎ Modifier</button>
      ${s.statut === 'planifié' ? `
        <button class="btn btn-success btn-sm" onclick="marquerStatut('${id}','honoré')">✓ Honorée</button>
        <button class="btn btn-danger btn-sm" onclick="marquerStatut('${id}','annulé')">✕ Annuler</button>` : ''}
      ${s.statut === 'honoré' ? `
        <button class="btn btn-info btn-sm" onclick="marquerStatut('${id}','réglée')">💶 Marquer réglée</button>` : ''}
      ${s.statut === 'réglée' && !s.facture ? `
        <button class="btn btn-primary btn-sm" onclick="closeModal('modal-seance-view');genFactureFromSeance('${id}')">📄 Générer facture</button>` : ''}
      ${s.statut === 'réglée' && s.facture ? `
        <button class="btn btn-secondary btn-sm" onclick="closeModal('modal-seance-view');viewFacture('${s.facture}')">📄 Voir la facture</button>` : ''}
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
      ${s.paiement ? `<div style="display:flex;gap:.75rem;"><span style="color:var(--warm-mid);min-width:110px;">Paiement</span><span>${s.paiement}</span></div>` : ''}
      ${s.facture  ? `<div style="display:flex;gap:.75rem;align-items:center;"><span style="color:var(--warm-mid);min-width:110px;">Facture</span><span class="badge badge-réglée">Facturée</span></div>` : ''}
    </div>
    ${s.notes ? `<div style="margin-top:1rem;"><div class="section-title">Notes</div><div class="notes-block">${s.notes}</div></div>` : ''}
    ${actionBtns}`;

  document.getElementById('modal-seance-view').classList.remove('hidden');
}

function genFactureFromSeance(seanceId) {
  const s = DB.seances.find(s => s.id === seanceId); if (!s) return;
  openModal('modal-facture');
  setTimeout(() => {
    document.getElementById('f-patient').value = s.patientId;
    populateFactureSeances();
    // Auto-check this seance
    setTimeout(() => {
      const cb = document.querySelector(`.f-cb[value="${seanceId}"]`);
      if (cb) { cb.checked = true; updateFTotal(); }
    }, 50);
  }, 100);
}

function populateFilterPat() {
  const sel = document.getElementById('filter-pat');
  sel.innerHTML = '<option value="">Tous les patients</option>' +
    DB.patients.map(p => `<option value="${p.id}">${p.prenom} ${p.nom.toUpperCase()}</option>`).join('');
}

function populateSelectPat(selId) {
  const sel = document.getElementById(selId);
  sel.innerHTML = '<option value="">— Sélectionner —</option>' +
    DB.patients.map(p => `<option value="${p.id}">${p.prenom} ${p.nom.toUpperCase()}</option>`).join('');
}

function renderSeances() {
  const st  = document.getElementById('filter-statut').value;
  const pid = document.getElementById('filter-pat').value;
  let list  = [...DB.seances].sort((a,b) => b.date.localeCompare(a.date) || b.heure.localeCompare(a.heure));
  if (st)  list = list.filter(s => s.statut === st);
  if (pid) list = list.filter(s => s.patientId === pid);
  const el = document.getElementById('seances-list');
  if (list.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="ei">◷</div><p>Aucune séance</p><button class="btn btn-primary" onclick="openModal('modal-seance')">+ Ajouter</button></div>`;
    return;
  }
  el.innerHTML = list.map(s => {
    const pn = getPatientName(s.patientId);
    const d  = s.date.split('-');
    const mo = MOIS_SHORT[parseInt(d[1])-1];
    return `<div class="rdv-item" onclick="viewSeance('${s.id}')">
      <div class="rdv-date"><div class="day">${d[2]}</div><div class="month">${mo}</div></div>
      <div style="flex:1;">
        <div style="font-size:14px;font-weight:500;">${pn}</div>
        <div style="font-size:12px;color:var(--warm-mid);margin-top:2px;">${s.heure} · ${s.duree} min${s.paiement ? ' · ' + s.paiement : ''}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
        <span class="badge badge-${s.statut}">${s.statut}</span>
        <span style="font-family:var(--font-serif);font-size:17px;">${s.tarif} €</span>
      </div>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════
// FACTURES — Conformité 2026-2027
// ════════════════════════════════════════
function initFactureModal() {
  populateSelectPat('f-patient');
  const t = new Date();
  document.getElementById('f-date').value     = today();
  const ech = new Date(t); ech.setDate(ech.getDate() + (CFG.delai || 30));
  document.getElementById('f-echeance').value = ech.toISOString().split('T')[0];
  document.getElementById('f-objet').value    = 'Séances de psychothérapie';
  document.getElementById('f-total-preview').textContent = '0,00 €';
  document.getElementById('f-seances-select').innerHTML =
    '<div style="color:var(--warm-mid);font-size:13px;padding:.5rem;">Sélectionnez un patient d\'abord</div>';
  document.getElementById('cfg-warn').style.display = (!CFG.siret || !CFG.adresse) ? 'block' : 'none';
}

function populateFactureSeances() {
  const pId = document.getElementById('f-patient').value;
  const c   = document.getElementById('f-seances-select');
  if (!pId) {
    c.innerHTML = '<div style="color:var(--warm-mid);font-size:13px;padding:.5rem;">Sélectionnez un patient d\'abord</div>';
    document.getElementById('f-total-preview').textContent = '0,00 €';
    return;
  }
  // Include séances réglées OR honorées non encore facturées
  const seances = DB.seances.filter(s =>
    s.patientId === pId &&
    (s.statut === 'réglée' || s.statut === 'honoré') &&
    !s.facture
  ).sort((a,b) => a.date.localeCompare(b.date));

  if (seances.length === 0) {
    c.innerHTML = '<div style="color:var(--warm-mid);font-size:13px;padding:.5rem;">Aucune séance honorée/réglée non facturée</div>';
    document.getElementById('f-total-preview').textContent = '0,00 €';
    return;
  }
  c.innerHTML = seances.map(s => `
    <label style="display:flex;align-items:center;gap:.75rem;padding:.5rem;cursor:pointer;border-radius:6px;"
      onmouseover="this.style.background='var(--beige)'" onmouseout="this.style.background=''">
      <input type="checkbox" class="f-cb" value="${s.id}" data-tarif="${s.tarif}"
        data-paiement="${s.paiement || ''}"
        onchange="updateFTotal()" style="width:auto;accent-color:var(--sage);">
      <span style="flex:1;font-size:13px;">
        ${formatDate(s.date)} à ${s.heure} — ${s.duree} min
        ${s.paiement ? '<span style="color:var(--warm-mid);"> · '+s.paiement+'</span>' : ''}
        <span class="badge badge-${s.statut}" style="font-size:10px;margin-left:4px;">${s.statut}</span>
      </span>
      <span style="font-family:var(--font-serif);font-size:15px;">${s.tarif} €</span>
    </label>`).join('');
  updateFTotal();
}

function updateFTotal() {
  const cbs   = document.querySelectorAll('.f-cb:checked');
  const total = Array.from(cbs).reduce((a, cb) => a + parseFloat(cb.dataset.tarif), 0);
  document.getElementById('f-total-preview').textContent = fmtMoney(total);
}

function genererFacture() {
  const pId = document.getElementById('f-patient').value;
  const cbs = document.querySelectorAll('.f-cb:checked');
  if (!pId || cbs.length === 0) { alert('Sélectionnez un patient et au moins une séance.'); return; }
  if (!CFG.siret) { alert('SIRET requis. Complétez vos paramètres.'); return; }

  const yr    = new Date().getFullYear();
  const num   = yr + '-' + String(DB.nextNum).padStart(4, '0');
  DB.nextNum++;

  const ids    = Array.from(cbs).map(cb => cb.value);
  const seances = ids.map(id => DB.seances.find(s => s.id === id)).filter(Boolean);
  const total   = seances.reduce((a, s) => a + s.tarif, 0);

  // Collect paiement modes from séances
  const paiements = [...new Set(seances.map(s => s.paiement).filter(Boolean))];

  const f = {
    id: uid(), num, patientId: pId, seancesIds: ids,
    date:     document.getElementById('f-date').value,
    echeance: document.getElementById('f-echeance').value,
    objet:    document.getElementById('f-objet').value,
    paiementsSeances: paiements,
    total, createdAt: new Date().toISOString()
  };

  DB.factures.push(f);
  ids.forEach(id => { const s = DB.seances.find(s => s.id === id); if (s) { s.facture = f.id; s.statut = 'réglée'; } });
  dbSave();
  closeModal('modal-facture');
  renderFactures();
  toast('Facture ' + num + ' générée ✓', 'success');
  setTimeout(() => viewFacture(f.id), 300);
}

// Build invoice HTML (shared for view + print)
function buildInvoice(f) {
  const p = DB.patients.find(p => p.id === f.patientId);
  const seances = f.seancesIds.map(sid => DB.seances.find(s => s.id === sid)).filter(Boolean)
                   .sort((a,b) => a.date.localeCompare(b.date));
  const pName   = p ? p.prenom + ' ' + p.nom.toUpperCase() : '—';
  const isTVA   = CFG.tvaMention && !CFG.tvaMention.startsWith('Exonéré') && !CFG.tvaMention.startsWith('TVA non applicable');
  const ht      = isTVA ? (f.total / 1.20) : f.total;
  const tva     = isTVA ? (f.total - f.total / 1.20) : 0;
  const adr     = [CFG.adresse, CFG.cp && CFG.ville ? CFG.cp + ' ' + CFG.ville : ''].filter(Boolean).join('<br>');

  const lignes = seances.map(s => `<tr>
    <td>${formatDate(s.date)}</td>
    <td>${f.objet || 'Séance de psychothérapie'} – ${s.duree} min</td>
    <td style="text-align:center;">1</td>
    <td style="text-align:right;font-family:var(--font-serif);">${fmtMoney(s.tarif)}</td>
    <td style="text-align:right;font-family:var(--font-serif);">${fmtMoney(s.tarif)}</td>
  </tr>`).join('');

  // Règlement : from séances paiement modes stored at facture creation
  const regModes = (f.paiementsSeances && f.paiementsSeances.length > 0)
    ? f.paiementsSeances.join(', ')
    : (CFG.paiements || '');

  const payBlock = `<div class="inv-payment-block">
    <strong>Modalités de règlement</strong><br>
    ${regModes ? 'Mode(s) de paiement : ' + regModes + '<br>' : ''}
    ${CFG.iban   ? 'IBAN : ' + CFG.iban + '<br>' : ''}
    ${CFG.bic    ? 'BIC : ' + CFG.bic + (CFG.banque ? ' (' + CFG.banque + ')' : '') + '<br>' : ''}
    Référence virement : Facture ${f.num} – ${pName}
  </div>`;

  return `<div class="invoice-preview" id="printable-invoice">
    <div class="inv-header">
      <div>
        <div class="inv-logo-name">${CFG.prenom} ${CFG.nom.toUpperCase()}</div>
        <div class="inv-logo-sub">${CFG.titre || 'Psychothérapeute'}${CFG.formation ? ' · ' + CFG.formation : ''}</div>
        <div style="margin-top:.75rem;font-size:12px;color:var(--warm-mid);line-height:1.7;">
          ${adr}${CFG.tel ? '<br>' + CFG.tel : ''}${CFG.email ? '<br>' + CFG.email : ''}
        </div>
      </div>
      <div class="inv-num-block" style="text-align:right;">
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
        <div class="inv-party-detail">${p && p.adresse ? p.adresse : '<em style="color:var(--warm-light);">Adresse non renseignée</em>'}</div>
      </div>
    </div>

    <table class="inv-table">
      <thead>
        <tr>
          <th style="width:18%;">Date</th>
          <th>Désignation</th>
          <th style="width:8%;text-align:center;">Qté</th>
          <th style="width:16%;text-align:right;">P.U. HT</th>
          <th style="width:16%;text-align:right;">Montant HT</th>
        </tr>
      </thead>
      <tbody>${lignes}</tbody>
    </table>

    <div class="inv-total-section">
      <div class="inv-total-row">
        <span class="inv-total-label">Total HT</span>
        <span class="inv-total-value">${fmtMoney(ht)}</span>
      </div>
      ${isTVA ? `<div class="inv-total-row">
        <span class="inv-total-label">TVA (20 %)</span>
        <span class="inv-total-value">${fmtMoney(tva)}</span>
      </div>` : ''}
      <div class="inv-total-row" style="border-top:1px solid var(--beige-mid);padding-top:.5rem;margin-top:.25rem;">
        <span class="inv-total-label inv-grand-total-label">Total TTC à régler</span>
        <span class="inv-total-value inv-grand-total-value">${fmtMoney(f.total)}</span>
      </div>
    </div>

    ${CFG.tvaMention ? `<div class="inv-legal">${CFG.tvaMention}</div>` : ''}
    ${payBlock}

    <div class="inv-footer">
      ${CFG.prenom} ${CFG.nom.toUpperCase()}${CFG.titre ? ' — ' + CFG.titre : ''}<br>
      SIRET ${CFG.siret}${CFG.tvaNum ? ' · N° TVA : ' + CFG.tvaNum : ''}<br>
      ${[CFG.adresse, CFG.cp && CFG.ville ? CFG.cp + ' ' + CFG.ville : ''].filter(Boolean).join(', ')}${CFG.tel ? ' · ' + CFG.tel : ''}
      ${CFG.formation ? '<br><em>' + CFG.formation + '</em>' : ''}
    </div>
  </div>`;
}

function viewFacture(id) {
  const f = DB.factures.find(f => f.id === id); if (!f) return;
  document.getElementById('facture-view-content').innerHTML = buildInvoice(f);
  // Store current facture id for PDF naming
  document.getElementById('modal-facture-view').dataset.factureId = id;
  document.getElementById('modal-facture-view').classList.remove('hidden');
}

function printFacture() {
  const id = document.getElementById('modal-facture-view').dataset.factureId;
  const f  = DB.factures.find(f => f.id === id);
  const p  = f ? DB.patients.find(p => p.id === f.patientId) : null;
  const pNom = p ? p.nom.toUpperCase().replace(/\s+/g,'-') : 'PATIENT';

  // PDF filename: Facture-NOMPATIENT-DATEPREMIESEANCE.pdf
  const firstSeance = f ? DB.seances.find(s => f.seancesIds.includes(s.id)) : null;
  const dateStr = firstSeance ? firstSeance.date.replace(/-/g,'') : (f ? f.date.replace(/-/g,'') : '');
  const filename = `Facture-${pNom}-${dateStr}`;

  const content = document.getElementById('printable-invoice').outerHTML;
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>${filename}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
  <style>
  :root{--sage:#6b8f71;--sage-dark:#4a6b50;--sage-pale:#e8f0e9;--sage-light:#a8c4a2;--beige:#f7f3ee;--beige-mid:#ede5d8;--warm-dark:#3d3530;--warm-mid:#7a6e67;--font-serif:'Cormorant Garamond',Georgia,serif;--font-sans:'DM Sans',system-ui,sans-serif;}
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
  .inv-footer{margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--beige-mid);font-size:11px;color:var(--warm-mid);line-height:1.7;}
  </style></head><body>${content}</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 600);
}

function renderFactures() {
  const el = document.getElementById('factures-list');
  if (DB.factures.length === 0) {
    el.innerHTML = `<div class="card"><div class="empty-state"><div class="ei">◻</div><p>Aucune facture générée</p>
      <button class="btn btn-primary" onclick="openModal('modal-facture')">+ Créer une facture</button></div></div>`;
    return;
  }
  const sorted  = [...DB.factures].sort((a,b) => b.date.localeCompare(a.date));
  const totalCA = DB.factures.reduce((a, f) => a + f.total, 0);
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.25rem;">
      <div class="stat-card"><div class="stat-label">Factures émises</div><div class="stat-value">${DB.factures.length}</div></div>
      <div class="stat-card"><div class="stat-label">CA total facturé</div><div class="stat-value" style="font-size:22px;">${fmtNum(totalCA)} €</div></div>
    </div>
    <div class="card" style="padding:0;">
      ${sorted.map(f => {
        const pn = getPatientName(f.patientId);
        const pm = (f.paiementsSeances && f.paiementsSeances.length) ? f.paiementsSeances.join(', ') : '—';
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

// ════════════════════════════════════════
// DASHBOARD & CALENDRIER
// ════════════════════════════════════════
let calDate = new Date();
function calNav(dir) { calDate.setMonth(calDate.getMonth() + dir); renderCalendar(); }

function renderDashboard() {
  const now = new Date(), mo = now.getMonth(), yr = now.getFullYear();
  document.getElementById('st-p').textContent = DB.patients.filter(p => p.statut === 'actif').length;
  const sm = DB.seances.filter(s => {
    const d = new Date(s.date);
    return d.getMonth() === mo && d.getFullYear() === yr && s.statut === 'honoré';
  });
  document.getElementById('st-s').textContent = sm.length;
  document.getElementById('st-f').textContent = DB.seances.filter(s => (s.statut === 'honoré' || s.statut === 'réglée') && !s.facture).length;
  const ca = sm.reduce((a, s) => a + s.tarif, 0);
  document.getElementById('st-ca').textContent = fmtNum(ca) + ' €';
  renderCalendar();
  renderUpcoming();
}

function renderCalendar() {
  const todayD = new Date();
  const yr = calDate.getFullYear(), mo = calDate.getMonth();
  document.getElementById('cal-title').textContent = MOIS_NOMS[mo] + ' ' + yr;
  const fo  = (new Date(yr, mo, 1).getDay() + 6) % 7;
  const dim = new Date(yr, mo + 1, 0).getDate();
  const rdv = new Set(
    DB.seances
      .filter(s => { const d = new Date(s.date); return d.getMonth() === mo && d.getFullYear() === yr; })
      .map(s => parseInt(s.date.split('-')[2]))
  );
  const dn = ['Lu','Ma','Me','Je','Ve','Sa','Di'];
  let h = dn.map(d => `<div class="cal-day-name">${d}</div>`).join('');
  for (let i = 0; i < fo; i++) h += '<div class="cal-day empty"></div>';
  for (let d = 1; d <= dim; d++) {
    const it = d === todayD.getDate() && mo === todayD.getMonth() && yr === todayD.getFullYear();
    h += `<div class="cal-day${it ? ' today' : ''}${rdv.has(d) ? ' has-rdv' : ''}">${d}</div>`;
  }
  document.getElementById('calendar').innerHTML = h;
}

function renderUpcoming() {
  const now = today();
  const up  = DB.seances
    .filter(s => s.date >= now && s.statut === 'planifié')
    .sort((a,b) => a.date.localeCompare(b.date) || a.heure.localeCompare(b.heure))
    .slice(0, 8);
  const el = document.getElementById('upcoming-list');
  if (up.length === 0) {
    el.innerHTML = '<div style="color:var(--warm-mid);font-size:13px;">Aucune séance à venir</div>';
    return;
  }
  el.innerHTML = up.map(s => {
    const pn = getPatientName(s.patientId, false);
    const d  = s.date.split('-');
    const mo = MOIS_SHORT[parseInt(d[1])-1];
    return `<div style="display:flex;align-items:center;gap:.75rem;padding:.55rem 0;border-bottom:1px solid var(--beige-mid);font-size:13px;cursor:pointer;" onclick="viewSeance('${s.id}')">
      <span style="color:var(--warm-mid);font-size:12px;min-width:75px;">${d[2]} ${mo} ${s.heure}</span>
      <span style="font-weight:500;">${pn}</span>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════
// INIT
// ════════════════════════════════════════
dbLoad();

if (isConfigured()) {
  document.getElementById('setup-screen').classList.add('hidden');
  updateHeader();
  renderDashboard();
} else {
  document.getElementById('setup-screen').classList.remove('hidden');
}

// PWA manifest
const _manifest = {
  name: 'Cabinet Psychothérapie', short_name: 'Cabinet Psy',
  start_url: '.', display: 'standalone',
  background_color: '#f7f3ee', theme_color: '#6b8f71'
};
const _blob = new Blob([JSON.stringify(_manifest)], { type: 'application/manifest+json' });
document.getElementById('manifest-link').setAttribute('href', URL.createObjectURL(_blob));
