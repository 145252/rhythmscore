/* 离线授权:机器码生成 + 激活码 RSA 验证(内置公钥,无需服务器) */
import { execSync } from 'child_process'
import { createHash, createPublicKey, verify } from 'crypto'
import { networkInterfaces } from 'os'

/** App 内置公钥(作者用 build/license_private.pem 私钥签发激活码) */
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1AbpTxYhT1gYPKJixyr7
60QrV0JjfmjYRaPybPcKIxPwmr7lNQSAQwtku23LwC20+Y/jYGqLRB8S9FKHKqXB
QHbNQgoFt7A+oZr/HPXRWf0m6kRTnwbhj3FYIsOnSZbL2Nhdkx/0JuxetOda7uWN
so582PgHagMEAKJnjpTSkAgozQ3+/GS/1aJ5MkZIReCBXLees+VN9UUCsrdJCt49
8hLG09Qvs+wNIxEdCV/drwBG/FIKnbnpFZfKzdq7HQsZ9NIsObj2c0pivUbExcy1
uP6MimIf2GkTFPmjhvbuJAK3ue7uYL/dpUMORYmKPpU1Ezlxs818KlYWk4R2B+BU
ywIDAQAB
-----END PUBLIC KEY-----`

/** 生成机器码:优先硬件序列号,失败降级到 MAC 地址列表哈希 */
export function machineCode(): string {
  let seed = ''
  try {
    const out = execSync(
      "system_profiler SPHardwareDataType 2>/dev/null | grep -i 'Serial Number' | head -1",
      { encoding: 'utf8', timeout: 8000 }
    )
    seed = (out.match(/:\s*(.+)/)?.[1] ?? '').trim()
  } catch {
    /* 受限环境 system_profiler 不可用 → 走 MAC 降级 */
  }
  if (!seed) {
    const macs: string[] = []
    for (const list of Object.values(networkInterfaces())) {
      for (const i of list ?? []) {
        if (i && !i.internal && i.mac && i.mac !== '00:00:00:00:00:00') macs.push(i.mac)
      }
    }
    seed = macs.sort().join('|')
  }
  return createHash('sha256').update('rs:' + seed).digest('hex').slice(0, 24).toUpperCase()
}

/** 验证激活码:对"机器码"字符串的 RSA-SHA256 签名校验 */
export function verifyLicense(key: string, machine: string): boolean {
  try {
    const sig = Buffer.from(key.trim(), 'base64')
    const pub = createPublicKey(LICENSE_PUBLIC_KEY)
    return verify('sha256', Buffer.from(machine, 'utf8'), pub, sig)
  } catch {
    return false
  }
}
