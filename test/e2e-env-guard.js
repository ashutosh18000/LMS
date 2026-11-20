const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// 1. Strictly load .env.test (NEVER production .env)
const envTestPath = path.resolve(__dirname, '../.env.test');
if (!fs.existsSync(envTestPath)) {
  throw new Error(
    `FATAL: .env.test was not found at ${envTestPath}. Tests must run with .env.test. Copy .env.test.example to .env.test and configure it.`
  );
}

// Load .env.test with override: true so test values take full precedence
dotenv.config({ path: envTestPath, override: true });

function parseUrl(name, rawValue) {
  const value = rawValue || process.env[name];
  if (!value) {
    throw new Error(`E2E safety check: ${name} is required; refusing to run tests.`);
  }

  try {
    return new URL(value);
  } catch {
    throw new Error(`E2E safety check: ${name} is not a valid URL; refusing to run tests.`);
  }
}

function getEndpointId(url) {
  const firstPart = url.hostname.split('.')[0];
  return firstPart.replace(/-pooler$/, '');
}

function getDbName(url) {
  return url.pathname.replace(/^\//, '').split('?')[0];
}

const testPoolUrl = parseUrl('TEST_DATABASE_URL');
const testDirectUrl = parseUrl('TEST_DIRECT_URL', process.env.TEST_DIRECT_URL || process.env.DIRECT_URL);

const poolEndpointId = getEndpointId(testPoolUrl);
const directEndpointId = getEndpointId(testDirectUrl);
const poolDbName = getDbName(testPoolUrl);
const directDbName = getDbName(testDirectUrl);

// 2. Validate TEST_DATABASE_URL and DIRECT_URL target the exact same branch and database
if (poolEndpointId !== directEndpointId) {
  throw new Error(
    `FATAL: Branch mismatch! TEST_DATABASE_URL endpoint (${poolEndpointId}) and DIRECT_URL endpoint (${directEndpointId}) do not match. Both must target the same Neon test branch.`
  );
}

if (poolDbName !== directDbName) {
  throw new Error(
    `FATAL: Database mismatch! TEST_DATABASE_URL database (${poolDbName}) and DIRECT_URL database (${directDbName}) do not match. Both must target the same database.`
  );
}

// 3. Print test host, direct host, and database name safely (NEVER credentials)
console.log(
  `🛡️  [E2E Safety Guard] Testing against host: ${testPoolUrl.hostname} (direct: ${testDirectUrl.hostname}, db: ${poolDbName}, branch: ${poolEndpointId})`
);

// 4. Production guard: Check against known production branch or prod URL if present
const prodHostCandidates = ['DATABASE_URL_UNPOOLED', 'PROD_DATABASE_URL']
  .filter((k) => process.env[k])
  .map((k) => parseUrl(k));

for (const prodUrl of prodHostCandidates) {
  const prodEndpointId = getEndpointId(prodUrl);
  if (poolEndpointId === prodEndpointId || directEndpointId === prodEndpointId) {
    throw new Error(
      `FATAL: E2E safety check failed! Test URL targets the production branch (${prodEndpointId}). Aborting tests immediately.`
    );
  }
}

// 5. Optional allowlist verification if TEST_BRANCH_HOST_ALLOWLIST is defined
if (process.env.TEST_BRANCH_HOST_ALLOWLIST) {
  const allowlist = process.env.TEST_BRANCH_HOST_ALLOWLIST.split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  const isAllowed = allowlist.some(
    (allowed) =>
      testPoolUrl.hostname === allowed ||
      testDirectUrl.hostname === allowed ||
      allowed.includes(poolEndpointId)
  );
  if (!isAllowed) {
    throw new Error(
      `FATAL: E2E safety check failed! Host ${testPoolUrl.hostname} is not in TEST_BRANCH_HOST_ALLOWLIST (${process.env.TEST_BRANCH_HOST_ALLOWLIST}).`
    );
  }
}

// 6. Ensure override of process environment strictly for test execution
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DIRECT_URL = process.env.TEST_DIRECT_URL || testDirectUrl.toString();
process.env.NODE_ENV = 'test';
