# ShopControl — Cahier des charges v1.1 (corrigé)

Nov 18, 2026 · @Moussa Coulibaly

Cette version 1.1 reprend le cahier des charges v1.0 et corrige ses incohérences, comble ses manques et chiffre les exigences techniques, sans modifier les décisions déjà confirmées.

## Fiche du document

| Élément | Description |
| --- | --- |
| Document | Cahier des charges fonctionnel et technique — ShopControl, plateforme SaaS de gestion commerciale multi-boutiques |
| Version | 1.1 — corrigée et complétée (remplace la v1.0 du 18 novembre 2026) |
| Langue | Français |
| Périmètre | Administration, propriétaires, agents, clients, boutiques, ventes, stocks, commandes, facturation, messagerie, rapports |
| Objet | Définir fonctionnalités, rôles, permissions, pages, règles métier et comportements attendus pour guider conception, développement, tests et mise en production |

## Légende des statuts

Chaque règle nouvelle ou précisée est étiquetée, afin de ne jamais confondre une décision validée avec une recommandation.

| Étiquette | Signification |
| --- | --- |
| **\[CONFIRMÉ\]** | Décision exprimée clairement dans la v1.0 ; base fonctionnelle. |
| **\[RECOMMANDÉ\]** | Précision ou ajout proposé par cette revue ; à valider par le commanditaire avant développement. |
| **\[À ARBITRER\]** | Sujet ouvert ; ne pas considérer comme décidé (voir section 17). |

## Synthèse des corrections

- **Incohérences résolues** : traçabilité avec compte Agent partagé (opérateur déclaré), règle d’expédition des transferts (stock en transit), sessions de caisse, ordre des lots.
- **Manques comblés** : réservation et concurrence du stock, statuts de commande, passage commande → vente, suivi sans compte sécurisé, anti-abus, dépenses, créances, taxes et arrondis XOF, abonnements impayés, données personnelles, import de données, mode hors-ligne.
- **Exigences chiffrées** : performance, disponibilité, sauvegardes (RPO/RTO), sécurité. Les valeurs sont des propositions à valider.
- **Recette complétée** : 15 critères d’origine conservés, 16 ajoutés.
- Le détail ligne par ligne figure en annexe.

## 1. Présentation et objectifs

ShopControl est une plateforme web SaaS qui permet à un commerce de gérer une ou plusieurs boutiques, avec une vue individuelle et consolidée pour le propriétaire.

### 1.1 Vision

Elle centralise les ventes, les stocks, la caisse, les commandes et la communication de chaque boutique. **\[CONFIRMÉ\]**

### 1.2 Objectifs

- Permettre à un propriétaire de gérer plusieurs boutiques depuis un seul compte.
- Donner à chaque boutique un espace opérationnel indépendant pour ses agents.
- Permettre aux clients de consulter le catalogue et de commander depuis une vitrine publique dédiée.
- Générer automatiquement un QR code par boutique, imprimable et partageable.
- Suivre ventes, stocks, encaissements, dépenses, marges et bénéfices estimés.
- Produire des tickets de vente imprimables sur imprimantes thermiques compactes.
- Faciliter la communication entre clients, agents, propriétaires et administration.
- Automatiser les notifications et les rapports de fin de journée.

### 1.3 Principes structurants

| Principe | Règle |
| --- | --- |
| Autonomie boutique | Les opérations courantes ne nécessitent pas l’approbation permanente du propriétaire. |
| Supervision | Le propriétaire consulte les résultats de chaque boutique ou de toutes les boutiques réunies. |
| Cloisonnement | Un Agent est limité à sa boutique ; un propriétaire à son entreprise. |
| Traçabilité | Les opérations sensibles sont historisées et corrigées par annulation/rectification, jamais par effacement silencieux. |
| Simplicité client | La commande sans création de compte est possible. |
| Données fiables | Aucun chiffre fictif ; les bénéfices sont qualifiés d’estimés si des coûts manquent. |
| Robustesse terrain **\[RECOMMANDÉ\]** | Les parcours de vente au comptoir doivent rester utilisables avec un réseau instable (voir section 14.3). |

## 2. Périmètre fonctionnel

Le périmètre initial couvre huit modules ; la paie, la comptabilité réglementaire complète et le paiement en ligne n’en font pas partie.

| Module | Fonctionnalités attendues |
| --- | --- |
| Administration plateforme | Marchands, boutiques, modules, abonnements, paiements de plateforme, annonces, support, sécurité. |
| Gestion commerciale | Produits, catégories, ventes, clients, fournisseurs, achats. |
| Stocks | Entrées, sorties, inventaires, seuils d’alerte, corrections et transferts. |
| Finance et caisse | Encaissements, dépenses, créances, clôtures, écarts, marges et résultats estimés. |
| E-commerce | Vitrine publique, QR code, catalogue, panier, commande, retrait et livraison. |
| Communication | Messagerie interne et client, notifications, alertes et urgences. |
| Documents | Tickets, justificatifs PDF, impression thermique, historique. |
| Pilotage | Tableaux de bord, rapports par boutique et consolidés. |

### 2.1 Hors périmètre initial

- Paie et comptabilité réglementaire complète. **\[CONFIRMÉ : non confirmés dans le périmètre\]**
- Passerelle de paiement en ligne : les paiements Mobile Money sont encaissés directement par le marchand puis enregistrés manuellement. **\[À ARBITRER pour une version ultérieure\]**

### 2.2 Ajout au périmètre

- **Import de données \[RECOMMANDÉ\]** : import CSV des produits, catégories, prix, stocks initiaux, fournisseurs et clients, avec aperçu, rapport d’erreurs ligne par ligne et annulation de l’import. Sans cet outil, la reprise d’une boutique existante est trop longue pour être adoptée.
- **Dépenses \[RECOMMANDÉ\]** : le module Finance et caisse inclut un enregistrement des dépenses par catégorie (voir 5.6), puisqu’elles entrent dans le bénéfice estimé.

## 3. Architecture multi-boutiques

Chaque marchand possède ses boutiques ; chaque boutique est un espace isolé avec ses propres données, agents et paramètres.

### 3.1 Structure **\[CONFIRMÉ\]**

ShopControl → entreprise marchande → propriétaire → une ou plusieurs boutiques → compte(s) Agent rattaché(s) à une boutique. Les clients accèdent aux vitrines publiques sans appartenir à l’espace privé du marchand.

### 3.2 Règles **\[CONFIRMÉ\]**

- Chaque boutique possède son catalogue publié, ses stocks, ses ventes, sa caisse, ses agents, ses commandes et ses paramètres.
- Un compte Agent est rattaché à une seule boutique et ne peut pas consulter les autres.
- Le propriétaire bascule entre ses boutiques et dispose d’une vue consolidée.
- Les données d’un marchand sont isolées de celles des autres marchands.
- Un changement de boutique dans l’interface propriétaire actualise toutes les listes et indicateurs.
- La suspension d’une boutique ne supprime ni ses données ni son historique.

### 3.3 Suspension d’une boutique ou d’un marchand **\[RECOMMANDÉ\]**

La v1.0 prévoit la suspension sans définir ses effets. Proposition :

| Statut | Back-office (propriétaire, agents) | Vitrine publique | Données |
| --- | --- | --- | --- |
| Actif | Accès complet | En ligne | Conservées |
| Impayé (délai de grâce configurable) | Accès complet + bandeau d’alerte | En ligne | Conservées |
| Suspendu | Lecture seule + export des données | Page « Boutique momentanément indisponible » ; aucune commande | Conservées |
| Résilié | Export possible pendant une durée fixée | Hors ligne | Conservées selon la politique de conservation (12.4) |

Les commandes déjà reçues avant la suspension restent consultables. Durée du délai de grâce : **\[À ARBITRER\]** avec les offres d’abonnement.

### 3.4 Paramètres de boutique **\[CONFIRMÉ\]**

- Nom commercial, logo, coordonnées et adresse.
- Horaires d’ouverture et fermetures exceptionnelles.
- Catalogue, catégories, prix et seuils de stock.
- Modes de retrait et de livraison proposés ; coût et zones de livraison.
- Moyens de paiement acceptés.
- Modèle de ticket, série de numérotation et préférences de notification.
- **\[RECOMMANDÉ\]** Fuseau horaire, devise, taxes (5.3) et heure du bilan journalier.

## 4. Rôles et permissions

Quatre rôles existent : Super Admin (plateforme), Propriétaire (entreprise), Agent (boutique) et Client (vitrine).

### 4.1 Super Admin **\[CONFIRMÉ\]**

Il gère la plateforme, pas les opérations commerciales quotidiennes des boutiques.

| Page | Droits et fonctions |
| --- | --- |
| Tableau de bord global | Indicateurs de plateforme : marchands, boutiques, abonnements, incidents. |
| Marchands | Créer, consulter, modifier, suspendre ou réactiver les comptes marchands. |
| Boutiques | Consulter l’état des boutiques et intervenir sur leur statut plateforme. |
| Modules et abonnements | Gérer modules, offres, limites et périodes. |
| Paiements plateforme | Suivre les paiements d’abonnement et documents associés. |
| Support | Recevoir, traiter et clôturer les demandes d’assistance. |
| Annonces et notifications | Diffuser messages de service, maintenance et annonces globales. |
| Sécurité et journaux | Suivre connexions, incidents et actions d’administration. |
| Paramètres globaux | Configurer les règles et paramètres communs. |

