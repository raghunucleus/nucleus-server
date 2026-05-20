import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class StudentJwtAuthGuard extends AuthGuard('student-jwt') {}
