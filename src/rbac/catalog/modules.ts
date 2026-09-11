import type { ModuleDef } from './types';

/**
 * Top-level modules that group employee-facing screens. Each module appears
 * as a single tile/section in the employee menu (web + mobile). To add a new
 * module, append it here and reference its `key` from new ScreenDefs.
 */
export const MODULES: ReadonlyArray<ModuleDef> = [
  {
    key: 'employee',
    label: 'Employee',
    icon: 'BookOpen',
    order: 10,
  },
  {
    key: 'requests',
    label: 'Requests',
    icon: 'ClipboardList',
    order: 15,
  },
  {
    // HOD / dean / principal / management analytics. Attribute-scoped (see the
    // `insights.*` screens): the same screens serve an HOD with one department
    // and management with the wildcard.
    key: 'insights',
    label: 'Insights',
    icon: 'BarChart3',
    order: 17,
  },
  {
    key: 'attendance',
    label: 'Attendance',
    icon: 'ClipboardCheck',
    order: 20,
  },
  {
    key: 'timetable',
    label: 'Time Table',
    icon: 'CalendarDays',
    order: 30,
  },
  {
    key: 'examinations',
    label: 'Examinations',
    icon: 'GraduationCap',
    order: 40,
  },
  {
    key: 'students',
    label: 'Students',
    icon: 'Users',
    order: 45,
  },
  {
    key: 'security',
    label: 'Security',
    icon: 'ShieldCheck',
    order: 50,
  },
  {
    key: 'corporate_relations',
    label: 'Corporate Relations',
    icon: 'Briefcase',
    order: 60,
  },
  {
    key: 'drive_management',
    label: 'Drive Management',
    icon: 'CalendarDays',
    order: 65,
  },
  {
    key: 'placement_coordinator',
    label: 'Placement Coordinator',
    icon: 'UserCheck',
    order: 67,
  },

  // {
  //   key: 'academics',
  //   label: 'Academics',
  //   icon: 'BookOpen',
  //   order: 30,
  // },
  // {
  //   key: 'examinations',
  //   label: 'Examinations',
  //   icon: 'GraduationCap',
  //   order: 40,
  // },
  // {
  //   key: 'accounts',
  //   label: 'Accounts',
  //   icon: 'Wallet',
  //   order: 60,
  // },
  // {
  //   key: 'hr',
  //   label: 'HR',
  //   icon: 'IdCard',
  //   order: 70,
  // },
];
