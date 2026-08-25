const express = require('express');
const db = require('./db');
const { lookupProduct, budgetBasePrice } = require('./catalog');
const { buildOfferPdf, buildInvoicePdf } = require('./pdf');
const { sendMail, smtpConfigured } = require('./mailer');
const { requireAuth } = require('./auth');

const router = express.Router();
router.use(requireAuth);

const MAX_ITEMS_PER_ORDER = 30;

function resolveItem(raw) {
  const category = String(raw.category || '');

  if (category === 'individuell') {
    const { typkunde: tk, branche: br, ziel, anzahl, zeitraum, zusatz, firma, website, region, budget, briefing } = raw;
    if (!tk || !br || !ziel || !anzahl || !zeitraum || !firma || !region || !budget || !briefing) {
      return { error: 'Bitte alle Pflichtfelder des Auftrags-Wizards ausfüllen.' };
    }
    const unitPrice = budgetBasePrice(String(budget));
    const title = `${br} Kampagne – ${tk}`;
    const description = [
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
    return {
      category, productId: null, title, description,
      quantity: 1, unitPrice, total: unitPrice,
    };
  }

  const productId = String(raw.productId || '');
  const product = lookupProduct(category, productId);
  if (!product) return { error: `Unbekannte Dienstleistung: ${category}/${productId}` };

  const quantity = Math.max(1, parseInt(raw.quantity, 10) || 1);
  if (product.minQty && quantity < product.minQty) {
    return { error: `${product.name}: Mindestbestellmenge ${product.minQty}` };
  }
  const total = Math.round(product.price * quantity * 100) / 100;
  return {
    category, productId, title: product.name,
    description: `${product.categoryLabel} · ${product.unit}`,
    quantity, unitPrice: product.price, total,
  };
}

function summarizeTitle(items) {
  if (items.length === 1) return items[0].title;
  return `Bestellung mit ${items.length} Positionen`;
}

function docNumber(prefix, id, date) {
  return `${prefix}-${date.getFullYear()}-${String(id).padStart(5, '0')}`;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function loadOrderWithItems(orderId, userId) {
  const orderRes = await db.query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [orderId, userId]);
  const order = orderRes.rows[0];
  if (!order) return null;
  const itemsRes = await db.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
  return { ...order, items: itemsRes.rows };
}

function publicOrder(order) {
  return {
    id: order.id,
    title: summarizeTitle(order.items),
    items: order.items.map((it) => ({
      category: it.category,
      productId: it.product_id,
      title: it.title,
      description: it.description,
      quantity: it.quantity,
      unitPrice: Number(it.unit_price),
      total: Number(it.total),
    })),
    subtotal: Number(order.subtotal),
    currency: order.currency,
    offerNumber: order.offer_number,
    invoiceNumber: order.invoice_number,
    status: order.status,
    emailSent: Boolean(order.email_sent),
    createdAt: order.created_at,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const ordersRes = await db.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC', [req.user.id]);
    const orders = [];
    for (const o of ordersRes.rows) {
      const itemsRes = await db.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [o.id]);
      orders.push(publicOrder({ ...o, items: itemsRes.rows }));
    }
    res.json({ orders });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const rawItems = Array.isArray(req.body.items) ? req.body.items : null;
    if (!rawItems || !rawItems.length) {
      return res.status(400).json({ error: 'Der Warenkorb ist leer.' });
    }
    if (rawItems.length > MAX_ITEMS_PER_ORDER) {
      return res.status(400).json({ error: `Maximal ${MAX_ITEMS_PER_ORDER} Positionen pro Bestellung.` });
    }

    const items = [];
    for (const raw of rawItems) {
      const resolved = resolveItem(raw);
      if (resolved.error) return res.status(400).json({ error: resolved.error });
      items.push(resolved);
    }

    const subtotal = Math.round(items.reduce((s, it) => s + it.total, 0) * 100) / 100;

    const orderInsert = await db.query(
      `INSERT INTO orders (user_id, status, subtotal, currency) VALUES ($1, 'Bestellung eingegangen', $2, 'CHF') RETURNING *`,
      [req.user.id, subtotal]
    );
    const orderRow = orderInsert.rows[0];

    for (const it of items) {
      await db.query(
        `INSERT INTO order_items (order_id, category, product_id, title, description, quantity, unit_price, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [orderRow.id, it.category, it.productId, it.title, it.description, it.quantity, it.unitPrice, it.total]
      );
    }

    const created = new Date(orderRow.created_at);
    const offerNumber = docNumber('AN', orderRow.id, created);
    const invoiceNumber = docNumber('RE', orderRow.id, created);
    await db.query('UPDATE orders SET offer_number = $1, invoice_number = $2 WHERE id = $3', [offerNumber, invoiceNumber, orderRow.id]);

    let order = await loadOrderWithItems(orderRow.id, req.user.id);

    let emailSent = false;
    try {
      const [offerPdf, invoicePdf] = await Promise.all([
        buildOfferPdf(order, req.user),
        buildInvoicePdf(order, req.user),
      ]);

      const itemLines = order.items.map((it) => `- ${it.title} (${it.quantity}x): CHF ${Number(it.total).toFixed(2)}`).join('\n');
      const itemLinesHtml = order.items.map((it) => `<li>${escapeHtml(it.title)} (${it.quantity}x): CHF ${Number(it.total).toFixed(2)}</li>`).join('');

      await sendMail({
        to: req.user.email,
        subject: `Deine Offerte & Rechnung – ${offerNumber} / ${invoiceNumber}`,
        text:
          `Hallo ${req.user.name}\n\nVielen Dank für deine Bestellung über vertriebsportal.ch:\n${itemLines}\n\n` +
          `Im Anhang findest du die Offerte (${offerNumber}) sowie die Rechnung (${invoiceNumber}) über CHF ${Number(order.subtotal).toFixed(2)} zzgl. MWST.\n` +
          `Bestellte Leads werden separat für dich zusammengestellt und in deinem Portal unter "Meine Aufträge" bereitgestellt.\n\n` +
          `Freundliche Grüsse\nvertriebsportal.ch`,
        html:
          `<p>Hallo ${escapeHtml(req.user.name)}</p>` +
          `<p>Vielen Dank für deine Bestellung über vertriebsportal.ch:</p><ul>${itemLinesHtml}</ul>` +
          `<p>Im Anhang findest du die Offerte (${offerNumber}) sowie die Rechnung (${invoiceNumber}) über CHF ${Number(order.subtotal).toFixed(2)} zzgl. MWST.</p>` +
          `<p>Bestellte Leads werden separat für dich zusammengestellt und in deinem Portal unter "Meine Aufträge" bereitgestellt.</p>` +
          `<p>Freundliche Grüsse<br>vertriebsportal.ch</p>`,
        attachments: [
          { filename: `Offerte-${offerNumber}.pdf`, content: offerPdf, contentType: 'application/pdf' },
          { filename: `Rechnung-${invoiceNumber}.pdf`, content: invoicePdf, contentType: 'application/pdf' },
        ],
      });
      emailSent = true;

      if (process.env.COMPANY_NOTIFY_EMAIL) {
        try {
          await sendMail({
            to: process.env.COMPANY_NOTIFY_EMAIL,
            subject: `Neue Bestellung – ${offerNumber} / ${invoiceNumber}`,
            text:
              `Neue Bestellung über vertriebsportal.ch:\n\n` +
              `Kunde: ${req.user.name} (${req.user.company})\nE-Mail: ${req.user.email}\n\n` +
              `Positionen:\n${itemLines}\n\nTotal: CHF ${Number(order.subtotal).toFixed(2)} zzgl. MWST`,
            html:
              `<p>Neue Bestellung über vertriebsportal.ch:</p>` +
              `<p>Kunde: ${escapeHtml(req.user.name)} (${escapeHtml(req.user.company)})<br>E-Mail: ${escapeHtml(req.user.email)}</p>` +
              `<p>Positionen:</p><ul>${itemLinesHtml}</ul>` +
              `<p>Total: CHF ${Number(order.subtotal).toFixed(2)} zzgl. MWST</p>`,
          });
        } catch (err) {
          console.error('[orders] Interne Bestell-Benachrichtigung fehlgeschlagen:', err.message);
        }
      }
    } catch (err) {
      console.error('[orders] E-Mail-Versand fehlgeschlagen:', err.message);
    }

    await db.query('UPDATE orders SET email_sent = $1 WHERE id = $2', [emailSent, orderRow.id]);
    order = await loadOrderWithItems(orderRow.id, req.user.id);

    res.status(201).json({ order: publicOrder(order), emailSent, mailSimulated: !smtpConfigured });
  } catch (err) { next(err); }
});

router.get('/:id/offer.pdf', async (req, res, next) => {
  try {
    const order = await loadOrderWithItems(req.params.id, req.user.id);
    if (!order) return res.status(404).json({ error: 'Beleg nicht gefunden.' });
    const pdf = await buildOfferPdf(order, req.user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Offerte-${order.offer_number}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
});

router.get('/:id/invoice.pdf', async (req, res, next) => {
  try {
    const order = await loadOrderWithItems(req.params.id, req.user.id);
    if (!order) return res.status(404).json({ error: 'Beleg nicht gefunden.' });
    const pdf = await buildInvoicePdf(order, req.user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Rechnung-${order.invoice_number}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
});

module.exports = router;
