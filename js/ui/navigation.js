/* ══════════════════════════════════════════════════════
   Cabinet de Psychothérapie — ui/navigation.js
   Navigation entre pages, modales, onglets.
   Dépend de : utils.js
   ══════════════════════════════════════════════════════ */

'use strict';


// ════════════════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════════════════

// Mémorise la page précédente pour le retour depuis la fiche patient
let _ficheReturnPage = 'patients';

function showPage(id, btn) {
  renderBackupBanner();
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

// Les fenêtres modales ne se ferment volontairement PAS au clic en dehors (évite de perdre une saisie) :
// elles se ferment uniquement via leurs boutons (Fermer / Annuler / Enregistrer…).
