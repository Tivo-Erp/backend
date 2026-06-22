/**
 * Transactional email templates (INF-005). Plain template functions — no
 * Handlebars/MJML dependency — returning a subject + HTML body. Keep them small
 * and inline-styled so they render in every client.
 *
 * Security: every interpolated value is HTML-escaped via {@link escapeHtml},
 * and URLs are validated against the configured `APP_BASE_URL` (falling back
 * to the base URL itself when they don't match) so caller-supplied data can
 * never inject markup or off-site links.
 */

export type EmailTemplate =
  | 'email_verification'
  | 'password_reset'
  | 'user_invite'
  | 'approval'
  | 'payslip';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Coerce an arbitrary value to a string without risking `[object Object]`. */
function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    default:
      // Objects/arrays/symbols/functions have no meaningful HTML rendering;
      // JSON-encode so we never emit "[object Object]".
      try {
        return JSON.stringify(value) ?? '';
      } catch {
        return '';
      }
  }
}

/** Escape a value for safe interpolation into HTML (text or attribute). */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return stringify(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function appBaseUrl(): string {
  // Mirrors app.config.ts (appBaseUrl). Read lazily so tests/env overrides work.
  return process.env.APP_BASE_URL || 'http://localhost:3000';
}

/**
 * Only allow URLs rooted at the configured app base URL; anything else
 * (javascript:, attacker-controlled hosts, malformed values) falls back to the
 * base URL itself.
 */
function safeUrl(url: unknown): string {
  const base = appBaseUrl();
  if (typeof url !== 'string' || url.length === 0) return base;
  try {
    const parsedBase = new URL(base);
    const parsed = new URL(url);
    if (
      parsed.protocol === parsedBase.protocol &&
      parsed.host === parsedBase.host &&
      url.startsWith(base)
    ) {
      return url;
    }
  } catch {
    /* fall through to base */
  }
  return base;
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;line-height:1.5">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <h2 style="margin:0 0 16px">${title}</h2>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
    <p style="font-size:12px;color:#888">This is an automated message from the ERP system.</p>
  </div></body></html>`;
}

function button(label: string, url: unknown): string {
  const href = escapeHtml(safeUrl(url));
  return `<p><a href="${href}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px">${escapeHtml(label)}</a></p>
  <p style="font-size:13px;color:#555">Or copy this link: <br/>${href}</p>`;
}

export function renderTemplate(
  template: EmailTemplate,
  data: Record<string, any>,
): RenderedEmail {
  switch (template) {
    case 'email_verification':
      return {
        subject: 'Verify your email address',
        html: layout(
          'Confirm your email',
          `<p>Hi ${escapeHtml(data.name ?? 'there')},</p><p>Please confirm your email address to activate your account.</p>${button('Verify email', data.url)}`,
        ),
        text: `Verify your email: ${safeUrl(data.url)}`,
      };
    case 'password_reset':
      return {
        subject: 'Reset your password',
        html: layout(
          'Password reset',
          `<p>Hi ${escapeHtml(data.name ?? 'there')},</p><p>We received a request to reset your password. This link expires in ${escapeHtml(data.ttlMinutes ?? 30)} minutes. If you didn't ask for this, ignore this email.</p>${button('Reset password', data.url)}`,
        ),
        text: `Reset your password: ${safeUrl(data.url)}`,
      };
    case 'user_invite':
      return {
        subject: `You've been invited to ${data.tenantName ?? 'the workspace'}`,
        html: layout(
          'You have an invitation',
          `<p>${escapeHtml(data.inviterName ?? 'An administrator')} invited you to join <b>${escapeHtml(data.tenantName ?? 'the workspace')}</b>.</p>${button('Accept invitation', data.url)}`,
        ),
        text: `Accept your invitation: ${safeUrl(data.url)}`,
      };
    case 'approval':
      return {
        subject: `Approval required: ${data.subject ?? 'pending item'}`,
        html: layout(
          'Approval required',
          `<p>${escapeHtml(data.message ?? 'An item is awaiting your approval.')}</p>${data.url ? button('Review', data.url) : ''}`,
        ),
        text: `${data.message ?? 'An item is awaiting your approval.'} ${data.url ? safeUrl(data.url) : ''}`,
      };
    case 'payslip':
      return {
        subject: `Payslip — ${data.period ?? ''}`,
        html: layout(
          `Payslip ${escapeHtml(data.period ?? '')}`,
          `<p>Hi ${escapeHtml(data.name ?? '')},</p><p>Your net pay for ${escapeHtml(data.period ?? 'this period')} is <b>${escapeHtml(data.netPay ?? '')}</b>.</p>${data.url ? button('View payslip', data.url) : ''}`,
        ),
        text: `Payslip ${data.period ?? ''}: net pay ${data.netPay ?? ''}`,
      };
    default:
      return {
        subject: 'Notification',
        html: layout('Notification', ''),
        text: '',
      };
  }
}
