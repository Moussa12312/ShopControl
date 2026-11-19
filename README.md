# ShopControl — Plateforme SaaS Multi-Boutiques & E-commerce QR (Lots 1 à 11)

Plateforme web SaaS complète de gestion commerciale multi-boutiques et d’e-commerce par QR code, bâtie avec une **isolation physique par base de données PostgreSQL dédiée par boutique**, un journal d’audit immuable chaîné SHA-256, des profils métiers multi-secteurs (Mode, Boutique de quartier / Alimentation, Cosmétique, Électronique, Commerce général), des tickets thermiques 58/80 mm & PDF, des transferts inter-boutiques supervisés et un comptoir PWA résilient hors-ligne (Option B).

## Architecture Complète (Lots 1 à 11)

- **Monorepo TypeScript (`npm workspaces`)**
  - `packages/shared` (`@shopcontrol/shared`) : enums, permissions granulaires, profils métiers & presets multi-secteurs (`SHOP_TYPE_PRESETS`), calculateur XOF entier / TVA / arrondis / CMP, schémas Zod complets (Lots 1 à 11), formateurs `Africa/Bamako`.
  - `apps/api` (`@shopcontrol/api`) : NestJS 11, Prisma 6 **double schéma** (`control` + `shop`), provisionnement dynamique de BDD PostgreSQL dédiée (`CREATE DATABASE shopcontrol_shop_<id>` + migrations versionnées), Argon2id, 2FA TOTP, `pdfkit`, `qrcode`, Swagger `/api/docs`.
    - **Lot 1 — Fondations** : Auth/2FA/Sessions, Super Admin minimal + accès support borné, Marchands, Boutiques + redirections slugs, Agents/RBAC, Opérateurs déclarés, Terminaux Option B, Audit immuable chaîné SHA-256, Notifications.
    - **Lot 2 — Gestion Commerciale** : Catégories & Produits (avec upload multi-photos jusqu’à 10 images), Stocks immuables (`SELECT ... FOR UPDATE`), Inventaire physique, Fournisseurs & Achats (réceptions partielles + CMP), Clients & Créances (dettes directes & crédit POS), Caisse (sessions, passations, clôture & écarts), Ventes POS (XOF entiers, Mobile Money réf unique, sync hors-ligne, annulation, retour, remboursement déduit du CA net), Dépenses (boutique + entreprise), Import CSV.
    - **Lot 3 — Documents & Tickets** : Numérotation séquentielle `VTE-*` et avoirs `AV-*`, snapshots immuables, 1re impression vs `DUPLICATA`, mention `ANNULÉ`, impression thermique 58/80 mm, téléchargement PDF (`pdfkit`) avec logo boutique, partage WhatsApp.
    - **Lot 4 — Multi-Boutiques** : Transferts de stock avec validation Propriétaire obligatoire (`PENDING_APPROVAL` → `APPROVED`/`REJECTED` → `IN_TRANSIT` → `RECEIVED`/`RECEIVED_WITH_DISCREPANCY`), bilan consolidé exact avec dépenses entreprise distinctes et stock en transit compté une seule fois, bilans journaliers archivés & versionnés (`PROVISIONAL`/`FINAL`/`SUPERSEDED`), exports CSV & PDF.
    - **Lot 5 — E-commerce par QR** : QR code permanent (PNG HD / SVG / affiche imprimable), vitrine publique temps réel `/s/[slug]` avec logo, galerie photos & stock disponible (`physique - réservé`), commande client sans compte + compte client optionnel, retrait ou livraison + frais, workflow 9 statuts, réservation/libération atomique de stock, conversion en Vente + Ticket + Caisse, suivi sécurisé `/s/[slug]/track`.
    - **Lot 6 — Communication** : Messagerie unifiée (`Propriétaire ↔ Agent`, `Boutique ↔ Client` même avec 0 agent, `Super Admin ↔ Propriétaire`), assignation à un agent, pièces jointes photo, filtrage liens suspects sur le chat public vitrine, notifications deep-link.
    - **Lot 7 — Administration Plateforme** : Abonnements & modules activés par marchand, journal paiements plateforme (avec réactivation auto si impayé), tickets support Propriétaire ↔ Super Admin, annonces de service globales.
    - **Lot 8 — Profils Métiers Multi-Secteurs** : Type de boutique (`FASHION`, `GROCERY`, `COSMETICS`, `ELECTRONICS`, `GENERAL`) + `businessProfile` personnalisable à la carte par boutique ; formulaire produit adaptatif et création 1 clic des catégories suggérées du secteur.
    - **Lot 9 — Opérations Boutique de Quartier & Alimentation** : Conditionnement **Gros ↔ Détail** (`bulkUnitLabel`, `unitsPerBulk`, `bulkSalePriceXof`) en réception fournisseur (`receivedInBulk`), vente POS (`soldInBulk`) et vitrine publique avec conversion automatique en unités de base & CMP ; **Vente au montant / fraction** (ex. *« 250 FCFA de sucre »*) avec suivi exact au millième d’unité (`fractionalRemainderMilli`) sans dérive flottante ; **POS Express** (barre Favoris 1 clic, scanner code-barres caméra/USB, bouton 1 clic *« Mettre en dette »*).
    - **Lot 10 — Péremptions (DLC FEFO) & Garantie / IMEI** : Lots datés (`ProductBatch`) avec déduction automatique **FEFO** (*First Expired, First Out*), alertes DLC (Périmés / ≤ 7j / ≤ 30j) et mise au rebut atomique en perte (`POST /shops/:shopId/stock/batches/:batchId/write-off`) ; suivi **Numéro de série / IMEI** obligatoire + durée de garantie imprimée sur ticket thermique & PDF + recherche SAV par IMEI (`GET /shops/:shopId/sales?serial=...`).
    - **Lot 11 — Vitrines QR Adaptatives** : 3 dispositions publiques automatiques selon le secteur (`GALLERY` Lookbook avec filtres Tailles/Couleurs & carrousel 10 photos ; `QUICK_LIST` Épicerie Express avec boutons `- / +` directs, sélecteur Détail/Carton et bouton *« Recommander »* en 1 clic ; `TECH_SPEC` Catalogue Technique avec badges Marque/Modèle/Garantie et question rapide).
  - `apps/web` (`@shopcontrol/web`) : Next.js 15 App Router (33+ routes), Tailwind CSS (design **Obsidian Emerald & Porcelain** plein écran & responsive mobile), PWA (`manifest.json` + Service Worker), IndexedDB (`dexie`), compression photo client avant upload (`ImageUploader`).

