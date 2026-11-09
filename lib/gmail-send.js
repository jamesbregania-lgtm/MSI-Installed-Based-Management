'use strict';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

/**
 * Resolve Resend API key from environment.
 * @returns {string}
 */
function resolveResendApiKey() {
  return String(process.env.RESEND_API_KEY || '').trim();
}

/**
 * Resolve the "from" address for Resend.
 * Uses the verified matsoltechnical.com domain.
 * @returns {string}
 */
function resolveResendFrom() {
  return (
    String(process.env.RESEND_FROM || '').trim() ||
    'MSI Portal <noreply@matsoltechnical.com>'
  );
}

function buildAppLinkEmailBody(kind, inviteRole, linkUrl) {
  function formatInviteRoleLabel(role) {
    const normalized = String(role || '').trim().toLowerCase();
    if (normalized === 'admin') return 'an administrator';
    if (normalized === 'sales') return 'a sales user';
    return 'a technician';
  }
  const getHtmlTemplate = (title, contentLines, buttonText, buttonUrl) => `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; margin: 0; padding: 20px;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f3f4f6;">
    <tr>
      <td align="center">
        <table width="100%" max-width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          <tr>
            <td style="background-color: #112a46; padding: 30px 20px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 1px;">MSI Portal</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              ${contentLines.map(line => `<p style="color: #374151; font-size: 16px; line-height: 1.6; margin-top: 0; margin-bottom: 20px;">${line}</p>`).join('')}
              
              <div style="text-align: center; margin: 35px 0;">
                <a href="${escapeAttr(buttonUrl)}" style="background-color: #112a46; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: 600; display: inline-block;">${buttonText}</a>
              </div>
              
            </td>
          </tr>
          <tr>
            <td style="background-color: #f9fafb; padding: 20px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #9ca3af; font-size: 12px; margin: 0;">If you were not expecting this email, you can safely ignore it.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  if (kind === 'password_reset') {
    return {
      subject: 'Reset your MSI Printer Assets password',
      text: `Reset your password using this link (expires in 24 hours):\n\n${linkUrl}\n\nIf you did not request this, you can ignore this email.`,
      html: getHtmlTemplate(
        'Reset Password',
        [
          'Hello,',
          'We received a request to reset the password for your MSI Printer Assets account.',
          'Please click the button below to securely set a new password. For your protection, this link will expire in 24 hours.'
        ],
        'Reset Password',
        linkUrl
      )
    };
  }

  const roleLabel = formatInviteRoleLabel(inviteRole);
  return {
    subject: 'Complete your MSI Printer Assets account setup',
    text: `You have been invited to join as ${roleLabel}. Complete setup here (expires in 24 hours):\n\n${linkUrl}\n\nIf you were not expecting this, you can ignore this email.`,
    html: getHtmlTemplate(
      'Account Setup',
      [
        'Hello,',
        `You have been invited to join the MSI Printer Assets platform as <strong>${roleLabel}</strong>.`,
        'Please click the button below to complete your account setup and activate your credentials. This invite link will expire in 24 hours.'
      ],
      'Create Account',
      linkUrl
    )
  };
}

/**
 * Send a single transactional email through Resend API.
 * @param {string} to
 * @param {string} subject
 * @param {string} text
 * @param {string} [html]
 * @returns {Promise<{ sent: boolean, skipped: boolean, error?: string, provider?: string }>}
 */
async function sendViaResend(to, subject, text, html) {
  const apiKey = resolveResendApiKey();
  if (!apiKey) {
    return { sent: false, skipped: true };
  }

  const body = {
    from: resolveResendFrom(),
    to: [to],
    subject,
    text,
    ...(html ? { html } : {})
  };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000)
    });

    const raw = await res.text();
    if (!res.ok) {
      let errorMsg = raw || `HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.message) {
          errorMsg = parsed.message;
        }
      } catch (e) {
        // ignore
      }
      return {
        sent: false,
        skipped: false,
        provider: 'resend',
        error: errorMsg
      };
    }

    return { sent: true, skipped: false, provider: 'resend' };
  } catch (err) {
    console.error('sendViaResend:', err);
    return {
      sent: false,
      skipped: false,
      provider: 'resend',
      error: err && err.message ? String(err.message) : String(err)
    };
  }
}

/**
 * Send invite / password-reset email via Resend API.
 * @param {{ to: string, linkUrl: string, kind: 'account_invite'|'password_reset', inviteRole?: string }} opts
 * @returns {Promise<{ sent: boolean, skipped: boolean, error?: string, provider?: string }>}
 */
async function sendGmailAppLink(opts) {
  const to = String(opts.to || '').trim();
  const linkUrl = String(opts.linkUrl || '').trim();
  const kind = opts.kind;
  const inviteRole = String(opts.inviteRole || '').toLowerCase();

  if (!to || !linkUrl) {
    return { sent: false, skipped: true };
  }

  const { subject, text, html } = buildAppLinkEmailBody(kind, inviteRole, linkUrl);

  return await sendViaResend(to, subject, text, html);
}

module.exports = {
  sendGmailAppLink
};
