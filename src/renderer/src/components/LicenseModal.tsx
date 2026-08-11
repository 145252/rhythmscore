import React, { useEffect, useState } from 'react'
import { CheckCircle2, Copy, KeyRound } from 'lucide-react'
import { useStore } from '../store'

interface Props {
  open: boolean
  onClose: () => void
}

/** 专业版激活弹窗(顶部栏入口触发) */
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
      setErr('激活码无效,请确认与上方机器码匹配')
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <h4>{licensed ? '专业版已激活' : '激活专业版'}</h4>
        <p>
          {licensed
            ? '感谢支持!已解锁无水印、全高清导出。'
            : '将下方机器码发给作者(RhythmScore 官网/微信),换取你的专属激活码后粘贴激活。一次购买,永久使用。'}
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
              <KeyRound size={13} /> {busy ? '验证中…' : '激活'}
            </button>
          )}
          {licensed && (
            <span className="pro-ok" style={{ margin: 0 }}>
              <CheckCircle2 size={15} /> 已激活
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
