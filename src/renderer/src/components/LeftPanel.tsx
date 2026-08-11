import React from 'react'
import { AlignVerticalJustifyCenter, Hand, Minus, MousePointer2, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import AudioPanel from './AudioPanel'
import ColorSwatches from './ColorSwatches'

const TOOL_HINTS: Record<string, string> = {
  hline: '横线模式:点击每一行谱表的上下边界。横线会自动截断在左右边框竖线之间',
  vline: '竖线模式:① 无横线时点击 = 画贯穿全图的边框线(左右各一条);② 有横线后点击 = 画行内小节线;按住 Shift 可强制画贯穿线',
  select: '选择模式:点线可拖动微调 / 点小节空白处可选中该小节 / Delete 删除 / 右键小节可改编号',
  pan: '使用滚轮上下滚动浏览曲谱'
}

export default function LeftPanel(): React.JSX.Element {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const lineWidth = useStore((s) => s.lineWidth)
  const setLineWidth = useStore((s) => s.setLineWidth)
  const clearHLines = useStore((s) => s.clearHLines)
  const clearVLines = useStore((s) => s.clearVLines)
  const snapEnabled = useStore((s) => s.snapEnabled)
  const setSnapEnabled = useStore((s) => s.setSnapEnabled)
  const markLineColor = useStore((s) => s.markLineColor)
  const setMarkLineColor = useStore((s) => s.setMarkLineColor)
  const beatSubdivision = useStore((s) => s.beatSubdivision)
  const setBeatSubdivision = useStore((s) => s.setBeatSubdivision)
  const beatsPerMeasure = useStore((s) => s.beatsPerMeasure)
  const setBeatsPerMeasure = useStore((s) => s.setBeatsPerMeasure)
  const resetBeatRatios = useStore((s) => s.resetBeatRatios)

  const BEAT_OPTIONS = [
    { v: 2, label: '2/4' },
    { v: 3, label: '3/4' },
    { v: 4, label: '4/4' },
    { v: 5, label: '5/4' },
    { v: 6, label: '6/8' },
    { v: 8, label: '8/8' },
    { v: 9, label: '9/8' },
    { v: 12, label: '12/8' }
  ]

  const tools = [
    { id: 'hline' as const, icon: <Minus size={16} />, label: '横线' },
    { id: 'vline' as const, icon: <AlignVerticalJustifyCenter size={16} />, label: '竖线' },
    { id: 'select' as const, icon: <MousePointer2 size={16} />, label: '选择' },
    { id: 'pan' as const, icon: <Hand size={16} />, label: '浏览' }
  ]

  return (
    <aside className="side-panel left">
      <div className="card">
        <h3 className="card-title">
          <span className="num">1</span> 分割乐谱
        </h3>
        <div className="tool-grid">
          {tools.map((t) => (
            <button
              key={t.id}
              className={`btn tool ${tool === t.id ? 'active' : ''}`}
              onClick={() => setTool(t.id)}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div className="line-width-row">
          <span>线宽</span>
          <input
            type="range"
            min={1}
            max={6}
            value={lineWidth}
            onChange={(e) => setLineWidth(Number(e.target.value))}
          />
          <span className="lv">{lineWidth}px</span>
        </div>

        <p className="label">标线颜色</p>
        <ColorSwatches value={markLineColor} onChange={setMarkLineColor} />

        <label className="marking-toggle">
          <span>自动吸附</span>
          <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} />
          <span className="toggle-track">
            <span className="toggle-thumb" />
          </span>
        </label>

        <div className="line-actions">
          <button className="btn subtle" onClick={clearVLines}>
            清空竖线
          </button>
          <button className="btn danger-text" onClick={clearHLines}>
            <Trash2 size={13} /> 清空全部(横线+竖线)
          </button>
        </div>

        <p className="hint">{TOOL_HINTS[tool]}</p>

        {/* 拍号细分:每小节内按拍标线,光标按实际拍距走 */}
        <p className="label" style={{ marginTop: 14 }}>
          拍号细分
        </p>
        <label className="marking-toggle">
          <span>开启(每小节按拍分线)</span>
          <input type="checkbox" checked={beatSubdivision} onChange={(e) => setBeatSubdivision(e.target.checked)} />
          <span className="toggle-track">
            <span className="toggle-thumb" />
          </span>
        </label>
        {beatSubdivision && (
          <>
            <div className="line-width-row">
              <span>拍号</span>
              <select
                className="beat-select"
                value={beatsPerMeasure}
                onChange={(e) => setBeatsPerMeasure(Number(e.target.value))}
              >
                {BEAT_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="hint">
              拍线默认按拍号等分,可到谱面上用「选择」工具拖动每一条拍线,对准每拍音符起始位置;光标线将按每拍实际距离走。
            </p>
            <button className="btn subtle" onClick={resetBeatRatios}>
              重置拍线为等分
            </button>
          </>
        )}
      </div>

      <div className="section-gap" />

      <AudioPanel />
    </aside>
  )
}
