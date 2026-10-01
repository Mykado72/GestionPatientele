/* ══════════════════════════════════════════════════════
   Cabinet de Psychothérapie — invoices.js
   Génération, aperçu, impression et liste des factures.
   Dépend de : data.js, utils.js
   ══════════════════════════════════════════════════════ */

'use strict';


// ════════════════════════════════════════════════════════
// FACTURES
// ════════════════════════════════════════════════════════

function initFactureModal() {
  populateSelectPat('f-patient');
  const ech = new Date(); ech.setDate(ech.getDate() + (CFG.delai || 30));
  document.getElementById('f-date').value     = today();
  document.getElementById('f-echeance').value = ech.toISOString().split('T')[0];
  document.getElementById('f-objet').value    = 'Séances de psychothérapie';
  document.getElementById('f-total-preview').textContent = '0,00 €';
  document.getElementById('f-seances-select').innerHTML  = `<div style="color:var(--warm-mid);font-size:13px;padding:.5rem;">Sélectionnez un patient d'abord</div>`;
  document.getElementById('cfg-warn').style.display = (!CFG.siret || !CFG.adresse) ? 'block' : 'none';
}

function populateFactureSeances() {
  const pId   = document.getElementById('f-patient').value;
  const c     = document.getElementById('f-seances-select');
  const toutes = document.getElementById('f-filtre-toutes')?.checked;

  if (!pId) {
    c.innerHTML = `<div style="color:var(--warm-mid);font-size:13px;padding:.5rem;">Sélectionnez un patient d'abord</div>`;
    document.getElementById('f-total-preview').textContent = '0,00 €';
    return;
  }

  // En mode "Toutes" : toutes les séances non encore facturées, quel que soit le statut
  // En mode normal : uniquement honorées et réglées
  const seances = DB.seances.filter(s => {
    if (s.patientId !== pId || s.facture) return false;
    if (toutes) return s.statut !== 'annulé';
    return s.statut === 'réglée' || s.statut === 'honoré';
  }).sort((a, b) => a.date.localeCompare(b.date));

  if (!seances.length) {
    const msg = toutes
      ? 'Aucune séance non facturée pour ce patient.'
      : 'Aucune séance honorée/réglée non facturée. Cochez "Toutes les séances" pour voir les séances planifiées.';
    c.innerHTML = `<div style="color:var(--warm-mid);font-size:13px;padding:.5rem;">${msg}</div>`;
    document.getElementById('f-total-preview').textContent = '0,00 €';
    return;
  }

  c.innerHTML = seances.map(s => `
    <label style="display:flex;align-items:center;gap:.75rem;padding:.5rem;cursor:pointer;border-radius:6px;"
      onmouseover="this.style.background='var(--beige)'" onmouseout="this.style.background=''">
      <input type="checkbox" class="f-cb" value="${s.id}" data-tarif="${s.tarif}" onchange="updateFTotal()" style="width:auto;accent-color:var(--sage);">
      <span style="flex:1;font-size:13px;">
        ${formatDate(s.date)} à ${s.heure} — ${s.duree} min
        ${s.paiement ? `<span style="color:var(--warm-mid);"> · ${esc(s.paiement)}</span>` : `<span style="color:var(--terra);font-size:11px;"> · règlement non défini</span>`}
        <span class="badge badge-${s.statut}" style="font-size:10px;margin-left:4px;">${s.statut}</span>
      </span>
      <span style="font-family:var(--font-serif);font-size:15px;">${s.tarif} €</span>
    </label>`).join('');
  updateFTotal();
}

function updateFTotal() {
  const total = Array.from(document.querySelectorAll('.f-cb:checked')).reduce((a, cb) => a + parseFloat(cb.dataset.tarif), 0);
  document.getElementById('f-total-preview').textContent = fmtMoney(total);
}

function genererFacture() {
  const pId = document.getElementById('f-patient').value;
  const cbs = document.querySelectorAll('.f-cb:checked');
  if (!pId || !cbs.length) { alert('Sélectionnez un patient et au moins une séance.'); return; }
  if (!CFG.siret)           { alert('SIRET requis. Complétez vos paramètres.'); return; }

  const ids     = Array.from(cbs).map(cb => cb.value);
  const seances = ids.map(id => DB.seances.find(s => s.id === id)).filter(Boolean);

  // Vérifier les séances sans mode de paiement
  const sansMode = seances.filter(s => !s.paiement);
  if (sansMode.length) {
    // Ouvrir le modal de confirmation du mode de paiement
    document.getElementById('fp-nb-seances').textContent = sansMode.length;
    document.getElementById('fp-paiement').value = '';
    document.getElementById('modal-facture-paiement').classList.remove('hidden');
    // Stocker les IDs pour reprise après confirmation
    document.getElementById('modal-facture-paiement').dataset.ids = JSON.stringify(ids);
    document.getElementById('modal-facture-paiement').dataset.pId = pId;
    return;
  }

  _doGenererFacture(pId, ids);
}

