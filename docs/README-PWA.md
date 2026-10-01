# Cabinet Psychothérapie — version PWA

## Ce qui a été ajouté
| Fichier | Rôle |
|---|---|
| `manifest.webmanifest` | Nom, couleurs, icônes, mode « standalone » (remplace l'ancien manifest généré en Blob, non installable) |
| `sw.js` | Service worker : met en cache le code, les polices et les icônes → fonctionne hors connexion |
| `js/pwa.js` | Enregistrement du SW, bouton d'installation, notification de mise à jour, statut |
| `icons/` | Icônes 192 / 512 / maskable / iOS / favicon (étoile ✦ sur fond sauge) |

Modifiés : `index.html` (CSP : `manifest-src 'self'; worker-src 'self'`, balises iOS, section « Application » dans les Paramètres), `js/main.js`, `js/ui/settings.js`, `style.css`.

## Déploiement
1. **HTTPS obligatoire** (GitHub Pages, Netlify… ou `localhost` pour tester). Un service worker ne fonctionne pas en `file://` ni en HTTP.
2. **À chaque mise à jour du code : incrémenter `CACHE_VERSION` dans `sw.js`.** Sans cela, les appareils gardent l'ancienne version en cache. Si vous ajoutez/renommez un fichier, mettez aussi à jour la liste `PRECACHE`.
3. Les utilisateurs voient alors « Une nouvelle version est disponible » et choisissent le moment de l'appliquer.

## Confidentialité
Le cache ne contient que les fichiers de l'application. Les données (patients, séances, factures) restent dans IndexedDB, comme avant. Les appels Google Drive / Agenda ne passent jamais par le service worker.

## Points d'attention
- **Google OAuth** : `redirect_uri` = origine + chemin de la page. L'app installée démarre sur `./` (ex. `https://site/repo/`). Si vous avez déclaré `…/index.html` dans la console Google, ajoutez aussi l'URL avec `/` final.
- **Mise à jour = rechargement** : le coffre chiffré se reverrouille (phrase secrète redemandée).
- **iOS** : pas de bouton d'installation automatique → Safari › Partager › « Sur l'écran d'accueil » (instructions affichées dans Paramètres › Application). L'impression de facture (`window.open`) peut se comporter différemment en mode installé sur iPhone/iPad.
- **Dépannage** : `clear-cache.html` désinscrit le SW et vide les caches.

---

# Sauvegardes : rappel + sauvegarde automatique dans un dossier

Nouveau fichier : `js/backup.js`.

## Rappel de sauvegarde
- Un bandeau apparaît si **aucune sauvegarde** n'a jamais été faite, ou si la dernière date de **plus de 7 jours ET que des données ont changé depuis**. « Plus tard » le masque 24 h.
- Comptent comme sauvegarde : export (chiffré ou non), sauvegarde dans le dossier, sauvegarde Google Drive.
- La date de la dernière sauvegarde est affichée dans Paramètres › Sauvegarde des données. Seuls des horodatages sont stockés (clé `psy-backup-meta`), jamais de données patient.

## Sauvegarde automatique dans un dossier (Chrome / Edge, ordinateur)
- Paramètres › « Sauvegarde automatique dans un dossier » › *Choisir un dossier…* (clé USB, disque externe, dossier synchronisé…). Choisir de préférence un sous-dossier dédié : Chrome peut refuser Documents / Bureau / Téléchargements.
- Après chaque modification (regroupées sur 30 s, au plus une écriture par minute, et au passage de l'onglet en arrière-plan), un fichier **chiffré AES-256-GCM** `cabinet-auto-AAAA-MM-JJ.cabinet.enc` est écrit. **Une copie par jour, les 10 derniers jours conservés**. Les autres fichiers du dossier ne sont jamais touchés.
- **Restauration** : Paramètres › *Importer des données* › choisir le fichier `.cabinet.enc` + son mot de passe (même mécanisme que « Exporter chiffré »).
- **À chaque ouverture du navigateur** : le navigateur redemande l'autorisation d'accès au dossier et le mot de passe est redemandé (il n'est jamais conservé sur disque). Un bandeau « Reprendre » le propose. Avec le verrouillage activé, le verrouillage après 10 min d'inactivité recharge la page et demande donc à nouveau cette reprise.
- Si le dossier contient déjà des sauvegardes, le mot de passe saisi est **vérifié** contre elles (évite de produire en silence des sauvegardes illisibles après une faute de frappe).
- Si le navigateur ne mémorise pas le dossier d'une session à l'autre (possible en `file://`), l'application s'en souvient et propose de le re-sélectionner en un clic.
- **Mot de passe oublié = sauvegardes irrécupérables.**
- Un dossier situé sur le même disque que le navigateur ne protège pas d'une panne de ce disque.
