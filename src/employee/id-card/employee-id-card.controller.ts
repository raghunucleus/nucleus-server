import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScreen } from '../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import type { AuthenticatedEmployee } from '../auth/employee-jwt.strategy';
import { GetEmployee } from '../auth/get-employee.decorator';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { SecurityPassResponse } from '../../common/security-pass';
import {
  EmployeeIdCardResult,
  EmployeeIdCardService,
} from './employee-id-card.service';

const SCREEN_KEY = 'employee.id_card.view';

/**
 * The signed-in employee's digital ID card. Always scoped to the caller (the
 * employee id comes from the JWT, never the request) and gated by the
 * `employee.id_card.view` RBAC screen so it only appears for roles granted it.
 */
@ApiTags('employee-id-card')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/id-card')
export class EmployeeIdCardController {
  constructor(private readonly idCard: EmployeeIdCardService) {}

  @Get()
  @RequireScreen(SCREEN_KEY, 'view')
  @ApiOperation({
    summary:
      "The signed-in employee's digital ID card: identity + role details, " +
      'institution branding, and a non-expiring HMAC-signed QR code that a ' +
      'security app can verify. Always scoped to the caller — no id parameter.',
  })
  getCard(
    @GetEmployee() employee: AuthenticatedEmployee,
  ): Promise<EmployeeIdCardResult> {
    return this.idCard.getCard(employee.id);
  }

  @Get('pass')
  @RequireScreen(SCREEN_KEY, 'view')
  @ApiOperation({
    summary:
      'Issue a fresh single-use security pass (QR token) for the signed-in ' +
      'employee. Lightweight endpoint the client polls to rotate the QR on ' +
      'expiry without re-fetching the whole card. Always scoped to the caller.',
  })
  getPass(
    @GetEmployee() employee: AuthenticatedEmployee,
  ): Promise<SecurityPassResponse> {
    return this.idCard.issuePass(employee.id);
  }
}
