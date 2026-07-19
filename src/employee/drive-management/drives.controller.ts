import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequireScreen } from '../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import { GetEmployee } from '../auth/get-employee.decorator';
import type { AuthenticatedEmployee } from '../auth/employee-jwt.strategy';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { DrivesService } from './drives.service';
import {
  CreateDriveDto,
  DriveQueryDto,
  DriveStatusDto,
  UpdateDriveDto,
  UpdateDriveEligibilityDto,
} from './dto/drive.dto';

const KEY = 'drive_management.drives.manage';

/** JD attachments are documents, not media — 10 MB is generous for a PDF. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * Placement drives.
 *
 * The screen has no per-attribute scope — drives are institution-wide placement
 * config, so the screen guard is the whole access check (`attributes: []` in the
 * catalog). This is the unscoped branch of the corporate-relations pattern
 * (`company-management.controller.ts`), not the owner-scoped Companies one:
 * there is no `ownerId` threaded through any call here, by design.
 *
 * All the interesting validation lives in the service, where the offer type's
 * flags and the drive's scopes are both visible.
 */
@ApiTags('drive-management/drives')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/drive-management/drives')
export class DrivesController {
  constructor(private readonly svc: DrivesService) {}

  @Get()
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: 'Paginated drive list (search, filter, sort).' })
  list(@Query() query: DriveQueryDto) {
    return this.svc.list(query);
  }

  /**
   * The company picker's options. Served from this screen so the drive form
   * doesn't require a corporate-relations grant — see `DrivesService`.
   *
   * Declared before `:id` so the literal segment isn't swallowed by the param
   * route.
   */
  @Get('company-options')
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: 'Active companies a drive can be raised against.' })
  companyOptions() {
    return this.svc.companyOptions();
  }

  /**
   * The category multi-select's full option list. Served from this screen so the
   * form works with only a drives grant — see `DrivesService`.
   */
  @Get('company-category-options')
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: 'Active company categories a drive can be tagged with.' })
  companyCategoryOptions() {
    return this.svc.companyCategoryOptions();
  }

  /** Offer types for the drive list's offer-type filter. */
  @Get('offer-type-options')
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: 'Active offer types, for the drive list filter.' })
  offerTypeOptions() {
    return this.svc.offerTypeOptions();
  }

  /** Placement categories for the drive list's placement-category filter. */
  @Get('placement-category-options')
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: 'Active placement categories, for the drive list filter.' })
  placementCategoryOptions() {
    return this.svc.placementCategoryOptions();
  }

  /**
   * Options for the Eligibility form — programmes + the graduating years students
   * belong to. Served from this screen so it needs only a drives grant. Declared
   * before `:id` so the literal segment wins.
   */
  @Get('eligibility-options')
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: 'Programmes + passout years for the eligibility form.' })
  eligibilityOptions() {
    return this.svc.eligibilityOptions();
  }

  /**
   * Defaults for the drive form when a company is picked — its logo and its own
   * categories, which seed the drive's category multi-select.
   */
  @Get('company-defaults/:companyId')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary: "A company's logo + categories, to seed a new drive.",
  })
  companyDefaults(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.svc.companyDefaults(companyId);
  }

  @Get(':id')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary: 'One drive, with its designations and attachments.',
  })
  get(@Param('id', ParseIntPipe) id: number) {
    return this.svc.get(id);
  }

  @Post()
  @RequireScreen(KEY, 'create')
  @ApiOperation({ summary: 'Create a drive with its designations.' })
  create(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Body() dto: CreateDriveDto,
  ) {
    return this.svc.create(dto, emp.id);
  }

  @Patch(':id')
  @RequireScreen(KEY, 'edit')
  @ApiOperation({
    summary: 'Update a drive. `profiles`, if sent, replaces the whole set.',
  })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDriveDto) {
    return this.svc.update(id, dto);
  }

  @Patch(':id/status')
  @RequireScreen(KEY, 'edit')
  @ApiOperation({ summary: "Set a drive's lifecycle status." })
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DriveStatusDto,
  ) {
    return this.svc.updateStatus(id, dto.status);
  }

  @Get(':id/eligibility')
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: "A drive's eligibility (all-empty defaults if unset)." })
  getEligibility(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getEligibility(id);
  }

  @Get(':id/eligibility/summary')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary: "A drive's eligibility with ids resolved to labels (read-only).",
  })
  eligibilitySummary(@Param('id', ParseIntPipe) id: number) {
    return this.svc.eligibilitySummary(id);
  }

  @Put(':id/eligibility')
  @RequireScreen(KEY, 'edit')
  @ApiOperation({ summary: "Replace a drive's eligibility." })
  saveEligibility(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDriveEligibilityDto,
  ) {
    return this.svc.saveEligibility(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScreen(KEY, 'delete')
  @ApiOperation({
    summary: 'Delete a drive, its designations and their files.',
  })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id);
  }

  // ---- JD attachments -----------------------------------------------------

  @Post('profiles/:profileId/attachments')
  @HttpCode(HttpStatus.OK)
  @RequireScreen(KEY, 'edit')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Attach a JD file to a designation.' })
  addAttachment(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('profileId', ParseIntPipe) profileId: number,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_ATTACHMENT_BYTES }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.svc.addAttachment(profileId, file, emp.id);
  }

  @Delete('attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScreen(KEY, 'edit')
  @ApiOperation({ summary: 'Remove a JD attachment.' })
  removeAttachment(@Param('attachmentId', ParseIntPipe) attachmentId: number) {
    return this.svc.removeAttachment(attachmentId);
  }
}
