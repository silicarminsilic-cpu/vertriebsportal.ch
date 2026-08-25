const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET === 'change-me-to-a-long-random-string') {
  console.warn(
    '[auth] SESSION_SECRET ist nicht gesetzt oder verwendet noch den Platzhalter aus .env.example. ' +
    'Bitte in .env einen langen, zufälligen Wert setzen (z.B. `openssl rand -hex 32`).'
  );
}
const EFFECTIVE_SECRET = SESSION_SECRET || 'insecure-dev-secret-do-not-use-in-production';

const COOKIE_NAME = 'vp_session';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage

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
    createdAt: row.created_at,
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

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Bitte melde dich an.' });
  try {
    const payload = jwt.verify(token, EFFECTIVE_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
    if (!user) return res.status(401).json({ error: 'Bitte melde dich an.' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sitzung abgelaufen. Bitte erneut anmelden.' });
  }
}

const router = express.Router();

router.post('/register', authLimiter, (req, res) => {
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

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'Für diese E-Mail-Adresse besteht bereits ein Konto.' });
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  const createdAt = new Date().toISOString();
  const info = db
    .prepare('INSERT INTO users (name, company, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(name, company, email, passwordHash, createdAt);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  issueSession(res, user.id);
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', authLimiter, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) {
    return res.status(400).json({ error: 'Bitte E-Mail und Passwort eingeben.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const genericError = { error: 'E-Mail oder Passwort ist falsch.' };
  if (!user) return res.status(401).json(genericError);

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json(genericError);

  issueSession(res, user.id);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.patch('/me', requireAuth, (req, res) => {
  const fields = {};
  if (typeof req.body.name === 'string' && req.body.name.trim()) fields.name = req.body.name.trim();
  if (typeof req.body.company === 'string' && req.body.company.trim()) fields.company = req.body.company.trim();
  if (typeof req.body.branche === 'string') fields.branche = req.body.branche.trim();
  if (typeof req.body.typkunde === 'string') fields.typkunde = req.body.typkunde.trim();

  const keys = Object.keys(fields);
  if (keys.length) {
    const setClause = keys.map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(...keys.map((k) => fields[k]), req.user.id);
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

module.exports = { router, requireAuth, publicUser };
