#!/usr/bin/env bash
set -e

# Load local environment variables from the project root.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ ! -f "$PROJECT_DIR/.env" ]; then
  echo "ERROR: .env was not found in the project root."
  exit 1
fi
set -a
source "$PROJECT_DIR/.env"
set +a

# ==============================================================================
# Neon Verification Script
# Safely executes the full end-to-end test suite against an isolated Neon test branch.
# ==============================================================================

echo "========================================================"
echo "🚀 LMS Backend - Neon Test Branch Verification"
echo "========================================================"

# 1. Verify required environment variables
for variable in DATABASE_URL_UNPOOLED TEST_DATABASE_URL TEST_DIRECT_URL; do
  if [ -z "${!variable}" ]; then
    echo "ERROR: $variable is required in .env."
    exit 1
  fi
done

url_host() {
  node -e 'try { process.stdout.write(new URL(process.argv[1]).hostname.replace(/-pooler(?=\.|$)/, "")); } catch { process.exit(1); }' "$1"
}
PRODUCTION_HOST="$(url_host "$DATABASE_URL_UNPOOLED")" || { echo "ERROR: Invalid production database URL."; exit 1; }
TEST_POOL_HOST="$(url_host "$TEST_DATABASE_URL")" || { echo "ERROR: Invalid test pooled URL."; exit 1; }
TEST_DIRECT_HOST="$(url_host "$TEST_DIRECT_URL")" || { echo "ERROR: Invalid test direct URL."; exit 1; }
if [ "$TEST_POOL_HOST" != "$TEST_DIRECT_HOST" ]; then
  echo "ERROR: TEST_DATABASE_URL and TEST_DIRECT_URL must target the same Neon branch."
  exit 1
fi
if [ "$PRODUCTION_HOST" = "$TEST_DIRECT_HOST" ]; then
  echo "ERROR: Test database URL points to the production database host."
  exit 1
fi

# 3. Apply Prisma migrations using the test branch direct connection
echo ""
echo "📦 Applying database migrations via TEST_DIRECT_URL..."
DATABASE_URL="$TEST_DATABASE_URL" DIRECT_URL="$TEST_DIRECT_URL" npx prisma migrate deploy

# 4. Run full E2E test suite against the test branch pooled connection
echo ""
echo "🧪 Running full E2E test suite against Neon branch..."
DATABASE_URL="$TEST_DATABASE_URL" NODE_ENV=test npm run test:e2e

echo ""
echo "========================================================"
echo "✅ Neon test branch verification completed successfully!"
echo "========================================================"
