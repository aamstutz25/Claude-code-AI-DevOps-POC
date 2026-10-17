/** Splits a script into batches on lines containing only GO, like sqlcmd and SSMS. */
export function splitBatches(script) {
  return script
    .split(/^\s*GO\s*$/im)
    .map((batch) => batch.trim())
    .filter(Boolean);
}

/**
 * Replaces sqlcmd-style $(NAME) variables with values from `variables`, so the same
 * script runs under sqlcmd, SSMS (SQLCMD mode) and backend/scripts/run-sql.js.
 * A missing or empty variable is an error rather than an empty substitution.
 */
export function substituteVariables(script, variables) {
  return script.replace(/\$\(([A-Za-z_][A-Za-z0-9_]*)\)/g, (match, name) => {
    const value = variables[name];
    if (value === undefined || value === '') {
      throw new Error(`SQL variable $(${name}) is not set`);
    }
    return value;
  });
}
