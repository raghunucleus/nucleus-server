import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class EmployeeJwtAuthGuard extends AuthGuard('employee-jwt') {}
