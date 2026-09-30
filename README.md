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
  - Catalogue de raccourcis avec nom, description, tarif horaire et nombre d'heures par défaut.
  - Une prestation insérée dans un brouillon reste modifiable sans modifier le catalogue.
  - Les heures sont des entiers naturels (minimum `1`) ; le serveur valide aussi cette règle, pas seulement l'interface.

## Factures

- **Création et brouillons**
  - La création exige au moins un client. Un numéro est généré depuis la séquence locale, avec une échéance par défaut à 60 jours.
  - Le numéro est éditable tant que la facture est un brouillon. Après une modification manuelle, le prochain numéro suit le dernier numéro saisi ; les doublons sont refusés.
  - Le brouillon contient le client, dates d'émission/échéance, note interne non imprimée et une ou plusieurs lignes : site, description, heures, date, tarif horaire et TVA.
  - Dans l'éditeur classique, la colonne du prix affiche « Tarif horaire » ; le PDF affiche « Taux horaire ».
  - Une ligne affiche « comprise » lorsque la TVA est incluse. Si la case est décochée, elle affiche « + 20% » et le total applique `tarif × 1,20`.
  - L'aperçu PDF enregistre d'abord silencieusement le brouillon, afin que le PDF corresponde aux dernières modifications.
  - Seuls les brouillons peuvent être modifiés ou supprimés. La suppression est accessible depuis la liste et l'éditeur.

- **PDF**
  - Généré côté serveur avec PDFKit à partir de `lib/pdf.js`, selon la mise en page inspirée des exemples du dossier `doc/`.
  - Contient les coordonnées de l'émetteur, du client, le numéro, dates, lignes, total TTC, informations bancaires et conditions de paiement.
  - Les descriptions longues retournent à la ligne sans troncature ; la hauteur de chaque ligne est calculée pour préserver l'espacement.
  - La pagination PDF se base sur la hauteur réelle des lignes : les pages intermédiaires utilisent l'espace disponible et le pied de page est réservé uniquement sur la dernière page.
  - La signature PNG définie par `SIGNATURE_PATH` est placée sous la mention « Signature ». Sur le Pi, elle est stockée hors Git dans `/home/donald/.local/share/facturo/signature.png`.
  - La mention micro-entreprise / « TVA non applicable, art. 293 B du CGI » est intégrée au document.
  - Après archivage, l'aperçu ne régénère pas le document : il lit le PDF archivé, source de référence de la facture émise.

- **Émission, livraison et verrouillage — politique prioritaire**
  - Une facture reste un brouillon jusqu'à la demande d'émission. L'émission produit le PDF et fige un *snapshot* complet (émetteur, client, lignes et sites) : cette référence locale ne doit plus être modifiée.
  - L'archivage n'est pas une finalité isolée : l'émission doit distribuer le document vers les destinations configurées, soit le stockage durable sur Raspberry Pi/serveur, l'e-mail client et, à terme, Pennylane.
  - Chaque destination doit avoir son propre état (réussi, en attente ou en erreur), sa date de dernière tentative et son erreur éventuelle. Un échec de transfert ne doit ni supprimer le PDF ni rendre la facture à nouveau modifiable.
  - L'utilisateur doit pouvoir relancer indépendamment le stockage serveur, l'e-mail client ou la synchronisation Pennylane, notamment après une erreur réseau ou de configuration, sans créer une seconde facture.
  - Les statuts métier actuels sont `draft` (brouillon), `issued` (émise) et `sent` (e-mail envoyé). Une échéance passée est signalée comme « à relancer ».
  - **État actuel du code :** le verrouillage/snapshot et l'archivage serveur sont en place ; l'e-mail est encore une action manuelle distincte et Pennylane n'est pas implémenté. Le flux synchronisé avec états et relances par destination est la prochaine évolution à construire.
  - Pour corriger une facture émise, ne pas modifier l'historique : la gestion d'avoirs est prévue dans [EVOLUTIONS.md](EVOLUTIONS.md).

## Archivage serveur et contrôle d'intégrité

