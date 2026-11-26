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

echo "[3/4] Redémarrage des conteneurs..."
# Nettoyer l'ancien réseau conflictuel si présent
docker network disconnect -f shopcontrol_shopcontrol_net unisphere_nginx 2>/dev/null || true
docker network rm shopcontrol_shopcontrol_net 2>/dev/null || true

# Redémarrer proprement en recréant le conteneur avec son nom officiel
docker compose -f docker-compose.contabo.yml down 2>/dev/null || true
docker compose -f docker-compose.contabo.yml up -d --remove-orphans

echo "[4/4] Reconnexion au réseau Nginx & Rechargement du proxy..."
APP_ID=$(docker compose -f docker-compose.contabo.yml ps -q shopcontrol_app)
docker network connect shopcontrol_net unisphere_nginx 2>/dev/null || true

# Connecter le conteneur app à tous les réseaux de unisphere_nginx
for net in $(docker inspect unisphere_nginx --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' 2>/dev/null); do
  if [ -n "$net" ]; then
    docker network connect "$net" "$APP_ID" 2>/dev/null || true
  fi
done

# Connecter unisphere_nginx à tous les réseaux du conteneur app
for net in $(docker inspect "$APP_ID" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' 2>/dev/null); do
  if [ -n "$net" ]; then
    docker network connect "$net" unisphere_nginx 2>/dev/null || true
  fi
done

docker exec unisphere_nginx nginx -s reload 2>/dev/null || true
echo "Attente du démarrage complet de ShopControl (migrations & serveur)..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null http://127.0.0.1:3200 2>/dev/null; then
    echo "✅ Serveur local prêt !"
    break
  fi
  sleep 2
done

echo "Test du proxy public HTTPS..."
curl -I https://myshop.unisphere-ai.com || true

echo "=========================================="
echo "✅ Mise à jour terminée avec succès !"
echo "=========================================="
docker compose -f docker-compose.contabo.yml ps
