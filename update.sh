#!/usr/bin/env bash
set -e

cd /opt/shopcontrol

echo "=========================================="
echo "  Mise à jour ShopControl Contabo VPS"
echo "=========================================="

echo "[1/4] Récupération de la dernière version Git..."
git pull origin main

echo "[2/4] Compilation du service shopcontrol_app..."
docker compose -f docker-compose.contabo.yml build shopcontrol_app

echo "[3/4] Redémarrage en tâche de fond..."
docker compose -f docker-compose.contabo.yml up -d

echo "[4/4] Reconnexion au réseau Nginx & Rechargement du proxy..."
UNISPHERE_NET=$(docker inspect unisphere_nginx --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null | head -n1 || true)
if [ -n "$UNISPHERE_NET" ]; then
  docker network connect "$UNISPHERE_NET" shopcontrol_app 2>/dev/null || true
  docker exec unisphere_nginx nginx -s reload 2>/dev/null || true
fi

echo "=========================================="
echo "✅ Mise à jour terminée avec succès !"
echo "=========================================="
docker compose -f docker-compose.contabo.yml ps
