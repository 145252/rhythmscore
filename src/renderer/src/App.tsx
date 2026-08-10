import React from 'react'
import { Music4 } from 'lucide-react'
import TopBar from './components/TopBar'
import LeftPanel from './components/LeftPanel'
import ScoreCanvas from './components/ScoreCanvas'
import RightPanel from './components/RightPanel'

export default function App(): React.JSX.Element {
  return (
    <div className="app">
      {/* 顶部拖拽条:专门用于拖动窗口,控制按钮浮在此区域,品牌居中也放这里 */}
      <div className="drag-strip">
        <div className="brand">
          <span className="brand-logo">
            <Music4 size={15} />
          </span>
          <span className="brand-name">动态曲谱工作台</span>
        </div>
      </div>
      <TopBar />
      <div className="app-body">
        <LeftPanel />
        <ScoreCanvas />
        <RightPanel />
      </div>
    </div>
  )
}
