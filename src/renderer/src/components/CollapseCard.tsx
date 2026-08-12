import React, { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

interface CollapseCardProps {
  title: string
  /** 默认是否展开(默认收起) */
  defaultOpen?: boolean
  children: ReactNode
}

/** 可折叠面板:点击标题栏展开/收起,收起后仅剩标题条,节省侧栏空间 */
export default function CollapseCard({
  title,
  defaultOpen = false,
  children
}: CollapseCardProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`card collapse-card ${open ? 'open' : ''}`}>
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
