import { Module } from '@nestjs/common';
import { DocumentSequenceService } from '../../infra/sequence/document-sequence.service.js';
import {
  ProjectController,
  TimesheetController,
} from './controllers/pmo.controller.js';
import { ProjectService } from './services/project.service.js';
import { TaskService } from './services/task.service.js';
import { TimesheetService } from './services/timesheet.service.js';

@Module({
  controllers: [ProjectController, TimesheetController],
  providers: [ProjectService, TaskService, TimesheetService, DocumentSequenceService],
  exports: [ProjectService, TaskService, TimesheetService],
})
export class PmoModule {}
