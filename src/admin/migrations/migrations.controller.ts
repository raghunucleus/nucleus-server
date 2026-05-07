import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  MigrationStatus,
  MigrationsService,
  RunMigrationsResult,
} from './migrations.service';

@ApiTags('admin-migrations')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard)
@Controller('admin/migrations')
export class MigrationsController {
  constructor(private readonly migrations: MigrationsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List executed and pending migrations, plus whether the run endpoint is enabled',
  })
  status(): Promise<MigrationStatus> {
    return this.migrations.getStatus();
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Run all pending migrations (requires ALLOW_ADMIN_MIGRATIONS=true). On failure, returns the offending SQL and Postgres driver details.',
  })
  run(): Promise<RunMigrationsResult> {
    return this.migrations.runMigrations();
  }
}
