'use strict';
// Relis : correcteur français qui tourne en fond. Un raccourci corrige le texte de n'importe quelle application.
const { app, BrowserWindow, Tray, Menu, globalShortcut, clipboard, ClipboardItem, screen, ipcMain, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const keys = require('./keys');
const { check, parseMatches, applyEdits } = require('./corrections');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}
app.setAppUserModelId('com.relis.app');

/* ---------------------------------------------------------------- réglages */

const HOTKEYS = [
  { accel: 'CommandOrControl+Shift+Space', label: 'Ctrl + Maj + Espace' },
  { accel: 'CommandOrControl+Alt+C', label: 'Ctrl + Alt + C' },
  { accel: 'Alt+C', label: 'Alt + C' },
  { accel: 'CommandOrControl+Shift+F12', label: 'Ctrl + Maj + F12' },
];
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = { hotkey: HOTKEYS[0].accel, picky: false, dictionary: [], welcomed: false };

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}
let settings = loadSettings();

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    const tmp = SETTINGS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
    fs.renameSync(tmp, SETTINGS_FILE); // écriture atomique : le dictionnaire perso ne peut pas être corrompu
  } catch (e) {
    console.error('settings:', e.message);
  }
}

const hotkeyLabel = () => HOTKEYS.find((h) => h.accel === settings.hotkey)?.label || settings.hotkey;

function registerHotkey(accel) {
  globalShortcut.unregisterAll();
  if (globalShortcut.register(accel, () => run().catch((e) => console.error(e)))) return true;
  notify('Raccourci indisponible', `« ${HOTKEYS.find((h) => h.accel === accel)?.label || accel} » est déjà utilisé par une autre application.`);
  return false;
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, icon: path.join(__dirname, 'icon.png'), silent: true }).show();
}

/* ------------------------------------------------------------------ fenêtre */

let popup = null;
const W = 400;

