const express = require('express');
const db = require('./db');
const { lookupProduct, budgetBasePrice } = require('./catalog');
const { buildOfferPdf, buildInvoicePdf } = require('./pdf');
const { sendMail, smtpConfigured } = require('./mailer');
const { requireAuth } = require('./auth');

const router = express.Router();
router.use(requireAuth);

function publicOrder(row) {
  return {
    id: row.id,
    category: row.category,
    productId: row.product_id,
    title: row.title,
    description: row.description,
    typkunde: row.typkunde,
    branche: row.branche,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    total: row.total,
    currency: row.currency,
    offerNumber: row.offer_number,
    invoiceNumber: row.invoice_number,
    status: row.status,
    emailSent: Boolean(row.email_sent),
    createdAt: row.created_at,
  };
}

function docNumber(prefix, id, date) {
  const year = date.getFullYear();
  return `${prefix}-${year}-${String(id).padStart(5, '0')}`;
}

router.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC')
    .all(req.user.id);
  res.json({ orders: rows.map(publicOrder) });
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const category = String(body.category || '');
  let title, description, unitPrice, quantity, productId, typkunde, branche;

  if (category === 'individuell') {
    const { typkunde: tk, branche: br, ziel, anzahl, zeitraum, zusatz, firma, website, region, budget, briefing } = body;
    if (!tk || !br || !ziel || !anzahl || !zeitraum || !firma || !region || !budget || !briefing) {
      return res.status(400).json({ error: 'Bitte alle Pflichtfelder des Auftrags-Wizards ausfüllen.' });
    }
    typkunde = String(tk);
    branche = String(br);
    productId = null;
    quantity = 1;
    unitPrice = budgetBasePrice(String(budget));
    title = `${branche} Kampagne – ${typkunde}`;
    description = [
      `Kampagnenziel: ${ziel}`,
      `Gewünschte Anzahl Leads: ${anzahl}`,
      `Zeitraum: ${zeitraum}`,
      Array.isArray(zusatz) && zusatz.length ? `Zusatzleistungen: ${zusatz.join(', ')}` : null,
      `Unternehmen: ${firma}`,
      website ? `Website: ${website}` : null,
      `Zielregion: ${region}`,
      `Budget: ${budget}`,
      `Briefing: ${String(briefing).slice(0, 600)}`,
    ].filter(Boolean).join('\n');
  } else {
    productId = String(body.productId || '');
    const product = lookupProduct(category, productId);
    if (!product) return res.status(400).json({ error: 'Unbekannte Dienstleistung.' });
    quantity = Math.max(1, parseInt(body.quantity, 10) || 1);
    if (product.minQty && quantity < product.minQty) {
      return res.status(400).json({ error: `Mindestbestellmenge: ${product.minQty}` });
    }
    unitPrice = product.price;
    title = product.name;
    description = `${product.categoryLabel} · ${product.unit}`;
    typkunde = req.user.typkunde || '';
    branche = req.user.branche || '';
  }

  const total = Math.round(unitPrice * quantity * 100) / 100;
  const createdAt = new Date().toISOString();

  const info = db
    .prepare(
      `INSERT INTO orders
        (user_id, category, product_id, title, description, typkunde, branche, quantity, unit_price, total, currency, offer_number, invoice_number, status, email_sent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CHF', '', '', 'Offerte & Rechnung gesendet', 0, ?)`
    )
    .run(req.user.id, category, productId, title, description, typkunde, branche, quantity, unitPrice, total, createdAt);

  const orderId = info.lastInsertRowid;
  const created = new Date(createdAt);
  const offerNumber = docNumber('AN', orderId, created);
  const invoiceNumber = docNumber('RE', orderId, created);
  db.prepare('UPDATE orders SET offer_number = ?, invoice_number = ? WHERE id = ?').run(offerNumber, invoiceNumber, orderId);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);

  let emailSent = false;
  try {
    const [offerPdf, invoicePdf] = await Promise.all([
      buildOfferPdf(order, req.user),
      buildInvoicePdf(order, req.user),
    ]);

    await sendMail({
      to: req.user.email,
      bcc: process.env.COMPANY_NOTIFY_EMAIL || undefined,
      subject: `Deine Offerte & Rechnung für "${order.title}" – ${offerNumber} / ${invoiceNumber}`,
      text:
        `Hallo ${req.user.name}\n\n` +
        `Vielen Dank für deine Bestellung von "${order.title}" über vertriebsportal.ch.\n` +
        `Im Anhang findest du die Offerte (${offerNumber}) sowie die Rechnung (${invoiceNumber}) über CHF ${total.toFixed(2)} zzgl. MWST.\n\n` +
        `Freundliche Grüsse\nvertriebsportal.ch`,
      html:
        `<p>Hallo ${escapeHtml(req.user.name)}</p>` +
        `<p>Vielen Dank für deine Bestellung von <strong>${escapeHtml(order.title)}</strong> über vertriebsportal.ch.</p>` +
        `<p>Im Anhang findest du die Offerte (${offerNumber}) sowie die Rechnung (${invoiceNumber}) über CHF ${total.toFixed(2)} zzgl. MWST.</p>` +
        `<p>Freundliche Grüsse<br>vertriebsportal.ch</p>`,
      attachments: [
        { filename: `Offerte-${offerNumber}.pdf`, content: offerPdf, contentType: 'application/pdf' },
        { filename: `Rechnung-${invoiceNumber}.pdf`, content: invoicePdf, contentType: 'application/pdf' },
      ],
    });
    emailSent = true;
  } catch (err) {
    console.error('[orders] E-Mail-Versand fehlgeschlagen:', err.message);
  }

  db.prepare('UPDATE orders SET email_sent = ? WHERE id = ?').run(emailSent ? 1 : 0, orderId);
  const finalOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);

  res.status(201).json({
    order: publicOrder(finalOrder),
    emailSent,
    mailSimulated: !smtpConfigured,
  });
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadOwnedOrder(req, res) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!order) {
    res.status(404).json({ error: 'Beleg nicht gefunden.' });
    return null;
  }
  return order;
}

router.get('/:id/offer.pdf', async (req, res) => {
  const order = loadOwnedOrder(req, res);
  if (!order) return;
  const pdf = await buildOfferPdf(order, req.user);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Offerte-${order.offer_number}.pdf"`);
  res.send(pdf);
});

router.get('/:id/invoice.pdf', async (req, res) => {
  const order = loadOwnedOrder(req, res);
  if (!order) return;
  const pdf = await buildInvoicePdf(order, req.user);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Rechnung-${order.invoice_number}.pdf"`);
  res.send(pdf);
});

module.exports = router;
