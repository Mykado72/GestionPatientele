/* ══════════════════════════════════════════════════════
   Cabinet de Psychothérapie — ui/sessions.js
   Séances (récurrence, statuts, règlements) et indisponibilités.
   Dépend de : data.js, utils.js, navigation.js
   ══════════════════════════════════════════════════════ */

'use strict';


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
  richTextSet('s-notes', '');
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
    notes:    richTextGet('s-notes')
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
    richTextSet('s-notes', s.notes || '');
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
      <div style="display:flex;gap:.75rem;"><span style="color:var(--warm-mid);min-width:110px;">Patient</span><strong>${esc(pn)}</strong></div>
      <div style="display:flex;gap:.75rem;"><span style="color:var(--warm-mid);min-width:110px;">Date & Heure</span><span>${formatDate(s.date)} à ${s.heure}</span></div>
      <div style="display:flex;gap:.75rem;"><span style="color:var(--warm-mid);min-width:110px;">Durée</span><span>${s.duree} min</span></div>
      <div style="display:flex;gap:.75rem;"><span style="color:var(--warm-mid);min-width:110px;">Tarif</span><span style="font-family:var(--font-serif);font-size:17px;">${s.tarif} €</span></div>
      <div style="display:flex;gap:.75rem;align-items:center;"><span style="color:var(--warm-mid);min-width:110px;">Statut</span><span class="badge badge-${s.statut}">${s.statut}</span></div>
      ${s.paiement      ? `<div style="display:flex;gap:.75rem;"><span style="color:var(--warm-mid);min-width:110px;">Paiement</span><span>${esc(s.paiement)}</span></div>` : ''}
      ${s.dateReglement ? `<div style="display:flex;gap:.75rem;"><span style="color:var(--warm-mid);min-width:110px;">Réglé le</span><span>${formatDate(s.dateReglement)}</span></div>` : ''}
      ${s.facture       ? `<div style="display:flex;gap:.75rem;align-items:center;"><span style="color:var(--warm-mid);min-width:110px;">Facture</span><span class="badge badge-réglée">Facturée</span></div>` : ''}
    </div>
    ${s.notes ? `<div style="margin-top:1rem;"><div class="section-title">Notes</div><div class="notes-block rich-content">${sanitizeRichHtml(s.notes)}</div></div>` : ''}
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
    DB.patients.map(p => `<option value="${p.id}">${esc(p.prenom)} ${esc(p.nom.toUpperCase())}</option>`).join('');
}

function populateSelectPat(selId) {
  document.getElementById(selId).innerHTML = '<option value="">— Sélectionner —</option>' +
    DB.patients.map(p => `<option value="${p.id}">${esc(p.prenom)} ${esc(p.nom.toUpperCase())}</option>`).join('');
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
    const txt = `${prefix ? esc(prefix) + ' — ' : ''}Indisponible${i.heureDebut ? ' ' + esc(i.heureDebut) + (i.heureFin ? '–' + esc(i.heureFin) : '') : ' — journée entière'}${i.motif ? ' · ' + esc(i.motif) : ''}`;
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
        <div style="font-size:14px;font-weight:500;">${esc(getPatientName(s.patientId))}</div>
        <div style="font-size:12px;color:var(--warm-mid);margin-top:2px;">${s.heure} · ${s.duree} min${s.paiement ? ' · ' + esc(s.paiement) : ''}</div>
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
      <span>🔁 <strong>${r.jours.map(j => JOURS[j]).join(', ')}</strong>, ${freqLbl(r.freq)}${r.heureDebut ? ` · ${r.heureDebut}${r.heureFin ? '–' + r.heureFin : ''}` : ' · journée entière'}${r.motif ? ' · <em>' + esc(r.motif) + '</em>' : ''}<br>
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
