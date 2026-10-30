# Built from the repository root, because the widget lives outside server/ and its
# bundle has to be served by the API:
#   docker build -f server/Dockerfile .
FROM node:20

WORKDIR /app

# The widget first, so its bundle is in place before the server is built.
COPY widget/package*.json ./widget/
RUN npm install --prefix widget

COPY widget ./widget
COPY server/package*.json ./server/
RUN npm install --prefix server

COPY server ./server

# Writes server/public/widget/v1/insureongo.js and fails if it is over the size budget.
RUN npm run build --prefix widget

RUN npm run build --prefix server

WORKDIR /app/server

EXPOSE 3000

# Migrations run as their own task before the new version takes traffic, not here:
# every instance starting at once would run them in parallel.
CMD ["npm", "start"]
