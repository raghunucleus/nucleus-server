import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireTotpEnrolledGuard } from '../auth/require-totp-enrolled.guard';
import { CreateStateDto } from '../dto/create-state.dto';
import { ListStatesDto } from '../dto/list-states.dto';
import { UpdateStateDto } from '../dto/update-state.dto';
import { State } from '../entities/state.entity';
import { ListStatesResult, StatesService } from './states.service';

// No delete route by design — deactivate only, matching every other admin
// master list. Districts reference states with ON DELETE RESTRICT anyway.
@ApiTags('states')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/states')
export class StatesController {
  constructor(private readonly states: StatesService) {}

  @Get()
  @ApiOperation({
    summary:
      'List states with server-side pagination, search, and sort. `status` filters on the row\'s own is_active; `effectiveActive` filters on the whole state -> country chain and is what consumer pickers should use.',
  })
  list(@Query() query: ListStatesDto): Promise<ListStatesResult> {
    return this.states.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single state by ID, with its country.' })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<State> {
    return this.states.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new state under a country.' })
  create(@Body() dto: CreateStateDto): Promise<State> {
    return this.states.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a state. Passing country_id re-parents it.',
  })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStateDto,
  ): Promise<State> {
    return this.states.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a state.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<State> {
    return this.states.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deactivate a state. Does not cascade to its districts.',
  })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<State> {
    return this.states.setActive(id, false);
  }
}
