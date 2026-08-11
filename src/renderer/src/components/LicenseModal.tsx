import React, { useEffect, useState } from 'react'
import { CheckCircle2, Copy, Crown, KeyRound, Sparkles } from 'lucide-react'
import { useStore } from '../store'

interface Props {
  open: boolean
  onClose: () => void
}

const FEATURES: { name: string; free: string; pro: string }[] = [
  { name: '导入乐谱 / 画线分节 / 音频对点 / 反复段落', free: '✓', pro: '✓' },
  { name: '导出视频无水印', free: '✗(带 RhythmScore 水印)', pro: '✓' },
  { name: '导出全高清清晰度', free: '✗(720p)', pro: '✓' },
  { name: '买断后永久使用', free: '✗', pro: '✓' }
]

/** 专业版弹窗:免费/专业对比 + 激活 */
export default function LicenseModal({ open, onClose }: Props): React.JSX.Element {
  const licensed = useStore((s) => s.licensed)
  const setLicensed = useStore((s) => s.setLicensed)
  const [machine, setMachine] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open && window.api?.isElectron) {
      setErr('')
      void window.api.getMachineCode().then(setMachine)
    }
  }, [open])

  if (!open) return <></>

  const copyMachine = (): void => {
    if (machine && window.navigator.clipboard) {
      void window.navigator.clipboard.writeText(machine).then(() => setErr('机器码已复制'))
    }
  }

  const doActivate = async (): Promise<void> => {
    const k = keyInput.trim()
    if (!k || !window.api) return
    setBusy(true)
    setErr('')
    const r = await window.api.activateLicense(k)
    setBusy(false)
    if (r.ok) {
      setLicensed(true, k)
      localStorage.setItem('rs-license-key', k)
      setMachine(r.machine)
      onClose()
    } else {
      setErr('激活码无效。请检查:① 激活码是否由上方【弹窗内显示的机器码】生成;② 只粘贴激活码本身,不要带机器码/空格')
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal-box lic-box" onClick={(e) => e.stopPropagation()}>
        <h4 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Crown size={16} style={{ color: '#f5b54a' }} /> RhythmScore 专业版
        </h4>

        {/* 状态区 */}
        {licensed ? (
          <div className="lic-status ok">
            <CheckCircle2 size={16} />
            <div>
              <b>已激活专业版</b>
              <span>永久解锁 · 无水印 · 全高清导出,感谢支持!</span>
            </div>
          </div>
        ) : (
          <div className="lic-status free">
            <Sparkles size={16} />
            <div>
              <b>免费版</b>
              <span>导出视频带 RhythmScore 水印,清晰度 720p。激活专业版后无水印、全高清。</span>
            </div>
          </div>
        )}

        {/* 功能对比 */}
        <div className="lic-compare">
          <div className="lic-row lic-head">
            <span>功能</span>
            <span>免费版</span>
            <span>专业版</span>
          </div>
          {FEATURES.map((f) => (
            <div className="lic-row" key={f.name}>
              <span>{f.name}</span>
              <span className={f.free.startsWith('✓') ? 'lic-yes' : 'lic-no'}>{f.free}</span>
              <span className={f.pro.startsWith('✓') ? 'lic-yes' : 'lic-mid'}>{f.pro}</span>
            </div>
          ))}
        </div>

        {/* 激活区 */}
        <p className="lic-tip">
          将下方机器码发给作者(RhythmScore 官网/微信),换取你的专属激活码后粘贴激活。一次购买,永久使用。
        </p>
        <div className="machine-row">
          <code>{machine || '正在获取…'}</code>
          <button className="btn icon" title="复制机器码" onClick={() => void copyMachine()} disabled={!machine}>
            <Copy size={13} />
          </button>
        </div>
        {!licensed && (
          <input
            className="modal-input"
            placeholder="粘贴激活码"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void doActivate()
            }}
            autoFocus
          />
        )}
        {err && (
          <p className="pro-err" style={{ color: err === '机器码已复制' ? '#4be08c' : '#ff8f8d' }}>
            {err}
          </p>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            关闭
          </button>
          {!licensed && (
            <button className="btn primary" disabled={busy} onClick={() => void doActivate()}>
              <KeyRound size={13} /> {busy ? '验证中…' : '激活专业版'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