### Isolation Multi-Bases (1 Control Plane DB + 1 BDD dédiée par boutique)

1. **`shopcontrol_control`** (`apps/api/prisma/control/schema.prisma`) : marchands, boutiques (`logo_url`, `delivery_config`, `receipt_settings`, `db_name`), redirections de slug, utilisateurs, accès & permissions, sessions, mandats support, notifications, dépenses entreprise, transferts inter-boutiques, messagerie, abonnements, paiements plateforme, tickets support, annonces, audit plateforme immuable.
2. **`shopcontrol_shop_<shortId>`** (`apps/api/prisma/shop/schema.prisma`) : provisionnée et migrée automatiquement à chaque création de boutique ; contient exclusivement les données de cette boutique (produits, stocks, achats, ventes, retours, remboursements, documents tickets/avoirs, caisses, clients/créances, dépenses boutique, bilans journaliers, commandes en ligne, numéros bloqués, audit boutique immuable).

## Prérequis

- Node.js ≥ 20 (`npm` ≥ 10)
- PostgreSQL 16+ (local ou Docker)

## Installation & Lancement local

1. **Configurer les variables d’environnement :**
   ```powershell
   Copy-Item .env.example .env
   ```
2. **Installer les dépendances :**
   ```powershell
   npm install
   ```
3. **Générer les clients Prisma, appliquer les migrations (Control + Boutiques) et créer le Super Admin :**
   ```powershell
   npm run db:generate
   npm run db:migrate
   npm run db:migrate:shops
   npm run db:seed
   ```
4. **Build & Lancement :**
   ```powershell
   npm run build
   npm run start --workspace=apps/api
   npm run start --workspace=apps/web
   ```
   - Frontend : `http://localhost:3000`
   - API REST : `http://localhost:4000/api/v1`
   - Documentation Swagger : `http://localhost:4000/api/docs`

## Vérification & Tests

```powershell
# Typage et compilation complète (shared + api + web)
npm run typecheck
npm run build

# Tests unitaires (shared + api)
npm run test

# Recette complète E2E (Lots 1 à 7 — 18/18 tests)
npm run test:e2e
```
