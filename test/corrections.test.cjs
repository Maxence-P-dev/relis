const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMatches, applyEdits, check } = require('../app/corrections.js');

const TEXT = 'Les enfant mange. Ca va ?';
const RAW = {
  matches: [
    { offset: 0, length: 10, message: 'Accord', shortMessage: '', replacements: [{ value: 'Les enfants' }, { value: "L'enfant" }], rule: { id: 'D_N', category: { id: 'AGREEMENT' } } },
    { offset: 18, length: 2, message: 'ça ?', shortMessage: 'Mot incorrect', replacements: [{ value: 'Ça' }], rule: { id: 'CA', category: { id: 'TYPOS' } } },
    { offset: 99, length: 3, message: 'hors texte', replacements: [], rule: { id: 'X', category: { id: 'TYPOS' } } },
  ],
};

test('lit les fautes et ignore celles hors du texte', () => {
  const m = parseMatches(RAW, TEXT);
  assert.equal(m.length, 2);
  assert.deepEqual(m[0], { offset: 0, length: 10, word: 'Les enfant', message: 'Accord', title: '', kind: 'grammar', rule: 'D_N', replacements: ['Les enfants', "L'enfant"] });
  assert.equal(m[1].kind, 'spelling');
});

test('le dictionnaire perso masque les fautes d’orthographe sur ces mots', () => {
  assert.equal(parseMatches(RAW, TEXT, ['ca']).length, 1);
  // mais pas les fautes de grammaire sur le même texte
  assert.equal(parseMatches(RAW, TEXT, ['les enfant']).length, 2);
});

test('applique plusieurs corrections dans le bon ordre', () => {
  const out = applyEdits(TEXT, [
    { offset: 0, length: 10, replacement: 'Les enfants' },
    { offset: 18, length: 2, replacement: 'Ça' },
  ]);
  assert.equal(out, 'Les enfants mange. Ça va ?');
});

test('une correction qui en chevauche une autre est ignorée', () => {
  assert.equal(applyEdits('abcdef', [{ offset: 1, length: 3, replacement: 'X' }, { offset: 2, length: 3, replacement: 'Y' }]), 'abY' + 'f');
});

test('texte trop long refusé avant tout envoi', async () => {
  await assert.rejects(check('a'.repeat(20001), { doFetch: () => assert.fail('ne doit pas appeler') }), /trop long/);
});

test('limite de l’API : message clair', async () => {
  await assert.rejects(check('x', { doFetch: async () => new Response('', { status: 429 }) }), /attends une minute/);
});

test('hors ligne : message clair', async () => {
  await assert.rejects(check('x', { doFetch: async () => { throw new TypeError('fetch failed'); } }), /connexion/);
});

test('envoie le texte en français', async () => {
  let sent;
  await check('Bonjour', { doFetch: async (_u, init) => ((sent = init.body), new Response('{"matches":[]}')) });
  assert.equal(sent.get('language'), 'fr');
  assert.equal(sent.get('text'), 'Bonjour');
});
