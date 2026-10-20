'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('relis', {
  onShow: (cb) => ipcRenderer.on('popup:show', (_e, payload) => cb(payload)),
  decide: (decision) => ipcRenderer.send('popup:decide', decision),
  height: (h) => ipcRenderer.send('popup:height', h),
  ignoreAlways: (word) => ipcRenderer.invoke('popup:ignoreAlways', word),
});
