/**
 * Mustache-compatible {{var}} substitution.
 *
 * - Replaces {{name}}, {{company}}, etc with values from `vars`.
 * - Missing keys are left as-is so they're visible in preview.
 * - Whitespace inside the braces is allowed: {{ name }}.
 */
export function renderTemplate(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) => {
    const v = vars[key];
    return v === undefined || v === null || v === '' ? whole : v;
  });
}

/**
 * Strict variant: throws if any referenced key is missing or empty.
 * Used at send time as a final safeguard.
 */
export function renderTemplateStrict(
  template: string,
  vars: Record<string, string | undefined>,
): string {
  const missing: string[] = [];
  const out = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_whole, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null || v === '') {
      missing.push(key);
      return '';
    }
    return v;
  });
  if (missing.length > 0) {
    throw new Error(`template has unresolved variables: ${missing.join(', ')}`);
  }
  return out;
}
