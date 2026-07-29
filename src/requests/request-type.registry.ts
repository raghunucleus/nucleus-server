import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { ApprovalRequest } from './entities/approval-request.entity';

/** Verdict for a single item inside a request (e.g. one profile field). */
export type ItemVerdict = 'approved' | 'rejected';

/**
 * Who raised a request. Students file their own requests through the student
 * portal; employees file theirs (e.g. a company approval) from the employee
 * portal. Handlers receive this rather than a bare id so an employee id can
 * never be mistaken for a student id.
 */
export interface RequestRequesterRef {
  kind: 'student' | 'employee';
  id: number;
}

/**
 * What the approver decided:
 *  - `{ verdict }` — uniform: the whole request approved or rejected at once.
 *  - `{ verdicts, overall? }` — per-item: a map of type-specific item keys
 *    (e.g. profile field names) to verdicts, opaque to the framework — the
 *    handler validates coverage and keys. There is NO extra request status for
 *    mixed results: when verdicts disagree the approver's `overall` choice
 *    becomes the request status (handlers 400 when it's missing). Per-item
 *    support is a per-type capability — handlers of types without it should
 *    400 on `{ verdicts }` input.
 */
export type DecisionInput = (
  | { verdict: ItemVerdict }
  | { verdicts: Record<string, ItemVerdict>; overall?: ItemVerdict }
) & {
  /**
   * Type-specific edits the approver made while deciding — e.g. a company
   * approver reassigning the employee responsible for a job role. Opaque to
   * the framework; the handler validates the shape and applies it inside the
   * decide transaction, so reviewing and editing stay one atomic act.
   *
   * Handlers that don't support edits must 400 when this is present rather
   * than silently ignoring it — a client that thinks it edited something and
   * didn't is worse than a rejected request.
   */
  overrides?: Record<string, unknown>;
};

/** Overall status a decision resolves to — same vocabulary as item verdicts. */
export type DecidedStatus = ItemVerdict;

export interface DecisionResult {
  status: DecidedStatus;
  /** The request payload annotated with per-item outcomes — persisted verbatim. */
  payload: Record<string, unknown>;
}

/**
 * A request type's parent group in the clients' Modules tree — the tree's
 * shape is (module → types), e.g. "Time and Attendance" → "Attendance
 * Regularization". Handlers declare their own module rather than referencing a
 * central list, so adding a type still never touches the framework; the price
 * is that types sharing a `key` must agree on the rest, which
 * {@link RequestTypeRegistry.catalog} enforces at boot.
 *
 * Shape mirrors `MODULES` in `src/rbac/catalog/modules.ts` (the codebase's
 * established key/label/icon/order vocabulary) but is deliberately NOT that
 * list: those are employee menu modules, and this tree also serves students.
 */
export interface RequestTypeModuleDef {
  key: string;
  label: string;
  /** Lucide icon name — resolved client-side. */
  icon: string;
  order: number;
}

export interface RequestTypeCatalogDef {
  module: RequestTypeModuleDef;
  /** This type's own leaf label, e.g. 'Profile Update'. */
  label: string;
  /** Position within the module. */
  order: number;
}

/** One module and its types — what `GET .../requests/catalog` returns. */
export interface RequestCatalogModule extends RequestTypeModuleDef {
  types: { type: string; label: string; order: number }[];
}

/**
 * The plug-in seam between the generic approval-requests framework and each
 * request type's owning module. The framework knows lifecycle only; everything
 * type-specific — payload shape, what "approve" actually does, per-item
 * verdict semantics, notification copy — is supplied by a handler the owning
 * module registers at boot (`onModuleInit`), e.g. the student-profile module
 * registers the `profile_update` handler. Adding a new request type never
 * touches the framework.
 */
export interface ApprovalRequestTypeHandler {
  /** One of APPROVAL_REQUEST_TYPES, e.g. 'profile_update'. */
  readonly type: string;

  /** How this type presents itself in the clients' Modules tree. */
  readonly catalog: RequestTypeCatalogDef;

  /**
   * Duplicate check, called inside the create transaction (under the
   * framework's per-requester advisory lock, so concurrent submits
   * serialize). Several pending requests of one type may coexist — the type
   * decides what counts as a duplicate (e.g. profile updates reject a field
   * that is already part of an open request). Throw (e.g. 409) to reject.
   */
  assertCreatable?(
    tx: EntityManager,
    requester: RequestRequesterRef,
    payload: Record<string, unknown>,
  ): Promise<void>;