**Limites**

- Ne réalise pas les ventes, achats, mouvements de stock ou clôtures de caisse des marchands.
- Ne modifie pas les données commerciales d’un marchand en fonctionnement normal.
- Ne peut pas effacer les journaux d’audit pour masquer une action.
- Tout accès exceptionnel au compte d’un marchand est justifié et journalisé.
- **\[RECOMMANDÉ\]** L’accès exceptionnel est limité dans le temps (par exemple 2 heures, renouvelable avec nouveau motif), en lecture seule par défaut, et le marchand est notifié de chaque accès.

### 4.2 Propriétaire **\[CONFIRMÉ\]**

Il est responsable de l’entreprise, supervise toutes ses boutiques et peut travailler lui-même comme opérateur sans créer d’Agent.

| Page | Droits et fonctions |
| --- | --- |
| Vue d’ensemble | Choisir une boutique ou afficher la synthèse de toutes. |
| Ventes | Créer et consulter ventes, paiements, remises, retours et annulations autorisées. |
| Produits | Créer, modifier, catégoriser, publier, archiver et gérer les prix. |
| Stocks | Quantités, mouvements, inventaires, seuils et corrections. |
| Achats / fournisseurs | Créer les achats, gérer les fournisseurs, réceptionner. |
| Clients | Fiches, historiques et conversations autorisées. |
| Finances | Recettes, dépenses, coûts, marges, créances, dettes et bénéfice estimé. |
| Caisses | Ouvertures, mouvements, clôtures et écarts. |
| Commandes / livraisons | Superviser les commandes de toutes les boutiques. |
| Agents | Créer, désactiver et configurer les permissions des comptes Agent. |
| Rapports | Bilans par boutique et consolidés. |
| Paramètres | Entreprise, boutiques, QR, vitrines, horaires, notifications. |

**Acquis et limites**

- Accès complet aux données de son entreprise et de ses boutiques.
- Pas d’obligation de valider chaque vente, commande ou opération quotidienne.
- Validation préalable requise pour les transferts de stock entre boutiques.
- Ne peut pas administrer les autres marchands ni modifier les paramètres globaux.
- Ne peut pas effacer définitivement les transactions validées ni les journaux d’audit.

**Associés et gérants \[À ARBITRER\]** : la v1.0 ne dit pas si une entreprise peut avoir plusieurs propriétaires ou un rôle intermédiaire de gérant (accès à plusieurs boutiques, sans les paramètres d’entreprise). Recommandation : prévoir un seul propriétaire en version 1, et un rôle **Gérant** (une ou plusieurs boutiques assignées) en version ultérieure. Ce choix touche le modèle de données du lot 1.

### 4.3 Agent **\[CONFIRMÉ\]**

Compte opérationnel rattaché à une seule boutique, utilisable sur l’ordinateur ou le terminal de la boutique. Il peut être partagé par l’équipe ; l’identification individuelle des employés n’est pas une exigence retenue.

| Page | Fonctions possibles selon permissions |
| --- | --- |
| Accueil | Tâches, alertes, commandes et indicateurs autorisés. |
| Ventes | Panier, encaissement, validation, édition du ticket. |
| Produits | Consulter ; créer ou modifier si autorisé. |
| Stocks | Consulter, réceptionner, inventorier, mouvements permis. |
| Commandes | Voir, contacter, confirmer/refuser, préparer, remettre/expédier. |
| Clients | Créer ou modifier une fiche dans les limites autorisées. |
| Caisse | Ouvrir, consulter, encaisser, enregistrer un mouvement, clôturer si autorisé. |
| Messagerie | Répondre aux clients, échanger avec le propriétaire. |
| Historique | Opérations accessibles au compte. |

**Permissions configurables par le propriétaire**

| Domaine | Autorisations configurables |
| --- | --- |
| Ventes | Créer, consulter, remise plafonnée, annuler ou rembourser si droit accordé. |
| Produits | Voir, créer, modifier, publier, archiver. |
| Stocks | Voir, réceptionner, entrée/sortie, inventaire, correction avec motif. |
| Achats | Consulter, préparer une commande fournisseur, enregistrer une réception. |
| Commandes | Consulter, contacter, confirmer, refuser, préparer, livrer ou remettre. |
| Clients | Consulter, créer, modifier les coordonnées. |
| Caisse | Ouvrir, encaisser, décaisser, consulter et clôturer. |
| Messagerie | Répondre aux clients, contacter le propriétaire. |
| Transferts | Créer une demande ; pas d’expédition sans validation préalable du propriétaire. |
| Dépenses **\[RECOMMANDÉ\]** | Enregistrer une dépense, avec plafond par dépense configurable. |

**Restrictions par défaut**

- Aucun accès aux autres boutiques ni aux paramètres globaux.
- Aucune modification de son propre rôle ou de ses permissions.
- Pas d’accès par défaut aux bénéfices, coûts d’achat ou rapports financiers confidentiels.
- Pas de suppression définitive d’une vente, d’un mouvement ou d’un journal.

**Traçabilité avec compte partagé \[RECOMMANDÉ\]** : la v1.0 exige un auteur dans chaque journal tout en excluant l’identification individuelle ; le compte seul ne permet pas de savoir qui a causé un écart de caisse ou une correction de stock. Sans remettre en cause le compte partagé, le système demande un **opérateur déclaré** :

- Le propriétaire définit une liste de prénoms d’opérateurs par boutique (sans compte ni mot de passe).
- À l’ouverture de la caisse et à chaque opération sensible (remise, annulation, correction de stock, clôture), l’opérateur est choisi, avec un code PIN court en option activable par le propriétaire.
- Les journaux enregistrent compte + opérateur déclaré ; le système ne prétend pas identifier une personne physique tant que le PIN n’est pas activé.

### 4.4 Client **\[CONFIRMÉ\]**

- Consulter une vitrine et son catalogue sans compte obligatoire.
- Rechercher et filtrer les produits ; consulter prix, photos, variantes et disponibilité.
- Ajouter au panier, modifier les quantités, retirer des articles et valider la commande.
- Choisir livraison ou retrait en boutique si les options sont proposées.
- Renseigner nom, téléphone et adresse/quartier si livraison.
- Recevoir une référence de commande et consulter son état avec une vérification adaptée (8.6).
- Créer facultativement un compte pour retrouver ses commandes.
- Échanger avec la boutique avant ou après commande, sans compte obligatoire lorsque le parcours sécurisé le permet.

## 5. Ventes et caisse

Une vente validée met à jour atomiquement le stock et la caisse, et n’est jamais supprimée : elle est annulée ou remboursée avec trace.

### 5.1 Cycle d’une vente **\[CONFIRMÉ\]**

1. L’Agent ouvre Ventes et sélectionne produits, variantes et quantités.
2. Le système contrôle la disponibilité du stock.
3. Le client peut être associé à la vente si nécessaire.
4. Le système calcule sous-total, remise autorisée, taxes configurées et total.
5. L’Agent choisit le moyen de paiement et saisit le montant reçu.
6. À la validation, le système crée un numéro unique, enregistre la vente, met à jour stock et caisse.
7. Le ticket est généré et peut être imprimé ou partagé.

**\[RECOMMANDÉ\]** L’étape 6 et le contrôle final du stock s’exécutent dans une seule transaction serveur : si deux ventes visent le dernier article, la seconde est refusée avec un message clair (voir 6.4).

### 5.2 Paiements

Moyens configurables : espèces, Orange Money, Wave et autres moyens définis par le propriétaire. **\[CONFIRMÉ\]** En version 1, un paiement Mobile Money est encaissé directement par le marchand puis enregistré manuellement ; aucune passerelle ou API de paiement n’est intégrée. **\[À ARBITRER pour la suite\]**

**\[RECOMMANDÉ\]** Pour limiter les fausses déclarations, un paiement Mobile Money exige la saisie de la référence de transaction (obligatoire, unique par boutique, avec contrôle de doublon). Le propriétaire peut désactiver cette obligation par moyen de paiement.

### 5.3 Prix, remises, taxes et arrondis **\[RECOMMANDÉ\]**

La v1.0 mentionne remises et « taxes configurées » sans règles. Proposition :

| Sujet | Règle proposée |
| --- | --- |
| Devise | XOF par défaut (**à confirmer**), sans décimales ; tous les montants stockés en entiers. |
| Prix | Prix de vente par produit, avec option de prix propre à une variante. Prix identique entre boutiques par défaut, modifiable par boutique. |
| Taxes | Taux configurables par boutique ; réglage « prix TTC » ou « prix HT », global par boutique. Aucune taxe appliquée tant que le propriétaire n’en a pas configuré. Taux et mentions à valider (section 17). |
| Remises | En pourcentage ou en montant, par ligne ou sur la vente. Plafond (en % du total) défini par le propriétaire, par Agent ou par boutique ; au-delà, la remise est refusée. |
| Arrondis | Arrondi à l’unité la plus proche sur chaque ligne ; l’écart d’arrondi est conservé sur la ligne de taxe ou de total, jamais perdu. Option d’arrondi des totaux espèces à 5 ou 25 XOF selon la pratique locale, tracée comme ligne d’arrondi. |

