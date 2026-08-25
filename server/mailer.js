const nodemailer = require('nodemailer');

const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

let transporter;
if (smtpConfigured) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
} else {
  console.warn(
    '[mailer] Kein SMTP konfiguriert (SMTP_HOST/SMTP_USER/SMTP_PASS fehlen in .env). ' +
    'E-Mails werden nur geloggt, nicht wirklich versendet.'
  );
  transporter = {
    sendMail: async (opts) => {
      console.log(
        `[mailer] (simuliert) E-Mail an ${opts.to}: "${opts.subject}" mit ${(opts.attachments || []).length} Anhang/Anhängen.`
      );
      return { messageId: 'simulated', simulated: true };
    },
  };
}

const MAIL_FROM = process.env.MAIL_FROM || 'vertriebsportal.ch <no-reply@vertriebsportal.ch>';

async function sendMail({ to, bcc, subject, text, html, attachments }) {
  return transporter.sendMail({
    from: MAIL_FROM,
    to,
    bcc: bcc || undefined,
    subject,
    text,
    html,
    attachments,
  });
}

module.exports = { sendMail, smtpConfigured };
