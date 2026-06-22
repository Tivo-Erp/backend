import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SearchService } from './search.service.js';
import { SearchQueryDto } from './dto/search-query.dto.js';
import {
  CurrentTenant,
  CurrentUser,
  RequirePermissions,
} from '../../common/decorators/index.js';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface.js';

/** INF-004 — global full-text search across whitelisted entities. */
@ApiTags('Search')
@ApiBearerAuth('JWT-Auth')
@Controller('api/v1/search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @RequirePermissions('search:read')
  @ApiOperation({
    summary: 'Global search',
    description:
      'Tenant-scoped full-text search. `?q=` (min 2 chars), optional `?types=item,customer,...`.',
  })
  async query(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Query() dto: SearchQueryDto,
  ) {
    return this.search.search(tenantId, dto.q, dto.types, dto.limit ?? 20, {
      permissions: user.permissions ?? [],
      isSuperAdmin: !!user.isSuperAdmin,
    });
  }
}