### 5.4 Annulation, retour et remboursement **\[CONFIRMÉ\]**

| Événement | Règle |
| --- | --- |
| Brouillon | Modifiable avant validation. |
| Vente validée | Conservée dans l’historique ; pas de suppression silencieuse. |
| Annulation | Droit dédié, motif obligatoire, mouvements inverses tracés. |
| Remboursement | Droit dédié, lié à la vente d’origine, montant historisé. |
| Retour | Préciser quantité et état ; réintégrer le stock uniquement si revendable. |
| Paiement partiel | Afficher séparément montant reçu et solde dû. |

**\[RECOMMANDÉ\]** Un retour ou un remboursement ne peut pas dépasser les quantités et montants de la vente d’origine. Un produit non revendable est enregistré comme perte (sortie de stock avec motif), pas comme retour en stock. Un remboursement en espèces crée un décaissement dans la caisse ouverte.

### 5.5 Caisse

**\[CONFIRMÉ\]**

- Ouverture avec montant initial si le processus est activé.
- Enregistrement des encaissements et décaissements autorisés.
- Solde théorique calculé à partir des mouvements.
- À la clôture, saisie du montant réellement compté et affichage de l’écart.
- Un Agent autorisé peut clôturer sans validation préalable du propriétaire.
- Le propriétaire est notifié en cas d’écart ou d’anomalie.
- Horaires de boutique, session de travail Agent et session de caisse sont trois notions distinctes.

**Précisions \[RECOMMANDÉ\]**

- Une session de caisse est rattachée à la **boutique** (et non à un compte Agent) : une seule session ouverte par caisse à la fois. Une boutique peut avoir plusieurs caisses si le propriétaire l’active.
- Chaque session enregistre l’opérateur déclaré à l’ouverture et à la clôture (4.3). Un changement d’équipe en cours de journée se fait par clôture puis réouverture, ou par « passation » avec comptage intermédiaire.
- Les ventes ne peuvent être encaissées en espèces que si une session de caisse est ouverte (sauf si le processus d’ouverture est désactivé).
- Une session oubliée ouverte plus de 24 h déclenche une alerte au propriétaire.
- Une clôture n’est pas modifiable ; une erreur est corrigée par un mouvement de régularisation motivé.

### 5.6 Dépenses **\[RECOMMANDÉ\]**

Les dépenses entrent dans le bénéfice estimé mais la v1.0 ne décrit ni page ni catégories.

- Fiche dépense : date, montant, catégorie, moyen de paiement, bénéficiaire, note, justificatif (photo) facultatif si les pièces jointes sont retenues.
- Catégories configurables par le propriétaire (loyer, électricité, transport, salaires informels, autres).
- Une dépense payée en espèces depuis la caisse crée un décaissement ; sinon elle n’affecte pas la caisse.
- Les dépenses sont rattachées à une boutique ; une dépense commune à l’entreprise est marquée « entreprise » et répartie ou affichée uniquement dans la vue consolidée (choix à faire, section 17).
- Correction par annulation/rectification, comme pour une vente.

### 5.7 Créances et dettes **\[RECOMMANDÉ\]**

- Un paiement partiel ou différé crée une créance liée à un client identifié (nom + téléphone obligatoires).
- Un solde dû se règle ultérieurement par un ou plusieurs encaissements, chacun enregistré en caisse ou dans le moyen de paiement choisi, avec référence à la vente d’origine.
- Plafond de crédit configurable par client et par boutique ; au-delà, la vente à crédit est refusée sauf droit spécifique.
- Liste des créances avec ancienneté, et rappel manuel au client par message ; rappels automatiques **\[À ARBITRER\]** (coût SMS).
- Les dettes fournisseurs suivent le même principe : montant dû à la réception, paiements partiels, solde.

## 6. Produits, achats et stocks

Le stock est une conséquence de mouvements tracés : on ne l’édite jamais directement, on enregistre un mouvement.

### 6.1 Fiche produit **\[CONFIRMÉ\]**

- Nom, référence, description, catégorie et images.
- Prix de vente et coût d’achat si renseigné.
- Unité, variantes, code-barres éventuel et seuil d’alerte.
- État : brouillon, publié, indisponible ou archivé.
- Visibilité publique distincte de l’existence interne : seuls les produits publiés apparaissent sur la vitrine.

### 6.2 Mouvements **\[CONFIRMÉ\]**

Les entrées proviennent des réceptions, retours revendables et transferts reçus. Les sorties proviennent des ventes validées, pertes, corrections autorisées et transferts expédiés. Chaque mouvement conserve date, quantité, source, boutique et auteur.

**\[RECOMMANDÉ\]** L’auteur d’un mouvement est le compte plus l’opérateur déclaré (4.3). Le stock disponible d’un produit est la somme de ses mouvements ; il n’existe aucun champ « quantité » modifiable directement.

### 6.3 Achats et inventaire **\[CONFIRMÉ\]**

- Une commande fournisseur ne modifie pas le stock tant que les marchandises ne sont pas réceptionnées.
- La réception peut être partielle et ne crédite que les quantités réellement reçues.
- Un inventaire compare stock théorique et comptage physique.
- Une correction exige une permission, un motif et une trace avant/après.

### 6.4 Concurrence et réservation du stock **\[RECOMMANDÉ\]**

La v1.0 ne dit pas ce qui se passe quand deux ventes ou commandes visent le dernier article, ni si une commande en ligne bloque du stock. Proposition :

| Cas | Règle proposée |
| --- | --- |
| Deux ventes simultanées sur le dernier article | La validation est transactionnelle ; la première réussit, la seconde est refusée avec le stock restant affiché. |
| Commande en ligne reçue | Le stock n’est pas encore décrémenté ; il n’est pas réservé non plus tant que l’Agent n’a pas confirmé. |
| Commande confirmée par l’Agent | Les quantités sont **réservées** : elles sortent du stock disponible à la vente et à la vitrine, mais pas encore du stock physique. |
| Commande livrée ou retirée | La réservation est transformée en sortie de stock au moment de la vente associée (8.8). |
| Commande refusée, annulée ou expirée | La réservation est libérée immédiatement. |
| Commande confirmée jamais retirée | Expiration automatique après une durée configurable par boutique (par exemple 48 h pour un retrait), avec alerte avant libération. |

**Stock disponible = stock physique − quantités réservées.** La vitrine n’affiche que le stock disponible. Le panier d’un client ne réserve rien.

### 6.5 Valorisation du stock **\[À ARBITRER\]**

Le coût des marchandises vendues dépend de la méthode choisie ; ce choix conditionne le calcul de la marge dans les lots 2 et 4. Options :

| Méthode | Avantage | Inconvénient |
| --- | --- | --- |
| Coût moyen pondéré | Simple, stable, adapté aux petits commerces | Moins précis si les prix d’achat varient beaucoup |
| FIFO | Plus proche du coût réel | Suivi par lot, plus complexe à corriger |

Recommandation : **coût moyen pondéré** en version 1, recalculé à chaque réception, avec historique des coûts. Quand le coût d’achat d’un produit est absent, la marge de ce produit est marquée « incomplète » et le bénéfice reste qualifié d’estimé.

## 7. Transferts entre boutiques

Un transfert déplace du stock entre deux boutiques du même propriétaire, uniquement après validation de ce dernier ; ce n’est ni une vente ni du chiffre d’affaires.

### 7.1 Règle confirmée **\[CONFIRMÉ\]**

Un Agent sélectionne produits et quantités puis envoie une demande au propriétaire. Le transfert n’est autorisé qu’après validation du propriétaire ; l’Agent reçoit une confirmation et peut alors expédier. Le droit de déléguer l’approbation à un Agent n’est pas confirmé (**\[À ARBITRER\]**, section 17).

### 7.2 Statuts

| Statut | Comportement | Effet sur le stock |
| --- | --- | --- |
| Brouillon | Choix de la boutique destinataire, des produits et des quantités. | Aucun |
| En attente | Demande transmise au propriétaire ; disponibilité contrôlée. | Aucun |
| Refusé | Refus avec motif obligatoire. | Aucun |
| Autorisé | Validation du propriétaire ; notification à l’Agent. | **\[RECOMMANDÉ\]** Quantités réservées dans la boutique source |
| Expédié | Départ enregistré par l’Agent source. | Stock source diminué ; quantités « en transit » |
| Reçu | La boutique destinataire confirme les quantités réellement reçues. | Stock destinataire augmenté de la quantité reçue ; transit soldé |
| Écart | Différence expédiée/reçue signalée et historisée. | Voir 7.3 |

Les statuts, leur ordre et les motifs sont **\[CONFIRMÉ\]** ; la colonne « Effet sur le stock » précise la règle que la v1.0 renvoyait à « la règle définie » sans la définir.

### 7.3 Règle d’expédition et de réception **\[RECOMMANDÉ\]**

