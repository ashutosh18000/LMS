import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { MinRole } from '../common/decorators/min-role.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PlatformService } from './platform.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { QueryOrganizationsDto } from './dto/query-organizations.dto';
import { OrgActionReasonDto } from './dto/org-action-reason.dto';
import { ReplaceOwnerDto } from './dto/replace-owner.dto';
import { ResetOwnerPasswordDto } from './dto/reset-owner-password.dto';

import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('Platform (Root)')
@ApiBearerAuth('JWT-auth')
@Throttle({ platform: { limit: 20, ttl: 60000 } })
@MinRole(Role.root)
@Controller('platform')
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  /**
   * 1. POST /platform/organizations
   */
  @HttpCode(HttpStatus.CREATED)
  @Post('organizations')
  async createOrganization(
    @CurrentUser('id') rootUserId: string,
    @Body() dto: CreateOrganizationDto,
  ) {
    return this.platformService.createOrganization(rootUserId, dto);
  }

  /**
   * 2. GET /platform/organizations
   */
  @Get('organizations')
  async getOrganizations(@Query() query: QueryOrganizationsDto) {
    return this.platformService.getOrganizations(query);
  }

  /**
   * 3. GET /platform/organizations/:id
   */
  @Get('organizations/:id')
  async getOrganizationById(@Param('id') id: string) {
    return this.platformService.getOrganizationById(id);
  }

  /**
   * 4. PATCH /platform/organizations/:id/suspend
   */
  @Patch('organizations/:id/suspend')
  async suspendOrganization(
    @CurrentUser('id') rootUserId: string,
    @Param('id') id: string,
    @Body() dto: OrgActionReasonDto,
  ) {
    return this.platformService.suspendOrganization(rootUserId, id, dto);
  }

  /**
   * 4. PATCH /platform/organizations/:id/activate
   */
  @Patch('organizations/:id/activate')
  async activateOrganization(
    @CurrentUser('id') rootUserId: string,
    @Param('id') id: string,
    @Body() dto: OrgActionReasonDto,
  ) {
    return this.platformService.activateOrganization(rootUserId, id, dto);
  }

  /**
   * 5. POST /platform/organizations/:id/replace-owner
   */
  @HttpCode(HttpStatus.OK)
  @Post('organizations/:id/replace-owner')
  async replaceOwner(
    @CurrentUser('id') rootUserId: string,
    @Param('id') id: string,
    @Body() dto: ReplaceOwnerDto,
  ) {
    return this.platformService.replaceOwner(rootUserId, id, dto);
  }

  /**
   * 6. POST /platform/organizations/:id/reset-owner-password
   */
  @HttpCode(HttpStatus.OK)
  @Post('organizations/:id/reset-owner-password')
  async resetOwnerPassword(
    @CurrentUser('id') rootUserId: string,
    @Param('id') id: string,
    @Body() dto: ResetOwnerPasswordDto,
  ) {
    return this.platformService.resetOwnerPassword(rootUserId, id, dto);
  }
}