function confirmerPaiementEtFacturer() {
  const paiement = document.getElementById('fp-paiement').value;
  if (!paiement) { alert('Sélectionnez un mode de règlement.'); return; }

  const modal   = document.getElementById('modal-facture-paiement');
  const ids     = JSON.parse(modal.dataset.ids || '[]');
  const pId     = modal.dataset.pId;

  // Appliquer le mode de paiement aux séances concernées
  ids.forEach(id => {
    const s = DB.seances.find(s => s.id === id);
    if (s && !s.paiement) s.paiement = paiement;
  });

  modal.classList.add('hidden');
  _doGenererFacture(pId, ids);
}

function _doGenererFacture(pId, ids) {
  const seances = ids.map(id => DB.seances.find(s => s.id === id)).filter(Boolean);
  const total   = seances.reduce((a, s) => a + s.tarif, 0);

  // Numérotation ANNEE-MM-JJ-XX (date de la première séance)
  const firstDate    = [...seances].sort((a, b) => a.date.localeCompare(b.date))[0]?.date || today();
  const [fy, fm, fj] = firstDate.split('-');
  const num          = `${fy}-${fm}-${fj}-${String(DB.nextNum).padStart(2, '0')}`;
  DB.nextNum++;

  const paiements = [...new Set(seances.map(s => s.paiement).filter(Boolean))];
  const f = {
    id: uid(), num, patientId: pId, seancesIds: ids,
    date:             document.getElementById('f-date').value,
    echeance:         document.getElementById('f-echeance').value,
    objet:            document.getElementById('f-objet').value,
    paiementsSeances: paiements, total,
    createdAt:        new Date().toISOString()
  };

  DB.factures.push(f);
  // Marquer les séances comme "facturée" (statut distinct)
  ids.forEach(id => {
    const s = DB.seances.find(s => s.id === id);
    if (s) { s.facture = f.id; s.statut = 'facturé'; }
  });

  void dbSave(); closeModal('modal-facture'); renderFactures();
  toast(`Facture ${num} générée ✓`, 'success');
  setTimeout(() => viewFacture(f.id), 300);
}

