/**
 * Static catalog of approvable actions.
 *
 * An "action" is a thing somewhere in the product that needs a human sign-off
 * — e.g. approving a company added to the corporate-relations directory. Admins
 * assign employees as approvers per action (see `approval_action_approvers`);
 * the screens that actually run those approvals read the resulting lists back
 * through {@link ApprovalApproversService}.
 *
 * The catalog lives in code, not the database: adding an action is a one-entry
 * append here — no migration, no seed row that can drift from the key strings
 * the rest of the codebase references. Shape follows the other static
 * registries in this repo (`src/rbac/catalog/screens.ts`,
 * `src/student/profile/profile-fields.ts`): typed literal array, derived lookup
 * map, validated at boot.
 */

export interface ApprovalActionGroupDef {
  /** Stable grouping key — presentation only, never stored. */
  key: string;
  label: string;
  order: number;
}

export interface ApprovalActionDef {
  /**
   * Stable identifier. THIS STRING IS STORED IN THE DATABASE
   * (`approval_action_approvers.action_key`) — renaming one orphans every
   * approver row assigned to it, so a rename needs a data migration.
   */
  key: string;
  group_key: string;
  label: string;
  description?: string;
  order: number;
}

export const APPROVAL_ACTION_GROUPS: ReadonlyArray<ApprovalActionGroupDef> = [
  { key: 'corporate_relations', label: 'Corporate Relations', order: 10 },
];

export const APPROVAL_ACTIONS: ReadonlyArray<ApprovalActionDef> = [
  {
    key: 'corporate_relations.company',
    group_key: 'corporate_relations',
    label: 'Company Approvals',
    description:
      'Approve companies added/edited to the corporate-relations directory before they go live.',
    order: 10,
  },
];

/** Max length of `approval_action_approvers.action_key` — keys must fit. */
export const APPROVAL_ACTION_KEY_MAX_LENGTH = 64;

export const APPROVAL_ACTION_BY_KEY: ReadonlyMap<string, ApprovalActionDef> =
  new Map(APPROVAL_ACTIONS.map((a) => [a.key, a]));

export const APPROVAL_ACTION_GROUP_BY_KEY: ReadonlyMap<
  string,
  ApprovalActionGroupDef
> = new Map(APPROVAL_ACTION_GROUPS.map((g) => [g.key, g]));

export function isApprovalActionKey(key: string): boolean {
  return APPROVAL_ACTION_BY_KEY.has(key);
}

export function approvalActionOrThrow(key: string): ApprovalActionDef {
  const action = APPROVAL_ACTION_BY_KEY.get(key);
  if (!action) throw new Error(`Unknown approval action: ${key}`);
  return action;
}

/** Catalog order: group order, then action order, then label. */
export function sortedApprovalActions(): ApprovalActionDef[] {
  return [...APPROVAL_ACTIONS].sort((a, b) => {
    const ga = APPROVAL_ACTION_GROUP_BY_KEY.get(a.group_key)?.order ?? 0;
    const gb = APPROVAL_ACTION_GROUP_BY_KEY.get(b.group_key)?.order ?? 0;
    if (ga !== gb) return ga - gb;
    if (a.order !== b.order) return a.order - b.order;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Fail at boot rather than at request time — a typo'd `group_key` or a
 * duplicated action key would otherwise surface as a half-broken admin screen.
 * Called from `ApprovalApproversModule.onModuleInit`.
 */
export function assertValidApprovalActionCatalog(): void {
  const groupKeys = new Set<string>();
  for (const g of APPROVAL_ACTION_GROUPS) {
    if (groupKeys.has(g.key)) {
      throw new Error(`Duplicate approval action group key: ${g.key}`);
    }
    groupKeys.add(g.key);
  }

  const actionKeys = new Set<string>();
  for (const a of APPROVAL_ACTIONS) {
    if (actionKeys.has(a.key)) {
      throw new Error(`Duplicate approval action key: ${a.key}`);
    }
    actionKeys.add(a.key);
    if (a.key.length > APPROVAL_ACTION_KEY_MAX_LENGTH) {
      throw new Error(
        `Approval action key exceeds ${APPROVAL_ACTION_KEY_MAX_LENGTH} chars: ${a.key}`,
      );
    }
    if (!groupKeys.has(a.group_key)) {
      throw new Error(
        `Approval action "${a.key}" references unknown group: ${a.group_key}`,
      );
    }
  }
}
