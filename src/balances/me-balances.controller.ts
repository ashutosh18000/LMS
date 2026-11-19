import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BalancesService } from './balances.service';

@ApiTags('Leave Balances')
@ApiBearerAuth('JWT-auth')
@Controller('me')
export class MeBalancesController {
  constructor(private readonly balancesService: BalancesService) {}

  /**
   * GET /me/balances
   * Accessible to all authenticated users.
   */
  @Get('balances')
  async getMyBalances(
    @CurrentUser('id') userId: string,
    @CurrentUser('orgId') orgId: string,
    @Query('year') year?: string,
  ) {
    const yearNum = year ? parseInt(year, 10) : undefined;
    return this.balancesService.getMyBalances(userId, orgId, yearNum);
  }
}