// Construit le HTML de la facture (aperçu + impression)
function buildInvoice(f) {
  const p       = DB.patients.find(p => p.id === f.patientId);
  const seances = f.seancesIds.map(sid => DB.seances.find(s => s.id === sid)).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
  const pName   = p ? `${esc(p.prenom)} ${esc(p.nom.toUpperCase())}` : '—';
  const isTVA   = CFG.tvaMention && !CFG.tvaMention.startsWith('Exonéré') && !CFG.tvaMention.startsWith('TVA non applicable');
  const ht      = isTVA ? f.total / 1.20 : f.total;
  const tva     = isTVA ? f.total - f.total / 1.20 : 0;
  const adr     = [esc(CFG.adresse), CFG.cp && CFG.ville ? `${esc(CFG.cp)} ${esc(CFG.ville)}` : ''].filter(Boolean).join('<br>');

  // Infos de règlement (dédupliquées) — statut réglée ou facturé
  const toutesReglees = seances.every(s => s.statut === 'réglée' || s.statut === 'facturé');
  const regUniques    = [...new Map(
    seances.filter(s => (s.statut === 'réglée' || s.statut === 'facturé') && s.dateReglement)
           .map(s => [`${s.dateReglement}|${s.paiement || ''}`, { date: s.dateReglement, mode: s.paiement || '' }])
  ).values()];

  // Section totaux
  const totalSection = `<div class="inv-total-section">
    <div class="inv-total-row">
      <span class="inv-total-label">Total HT</span>
      <span class="inv-total-value">${fmtMoney(ht)}</span>
    </div>
    ${isTVA ? `<div class="inv-total-row"><span class="inv-total-label">TVA (20 %)</span><span class="inv-total-value">${fmtMoney(tva)}</span></div>` : ''}
    <div class="inv-total-row" style="border-top:1px solid var(--beige-mid);padding-top:.5rem;margin-top:.25rem;">
      <span class="inv-total-label inv-grand-total-label">${toutesReglees && regUniques.length ? 'Total TTC' : 'Total TTC à régler'}</span>
      <span class="inv-total-value inv-grand-total-value">${fmtMoney(f.total)}</span>
    </div>
  </div>`;

  // Modalités de règlement : uniquement les modes réels, jamais le fallback CFG.paiements
  const regModes = f.paiementsSeances?.length ? esc(f.paiementsSeances.join(', ')) : '';
  const regLine  = toutesReglees && regUniques.length
    ? (regUniques.length === 1
        ? `<span style="color:var(--sage-dark);font-weight:500;">✓ Réglé le ${formatDate(regUniques[0].date)}${regUniques[0].mode ? `, ${fmtMoney(f.total)} par ${esc(regUniques[0].mode)}` : ` — ${fmtMoney(f.total)}`}</span><br>`
        : regUniques.map(r => `<span style="color:var(--sage-dark);font-weight:500;">✓ Réglé le ${formatDate(r.date)}${r.mode ? ' par ' + esc(r.mode) : ''}</span>`).join('<br>') + '<br>')
    : (regModes ? `Mode de règlement : ${regModes}<br>` : '');

  const payBlock = `<div class="inv-payment-block">
    <strong>Modalités de règlement</strong><br>
    ${regLine}
    ${CFG.iban ? `IBAN : ${esc(CFG.iban)}<br>` : ''}
    ${CFG.bic  ? `BIC : ${esc(CFG.bic)}${CFG.banque ? ' (' + esc(CFG.banque) + ')' : ''}<br>` : ''}
    Référence Facture : ${esc(f.num)} – ${pName}
  </div>`;

  const lignes = seances.map(s => `<tr>
    <td>${formatDate(s.date)}</td>
    <td>${esc(f.objet || 'Séance de psychothérapie')} – ${s.duree} min</td>
    <td style="text-align:center;">1</td>
    <td style="text-align:right;font-family:var(--font-serif);">${fmtMoney(s.tarif)}</td>
    <td style="text-align:right;font-family:var(--font-serif);">${fmtMoney(s.tarif)}</td>
  </tr>`).join('');

  // Logo limité à 64px de hauteur pour ne pas envahir l'en-tête
  const logoHtml = safeLogo(CFG.logo)
    ? `<img src="${safeLogo(CFG.logo)}" alt="Logo" style="max-height:128px;max-width:300px;object-fit:contain;flex-shrink:0;">`
    : '';

  return `<div class="invoice-preview" id="printable-invoice">
    <div class="inv-header">
      <div style="display:flex;align-items:flex-start;gap:.85rem;">
        ${logoHtml}
        <div>
          <div class="inv-logo-name">${esc(CFG.prenom)} ${esc(CFG.nom.toUpperCase())}</div>
          <div class="inv-logo-sub">${esc(CFG.titre || 'Psychothérapeute')}${CFG.formation ? ' · ' + esc(CFG.formation) : ''}</div>
          <div style="margin-top:.75rem;font-size:12px;color:var(--warm-mid);line-height:1.7;">
            ${adr}${CFG.tel ? '<br>' + esc(CFG.tel) : ''}${CFG.email ? '<br>' + esc(CFG.email) : ''}
          </div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:10px;color:var(--warm-mid);font-weight:500;text-transform:uppercase;letter-spacing:.06em;">Facture</div>
        <div style="font-size:20px;font-family:var(--font-serif);color:var(--warm-dark);margin:.2rem 0;">${esc(f.num)}</div>
        <div style="font-size:12px;color:var(--warm-mid);line-height:1.7;">
          Émise le : ${formatDate(f.date)}<br>
          Échéance : ${formatDate(f.echeance)}
        </div>
      </div>
    </div>

    <div class="inv-parties">
      <div>
        <div class="inv-party-label">Émetteur</div>
        <div class="inv-party-name">${esc(CFG.prenom)} ${esc(CFG.nom.toUpperCase())}</div>
        <div class="inv-party-detail">
          ${esc(CFG.titre || '')}<br>
          SIRET : ${esc(CFG.siret)}
          ${CFG.tvaNum ? '<br>N° TVA : ' + esc(CFG.tvaNum) : ''}
        </div>
      </div>
      <div>
        <div class="inv-party-label">Destinataire / Patient</div>
        <div class="inv-party-name">${pName}</div>
        <div class="inv-party-detail">${p?.adresse ? esc(p.adresse) : '<em style="color:var(--warm-light);">Adresse non renseignée</em>'}</div>
      </div>
    </div>

    <table class="inv-table">
      <thead><tr>
        <th style="width:18%;">Date</th>
        <th>Désignation</th>
        <th style="width:8%;text-align:center;">Qté</th>
        <th style="width:16%;text-align:right;">P.U. HT</th>
        <th style="width:16%;text-align:right;">Montant HT</th>
      </tr></thead>
      <tbody>${lignes}</tbody>
    </table>

    ${totalSection}
    ${CFG.tvaMention ? `<div class="inv-legal">${esc(CFG.tvaMention)}</div>` : ''}
    ${payBlock}
  </div>`;
}

