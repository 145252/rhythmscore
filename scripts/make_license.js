#!/usr/bin/env node
/* 作者端激活码生成器(离线)
 * 运行:node scripts/make_license.js <机器码> [备注]
 * 机器码由用户在软件「专业版」激活页复制;私钥 build/license_private.pem 勿泄露
 */
const { createSign, readFileSync } = require('crypto')
const fs = require('fs')
const path = require('path')

const machine = (process.argv[2] || '').trim().toUpperCase()
if (!machine) {
  console.error('用法: node scripts/make_license.js <机器码>')
  process.exit(1)
}

const privPath = path.join(__dirname, '..', 'build', 'license_private.pem')
if (!fs.existsSync(privPath)) {
  console.error('缺少私钥文件 build/license_private.pem,先运行 node scripts/gen_keys.js')
  process.exit(1)
}

const priv = fs.readFileSync(privPath, 'utf8')
const sig = createSign('sha256').update(machine, 'utf8').sign(priv)
console.log('机器码:', machine)
console.log('激活码:')
console.log(sig.toString('base64'))
