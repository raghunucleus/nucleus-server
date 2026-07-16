import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequesterRequestView } from '../../requests/approval-requests.service';
import { GetStudent } from '../auth/get-student.decorator';
import { RequirePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { StudentJwtAuthGuard } from '../auth/student-jwt-auth.guard';
import type { AuthenticatedStudent } from '../auth/student-jwt.strategy';
import { CreateProfileUpdateRequestDto } from './dto/create-profile-update-request.dto';
import {
  ProfileUpdateContext,
  ProfileUpdateRequestService,
} from './profile-update-request.service';

/**
 * Creation surface for the `profile_update` request type — lives with the
 * student-profile domain (which owns the fields), while the generic list /
 * cancel endpoints live on the requests framework (`/student/requests`).
 * The student id comes only from the JWT (`@GetStudent()`).
 */
@ApiTags('student-requests')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student/requests/profile-update')
export class ProfileUpdateRequestController {
  constructor(private readonly profileUpdates: ProfileUpdateRequestService) {}

  @Get('context')
  @ApiOperation({
    summary:
      'Current values of the requestable profile fields (form prefill) plus any pending request that blocks a new submit.',
  })
  context(
    @GetStudent() s: AuthenticatedStudent,
  ): Promise<ProfileUpdateContext> {
    return this.profileUpdates.context(s.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Request changes to your profile (mobile/email/blood group/ABC ID). Goes to your batch’s profile verifiers for approval.',
  })
  create(
    @GetStudent() s: AuthenticatedStudent,
    @Body() dto: CreateProfileUpdateRequestDto,
  ): Promise<RequesterRequestView> {
    return this.profileUpdates.create(s.id, dto);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Revise a request that was sent back to you and put it back in the queue. Replaces the requested changes wholesale; 409 unless it is currently sent back to you.',
  })
  resubmit(
    @GetStudent() s: AuthenticatedStudent,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateProfileUpdateRequestDto,
  ): Promise<RequesterRequestView> {
    return this.profileUpdates.resubmit(s.id, id, dto);
  }
}
