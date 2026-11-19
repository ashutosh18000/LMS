import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

@Injectable()
export class PasswordService {
  private static readonly SALT_ROUNDS = 10;
  // Pre-computed 10-round bcrypt hash for constant-time comparison on user not found
  private static readonly DUMMY_HASH =
    '$2b$10$7EqJtq98hPqEX7fNZaFWoO.8H7c4M4i9rKzL2X6pG2Z4T8N9R0Q2e';

  /**
   * Hashes a plaintext password using bcrypt with 10 salt rounds.
   */
  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, PasswordService.SALT_ROUNDS);
  }

  /**
   * Compares a plaintext password against a bcrypt hash.
   */
  async compare(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Runs a dummy comparison to prevent timing enumeration attacks when a user is not found.
   */
  async dummyCompare(password: string): Promise<void> {
    await bcrypt.compare(password, PasswordService.DUMMY_HASH);
  }
}
