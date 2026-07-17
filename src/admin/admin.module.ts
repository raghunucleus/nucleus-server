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
import { CountriesController } from './countries/countries.controller';
import { CountriesService } from './countries/countries.service';
import { DegreesController } from './degrees/degrees.controller';
import { DegreesService } from './degrees/degrees.service';
import { DepartmentsController } from './departments/departments.controller';
import { DepartmentsService } from './departments/departments.service';
import { DesignationsController } from './designations/designations.controller';
import { DesignationsService } from './designations/designations.service';
import { DiplomaBoardsController } from './diploma-boards/diploma-boards.controller';
import { DiplomaBoardsService } from './diploma-boards/diploma-boards.service';
import { DistrictsController } from './districts/districts.controller';
import { DistrictsService } from './districts/districts.service';
import { EmployeesController } from './employees/employees.controller';
import { EmployeesService } from './employees/employees.service';
import { EntranceExamsController } from './entrance-exams/entrance-exams.controller';
import { EntranceExamsService } from './entrance-exams/entrance-exams.service';
import { IndustryCertificationsController } from './industry-certifications/industry-certifications.controller';
import { IndustryCertificationsService } from './industry-certifications/industry-certifications.service';
import { InstitutionSettingsController } from './institution-settings/institution-settings.controller';
import { InstitutionSettingsService } from './institution-settings/institution-settings.service';
import { SchoolBoardsXController } from './school-boards-x/school-boards-x.controller';
import { SchoolBoardsXService } from './school-boards-x/school-boards-x.service';
import { SchoolBoardsXiiController } from './school-boards-xii/school-boards-xii.controller';
import { SchoolBoardsXiiService } from './school-boards-xii/school-boards-xii.service';
import { StatesController } from './states/states.controller';
import { StatesService } from './states/states.service';
import { AcademicHoliday } from './entities/academic-holiday.entity';
import { AdminRecoveryCode } from './entities/admin-recovery-code.entity';
import { Admin } from './entities/admin.entity';
import { AdmissionYear } from './entities/admission-year.entity';
import { AttendanceAdjustment } from './entities/attendance-adjustment.entity';
import { AttendanceGroup } from './entities/attendance-group.entity';
import { AttendanceGroupIncharge } from './entities/attendance-group-incharge.entity';
import { ClassSession } from './entities/class-session.entity';
import { ClassSessionAttendance } from './entities/class-session-attendance.entity';
import { ClassSessionAuditLog } from './entities/class-session-audit-log.entity';
import { Country } from './entities/country.entity';
import { Degree } from './entities/degree.entity';
import { Department } from './entities/department.entity';
import { Designation } from './entities/designation.entity';
import { DiplomaBoard } from './entities/diploma-board.entity';
import { District } from './entities/district.entity';
import { Employee } from './entities/employee.entity';
import { EntranceExam } from './entities/entrance-exam.entity';
import { IndustryCertification } from './entities/industry-certification.entity';
import { InstitutionSetting } from './entities/institution-setting.entity';
import { Programme } from './entities/programme.entity';
import { ProgrammeAdmissionYear } from './entities/programme-admission-year.entity';
import { ProgrammeAdmissionYearProfileVerifier } from './entities/programme-admission-year-profile-verifier.entity';
import { ProgrammeSemester } from './entities/programme-semester.entity';
import { ProgrammeSemesterSubject } from './entities/programme-semester-subject.entity';
import { ProgrammeSemesterSubjectGroupFaculty } from './entities/programme-semester-subject-group-faculty.entity';
import { ProgrammeSemesterSubjectOption } from './entities/programme-semester-subject-option.entity';
import { ProgrammeSemesterSubjectOptionFaculty } from './entities/programme-semester-subject-option-faculty.entity';
import { ProgrammeSemesterSubjectOptionStudent } from './entities/programme-semester-subject-option-student.entity';
import { Regulation } from './entities/regulation.entity';
import { SchoolBoardX } from './entities/school-board-x.entity';
import { SchoolBoardXii } from './entities/school-board-xii.entity';
import { Semester } from './entities/semester.entity';
import { State } from './entities/state.entity';
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
import { GuardianModule } from '../guardian/guardian.module';
import { RbacModule } from '../rbac/rbac.module';
import { StudentGuardian } from '../guardian/entities/student-guardian.entity';
import { GuardiansController } from './guardians/guardians.controller';
import { GuardiansService } from './guardians/guardians.service';
import { Student } from './entities/student.entity';
import { StudentGroup } from './entities/student-group.entity';
import { StudentGroupHistory } from './entities/student-group-history.entity';
import { StudentSubjectAttendance } from './entities/student-subject-attendance.entity';
import { StudentModule } from '../student/student.module';
import { StudentQueryModule } from '../student-query/student-query.module';
import { StudentsController } from './students/students.controller';
import { StudentsSearchController } from './students/students-search.controller';
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
      AttendanceGroupIncharge,
      ClassSession,
      ClassSessionAttendance,
      ClassSessionAuditLog,
      Country,
      Degree,
      Department,
      Designation,
      DiplomaBoard,
      District,
      Employee,
      EntranceExam,
      IndustryCertification,
      InstitutionSetting,
      Programme,
      ProgrammeAdmissionYear,
      ProgrammeAdmissionYearProfileVerifier,
      ProgrammeSemester,
      ProgrammeSemesterSubject,
      ProgrammeSemesterSubjectGroupFaculty,
      ProgrammeSemesterSubjectOption,
      ProgrammeSemesterSubjectOptionFaculty,
      ProgrammeSemesterSubjectOptionStudent,
      Regulation,
      SchoolBoardX,
      SchoolBoardXii,
      Semester,
      State,
      Student,
      StudentGuardian,
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
    GuardianModule,
    EmployeeAuthModule,
    // PermissionsService — programme-admission-years invalidates verifier
    // employees' cached access when their profile-verifier set changes.
    RbacModule,
    // Shared student search engine (POST /admin/students/search).
    StudentQueryModule,
  ],
  controllers: [
    AdminController,
    MigrationsController,
    AdminUsersController,
    CountriesController,
    DegreesController,
    DepartmentsController,
    DesignationsController,
    DistrictsController,
    StatesController,
    EmployeesController,
    EntranceExamsController,
    IndustryCertificationsController,
    SchoolBoardsXController,
    SchoolBoardsXiiController,
    DiplomaBoardsController,
    InstitutionSettingsController,
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
    // Before StudentsController so the literal 'search' routes are never
    // shadowed by its parameterized 'admin/students/:id'.
    StudentsSearchController,
    StudentsController,
    GuardiansController,
    SubjectsController,
    SubjectTypesController,
    SubjectTypeMarkStructuresController,
    TimetablesController,
  ],
  providers: [
    AdminService,
    AdminUsersService,
    CountriesService,
    DegreesService,
    DepartmentsService,
    DesignationsService,
    DistrictsService,
    StatesService,
    EmployeesService,
    EntranceExamsService,
    IndustryCertificationsService,
    SchoolBoardsXService,
    SchoolBoardsXiiService,
    DiplomaBoardsService,
    InstitutionSettingsService,
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
    GuardiansService,
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
  exports: [
    AdminService,
    // Surfaced to the employee-facing modules so an attendance incharge can
    // wrap the same timetable + session-seeding logic with group-ownership
    // checks instead of forcing them to re-implement the workflow. The PSS,
    // ProgrammeSemesters and Employees services power the lookup endpoints
    // the incharge schedule editor calls when picking subjects, semesters,
    // or employee faculty. ClassSessionsService + RosterService back the
    // incharge's live schedule surface (cancel / substitute / move / list).
    TimetablesService,
    SessionSeederService,
    ProgrammeSemestersService,
    ProgrammeSemesterSubjectsService,
    EmployeesService,
    ClassSessionsService,
    RosterService,
  ],
})
export class AdminModule {}
