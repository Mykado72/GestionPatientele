/* ══════════════════════════════════════════════════════
   Cabinet de Psychothérapie — main.js
   Initialisation : PWA, chargement des données, premier rendu.
   Dépend de : tous les autres scripts
   ══════════════════════════════════════════════════════ */

'use strict';


// ════════════════════════════════════════════════════════
// INITIALISATION
// ════════════════════════════════════════════════════════

// PWA : service worker (mode hors connexion), installation, mises à jour
initPwa();

// dbLoad est async (IndexedDB) — on attend qu'elle soit terminée avant tout rendu
initRichTextEditors();
(async () => {
  const status = await dbLoad();

  // Coffre chiffré : on masque l'écran de configuration et on attend le déverrouillage
  if (status === 'locked') {
    document.getElementById('setup-screen').classList.add('hidden');
    await showLockScreen();
  }

  if (isConfigured()) {
    document.getElementById('setup-screen').classList.add('hidden');
    updateHeader();
    refreshLogoPreview('s');
    renderDashboard();
  } else {
    document.getElementById('setup-screen').classList.remove('hidden');
  }

  // Rappel de sauvegarde + sauvegarde automatique dans un dossier
  void initBackup();

  // Stockage persistant : évite l'effacement automatique de la base par le navigateur
  void requestPersistence();

  // Retour éventuel d'une autorisation Google (validé seulement une fois les données disponibles)
  await processOAuthReturn();
})();
