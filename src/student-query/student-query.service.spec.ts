import { BadRequestException } from '@nestjs/common';
import { StudentSearchDto, StudentSearchSchema } from './dto/student-search.dto';
import { assertRegistryValid } from './registry/student-attributes';
import { StudentQueryService } from './student-query.service';

/**
 * Engine tests that need no database: registry sanity, meta surface
 * filtering, and semantic validation failures (all thrown before any query
 * runs — the mocked repository loudly fails if touched).
 */

function makeService(): StudentQueryService {
  const repo = {
    createQueryBuilder: () => {
      throw new Error('query builder must not be touched by validation tests');
    },
  };
  const dataSource = {
    query: () => {
      throw new Error('dataSource must not be touched by validation tests');
    },
  };
  return new StudentQueryService(repo as never, dataSource as never);
}

function dto(body: Record<string, unknown>): StudentSearchDto {
  return StudentSearchSchema.parse(body) as StudentSearchDto;
}

async function expectBadRequest(
  promise: Promise<unknown>,
  matcher: (payload: Record<string, unknown>) => void,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(BadRequestException);
  matcher((caught as BadRequestException).getResponse() as Record<string, unknown>);
}

describe('student-query registry', () => {
  it('is internally consistent', () => {
    expect(() => assertRegistryValid()).not.toThrow();
  });
});

describe('StudentQueryService.meta', () => {
  const svc = makeService();

  it('exposes gov IDs to admin but not employee', () => {
    const adminKeys = svc.meta('admin').attributes.map((a) => a.key);
    const employeeKeys = svc.meta('employee').attributes.map((a) => a.key);
    expect(adminKeys).toContain('aadhaar_number');
    expect(adminKeys).toContain('pan_number');
    expect(employeeKeys).not.toContain('aadhaar_number');
    expect(employeeKeys).not.toContain('pan_number');
  });

  it('carries operator sets and lookup metadata', () => {
    const byKey = new Map(svc.meta('admin').attributes.map((a) => [a.key, a]));
    expect(byKey.get('ug_cgpa')!.operators).toContain('between');
    expect(byKey.get('programme')!.fkLookup).toBe('programmes');
    expect(byKey.get('entry_type')!.enumLabels).toEqual({ 1: 'Regular', 2: 'Lateral' });
    expect(byKey.get('industry_certifications')!.operators).toEqual(['in', 'not_in']);
  });
});

describe('StudentQueryService.search validation', () => {
  const svc = makeService();
  const admin = { surface: 'admin' as const };
  const employee = { surface: 'employee' as const };

  it('rejects an unknown attribute', async () => {
    await expectBadRequest(
      svc.search(dto({ filters: { and: [{ attr: 'nope', op: 'eq', value: 1 }] } }), admin),
      (p) => {
        expect(p.errors).toEqual([
          { path: 'filters.and[0]', message: "Unknown attribute 'nope'." },
        ]);
      },
    );
  });

  it('rejects an operator/kind mismatch', async () => {
    await expectBadRequest(
      svc.search(
        dto({ filters: { and: [{ attr: 'ug_cgpa', op: 'contains', value: '7' }] } }),
        admin,
      ),
      (p) => {
        expect((p.errors as Array<{ message: string }>)[0].message).toMatch(
          /'contains' is not allowed for 'ug_cgpa'/,
        );
      },
    );
  });

  it('rejects a scalar for between and empty in-lists', async () => {
    await expectBadRequest(
      svc.search(
        dto({ filters: { and: [{ attr: 'ug_cgpa', op: 'between', value: 7 }] } }),
        admin,
      ),
      (p) => {
        expect((p.errors as Array<{ message: string }>)[0].message).toMatch(/two-element/);
      },
    );
    await expectBadRequest(
      svc.search(
        dto({ filters: { and: [{ attr: 'programme', op: 'in', value: [] }] } }),
        admin,
      ),
      (p) => {
        expect((p.errors as Array<{ message: string }>)[0].message).toMatch(/non-empty/);
      },
    );
  });

  it('rejects gov-ID attributes on the employee surface but allows them for admin shapes', async () => {
    await expectBadRequest(
      svc.search(
        dto({ filters: { and: [{ attr: 'aadhaar_number', op: 'not_null' }] } }),
        employee,
      ),
      (p) => {
        expect((p.errors as Array<{ message: string }>)[0].message).toMatch(
          /Unknown attribute 'aadhaar_number'/,
        );
      },
    );
  });

  it('rejects unknown columns and unsortable sorts', async () => {
    await expectBadRequest(
      svc.search(dto({ columns: ['nope'] }), admin),
      (p) => {
        expect((p.errors as Array<{ message: string }>)[0].message).toMatch(
          /Unknown column 'nope'/,
        );
      },
    );
    await expectBadRequest(
      svc.search(dto({ sort: { by: 'industry_certifications' } }), admin),
      (p) => {
        expect((p.errors as Array<{ message: string }>)[0].message).toMatch(
          /not sortable/,
        );
      },
    );
  });

  it('rejects NQL syntax errors with a position payload', async () => {
    await expectBadRequest(
      svc.search(dto({ nql: 'ug_cgpa >> 7' }), admin),
      (p) => {
        expect(p.message).toMatch(/^NQL:/);
        expect(typeof p.position).toBe('number');
        expect(typeof p.near).toBe('string');
      },
    );
  });

  it('rejects double sort (NQL ORDER BY + sort field)', async () => {
    await expectBadRequest(
      svc.search(
        dto({ nql: 'ug_cgpa >= 7 ORDER BY ug_cgpa', sort: { by: 'display_name', dir: 'asc' } }),
        admin,
      ),
      (p) => {
        expect(p.message).toMatch(/Sort specified twice/);
      },
    );
  });

  it('rejects arguments on non-parameterized attributes (NQL call syntax)', async () => {
    await expectBadRequest(
      svc.search(dto({ nql: 'ug_cgpa(3) >= 7' }), admin),
      (p) => {
        expect((p.errors as Array<{ message: string }>)[0].message).toMatch(
          /does not take arguments/,
        );
      },
    );
  });

  it('short-circuits empty RBAC scope without touching the database', async () => {
    const result = await svc.search(dto({}), {
      surface: 'employee',
      scope: { programmeIds: [] },
    });
    expect(result.total).toBe(0);
    expect(result.rows).toEqual([]);
  });

  it('rejects filters+nql together at the schema layer', () => {
    expect(() =>
      dto({
        nql: 'ug_cgpa >= 7',
        filters: { and: [{ attr: 'ug_cgpa', op: 'gte', value: 7 }] },
      }),
    ).toThrow();
  });

  it('rejects filter groups nested beyond the depth cap at the schema layer', () => {
    let node: Record<string, unknown> = { attr: 'ug_cgpa', op: 'gte', value: 7 };
    for (let i = 0; i < 6; i += 1) node = { and: [node] };
    expect(() => dto({ filters: node })).toThrow();
  });
});
