import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiBody,
  ApiParam,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { UserService } from '../services/user.service.js';
import { InviteUserDto, UpdateUserDto } from '../dto/user.dto.js';
import {
  CurrentTenant,
  CurrentUserRoles,
  RequirePermissions,
} from '../../../common/decorators/index.js';
import { PaginatedFieldsQueryDto } from '../../../common/dto/fields-query.dto.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { USER_FIELD_CONFIG } from '../config/user.field-config.js';
import { IsOptional, IsString, IsUUID } from 'class-validator';

class UserQueryDto extends PaginatedFieldsQueryDto {
  /** Filter by user status: active, invited, suspended */
  @IsOptional()
  @IsString()
  status?: string;

  /** Full-text search on user name/email */
  @IsOptional()
  @IsString()
  search?: string;

  /** Filter users by role ID */
  @IsOptional()
  @IsUUID()
  roleId?: string;
}

@ApiTags('UAM — Users')
@ApiBearerAuth('JWT-Auth')
@Controller('api/v1/uam/users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post('invite')
  @RequirePermissions('uam:user:create')
  @ApiOperation({
    summary: 'Invite User',
    description: 'Invite a new user to the tenant. Sends invitation email.',
  })
  @ApiBody({ type: InviteUserDto })
  @ApiResponse({ status: 201, description: 'User invited' })
  @ApiResponse({ status: 409, description: 'Email already exists in tenant' })
  async invite(@CurrentTenant() tenantId: string, @Body() dto: InviteUserDto) {
    return this.userService.invite(tenantId, dto);
  }

  @Get()
  @RequirePermissions('uam:user:read')
  @ApiOperation({
    summary: 'List Users',
    description: 'Paginated user list with Sparse Fieldsets support.',
  })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(USER_FIELD_CONFIG),
    example: 'id,email,firstName,lastName,status',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated user list with selected fields',
  })
  async findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() userRoles: string[],
    @Query() query: UserQueryDto,
  ) {
    return this.userService.findAll(tenantId, query, userRoles);
  }

  @Patch(':id')
  @RequirePermissions('uam:user:update')
  @ApiOperation({
    summary: 'Update User',
    description: 'Partial update of user profile/roles.',
  })
  @ApiParam({ name: 'id', description: 'User UUID', format: 'uuid' })
  @ApiBody({ type: UpdateUserDto })
  @ApiResponse({ status: 200, description: 'User updated' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.userService.update(tenantId, id, dto);
  }

  @Post(':id/deactivate')
  @RequirePermissions('uam:user:delete')
  @ApiOperation({
    summary: 'Deactivate User',
    description: 'Soft-deactivate a user account. Revokes all sessions.',
  })
  @ApiParam({ name: 'id', description: 'User UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'User deactivated' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async deactivate(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.userService.deactivate(tenantId, id);
  }
}
