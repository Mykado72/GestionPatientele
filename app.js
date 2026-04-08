/* ══════════════════════════════════════════════
   Cabinet de Psychothérapie — Logique applicative
   ══════════════════════════════════════════════ */

'use strict';

// ════════════════════════════════════════
// DATA STORE
// ════════════════════════════════════════
let DB = { patients: [], seances: [], factures: [], nextNum: 1, indisponibilites: [], indisponibilites_regles: [] };
let CFG = {
  prenom:'', nom:'', titre:'', formation:'',
  adresse:'', cp:'', ville:'', tel:'', email:'',
  siret:'', tvaNum:'', tvaMention:'', tarif: 60, delai: 30,
  iban:'', bic:'', banque:'', paiements:'Espèces, chèque, virement bancaire'
};

function dbLoad() {
  try { const d = localStorage.getItem('psy-db');  if (d) DB  = JSON.parse(d); } catch(e) {}
  try { const c = localStorage.getItem('psy-cfg'); if (c) CFG = { ...CFG, ...JSON.parse(c) }; } catch(e) {}
  if (!DB.indisponibilites)        DB.indisponibilites        = [];
  if (!DB.indisponibilites_regles) DB.indisponibilites_regles = [];
}
function dbSave()  { try { localStorage.setItem('psy-db',  JSON.stringify(DB));  } catch(e) {} }
function cfgSave() { try { localStorage.setItem('psy-cfg', JSON.stringify(CFG)); } catch(e) {} }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ════════════════════════════════════════
// UTILS
// ════════════════════════════════════════
const MOIS_LONG  = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const MOIS_SHORT = ['jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'];

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
function fmtMoney(n) { return n.toFixed(2).replace('.', ',') + ' €'; }

function toast(msg, type = '') {
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 3000);
}

function getPatientName(id, upper = true) {
  const p = DB.patients.find(p => p.id === id);
  if (!p) return 'Patient inconnu';
  return upper ? p.prenom + ' ' + p.nom.toUpperCase() : p.prenom + ' ' + p.nom;
}

// ════════════════════════════════════════
// LOGO & CONFIG
// ════════════════════════════════════════
function uploadLogo(pfx) {
  const input = document.getElementById(pfx + '-logo-input');
  if (!input || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > 500 * 1024) { alert('Logo trop volumineux (max 500 Ko).'); return; }
  
  const reader = new FileReader();
  reader.onload = e => {
    const b64 = e.target.result;
    CFG.logo = b64;
    cfgSave();
    applyLogoPreview(pfx, b64);
    toast('Logo enregistré ✓', 'success');
  };
  reader.readAsDataURL(file);
}

function applyLogoPreview(pfx, src) {
  const img  = document.getElementById(pfx + '-logo-preview');
  const ph   = document.getElementById(pfx + '-logo-placeholder');
  const rm   = document.getElementById(pfx + '-logo-remove');
  if (!img) return;
  if (src) {
    img.src = src; img.style.display = 'block';
    if(ph) ph.style.display = 'none'; 
    if(rm) rm.style.display = 'inline-flex';
  } else {
    img.src = ''; img.style.display = 'none';
    if(ph) ph.style.display = ''; 
    if(rm) rm.style.display = 'none';
  }
}

function loadLogoPreview() {
  if (CFG.logo) { applyLogoPreview('s', CFG.logo); applyLogoPreview('c', CFG.logo); }
}

function isConfigured() { return !!(CFG.prenom && CFG.nom && CFG.siret); }

function updateHeader() {
  if (!CFG.prenom) return;
  const ini = (CFG.prenom[0] + (CFG.nom[0] || '')).toUpperCase();
  const elIni = document.getElementById('hdr-initials');
  const elName = document.getElementById('hdr-name');
  if(elIni) elIni.textContent = ini;
  if(elName) elName.textContent = CFG.prenom + ' ' + CFG.nom.toUpperCase();
  document.title = 'Cabinet ' + CFG.prenom + ' ' + CFG.nom;
}

// ════════════════════════════════════════
// DASHBOARD & RENDU
// ════════════════════════════════════════
function renderDashboard() {
  const greeting = document.getElementById('dash-greeting');
  if (greeting) greeting.textContent = 'Bonjour, ' + (CFG.prenom || 'Praticien');
  renderUpcoming();
}

function renderUpcoming() {
  const now = new Date();
  const up = DB.seances
    .filter(s => s.date >= today() && s.statut === 'planifié')
    .sort((a, b) => a.date.localeCompare(b.date) || a.heure.localeCompare(b.heure))
    .slice(0, 8);

  const el = document.getElementById('upcoming-list');
  if (!el) return;

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

function viewSeance(id) {
    const seance = DB.seances.find(s => s.id === id);
    if (!seance) return;
    alert(`Détails de la séance avec ${getPatientName(seance.patientId)} le ${formatDate(seance.date)} à ${seance.heure}.`);
    // Ici, vous pouvez ouvrir un modal spécifique si défini dans votre HTML
}

// ════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════
function showPage(id, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const targetPage = document.getElementById('page-' + id);
  if(targetPage) targetPage.classList.add('active');
  if(btn) btn.classList.add('active');
  
  if (id === 'dashboard') renderDashboard();
}

// ════════════════════════════════════════
// INIT
// ════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  dbLoad();

  const setupScreen = document.getElementById('setup-screen');
  
  if (isConfigured()) {
    if (setupScreen) setupScreen.classList.add('hidden');
    updateHeader();
    loadLogoPreview();
    renderDashboard();
  } else {
    if (setupScreen) setupScreen.classList.remove('hidden');
    loadLogoPreview();
  }
});