import { Module } from '@nestjs/common';
import { FinModule } from '../fin/fin.module.js';
import { NtfModule } from '../ntf/ntf.module.js';
import { EmployeeController } from './controllers/employee.controller.js';
import { LeaveController } from './controllers/leave.controller.js';
import { PayrollController } from './controllers/payroll.controller.js';
import { EmployeeService } from './services/employee.service.js';
import { LeaveService } from './services/leave.service.js';
import { PayrollService } from './services/payroll.service.js';

@Module({
  imports: [FinModule, NtfModule],
  controllers: [EmployeeController, LeaveController, PayrollController],
  providers: [EmployeeService, LeaveService, PayrollService],
  exports: [EmployeeService, LeaveService, PayrollService],
})
export class HrmModule {}
