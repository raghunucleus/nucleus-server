import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireTotpEnrolledGuard } from '../auth/require-totp-enrolled.guard';
import { UpdateInstitutionSettingsDto } from '../dto/update-institution-settings.dto';
import { InstitutionSetting } from '../entities/institution-setting.entity';
import { InstitutionSettingsService } from './institution-settings.service';

@ApiTags('institution-settings')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/institution-settings')
export class InstitutionSettingsController {
  constructor(private readonly settings: InstitutionSettingsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Get the institution branding (name, address, logo, affiliation codes) ' +
      'shown on the student ID card. Created with defaults on first read.',
  })
  get(): Promise<InstitutionSetting> {
    return this.settings.get();
  }

  @Put()
  @ApiOperation({ summary: 'Update the institution branding settings.' })
  update(
    @Body() dto: UpdateInstitutionSettingsDto,
  ): Promise<InstitutionSetting> {
    return this.settings.update(dto);
  }
}
