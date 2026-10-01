/* ══════════════════════════════════════════════════════
   Cabinet de Psychothérapie — ui/patients.js
   Liste, fiche, formulaire et suivi thérapeutique des patients.
   Dépend de : data.js, utils.js, navigation.js
   ══════════════════════════════════════════════════════ */

'use strict';


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
  richTextSet('p-notes', p ? (p.notes || '') : '');
  richTextSet('p-historique', p ? (p.historique || '') : '');
  richTextSet('p-diagnosticAT', p ? (p.diagnosticAT || '') : '');
  richTextSet('p-supervision', p ? (p.supervision || '') : '');
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
    notes:        richTextGet('p-notes'),
    historique:   richTextGet('p-historique'),
    diagnosticAT: richTextGet('p-diagnosticAT'),
    supervision:  richTextGet('p-supervision')
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
  const ini     = esc(((p.prenom[0] || '') + (p.nom[0] || '')).toUpperCase());
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
        ${s.paiement ? `<span style="font-size:11px;color:var(--warm-mid);">${esc(s.paiement)}</span>` : ''}
        <span class="sl-amount">${s.tarif} €</span>
        <span class="sl-actions">
          <button class="btn btn-secondary btn-xs" onclick="event.stopPropagation();editSeanceFromFiche('${s.id}','${id}')">✎</button>
        </span>
      </div>`).join('');

  document.getElementById('fiche-content').innerHTML = `
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap;">
      <div class="avatar" style="width:56px;height:56px;font-size:20px;">${ini}</div>
      <div style="flex:1;">
        <div style="font-family:var(--font-serif);font-size:22px;">${esc(p.prenom)} ${esc(p.nom.toUpperCase())}</div>
        <div style="font-size:12px;color:var(--warm-mid);margin-top:2px;">${age}${p.motif ? ' · ' + esc(p.motif) : ''}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1.25rem;font-size:13px;">
      ${p.tel     ? `<div><span style="color:var(--warm-mid);">Tél :</span> ${esc(p.tel)}</div>` : ''}
      ${p.email   ? `<div><span style="color:var(--warm-mid);">Email :</span> ${esc(p.email)}</div>` : ''}
      ${p.adresse ? `<div style="grid-column:1/-1"><span style="color:var(--warm-mid);">Adresse :</span> ${esc(p.adresse)}</div>` : ''}
      <div><span style="color:var(--warm-mid);">Tarif :</span> ${p.tarif} € / séance</div>
      <div><span style="color:var(--warm-mid);">Statut :</span> <span class="badge badge-${p.statut === 'actif' ? 'actif' : 'annulé'}">${p.statut}</span></div>
    </div>

    ${p.notes ? `<div class="section-title">Notes générales</div><div class="notes-block rich-content" style="margin-bottom:1.25rem;">${sanitizeRichHtml(p.notes)}</div>` : ''}

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


// Génère le HTML d'un onglet suivi dans la fiche patient
function ficheTab(p, field, label, placeholder) {
  const content = p[field] || '';
  if (!content) {
    return `<div class="suivi-empty">
      <span style="color:var(--warm-mid);font-size:13px;">Aucun contenu — utilisez le bouton ✎ Modifier pour renseigner cet onglet,<br>ou ajoutez des notes depuis une séance.</span>
    </div>`;
  }
  // Afficher les entrées horodatées (format "── [date] ──\n...") ou le texte libre
  return `<div class="notes-block suivi-content rich-content">${sanitizeRichHtml(content)}</div>`;
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
  ['sv-historique-new', 'sv-diagat-new', 'sv-supervision-new'].forEach(id => richTextSet(id, ''));

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
    ? `<div class="suivi-section-hint" style="margin-top:.5rem;">Contenu actuel :</div><div class="notes-block suivi-content rich-content">${sanitizeRichHtml(content)}</div>`
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
    const newText = richTextGet(newId).trim();
    if (!newText) return;
    const stamp   = `<div class="suivi-stamp">── ${escHtml(dateStamp)} ──</div>${newText}`;
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
      ${s.paiement ? `<span style="font-size:11px;color:var(--warm-mid);">${esc(s.paiement)}</span>` : ''}
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
      <p>${DB.patients.length === 0 ? 'Aucun patient enregistré' : `Aucun résultat pour « ${esc(q)} »`}</p>
      ${DB.patients.length === 0 ? `<button class="btn btn-primary" onclick="openModal('modal-patient')">+ Ajouter un patient</button>` : ''}
    </div>`;
    return;
  }

  el.innerHTML = filtered.map(p => {
    const ini = esc(((p.prenom[0] || '') + (p.nom[0] || '')).toUpperCase());
    const nb  = DB.seances.filter(s => s.patientId === p.id && s.statut === 'honoré').length;
    return `<div class="patient-card" onclick="viewPatient('${p.id}')">
      <div class="avatar">${ini}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:15px;font-weight:500;">${esc(p.prenom)} ${esc(p.nom.toUpperCase())}</div>
        <div style="font-size:12px;color:var(--warm-mid);margin-top:2px;">${esc(p.motif) || 'Motif non précisé'} · ${nb} séance${nb > 1 ? 's' : ''}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
        <span class="badge badge-${p.statut === 'actif' ? 'actif' : 'annulé'}" style="font-size:10px;">${p.statut}</span>
        <span style="font-family:var(--font-serif);font-size:16px;">${p.tarif} €</span>
      </div>
    </div>`;
  }).join('');
}
