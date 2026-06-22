import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RbacGuard } from '../../../common/guards/rbac.guard.js';
import { TenantGuard } from '../../../common/guards/tenant.guard.js';
import {
  CurrentTenant,
  CurrentUserRoles,
  RequirePermissions,
} from '../../../common/decorators/index.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { PaginatedFieldsQueryDto } from '../../../common/dto/fields-query.dto.js';
import { ITEM_FIELD_CONFIG } from '../config/item.field-config.js';
import { ItemService } from '../services/item.service.js';
import { CreateItemDto } from '../dto/create-item.dto.js';
import { UpdateItemDto } from '../dto/update-item.dto.js';
import { ItemQueryDto } from '../dto/item-query.dto.js';
import {
  BulkImportItemsDto,
  BulkImportResultDto,
} from '../dto/bulk-import-items.dto.js';

@ApiTags('Master Data — Items')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('master-data/items')
export class ItemController {
  constructor(private readonly itemService: ItemService) {}

  @Post()
  @RequirePermissions('mat:item:create')
  @ApiOperation({ summary: 'Create a new item (SKU)' })
  @ApiResponse({ status: 201, description: 'Item created' })
  @ApiResponse({ status: 409, description: 'SKU duplicate' })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateItemDto) {
    return this.itemService.create(tenantId, dto);
  }

  @Get()
  @RequirePermissions('mat:item:read')
  @ApiOperation({ summary: 'List items with pagination and filters' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(ITEM_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: ItemQueryDto,
  ) {
    return this.itemService.findAll(tenantId, query, roles);
  }

  @Post('import')
  @RequirePermissions('mat:item:import')
  @ApiOperation({ summary: 'Bulk import up to 1000 items' })
  @ApiResponse({ status: 200, type: BulkImportResultDto })
  bulkImport(
    @CurrentTenant() tenantId: string,
    @Body() dto: BulkImportItemsDto,
  ) {
    return this.itemService.bulkImport(tenantId, dto);
  }

  @Get(':id')
  @RequirePermissions('mat:item:read')
  @ApiOperation({ summary: 'Get item by ID' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(ITEM_FIELD_CONFIG),
  })
  @ApiResponse({ status: 404, description: 'Item not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginatedFieldsQueryDto,
  ) {
    return this.itemService.findOne(tenantId, id, roles, query.fields);
  }

  @Patch(':id')
  @RequirePermissions('mat:item:update')
  @ApiOperation({ summary: 'Update item' })
  @ApiResponse({ status: 200, description: 'Item updated' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  @ApiResponse({ status: 409, description: 'SKU duplicate' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateItemDto,
  ) {
    return this.itemService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('mat:item:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete item' })
  @ApiResponse({ status: 204, description: 'Item deleted' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.itemService.remove(tenantId, id);
  }

  @Post(':id/activate')
  @RequirePermissions('mat:item:update')
  @ApiOperation({ summary: 'Activate item (draft → active)' })
  @ApiResponse({ status: 200, description: 'Item activated' })
  @ApiResponse({ status: 400, description: 'Invalid status transition' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  activate(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.itemService.activate(tenantId, id);
  }
}
