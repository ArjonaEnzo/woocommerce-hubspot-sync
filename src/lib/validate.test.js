import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEmail, normalizePhone, normalizeCountry, validateCustomer } from './validate.js';

test('validateEmail trims and lowercases a valid email', () => {
  assert.deepEqual(validateEmail(' Ana@Example.COM '), { value: 'ana@example.com', issue: null });
});

test('validateEmail flags a typo domain with a suggestion and drops the value', () => {
  const r = validateEmail('juan@gmial.con');
  assert.equal(r.value, null);
  assert.match(r.issue, /^email_typo_domain/);
  assert.match(r.issue, /gmail\.com/);
});

test('validateEmail flags disposable domains', () => {
  assert.deepEqual(validateEmail('x@mailinator.com'), { value: null, issue: 'email_disposable' });
});

test('validateEmail flags malformed and empty input', () => {
  assert.equal(validateEmail('not-an-email').issue, 'email_invalid_format');
  assert.equal(validateEmail('').issue, 'email_invalid_format');
  assert.equal(validateEmail(undefined).issue, 'email_invalid_format');
});

test('normalizePhone returns E.164 for an Argentine local number', () => {
  assert.deepEqual(normalizePhone('011 4444-5555', 'AR'), { value: '+541144445555', issue: null });
});

test('normalizePhone keeps an already international number', () => {
  assert.equal(normalizePhone('+1 (415) 555-0100', 'US').value, '+14155550100');
});

test('normalizePhone adds the country code for a US national number', () => {
  assert.equal(normalizePhone('415-555-0100', 'US').value, '+14155550100');
});

test('normalizePhone flags garbage', () => {
  assert.deepEqual(normalizePhone('abc', 'AR'), { value: null, issue: 'phone_invalid' });
  assert.deepEqual(normalizePhone('123', 'AR'), { value: null, issue: 'phone_invalid' });
});

test('normalizePhone treats empty as absent, not invalid', () => {
  assert.deepEqual(normalizePhone('', 'AR'), { value: null, issue: null });
});

test('normalizeCountry accepts ISO-2 codes and EN/ES names', () => {
  assert.equal(normalizeCountry('ar').value, 'AR');
  assert.equal(normalizeCountry('Argentina').value, 'AR');
  assert.equal(normalizeCountry('España').value, 'ES');
  assert.equal(normalizeCountry('United States').value, 'US');
});

test('normalizeCountry flags unknown countries', () => {
  assert.deepEqual(normalizeCountry('Narnia'), { value: null, issue: 'country_unknown' });
});

test('validateCustomer drops only the invalid field and lists the issue', () => {
  const r = validateCustomer({
    first_name: 'Ana', last_name: 'Pérez', email: 'ana@acme-andina.test',
    phone: 'abc', country: 'AR', company: 'Acme Andina SRL',
  });
  assert.equal(r.clean.email, 'ana@acme-andina.test');
  assert.equal(r.clean.phone, null);
  assert.equal(r.clean.country, 'AR');
  assert.equal(r.clean.firstname, 'Ana');
  assert.equal(r.clean.lastname, 'Pérez');
  assert.equal(r.clean.company, 'Acme Andina SRL');
  assert.deepEqual(r.issues, ['phone_invalid']);
});

test('validateCustomer collects every issue of a dirty record', () => {
  const r = validateCustomer({
    first_name: 'Juan', last_name: 'Gómez', email: 'juan@gmial.con',
    phone: '011 4444-5555', country: 'Narnia', company: '',
  });
  assert.equal(r.clean.email, null);
  assert.equal(r.clean.company, null);
  assert.equal(r.issues.length, 2);
  assert.ok(r.issues.some((i) => i.startsWith('email_typo_domain')));
  assert.ok(r.issues.includes('country_unknown'));
});
