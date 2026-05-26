import { Module } from '@nestjs/common';

/**
 * Teacher-specific endpoints (timetable view, marks entry, daily attendance)
 * land here. Each handler MUST follow the RBAC enforcement contract — see
 * nucleus-server/CLAUDE.md and [[hod.module.ts]] for the template.
 */
@Module({})
export class TeacherModule {}
