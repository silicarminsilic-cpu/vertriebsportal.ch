const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const db = require('./db');
const { router: authRouter } = require('./auth');
const ordersRouter = require('./orders');
const adminRouter = require('./admin');

const app = express();
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false, // die Frontend-Seite lädt Google Fonts inline im <style>
  })
);
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

app.use('/api', async (req, res, next) => {
  try {
    await db.ensureSchema();
    next();
  } catch (err) {
    next(err);
  }
});

app.use('/api/auth', authRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/admin', adminRouter);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Nicht gefunden.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Es ist ein interner Fehler aufgetreten.' });
});

module.exports = app;
module.exports.staticDir = path.join(__dirname, '..', 'public');
