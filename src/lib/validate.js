// Data-quality checks (flow F3). Pure functions: inlined into n8n Code nodes by build-workflows.
// Rule: never block the sync. Invalid values become null and are reported as issues.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/;

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', '10minutemail.com', 'guerrillamail.com', 'yopmail.com', 'tempmail.com',
]);

// Common typos of webmail domains → correct domain.
const DOMAIN_TYPOS = {
  'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.con': 'gmail.com',
  'gmial.con': 'gmail.com', 'gmail.cmo': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmail.con': 'hotmail.com',
  'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'outlok.com': 'outlook.com',
};

const DIAL_CODES = {
  AR: '54', US: '1', MX: '52', ES: '34', CL: '56', UY: '598', BR: '55', CO: '57', PE: '51', GB: '44', DE: '49',
};

const COUNTRY_NAMES = {
  argentina: 'AR',
  'united states': 'US', usa: 'US', 'estados unidos': 'US', eeuu: 'US',
  mexico: 'MX', 'méxico': 'MX',
  spain: 'ES', 'españa': 'ES', espana: 'ES',
  chile: 'CL', uruguay: 'UY',
  brazil: 'BR', brasil: 'BR',
  colombia: 'CO', peru: 'PE', 'perú': 'PE',
  'united kingdom': 'GB', uk: 'GB', 'reino unido': 'GB',
  germany: 'DE', alemania: 'DE',
};

export function validateEmail(raw) {
  const email = String(raw ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { value: null, issue: 'email_invalid_format' };
  const [local, domain] = email.split('@');
  // Dot errors pass the simple pattern but HubSpot rejects them (and one bad email would fail a whole batch).
  if (/^\.|\.$|\.\./.test(local) || domain.split('.').some((label) => !label)) {
    return { value: null, issue: 'email_invalid_format' };
  }
  if (DOMAIN_TYPOS[domain]) return { value: null, issue: `email_typo_domain:${domain}→${DOMAIN_TYPOS[domain]}` };
  if (DISPOSABLE_DOMAINS.has(domain)) return { value: null, issue: 'email_disposable' };
  return { value: email, issue: null };
}

export function normalizePhone(raw, countryIso2) {
  const text = String(raw ?? '').trim();
  if (!text) return { value: null, issue: null };
  const invalid = { value: null, issue: 'phone_invalid' };
  const digits = text.replace(/\D/g, '');
  if (/[a-z]/i.test(text) || !digits) return invalid;

  let e164;
  if (text.startsWith('+')) {
    e164 = digits;
  } else {
    const dial = DIAL_CODES[countryIso2] ?? DIAL_CODES.AR;
    let national = digits;
    if (national.startsWith(dial) && national.length > 10) national = national.slice(dial.length);
    national = national.replace(/^0/, ''); // trunk prefix (AR, ES, GB, DE…)
    if (national.length < 6) return invalid;
    e164 = dial + national;
  }
  if (e164.length < 8 || e164.length > 15) return invalid;
  return { value: `+${e164}`, issue: null };
}

export function normalizeCountry(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { value: null, issue: null };
  const upper = text.toUpperCase();
  if (DIAL_CODES[upper]) return { value: upper, issue: null };
  const byName = COUNTRY_NAMES[text.toLowerCase()];
  return byName ? { value: byName, issue: null } : { value: null, issue: 'country_unknown' };
}

export function validateCustomer(billing = {}) {
  const issues = [];
  const take = (result) => {
    if (result.issue) issues.push(result.issue);
    return result.value;
  };
  const email = take(validateEmail(billing.email));
  const country = take(normalizeCountry(billing.country));
  const phone = take(normalizePhone(billing.phone, country));
  const clean = {
    email,
    phone,
    country,
    firstname: String(billing.first_name ?? '').trim() || null,
    lastname: String(billing.last_name ?? '').trim() || null,
    company: String(billing.company ?? '').trim() || null,
  };
  return { clean, issues };
}
