import { NqlError, parseNql } from './parser';

describe('NQL parser', () => {
  it('parses a simple comparison', () => {
    expect(parseNql('ug_cgpa >= 7')).toEqual({
      filters: { and: [{ attr: 'ug_cgpa', op: 'gte', value: 7, args: undefined }] },
    });
  });

  it('maps every operator token', () => {
    const cases: Array<[string, string, unknown]> = [
      ['x = 1', 'eq', 1],
      ['x != 1', 'neq', 1],
      ['x > 1', 'gt', 1],
      ['x >= 1', 'gte', 1],
      ['x < 1', 'lt', 1],
      ['x <= 1', 'lte', 1],
      ['x ~ "a"', 'contains', 'a'],
      ['x !~ "a"', 'not_contains', 'a'],
      ['x ^= "a"', 'starts_with', 'a'],
    ];
    for (const [src, op, value] of cases) {
      expect(parseNql(src).filters).toEqual({
        and: [{ attr: 'x', op, value, args: undefined }],
      });
    }
  });

  it('parses IN / NOT IN lists', () => {
    expect(parseNql('programme IN ("B.Tech CSE", 4)').filters).toEqual({
      and: [
        { attr: 'programme', op: 'in', value: ['B.Tech CSE', 4], args: undefined },
      ],
    });
    expect(parseNql('x NOT IN (1, 2)').filters).toEqual({
      and: [{ attr: 'x', op: 'not_in', value: [1, 2], args: undefined }],
    });
  });

  it('parses BETWEEN without stealing the outer AND', () => {
    expect(parseNql('dob BETWEEN "2004-01-01" AND "2006-12-31" AND x = 1').filters).toEqual({
      and: [
        {
          attr: 'dob',
          op: 'between',
          value: ['2004-01-01', '2006-12-31'],
          args: undefined,
        },
        { attr: 'x', op: 'eq', value: 1, args: undefined },
      ],
    });
  });

  it('parses IS NULL / IS NOT NULL', () => {
    expect(parseNql('ug_cgpa IS NULL').filters).toEqual({
      and: [{ attr: 'ug_cgpa', op: 'is_null', args: undefined }],
    });
    expect(parseNql('ug_cgpa IS NOT NULL').filters).toEqual({
      and: [{ attr: 'ug_cgpa', op: 'not_null', args: undefined }],
    });
  });

  it('gives AND higher precedence than OR and honors parens', () => {
    expect(parseNql('a = 1 OR b = 2 AND c = 3').filters).toEqual({
      or: [
        { attr: 'a', op: 'eq', value: 1, args: undefined },
        {
          and: [
            { attr: 'b', op: 'eq', value: 2, args: undefined },
            { attr: 'c', op: 'eq', value: 3, args: undefined },
          ],
        },
      ],
    });
    expect(parseNql('(a = 1 OR b = 2) AND c = 3').filters).toEqual({
      and: [
        {
          or: [
            { attr: 'a', op: 'eq', value: 1, args: undefined },
            { attr: 'b', op: 'eq', value: 2, args: undefined },
          ],
        },
        { attr: 'c', op: 'eq', value: 3, args: undefined },
      ],
    });
  });

  it('parses booleans and keywords case-insensitively', () => {
    expect(parseNql('is_active = true and backlog_history = FALSE').filters).toEqual({
      and: [
        { attr: 'is_active', op: 'eq', value: true, args: undefined },
        { attr: 'backlog_history', op: 'eq', value: false, args: undefined },
      ],
    });
  });

  it('parses a trailing ORDER BY', () => {
    expect(parseNql('ug_cgpa >= 7 ORDER BY ug_cgpa DESC')).toEqual({
      filters: { and: [{ attr: 'ug_cgpa', op: 'gte', value: 7, args: undefined }] },
      sort: { by: 'ug_cgpa', dir: 'desc' },
    });
    expect(parseNql('ORDER BY display_name')).toEqual({
      sort: { by: 'display_name', dir: 'asc' },
    });
  });

  it('parses parameterized attribute call syntax into positional args', () => {
    expect(parseNql('sgpa(3) >= 7.5').filters).toEqual({
      and: [
        {
          attr: 'sgpa',
          op: 'gte',
          value: 7.5,
          args: { __nql_positional: [3] },
        },
      ],
    });
  });

  it('reports errors with a position and near-snippet', () => {
    for (const src of [
      'ug_cgpa >> 7',
      'ug_cgpa >=',
      'x IN ()',
      'x BETWEEN 1',
      '(a = 1',
      'x = "unterminated',
      'x = 1 ORDER display_name',
    ]) {
      let caught: unknown;
      try {
        parseNql(src);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(NqlError);
      expect((caught as NqlError).position).toBeGreaterThanOrEqual(0);
      expect(typeof (caught as NqlError).near).toBe('string');
    }
  });

  it('rejects trailing garbage', () => {
    expect(() => parseNql('a = 1 b = 2')).toThrow(NqlError);
  });
});