function viewFacture(id) {
  const f = DB.factures.find(f => f.id === id); if (!f) return;
  document.getElementById('facture-view-content').innerHTML = buildInvoice(f);
  document.getElementById('modal-facture-view').dataset.factureId = id;
  document.getElementById('modal-facture-view').classList.remove('hidden');
}

function printFacture() {
  const id  = document.getElementById('modal-facture-view').dataset.factureId;
  const f   = DB.factures.find(f => f.id === id);
  const p   = f ? DB.patients.find(p => p.id === f.patientId) : null;
  const nom = p ? esc(p.nom.toUpperCase().replace(/\s+/g, '-')) : 'PATIENT';
  const s0  = f ? DB.seances.find(s => f.seancesIds.includes(s.id)) : null;
  const ds  = s0 ? s0.date.replace(/-/g, '') : (f?.date.replace(/-/g, '') || '');

  const content = document.getElementById('printable-invoice').outerHTML;
  const w = window.open('', '_blank');
  if (!w) { alert('Autorisez les fenêtres pop-up pour imprimer la facture.'); return; }
  try { w.opener = null; } catch (e) {}
  w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Facture-${nom}-${ds}</title>
  <link href="${new URL('fonts/fonts.css', location.href).href}" rel="stylesheet">
  <style>
  :root{--sage:#6b8f71;--sage-dark:#4a6b50;--sage-pale:#e8f0e9;--sage-light:#a8c4a2;--beige:#f7f3ee;--beige-mid:#ede5d8;--warm-dark:#3d3530;--warm-mid:#7a6e67;--warm-light:#b8afa8;--font-serif:'Cormorant Garamond',Georgia,serif;--font-sans:'DM Sans',system-ui,sans-serif;}
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
  </style></head><body>${content}</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 600);
}

function renderFactures() {
  const el = document.getElementById('factures-list');
  if (!DB.factures.length) {
    el.innerHTML = `<div class="card"><div class="empty-state"><div class="ei">◻</div><p>Aucune facture générée</p>
      <button class="btn btn-primary" onclick="openModal('modal-facture')">+ Créer une facture</button></div></div>`;
    return;
  }
  const sorted  = [...DB.factures].sort((a, b) => b.date.localeCompare(a.date));
  const totalCA = DB.factures.reduce((a, f) => a + f.total, 0);
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.25rem;">
      <div class="stat-card"><div class="stat-label">Factures émises</div><div class="stat-value">${DB.factures.length}</div></div>
      <div class="stat-card"><div class="stat-label">CA total facturé</div><div class="stat-value" style="font-size:22px;">${fmtNum(totalCA)} €</div></div>
    </div>
    <div class="card" style="padding:0;">
      ${sorted.map(f => {
        const pn = getPatientName(f.patientId);
        const pm = f.paiementsSeances?.length ? esc(f.paiementsSeances.join(', ')) : '—';
        return `<div class="invoice-row" onclick="viewFacture('${f.id}')">
          <div style="font-size:13px;font-weight:500;color:var(--sage-dark);min-width:100px;">${esc(f.num)}</div>
          <div style="flex:1;">
            <div style="font-size:14px;">${esc(pn)}</div>
            <div style="font-size:12px;color:var(--warm-mid);">${formatDate(f.date)} · ${f.seancesIds.length} séance${f.seancesIds.length > 1 ? 's' : ''} · ${pm}</div>
          </div>
          <div style="font-family:var(--font-serif);font-size:18px;text-align:right;">${fmtMoney(f.total)}</div>
        </div>`;
      }).join('')}
    </div>`;
}
