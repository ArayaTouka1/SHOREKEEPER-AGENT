const { app, BrowserWindow } = require('electron')
const path = require('node:path')
if (!process.env.WORKSPACE_TEST_PROFILE) throw new Error('Missing isolated test profile')
app.setPath('userData', process.env.WORKSPACE_TEST_PROFILE)
app.setPath('sessionData', process.env.WORKSPACE_TEST_PROFILE)
app.disableHardwareAcceleration()
BrowserWindow.prototype.show = function () {}
require(path.resolve(__dirname, '../out/main/index.js'))
