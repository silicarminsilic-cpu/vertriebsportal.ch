const express = require('express');
const db = require('./db');
const { requireAuth, requireAdmin } = require('./auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);

router.get('/users', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, company, email, branche, typkunde, created_at
       FROM users ORDER BY created_at DESC`
    );
    res.json({
      users: rows.map((u) => ({
        id: u.id,
        name: u.name,
        company: u.company,
        email: u.email,
        branche: u.branche,
        typkunde: u.typkunde,
        createdAt: u.created_at,
      })),
    });
  } catch (err) { next(err); }
});

router.get('/orders', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT o.id, o.subtotal, o.status, o.offer_number, o.invoice_number, o.created_at,
              u.name AS user_name, u.email AS user_email
       FROM orders o
       JOIN users u ON u.id = o.user_id
       ORDER BY o.created_at DESC
       LIMIT 200`
    );
    res.json({
      orders: rows.map((o) => ({
        id: o.id,
        subtotal: Number(o.subtotal),
        status: o.status,
        offerNumber: o.offer_number,
        invoiceNumber: o.invoice_number,
        createdAt: o.created_at,
        userName: o.user_name,
        userEmail: o.user_email,
      })),
    });
  } catch (err) { next(err); }
});

module.exports = router;