  /**
   * Discriminator for the create/resubmit advisory lock, appended to
   * `approval_requests:`. Defaults to the requester (`<kind>:<id>:<type>`),
   * which is right when duplicates are defined per requester — profile updates
   * clash on the student's own open requests.
   *
   * Return something else when the duplicate rule is keyed on the SUBJECT
   * rather than the requester: two different employees editing one company must
   * take the SAME lock, or both `assertCreatable` checks miss each other's
   * uncommitted row and the company ends up with two open requests.
   *
   * Must be derivable from the payload alone, and must not be used to take a
   * second lock inside `assertCreatable` — two locks acquired in different
   * orders across concurrent transactions is a deadlock.
   */
  lockKeyFor?(
    requester: RequestRequesterRef,
    payload: Record<string, unknown>,
  ): string;

  /**
   * Duplicate check for a sent-back request coming back with a new payload —
   * same contract as {@link assertCreatable} (same transaction, same advisory
   * lock), but the request being resubmitted must be EXCLUDED from whatever
   * "already open" set the type checks against, or it will always clash with
   * itself. Throw (e.g. 409) to reject; the request stays `sent_back`.
   *
   * Omit it and resubmits skip the check entirely — only safe for types whose
   * payloads can't collide.
   */
  assertResubmittable?(
    tx: EntityManager,
    requester: RequestRequesterRef,
    request: ApprovalRequest,
    payload: Record<string, unknown>,
  ): Promise<void>;

  /**
   * Decide the request inside the decide transaction (runs before the status
   * flips). Applies whatever was approved, and returns the overall status plus
   * the payload annotated with per-item outcomes. For `{ verdicts }` input the
   * handler must validate that every item is covered and no unknown keys are
   * present (400 otherwise). Throw (e.g. 409 on a uniqueness clash) to abort
   * the whole decision — the request stays `pending`.
   */
  applyDecision(
    tx: EntityManager,
    request: ApprovalRequest,
    input: DecisionInput,
  ): Promise<DecisionResult>;

  /** Title/body for the requester's decision notification. */
  decisionNotification(
    request: ApprovalRequest,
    status: DecidedStatus,
    note: string | null,
  ): { title: string; body: string };

  /**
   * Optional, view-only: decorate the payload just before a DETAIL view is
   * returned (requester or approver) — e.g. attach short-lived presigned URLs
   * to file references. Whatever this returns is rendered but NEVER persisted;
   * throwing is treated as "no enrichment", never a failed request.
   */
  enrichPayloadForView?(
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

@Injectable()
export class RequestTypeRegistry {
  private readonly handlers = new Map<string, ApprovalRequestTypeHandler>();

  register(handler: ApprovalRequestTypeHandler): void {
    this.handlers.set(handler.type, handler);
  }

  /**
   * The Modules tree: every registered type grouped under its declared module,
   * modules and their types each sorted by `order` (ties broken by label, so
   * the tree can't shuffle between boots).
   *
   * Throws on conflicting definitions of one module key — with handlers
   * self-declaring their module, two types in the same group repeat that
   * definition, and a silent last-writer-wins would make the tree depend on
   * module registration order.
   */
  catalog(): RequestCatalogModule[] {
    const modules = new Map<string, RequestCatalogModule>();
    for (const handler of this.handlers.values()) {
      const { module, label, order } = handler.catalog;
      const existing = modules.get(module.key);
      if (!existing) {
        modules.set(module.key, { ...module, types: [] });
      } else if (
        existing.label !== module.label ||
        existing.icon !== module.icon ||
        existing.order !== module.order
      ) {
        throw new InternalServerErrorException(
          `Request type "${handler.type}" declares module "${module.key}" as ` +
            `${JSON.stringify(module)}, but another type already declared it as ` +
            `${JSON.stringify({ key: existing.key, label: existing.label, icon: existing.icon, order: existing.order })}. ` +
            `Types sharing a module must declare it identically.`,
        );
      }
      modules.get(module.key)!.types.push({ type: handler.type, label, order });
    }

    const byOrder = <T extends { order: number; label: string }>(a: T, b: T) =>
      a.order - b.order || a.label.localeCompare(b.label);
    const tree = [...modules.values()].sort(byOrder);
    for (const m of tree) m.types.sort(byOrder);
    return tree;
  }

  /**
   * Fail loudly on an unregistered type — a decide() must never quietly
   * approve without applying the request's effect.
   */
  get(type: string): ApprovalRequestTypeHandler {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new InternalServerErrorException(
        `No handler registered for request type "${type}"`,
      );
    }
    return handler;
  }
}
