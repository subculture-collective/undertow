#!/usr/bin/env bash
# Run the full suite against an isolated, resource-capped PostgreSQL container.
set -euo pipefail
cd "$(dirname "$0")/.."

postgres_container=$(docker run -d --rm --memory=256m --cpus=1 \
  --network bridge -p 127.0.0.1::5432 \
  -e POSTGRES_USER=undertow_test -e POSTGRES_PASSWORD=test-only-password \
  -e POSTGRES_DB=undertow_test_ci postgres:17-alpine)
trap 'docker rm -f "$postgres_container" >/dev/null' EXIT

ready=false
for attempt in {1..30}; do
  # Check over TCP: during first-run setup the server answers on its local socket before it accepts network connections.
  if docker exec "$postgres_container" pg_isready -h 127.0.0.1 -U undertow_test -d undertow_test_ci >/dev/null; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo 'Disposable PostgreSQL did not become ready.' >&2
  exit 1
fi

if [[ -f /.dockerenv ]]; then
  # Homelab runners use Docker's default bridge, which has no service-name DNS.
  postgres_address=$(docker inspect --format '{{(index .NetworkSettings.Networks "bridge").IPAddress}}' "$postgres_container")
  postgres_port=5432
else
  postgres_address=127.0.0.1
  postgres_port=$(docker port "$postgres_container" 5432/tcp | cut -d: -f2)
fi
export TEST_DATABASE_URL="postgres://undertow_test:test-only-password@${postgres_address}:${postgres_port}/undertow_test_ci"
npm test
