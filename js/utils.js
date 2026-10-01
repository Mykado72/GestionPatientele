/* ══════════════════════════════════════════════════════
   Cabinet de Psychothérapie — utils.js
   Éditeur de texte enrichi, formatage (dates, montants), échappement HTML, toasts.
   Dépend de : data.js (DB, CFG)
   ══════════════════════════════════════════════════════ */

'use strict';


// ════════════════════════════════════════════════════════
// TEXTE ENRICHI — éditeur local pour les notes cliniques
// ════════════════════════════════════════════════════════

const RICH_EDITOR_IDS = [
  'p-notes', 'p-historique', 'p-diagnosticAT', 'p-supervision',
  's-notes', 'sv-historique-new', 'sv-diagat-new', 'sv-supervision-new'
];

const SAFE_COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*(,\s*\d{1,3}\s*){2}(,\s*(0|1|0?\.\d+)\s*)?\)|[a-z]{3,20})$/i;

function sanitizeRichHtml(html) {
  const source = String(html || '');
  const looksHtml = /<\/?[a-z][^>]*>/i.test(source);
  if (!looksHtml) return escHtml(source);

  const tpl = document.createElement('template');
  tpl.innerHTML = source;
  const allowed = new Set(['DIV','P','BR','STRONG','B','EM','I','U','S','STRIKE','UL','OL','LI','SPAN','FONT']);

  const clean = node => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
    if (!allowed.has(node.tagName)) {
      const frag = document.createDocumentFragment();
      [...node.childNodes].forEach(ch => frag.appendChild(clean(ch)));
      return frag;
    }
    const el = document.createElement(node.tagName.toLowerCase());
    if (node.tagName === 'SPAN' || node.tagName === 'FONT') {
      const color = (node.style.color || node.getAttribute('color') || '').trim();
      if (SAFE_COLOR_RE.test(color)) el.style.color = color;
      const bg = (node.style.backgroundColor || '').trim();
      if (SAFE_COLOR_RE.test(bg)) el.style.backgroundColor = bg;
    }
    [...node.childNodes].forEach(ch => el.appendChild(clean(ch)));
    return el;
  };

  const frag = document.createDocumentFragment();
  [...tpl.content.childNodes].forEach(ch => frag.appendChild(clean(ch)));
  const wrap = document.createElement('div');
  wrap.appendChild(frag);
  return wrap.innerHTML;
}

function richTextGet(id) {
  const el = document.getElementById(id);
  return el ? sanitizeRichHtml(el.value || '') : '';
}

function richTextSet(id, html) {
  const value = sanitizeRichHtml(html || '');
  const input = document.getElementById(id);
  const editor = document.getElementById(id + '-editor');
  if (input) input.value = value;
  if (editor) editor.innerHTML = value;
}

function richTextExec(editorId, command, value = null) {
  const editor = document.getElementById(editorId + '-editor');
  if (!editor) return;
  editor.focus();
  document.execCommand(command, false, value);
  const input = document.getElementById(editorId);
  if (input) input.value = sanitizeRichHtml(editor.innerHTML);
}

function initRichTextEditors() {
  RICH_EDITOR_IDS.forEach(id => {
    const input = document.getElementById(id);
    const editor = document.getElementById(id + '-editor');
    if (!input || !editor || editor.dataset.ready) return;
    editor.dataset.ready = '1';
    editor.innerHTML = sanitizeRichHtml(input.value || '');
    editor.addEventListener('input', () => {
      input.value = sanitizeRichHtml(editor.innerHTML);
    });
    // Aucun HTML externe n'entre dans l'éditeur : collage en texte brut, glisser-déposer bloqué
    editor.addEventListener('paste', e => {
      e.preventDefault();
      const txt = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
      document.execCommand('insertText', false, txt);
    });
    editor.addEventListener('drop', e => e.preventDefault());
  });
}

function richTextCommand(id, command, value = null) {
  richTextExec(id, command, value);
}


// ════════════════════════════════════════════════════════
// UTILITAIRES
// ════════════════════════════════════════════════════════

const MOIS_LONG  = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const MOIS_SHORT = ['jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'];
const MOIS_NOMS  = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

function formatDate(d) {
  if (!d) return '—';
  const [y, m, j] = d.split('-');
  return `${parseInt(j)} ${MOIS_LONG[parseInt(m) - 1]} ${y}`;
}

function formatDateShort(d) {
  if (!d) return '—';
  const [y, m, j] = d.split('-');
  return `${parseInt(j)} ${MOIS_SHORT[parseInt(m) - 1]} ${y}`;
}

function today()       { return new Date().toISOString().split('T')[0]; }
function fmtMoney(n)   { return n.toFixed(2).replace('.', ',') + ' €'; }
function fmtNum(n)     { return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function toMin(h)      { const [hh, mm] = h.split(':').map(Number); return hh * 60 + mm; }

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function getPatientName(id, upper = true) {
  const p = DB.patients.find(p => p.id === id);
  if (!p) return '—';
  return upper ? `${p.prenom} ${p.nom.toUpperCase()}` : `${p.prenom} ${p.nom}`;
}

function toast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = 'toast' + (type ? ' ' + type : '');
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 3000);
}


// ── Échappement HTML ───────────────────────────────────
function escAttr(s) { return esc(s); }

// Échappe le HTML pour l'affichage sécurisé dans les notes-blocks
function escHtml(str) {
  return esc(str).replace(/\n/g,'<br>');
}
