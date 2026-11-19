import { ClockService } from '../src/common/services/clock.service';

describe('ClockService (Unit Tests)', () => {
  let clockService: ClockService;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    clockService = new ClockService();
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('allows setFixedToday when NODE_ENV is "test"', () => {
    process.env.NODE_ENV = 'test';
    clockService.setFixedToday('2026-11-15');
    expect(clockService.today()).toBe('2026-11-15');

    clockService.setFixedToday(null);
    expect(clockService.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('throws an error when setFixedToday is called outside test environment (e.g. production)', () => {
    process.env.NODE_ENV = 'production';
    expect(() => {
      clockService.setFixedToday('2026-11-15');
    }).toThrow('setFixedToday is only allowed in test environment');
  });

  it('throws an error when setFixedToday is called in development environment', () => {
    process.env.NODE_ENV = 'development';
    expect(() => {
      clockService.setFixedToday('2026-11-15');
    }).toThrow('setFixedToday is only allowed in test environment');
  });
});
