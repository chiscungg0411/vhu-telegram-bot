FROM node:20-slim

WORKDIR /app

RUN npm install -g npm@11.2.0

COPY package.json .
RUN npm install --production

COPY . .

EXPOSE 10000

CMD ["npm", "start"]
