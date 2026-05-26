import { Module } from '@nestjs/common';

/**
 * Accountant endpoints (fee reports, reconciliation) land here. Each handler
 * MUST follow the RBAC enforcement contract — see nucleus-server/CLAUDE.md.
 */
@Module({})
export class AccountantModule {}
