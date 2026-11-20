#!/usr/bin/env bash
set -e

# ==============================================================================
# Neon Verification Script
# Safely executes migrations and the full E2E test suite against an isolated Neon test branch.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 1. Require .env.test for all test operations
if [ ! -f "$PROJECT_DIR/.env.test" ]; then
  echo "❌ ERROR: .env.test was not found in the project root."
  echo "Please copy .env.test.example to .env.test and configure Neon test branch credentials."
  exit 1
fi

set -a
source "$PROJECT_DIR/.env.test"
set +a

# Also check production host from .env if present (to prevent running against prod)
if [ -f "$PROJECT_DIR/.env" ]; then
  PROD_URL="$(grep -E '^DATABASE_URL=' "$PROJECT_DIR/.env" | cut -d '=' -f2- | tr -d '\"' | tr -d "'")"
  PROD_UNPOOLED_URL="$(grep -E '^DATABASE_URL_UNPOOLED=' "$PROJECT_DIR/.env" | cut -d '=' -f2- | tr -d '\"' | tr -d "'")"
fi

echo "========================================================"
echo "🚀 LMS Backend - Neon Test Branch Verification"
echo "========================================================"

# 2. Verify required environment variables in .env.test
for variable in TEST_DATABASE_URL TEST_DIRECT_URL; do
  if [ -z "${!variable}" ]; then
    echo "❌ ERROR: $variable is required in .env.test."
    exit 1
  fi
done

# 3. Extract and validate branch endpoint IDs and database names
get_endpoint_id() {
  node -e 'try { const u = new URL(process.argv[1]); process.stdout.write(u.hostname.split(".")[0].replace(/-pooler$/, "")); } catch { process.exit(1); }' "$1"
}

get_db_name() {
  node -e 'try { const u = new URL(process.argv[1]); process.stdout.write(u.pathname.replace(/^\//, "").split("?")[0]); } catch { process.exit(1); }' "$1"
}

get_host() {
  node -e 'try { const u = new URL(process.argv[1]); process.stdout.write(u.hostname); } catch { process.exit(1); }' "$1"
}

TEST_POOL_ENDPOINT="$(get_endpoint_id "$TEST_DATABASE_URL")" || { echo "❌ ERROR: Invalid TEST_DATABASE_URL."; exit 1; }
TEST_DIRECT_ENDPOINT="$(get_endpoint_id "$TEST_DIRECT_URL")" || { echo "❌ ERROR: Invalid TEST_DIRECT_URL."; exit 1; }

TEST_POOL_DB="$(get_db_name "$TEST_DATABASE_URL")" || { echo "❌ ERROR: Invalid TEST_DATABASE_URL db."; exit 1; }
TEST_DIRECT_DB="$(get_db_name "$TEST_DIRECT_URL")" || { echo "❌ ERROR: Invalid TEST_DIRECT_URL db."; exit 1; }

TEST_POOL_HOST="$(get_host "$TEST_DATABASE_URL")"
TEST_DIRECT_HOST="$(get_host "$TEST_DIRECT_URL")"

echo "🛡️  Target Test Host (pooled):  $TEST_POOL_HOST"
echo "🛡️  Target Test Host (direct):  $TEST_DIRECT_HOST"
echo "🛡️  Target Branch Endpoint ID:  $TEST_POOL_ENDPOINT"
echo "🛡️  Target Database Name:       $TEST_POOL_DB"

# Strict endpoint ID (branch) check
if [ "$TEST_POOL_ENDPOINT" != "$TEST_DIRECT_ENDPOINT" ]; then
  echo "❌ FATAL: Branch mismatch! TEST_DATABASE_URL endpoint ($TEST_POOL_ENDPOINT) and TEST_DIRECT_URL endpoint ($TEST_DIRECT_ENDPOINT) do not match."
  echo "Both must target the exact same Neon test branch."
  exit 1
fi

# Strict database name check
if [ "$TEST_POOL_DB" != "$TEST_DIRECT_DB" ]; then
  echo "❌ FATAL: Database mismatch! TEST_DATABASE_URL database ($TEST_POOL_DB) and TEST_DIRECT_URL database ($TEST_DIRECT_DB) do not match."
  exit 1
fi

# Check against production
for prod in "$PROD_URL" "$PROD_UNPOOLED_URL"; do
  if [ -n "$prod" ]; then
    PROD_ENDPOINT="$(get_endpoint_id "$prod" 2>/dev/null || true)"
    if [ -n "$PROD_ENDPOINT" ] && [ "$TEST_POOL_ENDPOINT" = "$PROD_ENDPOINT" ]; then
      echo "❌ FATAL: Test URL points to production branch endpoint ($PROD_ENDPOINT)! Aborting immediately."
      exit 1
    fi
  fi
done

# 4. Apply Prisma migrations using test branch direct connection
echo ""
echo "📦 Applying database migrations via TEST_DIRECT_URL..."
DATABASE_URL="$TEST_DATABASE_URL" DIRECT_URL="$TEST_DIRECT_URL" npx prisma migrate deploy

# 5. Run full E2E test suite against test branch
echo ""
echo "🧪 Running full E2E test suite against Neon branch..."
DATABASE_URL="$TEST_DATABASE_URL" DIRECT_URL="$TEST_DIRECT_URL" NODE_ENV=test npm run test:e2e

echo ""
echo "========================================================"
echo "✅ Neon test branch verification completed successfully!"
echo "========================================================"
