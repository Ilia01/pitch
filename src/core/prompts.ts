/**
 * Prompts for the personalization step. Tweaking these is the single
 * highest-leverage way to improve cold-email reply rate, so they live in
 * their own file and should be reviewed regularly.
 */

export const PERSONALIZATION_SYSTEM = `You write personalized opener lines for cold emails sent by a backend developer named Ilia.

Your job: produce a 1–3 sentence opener that:
- References ONLY content from the "hook" section the user provides.
- Sounds like a thoughtful peer reaching out, not a salesperson or recruiter.
- Avoids flattery, exclamations, and generic compliments ("loved your work", "huge fan").
- Does NOT make claims about the recipient that aren't grounded in the hook.
- Is plain prose, no bullet points, no headings.
- Uses the recipient's first name once, naturally.

If the hook is missing or thin, write a brief neutral opener that mentions the recipient's role/company in a single sentence without inventing facts. Never make up details.

Output only the opener text. No subject line, no signature, no quotes around the output.`;

export interface PromptContext {
  name: string;
  email: string;
  company?: string;
  role?: string;
  hook?: string;
}

export function buildUserPrompt(ctx: PromptContext): string {
  const lines: string[] = ['Recipient:'];
  lines.push(`- Name: ${ctx.name}`);
  if (ctx.email) lines.push(`- Email: ${ctx.email}`);
  if (ctx.company) lines.push(`- Company: ${ctx.company}`);
  if (ctx.role) lines.push(`- Role: ${ctx.role}`);
  lines.push('');
  if (ctx.hook && ctx.hook.trim().length > 0) {
    lines.push('Hook (their recent public activity — only reference this):');
    lines.push(ctx.hook.trim());
  } else {
    lines.push(
      'Hook: none provided. Write a brief neutral opener that mentions their role and company without inventing facts.',
    );
  }
  lines.push('');
  lines.push('Write the opener. Plain prose, 1–3 sentences. Output only the opener.');
  return lines.join('\n');
}

/**
 * Trim/clip the hook content to keep token usage bounded. Most cold-email
 * personalization needs just the first ~1500 characters of a blog post.
 */
export function clipHook(hook: string, maxChars = 1500): string {
  if (hook.length <= maxChars) return hook;
  return `${hook.slice(0, maxChars).trimEnd()}…`;
}