- **À l’expédition** : le stock de la boutique source est décrémenté et la quantité passe « en transit ». Elle n’est disponible à la vente ni dans la source ni dans la destination.
- **À la réception** : la destination saisit les quantités reçues et son stock est crédité de ces quantités.
- **Écart** (reçu inférieur à expédié) : la différence reste « en transit litigieux » et le propriétaire est notifié. Il la solde en la réaffectant (retour à la source) ou en l’enregistrant comme perte avec motif. Reçu supérieur à expédié : réception refusée jusqu’à correction du transfert par la source.
- **Annulation** : possible jusqu’à l’expédition (la réservation est libérée) ; après expédition, le transfert ne peut qu’aller jusqu’à réception.
- **Valorisation** : les quantités transférées gardent leur coût unitaire d’origine (6.5).
- Un transfert reste en « expédié » au plus une durée configurable (par exemple 7 jours) avant une alerte au propriétaire.

### 7.4 Règles générales **\[CONFIRMÉ\]**

- Un transfert relie deux boutiques du même propriétaire.
- Un identifiant unique est attribué à chaque transfert.
- Un transfert n’est pas une vente et ne constitue pas du chiffre d’affaires.
- Les quantités ne sont pas comptées deux fois dans le bilan consolidé : le stock en transit est compté une seule fois, dans une ligne distincte (11.2).

## 8. Vitrines, QR codes et commandes

Chaque boutique a une vitrine publique stable, accessible par QR code, où le client commande sans compte ; la commande devient une vente seulement quand elle est livrée ou retirée.

### 8.1 Domaine unique et URL de boutique **\[CONFIRMÉ\]**

Un domaine principal unique pour ShopControl ; chaque boutique a une URL distincte, par exemple domaine-principal/identifiant-boutique. Le format final et les domaines personnalisés sont **\[À ARBITRER\]**.

**\[RECOMMANDÉ\]** L’identifiant de boutique (slug) est unique, choisi à la création et **stable** : s’il est modifié, l’ancienne URL redirige vers la nouvelle, afin que les QR codes déjà imprimés continuent de fonctionner.

### 8.2 QR code **\[CONFIRMÉ\]**

- Génération automatique d’un QR code unique à la création/activation de chaque boutique.
- Le QR code renvoie vers l’URL stable de la vitrine, pas vers une copie figée du catalogue.
- Les produits publiés et disponibles apparaissent automatiquement ; une mise à jour du catalogue ne nécessite pas de recréer le QR code.
- Le propriétaire peut télécharger, imprimer, afficher et partager le QR code.
- Chaque QR code mène uniquement à la boutique correspondante.
- **\[RECOMMANDÉ\]** Téléchargement en PNG et en PDF/SVG haute résolution, avec nom de la boutique, pour l’impression d’affiches.

### 8.3 Pages de la vitrine **\[CONFIRMÉ\]**

| Page | Comportement attendu |
| --- | --- |
| Accueil boutique | Nom, logo, bannière, recherche, catégories, produits en vedette, contact et panier. |
| Catalogue | Produits publiés, photos, prix, disponibilité, filtres et tri. |
| Détail produit | Description, photos, variantes, prix et quantité. |
| Panier | Articles, quantités modifiables, suppression, sous-total, frais et total. |
| Validation | Coordonnées, téléphone, adresse si livraison, instructions et mode de réception. |
| Confirmation | Référence unique, résumé de commande et prochaines étapes. |
| Suivi | État de commande par référence et vérification du client. |

### 8.4 Commande sans compte **\[CONFIRMÉ\]**

Le client peut scanner le QR code, parcourir les produits, ajouter au panier, valider et quitter le site sans créer de compte. La connexion ou l’inscription peut être suggérée, jamais imposée.

### 8.5 Livraison ou retrait **\[CONFIRMÉ\]**

- Le client choisit entre livraison et retrait en boutique selon les options activées.
- Livraison : adresse, quartier, téléphone et instructions nécessaires.
- Retrait : affichage de la boutique et des informations pratiques.
- Coût et zone de livraison configurables par boutique.
- Le système ne propose que les modes réellement activés par la boutique.
- **\[RECOMMANDÉ\]** Hors des horaires d’ouverture, la commande reste possible mais la confirmation affiche le délai de traitement prévu ; le propriétaire peut désactiver les commandes hors horaires.

### 8.6 Suivi sans compte sécurisé **\[RECOMMANDÉ\]**

Une référence de commande et un téléphone sont faciles à deviner ou à usurper. Proposition de base, sans coût SMS :

- La page de confirmation affiche un **lien de suivi secret** (jeton long et aléatoire) que le client peut enregistrer ou partager par ses propres moyens (par exemple WhatsApp). C’est la méthode principale.
- Sans le lien, le suivi par référence demande aussi le téléphone, avec limitation du nombre d’essais (par exemple 5 échecs par heure et par adresse IP et par commande), et n’affiche que l’état, jamais l’adresse complète ni l’historique de conversation.
- Option **\[À ARBITRER\]** : code à usage unique par SMS pour accéder aux détails (coût, consentement et fournisseur à décider, section 17).
- La messagerie client (section 9) utilise le même principe : accès par le lien secret de la commande ou une conversation propre à un jeton de session.

### 8.7 Statuts de commande **\[RECOMMANDÉ\]**

La v1.0 décrit le traitement sans lister les statuts, contrairement aux transferts. Proposition :

| Statut | Signification | Qui le déclenche | Stock |
| --- | --- | --- | --- |
| Nouvelle | Commande reçue, à traiter | Client | Aucun effet |
| Confirmée | Articles et stock vérifiés | Agent | Quantités réservées (6.4) |
| Refusée | Commande refusée, motif obligatoire | Agent | Aucun effet |
| En préparation | Articles en cours de préparation | Agent | Réservé |
| Prête | Prête au retrait ou à l’expédition | Agent | Réservé |
| En livraison | Remise au livreur ou en route (livraison uniquement) | Agent | Réservé |
| Livrée / Retirée | Remise au client ; déclenche la vente (8.8) | Agent | Réservation transformée en sortie |
| Annulée | Annulée par le client avant confirmation, ou par la boutique avec motif | Client ou Agent | Réservation libérée |
| Expirée | Non retirée ou non joignable dans le délai | Système | Réservation libérée |

Chaque changement de statut conserve date, compte, opérateur déclaré et motif lorsqu’il est requis. Le client est informé des changements principaux sur la page de suivi.

### 8.8 De la commande à la vente **\[RECOMMANDÉ\]**

La v1.0 ne dit pas comment une commande livrée devient une vente (paiement, caisse, ticket, stock). Proposition :

1. Une commande n’est **pas** du chiffre d’affaires ; elle devient une vente à la remise au client (statut « Livrée » ou « Retirée »).
2. À cette étape, l’Agent enregistre l’encaissement : espèces (entrée en caisse), Mobile Money avec référence (5.2), ou paiement partiel (créance, 5.7). Un paiement déjà reçu avant la remise est enregistré comme acompte rattaché à la commande.
3. Le système crée la vente avec son numéro unique et son ticket, transforme la réservation en sortie de stock et met à jour la caisse.
4. Si les quantités réellement remises diffèrent de la commande, la vente reflète les quantités remises ; l’écart est tracé sur la commande.
5. Les frais de livraison sont une ligne distincte de la vente ; leur traitement fiscal reste à valider (section 17).

### 8.9 Traitement d’une commande **\[CONFIRMÉ\]**

- La commande arrive dans l’espace de la boutique ciblée.
- L’Agent vérifie les articles et le stock, contacte le client si besoin, puis confirme ou refuse.
- Il prépare la commande et passe les statuts jusqu’à livraison ou retrait.
- Le propriétaire supervise toutes les commandes sans approuver chacune.
- Les changements de statut et échanges sont conservés.
- **\[RECOMMANDÉ\]** Une commande « Nouvelle » non traitée au-delà d’un délai configurable (par exemple 2 heures en horaires d’ouverture) déclenche une alerte au propriétaire.

### 8.10 Protection contre les abus **\[RECOMMANDÉ\]**

La vitrine est publique ; la v1.0 ne prévoit aucune protection contre les fausses commandes ni le spam.

- Limitation du débit : nombre maximal de commandes par téléphone et par adresse IP sur une période (valeurs configurables).
- Contrôle anti-robot discret sur la validation (de type captcha invisible), sans compte obligatoire.
- Format de téléphone validé ; quantités et montants plafonnés par commande, configurables.
- Possibilité pour la boutique de signaler et bloquer un numéro ; les commandes d’un numéro bloqué sont refusées sans notification.
- Limitation du débit de la messagerie client et filtrage de liens dans les messages.

## 9. Messagerie et notifications

La messagerie relie clients, agents, propriétaires et administration, toujours dans le cadre d’une boutique ; les notifications dirigent vers la bonne page sans contourner les permissions.

### 9.1 Messagerie **\[CONFIRMÉ\]**

| Expéditeur | Destinataire | Usage |
| --- | --- | --- |
| Propriétaire | Agent | Consignes, questions, suivi et organisation. |
| Agent | Propriétaire | Questions, signalements et compte rendu. |
| Client | Agent | Question produit, commande et suivi. |
| Agent | Client | Disponibilité, confirmation, préparation et livraison/retrait. |
| Propriétaire | Client | Questions et suivi, y compris lorsqu’aucun Agent n’existe. |
| Super Admin | Propriétaire | Assistance et informations de plateforme. |

