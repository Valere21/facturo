# Évolutions à envisager

- Flux d'émission multi-destinations : produire et figer le PDF, puis tracer séparément le stockage Raspberry Pi, l'e-mail client et Pennylane. Chaque destination doit être relançable sans duplication de facture, avec date, statut et erreur de dernière tentative.
- Gestion des avoirs, plutôt que modification d’une facture émise.
- Journal des envois client : destinataire, date, statut SMTP et erreur éventuelle.
- Suivi des règlements, échéances et relances.
- Sauvegarde planifiée vers un second support hors du Raspberry Pi.
- Connecteurs Pennylane et Google Agenda, lorsque le socle de facturation est stabilisé.
