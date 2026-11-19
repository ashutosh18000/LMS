import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { MinRole } from '../common/decorators/min-role.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BalancesService } from './balances.service';
import { AllocateBalancesDto } from './dto/allocate-balances.dto';
import { AdjustBalanceDto } from './dto/adjust-balance.dto';
import { QueryBalancesDto } from './dto/query-balances.dto';
import { CarryForwardDto } from './dto/carry-forward.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('Leave Balances')
@ApiBearerAuth('JWT-auth')
@MinRole(Role.hr_admin)
@Controller('balances')
export class BalancesController {
  constructor(private readonly balancesService: BalancesService) {}

  /**
   * 1. POST /balances/allocate
   */
  @HttpCode(HttpStatus.OK)
  @Post('allocate')
  async allocateBalances(
    @CurrentUser('id') actorId: string,
    @CurrentUser('orgId') orgId: string,
    @Body() dto: AllocateBalancesDto,
  ) {
    return this.balancesService.allocateBalances(actorId, orgId, dto);
  }

  /**
   * 2. POST /balances/adjust
   */
  @HttpCode(HttpStatus.OK)
  @Post('adjust')
  async adjustBalance(
    @CurrentUser('id') actorId: string,
    @CurrentUser('orgId') orgId: string,
    @Body() dto: AdjustBalanceDto,
  ) {
    return this.balancesService.adjustBalance(actorId, orgId, dto);
  }

  /**
   * 3. GET /balances
   */
  @Get()
  async getBalances(
    @CurrentUser('orgId') orgId: string,
    @Query() query: QueryBalancesDto,
  ) {
    return this.balancesService.getBalances(orgId, query);
  }

  /**
   * 4. POST /balances/carry-forward/preview
   */
  @HttpCode(HttpStatus.OK)
  @Post('carry-forward/preview')
  async previewCarryForward(
    @CurrentUser('orgId') orgId: string,
    @Body() dto: CarryForwardDto,
  ) {
    return this.balancesService.previewCarryForward(orgId, dto.fromYear);
  }

  /**
   * 5. POST /balances/carry-forward/run
   */
  @HttpCode(HttpStatus.OK)
  @Post('carry-forward/run')
  async runCarryForward(
    @CurrentUser('id') actorId: string,
    @CurrentUser('orgId') orgId: string,
    @Body() dto: CarryForwardDto,
  ) {
    return this.balancesService.runCarryForward(actorId, orgId, dto.fromYear);
  }
}
