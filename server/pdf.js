const PDFDocument = require('pdfkit');

const COMPANY = {
  name: process.env.COMPANY_NAME || 'Esche Consulting GmbH',
  addressLine1: process.env.COMPANY_ADDRESS_LINE1 || 'Städtle 35',
  addressLine2: process.env.COMPANY_ADDRESS_LINE2 || '9490 Vaduz, Fürstentum Liechtenstein',
  email: process.env.COMPANY_EMAIL || 'support@vertriebsportal.ch',
  phone: process.env.COMPANY_PHONE || '',
  uid: process.env.COMPANY_UID || '',
  iban: process.env.COMPANY_IBAN || '',
  mwstRate: Number(process.env.COMPANY_MWST_RATE || 8.1),
  paymentTermDays: Number(process.env.COMPANY_PAYMENT_TERMS_DAYS || 30),
};

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function drawHeader(doc, kind, docNumber, docDate, user) {
  doc.fontSize(18).fillColor('#0b244e').font('Helvetica-Bold').text(COMPANY.name, 50, 50);
  doc.fontSize(9).fillColor('#485a6b').font('Helvetica');
  let y = 72;
  if (COMPANY.addressLine1) { doc.text(COMPANY.addressLine1, 50, y); y += 12; }
  if (COMPANY.addressLine2) { doc.text(COMPANY.addressLine2, 50, y); y += 12; }
  doc.text(COMPANY.email, 50, y); y += 12;
  if (COMPANY.phone) { doc.text(COMPANY.phone, 50, y); y += 12; }
  if (COMPANY.uid) { doc.text(COMPANY.uid, 50, y); y += 12; }

  doc.fontSize(16).fillColor('#0b244e').font('Helvetica-Bold').text(kind, 350, 50, { width: 195, align: 'right' });
  doc.fontSize(9).fillColor('#485a6b').font('Helvetica');
  doc.text(`Nr. ${docNumber}`, 350, 74, { width: 195, align: 'right' });
  doc.text(`Datum: ${fmtDate(docDate)}`, 350, 88, { width: 195, align: 'right' });

  const addrY = 150;
  doc.fontSize(9).fillColor('#96a4b2').text('Kunde', 50, addrY);
  doc.fontSize(10.5).fillColor('#0f1c30').font('Helvetica-Bold').text(user.name, 50, addrY + 13);
  doc.font('Helvetica').fillColor('#33404d');
  doc.text(user.company || '', 50, addrY + 28);
  doc.text(user.email, 50, addrY + 42);

  return addrY + 70;
}

function ensureSpace(doc, y, needed) {
  if (y + needed > 760) {
    doc.addPage();
    return 50;
  }
  return y;
}

function drawItemsTable(doc, startY, order) {
  const colPos = { desc: 50, qty: 340, unit: 400, total: 470 };
  let y = startY + 10;

  doc.rect(50, y, 495, 22).fill('#eef1f5');
  doc.fillColor('#33404d').fontSize(9).font('Helvetica-Bold');
  doc.text('Beschreibung', colPos.desc + 8, y + 6);
  doc.text('Menge', colPos.qty, y + 6, { width: 50, align: 'right' });
  doc.text('Einzelpreis', colPos.unit, y + 6, { width: 60, align: 'right' });
  doc.text('Total', colPos.total, y + 6, { width: 65, align: 'right' });
  y += 30;

  for (const item of order.items) {
    y = ensureSpace(doc, y, 40);
    doc.font('Helvetica').fontSize(10).fillColor('#0f1c30');
    doc.text(item.title, colPos.desc, y, { width: 280 });
    doc.text(String(item.quantity), colPos.qty, y, { width: 50, align: 'right' });
    doc.text(`CHF ${fmtMoney(item.unit_price)}`, colPos.unit, y, { width: 60, align: 'right' });
    doc.text(`CHF ${fmtMoney(item.total)}`, colPos.total, y, { width: 65, align: 'right' });
    y += 16;
    if (item.description) {
      doc.fontSize(8.5).fillColor('#6c7d8d').text(item.description, colPos.desc, y, { width: 420 });
      y += doc.heightOfString(item.description, { width: 420 }) + 4;
    }
    y += 8;
  }

  y = ensureSpace(doc, y, 90);
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#e1e7ed').stroke();
  y += 12;

  const subtotal = Number(order.subtotal);
  const mwst = Math.round(subtotal * (COMPANY.mwstRate / 100) * 100) / 100;
  const grandTotal = Math.round((subtotal + mwst) * 100) / 100;

  doc.fontSize(10).fillColor('#33404d').font('Helvetica');
  doc.text('Zwischensumme', 340, y, { width: 125, align: 'left' });
  doc.text(`CHF ${fmtMoney(subtotal)}`, colPos.total, y, { width: 65, align: 'right' });
  y += 16;
  doc.text(`MWST (${COMPANY.mwstRate}%)`, 340, y, { width: 125, align: 'left' });
  doc.text(`CHF ${fmtMoney(mwst)}`, colPos.total, y, { width: 65, align: 'right' });
  y += 18;
  doc.font('Helvetica-Bold').fontSize(11.5).fillColor('#0b244e');
  doc.text('Total', 340, y, { width: 125, align: 'left' });
  doc.text(`CHF ${fmtMoney(grandTotal)}`, colPos.total, y, { width: 65, align: 'right' });
  y += 26;

  return { y, grandTotal };
}

function buildOfferPdf(order, user) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const created = new Date(order.created_at);
    let y = drawHeader(doc, 'Offerte', order.offer_number, created, user);
    const { y: afterTable } = drawItemsTable(doc, y, order);
    y = ensureSpace(doc, afterTable, 60);

    const validUntil = addDays(created, 30);
    doc.font('Helvetica').fontSize(9.5).fillColor('#485a6b');
    doc.text(
      `Dieses Angebot ist gültig bis ${fmtDate(validUntil)}. Mit dem Absenden deiner Bestellung im Kundenportal hast ` +
      'du diese Leistungen bereits verbindlich bestellt; die zugehörige Rechnung findest du als separates Dokument ' +
      'im Anhang dieser E-Mail. Bestellte Leads werden separat für dich zusammengestellt und in deinem Portal ' +
      'bereitgestellt.',
      50, y, { width: 495 }
    );

    doc.end();
  });
}

function buildInvoicePdf(order, user) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const created = new Date(order.created_at);
    let y = drawHeader(doc, 'Rechnung', order.invoice_number, created, user);
    const { y: afterTable, grandTotal } = drawItemsTable(doc, y, order);
    y = ensureSpace(doc, afterTable, 90);

    const dueDate = addDays(created, COMPANY.paymentTermDays);
    doc.font('Helvetica').fontSize(9.5).fillColor('#485a6b');
    doc.text(
      `Zahlbar innert ${COMPANY.paymentTermDays} Tagen netto, bis spätestens ${fmtDate(dueDate)}.`,
      50, y, { width: 495 }
    );
    y += 26;

    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0f1c30').text('Zahlungsinformationen', 50, y);
    y += 14;
    doc.font('Helvetica').fontSize(9.5).fillColor('#33404d');
    doc.text(`IBAN: ${COMPANY.iban}`, 50, y); y += 13;
    doc.text(`Zahlungsempfänger: ${COMPANY.name}`, 50, y); y += 13;
    doc.text(`Zahlungsreferenz: ${order.invoice_number}`, 50, y); y += 13;
    doc.text(`Betrag: CHF ${fmtMoney(grandTotal)}`, 50, y);

    doc.end();
  });
}

module.exports = { buildOfferPdf, buildInvoicePdf, COMPANY };
