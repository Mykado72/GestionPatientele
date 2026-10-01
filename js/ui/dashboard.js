/* ══════════════════════════════════════════════════════
   Cabinet de Psychothérapie — ui/dashboard.js
   Tableau de bord, calendrier, CA, prochaines séances.
   Dépend de : data.js, utils.js
   ══════════════════════════════════════════════════════ */

'use strict';


// ════════════════════════════════════════════════════════
// TABLEAU DE BORD
// ════════════════════════════════════════════════════════

let calDate = new Date();
function calNav(dir) { calDate.setMonth(calDate.getMonth() + dir); renderCalendar(); }

function renderDashboard() {
  const now = new Date(), mo = now.getMonth(), yr = now.getFullYear();

  document.getElementById('st-p').textContent = DB.patients.filter(p => p.statut === 'actif').length;

  const seancesMois    = DB.seances.filter(s => { const d = new Date(s.date); return d.getMonth() === mo && d.getFullYear() === yr; });
  const honoreesMois   = seancesMois.filter(s => s.statut === 'honoré' || s.statut === 'réglée');
  const planifieesMois = seancesMois.filter(s => s.statut === 'planifié');
  document.getElementById('st-s').textContent = `${honoreesMois.length} / ${honoreesMois.length + planifieesMois.length}`;

  const regléesNF  = DB.seances.filter(s => s.statut === 'réglée' && !s.facture).length;
  const honoréesNF = DB.seances.filter(s => s.statut === 'honoré' && !s.facture).length;
  const totalFact  = regléesNF + honoréesNF;
  document.getElementById('st-f').textContent = `${regléesNF} / ${totalFact}`;
  const cardF = document.getElementById('st-f-card');
  cardF.style.cursor = totalFact > 0 ? 'pointer' : '';
  cardF.onclick      = totalFact > 0 ? showAFacturerModal : null;
  cardF.title        = totalFact > 0 ? 'Voir les séances à facturer' : '';
  cardF.classList.toggle('stat-card-clickable', totalFact > 0);

  const caR = honoreesMois.filter(s => s.statut === 'réglée').reduce((a, s) => a + s.tarif, 0);
  const caT = seancesMois.filter(s => s.statut !== 'annulé').reduce((a, s) => a + s.tarif, 0);
  document.getElementById('st-ca').textContent = `${fmtNum(caR)} / ${fmtNum(caT)} €`;

  renderCalendar(); renderUpcoming();
}

function goToPatients(statut) {
  showPage('patients', document.querySelectorAll('.nav-btn')[1]);
  document.getElementById('filter-patient-statut').value = statut || '';
  document.getElementById('search-patients').value = '';
  renderPatients();
}

function goToSeancesMois() {
  showPage('seances', document.querySelectorAll('.nav-btn')[2]);
  const now     = new Date();
  const moisStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  document.getElementById('filter-date').value   = '';
  document.getElementById('filter-statut').value = '';
  populateFilterPat();
  renderSeancesMois(moisStr);
}

