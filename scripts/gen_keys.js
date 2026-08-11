#!/usr/bin/env node
/* 生成 RSA-2048 密钥对:私钥作者保留(生成激活码用),公钥嵌入 App 验证用
 * 运行:node scripts/gen_keys.js
 * 私钥文件 build/license_private.pem 不要提交到 git
 */
const { generateKeyPairSync } = require('crypto')
const fs = require('fs')
const path = require('path')

const outDir = path.join(__dirname, '..', 'build')
fs.mkdirSync(outDir, { recursive: true })

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
})

fs.writeFileSync(path.join(outDir, 'license_private.pem'), privateKey, { mode: 0o600 })
fs.writeFileSync(path.join(outDir, 'license_public.pem'), publicKey)
console.log('public key:\n' + publicKey)
console.log('private key saved to build/license_private.pem (KEEP SECRET)')
