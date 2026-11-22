#!/bin/sh
set -e

echo "============================================================"
echo "  Démarrage ShopControl (16 Go RAM — API + Web Unifiés)"
echo "============================================================"

cd /app/apps/api

echo "[1/4] Application des migrations Control Plane sur Neon PostgreSQL..."
npx prisma migrate deploy --schema=prisma/control/schema.prisma || echo "Avertissement: migration control ignorée"

echo "[2/4] Vérification du Super Admin initial..."
node dist/prisma/control/seed.js || echo "Avertissement: seed ignoré"

echo "[3/4] Migration des bases de données boutiques..."
node dist/prisma/shop/migrate-all-shops.js || echo "Avertissement: migration shops ignorée"

echo "[4/4] Lancement de l'API NestJS (port 4000) et du serveur Web Next.js (port 7860)..."
node dist/src/main.js &

cd /app/apps/web
exec npx next start -H 0.0.0.0 -p "${PORT:-7860}"