function createPopup() {
  popup = new BrowserWindow({
    width: W,
    height: 120,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  popup.setAlwaysOnTop(true, 'pop-up-menu');
  popup.loadFile(path.join(__dirname, 'popup.html'));
  popup.on('blur', () => current?.resolve({ action: 'cancel' }));
}

/** Place la fenêtre près de la souris, sans jamais déborder de l'écran. */
function placePopup(height) {
  const p = screen.getCursorScreenPoint();
  const { workArea: a } = screen.getDisplayNearestPoint(p);
  const h = Math.min(height, a.height - 16);
  let x = p.x - 24;
  let y = p.y + 18;
  if (y + h > a.y + a.height - 8) y = p.y - h - 12;
  x = Math.max(a.x + 8, Math.min(x, a.x + a.width - W - 8));
  y = Math.max(a.y + 8, y);
  popup.setBounds({ x: Math.round(x), y: Math.round(y), width: W, height: Math.round(h) });
}

ipcMain.on('popup:height', (_e, h) => {
  if (!popup || !popup.isVisible()) return;
  const b = popup.getBounds();
  popup.setBounds({ ...b, height: Math.round(Math.min(h, 560)) });
});

let current = null; // { resolve } : décision en attente de la fenêtre

ipcMain.on('popup:decide', (_e, decision) => current?.resolve(decision));
ipcMain.handle('popup:ignoreAlways', (_e, word) => {
  const w = String(word || '').trim();
  if (w && !settings.dictionary.some((x) => x.toLowerCase() === w.toLowerCase())) {
    settings.dictionary.push(w);
    saveSettings();
    buildTray();
  }
  return true;
});

/* ----------------------------------------------------------- presse-papiers */

// On sauvegarde tous les formats du presse-papiers (texte, HTML, image…) pour les remettre à la fin.
async function saveClipboard() {
  const saved = [];
  for (const item of await clipboard.read().catch(() => [])) {
    const parts = {};
    for (const type of item.types) {
      try {
        parts[type] = await item.getType(type);
      } catch {
        // format illisible (propre à une application) : ignoré
      }
    }
    if (Object.keys(parts).length) saved.push(parts);
  }
  return saved;
}

async function restoreClipboard(saved) {
  try {
    if (saved.length) await clipboard.write(saved.map((parts) => new ClipboardItem(parts)));
    else clipboard.clear();
  } catch (e) {
    console.error('restauration du presse-papiers :', e.message);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Attend que le presse-papiers change (la copie n'est pas instantanée dans toutes les applications). */
async function waitClipboard(sentinel, ms) {
  for (let t = 0; t < ms; t += 25) {
    const v = await clipboard.readText();
    if (v !== sentinel) return v;
    await sleep(25);
  }
  return '';
}

/* ------------------------------------------------------------------- relire */

let busy = false;
const trace = (...a) => process.env.RELIS_TEST && console.log('  [relis]', ...a);

async function run() {
  if (busy) return;
  busy = true;
  let saved = null;
  let hwnd = 0;
  try {
    await keys.waitRelease();
    hwnd = await keys.foreground();
    saved = await saveClipboard();
    const sentinel = `​__relis_${process.hrtime.bigint()}__`;
    await clipboard.writeText(sentinel);
    await keys.copy();
    let text = await waitClipboard(sentinel, 350);
    if (!text) {
      // Pas de sélection : on prend tout le champ.
      await keys.selectAll();
      await keys.copy();
      text = await waitClipboard(sentinel, 500);
    }
    trace('texte copié', JSON.stringify(text));
    if (!text.trim()) {
      await restoreClipboard(saved);
      saved = null;
      return show({ state: 'empty' }, 160);
    }

    show({ state: 'loading' }, 150);
    let matches;
    try {
      matches = parseMatches(await check(text, { picky: settings.picky }), text, settings.dictionary);
    } catch (e) {
      return show({ state: 'error', message: e.message }, 170);
    }
    trace('fautes', JSON.stringify(matches.map((m) => [m.offset, m.length, m.word, m.replacements.slice(0, 2)])));
    const decision = await ask({ state: 'result', text, matches, hotkey: hotkeyLabel() });
    trace('décision', JSON.stringify(decision));
    popup.hide();
    if (decision.action === 'apply' && decision.edits?.length) {
      const corrected = applyEdits(text, decision.edits);
      trace('corrigé', JSON.stringify(corrected));
      if (corrected !== text) {
        await keys.focus(hwnd);
        await sleep(60);
        await clipboard.writeText(corrected);
        await keys.paste();
        await sleep(350); // laisse l'application lire le presse-papiers avant de le restaurer
      }
    } else if (hwnd) {
      await keys.focus(hwnd);
    }
  } catch (e) {
    console.error('relis:', e);
    notify('Relis', 'La correction a échoué : ' + e.message);
  } finally {
    if (saved) await restoreClipboard(saved);
    busy = false;
  }
}

/** Affiche un état sans attendre de choix (vide, chargement, erreur). */
function show(payload, height) {
  if (current) current.resolve({ action: 'cancel' });
  placePopup(height);
  popup.webContents.send('popup:show', payload);
  popup.showInactive();
  if (payload.state !== 'loading') {
    // Pour un message simple, la fenêtre prend le focus afin qu'Échap la ferme.
    popup.focus();
    return ask(null);
  }
}

/** Montre le résultat et attend la décision de l'utilisateur. */
function ask(payload) {
  if (payload) {
    popup.webContents.send('popup:show', payload);
    popup.show();
    popup.focus();
  }
  return new Promise((resolve) => {
    current = {
      resolve: (d) => {
        current = null;
        if (!payload) popup.hide();
        resolve(d);
      },
    };
  });
}

/* --------------------------------------------------------------------- tray */

let tray = null;

function buildTray() {
  const menu = Menu.buildFromTemplate([
    { label: `Relis · ${hotkeyLabel()}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Raccourci',
      submenu: HOTKEYS.map((h) => ({
        label: h.label,
        type: 'radio',
        checked: settings.hotkey === h.accel,
        click: () => {
          if (registerHotkey(h.accel)) {
            settings.hotkey = h.accel;
            saveSettings();
          } else registerHotkey(settings.hotkey);
          buildTray();
        },
      })),
    },
    {
      label: 'Correction exigeante (style, typographie)',
      type: 'checkbox',
      checked: settings.picky,
      click: (i) => {
        settings.picky = i.checked;
        saveSettings();
      },
    },
    {
      label: 'Démarrer avec Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      enabled: app.isPackaged,
      click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }),
    },
    {
      label: `Dictionnaire perso (${settings.dictionary.length} mot${settings.dictionary.length > 1 ? 's' : ''})`,
      submenu: [
        ...settings.dictionary.slice(-15).map((w) => ({
          label: `Retirer « ${w} »`,
          click: () => {
            settings.dictionary = settings.dictionary.filter((x) => x !== w);
            saveSettings();
            buildTray();
          },
        })),
        ...(settings.dictionary.length ? [{ type: 'separator' }] : []),
        {
          label: 'Tout vider',
          enabled: settings.dictionary.length > 0,
          click: () => {
            settings.dictionary = [];
            saveSettings();
            buildTray();
          },
        },
      ],
    },
    { type: 'separator' },
    { label: 'Les textes sont envoyés à LanguageTool pour être corrigés.', enabled: false },
    { label: 'Quitter Relis', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`Relis — ${hotkeyLabel()} pour corriger`);
}

app.whenReady().then(async () => {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
  buildTray();
  tray.on('click', () => tray.popUpContextMenu());
  createPopup();
  keys.start().catch((e) => notify('Relis', 'Assistant clavier indisponible : ' + e.message));
  registerHotkey(settings.hotkey);
  if (!settings.welcomed && !process.env.RELIS_TEST) {
    notify('Relis est prêt', `Sélectionne du texte (ou place-toi dans un champ) puis appuie sur ${hotkeyLabel()}.`);
    settings.welcomed = true;
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });
    saveSettings();
  }
});

// Test de bout en bout (scripts/e2e.cjs) : accès direct à la correction, sans raccourci global.
if (process.env.RELIS_TEST) global.__relis = { run, isBusy: () => busy, popup: () => popup };

app.on('second-instance', () => notify('Relis tourne déjà', `Appuie sur ${hotkeyLabel()} pour corriger ton texte.`));
app.on('window-all-closed', (e) => e.preventDefault()); // reste dans la zone de notification
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  keys.stop();
});