function renderSeancesMois(moisStr) {
  const st  = document.getElementById('filter-statut').value;
  const pid = document.getElementById('filter-pat').value;
  let list  = [...DB.seances].filter(s => s.date.startsWith(moisStr)).sort((a, b) => a.date.localeCompare(b.date) || a.heure.localeCompare(b.heure));
  if (st)  list = list.filter(s => s.statut === st);
  if (pid) list = list.filter(s => s.patientId === pid);

  const [yr, mo] = moisStr.split('-');
  const label    = `${MOIS_NOMS[parseInt(mo) - 1]} ${yr}`;
  const el       = document.getElementById('seances-list');

  let html = `<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem;font-size:13px;color:var(--sage-dark);background:var(--sage-pale);border:1px solid var(--sage-light);border-radius:var(--radius-sm);padding:.4rem .75rem;">
    📅 Filtre : <strong>${label}</strong>
    <button class="btn btn-secondary btn-xs" style="margin-left:auto;" onclick="renderSeances()">✕ Retirer</button>
  </div>`;

  if (!list.length) {
    html += `<div class="empty-state"><div class="ei">◷</div><p>Aucune séance en ${label}</p></div>`;
  } else {
    list.forEach(s => {
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
  }
  el.innerHTML = html;
}

function showCaModal() {
  const now        = new Date(), mo = now.getMonth(), yr = now.getFullYear();
  const label      = `${MOIS_NOMS[mo]} ${yr}`;
  const seancesMois = DB.seances.filter(s => {
    const d = new Date(s.date);
    return d.getMonth() === mo && d.getFullYear() === yr && s.statut !== 'annulé';
  }).sort((a, b) => a.date.localeCompare(b.date));

  const reglees    = seancesMois.filter(s => s.statut === 'réglée');
  const honorees   = seancesMois.filter(s => s.statut === 'honoré');
  const planifiees = seancesMois.filter(s => s.statut === 'planifié');
  const caR = reglees.reduce((a, s) => a + s.tarif, 0);
  const caH = honorees.reduce((a, s) => a + s.tarif, 0);
  const caP = planifiees.reduce((a, s) => a + s.tarif, 0);
  const caT = caR + caH + caP;
  const pct = caT > 0 ? Math.min(100, caR / caT * 100) : 0;

  const lignes = ls => !ls.length
    ? '<div style="color:var(--warm-mid);font-size:13px;padding:.4rem 0;">Aucune</div>'
    : ls.map(s => `<div style="display:flex;align-items:center;gap:.75rem;padding:.45rem 0;border-bottom:1px solid var(--beige-mid);font-size:13px;">
        <span style="min-width:100px;color:var(--warm-mid);">${formatDateShort(s.date)}</span>
        <span style="flex:1;">${esc(getPatientName(s.patientId, false))}</span>
        ${s.paiement ? `<span style="font-size:11px;color:var(--warm-mid);">${esc(s.paiement)}</span>` : ''}
        <span style="font-family:var(--font-serif);font-size:15px;">${fmtMoney(s.tarif)}</span>
      </div>`).join('');

  const bloc = (titre, col, ls, total, icon) => `<div style="margin-bottom:1.25rem;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.4rem;">
      <div style="font-weight:500;font-size:13px;color:${col};">${icon} ${titre} (${ls.length})</div>
      <div style="font-family:var(--font-serif);font-size:18px;color:${col};">${fmtMoney(total)}</div>
    </div>
    <div style="border-left:3px solid ${col};padding-left:.75rem;">${lignes(ls)}</div>
  </div>`;

  document.getElementById('modal-ca-title').textContent = `CA — ${label}`;
  document.getElementById('modal-ca-content').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin-bottom:1.5rem;">
      <div class="stat-card" style="padding:.75rem;"><div class="stat-label">Encaissé</div><div style="font-family:var(--font-serif);font-size:22px;color:var(--success);">${fmtMoney(caR)}</div></div>
      <div class="stat-card" style="padding:.75rem;"><div class="stat-label">À encaisser</div><div style="font-family:var(--font-serif);font-size:22px;color:var(--info);">${fmtMoney(caH)}</div></div>
      <div class="stat-card" style="padding:.75rem;"><div class="stat-label">Total prévu</div><div style="font-family:var(--font-serif);font-size:22px;color:var(--sage-dark);">${fmtMoney(caT)}</div></div>
    </div>
    <div style="margin-bottom:1.5rem;">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--warm-mid);margin-bottom:.3rem;">
        <span>Encaissé ${Math.round(pct)} %</span><span>${fmtMoney(caR)} / ${fmtMoney(caT)}</span>
      </div>
      <div style="background:var(--beige-mid);border-radius:8px;height:10px;overflow:hidden;">
        <div style="height:100%;border-radius:8px;background:var(--success);width:${pct}%;transition:width .4s;"></div>
      </div>
    </div>
    ${bloc('Séances réglées', 'var(--success)', reglees, caR, '✓')}
    ${bloc('Séances honorées (non réglées)', 'var(--info)', honorees, caH, '◷')}
    ${planifiees.length ? bloc('Séances planifiées', 'var(--warm-mid)', planifiees, caP, '📅') : ''}`;
  document.getElementById('modal-ca').classList.remove('hidden');
}

function showAFacturerModal() {
  const seances = DB.seances
    .filter(s => (s.statut === 'réglée' || s.statut === 'honoré') && !s.facture)
    .sort((a, b) => a.date.localeCompare(b.date) || a.heure.localeCompare(b.heure));

  const byPatient = {};
  seances.forEach(s => { if (!byPatient[s.patientId]) byPatient[s.patientId] = []; byPatient[s.patientId].push(s); });

  const html = Object.entries(byPatient).map(([pid, ss]) => {
    const pn    = getPatientName(pid);
    const total = ss.reduce((a, s) => a + s.tarif, 0);
    const rows  = ss.map(s => `
      <div style="display:flex;align-items:center;gap:.6rem;padding:.4rem .5rem;font-size:13px;border-bottom:1px solid var(--beige-mid);">
        <span style="min-width:115px;color:var(--warm-mid);">${formatDateShort(s.date)} ${s.heure}</span>
        <span class="badge badge-${s.statut}" style="font-size:10px;">${s.statut}</span>
        ${s.paiement ? `<span style="font-size:11px;color:var(--warm-mid);">${esc(s.paiement)}</span>` : ''}
        <span style="margin-left:auto;font-family:var(--font-serif);">${s.tarif} €</span>
      </div>`).join('');
    return `<div style="margin-bottom:1rem;border:1px solid var(--beige-mid);border-radius:var(--radius-sm);overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.6rem .85rem;background:var(--beige);">
        <strong style="font-size:14px;">${esc(pn)}</strong>
        <div style="display:flex;align-items:center;gap:.75rem;">
          <span style="font-family:var(--font-serif);font-size:15px;color:var(--sage-dark);">${fmtMoney(total)}</span>
          <button class="btn btn-primary btn-sm" onclick="closeModal('modal-a-facturer');openModal('modal-facture');setTimeout(()=>{document.getElementById('f-patient').value='${pid}';populateFactureSeances();setTimeout(()=>{document.querySelectorAll('.f-cb').forEach(cb=>cb.checked=true);updateFTotal();},60);},120);">📄 Facturer</button>
        </div>
      </div>
      ${rows}
    </div>`;
  }).join('');

  document.getElementById('a-facturer-content').innerHTML = html || '<div style="color:var(--warm-mid);font-size:13px;">Aucune séance à facturer.</div>';
  document.getElementById('modal-a-facturer').classList.remove('hidden');
}

function renderCalendar() {
  const todayD  = new Date();
  const yr      = calDate.getFullYear(), mo = calDate.getMonth();
  const moisStr = `${yr}-${String(mo + 1).padStart(2, '0')}`;
  document.getElementById('cal-title').textContent = `${MOIS_NOMS[mo]} ${yr}`;

  const fo  = (new Date(yr, mo, 1).getDay() + 6) % 7;
  const dim = new Date(yr, mo + 1, 0).getDate();

  // Séances du mois
  const rdvMap = {};
  DB.seances.filter(s => s.date.startsWith(moisStr)).forEach(s => {
    const j = parseInt(s.date.split('-')[2]);
    if (!rdvMap[j]) rdvMap[j] = [];
    rdvMap[j].push(s);
  });

  // Jours indisponibles
  const indispoSet = new Set(
    (DB.indisponibilites || []).filter(i => i.date.startsWith(moisStr)).map(i => parseInt(i.date.split('-')[2]))
  );
  for (let d = 1; d <= dim; d++) {
    if (getIndispoRegleForDate(`${moisStr}-${String(d).padStart(2, '0')}`)) indispoSet.add(d);
  }

  const jNoms = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];
  let h = jNoms.map(j => `<div class="cal-day-name">${j}</div>`).join('');
  for (let i = 0; i < fo; i++) h += '<div class="cal-day empty"></div>';
  for (let d = 1; d <= dim; d++) {
    const isToday = d === todayD.getDate() && mo === todayD.getMonth() && yr === todayD.getFullYear();
    const hasRdv  = !!rdvMap[d];
    const isIndi  = indispoSet.has(d);
    const ds      = `${moisStr}-${String(d).padStart(2, '0')}`;
    const click   = hasRdv ? `onclick="goToSeancesByDate('${ds}')" title="${rdvMap[d].length} séance(s)"` : '';
    const cls     = ['cal-day', isToday ? 'today' : '', hasRdv ? 'has-rdv clickable' : '', isIndi ? 'is-indispo' : ''].filter(Boolean).join(' ');
    h += `<div class="${cls}" ${click}>${d}</div>`;
  }
  document.getElementById('calendar').innerHTML = h;
}

function goToSeancesByDate(dateStr) {
  showPage('seances', document.querySelectorAll('.nav-btn')[2]);
  document.getElementById('filter-date').value = dateStr;
  renderSeances();
}

function renderUpcoming() {
  const now = today();
  const up  = DB.seances
    .filter(s => s.date >= now && s.statut === 'planifié')
    .sort((a, b) => a.date.localeCompare(b.date) || a.heure.localeCompare(b.heure))
    .slice(0, 8);
  const el = document.getElementById('upcoming-list');
  if (!up.length) { el.innerHTML = '<div style="color:var(--warm-mid);font-size:13px;">Aucune séance à venir</div>'; return; }
  el.innerHTML = up.map(s => {
    const [, m, j] = s.date.split('-');
    return `<div style="display:flex;align-items:center;gap:.75rem;padding:.55rem 0;border-bottom:1px solid var(--beige-mid);font-size:13px;cursor:pointer;" onclick="viewSeance('${s.id}')">
      <span style="color:var(--warm-mid);font-size:12px;min-width:75px;">${parseInt(j)} ${MOIS_SHORT[parseInt(m) - 1]} ${s.heure}</span>
      <span style="font-weight:500;">${esc(getPatientName(s.patientId, false))}</span>
    </div>`;
  }).join('');
}
