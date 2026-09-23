# Facturo

Webapp locale de préparation, émission, archivage et envoi de factures pour une micro-entreprise. L'interface est pensée pour téléphone et ordinateur ; les données restent sur l'instance qui héberge l'application (ordinateur ou Raspberry Pi).

## Démarrage

```bash
npm install
cp .env.example .env
npm run dev
```

Ouvrir `http://localhost:3030`. Définir `ARCHIVE_DIR` dans `.env` vers un volume persistant (idéalement un disque monté sur le Raspberry Pi) avant d'émettre des factures. Les variables SMTP sont nécessaires uniquement pour l'envoi d'e-mails.

## Parcours fonctionnel

- **Tableau de bord**
  - Synthèse des montants facturés et en brouillon, du nombre de factures émises et des échéances dépassées.
  - État de santé de l'archive : nombre de PDF contrôlés, valides ou en erreur, avec le répertoire d'archivage effectivement utilisé.
  - Accès aux dernières factures et création rapide d'une facture.

- **Clients**
  - Carnet clients avec entreprise/nom, contact, adresse, e-mail, téléphone et SIREN.
  - Ces coordonnées sont reprises dans le PDF et l'e-mail du client est proposé lors de l'envoi.
  - Création, modification et suppression depuis l'onglet dédié. Une suppression peut être refusée par la base lorsqu'un client est déjà référencé par une facture.

- **Sites**
  - Gestion des lieux de mission indépendamment des clients : label personnalisé, adresse, prénom/nom/téléphone/e-mail du référent.
  - Bouton de localisation volontaire via Nominatim/OpenStreetMap ; une fois localisé, aperçu OpenStreetMap et liens vers OpenStreetMap/Google Maps.
  - Un site est choisi **sur chaque ligne de facture** : une facture mensuelle unique peut donc regrouper plusieurs lieux de mission.

- **Prestations**
  - Catalogue de raccourcis avec nom, description, tarif unitaire et quantité par défaut.
  - Une prestation insérée dans un brouillon reste modifiable sans modifier le catalogue.
  - Les quantités sont des entiers naturels (minimum `1`) ; le serveur valide aussi cette règle, pas seulement l'interface.

## Factures

- **Création et brouillons**
  - La création exige au moins un client. Un numéro est généré depuis la séquence locale, avec une échéance par défaut à 60 jours.
  - Le numéro est éditable tant que la facture est un brouillon. Après une modification manuelle, le prochain numéro suit le dernier numéro saisi ; les doublons sont refusés.
  - Le brouillon contient le client, dates d'émission/échéance, note interne non imprimée et une ou plusieurs lignes : site, description, quantité, date, tarif et TVA.
  - Une ligne est en « TVA comprise » par défaut : le tarif saisi est alors déjà TTC. Si la case est décochée, le total de la ligne applique `tarif × 1,20`.
  - L'aperçu PDF enregistre d'abord silencieusement le brouillon, afin que le PDF corresponde aux dernières modifications.
  - Seuls les brouillons peuvent être modifiés ou supprimés. La suppression est accessible depuis la liste et l'éditeur.

- **PDF**
  - Généré côté serveur avec PDFKit à partir de `lib/pdf.js`, selon la mise en page inspirée des exemples du dossier `doc/`.
  - Contient les coordonnées de l'émetteur, du client, le numéro, dates, lignes, total TTC, informations bancaires et conditions de paiement.
  - La mention micro-entreprise / « TVA non applicable, art. 293 B du CGI » est intégrée au document.
  - Après archivage, l'aperçu ne régénère pas le document : il lit le PDF archivé, source de référence de la facture émise.

- **Émission et verrouillage**
  - Le bouton « Archiver la facture » enregistre le brouillon puis déclenche l'émission et l'archivage serveur.
  - L'émission enregistre un *snapshot* complet de la facture (émetteur, client, lignes et sites) dans la base. La facture devient figée pour préserver le document émis.
  - Les statuts sont `draft` (brouillon), `issued` (émise/archivée) et `sent` (envoyée au client). Une échéance passée est signalée comme « à relancer ».
  - Pour corriger une facture émise, ne pas modifier l'historique : la gestion d'avoirs est prévue dans [EVOLUTIONS.md](EVOLUTIONS.md).

## Archivage serveur et contrôle d'intégrité

