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
import { MinRole } from '../common/decorators/min-role.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OrgService } from './org.service';
import { UpdateOrgSettingsDto } from './dto/update-settings.dto';
import { CreateHrAdminDto } from './dto/create-hr-admin.dto';
import { PromoteHrAdminDto } from './dto/promote-hr-admin.dto';
import { DemoteHrAdminDto } from './dto/demote-hr-admin.dto';
import { DeactivateHrAdminDto } from './dto/deactivate-hr-admin.dto';
import { QueryHrAdminsDto } from './dto/query-hr-admins.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { QueryOrgAuditLogsDto } from './dto/query-audit-logs.dto';

@MinRole(Role.org_owner)
@Controller('org')
export class OrgController {
  constructor(private readonly orgService: OrgService) {}

  /**
   * 1. GET /org/settings
   */
  @Get('settings')
  async getSettings(@CurrentUser('orgId') orgId: string) {
    return this.orgService.getSettings(orgId);
  }

  /**
   * 1. PATCH /org/settings
   */
  @Patch('settings')
  async updateSettings(
    @CurrentUser('id') ownerId: string,
    @CurrentUser('orgId') orgId: string,
    @Body() dto: UpdateOrgSettingsDto,
  ) {
    return this.orgService.updateSettings(ownerId, orgId, dto);
  }

  /**
   * 2. POST /org/hr-admins
   */
  @HttpCode(HttpStatus.CREATED)
  @Post('hr-admins')
  async createHrAdmin(
    @CurrentUser('id') ownerId: string,
    @CurrentUser('orgId') orgId: string,
    @Body() dto: CreateHrAdminDto,
  ) {
    return this.orgService.createHrAdmin(ownerId, orgId, dto);
  }

  /**
   * 3. POST /org/hr-admins/promote
   */
  @HttpCode(HttpStatus.OK)
  @Post('hr-admins/promote')
  async promoteHrAdmin(
    @CurrentUser('id') ownerId: string,
    @CurrentUser('orgId') orgId: string,
    @Body() dto: PromoteHrAdminDto,
  ) {
    return this.orgService.promoteHrAdmin(ownerId, orgId, dto);
  }

  /**
   * 4. POST /org/hr-admins/:id/demote
   */
  @HttpCode(HttpStatus.OK)
  @Post('hr-admins/:id/demote')
  async demoteHrAdmin(
    @CurrentUser('id') ownerId: string,
    @CurrentUser('orgId') orgId: string,
    @Param('id') targetUserId: string,
    @Body() dto: DemoteHrAdminDto,
  ) {
    return this.orgService.demoteHrAdmin(ownerId, orgId, targetUserId, dto);
  }

  /**
   * 5. PATCH /org/hr-admins/:id/deactivate
   */
  @Patch('hr-admins/:id/deactivate')
  async deactivateHrAdmin(
    @CurrentUser('id') ownerId: string,
    @CurrentUser('orgId') orgId: string,
    @Param('id') targetUserId: string,
    @Body() dto: DeactivateHrAdminDto,
  ) {
    return this.orgService.deactivateHrAdmin(
      ownerId,
      orgId,
      targetUserId,
      dto,
    );
  }

  /**
   * 5. PATCH /org/hr-admins/:id/reactivate
   */
  @Patch('hr-admins/:id/reactivate')
  async reactivateHrAdmin(
    @CurrentUser('id') ownerId: string,
    @CurrentUser('orgId') orgId: string,
    @Param('id') targetUserId: string,
  ) {
    return this.orgService.reactivateHrAdmin(ownerId, orgId, targetUserId);
  }

  /**
   * 6. GET /org/hr-admins
   */
  @Get('hr-admins')
  async getHrAdmins(
    @CurrentUser('orgId') orgId: string,
    @Query() query: QueryHrAdminsDto,
  ) {
    return this.orgService.getHrAdmins(orgId, query);
  }

  /**
   * 7. POST /org/transfer-ownership
   */
  @HttpCode(HttpStatus.OK)
  @Post('transfer-ownership')
  async transferOwnership(
    @CurrentUser('id') ownerId: string,
    @CurrentUser('orgId') orgId: string,
    @Body() dto: TransferOwnershipDto,
  ) {
    return this.orgService.transferOwnership(ownerId, orgId, dto);
  }

  /**
   * 8. GET /org/audit-logs
   */
  @Get('audit-logs')
  async getAuditLogs(
    @CurrentUser('orgId') orgId: string,
    @Query() query: QueryOrgAuditLogsDto,
  ) {
    return this.orgService.getAuditLogs(orgId, query);
  }
}
