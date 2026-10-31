/**
 * Writes public/version.json with current timestamp.
 * Run before build so each deploy has a unique buildTime for version-refresh banner.
 */
const fs = require('fs')
const path = require('path')
const publicDir = path.join(__dirname, '..', 'public')
const versionPath = path.join(publicDir, 'version.json')
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true })
fs.writeFileSync(versionPath, JSON.stringify({ buildTime: Date.now() }, null, 2))
console.log('Updated', versionPath)
