import { Module } from '@nestjs/common';
import { TeamController } from './team.controller';
import { MyTeamController } from './my-team.controller';
import { TeamService } from './team.service';

@Module({
  controllers: [TeamController, MyTeamController],
  providers: [TeamService],
  exports: [TeamService],
})
export class TeamModule {}