- Une boîte de réception regroupe les conversations accessibles.
- Chaque conversation client est rattachée à une boutique.
- Sans Agent, les messages arrivent directement au propriétaire.
- Le propriétaire peut contacter directement les Agents de ses boutiques, reprendre ou attribuer une conversation.
- Un Agent ne voit que les conversations de sa boutique.
- Les clients sont identifiés par téléphone/référence de commande avec protection contre l’usurpation (8.6).
- Pièces jointes (photos, documents, notes vocales) : **\[À ARBITRER\]**, non confirmées pour la version 1. **\[RECOMMANDÉ\]** Prévoir seulement des photos (taille et type limités, analyse antivirus) si elles sont retenues, les notes vocales et documents en version ultérieure.

### 9.2 Notifications

| Type | Exemples |
| --- | --- |
| Nouvelle commande | Commande reçue, commande à traiter. |
| Messagerie | Nouveau message client, propriétaire ou Agent. |
| Stock | Seuil bas, rupture, inventaire avec écart. |
| Caisse/finance | Clôture, écart de caisse, paiement enregistré. |
| Transfert | Demande à valider, refus, autorisation, expédition, réception, écart. |
| Sécurité | Connexion inhabituelle, changement de permission. |
| Plateforme | Maintenance, abonnement, annonce de service. |

**\[CONFIRMÉ\]**

- Centre de notifications avec compteur non lu, date, boutique, type et priorité.
- Cliquer sur une notification ouvre la page concernée si l’utilisateur y a accès.
- Actualisation en temps réel si la connexion le permet ; mécanisme de repli sinon.
- Canaux possibles : notification dans l’application, push, e-mail et SMS selon configuration.
- Regroupement des alertes répétitives ; seuls les rôles concernés sont notifiés.
- Urgences visuellement distinguées des simples informations.

**\[RECOMMANDÉ\]**

- Version 1 : notifications dans l’application et e-mail. Push et SMS dès que fournisseur, coût et consentement sont arrêtés (section 17).
- Le propriétaire choisit, par type et par canal, ce qu’il reçoit ; les alertes de sécurité et d’écart de caisse ne peuvent pas être désactivées.
- Une notification contient le minimum de données personnelles (pas de montant ni d’adresse client dans un SMS ou un push).

## 10. Facturation et impression

Chaque vente validée génère un justificatif réimprimable ; ce ticket n’est pas une facture fiscale tant que sa conformité au Mali n’est pas vérifiée.

### 10.1 Justificatif de vente **\[CONFIRMÉ\]**

Numéro unique, nom/logo de la boutique, coordonnées, date, articles, quantités, prix, remises, total et moyen de paiement.

**\[RECOMMANDÉ\]**

- Numérotation séquentielle par boutique et par série, sans trou ni doublon, générée côté serveur au moment de la validation.
- Un justificatif annulé reste dans la série avec la mention « ANNULÉ » ; il n’est jamais supprimé ni renuméroté.
- Un remboursement génère un justificatif distinct (avoir) lié à la vente d’origine.
- Le justificatif affiche, le cas échéant, montant reçu, solde dû, taxes et ligne d’arrondi (5.3).
- Une réimpression porte la mention « DUPLICATA ».
- En mode hors-ligne (si retenu, 14.3), la numérotation utilise des plages réservées par terminal, pour éviter les doublons à la synchronisation.

### 10.2 Ticket thermique **\[CONFIRMÉ\]**

- Format compact pour imprimantes thermiques de boutique, largeurs courantes de 58 mm et 80 mm.
- Impression après validation et réimpression depuis l’historique.
- Téléchargement PDF et partage au client par les moyens disponibles.
- Compatibilité à tester réellement sur les imprimantes et terminaux ciblés, notamment Android.

**\[RECOMMANDÉ\]** L’impression thermique dépend du terminal, du navigateur, du système et du modèle d’imprimante ; elle ne peut pas être garantie universellement. La liste des imprimantes et protocoles officiellement pris en charge est fixée avant le lot 3 (section 17), et l’impression via le navigateur (CSS d’impression) reste le repli universel.

### 10.3 Attention réglementaire

Un ticket généré par le logiciel n’est pas automatiquement une facture fiscale conforme. Les mentions obligatoires, taxes et règles applicables au Mali doivent être vérifiées avant de présenter le document comme facture officielle. **\[CONFIRMÉ\]**

**\[RECOMMANDÉ\]** Tant que cette vérification n’est pas faite, le document est intitulé « Ticket de caisse / Justificatif de vente » et non « Facture » ; la vérification est un prérequis de sortie du lot 3.

## 11. Rapports et supervision

Le propriétaire lit le bilan de chaque boutique ou le total consolidé, et peut toujours redescendre du total à la ventilation par boutique.

### 11.1 Bilan journalier **\[CONFIRMÉ\]**

Chaque boutique peut produire automatiquement un bilan à l’heure de fermeture configurée (par exemple 22 h). Le propriétaire peut aussi cliquer à tout moment sur « Bilan journalier ».

- Ventes et chiffre d’affaires de la journée ; nombre de transactions et quantités vendues.
- Montants encaissés par moyen de paiement et montants restant dus.
- Coût des marchandises vendues si les coûts sont renseignés.
- Dépenses enregistrées, marge brute et bénéfice net estimé.
- État de caisse et éventuel écart.
- Mouvements de stock, alertes et commandes.
- Comparaison entre boutiques si plusieurs établissements existent.

**Règles de déclenchement \[RECOMMANDÉ\]**

- L’heure du bilan et le fuseau horaire sont des paramètres de boutique (3.4) ; par défaut, fuseau Africa/Bamako (UTC+0, sans changement d’heure).
- « La journée » court de l’heure d’ouverture du jour à l’heure de bilan ; les ventes après l’heure de bilan comptent dans le bilan suivant.
- Si la caisse n’est pas encore clôturée à l’heure du bilan, il est marqué **provisoire** et se recalcule automatiquement à la clôture ; un bilan généré manuellement est toujours daté et heuré.
- Un bilan archivé est une photographie : si une correction est faite après coup, un nouveau bilan est généré et l’ancien reste consultable avec la mention « remplacé ».
- Jours fériés et fermetures : pas de bilan automatique les jours de fermeture déclarés, sauf activité.

### 11.2 Rapports multi-boutiques **\[CONFIRMÉ\]**

Bilan de chaque boutique séparément, puis bilan global regroupant toutes les boutiques, avec retour du total à la ventilation.

**\[RECOMMANDÉ\]**

- Le bilan consolidé est la somme exacte des bilans de boutique, à périmètre et période identiques ; un test de recette le vérifie.
- Le stock en transit (7.3) est affiché sur une ligne distincte et compté une seule fois.
- Les dépenses « entreprise » non rattachées à une boutique apparaissent uniquement dans la vue consolidée, sur une ligne à part.
- Rapports exportables en PDF et en CSV, filtrés par période (jour, semaine, mois, personnalisée).

### 11.3 Définitions financières

| Indicateur | Définition |
| --- | --- |
| Chiffre d’affaires net **\[CONFIRMÉ\]** | Ventes validées diminuées des retours/annulations selon la règle retenue. |
| Coût des marchandises vendues **\[CONFIRMÉ\]** | Coût d’achat affecté aux articles réellement vendus, selon une méthode de valorisation à définir (6.5). |
| Marge brute **\[CONFIRMÉ\]** | Chiffre d’affaires net moins coût des marchandises vendues. |
| Dépenses **\[CONFIRMÉ\]** | Charges enregistrées sur la période (5.6). |
| Bénéfice net estimé **\[CONFIRMÉ\]** | Marge brute moins dépenses enregistrées ; reste estimatif si les données sont incomplètes. |
| Créances **\[CONFIRMÉ\]** | Montants dus par les clients et non encore encaissés. |
| Écart de caisse **\[CONFIRMÉ\]** | Montant compté moins solde théorique. |

**Règles confirmées :** les achats de stock ne sont pas soustraits une seconde fois du coût des ventes dans le calcul du bénéfice ; les transferts internes ne constituent pas du chiffre d’affaires.

**Précisions \[RECOMMANDÉ\] :**

- Une annulation ou un retour se déduit à la date de l’opération (et non de la vente d’origine), pour ne pas modifier un bilan déjà arrêté.
- Le chiffre d’affaires est comptabilisé à la validation de la vente (ou à la remise pour une commande en ligne, 8.8), pas à l’encaissement ; les créances sont suivies séparément.
- Le bénéfice affiche la mention « estimé » dès qu’un produit vendu n’a pas de coût d’achat ou qu’une dépense connue n’est pas saisie ; le nombre de produits sans coût est affiché à côté.

## 12. Sécurité, confidentialité et audit

Les permissions sont contrôlées côté serveur à chaque requête, les opérations sensibles sont journalisées sans pouvoir être effacées, et les données personnelles des clients sont protégées.

### 12.1 Sécurité **\[CONFIRMÉ\]**

- Authentification sécurisée et mots de passe hachés.
- Contrôle des permissions côté serveur à chaque requête, pas uniquement par masquage de boutons.
- Chiffrement des échanges réseau et sauvegardes protégées.
- Isolation stricte des données entre marchands et entre boutiques.
- Désactivation d’un compte révoquant son accès sans effacer son historique.
- Accès d’assistance exceptionnel au compte marchand limité, justifié et journalisé (4.1).

