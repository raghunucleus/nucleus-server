import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GuardianJwtAuthGuard extends AuthGuard('guardian-jwt') {}
