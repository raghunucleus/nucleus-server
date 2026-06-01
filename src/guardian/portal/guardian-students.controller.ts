import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetGuardian } from '../auth/get-guardian.decorator';
import { GuardianJwtAuthGuard } from '../auth/guardian-jwt-auth.guard';
import type { AuthenticatedGuardian } from '../auth/guardian-jwt.strategy';
import { GuardianRequirePasswordChangedGuard } from '../auth/require-password-changed.guard';
import {
  GuardianPortalService,
  LinkedStudent,
} from './guardian-portal.service';

@ApiTags('guardian-portal')
@ApiBearerAuth('guardian-access-token')
@UseGuards(GuardianJwtAuthGuard, GuardianRequirePasswordChangedGuard)
@Controller('guardian/students')
export class GuardianStudentsController {
  constructor(private readonly portal: GuardianPortalService) {}

  @Get()
  @ApiOperation({
    summary:
      'The active students the signed-in guardian is linked to. Drives the ' +
      'child selector; scoped exclusively to the guardian from the JWT.',
  })
  list(
    @GetGuardian() guardian: AuthenticatedGuardian,
  ): Promise<LinkedStudent[]> {
    return this.portal.listStudents(guardian.mobile_number);
  }
}