- L'archivage est une action distincte de l'envoi e-mail ; il peut être lancé depuis l'éditeur ou via le témoin « Serveur » de la liste des factures.
- Pour chaque facture émise, le serveur :
  1. génère le PDF depuis le snapshot ;
  2. calcule son empreinte SHA-256 ;
  3. écrit d'abord un fichier temporaire, puis le renomme dans `ARCHIVE_DIR/<année>/facture-<numéro>.pdf` ;
  4. relit immédiatement le fichier écrit et compare taille et empreinte ;
  5. enregistre chemin relatif, SHA-256, date de contrôle et un enregistrement historique dans SQLite.
- Le bouton « Serveur » devient vert si un PDF est archivé. Il relance la lecture et le contrôle SHA-256 ; une erreur de fichier absent ou modifié est affichée dans l'interface et le tableau de bord.
- Le répertoire est configurable avec `ARCHIVE_DIR`. Il doit être persistant, accessible en écriture par le processus Node et sauvegardé sur un second support : le contrôle d'intégrité ne remplace pas une sauvegarde.

## Envoi au client

- L'e-mail est volontairement séparé de l'archivage : il ne devient disponible qu'après émission.
- Le bouton « E-mail client » demande une adresse, préremplie avec celle du client, puis envoie le PDF archivé en pièce jointe via Nodemailer.
- Configuration requise dans `.env` : `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, et, si nécessaire, `SMTP_USER`, `SMTP_PASS`, ainsi que `MAIL_FROM`.
- Une réussite passe la facture au statut `sent`. Il n'existe pas encore de journal détaillé des envois ou de suivi de délivrabilité ; c'est listé dans [EVOLUTIONS.md](EVOLUTIONS.md).

## Données, sauvegarde et restauration

- La base SQLite locale est `data/facturo.db`, en mode WAL. Elle contient réglages émetteur, séquence de numéros, clients, sites, prestations, factures, lignes et traces d'archive.
- `data/`, `storage/`, `.env` et les exemples `doc/` sont exclus de Git : ils restent privés et ne sont pas poussés sur GitHub.
- Dans **Paramètres → Sauvegarde portable**, « Extraire les données » télécharge un JSON unique contenant les données SQLite et les PDF archivés encodés en base64, avec leurs empreintes.
- « Restaurer une sauvegarde » vérifie le format, la présence de tous les PDF archivés et leurs SHA-256 avant de remplacer les données actuelles. Cette opération est destructive pour l'instance cible ; elle est prévue pour une migration vers le Raspberry Pi ou la reprise après incident.
- Le fichier d'export doit être conservé hors du Raspberry Pi. Il peut contenir données clients et PDF : ne pas le déposer dans Git ni le transmettre sans protection.

## Structure technique et points d'entrée

- `server.js` : API Express, règles de facturation, émission, archivage, contrôle d'intégrité, SMTP et import/export.
- `lib/database.js` : schéma SQLite, migrations légères, données émetteur et séquence des numéros.
- `lib/pdf.js` : générateur PDF.
- `public/app.js` : interface monopage, formulaires, modales, calculs visibles et appels API.
- `public/styles.css` / `public/index.html` : interface responsive.
- Principales routes :
  - `GET /api/dashboard` ;
  - CRUD `/api/clients`, `/api/sites`, `/api/services` ;
  - création, lecture, mise à jour et suppression de brouillons sous `/api/invoices` ;
  - `POST /api/invoices/:id/archive`, `GET /api/invoices/:id/archive-check`, `GET /api/invoices/:id/pdf`, `POST /api/invoices/:id/email` ;
  - `GET /api/backup/export` et `POST /api/backup/import`.

## Exploitation et limites actuelles

- L'application ne met pas en place d'authentification ni de gestion multi-utilisateur. Ne pas l'exposer directement sur Internet ; l'utiliser derrière un réseau privé, un VPN ou un reverse proxy correctement protégé.
- Ne jamais considérer une facture émise comme modifiable : l'archivage protège le document mais n'est pas, à lui seul, un dispositif légal complet de conservation ou de facturation électronique.
- Les pistes fonctionnelles prévues (avoirs, relances, second support, Pennylane et Google Agenda) sont centralisées dans [EVOLUTIONS.md](EVOLUTIONS.md).
