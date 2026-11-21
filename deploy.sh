#!/usr/bin/env bash
set -e

echo "=== Déploiement Automatique ShopControl sur VPS Ubuntu ==="

# 1. Mise à jour système et installation Docker si non présent
if ! command -v docker &> /dev/null; then
    echo "Installation de Docker et Docker Compose..."
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl gnupg
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    echo \
      "deb [arch=\"$(dpkg --print-architecture)\" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
      sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    sudo usermod -aG docker "$USER"
fi

# 2. Vérification fichier d'environnement
if [ ! -f .env.production ]; then
    echo "Création du fichier .env.production à partir du modèle..."
    cp .env.production.example .env.production
    echo "ATTENTION : Veuillez vérifier et personnaliser .env.production avant de relancer !"
fi

# 3. Ouverture des ports pare-feu Ubuntu (iptables / ufw)
if command -v ufw &> /dev/null; then
    sudo ufw allow 22/tcp || true
    sudo ufw allow 80/tcp || true
    sudo ufw allow 443/tcp || true
    sudo ufw --force enable || true
fi

# Pour Oracle Cloud iptables spécifique :
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
sudo netfilter-persistent save 2>/dev/null || true

# 4. Lancement des conteneurs
echo "Construction et démarrage des conteneurs..."
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d

# 5. Attente et migration initiale
echo "Attente de l'initialisation de la base de données..."
sleep 10
docker compose -f docker-compose.prod.yml exec api npm run db:migrate || true

echo "=== Déploiement terminé avec succès ! ==="
docker compose -f docker-compose.prod.yml ps
