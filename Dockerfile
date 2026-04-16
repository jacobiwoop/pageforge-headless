FROM ghcr.io/puppeteer/puppeteer:latest

# Environnement pour Puppeteer: on force l'utilisation du Chrome inclus dans l'image
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome


# Le user 'pptruser' est déjà créé par l'image officielle
WORKDIR /home/pptruser/app

# Copie des packages avec les bons droits
COPY --chown=pptruser:pptruser package*.json ./

# Installation propre sans chromium (plus rapide et sans erreurs)
RUN npm install

# Copie du reste du serveur
COPY --chown=pptruser:pptruser . .

# Exposition du port
EXPOSE 3005

CMD ["node", "server.js"]
