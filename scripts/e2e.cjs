// Test de bout en bout : une fenêtre de test avec des fautes, puis Relis copie, corrige et recolle.
// Usage : npx electron scripts/e2e.cjs <dossier-captures>
// Sécurité : aucune touche n'est envoyée si la fenêtre au premier plan n'est pas la fenêtre de test.
const { app, BrowserWindow, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const out = path.resolve(process.argv[2] || 'e2e-shots');
fs.mkdirSync(out, { recursive: true });
process.env.RELIS_TEST = '1';
app.setPath('userData', path.join(out, 'profile'));
process.on('uncaughtException', (e) => (console.error('e2e:', e.message), process.exit(1)));
process.on('unhandledRejection', (e) => (console.error('e2e:', e?.message || e), process.exit(1)));
setTimeout(() => (console.error('e2e: délai dépassé'), process.exit(1)), 120000).unref();
require('../app/main.js');
const keys = require('../app/keys.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (name, cond, extra = '') => (results.push(cond), console.log(`${cond ? 'OK  ' : 'FAIL'} ${name} ${extra}`));

async function waitPopup(r, state) {
  const pop = r.popup();
  for (let i = 0; i < 60; i++) {
    const s = await pop.webContents.executeJavaScript(`document.querySelector('${state}') ? 1 : 0`);
    if (s) return pop;
    await wait(150);
  }
  const seen = await pop.webContents.executeJavaScript('document.getElementById("card").innerText');
  throw new Error(`attendu ${state}, la fenêtre affiche : ${JSON.stringify(seen)} (visible : ${pop.isVisible()})`);
}

app.whenReady().then(async () => {
  await wait(800);
  console.log('prêt');
  const r = global.__relis;
  const win = new BrowserWindow({ width: 640, height: 260, x: 100, y: 100, title: 'Relis — test', webPreferences: { contextIsolation: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<textarea id="t" style="width:95%;height:200px;font-size:16px">Les enfant mange des pomme. Ca va ?</textarea>'));
  const hwnd = Number(win.getNativeWindowHandle().readBigUInt64LE(0));
  const guard = async () => {
    console.log('  guard');
    win.focus();
    await keys.focus(hwnd);
    await wait(250);
    const fg = await keys.foreground();
    if (fg !== hwnd) throw new Error(`fenêtre de test pas au premier plan (${fg} ≠ ${hwnd}) : test arrêté sans envoyer de touche`);
  };
  const val = () => win.webContents.executeJavaScript('document.getElementById("t").value');

  // 1. Sans sélection : tout le champ est corrigé, le presse-papiers est restauré.
  await clipboard.writeText('presse-papiers de départ');
  await win.webContents.executeJavaScript('{ const t=document.getElementById("t"); t.focus(); t.setSelectionRange(5,5); } 1');
  await guard();
  console.log('étape 1');
  const run1 = r.run();
  let pop = await waitPopup(r, '.mark');
  await wait(300);
  fs.writeFileSync(path.join(out, '1-fautes.png'), (await pop.capturePage()).toPNG());
  await pop.webContents.executeJavaScript('document.querySelector(".mark").click(); 1');
  await wait(300);
  fs.writeFileSync(path.join(out, '2-suggestions.png'), (await pop.capturePage()).toPNG());
  await pop.webContents.executeJavaScript('document.querySelector(".chip").click(); document.querySelector(".btn.primary").click(); 1');
  await run1;
  await wait(500);
  const v1 = await val();
  ok('champ entier corrigé', v1 !== 'Les enfant mange des pomme. Ca va ?' && v1.includes('Ça va') && !/des pomme\b/.test(v1), JSON.stringify(v1));
  const clip = await clipboard.readText();
  ok('presse-papiers restauré', clip === 'presse-papiers de départ', JSON.stringify(clip));

  // 2. Avec une sélection : seule la sélection est remplacée.
  console.log('étape 2');
  await win.webContents.executeJavaScript('{ const t=document.getElementById("t"); t.value="Bonjour. Il sont content. Au revoir."; t.focus(); t.setSelectionRange(9,25); } 1');
  await guard();
  const run2 = r.run();
  pop = await waitPopup(r, '.mark');
  await pop.webContents.executeJavaScript('document.querySelector(".btn.primary").click(); 1');
  await run2;
  await wait(500);
  const v2 = await val();
  ok('sélection seule corrigée', v2.startsWith('Bonjour. ') && v2.endsWith(' Au revoir.') && !v2.includes('sont content.'), JSON.stringify(v2));

  console.log('étape 3');
  // 3. Texte sans faute : message puis fermeture automatique, texte intact.
  await win.webContents.executeJavaScript('{ const t=document.getElementById("t"); t.value="Tout est parfait."; t.focus(); t.setSelectionRange(0,0); } 1');
  await guard();
  const run3 = r.run();
  pop = await waitPopup(r, '.status.ok');
  fs.writeFileSync(path.join(out, '3-aucune-faute.png'), (await pop.capturePage()).toPNG());
  await run3;
  ok('texte sans faute intact', (await val()) === 'Tout est parfait.');

  console.log('étape 4');
  // 4. Échap : rien n'est modifié.
  await win.webContents.executeJavaScript('{ const t=document.getElementById("t"); t.value="Les chat dorme."; t.focus(); t.setSelectionRange(0,0); } 1');
  await guard();
  const run4 = r.run();
  pop = await waitPopup(r, '.mark');
  pop.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await run4;
  await wait(300);
  ok('Échap annule', (await val()) === 'Les chat dorme.');

  console.log(results.every(Boolean) ? 'E2E OK' : 'E2E ÉCHEC');
  app.exit(results.every(Boolean) ? 0 : 1);
});
