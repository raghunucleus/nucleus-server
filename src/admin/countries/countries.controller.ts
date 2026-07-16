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
import { CreateCountryDto } from '../dto/create-country.dto';
import { ListCountriesDto } from '../dto/list-countries.dto';
import { UpdateCountryDto } from '../dto/update-country.dto';
import { Country } from '../entities/country.entity';
import { CountriesService, ListCountriesResult } from './countries.service';

// No delete route by design — deactivate only, matching every other admin
// master list. States reference countries with ON DELETE RESTRICT anyway.
@ApiTags('countries')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/countries')
export class CountriesController {
  constructor(private readonly countries: CountriesService) {}

  @Get()
  @ApiOperation({
    summary: 'List countries with server-side pagination, search, and sort.',
  })
  list(@Query() query: ListCountriesDto): Promise<ListCountriesResult> {
    return this.countries.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single country by ID.' })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<Country> {
    return this.countries.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new country.' })
  create(@Body() dto: CreateCountryDto): Promise<Country> {
    return this.countries.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a country.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCountryDto,
  ): Promise<Country> {
    return this.countries.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a country.' })
  activate(@Param('id', ParseIntPipe) id: number): Promise<Country> {
    return this.countries.setActive(id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Deactivate a country. Does not cascade to its states or districts.',
  })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<Country> {
    return this.countries.setActive(id, false);
  }
}