- Dans la politique cible, le stockage serveur fait partie de l'émission/livraison. Le témoin « Serveur » reste nécessaire pour vérifier et relancer uniquement ce transfert lorsqu'il est incomplet ou en erreur.
- Pour chaque facture émise, le serveur :
  1. génère le PDF depuis le snapshot ;
  2. calcule son empreinte SHA-256 ;
  3. écrit d'abord un fichier temporaire, puis le renomme dans `ARCHIVE_DIR/<année>/facture-<numéro>.pdf` ;
  4. relit immédiatement le fichier écrit et compare taille et empreinte ;
  5. enregistre chemin relatif, SHA-256, date de contrôle et un enregistrement historique dans SQLite.
- Le bouton « Serveur » devient vert si un PDF est archivé. Il relance la lecture et le contrôle SHA-256 ; une erreur de fichier absent ou modifié est affichée dans l'interface et le tableau de bord.
- Le répertoire est configurable avec `ARCHIVE_DIR`. Il doit être persistant, accessible en écriture par le processus Node et sauvegardé sur un second support : le contrôle d'intégrité ne remplace pas une sauvegarde.

## Envoi au client et synchronisation externe

- Dans la politique cible, l'e-mail client est tenté lors de l'émission si SMTP est configuré. Une relance manuelle reste disponible indépendamment du stockage serveur et, plus tard, de Pennylane.
- Dans le code actuel, le bouton « E-mail client » est une action manuelle disponible après émission : il demande une adresse, préremplie avec celle du client, puis envoie le PDF archivé en pièce jointe via Nodemailer.
- Configuration requise dans `.env` : `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, et, si nécessaire, `SMTP_USER`, `SMTP_PASS`, ainsi que `MAIL_FROM`.
- Une réussite passe actuellement la facture au statut `sent`. Le journal détaillé, les états de livraison séparés et le connecteur Pennylane restent à implémenter ; ils sont listés dans [EVOLUTIONS.md](EVOLUTIONS.md).

## Données, sauvegarde et restauration

- La base SQLite locale est `data/facturo.db` en développement, ou le chemin défini par `DATA_DIR` en production. Elle est en mode WAL et contient réglages émetteur, séquence de numéros, clients, sites, prestations, factures, lignes et traces d'archive.
- Chaque brouillon est enregistré dans `invoices` et `invoice_lines` par les routes de création/mise à jour ; il reste disponible dans la liste tant qu'il n'est pas supprimé. L'émission fige son *snapshot*, écrit le PDF dans `ARCHIVE_DIR`, calcule son SHA-256 et ajoute une ligne dans `archive_records`.
- L'historique est propre à une instance et à son `DATA_DIR`/`ARCHIVE_DIR`. Un re-clone sur le même hôte conserve donc les brouillons et archives externes ; un clone sur une nouvelle machine démarre avec une base vide. Le dépôt Git ne contient volontairement aucun historique métier.
- Pour transmettre l'historique à une nouvelle machine, utiliser **Paramètres → Sauvegarde portable** puis **Restaurer une sauvegarde**. Le JSON transporte les tables SQLite et les PDF archivés ; une copie brute de la base et de `ARCHIVE_DIR` est également possible après arrêt du service, avec les mêmes chemins configurés.
- `data/`, `storage/`, `.env` et les exemples `doc/` sont exclus de Git : ils restent privés et ne sont pas poussés sur GitHub.
- Dans **Paramètres → Sauvegarde portable**, « Extraire les données » télécharge un JSON unique contenant les données SQLite et les PDF archivés encodés en base64, avec leurs empreintes.
- « Restaurer une sauvegarde » vérifie le format, la présence de tous les PDF archivés et leurs SHA-256 avant de remplacer les données actuelles. Cette opération est destructive pour l'instance cible ; elle est prévue pour une migration vers le Raspberry Pi ou la reprise après incident. Les exports v1 créés avant le renommage (`facturato-backup`) restent acceptés.
- Le fichier d'export doit être conservé hors du Raspberry Pi. Il peut contenir données clients et PDF : ne pas le déposer dans Git ni le transmettre sans protection.

### Migration vers une nouvelle instance

La migration portable est le parcours à utiliser pour une nouvelle machine. Elle réinjecte les informations générales de l'émetteur et la séquence de numérotation (`settings`), les clients, les sites, les prestations, les brouillons, les factures émises, leurs lignes, les traces d'archive et les PDF archivés. Les chemins historiques `storage/archive/...` sont convertis automatiquement vers le `ARCHIVE_DIR` de la machine cible.

1. Sur l'instance source, ouvrir **Paramètres → Sauvegarde portable → Extraire les données**. Conserver le JSON téléchargé et vérifier que l'export ne contient pas d'avertissement concernant un PDF absent.
2. Sur la nouvelle instance, cloner le code, installer les dépendances et créer la configuration externe. Les chemins doivent pointer vers les données de cette machine, par exemple :

   ```bash
   mkdir -p ~/.config/facturo ~/.local/share/facturo/archive
   cp .env.example ~/.config/facturo/facturo.env
   # éditer facturo.env : DATA_DIR, ARCHIVE_DIR, SIGNATURE_PATH et les éventuels secrets
   npm ci
   npm start
   ```

3. Ouvrir **Paramètres → Restaurer une sauvegarde**, sélectionner le JSON puis confirmer. La cible est remplacée par le contenu du fichier ; l'instance source n'est pas modifiée. Pour une restauration automatisée, le même contrat est disponible avec `POST /api/backup/import` et le corps `{ "confirm": true, "backup": <objet JSON> }`.
4. Contrôler le résultat : informations de l'émetteur, présence du client et des sites, liste des brouillons, lignes du brouillon attendu, puis indicateur d'archive valide sur le tableau de bord ou `GET /api/invoices/:id/archive-check`.

Le JSON ne contient ni la signature PNG ni les secrets SMTP/SUPER PDP. Recopier la signature vers `SIGNATURE_PATH` et renseigner les secrets dans le fichier `.env` externe séparément. La restauration doit être effectuée via l'instance locale ou le tunnel SSH d'administration ; le point HTTPS public configuré en lecture seule refuse les requêtes d'écriture.

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

## Infrastructure Raspberry Pi et accès distant

### Déploiement réel sur `donald`

Facturo s'exécute sous le compte système `donald`, depuis le dépôt :

```text
/home/donald/Informatique/C++/facturo
```

Le service systemd est `/etc/systemd/system/facturo.service`. Il utilise `User=donald`, `WorkingDirectory=/home/donald/Informatique/C++/facturo`, charge `/home/donald/.config/facturo/facturo.env` et lance `/usr/bin/node .../server.js`. Les journaux se consultent avec `journalctl -u facturo.service`.

Le serveur Node écoute uniquement sur `127.0.0.1:3030`. La configuration actuellement active sur le Pi est :

```dotenv
PORT=3030
HOST=127.0.0.1
FACTURO_READ_ONLY=false
DATA_DIR=/home/donald/.local/share/facturo
ARCHIVE_DIR=/home/donald/.local/share/facturo/archive
SIGNATURE_PATH=/home/donald/.local/share/facturo/signature.png
```

`FACTURO_READ_ONLY=false` permet les requêtes normales depuis le Pi ou un tunnel SSH. Le port Node ne doit jamais être redirigé directement depuis Internet.

### Données et fichiers privés du Pi

```text
/home/donald/.config/facturo/facturo.env
/home/donald/.local/share/facturo/facturo.db
/home/donald/.local/share/facturo/facturo.db-wal
/home/donald/.local/share/facturo/facturo.db-shm
/home/donald/.local/share/facturo/archive/
/home/donald/.local/share/facturo/signature.png
```

La base est SQLite en mode WAL. Elle contient les tables `settings`, `clients`, `sites`, `services`, `invoices`, `invoice_lines` et `archive_records`. Ces chemins sont hors du dépôt : un re-clone du code ne touche donc ni la base, ni les archives, ni la signature, ni les secrets.

### HTTPS, certificat et authentification

L'accès externe est :

```text
https://donald-pomme.duckdns.org:8443/
```

Le routeur redirige le TCP public `8443` vers `192.168.1.99:8443`. Le reverse proxy est défini dans :

```text
/etc/nginx/sites-available/pomme
/etc/nginx/sites-enabled/pomme   (lien vers le fichier précédent)
/etc/nginx/snippets/facturo-readonly-location.conf
```

Le certificat Let's Encrypt utilisé par Nginx est :

```text
/etc/letsencrypt/live/donald-pomme.duckdns.org/fullchain.pem
/etc/letsencrypt/live/donald-pomme.duckdns.org/privkey.pem
```

L'authentification HTTP Basic Facturo utilise `/etc/nginx/.htpasswd-facturo`. Le compte est distinct d'un compte Linux. Le proxy autorise actuellement seulement `GET` et `HEAD` (`403` pour une écriture publique), même si l'application Node est en mode normal pour l'administration par SSH.

Fail2ban utilise :

```text
/etc/fail2ban/jail.d/facturo-nginx-auth.conf
/etc/fail2ban/filter.d/nginx-http-auth.conf
```

État du jail :

```bash
sudo fail2ban-client status facturo-nginx-auth
```

Les logs Nginx sont `/var/log/nginx/access.log` et `/var/log/nginx/error.log`. La configuration se valide avec `sudo /usr/sbin/nginx -t` avant un `sudo systemctl reload nginx`.

### Accès d'administration par SSH

Le port SSH public utilisé par l'alias `donald` est `9608`. Pour utiliser normalement les requêtes `GET`, `POST`, `PUT` et `DELETE` depuis un autre réseau :

```bash
ssh -N -p 9608 -L 8080:127.0.0.1:3030 donald@86.69.216.187
```

Puis ouvrir `http://127.0.0.1:8080/`. Ce tunnel atteint directement Node et contourne le filtrage Nginx public ; il ne crée pas de session Linux interactive.

