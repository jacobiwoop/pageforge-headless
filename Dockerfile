# Utiliser l'image Node.js officielle
FROM node:18-bullseye-slim

# Installer les dépendances système pour Puppeteer
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    libxss1 \
    libxtst6 \
    && rm -rf /var/lib/apt/lists/*

# Définir le répertoire de travail
WORKDIR /app

# Copier les fichiers package.json
COPY package*.json ./

# Installer les dépendances Node.js (V3: production)
RUN npm install --production

# Puppeteer télécharge automatiquement Chromium
# Vérifier l'installation via npx
RUN npx puppeteer browsers install chrome

# Copier tout le code source
COPY . .

# Exposer le port (Render assigne automatiquement le PORT)
EXPOSE 3000

# Démarrer le service
CMD ["node", "server.js"]
