import { Module } from '@nestjs/common';
import { TenantController } from './controllers/tenant.controller.js';
import { BranchController } from './controllers/branch.controller.js';
import { TenantService } from './services/tenant.service.js';
import { BranchService } from './services/branch.service.js';
import { TenantRepository } from './repositories/tenant.repository.js';
import { BranchRepository } from './repositories/branch.repository.js';

@Module({
  controllers: [TenantController, BranchController],
  providers: [TenantService, BranchService, TenantRepository, BranchRepository],
  exports: [TenantService],
})
export class OrgModule {}
