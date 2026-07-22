#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export GYMCOACH_COMMIT_SHA="$(git rev-parse HEAD)"
export GYMCOACH_IMAGE_AUTHORITY="gymcoach-app"


DC=(docker compose -f docker-compose.prod.yml -f docker-compose.local.yml)
APP_CONTAINER=gymcoach-app
DB_CONTAINER=gymcoach-db
swapped=0

if [[ ! -f docker-compose.local.yml ]]; then
  echo "docker-compose.local.yml is required for the canonical HomePC port 3030." >&2
  exit 1
fi

bash scripts/verify.sh

old_image_id="$(docker inspect -f '{{.Image}}' "$APP_CONTAINER")"
image_ref="$(docker inspect -f '{{.Config.Image}}' "$APP_CONTAINER")"
rollback_tag="gymcoach-app:rollback-$(date +%Y%m%d-%H%M%S)"
docker image tag "$old_image_id" "$rollback_tag"

mkdir -p backups/deploy
backup="backups/deploy/gymcoach-$(date +%Y%m%d-%H%M%S).dump"
docker exec "$DB_CONTAINER" sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup"
test -s "$backup"

rollback() {
  local exit_code=$?
  trap - ERR
  if [[ "$swapped" -eq 1 ]]; then
    echo "Deployment verification failed; restoring $rollback_tag." >&2
    docker image tag "$rollback_tag" "$image_ref"
    "${DC[@]}" up -d --no-deps --force-recreate app
  fi
  exit "$exit_code"
}
trap rollback ERR

"${DC[@]}" build app
"${DC[@]}" run --rm --no-deps app \
  node node_modules/prisma/build/index.js migrate deploy

swapped=1
"${DC[@]}" up -d --no-deps --force-recreate app

root_code=000
health_code=000
for _ in $(seq 1 30); do
  root_code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3030/ || true)"
  health_code="$(
    curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3030/mcp/health || true
  )"
  if [[ "$root_code" =~ ^(200|307)$ && "$health_code" == 401 ]]; then
    break
  fi
  sleep 2
done

if [[ ! "$root_code" =~ ^(200|307)$ || "$health_code" != 401 ]]; then
  echo "Unexpected health result: root=$root_code mcpNoToken=$health_code" >&2
  false
fi

docker exec "$APP_CONTAINER" \
  node node_modules/prisma/build/index.js migrate status

if docker ps --format '{{.Ports}}' | grep -Eq ':(3031|3032|3033)->'; then
  echo "Temporary GymCoach listeners on ports 3031-3033 are not allowed." >&2
  false
fi

trap - ERR
swapped=0

echo "GymCoach app deployed on canonical port 3030."
echo "Database backup: $backup"
echo "Rollback image: $rollback_tag"
