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
# 1. Connecter unisphere_nginx au réseau interne shopcontrol_net
docker network connect shopcontrol_net unisphere_nginx 2>/dev/null || true

# 2. Connecter shopcontrol_app à chaque réseau de unisphere_nginx
for net in $(docker inspect unisphere_nginx --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' 2>/dev/null); do
  if [ -n "$net" ]; then
    docker network connect "$net" shopcontrol_app 2>/dev/null || true
  fi
done

# 3. Recharger la configuration Nginx
docker exec unisphere_nginx nginx -s reload 2>/dev/null || true

echo "=========================================="
echo "✅ Mise à jour terminée avec succès !"
echo "=========================================="
docker compose -f docker-compose.contabo.yml ps
