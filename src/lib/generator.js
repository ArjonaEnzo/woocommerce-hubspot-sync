// Seeded fake-order generator. Everything here is fictional: names from short lists,
// company domains are subdomains of IANA-reserved example.com (HubSpot rejects .test emails),
// personal emails carry a "demo." prefix.

const FIRST = ['Ana', 'Juan', 'Lucía', 'Martín', 'Sofía', 'Diego', 'Valentina', 'Tomás', 'Camila', 'Nicolás',
  'Julieta', 'Mateo', 'Florencia', 'Joaquín', 'Paula', 'Federico', 'Carolina', 'Gonzalo', 'Agustina', 'Bruno'];
const LAST = ['Pérez', 'Gómez', 'Fernández', 'López', 'Díaz', 'Martínez', 'Romero', 'Sosa', 'Álvarez', 'Torres',
  'Ruiz', 'Benítez', 'Acosta', 'Medina', 'Herrera', 'Suárez', 'Castro', 'Molina', 'Ortiz', 'Silva'];
const COMPANIES = [
  { name: 'Andes Outfitters SRL', domain: 'andes-outfitters.example.com' },
  { name: 'Pampa Digital SA', domain: 'pampa-digital.example.com' },
  { name: 'Río Norte Logística', domain: 'rio-norte.example.com' },
  { name: 'Cuyo Design Studio', domain: 'cuyo-design.example.com' },
  { name: 'Litoral Software SAS', domain: 'litoral-software.example.com' },
  { name: 'Sur Coffee Co', domain: 'sur-coffee.example.com' },
];
const FREE_DOMAINS = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com'];
const COUNTRIES = ['AR', 'AR', 'AR', 'AR', 'US', 'MX', 'ES', 'CL', 'UY', 'BR', 'CO'];
// Each dirty customer gets one defect; the validator must catch all of them.
const DEFECTS = ['typo_gmail', 'typo_hotmail', 'disposable', 'phone_letters', 'phone_short', 'country_typo'];

const CUSTOMERS = 120;
const COMPANY_CUSTOMERS = 30; // 25 %
const VIP = [30, 31, 32, 33, 34, 35];
const DIRTY_FROM = 100; // customers 100..117 are dirty
const DIRTY_COUNT = 18;
const STATUS_POOL = { completed: 110, processing: 40, pending: 8, 'on-hold': 7, cancelled: 12, failed: 8, refunded: 15 };
const PARTIAL_REFUNDS = 10;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const round2 = (n) => Math.round(n * 100) / 100;

function makeCustomer(i, rnd) {
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const first = FIRST[i % FIRST.length];
  const last = LAST[Math.floor(i / FIRST.length + i) % LAST.length];
  const country = i < COMPANY_CUSTOMERS ? 'AR' : pick(COUNTRIES);
  const local = `${slug(first)}.${slug(last)}`;
  const customer = {
    first_name: first,
    last_name: last,
    email: `demo.${local}${i}@${pick(FREE_DOMAINS)}`,
    phone: country === 'AR'
      ? `011 4${String(Math.floor(rnd() * 1e3)).padStart(3, '0')}-${String(Math.floor(rnd() * 1e4)).padStart(4, '0')}`
      : `+1 415 555 ${String(100 + i).padStart(4, '0')}`,
    country,
    company: '',
    registered: rnd() < 0.5,
  };
  if (country !== 'AR' && country !== 'US') customer.phone = '';
  if (i < COMPANY_CUSTOMERS) {
    const company = COMPANIES[i % COMPANIES.length];
    customer.email = `${local}@${company.domain}`;
    customer.company = i % 5 === 0 ? '' : company.name; // some leave the company field empty
  }
  if (i >= DIRTY_FROM && i < DIRTY_FROM + DIRTY_COUNT) {
    const defect = DEFECTS[(i - DIRTY_FROM) % DEFECTS.length];
    customer.registered = false;
    if (defect === 'typo_gmail') customer.email = `demo.${local}${i}@gmial.com`;
    if (defect === 'typo_hotmail') customer.email = `demo.${local}${i}@hotmial.com`;
    if (defect === 'disposable') customer.email = `demo.${local}${i}@mailinator.com`;
    if (defect === 'phone_letters') customer.phone = 'call me';
    if (defect === 'phone_short') customer.phone = '12';
    if (defect === 'country_typo') customer.country = 'Argentna';
  }
  return customer;
}

function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function generateOrders({ seed, count, catalog, now }) {
  const rnd = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const customers = Array.from({ length: CUSTOMERS }, (_, i) => makeCustomer(i, rnd));

  // Every customer buys once; VIPs buy 6 more times; the rest is spread over regular customers.
  const owners = customers.map((_, i) => i);
  for (const v of VIP) for (let k = 0; k < 6; k++) owners.push(v);
  while (owners.length < count) owners.push(Math.floor(rnd() * DIRTY_FROM));
  shuffle(owners, rnd);
  owners.length = count;

  const statuses = shuffle(Object.entries(STATUS_POOL).flatMap(([s, n]) => Array(n).fill(s)), rnd);
  const takeStatus = (paidOnly) => {
    const idx = paidOnly ? statuses.findIndex((s) => s === 'completed' || s === 'processing') : 0;
    return statuses.splice(idx === -1 ? 0 : idx, 1)[0];
  };

  const bigTicket = catalog.filter((p) => p.price >= 300);
  const yearMs = 365 * 864e5;
  let partialLeft = PARTIAL_REFUNDS;

  const orders = owners.map((ownerIdx, n) => {
    const isVip = VIP.includes(ownerIdx);
    const items = [];
    if (isVip) items.push({ sku: pick(bigTicket).sku, quantity: 1 });
    const lines = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < lines; k++) {
      const p = pick(catalog);
      if (!items.some((it) => it.sku === p.sku)) items.push({ sku: p.sku, quantity: 1 + Math.floor(rnd() * 3) });
    }
    const priceOf = (sku) => catalog.find((p) => p.sku === sku).price;
    const total = round2(items.reduce((s, it) => s + priceOf(it.sku) * it.quantity, 0));
    const status = takeStatus(isVip);
    let refund_amount = 0;
    if (status === 'refunded') refund_amount = total;
    if (status === 'completed' && !isVip && partialLeft > 0) {
      partialLeft--;
      refund_amount = round2(total * (0.1 + rnd() * 0.3));
    }
    const created = new Date(now.getTime() - 3600e3 - Math.floor(rnd() * (yearMs - 7200e3)));
    return {
      gen_id: `gen-${String(n + 1).padStart(4, '0')}`,
      status,
      date_created: created.toISOString(),
      customer: { ...customers[ownerIdx] },
      items,
      total,
      refund_amount,
    };
  });

  return orders.sort((a, b) => a.date_created.localeCompare(b.date_created));
}
