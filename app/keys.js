'use strict';
// Assistant clavier Windows : un seul processus PowerShell reste ouvert (compilation C# faite une fois),
// puis on lui envoie des commandes ligne par ligne. Aucun module natif à compiler.
const { spawn } = require('child_process');

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class RelisKeys {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  const uint UP = 2;
  public static long Foreground() { return GetForegroundWindow().ToInt64(); }
  public static bool Focus(long hwnd) {
    IntPtr h = new IntPtr(hwnd);
    if (IsIconic(h)) ShowWindow(h, 9);
    uint target = GetWindowThreadProcessId(h, IntPtr.Zero);
    uint fg = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
    uint me = GetCurrentThreadId();
    AttachThreadInput(me, fg, true); AttachThreadInput(me, target, true);
    BringWindowToTop(h); bool ok = SetForegroundWindow(h);
    AttachThreadInput(me, target, false); AttachThreadInput(me, fg, false);
    return ok;
  }
  // Attend que l'utilisateur ait lâché les touches du raccourci (sinon Ctrl+C deviendrait Ctrl+Maj+C).
  public static void WaitRelease(int timeoutMs) {
    int[] vks = { 0x10, 0x11, 0x12, 0x5B, 0x5C, 0x20 };
    int waited = 0;
    while (waited < timeoutMs) {
      bool held = false;
      foreach (int vk in vks) if ((GetAsyncKeyState(vk) & 0x8000) != 0) held = true;
      if (!held) return;
      Thread.Sleep(15); waited += 15;
    }
    foreach (int vk in vks) keybd_event((byte)vk, 0, UP, UIntPtr.Zero);
  }
  public static void Combo(byte vk) {
    keybd_event(0x11, 0, 0, UIntPtr.Zero);
    keybd_event(vk, 0, 0, UIntPtr.Zero);
    keybd_event(vk, 0, UP, UIntPtr.Zero);
    keybd_event(0x11, 0, UP, UIntPtr.Zero);
  }
}
"@
[Console]::Out.WriteLine('ready')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $p = $line.Split(' ')
  try {
    switch ($p[0]) {
      'fg'     { $r = [RelisKeys]::Foreground() }
      'focus'  { $r = [RelisKeys]::Focus([long]$p[1]) }
      'wait'   { [RelisKeys]::WaitRelease(2000); $r = 'ok' }
      'copy'   { [RelisKeys]::Combo(0x43); $r = 'ok' }
      'all'    { [RelisKeys]::Combo(0x41); $r = 'ok' }
      'paste'  { [RelisKeys]::Combo(0x56); $r = 'ok' }
      default  { $r = 'unknown' }
    }
  } catch { $r = 'error ' + $_.Exception.Message }
  [Console]::Out.WriteLine([string]$r)
}
`;

let proc = null;
let ready = null;
let buffer = '';
const waiting = [];

function start() {
  if (ready) return ready;
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  ready = new Promise((resolve, reject) => {
    waiting.push({ resolve, reject });
    proc.on('error', reject);
  });
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      waiting.shift()?.resolve(line);
    }
  });
  proc.stderr.on('data', (d) => {
    const msg = String(d).trim();
    if (msg && !msg.startsWith('#< CLIXML')) console.error('[keys]', msg);
  });
  proc.on('exit', () => {
    for (const w of waiting.splice(0)) w.reject(new Error('Assistant clavier arrêté'));
    proc = null;
    ready = null; // relancé à la prochaine commande
  });
  return ready;
}

/** Envoie une commande et attend sa réponse (les commandes sont traitées dans l'ordre). */
async function cmd(line) {
  await start();
  return new Promise((resolve, reject) => {
    waiting.push({ resolve, reject });
    proc.stdin.write(line + '\n');
  });
}

function stop() {
  proc?.kill();
}

module.exports = {
  start,
  stop,
  foreground: async () => Number(await cmd('fg')),
  focus: (hwnd) => cmd(`focus ${hwnd}`),
  waitRelease: () => cmd('wait'),
  copy: () => cmd('copy'),
  selectAll: () => cmd('all'),
  paste: () => cmd('paste'),
};
