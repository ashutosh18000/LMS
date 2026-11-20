const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function parseUrl(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`E2E safety check: ${name} is required; refusing to run tests.`);
  }

  try {
    return new URL(value);
  } catch {
    throw new Error(`E2E safety check: ${name} is not a valid URL; refusing to run tests.`);
  }
}

function normalizedHost(url) {
  return url.hostname.replace(/-pooler(?=\.|$)/, '');
}

const testPoolUrl = parseUrl('TEST_DATABASE_URL');
const testDirectUrl = parseUrl('TEST_DIRECT_URL');

const testPoolHost = normalizedHost(testPoolUrl);
const testDirectHost = normalizedHost(testDirectUrl);
const testDbName = testPoolUrl.pathname.replace(/^\//, '');

// 1. Print test host and database name safely (NEVER credentials)
console.log(
  `🛡️  [E2E Safety Guard] Testing against host: ${testPoolUrl.hostname} (database: ${testDbName})`
);

// 2. Ensure test pooled and direct target the same host
if (testPoolHost !== testDirectHost) {
  throw new Error('E2E safety check: test pooled and direct URLs must target the same host.');
}

// 3. Prevent accidental execution against production host
const prodUrls = ['DATABASE_URL_UNPOOLED', 'DATABASE_URL']
  .filter((k) => process.env[k])
  .map((k) => parseUrl(k));

for (const prodUrl of prodUrls) {
  const prodHost = normalizedHost(prodUrl);
  if (testDirectHost === prodHost || testPoolHost === prodHost) {
    throw new Error(
      `FATAL: E2E safety check failed! TEST_DATABASE_URL points to the production host (${prodHost}). Aborting tests immediately.`
    );
  }
}

// 4. Optional allowlist verification if TEST_BRANCH_HOST_ALLOWLIST is defined
if (process.env.TEST_BRANCH_HOST_ALLOWLIST) {
  const allowlist = process.env.TEST_BRANCH_HOST_ALLOWLIST.split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  const isAllowed = allowlist.some(
    (allowed) =>
      testPoolUrl.hostname === allowed ||
      testDirectUrl.hostname === allowed ||
      testDirectHost.includes(allowed)
  );
  if (!isAllowed) {
    throw new Error(
      `FATAL: E2E safety check failed! Host ${testPoolUrl.hostname} is not in TEST_BRANCH_HOST_ALLOWLIST (${process.env.TEST_BRANCH_HOST_ALLOWLIST}).`
    );
  }
}

// 5. Override process environment strictly for test execution
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DIRECT_URL = process.env.TEST_DIRECT_URL;
process.env.NODE_ENV = 'test';
