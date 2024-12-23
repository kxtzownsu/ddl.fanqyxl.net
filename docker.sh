#!/bin/bash

# Variables
CONTAINER_NAME="ddl-kxtz-dev"
IMAGE_NAME="file-server-image"
HOST_PORT=3069
CONTAINER_PORT=3069
FILES_DIR="/srv/html/dl.kxtz.dev/files"
APP_DIR="/app"

if [ ! -d "$FILES_DIR" ]; then
    echo "Error: Directory $FILES_DIR does not exist."
    exit 1
fi

cat <<EOF > Dockerfile
FROM node:18-alpine

RUN npm install -g pnpm

WORKDIR $APP_DIR

COPY . $APP_DIR

RUN pnpm install

RUN mkdir -p $FILES_DIR

EXPOSE $CONTAINER_PORT

CMD ["node", "server.js"]
EOF

echo "Building Docker image..."
docker build -t $IMAGE_NAME .

echo "Removing old container..."
docker stop $CONTAINER_NAME
docker rm $CONTAINER_NAME

echo "Running Docker container..."
docker run -d \
  --name $CONTAINER_NAME \
  --restart unless-stopped \
  -p $HOST_PORT:$CONTAINER_PORT/tcp \
  -v "$FILES_DIR:$FILES_DIR:ro" \
  --security-opt=no-new-privileges \
  --cap-drop ALL \
  --read-only \
  $IMAGE_NAME

echo "File server is running on port $HOST_PORT."

