import type { RoleTypeDef } from './types';

/**
 * Functional role types an admin can combine when composing a role. A single
 * composed role can include multiple role types — e.g. an employee who is
 * both HOD of CSE and a teacher would be assigned a role that lists
 * `["hod", "teacher"]` and pulls in the screens for both.
 */
export const ROLE_TYPES: ReadonlyArray<RoleTypeDef> = [
  {
    key: 'employee',
    label: 'Employee',
    description: 'Employee basic details like profile etc.',
  },
  {
    key: 'teacher',
    label: 'Teacher',
    description: 'Class teacher — manages day-to-day attendance and marks for assigned courses.',
  },
  // {
  //   key: 'hod',
  //   label: 'HOD',
  //   description: 'Head of department — manages a single department.',
  // },
  // {
  //   key: 'examcell',
  //   label: 'Exam Cell',
  //   description: 'Examination cell member — manages mark structures and marks entry across programmes.',
  // },
  // {
  //   key: 'management',
  //   label: 'Management',
  //   description: 'Senior management — read-only access across departments.',
  // },
  // {
  //   key: 'principal',
  //   label: 'Principal',
  //   description: 'Institution principal — broad access across departments.',
  // },
  // {
  //   key: 'accountant',
  //   label: 'Accountant',
  //   description: 'Accounts staff — fee reports and reconciliation.',
  // },
  // {
  //   key: 'cashier',
  //   label: 'Cashier',
  //   description: 'Front-desk cashier — collects fees.',
  // },
  // {
  //   key: 'config',
  //   label: 'Config Manager',
  //   description: 'Config Manager — manages congigurations of the applications and modifies them when required.',
  // },
  // {
  //   key: 'hr',
  //   label: 'Human Resource',
  //   description: "Manager who takes care of the Leaves, time & attendance, payroll and other HR related activities"
  // }
];
