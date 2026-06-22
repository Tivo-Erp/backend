import { Body, Controller, HttpStatus, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { StorageService } from '../../infra/storage/storage.service.js';
import {
  DEFAULT_ALLOWED_CONTENT_TYPES,
  MODULE_CONTENT_TYPES,
} from '../../infra/storage/storage-key.util.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import {
  CurrentTenant,
  RequirePermissions,
} from '../../common/decorators/index.js';
import { PresignUploadDto, PresignDownloadDto } from './dto/presign.dto.js';

/**
 * INF-003 — pre-signed upload/download URLs. Upload builds a tenant-scoped key
 * server-side and signs a POST policy pinning key, content type and size;
 * download validates the supplied key against the caller's tenant prefix so
 * one tenant can never presign another's object.
 */
@ApiTags('Files')
@ApiBearerAuth('JWT-Auth')
@Controller('api/v1/files')
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @Post('presign')
  @RequirePermissions('file:upload')
  @ApiOperation({
    summary: 'Get a policy-constrained pre-signed upload (tenant-scoped key)',
    description:
      'Returns a POST `url` plus `fields` to include in a multipart/form-data upload. ' +
      'The signed policy enforces the declared contentType and a 1..sizeBytes length range.',
  })
  async presignUpload(
    @CurrentTenant() tenantId: string,
    @Body() dto: PresignUploadDto,
  ) {
    const allowed =
      MODULE_CONTENT_TYPES[dto.module] ?? DEFAULT_ALLOWED_CONTENT_TYPES;
    if (!allowed.includes(dto.contentType)) {
      throw new BusinessException(
        'FILE_CONTENT_TYPE_NOT_ALLOWED',
        `contentType "${dto.contentType}" is not allowed for module "${dto.module}" (allowed: ${allowed.join(', ')})`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const key = this.storage.buildKey(
      tenantId,
      dto.module,
      dto.entityId,
      dto.filename,
    );
    return this.storage.presignUpload(key, dto.contentType, dto.sizeBytes);
  }

  @Post('presign/download')
  @RequirePermissions('file:read')
  @ApiOperation({ summary: 'Get a short-lived pre-signed download URL' })
  async presignDownload(
    @CurrentTenant() tenantId: string,
    @Body() dto: PresignDownloadDto,
  ) {
    this.storage.assertTenantOwnsKey(tenantId, dto.key);
    return this.storage.presignDownload(dto.key);
  }
}
