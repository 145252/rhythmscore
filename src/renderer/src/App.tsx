import React, { useEffect } from 'react'
import { useStore } from './store'
import TopBar from './components/TopBar'
import LeftPanel from './components/LeftPanel'
import ScoreCanvas from './components/ScoreCanvas'
import RightPanel from './components/RightPanel'
import LicenseModal from './components/LicenseModal'
import brandLogo from './assets/rhythmscore-logo.png'

export default function App(): React.JSX.Element {
  const theme = useStore((s) => s.theme)
  const licenseModalOpen = useStore((s) => s.licenseModalOpen)
  const setLicenseModalOpen = useStore((s) => s.setLicenseModalOpen)

  // 主题:system 跟随系统(监听系统切换自动变化),手动 light/dark 直接应用
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      document.body.classList.toggle('dark', dark)
      localStorage.setItem('wb-theme', theme)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  return (
    <div className="app">
      {/* 顶部拖拽条:专门用于拖动窗口,控制按钮浮在此区域,品牌居中也放这里 */}
      <div className="drag-strip">
        <div className="brand">
          <span className="brand-logo">
            <img src={brandLogo} alt="" className="brand-logo-img" />
          </span>
          <span className="brand-name">RhythmScore</span>
        </div>
      </div>
      <TopBar />
      <div className="app-body">
        <LeftPanel />
        <ScoreCanvas />
        <RightPanel />
      </div>
      <LicenseModal open={licenseModalOpen} onClose={() => setLicenseModalOpen(false)} />
    </div>
  )
}