**\[RECOMMANDÉ\]**

- Politique de mot de passe minimale, verrouillage temporaire après échecs répétés, expiration de session après inactivité (durée plus courte pour les comptes Agent sur terminal partagé).
- Authentification renforcée (second facteur) facultative pour propriétaires et obligatoire pour Super Admin.
- Liste des appareils et sessions actives, avec déconnexion à distance par le propriétaire.
- Réinitialisation d’un mot de passe Agent par le propriétaire, sans jamais lui montrer l’ancien.
- Protection contre les attaques courantes (injection, CSRF, XSS, abus de requêtes) et revue de sécurité avant mise en production (lot 8).

### 12.2 Journal d’audit **\[CONFIRMÉ\]**

- Journal pour ventes, remboursements, stock, transferts, caisse, permissions et connexions.
- Chaque entrée contient auteur, boutique, date/heure, action, objet, valeurs avant/après et motif lorsque requis.
- Non effaçable par les rôles ordinaires ni par le Super Admin.

**\[RECOMMANDÉ\]** Chaque entrée ajoute l’opérateur déclaré (4.3), l’appareil ou l’adresse IP et un identifiant de corrélation. Le journal est en ajout seul (append-only), avec contrôle d’intégrité, et consultable par le propriétaire pour ses boutiques.

### 12.3 Données personnelles **\[RECOMMANDÉ\]**

La v1.0 ne traite pas la protection des données des clients (nom, téléphone, adresse, historique d’achats), alors que la vitrine en collecte.

- **Cadre légal** : vérifier avec un juriste les obligations de la loi malienne sur la protection des données personnelles et de l’autorité compétente (déclaration, autorisation, transferts délocalisés si l’hébergement est hors du Mali). **\[À ARBITRER\]**
- **Information et consentement** : page de commande avec mention claire de la finalité (traiter la commande), de la boutique responsable et du droit d’accès ; consentement distinct et facultatif pour tout contact commercial ou SMS promotionnel.
- **Répartition des rôles** : le marchand est responsable des données de ses clients ; ShopControl agit comme sous-traitant. Les conditions d’utilisation le précisent.
- **Droits des personnes** : le marchand peut exporter, corriger ou anonymiser les données d’un client sur demande ; l’anonymisation conserve les montants de vente et supprime l’identité, afin de ne pas fausser les bilans ni l’audit.
- **Minimisation** : seules les données utiles à la commande sont demandées ; l’adresse n’est demandée qu’en cas de livraison.
- **Accès** : un Agent n’accède qu’aux clients de sa boutique ; le Super Admin n’accède aux données clients que lors d’un accès d’assistance journalisé.

### 12.4 Durées de conservation **\[À ARBITRER\]**

La v1.0 renvoie les durées de conservation à plus tard. Elles doivent être fixées avant la mise en production, en distinguant :

| Catégorie | Principe proposé |
| --- | --- |
| Transactions (ventes, achats, caisse) | Conservation longue, à aligner sur les obligations comptables et fiscales locales ; jamais supprimées avant l’échéance. |
| Journaux d’audit | Au moins aussi longue que les transactions. |
| Données personnelles clients | Anonymisation après une période d’inactivité à fixer, ou à la demande. |
| Messages | Durée limitée, à fixer. |
| Données d’un marchand résilié | Export proposé pendant une durée fixée, puis suppression ou anonymisation selon contrat. |

## 13. Pages et navigation

Chaque rôle dispose de son espace ; les menus sont filtrés par rôle et permissions, et l’interface ne montre que des données réelles.

### 13.1 Pages par espace

| Espace | Pages à prévoir |
| --- | --- |
| Super Admin **\[CONFIRMÉ\]** | Connexion, tableau de bord, marchands, boutiques, modules, abonnements, paiements, support, annonces, sécurité, paramètres. |
| Propriétaire **\[CONFIRMÉ\]** | Tableau de bord, sélecteur boutique, ventes, produits, catégories, stocks, achats, fournisseurs, clients, finances, caisse, commandes, livraisons, agents, messagerie, notifications, rapports, paramètres. |
| Propriétaire **\[RECOMMANDÉ\]** (ajouts) | **Dépenses** (5.6), **Transferts** (liste, demande, validation, 7), **Import de données** (2.2), **Journal d’audit** (12.2), **Créances** (5.7). |
| Agent **\[CONFIRMÉ\]** | Accueil, ventes, produits/catalogue, stock, commandes, clients, caisse, historique, messagerie, notifications, profil. |
| Agent **\[RECOMMANDÉ\]** (ajouts) | **Transferts** (création de demande, expédition, réception), **Dépenses** (si droit accordé), choix de l’opérateur déclaré (4.3). |
| Client **\[CONFIRMÉ\]** | Accueil boutique, catalogue, recherche, fiche produit, panier, validation, confirmation, suivi, contact, connexion/inscription facultative. |
| Commun **\[CONFIRMÉ\]** | Écrans de chargement, erreur, accès refusé, état vide, confirmation, centre de notifications. |

### 13.2 Comportement de l’interface **\[CONFIRMÉ\]**

- Responsive sur ordinateur, tablette et téléphone.
- Barre latérale repliable : icônes seules ou icônes avec libellés.
- En-tête avec logo/nom, recherche, notifications et profil.
- Sélecteur de boutique visible pour le propriétaire.
- Menus filtrés selon le rôle et les permissions.
- Listes paginées avec recherche et filtres pertinents.
- Formulaires courts et adaptés à l’utilisation en boutique.
- Confirmation des opérations à fort impact ; jamais de succès annoncé avant enregistrement serveur.
- État vide explicite, erreurs compréhensibles et données réelles uniquement.

**\[RECOMMANDÉ\]**

- L’écran de vente est conçu pour la rapidité au comptoir : recherche et lecture de code-barres, quantités au clavier, validation en peu d’actions.
- Indicateur de connexion visible en permanence et message clair si une opération n’a pas pu être enregistrée (14.3).
- Interface et vitrine en français ; autres langues prévues par la configuration régionale (14.4).

## 14. Exigences techniques et non fonctionnelles

La v1.0 exprime ses exigences techniques sans valeur mesurable (« réactif », « rapidement ») ; la colonne de droite propose des objectifs chiffrés, à valider.

### 14.1 Exigences et objectifs mesurables

| Domaine | Exigence (v1.0) **\[CONFIRMÉ\]** | Objectif mesurable **\[RECOMMANDÉ\]** |
| --- | --- | --- |
| Architecture | SaaS multi-tenant, séparation des données marchands/boutiques | Test automatisé d’isolation : aucune requête d’un compte ne renvoie de donnée d’une autre boutique/entreprise |
| Performance | Pages réactives, pagination, optimisation images et requêtes | Vitrine utilisable en moins de 3 s sur mobile en 3G/4G moyenne ; page initiale ≤ 1 Mo hors images ; réponse serveur des actions courantes < 500 ms (95e centile) ; validation d’une vente < 1 s (95e centile) |
| Compatibilité | Navigateurs modernes, téléphone et tablette, parcours prioritaires testés sur Android | Deux dernières versions majeures de Chrome, Firefox, Edge, Safari ; Chrome sur Android pour les parcours Vente, Commande, Caisse ; version minimale d’Android à fixer |
| Temps réel | Messages, commandes et alertes actualisés rapidement, avec repli | Nouvelle commande ou message visible en moins de 5 s ; repli par interrogation régulière (15 à 30 s) si la connexion temps réel échoue |
| Disponibilité | Surveillance, alertes techniques, procédure de reprise | 99,5 % de disponibilité mensuelle (soit environ 3,6 h d’indisponibilité au maximum par mois), hors maintenance annoncée |
| Sauvegardes | Régulières, chiffrées, testées | Voir 14.2 |
| Sécurité | Contrôle d’accès serveur, secrets, mises à jour, protection contre les abus | Aucune faille critique ou haute non corrigée à la mise en production ; correctifs de sécurité appliqués dans un délai fixé |
| Évolutivité | Ajout de marchands, boutiques et modules sans mélange de données | Dimensionnement cible (marchands, boutiques, ventes par jour) **à fournir par le commanditaire** avant l’architecture |
| Paramètres régionaux | Devise, fuseau horaire, dates et langue configurables ; XOF à confirmer | Voir 14.4 |
| Images | Optimisation | Compression automatique, format moderne, taille d’envoi limitée (par exemple 5 Mo par image) |

### 14.2 Sauvegardes et reprise **\[RECOMMANDÉ\]**

- **RPO** (perte de données maximale admise) : 1 heure.
- **RTO** (durée maximale de remise en service) : 4 heures.
- Sauvegardes chiffrées, stockées dans un lieu distinct de la production.
- Test de restauration complet au moins une fois par trimestre, avec compte rendu ; un premier test avant la mise en production.
- Procédure de reprise écrite et responsables désignés.

### 14.3 Fonctionnement hors connexion **\[À ARBITRER\]**

Le hors-ligne complet n’est pas validé dans la v1.0. Or une connexion instable est un risque majeur pour la vente au comptoir ; ce choix conditionne l’architecture et doit donc être tranché avant le lot 1.

