#!/usr/bin/env node
/* 构建后混淆:抬高授权/水印逻辑的逆向门槛
 * 用法:node scripts/obfuscate.js
 * - out/main/index.js、out/preload/index.js:高强度(CJS,target node)
 * - out/renderer/assets/*.js:保守(target browser,避免破坏 ESM import/export)
 */
const fs = require('fs')
const path = require('path')
const obfuscator = require('javascript-obfuscator')

const out = path.join(__dirname, '..', 'out')

const NODE_OPTS = {
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  stringArray: true,
  stringArrayThreshold: 0.85,
  rotateStringArray: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.6,
  deadCodeInjection: false,
  target: 'node'
}

const BROWSER_OPTS = {
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  stringArray: true,
  stringArrayThreshold: 0.55,
  rotateStringArray: true,
  controlFlowFlattening: false,
  transformObjectKeys: false,
  deadCodeInjection: false,
  target: 'browser'
}

function obfuscate(file, opts) {
  if (!fs.existsSync(file)) {
    console.warn('[obfuscate] skip(missing):', path.relative(out, file))
    return
  }
  const code = fs.readFileSync(file, 'utf8')
  const result = obfuscator.obfuscate(code, opts).getObfuscatedCode()
  fs.writeFileSync(file, result)
  console.log('[obfuscate] ok:', path.relative(out, file), `(${code.length} -> ${result.length} bytes)`)
}

// 主进程 + 预加载(高强度)
obfuscate(path.join(out, 'main', 'index.js'), NODE_OPTS)
obfuscate(path.join(out, 'main', 'license.js'), NODE_OPTS)
obfuscate(path.join(out, 'preload', 'index.js'), NODE_OPTS)

// 渲染层(保守;跳过 pdf.worker 等无业务逻辑的第三方库)
const assets = path.join(out, 'renderer', 'assets')
if (fs.existsSync(assets)) {
  for (const f of fs.readdirSync(assets)) {
    if (f.endsWith('.js') && !f.includes('pdf.worker')) obfuscate(path.join(assets, f), BROWSER_OPTS)
  }
}

console.log('[obfuscate] done')
