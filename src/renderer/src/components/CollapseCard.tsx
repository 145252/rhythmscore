import React, { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

interface CollapseCardProps {
  title: string
  /** 默认是否展开(默认收起) */
  defaultOpen?: boolean
  /** 强制展开信号:从 false→true 时自动展开(如导入曲谱后) */
  forceOpen?: boolean
  children: ReactNode
}

/** 可折叠面板:点击标题栏展开/收起,收起后仅剩居中的标题条 + 箭头 */
export default function CollapseCard({
  title,
  defaultOpen = false,
  forceOpen = false,
  children
}: CollapseCardProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  // 动画结束后才启用内部滚动,避免展开过程中滚动条闪现/抖动
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => setReady(true), 480)
      return () => clearTimeout(t)
    }
    setReady(false)
  }, [open])
  // 外部强制展开信号
  useEffect(() => {
    if (forceOpen) setOpen(true)
  }, [forceOpen])
  return (
    <div className={`card collapse-card ${open ? 'open' : ''} ${open && ready ? 'ready' : ''}`}>
      <button
        type="button"
        className="collapse-head"
        onClick={() => setOpen((o) => !o)}
        title={open ? '收起' : '展开'}
      >
        <h3 className="card-title">{title}</h3>
        <ChevronDown size={15} className={`collapse-arrow ${open ? 'rot' : ''}`} />
      </button>
      <div className={`collapse-body ${open ? 'open' : ''}`}>
        <div className="collapse-inner">{children}</div>
      </div>
    </div>
  )
}