| Option | Contenu | Conséquences |
| --- | --- | --- |
| A. En ligne uniquement | Aucune opération sans réseau | Le plus simple ; la boutique est bloquée si le réseau tombe |
| B. Mode dégradé comptoir (recommandé) | Application installable ; catalogue et stock consultables depuis le cache ; ventes comptoir enregistrées localement puis synchronisées | Numérotation par plages réservées (10.1), identifiants générés côté appareil, synchronisation rejouable sans doublon, règle de conflit de stock |
| C. Hors-ligne complet | Toutes les fonctions | Coûteux et risqué : conflits nombreux ; non recommandé en version 1 |

Règles minimales si l’option B est retenue :

- Seules les ventes comptoir, la consultation et la caisse sont possibles hors réseau ; transferts, annulations, remboursements, corrections de stock et changement de permissions exigent une connexion.
- Une vente synchronisée dont le stock est devenu insuffisant n’est pas rejetée : elle est acceptée avec un stock négatif signalé au propriétaire pour régularisation.
- Les ventes en attente de synchronisation sont visibles et comptées séparément tant qu’elles ne sont pas confirmées par le serveur (en cohérence avec la règle « jamais de succès annoncé avant enregistrement serveur », 13.2, qui doit être adaptée en « enregistré localement, en attente de synchronisation »).

### 14.4 Paramètres régionaux **\[RECOMMANDÉ\]**

- Devise par défaut : XOF (**à confirmer**), sans décimales ; format d’affichage à définir (par exemple espace comme séparateur de milliers).
- Fuseau horaire par boutique, par défaut Africa/Bamako ; toutes les dates sont stockées en UTC et affichées dans le fuseau de la boutique.
- Langue de l’interface : français en version 1 ; textes externalisés pour permettre d’autres langues.

### 14.5 Impression **\[CONFIRMÉ\]**

L’impression thermique dépend du terminal, du navigateur, du système et du modèle d’imprimante ; la compatibilité doit être testée et ne peut pas être garantie universellement (10.2).

## 15. Parcours utilisateurs de référence

Quatre parcours servent de fil conducteur aux tests de recette ; les étapes ajoutées par cette version sont marquées **\[RECOMMANDÉ\]**.

### 15.1 Vente au comptoir

1. L’Agent ouvre Ventes, ajoute les produits et quantités.
2. **\[RECOMMANDÉ\]** Une session de caisse est ouverte et l’opérateur déclaré est identifié.
3. Le système vérifie le stock et calcule le total (remise, taxes, arrondi).
4. L’Agent choisit le paiement (avec référence pour Mobile Money) et valide.
5. Stock et caisse sont mis à jour dans une seule transaction.
6. Le ticket est généré, imprimé ou partagé.
7. La vente figure dans l’historique et le bilan.

### 15.2 Commande par QR

1. Le client scanne le QR de la boutique et la vitrine propre à cette boutique s’ouvre.
2. Il choisit les produits, les ajoute au panier, choisit livraison ou retrait, renseigne les informations et envoie, sans compte.
3. **\[RECOMMANDÉ\]** Il reçoit une référence et un lien de suivi secret (8.6).
4. La boutique reçoit la commande ; l’Agent vérifie, contacte, confirme (le stock est réservé) et prépare.
5. **\[RECOMMANDÉ\]** À la remise, l’Agent enregistre le paiement ; la commande devient une vente avec ticket et sortie de stock (8.8).
6. Le client suit l’état de sa commande jusqu’à livraison ou retrait.

### 15.3 Transfert

1. L’Agent prépare une demande de transfert.
2. Le propriétaire reçoit la notification et valide ou refuse (motif obligatoire en cas de refus).
3. Après validation, l’Agent reçoit l’autorisation.
4. L’Agent expédie : le stock source diminue, la quantité passe en transit (7.3).
5. La boutique destinataire confirme les quantités reçues ; son stock est crédité.
6. Les écarts éventuels sont tracés et notifiés au propriétaire.

### 15.4 Clôture et bilan

1. L’Agent autorisé clôture la caisse et saisit le comptage réel.
2. Le système affiche le solde théorique et l’écart.
3. La clôture est enregistrée et le propriétaire est notifié si nécessaire (écart ou anomalie).
4. À l’heure configurée, le bilan journalier de la boutique est calculé (provisoire si la caisse n’est pas clôturée, 11.1).
5. Le propriétaire consulte le bilan de cette boutique ou le total consolidé.

## 16. Critères de recette

La recette comprend les 15 critères de la v1.0, conservés tels quels, et 16 critères ajoutés pour couvrir les cas limites que la v1.0 laissait sans test.

### 16.1 Critères conservés de la v1.0 **\[CONFIRMÉ\]**

1. Un Agent de la boutique A ne peut accéder à aucune donnée privée de la boutique B.
2. Le propriétaire consulte chaque boutique et la vue consolidée.
3. Une vente validée décrémente le stock et apparaît dans les rapports.
4. Une commande fournisseur n’augmente le stock qu’à la réception.
5. Un transfert non validé ne peut pas être expédié.
6. Le QR code de chaque boutique ouvre uniquement sa vitrine.
7. Les modifications du catalogue apparaissent sans recréer le QR code.
8. Un client peut commander sans créer de compte.
9. Le propriétaire peut contacter un Agent et un client, même sans Agent dans une boutique.
10. Un Agent peut échanger avec les clients de sa boutique.
11. Chaque vente validée génère un justificatif réimprimable.
12. Le bilan par boutique et le bilan consolidé affichent des chiffres cohérents.
13. Les bénéfices sont identifiés comme estimés si les coûts ou dépenses sont incomplets.
14. Les opérations sensibles sont journalisées et non effaçables par les rôles ordinaires.
15. Les notifications dirigent l’utilisateur vers la bonne page sans contourner les permissions.

### 16.2 Critères ajoutés **\[RECOMMANDÉ\]**

| N° | Critère | Section | Lot |
| --- | --- | --- | --- |
| 16 | Une requête directe à l’API d’un Agent de la boutique A sur une ressource de la boutique B est refusée par le serveur, même si le bouton est masqué. | 12.1 | 1 |
| 17 | Deux ventes simultanées sur le dernier article : l’une est validée, l’autre refusée avec le stock restant affiché ; le stock ne devient jamais négatif en mode en ligne. | 6.4 | 2 |
| 18 | Une commande confirmée réserve le stock (absent de la vitrine) ; refus, annulation ou expiration libèrent la réservation. | 6.4, 8.7 | 5 |
| 19 | Une commande n’est pas du chiffre d’affaires ; à la remise, elle crée une vente avec ticket, sortie de stock et mouvement de caisse. | 8.8 | 5 |
| 20 | À l’expédition d’un transfert, le stock source diminue et la quantité est en transit ; à la réception, la destination est créditée de la quantité reçue ; un écart est tracé et notifié ; le bilan consolidé ne compte jamais deux fois. | 7.3, 11.2 | 4 |
| 21 | La clôture de caisse avec écart affiche l’écart, notifie le propriétaire et n’est plus modifiable ; une erreur se corrige par régularisation motivée. | 5.5 | 2 |
| 22 | Une annulation exige un motif ; un retour réintègre le stock uniquement si le produit est revendable ; un remboursement ne dépasse pas la vente d’origine. | 5.4 | 2 |
| 23 | Tous les montants en XOF sont des entiers ; la somme des lignes égale le total ; tout arrondi apparaît sur une ligne tracée. | 5.3 | 2 |
| 24 | Un paiement Mobile Money sans référence est refusé (si l’obligation est active) ; une référence en doublon est refusée. | 5.2 | 2 |
| 25 | La numérotation des justificatifs est sans trou ni doublon ; un justificatif annulé reste dans la série ; une réimpression porte « DUPLICATA ». | 10.1 | 3 |
| 26 | Les journaux des opérations sensibles contiennent le compte et l’opérateur déclaré. | 4.3, 12.2 | 1–2 |
| 27 | Le suivi par référence et téléphone est limité après des échecs répétés ; il n’affiche jamais l’adresse complète ni la conversation ; le lien secret donne accès à la commande concernée uniquement. | 8.6 | 5 |
| 28 | Les limites anti-abus de la vitrine (commandes par téléphone/IP, numéros bloqués) bloquent les commandes en excès. | 8.10 | 5 |
| 29 | Une boutique suspendue affiche une vitrine indisponible, refuse toute commande, passe en lecture seule pour le back-office et conserve toutes ses données. | 3.3 | 7 |
| 30 | Les objectifs de performance de 14.1 sont atteints sur un terminal Android représentatif en 3G/4G moyenne. | 14.1 | 8 |
| 31 | Une sauvegarde est restaurée avec succès dans le RTO et la perte de données respecte le RPO (14.2). | 14.2 | 8 |

## 17. Points à arbitrer avant développement

Seize sujets restent ouverts ; les cinq premiers bloquent le lot 1 ou 2 et doivent être tranchés en priorité. Les recommandations ci-dessous ne sont pas des décisions.

