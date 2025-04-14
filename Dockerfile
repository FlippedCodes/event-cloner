# get node
FROM node:23.11-bullseye-slim

# Create app directory
WORKDIR /usr/src/app

# Get app dependencies
COPY package*.json ./

# building app
RUN npm ci --omit=dev

# Bundle app source
COPY . .

# start up the bot
CMD [ "npm", "start" ]