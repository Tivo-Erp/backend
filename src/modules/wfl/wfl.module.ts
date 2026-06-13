import { Module } from '@nestjs/common';
import { NtfModule } from '../ntf/ntf.module.js';
import {
  WorkflowDefinitionController,
  WorkflowTaskController,
} from './controllers/workflow.controller.js';
import { WorkflowDefinitionService } from './services/workflow-definition.service.js';
import { WorkflowEngineService } from './services/workflow-engine.service.js';

@Module({
  imports: [NtfModule],
  controllers: [WorkflowDefinitionController, WorkflowTaskController],
  providers: [WorkflowDefinitionService, WorkflowEngineService],
  exports: [WorkflowEngineService],
})
export class WflModule {}
