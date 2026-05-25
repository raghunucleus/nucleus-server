import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireTotpEnrolledGuard } from '../auth/require-totp-enrolled.guard';
import { SaveSubjectTypeMarkStructureDto } from '../dto/save-subject-type-mark-structure.dto';
import { SubjectTypeMarkStructure } from '../entities/subject-type-mark-structure.entity';
import {
  MarkStructureBySubjectType,
  SubjectTypeMarkStructuresService,
} from './subject-type-mark-structures.service';

@ApiTags('subject-type-mark-structures')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/regulations/:regulationId/mark-structures')
export class SubjectTypeMarkStructuresController {
  constructor(
    private readonly structures: SubjectTypeMarkStructuresService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'List every subject type with its mark structure for this regulation.',
  })
  list(
    @Param('regulationId', ParseIntPipe) regulationId: number,
  ): Promise<MarkStructureBySubjectType[]> {
    return this.structures.listForRegulation(regulationId);
  }

  @Get(':subjectTypeId')
  @ApiOperation({ summary: 'Get the mark structure for one subject type.' })
  getOne(
    @Param('regulationId', ParseIntPipe) regulationId: number,
    @Param('subjectTypeId', ParseIntPipe) subjectTypeId: number,
  ): Promise<SubjectTypeMarkStructure> {
    return this.structures.getOne(regulationId, subjectTypeId);
  }

  @Put(':subjectTypeId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create or replace the mark structure for one subject type.',
  })
  save(
    @Param('regulationId', ParseIntPipe) regulationId: number,
    @Param('subjectTypeId', ParseIntPipe) subjectTypeId: number,
    @Body() dto: SaveSubjectTypeMarkStructureDto,
  ): Promise<SubjectTypeMarkStructure> {
    return this.structures.save(regulationId, subjectTypeId, dto);
  }

  @Delete(':subjectTypeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove the mark structure for one subject type.' })
  async remove(
    @Param('regulationId', ParseIntPipe) regulationId: number,
    @Param('subjectTypeId', ParseIntPipe) subjectTypeId: number,
  ): Promise<void> {
    await this.structures.remove(regulationId, subjectTypeId);
  }
}