| N° | Sujet | Décision à prendre | Recommandation | Bloque le lot |
| --- | --- | --- | --- | --- |
| 1 | Hors-ligne (14.3) | Fonctions utilisables sans réseau et règle de conflit | Option B : mode dégradé comptoir | 1 |
| 2 | Dimensionnement cible (14.1) | Nombre de marchands, boutiques, ventes par jour attendus | À fournir par le commanditaire | 1 |
| 3 | Associés et gérants (4.2) | Un ou plusieurs propriétaires ; rôle Gérant | Propriétaire unique en version 1 ; Gérant ensuite | 1 |
| 4 | Devise et fuseau (14.4) | Confirmer XOF par défaut ; fuseau, jours fériés, règle du bilan | XOF ; Africa/Bamako ; règles de 11.1 | 1–2 |
| 5 | Valorisation du stock (6.5) | FIFO, coût moyen pondéré ou autre | Coût moyen pondéré | 2 |
| 6 | Taxes et prix (5.3) | Taux, TTC ou HT, traitement des frais de livraison | À valider avec un conseil fiscal local | 2 |
| 7 | Fiscalité des justificatifs (10.3) | Mentions obligatoires et conformité des factures au Mali | Intitulé « ticket / justificatif » jusqu’à validation | 3 |
| 8 | Imprimantes (10.2) | Modèles et protocoles pris en charge | Liste restreinte de modèles 58 mm et 80 mm testés ; repli par impression navigateur | 3 |
| 9 | Délégation des transferts (7.1) | Approbation exclusive du propriétaire ou délégable | Propriétaire seul en version 1 | 4 |
| 10 | Dépenses d’entreprise (5.6) | Imputation à une boutique ou vue consolidée seule | Ligne « entreprise » dans la vue consolidée | 4 |
| 11 | Nom de domaine (8.1) | Domaine final, format de l’URL, domaines personnalisés | Slug stable avec redirection ; domaines personnalisés ensuite | 5 |
| 12 | Suivi sans compte (8.6) | Méthode de vérification et de récupération | Lien secret + téléphone avec limitation d’essais ; code SMS en option | 5 |
| 13 | Messagerie : pièces jointes (9.1) | Photos, documents, notes vocales | Photos seulement, si retenues | 6 |
| 14 | Notifications externes (9.2) | Fournisseurs, coûts, consentement, événements SMS/e-mail/push | Application + e-mail en version 1 ; SMS et push ensuite | 6 |
| 15 | Abonnements (3.3) | Offres, prix, limites de boutiques, modules, délai de grâce et effets d’un impayé | Cascade de statuts de 3.3 | 7 |
| 16 | Données personnelles et conservation (12.3, 12.4) | Obligations légales, durées de conservation, anonymisation | Avis juridique avant la mise en production | 1 à 8 |

Le paiement en ligne (passerelle ou API) n’est pas un point bloquant : il est **maintenu en paiement manuel au lancement**, avec réexamen après la première version. Si le commanditaire souhaite une passerelle dès le lancement, cela ajoute un lot (choix du prestataire, intégration, réconciliation, frais) et doit être décidé avant le lot 2.

## 18. Découpage de réalisation

Les huit lots de la v1.0 sont conservés ; trois ajustements corrigent leurs dépendances : un Super Admin minimal dès le lot 1, l’import de données au lot 2 et des notifications de base au lot 5.

### 18.1 Lots révisés

| Lot | Contenu | Livrable | Prérequis |
| --- | --- | --- | --- |
| 1 — Fondations | Authentification, entreprise, boutiques, rôles, permissions, cloisonnement ; **\[RECOMMANDÉ\]** Super Admin minimal (création et suspension de marchands et boutiques) ; opérateur déclaré ; journal d’audit de base | Socle multi-boutiques sécurisé, marchands créables | Arbitrages 1 à 4 et 16 |
| 2 — Gestion commerciale | Produits, stocks, achats, ventes, fournisseurs, clients, caisse ; **\[RECOMMANDÉ\]** dépenses, créances, taxes et arrondis, import CSV | Opérations de boutique | Lot 1 ; arbitrages 5 et 6 |
| 3 — Documents | Tickets, PDF, numérotation, impression et historique | Facturation / justificatifs | Lot 2 ; arbitrages 7 et 8 |
| 4 — Multi-boutiques | Transferts avec validation du propriétaire, rapports par boutique et consolidés, bilan journalier | Supervision multi-sites | Lots 2 et 3 ; arbitrages 9 et 10 |
| 5 — E-commerce | Vitrines, QR codes, catalogue, panier, commandes, livraison/retrait, réservation de stock, suivi sécurisé, anti-abus ; **\[RECOMMANDÉ\]** notifications de base (nouvelle commande, alertes) | Prise de commande publique | Lots 2 et 3 ; arbitrages 11 et 12 |
| 6 — Communication | Messagerie, attribution, notifications et alertes complètes | Communication intégrée | Lot 5 ; arbitrages 13 et 14 |
| 7 — Administration | Abonnements, modules, paiements de plateforme, support, annonces, sécurité avancée | Gestion de plateforme complète | Lot 1 ; arbitrage 15 |
| 8 — Recette | Tests fonctionnels, sécurité, performance, sauvegardes, mobile, imprimantes | Version prête au déploiement | Lots 1 à 7 |

### 18.2 Principes de réalisation **\[RECOMMANDÉ\]**

- **Tests continus** : le critère de recette lié à un lot (colonne « Lot » de 16.2) est vérifié à la fin de ce lot, et non seulement au lot 8. Le lot 8 est une recette d’ensemble.
- **Test pilote** : avant le déploiement général, une boutique réelle utilise le système en parallèle de son processus actuel pendant une période convenue.
- **Pas de déploiement réel avant le lot 1 complet** (création des marchands) ni avant l’avis juridique sur les données personnelles (arbitrage 16).

### 18.3 Règle de validation **\[CONFIRMÉ\]**

Les exigences confirmées constituent la base fonctionnelle. Les points à arbitrer doivent être décidés avant leur développement. Les recommandations techniques doivent être validées dans le dossier d’architecture.

## Annexe — Journal des corrections par rapport à la v1.0

Vingt-deux corrections ont été apportées ; aucune décision confirmée de la v1.0 n’a été modifiée.

| N° | Problème constaté dans la v1.0 | Correction | Section |
| --- | --- | --- | --- |
| 1 | Version « consolidée » mais plusieurs points ouverts bloquent des lots | Points ouverts classés par lot bloqué avec recommandation ; statuts étiquetés dans tout le document | 17 ; légende |
| 2 | Compte Agent partagé alors que les journaux exigent un auteur | Opérateur déclaré et PIN facultatif | 4.3, 12.2 |
| 3 | Session de caisse liée à un compte partagé non précisée | Session rattachée à la boutique, une seule ouverte par caisse, passation | 5.5 |
| 4 | « Stock source diminué selon la règle définie » : règle absente | Décrément à l’expédition, stock en transit, crédit à la réception, écarts | 7.2, 7.3 |
| 5 | Concurrence du stock non traitée | Validation transactionnelle | 5.1, 6.4 |
| 6 | Commande en ligne sans règle de réservation | Stock réservé à la confirmation, libéré au refus, à l’annulation ou à l’expiration | 6.4 |
| 7 | Statuts de commande non listés | Neuf statuts, déclencheurs et effets sur le stock | 8.7 |
| 8 | Passage commande → vente non décrit | Vente créée à la remise, paiement, ticket, stock, caisse | 8.8 |
| 9 | Suivi sans compte exposé à l’usurpation | Lien secret, limitation d’essais, données minimales | 8.6 |
| 10 | Aucune protection contre les abus de la vitrine publique | Limitation de débit, anti-robot, plafonds, blocage de numéros | 8.10 |
| 11 | Prix, remises, taxes et arrondis non définis | Règles XOF sans décimales, plafond de remise, TTC/HT | 5.3 |
| 12 | Dépenses : ni page ni catégories alors qu’elles entrent dans le bénéfice | Module dépenses | 5.6, 13.1 |
| 13 | Créances et dettes : règlement, plafond et rappels absents | Encaissement ultérieur, plafond de crédit, liste d’ancienneté | 5.7 |
| 14 | Mobile Money enregistré manuellement sans contrôle | Référence de transaction obligatoire et unique | 5.2 |
| 15 | Suspension prévue sans effets définis | Cascade actif / impayé / suspendu / résilié | 3.3 |
| 16 | Données personnelles, consentement et conservation absents | Section dédiée et tableau de conservation | 12.3, 12.4 |
| 17 | Import de données existantes absent | Import CSV avec aperçu et rapport d’erreurs | 2.2, 18.1 |
| 18 | Propriétaires multiples et gérants non traités | Point à arbitrer avec recommandation | 4.2, 17 |
| 19 | Hors-ligne « non validé » malgré un réseau potentiellement instable | Trois options comparées, décision exigée avant le lot 1 | 14.3 |
| 20 | Exigences non fonctionnelles non mesurables | Objectifs chiffrés, RPO et RTO | 14.1, 14.2 |
| 21 | Accès exceptionnel du Super Admin sans durée ni notification | Durée limitée, lecture seule par défaut, marchand notifié | 4.1 |
| 22 | Lot Super Admin trop tardif ; dépendances des lots 3 et 5 | Super Admin minimal au lot 1 ; import au lot 2 ; notifications de base au lot 5 | 18.1 |

Autres ajustements : critères de recette ajoutés (16.2) ; numérotation des justificatifs et mention « Duplicata » (10.1) ; règles de déclenchement du bilan journalier (11.1) ; précisions des définitions financières (11.3).
