import { StorageService } from '../../storage/storage.service';
import { ApprovalRequest } from '../../requests/entities/approval-request.entity';
import { CompanyApprovalService } from './company-approval.service';
import type { CompanyApprovalPayload } from './company-approval.service';
import { Company } from './entities/company.entity';

/** The company's open change request, flattened for the client. */
export const openRequest = (r: ApprovalRequest | undefined) =>
  r
    ? {
        id: r.id,
        status: r.status,
        kind: (r.payload as CompanyApprovalPayload).kind,
      }
    : null;

export interface CompanyChrome {
  logo_url: string | null;
  open_request: ReturnType<typeof openRequest>;
}

/**
 * The two per-company bits every job-role list needs, batched.
 *
 * Both callers list ROLES, and several roles can share one company — so this
 * resolves once per company, never once per row. The open-request lookup is a
 * single query for the whole page (a "change pending" flag must never go N+1),
 * and presigned URLs are cached per key but still cost a call, so the caller
 * hands over deduplicated companies.
 */
export async function companyChromeFor(
  companies: Company[],
  storage: StorageService,
  approvals: CompanyApprovalService,
): Promise<Map<number, CompanyChrome>> {
  if (companies.length === 0) return new Map();

  const openRequests = await approvals.openRequestsForCompanies(
    companies.map((c) => c.id),
  );
  const entries = await Promise.all(
    companies.map(
      async (c) =>
        [
          c.id,
          {
            logo_url: c.logo_key
              ? await storage.getCachedReadUrl(c.logo_key)
              : null,
            open_request: openRequest(openRequests.get(c.id)),
          },
        ] as const,
    ),
  );
  return new Map(entries);
}
