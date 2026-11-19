# ShopControl — Plateforme SaaS Multi-Boutiques

Plateforme web SaaS de gestion commerciale multi-boutiques avec **isolation physique par base de données PostgreSQL dédiée par boutique**, journal d'audit immuable (chaîné SHA-256 + trigger PostgreSQL) et socle PWA/mode dégradé comptoir (Option B).

## Architecture (Lots 1 & 2 — Fondations & Gestion commerciale)

- **Monorepo TypeScript (`npm workspaces`)**
  - `packages/shared` (`@shopcontrol/shared`) : enums, catalogue de permissions granulaires, moteur de calcul XOF/taxes/arrondis & CMP, schémas de validation Zod, formateurs `Africa/Bamako`.
  - `apps/api` (`@shopcontrol/api`) : NestJS 11, Prisma 6 **double schéma** (`control` + `shop`), provisionnement dynamique de base PostgreSQL par boutique (`CREATE DATABASE shopcontrol_shop_<id>` + migrations SQL versionnées), Redis 7, Argon2id, 2FA TOTP, Swagger `/api/docs`.
    - **Lot 1** : Auth/2FA/Sessions, Super Admin minimal + accès support borné, Marchands, Boutiques + redirections slugs, Agents/RBAC, Opérateurs déclarés, Terminaux Option B, Audit immuable chaîné SHA-256, Notifications.
    - **Lot 2** : Catégories & Produits (coûts masqués si Agent non autorisé), Stocks & Mouvements immuables (`SELECT ... FOR UPDATE`), Inventaire physique, Fournisseurs & Achats (réceptions partielles + recalcul CMP + dettes), Clients & Créances (plafonds crédit), Caisse (sessions uniques, passations, clôture immuable + écart notifié + régularisation), Ventes POS (XOF entiers, Mobile Money réf unique, sync hors-ligne Option B, annulation/retour/remboursement), Dépenses (boutique + entreprise consolidée), Import CSV (aperçu, erreurs ligne par ligne, commit, rollback).
  - `apps/web` (`@shopcontrol/web`) : Next.js 15 (App Router, 26 routes), Tailwind CSS, PWA (`manifest.json` + Service Worker), IndexedDB (`dexie` — cache catalogue + file de ventes comptoir hors-ligne).

### Isolation Multi-Bases (1 Control Plane DB + 1 BDD dédiée par boutique)

1. **`shopcontrol_control`** (`apps/api/prisma/control/schema.prisma`) : marchands, boutiques (métadonnées + nom de base `db_name`), redirections de slug, comptes utilisateurs, accès boutiques/permissions, sessions, mandats d'accès support, notifications, audit plateforme immuable (`audit_logs`).
2. **`shopcontrol_shop_<shortId>`** (`apps/api/prisma/shop/schema.prisma`) : provisionnée et migrée automatiquement à chaque création de boutique ; contient exclusivement les données opérationnelles de cette boutique (configuration locale, opérateurs déclarés, terminaux comptoir, plages de tickets hors-ligne, idempotence, journal d'audit boutique immuable `shop_audit_logs`).

## Prérequis

- Node.js ≥ 20 (`npm` ≥ 10)
- Docker Desktop (pour PostgreSQL 16, Redis 7 et Mailpit)

## Installation & Lancement local

1. **Configurer les variables d'environnement :**
   ```powershell
   Copy-Item .env.example .env
   ```
   Ajuster au besoin les identifiants de bootstrap dans `.env` (ne jamais committer `.env`).

2. **Installer les dépendances :**
   ```powershell
   npm install
   ```

3. **Démarrer PostgreSQL 16, Redis 7 et Mailpit :**
   ```powershell
   docker compose up -d
   ```

4. **Générer les clients Prisma (Control + Shop), appliquer les migrations et créer le Super Admin initial :**
   ```powershell
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   ```
   *(Pour migrer ultérieurement toutes les bases boutiques existantes après une évolution du schéma `prisma/shop/schema.prisma` : `npm run db:migrate:shops`.)*

5. **Lancer l'API et le Frontend en développement :**
   ```powershell
   npm run dev
   ```
   - Frontend : `http://localhost:3000`
   - API REST : `http://localhost:4000/api/v1`
   - Documentation Swagger : `http://localhost:4000/api/docs`
   - Mailpit (emails dev) : `http://localhost:8025`

## Vérification, Build & Tests

```powershell
# Typage et compilation complète (shared + api + web)
npm run typecheck
npm run build

# Tests unitaires (shared + api)
npm run test

# Tests d'intégration / Recette Lot 1 (Critères #1, #2, #14, #16, #26, #29 + isolation BDD)
npm run test:e2e
```
