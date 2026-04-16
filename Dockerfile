FROM node:18-slim

# 1. Installation des dépendances système requises par Puppeteer (Chromium)
RUN apt-get update \
    && apt-get install -y wget gnupg ca-certificates \
    fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 \
    libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 \
    libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 \
    libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
    libxrandr2 libxrender1 libxss1 libxtst6 lsb-release xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 2. Définition du répertoire de travail
WORKDIR /app

# 3. Copie des fichiers package.json
COPY package*.json ./

# 4. Installation des dépendances Node.js (Puppeteer va télécharger sa version de Chromium)
RUN npm install

# 5. Copie du reste du code source
COPY . .

# 6. Exposition du port (3005 d'après le start_all.sh)
EXPOSE 3005

# 7. Commande de démarrage
CMD ["npm", "start"]
