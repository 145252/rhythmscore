import React, { useRef } from 'react'
import { FolderOpen, Save, X } from 'lucide-react'
import { useStore } from '../store'
import { getAudio } from '../audioPlayer'

export default function TopBar(): React.JSX.Element {
  const projectName = useStore((s) => s.projectName)
  const setProjectName = useStore((s) => s.setProjectName)
  const dirty = useStore((s) => s.dirty)
  const serialize = useStore((s) => s.serialize)
  const loadProject = useStore((s) => s.loadProject)
  const clearProject = useStore((s) => s.clearProject)
  const markSaved = useStore((s) => s.markSaved)
  const jsonInputRef = useRef<HTMLInputElement>(null)

  const save = async (): Promise<void> => {
    const json = JSON.stringify(serialize())
    if (window.api?.isElectron) {
      const p = await window.api.saveProject(projectName, json)
      if (p) {
        // 保存后把项目名同步为文件名(不含扩展名),下次保存默认用项目名
        const base = p.split('/').pop()?.replace(/\.dscore(\.json)?$/i, '') ?? projectName
        setProjectName(base)
        markSaved()
      }
    } else {
      const blob = new Blob([json], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${projectName || '未命名曲谱'}.dscore`
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
        // 打开后把项目名同步为文件名(不含扩展名)
        const base = r.path.split('/').pop()?.replace(/\.dscore(\.json)?$/i, '') ?? ''
        if (base) setProjectName(base)
      } catch {
        alert('项目文件解析失败,可能不是有效的曲谱项目文件')
      }
    } else {
      jsonInputRef.current?.click()
    }
  }

  /** 关闭项目:有未保存修改时先确认,然后清空工作区 */
  const closeProject = (): void => {
    if (dirty && !window.confirm('当前项目有未保存的修改,确定关闭吗?')) return
    getAudio().pause()
    getAudio().removeAttribute('src')
    clearProject()
  }

  return (
    <header className="topbar">
      <div className="project-name">
        <div className="project-name-box">
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            spellCheck={false}
            title="项目名称"
          />
          {dirty && <span className="dirty-dot" title="有未保存的修改" />}
        </div>
      </div>
      <div className="topbar-actions">
        <button className="btn" onClick={() => void open()}>
          <FolderOpen size={14} /> 打开项目
        </button>
        <button className="btn" onClick={closeProject} title="清空当前工作区,开始新项目">
          <X size={14} /> 关闭项目
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
