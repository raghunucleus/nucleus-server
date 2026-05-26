import { Module } from '@nestjs/common';

/**
 * Senior-management endpoints (read-only roll-ups across departments) land
 * here. Each handler MUST follow the RBAC enforcement contract — see
 * nucleus-server/CLAUDE.md.
 */
@Module({})
export class ManagementModule {}
