import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdmissionYearsController } from './admission-years/admission-years.controller';
import { AdmissionYearsService } from './admission-years/admission-years.service';
import { AttendanceGroupsController } from './attendance-groups/attendance-groups.controller';
import { AttendanceGroupsService } from './attendance-groups/attendance-groups.service';
import { HolidaysController } from './holidays/holidays.controller';
import { HolidaysService } from './holidays/holidays.service';
import { AttendanceMarkingService } from './sessions/attendance-marking.service';
import { ClassSessionsController } from './sessions/class-sessions.controller';
import { ClassSessionsService } from './sessions/class-sessions.service';
import { RosterService } from './sessions/roster.service';
import { SessionSeederService } from './sessions/session-seeder.service';
import { StudentAttendanceController } from './sessions/student-attendance.controller';
import { StudentAttendanceQueryService } from './sessions/student-attendance-query.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { GoogleOidcService } from './auth/google-oidc.service';
import { JwtStrategy } from './auth/jwt.strategy';
import { MasterAdminGuard } from './auth/master-admin.guard';
import { RequireTotpEnrolledGuard } from './auth/require-totp-enrolled.guard';
import { TotpService } from './auth/totp.service';
import { DegreesController } from './degrees/degrees.controller';
import { DegreesService } from './degrees/degrees.service';
import { DepartmentsController } from './departments/departments.controller';
import { DepartmentsService } from './departments/departments.service';
import { DesignationsController } from './designations/designations.controller';
import { DesignationsService } from './designations/designations.service';
import { EmployeesController } from './employees/employees.controller';
import { EmployeesService } from './employees/employees.service';
import { AcademicHoliday } from './entities/academic-holiday.entity';
import { AdminRecoveryCode } from './entities/admin-recovery-code.entity';
import { Admin } from './entities/admin.entity';
import { AdmissionYear } from './entities/admission-year.entity';
import { AttendanceAdjustment } from './entities/attendance-adjustment.entity';
import { AttendanceGroup } from './entities/attendance-group.entity';
import { ClassSession } from './entities/class-session.entity';
import { ClassSessionAttendance } from './entities/class-session-attendance.entity';
import { ClassSessionAuditLog } from './entities/class-session-audit-log.entity';
import { Degree } from './entities/degree.entity';
import { Department } from './entities/department.entity';
import { Designation } from './entities/designation.entity';
import { Employee } from './entities/employee.entity';
import { Programme } from './entities/programme.entity';
import { ProgrammeAdmissionYear } from './entities/programme-admission-year.entity';
import { ProgrammeSemester } from './entities/programme-semester.entity';
import { ProgrammeSemesterSubject } from './entities/programme-semester-subject.entity';
import { ProgrammeSemesterSubjectGroupFaculty } from './entities/programme-semester-subject-group-faculty.entity';
import { ProgrammeSemesterSubjectOption } from './entities/programme-semester-subject-option.entity';
import { ProgrammeSemesterSubjectOptionFaculty } from './entities/programme-semester-subject-option-faculty.entity';
import { ProgrammeSemesterSubjectOptionStudent } from './entities/programme-semester-subject-option-student.entity';
import { Regulation } from './entities/regulation.entity';
import { Semester } from './entities/semester.entity';
import { Subject } from './entities/subject.entity';
import { Timetable } from './entities/timetable.entity';
import { TimetableCourse } from './entities/timetable-course.entity';
import { TimetableCourseFaculty } from './entities/timetable-course-faculty.entity';
import { TimetableEntry } from './entities/timetable-entry.entity';
import { TimetablePeriod } from './entities/timetable-period.entity';
import { MigrationsController } from './migrations/migrations.controller';
import { MigrationsService } from './migrations/migrations.service';
import { ProgrammeAdmissionYearsController } from './programme-admission-years/programme-admission-years.controller';
import { ProgrammeAdmissionYearsService } from './programme-admission-years/programme-admission-years.service';
import { ProgrammeSemesterSubjectsController } from './programme-semester-subjects/programme-semester-subjects.controller';
import { ProgrammeSemesterSubjectsService } from './programme-semester-subjects/programme-semester-subjects.service';
import { SlotEnrollmentsController } from './programme-semester-subjects/slot-enrollments.controller';
import { SlotEnrollmentsService } from './programme-semester-subjects/slot-enrollments.service';
import { ProgrammeSemestersController } from './programme-semesters/programme-semesters.controller';
import { ProgrammeSemestersService } from './programme-semesters/programme-semesters.service';
import { ProgrammesController } from './programmes/programmes.controller';
import { ProgrammesService } from './programmes/programmes.service';
import { RegulationsController } from './regulations/regulations.controller';
import { RegulationsService } from './regulations/regulations.service';
import { SemestersController } from './semesters/semesters.controller';
import { SemestersService } from './semesters/semesters.service';
import { EmployeeAuthModule } from '../employee/auth/employee-auth.module';
import { Student } from './entities/student.entity';
import { StudentGroup } from './entities/student-group.entity';
import { StudentGroupHistory } from './entities/student-group-history.entity';
import { StudentSubjectAttendance } from './entities/student-subject-attendance.entity';
import { StudentModule } from '../student/student.module';
import { StudentsController } from './students/students.controller';
import { StudentsService } from './students/students.service';
import { SubjectType } from './entities/subject-type.entity';
import { SubjectTypeMarkStructure } from './entities/subject-type-mark-structure.entity';
import { SubjectTypeMarkStructuresController } from './subject-type-mark-structures/subject-type-mark-structures.controller';
import { SubjectTypeMarkStructuresService } from './subject-type-mark-structures/subject-type-mark-structures.service';
import { SubjectTypesController } from './subject-types/subject-types.controller';
import { SubjectTypesService } from './subject-types/subject-types.service';
import { SubjectsController } from './subjects/subjects.controller';
import { SubjectsService } from './subjects/subjects.service';
import { TimetablesController } from './timetables/timetables.controller';
import { TimetablesService } from './timetables/timetables.service';
import { AdminUsersController } from './users/admin-users.controller';
import { AdminUsersService } from './users/admin-users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AcademicHoliday,
      Admin,
      AdminRecoveryCode,
      AdmissionYear,
      AttendanceAdjustment,
      AttendanceGroup,
      ClassSession,
      ClassSessionAttendance,
      ClassSessionAuditLog,
      Degree,
      Department,
      Designation,
      Employee,
      Programme,
      ProgrammeAdmissionYear,
      ProgrammeSemester,
      ProgrammeSemesterSubject,
      ProgrammeSemesterSubjectGroupFaculty,
      ProgrammeSemesterSubjectOption,
      ProgrammeSemesterSubjectOptionFaculty,
      ProgrammeSemesterSubjectOptionStudent,
      Regulation,
      Semester,
      Student,
      StudentGroup,
      StudentGroupHistory,
      StudentSubjectAttendance,
      Subject,
      SubjectType,
      SubjectTypeMarkStructure,
      Timetable,
      TimetablePeriod,
      TimetableCourse,
      TimetableCourseFaculty,
      TimetableEntry,
    ]),
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'admin-jwt' }),
    JwtModule.register({}),
    StudentModule,
    EmployeeAuthModule,
  ],
  controllers: [
    AdminController,
    MigrationsController,
    AdminUsersController,
    DegreesController,
    DepartmentsController,
    DesignationsController,
    EmployeesController,
    AdmissionYearsController,
    AttendanceGroupsController,
    ClassSessionsController,
    HolidaysController,
    StudentAttendanceController,
    SemestersController,
    ProgrammesController,
    ProgrammeSemestersController,
    ProgrammeAdmissionYearsController,
    ProgrammeSemesterSubjectsController,
    SlotEnrollmentsController,
    RegulationsController,
    StudentsController,
    SubjectsController,
    SubjectTypesController,
    SubjectTypeMarkStructuresController,
    TimetablesController,
  ],
  providers: [
    AdminService,
    AdminUsersService,
    DegreesService,
    DepartmentsService,
    DesignationsService,
    EmployeesService,
    AdmissionYearsService,
    AttendanceGroupsService,
    AttendanceMarkingService,
    ClassSessionsService,
    HolidaysService,
    RosterService,
    StudentAttendanceQueryService,
    SemestersService,
    ProgrammesService,
    ProgrammeSemestersService,
    ProgrammeAdmissionYearsService,
    ProgrammeSemesterSubjectsService,
    SessionSeederService,
    SlotEnrollmentsService,
    RegulationsService,
    StudentsService,
    SubjectsService,
    SubjectTypesService,
    SubjectTypeMarkStructuresService,
    TimetablesService,
    JwtStrategy,
    MigrationsService,
    TotpService,
    GoogleOidcService,
    RequireTotpEnrolledGuard,
    MasterAdminGuard,
  ],
  exports: [AdminService],
})
export class AdminModule {}
