#!/usr/bin/env bash
set -e

cd /opt/shopcontrol

echo "=========================================="
echo "  Mise à jour ShopControl Contabo VPS"
echo "=========================================="

echo "[1/3] Récupération de la dernière version Git..."
git pull origin main

echo "[2/3] Compilation du service shopcontrol_app..."
docker compose -f docker-compose.contabo.yml build shopcontrol_app

echo "[3/3] Redémarrage en tâche de fond..."
docker compose -f docker-compose.contabo.yml up -d

echo "=========================================="
echo "✅ Mise à jour terminée avec succès !"
echo "=========================================="
docker compose -f docker-compose.contabo.yml ps
