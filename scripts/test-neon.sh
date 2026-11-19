#!/usr/bin/env bash
set -e

# ==============================================================================
# Neon Verification Script
# Safely executes the full end-to-end test suite against an isolated Neon test branch.
# ==============================================================================

echo "========================================================"
echo "🚀 LMS Backend - Neon Test Branch Verification"
echo "========================================================"

# 1. Verify required environment variables
if [ -z "$TEST_DATABASE_URL" ]; then
  echo "❌ ERROR: TEST_DATABASE_URL is not set!"
  echo "Please export your Neon test branch connection string:"
  echo "  export TEST_DATABASE_URL=\"postgresql://neondb_owner:***@ep-test-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connect_timeout=15\""
  echo "  export DIRECT_URL=\"postgresql://neondb_owner:***@ep-test.ap-southeast-1.aws.neon.tech/neondb?sslmode=require\""
  exit 1
fi

if [ -z "$DIRECT_URL" ]; then
  echo "⚠️ WARNING: DIRECT_URL is not set. Defaulting DIRECT_URL to TEST_DATABASE_URL."
  export DIRECT_URL="$TEST_DATABASE_URL"
fi

# 2. Safety check: ensure not pointing to production
if [[ "$TEST_DATABASE_URL" =~ (prod|production|main) ]]; then
  echo "⚠️ CAUTION: TEST_DATABASE_URL contains 'prod', 'production', or 'main' keywords."
  echo "Verify that you are testing against an ISOLATED branch, never a production database."
  read -p "Are you sure you want to proceed with migrations on this branch? (y/N): " confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "Aborted by user."
    exit 0
  fi
fi

# 3. Apply Prisma migrations using direct connection
echo ""
echo "📦 Applying database migrations via DIRECT_URL..."
DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy

# 4. Run full E2E test suite against pooled connection
echo ""
echo "🧪 Running full E2E test suite against Neon branch..."
DATABASE_URL="$TEST_DATABASE_URL" NODE_ENV=test npm run test:e2e

echo ""
echo "========================================================"
echo "✅ Neon test branch verification completed successfully!"
echo "========================================================"
