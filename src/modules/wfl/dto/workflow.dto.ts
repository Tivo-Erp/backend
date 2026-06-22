import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginatedFieldsQueryDto } from '../../../common/dto/fields-query.dto.js';

// The engine can execute `approval` (acted on by users) and `notification`
// (auto-executes and advances). `condition`/`action` step types need the
// trigger-automation engine — TODO(ADR-008): re-add once executable.
export const STEP_TYPES = ['approval', 'notification'] as const;
export const APPROVER_TYPES = [
  'user',
  'role',
  'manager',
  'department_head',
] as const;

export class CreateWorkflowStepDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  stepNumber: number;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiProperty({ enum: STEP_TYPES })
  @IsIn(STEP_TYPES)
  stepType: string;

  @ApiPropertyOptional({ enum: APPROVER_TYPES })
  @IsOptional()
  @IsIn(APPROVER_TYPES)
  approverType?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Required when approverType is user or role',
  })
  @IsOptional()
  @IsUUID()
  approverId?: string;

  @ApiPropertyOptional({ description: 'Hours before escalation/timeout' })
  @IsOptional()
  @IsInt()
  @Min(1)
  timeoutHours?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  escalationTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class CreateWorkflowDefinitionDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiProperty({ example: 'purchase_order', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  triggerEntity: string;

  @ApiProperty({ example: 'submitted', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  triggerEvent: string;

  @ApiPropertyOptional({
    description: 'JSON condition, e.g. { grandTotal: { gte: 10000000 } }',
  })
  @IsOptional()
  @IsObject()
  triggerCondition?: Record<string, unknown>;

  @ApiProperty({ type: [CreateWorkflowStepDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateWorkflowStepDto)
  steps: CreateWorkflowStepDto[];
}

export class UpdateWorkflowDefinitionDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  triggerCondition?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: [CreateWorkflowStepDto],
    description: 'If provided, replaces ALL steps',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateWorkflowStepDto)
  steps?: CreateWorkflowStepDto[];
}

/** Start an instance of a workflow against a concrete entity. */
export class StartWorkflowDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  definitionId: string;

  @ApiProperty({ example: 'purchase_order', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  entityType: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  entityId: string;
}

export class WorkflowActionDto {
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class WorkflowDefinitionQueryDto extends PaginatedFieldsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  triggerEntity?: string;
}

export class WorkflowTaskQueryDto extends PaginatedFieldsQueryDto {
  @ApiPropertyOptional({
    description: 'running, completed, rejected, cancelled',
  })
  @IsOptional()
  @IsIn(['running', 'completed', 'rejected', 'cancelled', 'timed_out'])
  status?: string;
}
