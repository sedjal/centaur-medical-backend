import nodemailer from 'nodemailer';
import { createDb, getDb } from '@centaur/shared';

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
}): Promise<{ sent: boolean; preview?: string }> {
  const from = process.env.SMTP_FROM || 'Centaur Medical <noreply@centaur.local>';
  const transporter = await getTransporter();

  let sent = false;
  let preview: string | undefined;

  if (transporter) {
    const info = await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      text: params.body,
      html: `<pre style="font-family:sans-serif">${params.body.replace(/\n/g, '<br/>')}</pre>`,
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
  return sendEmail({
    userId: input.userId,
    type: 'MFA',
    to: input.email,
    subject: 'Centaur Medical — Code de vérification MFA',
    body: `Bonjour ${input.firstName},\n\nVotre code MFA est : ${input.code}\nIl expire dans 10 minutes.\n\n— Centaur Medical`,
  });
}

export async function sendWelcomeEmail(input: {
  userId: string;
  email: string;
  firstName: string;
  tempPassword: string;
}) {
  return sendEmail({
    userId: input.userId,
    type: 'WELCOME',
    to: input.email,
    subject: 'Bienvenue sur Centaur Medical',
    body: `Bonjour ${input.firstName},\n\nVotre compte a été créé.\nEmail: ${input.email}\nMot de passe temporaire: ${input.tempPassword}\n\nVeuillez le changer à la première connexion.\n\n— Centaur Medical`,
  });
}

createDb();
