# Facturation électronique : pistes d'intégration

Cette note sert à comparer les options possibles pour Facturo. Elle ne remplace ni une vérification auprès d'une plateforme agréée, ni un conseil comptable ou juridique. Les exigences et offres doivent être revérifiées au moment de l'intégration.

## 1. Principe à conserver dans Facturo

- Facturo reste la source locale de préparation : brouillon, snapshot figé à l'émission, PDF de référence, archivage et états de livraison.
- Le connecteur de facturation électronique doit être interchangeable : Pennylane, une plateforme agréée ou une autre solution ne doivent pas modifier le fonctionnement des brouillons ni l'historique local.
- Toute transmission externe doit enregistrer un identifiant distant, un état, une date de tentative et une erreur éventuelle afin de permettre une relance sans doublon.

## 2. Alternative auto-hébergée : Invoice Ninja + PDP Libre / plateforme agréée

Pour réduire la dépendance à un éditeur de SaaS, une architecture auto-hébergée peut constituer une alternative à étudier.

- **Noyau de facturation et API :** Invoice Ninja peut être installé sur son propre serveur et propose une API v5 documentée sous `/api/v1`, authentifiée par jeton. Il peut donc servir de moteur de facturation distant contrôlé par l'utilisateur, avec clients, factures et automatisations pilotés par API. Le coût logiciel n'est pas nécessairement un abonnement SaaS, mais l'hébergement, les sauvegardes, la maintenance et la sécurité restent à assumer. [Documentation développeur Invoice Ninja](https://invoiceninja.github.io/docs/developer-guide)

- **Formats électroniques :** la capacité effective à produire un format compatible avec la réforme française — par exemple Factur-X — doit être vérifiée sur la version exacte d'Invoice Ninja et dans le scénario métier retenu. Produire un PDF ou même un fichier Factur-X ne suffit pas à autoriser seul la transmission réglementaire.

- **Rôle de la plateforme agréée :** en France, une plateforme agréée (PA, anciennement PDP) immatriculée est nécessaire pour transmettre/recevoir les flux concernés et assurer le e-reporting dans le cadre de la réforme. Une simple solution de facturation ou un logiciel auto-hébergé n'a pas cette qualité par lui-même. [Informations DGFiP sur les plateformes agréées](https://www.impots.gouv.fr/facturation-electronique-et-plateformes-agreees)

- **PDP Libre :** PDP Libre est une association à but non lucratif et un projet communautaire visant une facturation électronique accessible, avec une démarche open source. À la date de cette note, l'association indique ne pas fournir directement le service de facturation aux entreprises : une solution compatible et un adhérent-distributeur/une plateforme agréée restent nécessaires pour activer l'accès. C'est donc une piste d'écosystème et de mutualisation, pas une passerelle autonome à brancher immédiatement à Facturo. [PDP Libre — fonctionnement actuel](https://pdplibre.org/nous-rejoindre/)

- **Option API à faible coût :** une plateforme agréée telle que SUPER PDP propose une API et un sandbox pour intégrer directement un logiciel maison. Son tarif publié est actuellement de 0,01 € HT par facture jusqu'à 10 000 factures mensuelles, avec vérification KYC/KYB et un minimum annuel annoncé : il faut contrôler les conditions au moment de l'ouverture du compte. Cette option n'est pas open source, mais elle peut éviter un abonnement SaaS mensuel tout en fournissant l'accès réglementaire. [Tarifs SUPER PDP](https://www.superpdp.tech/tarifs/) · [Référence API](https://www.superpdp.tech/openapi/)

### Conséquence pratique pour Facturo

- Conserver dans Facturo un adaptateur de destinations externes plutôt que de lier le métier à Pennylane.
- Commencer par une intégration sandbox et un test de connexion sans création de facture distante.
- Ne sélectionner une destination de production qu'après validation des formats, des conditions tarifaires, de la compatibilité du client et des obligations applicables à l'activité.
- Prévoir la possibilité de remplacer une destination sans modifier les factures locales déjà émises.
