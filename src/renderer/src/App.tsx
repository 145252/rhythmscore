import React from 'react'
import TopBar from './components/TopBar'
import LeftPanel from './components/LeftPanel'
import ScoreCanvas from './components/ScoreCanvas'
import RightPanel from './components/RightPanel'

export default function App(): React.JSX.Element {
  return (
    <div className="app">
      <TopBar />
      <div className="app-body">
        <LeftPanel />
        <ScoreCanvas />
        <RightPanel />
      </div>
    </div>
  )
}
