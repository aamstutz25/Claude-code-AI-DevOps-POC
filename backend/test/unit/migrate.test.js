import { describe, expect, it } from 'vitest';
import { splitBatches, substituteVariables } from '../../src/db/sql-script.js';

describe('splitBatches', () => {
  it('splits on lines containing only GO, in any case', () => {
    const script = 'CREATE TABLE a (id INT);\nGO\nINSERT INTO a VALUES (1);\n  go  \n';
    expect(splitBatches(script)).toEqual(['CREATE TABLE a (id INT);', 'INSERT INTO a VALUES (1);']);
  });

  it('does not split on GO inside other text', () => {
    const script = "INSERT INTO a (name) VALUES ('GO team');\nSELECT 'ago';";
    expect(splitBatches(script)).toHaveLength(1);
  });
});

describe('substituteVariables', () => {
  it('replaces sqlcmd-style $(NAME) variables', () => {
    expect(
      substituteVariables('CREATE LOGIN [$(LOGIN)] IN [$(DB_NAME)] -- $(LOGIN)', {
        LOGIN: 'poc_app',
        DB_NAME: 'HelloPoc',
      }),
    ).toBe('CREATE LOGIN [poc_app] IN [HelloPoc] -- poc_app');
  });

  it('fails on a missing or empty variable instead of substituting nothing', () => {
    expect(() => substituteVariables('$(MISSING)', {})).toThrow(
      'SQL variable $(MISSING) is not set',
    );
    expect(() => substituteVariables('$(EMPTY)', { EMPTY: '' })).toThrow(
      'SQL variable $(EMPTY) is not set',
    );
  });

  it('leaves text without variables unchanged', () => {
    expect(substituteVariables("SELECT N'cost: $5'", {})).toBe("SELECT N'cost: $5'");
  });
});
