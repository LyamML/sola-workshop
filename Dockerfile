# syntax=docker/dockerfile:1
#
# Les quatre services de Sola, une cible chacun, assemblés par compose.yaml :
#
#   borne        écran 01, servi par `vite preview` pour garder son relais
#   console      écrans 02 à 04, en fichiers statiques
#   backoffice   l'outil d'exploitation, en fichiers statiques
#   server       le serveur de bord, sa base dans le volume /data
#
# Aucun secret n'entre dans une image : les jetons arrivent au démarrage, par
# l'environnement, et .dockerignore écarte tout fichier .env.

# ------------------------------------------------------------- dépendances --
FROM node:24-slim AS dependances
WORKDIR /app
# Les manifestes seuls d'abord : tant qu'ils ne changent pas, Docker garde
# cette couche, et une modification du code ne réinstalle rien.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/borne/package.json web/borne/
COPY web/console/package.json web/console/
COPY web/backoffice/package.json web/backoffice/
# package-lock.json a été écrit sous Windows, et npm n'y a gardé que les
# binaires Windows de Rollup (npm/cli#4828) : sous Linux, `npm ci` n'en pose
# aucun et `vite build` échoue. On ajoute celui de la plateforme, à la version
# exacte du verrou, sans réécrire le verrou.
RUN npm ci --no-audit --no-fund \
 && npm install --no-save --no-audit --no-fund \
      "@rollup/rollup-linux-$(node -p process.arch)-gnu@$(node -p "require('./package-lock.json').packages['node_modules/rollup'].version")"

# ------------------------------------------------------------------- build --
FROM dependances AS build
COPY . .
# tsc pour le serveur, tsc puis vite pour les interfaces : une erreur de type
# arrête la construction, comme sur un poste.
RUN npm run build

# ------------------------------------------------------------------- borne --
# Vite, pas nginx : le relais qui ajoute le jeton des bornes vit dans
# vite.config.ts, et `vite preview` le reprend tel quel. Servie en fichiers
# statiques, la borne n'aurait plus de relais (limites connues du README).
FROM dependances AS borne
WORKDIR /app/web/borne
COPY web/borne/vite.config.ts ./
COPY --from=build /app/web/borne/dist dist
# Vite compile sa configuration dans un fichier posé à côté d'elle avant de
# la charger : le dossier doit appartenir à qui le lance.
RUN chown node:node .
USER node
EXPOSE 5173
CMD ["node", "/app/node_modules/vite/bin/vite.js", "preview", "--host", "0.0.0.0"]

# ----------------------------------------------------- console, backoffice --
# Deux applications distinctes, deux images, la même configuration.
FROM nginx:stable-alpine AS console
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/console/dist /usr/share/nginx/html

FROM nginx:stable-alpine AS backoffice
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/backoffice/dist /usr/share/nginx/html

# ------------------------------------------------------------------ server --
# En dernier : c'est la cible d'un `docker build .` sans --target.
FROM node:24-slim AS server
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/borne/package.json web/borne/
COPY web/console/package.json web/console/
COPY web/backoffice/package.json web/backoffice/
# Les dépendances du serveur seules — express, zod, hash-wasm. Ni Vite ni
# TypeScript : le code compilé ne les appelle plus.
RUN npm ci --omit=dev --workspace=server --no-audit --no-fund
COPY --from=build /app/server/dist server/dist
# De quoi créer la base au premier démarrage, et les outils du terminal :
# comptes, lecture seule, agrégats d'un jour.
COPY db/serveur db/serveur
COPY scripts/db-load.mjs scripts/db-demo.mjs scripts/hachage.mjs \
     scripts/db-compte.mjs scripts/db-sql.mjs scripts/db-rollup.mjs scripts/
COPY docker/serveur.mjs docker/
RUN mkdir /data && chown node:node /data
USER node
ENV DB_FILE=/data/sola.db ECOUTE=0.0.0.0
EXPOSE 5175 5177
CMD ["node", "docker/serveur.mjs"]
