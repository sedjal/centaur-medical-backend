import nodemailer from 'nodemailer';
import { createDb, getDb } from '@centaur/shared';

const BRAND = {
  name: 'Centaur Medical',
  primary: '#2563eb',
  teal: '#0f766e',
  text: '#172033',
  muted: '#64748b',
  bg: '#f7f9fc',
  border: '#e5eaf0',
};

/** Inline SVG logo for Centaur Medical (medical cross mark). */
function brandLogoSvg(size = 40): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    <tr>
      <td style="vertical-align:middle;padding-right:12px">
        <div style="width:${size}px;height:${size}px;border-radius:12px;background:linear-gradient(135deg,${BRAND.primary},${BRAND.teal});text-align:center;line-height:${size}px;color:#ffffff;font-family:Segoe UI,Arial,sans-serif;font-weight:700;font-size:14px">
          CM
        </div>
      </td>
      <td style="vertical-align:middle">
        <div style="font-family:Segoe UI,Arial,sans-serif;font-size:16px;font-weight:700;color:${BRAND.text};letter-spacing:0.02em">Centaur Medical</div>
        <div style="font-family:Segoe UI,Arial,sans-serif;font-size:12px;color:${BRAND.muted}">Gestion des dossiers médicaux</div>
      </td>
    </tr>
  </table>`;
}

function wrapEmailHtml(params: { title: string; preheader?: string; bodyHtml: string }): string {
  const preheader = params.preheader || '';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${params.title}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:Segoe UI,Arial,sans-serif;color:${BRAND.text}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:32px 16px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${BRAND.border};border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(16,24,40,0.06)">
          <tr>
            <td style="padding:28px 28px 20px;border-bottom:1px solid ${BRAND.border}">
              ${brandLogoSvg()}
            </td>
          </tr>
          <tr>
            <td style="padding:28px">
              ${params.bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;background:${BRAND.bg};border-top:1px solid ${BRAND.border}">
              <p style="margin:0;font-size:12px;color:${BRAND.muted};line-height:1.5">
                Cet email a été envoyé automatiquement par <strong style="color:${BRAND.text}">${BRAND.name}</strong>.<br/>
                Ne partagez jamais vos codes ou mots de passe.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:${BRAND.muted}">© ${new Date().getFullYear()} Centaur Medical</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function getTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.ethereal.email';
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';

  if (!user || !pass) {
    // Dev fallback: no real SMTP — log only
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: false,
    auth: { user, pass },
  });
}

export async function sendEmail(params: {
  userId?: string;
  type: string;
  to: string;
  subject: string;
  body: string;
  html?: string;
}): Promise<{ sent: boolean; preview?: string }> {
  const from = process.env.SMTP_FROM || 'Centaur Medical <noreply@centaur.local>';
  const transporter = await getTransporter();

  let sent = false;
  let preview: string | undefined;

  const html =
    params.html ||
    wrapEmailHtml({
      title: params.subject,
      bodyHtml: `<p style="margin:0;font-size:15px;line-height:1.6;white-space:pre-wrap">${params.body
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</p>`,
    });

  if (transporter) {
    const info = await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      text: params.body,
      html,
    });
    sent = true;
    preview = nodemailer.getTestMessageUrl(info) || undefined;
  } else {
    console.log('[notification] SMTP not configured — email logged:');
    console.log(`  To: ${params.to}`);
    console.log(`  Subject: ${params.subject}`);
    console.log(`  Body:\n${params.body}`);
  }

  await getDb()('notifications').insert({
    user_id: params.userId || null,
    type: params.type,
    recipient_email: params.to,
    subject: params.subject,
    body: params.body,
    status: sent ? 'SENT' : 'LOGGED',
  });

  return { sent, preview };
}

export async function sendMfaCode(input: {
  userId: string;
  email: string;
  code: string;
  firstName: string;
}) {
  const text = `Bonjour ${input.firstName},\n\nVotre code MFA est : ${input.code}\nIl expire dans 10 minutes.\n\n— Centaur Medical`;
  const html = wrapEmailHtml({
    title: 'Code MFA',
    preheader: `Votre code Centaur Medical : ${input.code}`,
    bodyHtml: `
      <h1 style="margin:0 0 12px;font-size:22px;color:${BRAND.text}">Vérification MFA</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${BRAND.muted}">
        Bonjour <strong style="color:${BRAND.text}">${input.firstName}</strong>,<br/>
        utilisez le code ci-dessous pour finaliser votre connexion à Centaur Medical.
      </p>
      <div style="text-align:center;margin:24px 0">
        <div style="display:inline-block;padding:16px 28px;border-radius:12px;background:#eef4ff;border:1px solid #dbeafe;font-size:32px;font-weight:700;letter-spacing:8px;color:${BRAND.primary};font-family:Consolas,Monaco,monospace">
          ${input.code}
        </div>
      </div>
      <p style="margin:0;font-size:13px;color:${BRAND.muted};line-height:1.5">
        Ce code expire dans <strong>10 minutes</strong>. Si vous n’êtes pas à l’origine de cette demande, ignorez cet email.
      </p>
    `,
  });

  return sendEmail({
    userId: input.userId,
    type: 'MFA',
    to: input.email,
    subject: 'Centaur Medical — Code de vérification MFA',
    body: text,
    html,
  });
}

export async function sendWelcomeEmail(input: {
  userId: string;
  email: string;
  firstName: string;
  tempPassword: string;
}) {
  const text = `Bonjour ${input.firstName},\n\nVotre compte a été créé.\nEmail: ${input.email}\nMot de passe temporaire: ${input.tempPassword}\n\nVeuillez le changer à la première connexion.\n\n— Centaur Medical`;
  const html = wrapEmailHtml({
    title: 'Bienvenue',
    preheader: 'Votre compte Centaur Medical a été créé',
    bodyHtml: `
      <h1 style="margin:0 0 12px;font-size:22px;color:${BRAND.text}">Bienvenue sur Centaur Medical</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${BRAND.muted}">
        Bonjour <strong style="color:${BRAND.text}">${input.firstName}</strong>,<br/>
        un administrateur a créé votre compte sur la plateforme hospitalière.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden;margin-bottom:20px">
        <tr>
          <td style="padding:12px 16px;background:${BRAND.bg};font-size:12px;font-weight:600;color:${BRAND.muted};width:40%">Email</td>
          <td style="padding:12px 16px;font-size:14px;color:${BRAND.text}">${input.email}</td>
        </tr>
        <tr>
          <td style="padding:12px 16px;background:${BRAND.bg};font-size:12px;font-weight:600;color:${BRAND.muted};border-top:1px solid ${BRAND.border}">Mot de passe temporaire</td>
          <td style="padding:12px 16px;font-size:14px;font-family:Consolas,Monaco,monospace;color:${BRAND.primary};border-top:1px solid ${BRAND.border}">${input.tempPassword}</td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;color:${BRAND.muted};line-height:1.5">
        Pour des raisons de sécurité, changez ce mot de passe dès votre première connexion.
      </p>
    `,
  });

  return sendEmail({
    userId: input.userId,
    type: 'WELCOME',
    to: input.email,
    subject: 'Bienvenue sur Centaur Medical',
    body: text,
    html,
  });
}

export async function sendPasswordResetEmail(input: {
  userId: string;
  email: string;
  firstName: string;
  code: string;
}) {
  const text = `Bonjour ${input.firstName},\n\nVotre code de réinitialisation Centaur Medical est : ${input.code}\nIl expire dans 15 minutes.\n\nSi vous n’avez pas demandé cette réinitialisation, ignorez cet email.\n\n— Centaur Medical`;
  const html = wrapEmailHtml({
    title: 'Réinitialisation',
    preheader: `Votre code Centaur Medical : ${input.code}`,
    bodyHtml: `
      <h1 style="margin:0 0 12px;font-size:22px;color:${BRAND.text}">Mot de passe oublié</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${BRAND.muted}">
        Bonjour <strong style="color:${BRAND.text}">${input.firstName}</strong>,<br/>
        saisissez le code ci-dessous sur la plateforme pour choisir un nouveau mot de passe.
      </p>
      <div style="text-align:center;margin:24px 0">
        <div style="display:inline-block;padding:16px 28px;border-radius:12px;background:#eef4ff;border:1px solid #dbeafe;font-size:32px;font-weight:700;letter-spacing:8px;color:${BRAND.primary};font-family:Consolas,Monaco,monospace">
          ${input.code}
        </div>
      </div>
      <p style="margin:0;font-size:13px;color:${BRAND.muted};line-height:1.5">
        Ce code expire dans <strong>15 minutes</strong>. Si vous n’êtes pas à l’origine de cette demande, ignorez cet email.
      </p>
    `,
  });

  return sendEmail({
    userId: input.userId,
    type: 'PASSWORD_RESET',
    to: input.email,
    subject: 'Centaur Medical — Code de réinitialisation',
    body: text,
    html,
  });
}

createDb();
