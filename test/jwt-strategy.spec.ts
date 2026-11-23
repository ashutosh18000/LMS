import { ConfigService } from '@nestjs/config';
import { OrgStatus, Role } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';

describe('JwtStrategy organization lookup', () => {
  it('loads user and organization status in one user query', async () => {
    const user = {
      id: 'user-id',
      email: 'staff@example.com',
      name: 'Staff User',
      role: Role.staff,
      orgId: 'org-id',
      mustChangePassword: false,
      active: true,
      organization: { status: OrgStatus.active },
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
    };
    const config = { get: jest.fn().mockReturnValue('test-secret') };
    const strategy = new JwtStrategy(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );

    await expect(strategy.validate({ sub: user.id })).resolves.toEqual({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      orgId: user.orgId,
      mustChangePassword: user.mustChangePassword,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: user.id },
      select: expect.objectContaining({
        organization: { select: { status: true } },
      }),
    });
  });
});
