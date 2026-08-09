import React, { useRef } from 'react'
import { FolderOpen, Music4, Save } from 'lucide-react'
import { useStore } from '../store'

export default function TopBar(): React.JSX.Element {
  const projectName = useStore((s) => s.projectName)
  const setProjectName = useStore((s) => s.setProjectName)
  const dirty = useStore((s) => s.dirty)
  const serialize = useStore((s) => s.serialize)
  const loadProject = useStore((s) => s.loadProject)
  const markSaved = useStore((s) => s.markSaved)
  const jsonInputRef = useRef<HTMLInputElement>(null)

  const save = async (): Promise<void> => {
    const json = JSON.stringify(serialize())
    if (window.api?.isElectron) {
      const p = await window.api.saveProject(projectName, json)
      if (p) markSaved()
    } else {
      const blob = new Blob([json], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${projectName || '未命名曲谱'}.dscore.json`
      a.click()
      URL.revokeObjectURL(a.href)
      markSaved()
    }
  }

  const open = async (): Promise<void> => {
    if (window.api?.isElectron) {
      const r = await window.api.openProject()
      if (!r) return
      try {
        loadProject(JSON.parse(r.content))
      } catch {
        alert('项目文件解析失败,可能不是有效的曲谱项目文件')
      }
    } else {
      jsonInputRef.current?.click()
    }
  }

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-logo">
          <Music4 size={16} />
        </span>
        <span className="brand-name">动态曲谱工作台</span>
      </div>
      <div className="project-name">
        <input
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          spellCheck={false}
          title="项目名称"
        />
        {dirty && <span className="dirty-dot" title="有未保存的修改" />}
      </div>
      <div className="topbar-actions">
        <button className="btn" onClick={() => void open()}>
          <FolderOpen size={14} /> 打开项目
        </button>
        <button className="btn primary" onClick={() => void save()}>
          <Save size={14} /> 保存项目
        </button>
      </div>
      <input
        ref={jsonInputRef}
        type="file"
        accept=".json,.dscore.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) {
            const fr = new FileReader()
            fr.onload = () => {
              try {
                loadProject(JSON.parse(fr.result as string))
              } catch {
                alert('项目文件解析失败')
              }
            }
            fr.readAsText(f)
          }
          e.target.value = ''
        }}
      />
    </header>
  )
}
