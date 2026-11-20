const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function normalizedHost(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`E2E safety check: ${name} is required; refusing to run tests.`);
  }

  try {
    return new URL(value).hostname.replace(/-pooler(?=\.|$)/, '');
  } catch {
    throw new Error(`E2E safety check: ${name} is not a valid URL; refusing to run tests.`);
  }
}

const productionHost = normalizedHost('DATABASE_URL_UNPOOLED');
const testPoolHost = normalizedHost('TEST_DATABASE_URL');
const testDirectHost = normalizedHost('TEST_DIRECT_URL');

if (testPoolHost !== testDirectHost) {
  throw new Error('E2E safety check: test pooled and direct URLs must target the same host.');
}

if (testDirectHost === productionHost) {
  throw new Error('E2E safety check: test URL resolves to the production host; refusing to run tests.');
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DIRECT_URL = process.env.TEST_DIRECT_URL;
process.env.NODE_ENV = 'test';