### Re-cloner le dépôt sans toucher aux données

Après migration, le dépôt peut être supprimé et re-cloné sans sauvegarde préalable : les données, la signature et la configuration sont hors de `/home/donald/Informatique/C++/facturo`. Ne pas supprimer `/home/donald/.config/facturo` ni `/home/donald/.local/share/facturo`.

Après le `rm -rf` manuel puis le clone :

```bash
cd /home/donald/Informatique/C++
git clone git@github.com:Valere21/facturo.git
cd facturo
npm ci
```

Le fichier `/home/donald/.config/facturo/facturo.env` doit conserver les chemins et secrets suivants : `DATA_DIR`, `ARCHIVE_DIR`, `SIGNATURE_PATH`, SMTP/SUPER PDP et `FACTURO_READ_ONLY`. La signature est déjà dans `/home/donald/.local/share/facturo/signature.png` ; il n'est pas nécessaire de la recopier après chaque clone.

Installer ensuite l'unité systemd versionnée (une seule fois après cette migration) :

```bash
sudo install -o root -g root -m 0644 deploy/facturo.service /etc/systemd/system/facturo.service
sudo systemctl daemon-reload
sudo systemctl restart facturo
```

Pour une installation neuve, créer avant le premier démarrage les répertoires `/home/donald/.config/facturo` et `/home/donald/.local/share/facturo/archive`, copier `.env.example` vers `/home/donald/.config/facturo/facturo.env`, puis adapter ses chemins et secrets. Pour restaurer une sauvegarde JSON, utiliser **Paramètres → Restaurer une sauvegarde** une fois Facturo démarré.

Les fichiers `/etc/systemd/system/facturo.service`, `/etc/nginx/...`, `/etc/letsencrypt/...`, `/etc/fail2ban/...` et `/etc/nginx/.htpasswd-facturo` sont hors du dépôt : le re-clone ne les supprime pas. Après redémarrage, contrôler `systemctl status facturo`, `curl http://127.0.0.1:3030/api/dashboard` et le point d'entrée HTTPS.

## Exploitation et limites actuelles

- L'application ne fournit pas de gestion multi-utilisateur native. Ne pas l'exposer directement sur Internet ; l'utiliser derrière un réseau privé, un VPN ou un reverse proxy HTTPS correctement protégé.
- Ne jamais considérer une facture émise comme modifiable : l'archivage protège le document mais n'est pas, à lui seul, un dispositif légal complet de conservation ou de facturation électronique.
- Les pistes fonctionnelles prévues (avoirs, relances, second support, Pennylane et Google Agenda) sont centralisées dans [EVOLUTIONS.md](EVOLUTIONS.md).
