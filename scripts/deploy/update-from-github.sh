#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/srv/assistant-task-board}"
BRANCH="${BRANCH:-main}"
PM2_APP="${PM2_APP:-assistant-task-board}"

cd "$APP_DIR"

if [ ! -f ".env" ]; then
  echo "Missing .env in $APP_DIR. Keep production secrets on the server before updating." >&2
  exit 1
fi

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

npm ci
npm run build

pm2 restart "$PM2_APP" --update-env
pm2 save

echo "Updated $PM2_APP from origin/$BRANCH."
