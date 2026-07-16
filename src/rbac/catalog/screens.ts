import type { ScreenDef } from './types';

/**
 * Initial seed of employee-facing screens. Engineering owns this list — to add
 * a new screen, append a ScreenDef and ship the matching page in the relevant
 * frontend. The catalog validator at boot ensures `module_key`,
 * `role_type_keys[]`, and every `attributes[].type` resolve.
 *
 * Conventions:
 *   - `key` is dot-separated: <module>.<resource>.<action-or-view>
 *   - `actions[]` are intra-screen permissions; assignments grant a subset
 *   - `attributes[]` are the data scope (department, programme, year, ...)
 *     the screen needs to constrain its queries. Missing required attributes
 *     on an assignment block save; missing values at runtime render an empty
 *     state instead of the screen content.
 */
export const SCREENS: ReadonlyArray<ScreenDef> = [
  // --- Employee ----------------------------------------------------------
  {
    key: 'employee.id_card.view',
    module_key: 'employee',
    role_type_keys: ['employee'],
    platforms: ['web', 'mobile'],
    label: 'ID card',
    description: 'View your own employee ID card.',
    web_route: '/id-card',
    mobile_route: '/id-card',
    actions: ['view'],
    attributes: [],
  },
  // Events screen temporarily removed — not yet built on web or mobile.
  // {
  //   key: 'employee.events.view',
  //   module_key: 'employee',
  //   role_type_keys: ['employee'],
  //   platforms: ['web', 'mobile'],
  //   label: 'Events',
  //   description: 'View institution events.',
  //   web_route: '/employee/events',
  //   mobile_route: '/employee/events',
  //   actions: ['view'],
  //   attributes: [],
  // },
  {
    key: 'employee.holiday_calendar.view',
    module_key: 'employee',
    role_type_keys: ['employee'],
    platforms: ['web', 'mobile'],
    label: 'Holidays',
    description: 'View the institution holidays.',
    web_route: '/academic-holidays',
    mobile_route: '/holiday-calendar',
    actions: ['view'],
    attributes: [],
  },
  {
    key: 'employee.birthdays.view',
    module_key: 'employee',
    role_type_keys: ['employee'],
    platforms: ['web', 'mobile'],
    label: 'Birthdays',
    description: 'View birthdays of colleagues in your department.',
    web_route: '/birthdays',
    mobile_route: '/birthdays',
    actions: ['view'],
    attributes: [],
  },

  // --- Attendance --------------------------------------------------------
  //
  // Both attendance screens are intrinsically teacher-self-scoped: the server
  // always filters class_sessions by `effective_employee_id = req.user.id`,
  // so neither needs a per-attribute scope. Granting the screen IS the grant.
  // A teacher can only ever see / mark their own sessions; substitutes get
  // visibility automatically because the session's effective_employee_id is
  // already flipped to them.
  {
    key: 'attendance.entry.daily',
    module_key: 'attendance',
    role_type_keys: ['teacher'],
    platforms: ['web', 'mobile'],
    label: 'Mark attendance',
    description:
      "List the teacher's own class sessions for a day and mark attendance per student.",
    web_route: '/attendance/mark',
    mobile_route: '/attendance/mark',
    actions: ['view', 'update'],
    attributes: [],
  },
  {
    key: 'attendance.entry.history',
    module_key: 'attendance',
    role_type_keys: ['teacher'],
    platforms: ['web', 'mobile'],
    label: 'Attendance history',
    description:
      "Review the teacher's previously marked sessions in a date window.",
    web_route: '/attendance/history',
    mobile_route: '/attendance/history',
    actions: ['view'],
    attributes: [],
  },

  // --- Time table --------------------------------------------------------
  //
  // Teacher-self-scoped, like the attendance screens: the server filters
  // class_sessions by `effective_employee_id = req.user.id`, so the screen
  // grant IS the scope. Substitutes get visibility automatically because
  // the session's effective_employee_id is flipped to them on substitution.
  {
    key: 'timetable.teacher.view',
    module_key: 'timetable',
    role_type_keys: ['teacher'],
    platforms: ['web', 'mobile'],
    label: 'My Timetable',
    description:
      "Week view of the teacher's class sessions — covers regular teaching and any substitute slots.",
    web_route: '/timetable',
    mobile_route: '/timetable',
    actions: ['view'],
    attributes: [],
  },
  // The incharge surface is split into two screens, both self-scoped via
  // `attendance_group_incharges` (a group may have several in-charges). The
  // server filters every read/write to groups the caller is incharge of, so
  // the screens carry no per-attribute scope. Granting the screen IS the scope.
  {
    // Template management — bell schedule, periods, courses, grid cells,
    // working days, default + clone + delete. Day/week-of operations live
    // on the sibling `timetable.incharge.schedule.manage` screen.
    //   - view : see templates and their structure
    //   - edit : modify template (periods, courses, cells, metadata)
    key: 'timetable.incharge.templates.manage',
    module_key: 'timetable',
    role_type_keys: ['teacher'],
    platforms: ['web'],
    label: 'Timetable Management',
    description:
      'Manage timetable templates for the attendance groups you are incharge of — bell schedule, courses, and the weekly grid.',
    web_route: '/timetable/incharge/templates',
    actions: ['view', 'edit'],
    attributes: [],
  },
  {
    // Schedule (live) management — the week/day surface. Publish a week,
    // cancel a class, assign an alternate teacher, move a class. Template
    // configuration lives on the sibling `…templates.manage` screen.
    //   - view    : see weekly sessions and per-week summaries
    //   - edit    : cancel / uncancel / substitute / move sessions
    //   - publish : seed `class_sessions` for a week from a chosen template
    key: 'timetable.incharge.schedule.manage',
    module_key: 'timetable',
    role_type_keys: ['teacher'],
    platforms: ['web'],
    label: 'Schedule Management',
    description:
      'Run the weekly schedule for the attendance groups you are incharge of — publish weeks, cancel classes, and assign alternate teachers.',
    web_route: '/timetable/incharge/schedule',
    actions: ['view', 'edit', 'publish'],
    attributes: [],
  },

  // --- Examinations ------------------------------------------------------
  {
    // Exam-cell marks upload, scoped to the (programme × admission-year)
    // batches the admin grants on the assignment. The single attribute holds
    // the set of programme_admission_years ids the employee may upload for —
    // wildcard-capable so a college-wide exam cell can be granted everything
    // (including future batches).
    key: 'examinations.marks.upload',
    module_key: 'examinations',
    role_type_keys: ['examcell'],
    platforms: ['web'],
    label: 'Upload marks',
    description:
      'Upload student marks for your assigned programme / admission-year batches.',
    web_route: '/marks/upload',
    actions: ['upload'],
    attributes: [
      {
        key: 'programme_admission_year_ids',
        type: 'ref:programme_admission_year',
        label: 'Programme / Admission year',
        required: false,
        multi: true,
        allow_all: true,
      },
    ],
  },
  {
    // Read-only "Student marks" view of the committed results for a batch —
    // the whole-roster (branch-wise) list and one student's full semester /
    // subject breakdown. This screen is NEVER assigned on its own: it is
    // derived from the marks-upload grant (see PermissionsService.hydrate),
    // so anyone who can upload a batch's marks can also view them, with the
    // exact same `programme_admission_year_ids` scope. It carries the same
    // attribute so the scope helpers resolve identically against this key.
    key: 'examinations.marks.view',
    module_key: 'examinations',
    role_type_keys: ['examcell'],
    platforms: ['web'],
    label: 'Student marks',
    description:
      'View committed student marks (CGPA, SGPA and grades) for your assigned ' +
      'programme / admission-year batches — branch-wise and per student.',
    web_route: '/marks/view',
    actions: ['view'],
    attributes: [
      {
        key: 'programme_admission_year_ids',
        type: 'ref:programme_admission_year',
        label: 'Programme / Admission year',
        required: false,
        multi: true,
        allow_all: true,
      },
    ],
  },

  // --- Security ----------------------------------------------------------
  //
  // Gate-verification screen for security guards: scan a student/employee
  // security-pass QR and confirm the holder is a real, currently-active
  // person. There is no per-attribute scope — a guard verifies anyone who
  // presents a pass, so granting the screen IS the grant. Mobile-only (the
  // scan happens on a phone camera).
  {
    key: 'security.verify.scan',
    module_key: 'security',
    role_type_keys: ['security'],
    platforms: ['mobile'],
    label: 'Verify QR',
    description: 'Scan a student/employee QR to verify their identity.',
    mobile_route: '/security/verify',
    actions: ['scan'],
    attributes: [],
  },

  // --- Corporate Relations -----------------------------------------------
  //
  // Placement / corporate-relations desk. Web-only screens with no
  // per-attribute scope: a placement manager configures the classifier lookups
  // and manages the whole company catalog, while the "Companies" list is
  // filtered to the officer's own assignments server-side from the token's
  // employee id (not via an RBAC attribute). Recording CRM activity
  // (interactions, milestones, contacts) requires no dedicated action — screen
  // access implies it, so those writes are gated on `view`. The manager's more
  // privileged company-master operations keep their own actions
  // (create/edit/activate/assign).
  {
    key: 'corporate_relations.company_management.manage',
    module_key: 'corporate_relations',
    role_type_keys: ['placement'],
    platforms: ['web'],
    label: 'Company Management',
    description: 'Add, edit, activate/deactivate companies and assign employees.',
    web_route: '/corporate-relations/company-management',
    actions: ['view', 'create', 'edit', 'activate', 'assign'],
    attributes: [],
  },
  {
    key: 'corporate_relations.companies.view',
    module_key: 'corporate_relations',
    role_type_keys: ['placement'],
    platforms: ['web'],
    label: 'Companies',
    description: 'View your assigned companies and record interactions.',
    web_route: '/corporate-relations/companies',
    actions: ['view'],
    attributes: [],
  },
  {
    key: 'corporate_relations.company_attributes.manage',
    module_key: 'corporate_relations',
    role_type_keys: ['placement'],
    platforms: ['web'],
    label: 'Company Attributes',
    description:
      'Configure company classifiers: category, industry, type, size, source, hiring modes, roles and tags.',
    web_route: '/corporate-relations/company-attributes',
    actions: ['view', 'create', 'edit', 'activate'],
    attributes: [],
  },

  // --- Requests ------------------------------------------------------------
  //
  // The generic approval-requests framework. BOTH screens are DERIVED, never
  // assigned via roles (see PermissionsService.deriveRequestScreens):
  //   - Approvals is synthesised for employees who are profile verifiers of at
  //     least one batch (programme_admission_year_profile_verifiers) — being a
  //     verifier IS the grant, and every query joins that table for row scope,
  //     so there is no per-attribute scope here.
  //   - My Requests is synthesised for every employee (their own submissions;
  //     self-scoped by the token's employee id).
  {
    key: 'requests.approvals.review',
    module_key: 'requests',
    role_type_keys: ['employee'],
    platforms: ['web', 'mobile'],
    label: 'Approvals',
    description:
      'Review requests awaiting your decision — e.g. profile updates from students of batches you verify. Derived from profile-verifier membership; do not assign via roles.',
    web_route: '/requests/approvals',
    mobile_route: '/approvals',
    actions: ['view', 'approve', 'reject', 'send_back'],
    attributes: [],
  },
  {
    key: 'requests.mine.view',
    module_key: 'requests',
    role_type_keys: ['employee'],
    platforms: ['web', 'mobile'],
    label: 'My Requests',
    description:
      'Requests you submitted and their approval status. Granted automatically to every employee; do not assign via roles.',
    web_route: '/requests/mine',
    mobile_route: '/my-requests',
    actions: ['view'],
    attributes: [],
  },
];
