const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { sendMail } = require('./mailer');

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET === 'change-me-to-a-long-random-string') {
  console.warn(
    '[auth] SESSION_SECRET ist nicht gesetzt oder verwendet noch den Platzhalter aus .env.example. ' +
    'Bitte in .env / den Netlify-Umgebungsvariablen einen langen, zufälligen Wert setzen (z.B. `openssl rand -hex 32`).'
  );
}
const EFFECTIVE_SECRET = SESSION_SECRET || 'insecure-dev-secret-do-not-use-in-production';

const COOKIE_NAME = 'vp_session';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage

const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isAdminEmail(email) {
  return ADMIN_EMAILS.includes(String(email || '').toLowerCase());
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Versuche. Bitte in ein paar Minuten erneut versuchen.' },
});

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    email: row.email,
    branche: row.branche || '',
    typkunde: row.typkunde || '',
    street: row.street || '',
    zip: row.zip || '',
    city: row.city || '',
    country: row.country || '',
    phone: row.phone || '',
    createdAt: row.created_at,
    isAdmin: isAdminEmail(row.email),
  };
}

function issueSession(res, userId) {
  const token = jwt.sign({ uid: userId }, EFFECTIVE_SECRET, { expiresIn: '30d' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

async function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Bitte melde dich an.' });
  try {
    const payload = jwt.verify(token, EFFECTIVE_SECRET);
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [payload.uid]);
    if (!rows[0]) return res.status(401).json({ error: 'Bitte melde dich an.' });
    req.user = rows[0];
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sitzung abgelaufen. Bitte erneut anmelden.' });
  }
}

function requireAdmin(req, res, next) {
  if (!isAdminEmail(req.user.email)) {
    return res.status(403).json({ error: 'Kein Zugriff.' });
  }
  next();
}

const router = express.Router();

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const company = String(req.body.company || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!name || !company || !email || !password) {
      return res.status(400).json({ error: 'Bitte alle Felder ausfüllen.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Das Passwort muss mindestens 8 Zeichen lang sein.' });
    }

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'Für diese E-Mail-Adresse besteht bereits ein Konto.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const inserted = await db.query(
      'INSERT INTO users (name, company, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, company, email, passwordHash]
    );
    const user = inserted.rows[0];
    issueSession(res, user.id);

    if (process.env.COMPANY_NOTIFY_EMAIL) {
      try {
        await sendMail({
          to: process.env.COMPANY_NOTIFY_EMAIL,
          subject: `Neue Registrierung: ${name}`,
          text: `Neues Konto auf vertriebsportal.ch:\n\nName: ${name}\nUnternehmen: ${company}\nE-Mail: ${email}`,
          html: `<p>Neues Konto auf vertriebsportal.ch:</p><ul><li>Name: ${name}</li><li>Unternehmen: ${company}</li><li>E-Mail: ${email}</li></ul>`,
        });
      } catch (err) {
        console.error('[auth] Registrierungs-Benachrichtigung fehlgeschlagen:', err.message);
      }
    }

    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) {
      return res.status(400).json({ error: 'Bitte E-Mail und Passwort eingeben.' });
    }

    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = rows[0];
    const genericError = { error: 'E-Mail oder Passwort ist falsch.' };
    if (!user) return res.status(401).json(genericError);

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json(genericError);

    issueSession(res, user.id);
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const fields = {};
    if (typeof req.body.name === 'string' && req.body.name.trim()) fields.name = req.body.name.trim();
    if (typeof req.body.company === 'string' && req.body.company.trim()) fields.company = req.body.company.trim();
    if (typeof req.body.branche === 'string') fields.branche = req.body.branche.trim();
    if (typeof req.body.typkunde === 'string') fields.typkunde = req.body.typkunde.trim();
    if (typeof req.body.street === 'string') fields.street = req.body.street.trim();
    if (typeof req.body.zip === 'string') fields.zip = req.body.zip.trim();
    if (typeof req.body.city === 'string') fields.city = req.body.city.trim();
    if (typeof req.body.country === 'string') fields.country = req.body.country.trim();
    if (typeof req.body.phone === 'string') fields.phone = req.body.phone.trim();

    const keys = Object.keys(fields);
    if (keys.length) {
      const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
      const values = keys.map((k) => fields[k]);
      await db.query(`UPDATE users SET ${setClause} WHERE id = $${keys.length + 1}`, [...values, req.user.id]);
    }
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, requireAuth, requireAdmin, publicUser };
