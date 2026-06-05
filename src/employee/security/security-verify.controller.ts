import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScreen } from '../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { VerifyDto } from './dto/verify.dto';
import {
  SecurityVerifyService,
  VerifyResult,
} from './security-verify.service';

const SCREEN_KEY = 'security.verify.scan';

/**
 * Security-guard endpoint: scan a student/employee security-pass QR and verify
 * the holder is a real, currently-active person. Gated by the
 * `security.verify.scan` RBAC screen. The scanned token is single-use — it is
 * consumed on the first successful verify (see SecurityVerifyService).
 */
@ApiTags('security-verify')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/security')
export class SecurityVerifyController {
  constructor(private readonly verifier: SecurityVerifyService) {}

  @Post('verify')
  @RequireScreen(SCREEN_KEY, 'scan')
  @ApiOperation({
    summary:
      'Verify a scanned student/employee security-pass QR. Returns the ' +
      'holder identity with valid=true when the pass is fresh and the person ' +
      'is active; otherwise valid=false with a reason (expired / invalid / ' +
      'inactive / unknown). The token is consumed (single-use) on success.',
  })
  verify(@Body() dto: VerifyDto): Promise<VerifyResult> {
    return this.verifier.verify(dto.qr_token);
  }
}
