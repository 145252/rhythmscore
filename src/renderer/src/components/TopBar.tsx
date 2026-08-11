import React, { useEffect, useRef } from 'react'
import { CheckCircle2, Crown, FolderOpen, Monitor, Moon, Save, Sun, X } from 'lucide-react'
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
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const licensed = useStore((s) => s.licensed)
  const setLicensed = useStore((s) => s.setLicensed)
  const setLicenseModalOpen = useStore((s) => s.setLicenseModalOpen)
  const jsonInputRef = useRef<HTMLInputElement>(null)

  // 启动时校验本地已保存的激活码
  useEffect(() => {
    const key = localStorage.getItem('rs-license-key')
    if (!key || !window.api?.isElectron) return
    void window.api.activateLicense(key).then((r) => {
      setLicensed(r.ok, r.ok ? key : null)
      if (!r.ok) localStorage.removeItem('rs-license-key')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // 应用菜单(文件 → 打开/保存项目)触发对应操作
  useEffect(() => {
    window.api?.onMenuAction?.((action) => {
      if (action === 'open-project') void open()
      if (action === 'save-project') void save()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        <button
          className={`btn pro-topbar ${licensed ? 'pro-active' : ''}`}
          title={licensed ? '专业版已激活,点击查看' : '升级专业版:去除导出水印、解锁全高清'}
          onClick={() => setLicenseModalOpen(true)}
        >
          {licensed ? <CheckCircle2 size={14} /> : <Crown size={14} />}
          {licensed ? 'Pro' : '专业版'}
        </button>
        <button
          className="btn icon"
          title={
            theme === 'system'
              ? '跟随系统(点击可手动切换)'
              : theme === 'dark'
                ? '黑夜模式(点击切换)'
                : '白天模式(点击切换)'
          }
          onClick={() => {
            const order: ('system' | 'light' | 'dark')[] = ['system', 'light', 'dark']
            setTheme(order[(order.indexOf(theme) + 1) % order.length])
          }}
        >
          {theme === 'system' ? <Monitor size={14} /> : theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
        </button>
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
