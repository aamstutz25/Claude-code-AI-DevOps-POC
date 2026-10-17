import { describe, expect, it } from 'vitest';
import { splitBatches } from '../../scripts/migrate.js';

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
