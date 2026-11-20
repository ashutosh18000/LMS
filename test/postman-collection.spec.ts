import * as fs from 'fs';
import * as path from 'path';

describe('Postman Collection Validation (Unit Tests)', () => {
  const collectionPath = path.resolve(__dirname, '../postman_collection.json');
  const envPath = path.resolve(__dirname, '../lms.postman_environment.json');

  it('validates postman_collection.json file existence and JSON validity', () => {
    expect(fs.existsSync(collectionPath)).toBe(true);
    const rawContent = fs.readFileSync(collectionPath, 'utf8');
    expect(() => JSON.parse(rawContent)).not.toThrow();
  });

  it('validates Postman collection schema specification (v2.1.0)', () => {
    const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));
    expect(collection.info).toBeDefined();
    expect(collection.info.name).toBe('Leave Management System API');
    expect(collection.info.schema).toBe(
      'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    );
    expect(Array.isArray(collection.item)).toBe(true);
    expect(collection.item.length).toBeGreaterThan(0);
  });

  it('verifies POST /auth/login request exists with automatic accessToken capture script', () => {
    const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));

    function findItem(
      items: any[],
      predicate: (item: any) => boolean,
    ): any | null {
      for (const item of items) {
        if (predicate(item)) return item;
        if (item.item && Array.isArray(item.item)) {
          const found = findItem(item.item, predicate);
          if (found) return found;
        }
      }
      return null;
    }

    const loginItem = findItem(
      collection.item,
      (it) =>
        it.name?.includes('login') ||
        it.request?.url?.path?.includes('login') ||
        it.name === 'POST /auth/login',
    );

    expect(loginItem).toBeDefined();
    expect(loginItem.request.method).toBe('POST');

    // Verify test event script
    const testEvent = loginItem.event?.find((e: any) => e.listen === 'test');
    expect(testEvent).toBeDefined();
    expect(testEvent.script).toBeDefined();
    const scriptCode = Array.isArray(testEvent.script.exec)
      ? testEvent.script.exec.join('\n')
      : String(testEvent.script.exec);

    expect(scriptCode).toContain('pm.response.code === 200');
    expect(scriptCode).toContain('pm.environment.set("accessToken"');
  });

  it('validates lms.postman_environment.json contains baseUrl and accessToken variables', () => {
    expect(fs.existsSync(envPath)).toBe(true);
    const envJson = JSON.parse(fs.readFileSync(envPath, 'utf8'));
    expect(envJson.name).toContain('LMS Environment');
    expect(Array.isArray(envJson.values)).toBe(true);

    const keys = envJson.values.map((v: any) => v.key);
    expect(keys).toContain('baseUrl');
    expect(keys).toContain('accessToken');
  });
});
