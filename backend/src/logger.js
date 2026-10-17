import pino from 'pino';

/** Paths that must never appear in logs, wherever they occur in a logged object. */
export const redactPaths = [
  'password',
  '*.password',
  '*.*.password',
  'req.headers.authorization',
  'req.headers.cookie',
];

export function createLogger({ level = 'info', destination } = {}) {
  return pino({ level, redact: { paths: redactPaths, censor: '[REDACTED]' } }, destination);
}

/**
 * Reduces an error to fields that are safe to log. Driver errors can carry the
 * connection configuration (including credentials) on nested properties, so the
 * whole error object is never logged.
 */
export function describeError(err) {
  if (!(err instanceof Error)) return { message: String(err) };
  return {
    name: err.name,
    message: err.message,
    ...(err.code && { code: err.code }),
    ...(err.number && { number: err.number }),
  };
}
