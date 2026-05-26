import { Module } from '@nestjs/common';

/**
 * Principal endpoints (broad access across departments) land here. Each
 * handler MUST follow the RBAC enforcement contract — see
 * nucleus-server/CLAUDE.md.
 */
@Module({})
export class PrincipalModule {}
