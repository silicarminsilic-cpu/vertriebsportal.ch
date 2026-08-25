/**
 * Serverseitiger Produktkatalog. Preise werden NIE vom Client übernommen,
 * sondern immer anhand von category + productId hier nachgeschlagen –
 * damit niemand über die API einen manipulierten Preis einschleusen kann.
 * Die Werte spiegeln bewusst den Katalog aus public/index.html.
 */

const LEAD_PRODUCTS = {
  lp1: { name: 'Krankenkassen-Leads', price: 35, minQty: 10, unit: 'pro Lead' },
  lp2: { name: 'Hypotheken-Leads', price: 55, minQty: 10, unit: 'pro Lead' },
  lp3: { name: 'Immobilien-Käufer-Leads', price: 60, minQty: 5, unit: 'pro Lead' },
  lp4: { name: 'Edelmetall-Investment-Leads', price: 70, minQty: 5, unit: 'pro Lead' },
  lp5: { name: 'Krypto-Trading-Leads', price: 65, minQty: 5, unit: 'pro Lead' },
  lp6: { name: 'KMU-Versicherungs-Leads', price: 80, minQty: 5, unit: 'pro Lead' },
};

const CAMPAIGN_PRODUCTS = {
  cp1: { name: 'Starter-Kampagne', price: 890, unit: 'Pauschal' },
  cp2: { name: 'Wachstums-Kampagne', price: 1890, unit: 'Pauschal' },
  cp3: { name: 'Premium-Kampagne', price: 3490, unit: 'Pauschal' },
};

const LANDINGPAGE_PRODUCTS = {
  lpg1: { name: 'Landingpage „Krankenkassen-Wechsel"', price: 690, unit: 'Pauschal' },
  lpg2: { name: 'Landingpage „Hypotheken-Rechner"', price: 790, unit: 'Pauschal' },
  lpg3: { name: 'Landingpage „Immobilien-Bewertung"', price: 650, unit: 'Pauschal' },
  lpg4: { name: 'Landingpage „Gold-Investment"', price: 720, unit: 'Pauschal' },
  lpg5: { name: 'Landingpage „Krypto-Trading"', price: 750, unit: 'Pauschal' },
};

const SERVICE_PRODUCTS = {
  sv1: { name: 'Grafikdesign-Paket', price: 450, unit: 'Pauschal' },
  sv2: { name: 'Landingpage-Erstellung', price: 790, unit: 'Pauschal' },
  sv3: { name: 'Content-Erstellung', price: 60, unit: 'pro Beitrag' },
  sv4: { name: 'Google Ads Setup', price: 390, unit: 'Pauschal' },
  sv5: { name: 'Social Media Ads Setup', price: 340, unit: 'Pauschal' },
  sv6: { name: 'Marketing-Beratung', price: 150, unit: 'pro Stunde' },
  sv7: { name: 'SEO-Check & Optimierung', price: 520, unit: 'Pauschal' },
  sv8: { name: 'Video-Produktion', price: 980, unit: 'Pauschal' },
};

const CATEGORIES = {
  lead: { label: 'Leads', products: LEAD_PRODUCTS },
  kampagne: { label: 'Kampagne', products: CAMPAIGN_PRODUCTS },
  landingpage: { label: 'Landingpage', products: LANDINGPAGE_PRODUCTS },
  service: { label: 'Marketingservice', products: SERVICE_PRODUCTS },
};

// Grobe Richtpreise für den individuellen Auftrags-Wizard, anhand des
// gewählten Budget-Rahmens (Untergrenze als Basis für die Offerte).
const BUDGET_BASE_PRICE = {
  'CHF 500 – 1000': 500,
  'CHF 1000 – 2500': 1000,
  'CHF 2500 – 5000': 2500,
  'CHF 5000+': 5000,
};

function lookupProduct(category, productId) {
  const cat = CATEGORIES[category];
  if (!cat) return null;
  const product = cat.products[productId];
  if (!product) return null;
  return { ...product, category, categoryLabel: cat.label, id: productId };
}

function budgetBasePrice(budget) {
  return BUDGET_BASE_PRICE[budget] || 500;
}

module.exports = { lookupProduct, budgetBasePrice, CATEGORIES };
