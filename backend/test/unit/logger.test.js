import { describe, expect, it } from 'vitest';
import { createLogger, describeError } from '../../src/logger.js';

function captureLogger() {
  const lines = [];
  const logger = createLogger({
    level: 'info',
    destination: { write: (line) => lines.push(line) },
  });
  return { logger, lines };
}

describe('logger', () => {
  it('redacts passwords wherever they appear', () => {
    const { logger, lines } = captureLogger();
    logger.info({ password: 'a', db: { password: 'b' }, conn: { auth: { password: 'c' } } }, 'x');
    const output = lines.join('');
    expect(output).not.toMatch(/"(a|b|c)"/);
    expect(output.match(/\[REDACTED\]/g)).toHaveLength(3);
  });
});

describe('describeError', () => {
  it('keeps only safe fields and drops attached connection details', () => {
    const err = Object.assign(new Error('Login failed'), {
      code: 'ELOGIN',
      number: 18456,
      config: { user: 'poc_app', password: 'secret' },
    });
    const described = describeError(err);
    expect(described).toEqual({
      name: 'Error',
      message: 'Login failed',
      code: 'ELOGIN',
      number: 18456,
    });
    expect(JSON.stringify(described)).not.toContain('secret');
  });

  it('handles non-Error values', () => {
    expect(describeError('boom')).toEqual({ message: 'boom' });
  });
});
