import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdmissionYearsController } from './admission-years/admission-years.controller';
import { AdmissionYearsService } from './admission-years/admission-years.service';
import { AttendanceGroupsController } from './attendance-groups/attendance-groups.controller';
import { AttendanceGroupsService } from './attendance-groups/attendance-groups.service';
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
import { AdminRecoveryCode } from './entities/admin-recovery-code.entity';
import { Admin } from './entities/admin.entity';
import { AdmissionYear } from './entities/admission-year.entity';
import { AttendanceGroup } from './entities/attendance-group.entity';
import { Degree } from './entities/degree.entity';
import { Department } from './entities/department.entity';
import { Designation } from './entities/designation.entity';
import { Employee } from './entities/employee.entity';
import { Programme } from './entities/programme.entity';
import { ProgrammeAdmissionYear } from './entities/programme-admission-year.entity';
import { ProgrammeSemester } from './entities/programme-semester.entity';
import { ProgrammeSemesterSubject } from './entities/programme-semester-subject.entity';
import { ProgrammeSemesterSubjectFaculty } from './entities/programme-semester-subject-faculty.entity';
import { ProgrammeSemesterSubjectOption } from './entities/programme-semester-subject-option.entity';
import { ProgrammeSemesterSubjectOptionFaculty } from './entities/programme-semester-subject-option-faculty.entity';
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
import { ProgrammeSemestersController } from './programme-semesters/programme-semesters.controller';
import { ProgrammeSemestersService } from './programme-semesters/programme-semesters.service';
import { ProgrammesController } from './programmes/programmes.controller';
import { ProgrammesService } from './programmes/programmes.service';
import { RegulationsController } from './regulations/regulations.controller';
import { RegulationsService } from './regulations/regulations.service';
import { SemestersController } from './semesters/semesters.controller';
import { SemestersService } from './semesters/semesters.service';
import { Student } from './entities/student.entity';
import { StudentGroup } from './entities/student-group.entity';
import { StudentModule } from '../student/student.module';
import { StudentsController } from './students/students.controller';
import { StudentsService } from './students/students.service';
import { SubjectsController } from './subjects/subjects.controller';
import { SubjectsService } from './subjects/subjects.service';
import { TimetablesController } from './timetables/timetables.controller';
import { TimetablesService } from './timetables/timetables.service';
import { AdminUsersController } from './users/admin-users.controller';
import { AdminUsersService } from './users/admin-users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Admin,
      AdminRecoveryCode,
      AdmissionYear,
      AttendanceGroup,
      Degree,
      Department,
      Designation,
      Employee,
      Programme,
      ProgrammeAdmissionYear,
      ProgrammeSemester,
      ProgrammeSemesterSubject,
      ProgrammeSemesterSubjectFaculty,
      ProgrammeSemesterSubjectOption,
      ProgrammeSemesterSubjectOptionFaculty,
      Regulation,
      Semester,
      Student,
      StudentGroup,
      Subject,
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
    SemestersController,
    ProgrammesController,
    ProgrammeSemestersController,
    ProgrammeAdmissionYearsController,
    ProgrammeSemesterSubjectsController,
    RegulationsController,
    StudentsController,
    SubjectsController,
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
    SemestersService,
    ProgrammesService,
    ProgrammeSemestersService,
    ProgrammeAdmissionYearsService,
    ProgrammeSemesterSubjectsService,
    RegulationsService,
    StudentsService,
    SubjectsService,
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
