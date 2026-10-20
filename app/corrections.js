'use strict';
// Logique pure (sans Electron) : lecture de la réponse LanguageTool et application des corrections.

const API = 'https://api.languagetool.org/v2/check';
const MAX_CHARS = 20000; // limite de l'API gratuite

/** Catégorie d'affichage d'une faute : couleur du soulignement dans la fenêtre. */
function kindOf(m) {
  const cat = m.rule?.category?.id || '';
  if (cat === 'TYPOS' || m.rule?.issueType === 'misspelling') return 'spelling';
  if (cat === 'TYPOGRAPHY' || cat === 'PUNCTUATION' || m.rule?.issueType === 'typographical') return 'typo';
  if (cat === 'STYLE' || cat === 'REDUNDANCY' || m.rule?.issueType === 'style') return 'style';
  return 'grammar';
}

/** Transforme la réponse brute en liste de fautes, sans les mots du dictionnaire perso. */
function parseMatches(data, text, dictionary = []) {
  const known = new Set(dictionary.map((w) => w.toLowerCase()));
  return (data?.matches || [])
    .map((m) => ({
      offset: m.offset,
      length: m.length,
      word: text.slice(m.offset, m.offset + m.length),
      message: m.message,
      title: m.shortMessage || '',
      kind: kindOf(m),
      rule: m.rule?.id || '',
      replacements: (m.replacements || []).slice(0, 5).map((r) => r.value).filter((v) => v !== undefined),
    }))
    .filter((m) => m.length > 0 && m.offset >= 0 && m.offset + m.length <= text.length)
    .filter((m) => !(m.kind === 'spelling' && known.has(m.word.toLowerCase())));
}

/** Remplace les passages choisis. `edits` = [{ offset, length, replacement }], dans n'importe quel ordre. */
function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => b.offset - a.offset);
  let out = text;
  let limit = Infinity; // ignore une correction qui chevaucherait une autre déjà appliquée
  for (const e of sorted) {
    if (e.offset + e.length > limit) continue;
    out = out.slice(0, e.offset) + e.replacement + out.slice(e.offset + e.length);
    limit = e.offset;
  }
  return out;
}

/** Interroge LanguageTool. Lève une erreur au message lisible en cas de problème. */
async function check(text, { doFetch = fetch, picky = false } = {}) {
  if (text.length > MAX_CHARS) throw new Error(`Texte trop long (${text.length} caractères, maximum ${MAX_CHARS}).`);
  const body = new URLSearchParams({ text, language: 'fr', motherTongue: 'fr' });
  if (picky) body.set('level', 'picky');
  let res;
  try {
    res = await doFetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('Pas de connexion à LanguageTool. Vérifie ta connexion internet.');
  }
  if (res.status === 429) throw new Error('Trop de corrections d’affilée : attends une minute (limite de l’API gratuite).');
  if (!res.ok) throw new Error(`LanguageTool a répondu une erreur (${res.status}).`);
  return res.json();
}

module.exports = { parseMatches, applyEdits, check, kindOf, MAX_CHARS };
