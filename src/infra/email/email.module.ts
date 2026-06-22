import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service.js';

/** INF-005 — transactional email. Global so auth/HRM/workflow can send. */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
