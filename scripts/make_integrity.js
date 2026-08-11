#!/usr/bin/env node
/* 完整性自检清单生成:对 out/ 关键文件算 sha256,私钥签名 → out/integrity.json
 * 运行时主进程用内置公钥验签+比对,被篡改则拒绝启动。
 * 用法:node scripts/make_integrity.js(在 obfuscate 之后运行)
 */
const fs = require('fs')
const path = require('path')
const { createHash, createSign } = require('crypto')

const out = path.join(__dirname, '..', 'out')
const privPath = path.join(__dirname, '..', 'build', 'license_private.pem')

if (!fs.existsSync(privPath)) {
  console.error('[integrity] 缺少私钥 build/license_private.pem,无法签名')
  process.exit(1)
}

const files = {}

// 渲染层 JS(水印/授权判定所在地;跳过第三方 pdf.worker)
const assets = path.join(out, 'renderer', 'assets')
if (fs.existsSync(assets)) {
  for (const f of fs.readdirSync(assets)) {
    if (f.endsWith('.js') && !f.includes('pdf.worker')) {
      files['renderer/assets/' + f] = createHash('sha256')
        .update(fs.readFileSync(path.join(assets, f)))
        .digest('hex')
    }
  }
}

// 预加载(IPC 桥,暴露激活接口)
const pre = path.join(out, 'preload', 'index.js')
if (fs.existsSync(pre)) {
  files['preload/index.js'] = createHash('sha256').update(fs.readFileSync(pre)).digest('hex')
}

const payload = JSON.stringify(files)
const sig = createSign('sha256').update(payload).sign(fs.readFileSync(privPath))

fs.writeFileSync(path.join(out, 'integrity.json'), JSON.stringify({ files, sig: sig.toString('base64') }))
console.log('[integrity] ok:', Object.keys(files).length, 'files signed')
