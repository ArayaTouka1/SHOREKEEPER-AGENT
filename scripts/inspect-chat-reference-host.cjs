const { app, BrowserWindow } = require('electron')
app.disableHardwareAcceleration()
app.whenReady().then(() => { const win = new BrowserWindow({ width: 1440, height: 900, show: false }); win.loadURL('about:blank') })
