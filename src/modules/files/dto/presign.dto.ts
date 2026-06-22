import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  DEFAULT_ALLOWED_CONTENT_TYPES,
  MAX_UPLOAD_SIZE_BYTES,
  STORAGE_MODULES,
} from '../../../infra/storage/storage-key.util.js';

export class PresignUploadDto {
  @ApiProperty({
    example: 'del',
    enum: STORAGE_MODULES,
    description: 'Owning module slug (whitelisted)',
  })
  @IsString()
  @IsIn(STORAGE_MODULES, {
    message: `module must be one of: ${STORAGE_MODULES.join(', ')}`,
  })
  module: string;

  @ApiProperty({ format: 'uuid', description: 'Entity the file belongs to' })
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9_-]+$/, { message: 'entityId must be alphanumeric' })
  entityId: string;

  @ApiProperty({ example: 'pod-photo.jpg' })
  @IsString()
  @MaxLength(255)
  filename: string;

  @ApiProperty({
    example: 'image/jpeg',
    enum: DEFAULT_ALLOWED_CONTENT_TYPES,
    description:
      'Declared MIME type — enforced by the signed upload policy. Some modules restrict further (e.g. del = images only).',
  })
  @IsString()
  @IsIn(DEFAULT_ALLOWED_CONTENT_TYPES, {
    message: `contentType must be one of: ${DEFAULT_ALLOWED_CONTENT_TYPES.join(', ')}`,
  })
  contentType: string;

  @ApiProperty({
    example: 1048576,
    minimum: 1,
    maximum: MAX_UPLOAD_SIZE_BYTES,
    description:
      'Declared file size in bytes (max 25 MB) — enforced by the signed upload policy.',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_UPLOAD_SIZE_BYTES)
  sizeBytes: number;
}

export class PresignDownloadDto {
  @ApiProperty({ description: 'Object key returned by a prior upload presign' })
  @IsString()
  @MaxLength(512)
  key: string;
}
