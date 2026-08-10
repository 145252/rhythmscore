import { create } from 'zustand'
import type { ProjectFile, ScoreSource, Selected, Tool, VLine } from './types'
import { mergePages, type PageImage } from './merge'

let uid = 0
function genId(): string {
  uid += 1
  return `id_${Date.now().toString(36)}_${uid}`
}

interface EditorState {
  projectName: string
  dirty: boolean

  score: ScoreSource | null
  /** 多页曲谱(按顺序合并为长图;顺序可调整) */
  scorePages: PageImage[]
  hLines: number[]
  vLines: VLine[]

  tool: Tool
  lineWidth: number
  selected: Selected | null

  /** 显示缩放倍率(1 = 铺满容器宽度) */
  scale: number

  // ---------- 音频与对点 ----------
  audioName: string | null
  audioDataUrl: string | null
  audioDuration: number
  isPlaying: boolean
  currentTime: number
  waveformPeaks: number[] | null
  /** 当前选中的小节编号(1-based) */
  currentMeasure: number | null
  /** 对点映射:小节编号 → 音频时间(秒) */
  measureTimes: Record<number, number>
  /** 打点基准时间:小节编号 → 首次打点时间(秒),用于显示微调偏移 */
  measureBaseTimes: Record<number, number>
  /** 对点模式开关:开启后点击曲谱小节 = 把当前播放时间记到该小节 */
  marking: boolean
  /** 对点模式下"下一个待打点的小节"(回车打点目标,曲谱上橙色虚线框) */
  markingTarget: number | null

  setScore: (s: ScoreSource | null) => void
  /** 设置多页曲谱:按页顺序合并为长图;页变化会清空标注(提示重新分割) */
  setScorePages: (pages: PageImage[]) => Promise<void>
  reorderScorePage: (from: number, to: number) => Promise<void>
  removeScorePage: (idx: number) => Promise<void>
  addHLine: (y: number) => void
  addVLine: (x: number, row: number, kind?: 'full' | 'measure') => void
  updateHLine: (sortedIdx: number, y: number) => void
  updateVLine: (id: string, x: number) => void
  removeLine: (sel: Selected) => void
  clearHLines: () => void
  clearVLines: () => void

  setTool: (t: Tool) => void
  setLineWidth: (w: number) => void
  setSelected: (s: Selected | null) => void
  setScale: (s: number) => void

  /** 标线自动吸附开关(默认开) */
  snapEnabled: boolean
  setSnapEnabled: (b: boolean) => void
  /** 小节自定义编号(原始编号 → 显示编号;缺省显示原始编号) */
  measureLabel: Record<number, number>
  setMeasureLabel: (m: Record<number, number>) => void

  setAudio: (name: string, dataUrl: string) => void
  clearAudio: () => void
  setPlaying: (b: boolean) => void
  setCurrentTime: (t: number) => void
  setAudioDuration: (d: number) => void
  setWaveform: (peaks: number[] | null) => void
  selectMeasure: (n: number | null) => void
  setMeasureTime: (n: number, t: number) => void
  setMeasureBase: (n: number, t: number) => void
  setMarking: (b: boolean) => void
  setMarkingTarget: (n: number | null) => void

  // ---------- 视频导出:光标线设置(连续模式) ----------
  cursorColor: string
  cursorWidth: number
  setCursorColor: (c: string) => void
  setCursorWidth: (w: number) => void

  // ---------- 视频导出:跟随模式与跳框高亮颜色 ----------
  videoMode: 'continuous' | 'jump'
  jumpColor: string
  jumpOpacity: number
  nextColor: string
  nextOpacity: number
  setVideoMode: (m: 'continuous' | 'jump') => void
  setJumpColor: (c: string) => void
  setJumpOpacity: (o: number) => void
  setNextColor: (c: string) => void
  setNextOpacity: (o: number) => void

  serialize: () => ProjectFile
  loadProject: (p: ProjectFile) => void
  clearProject: () => void
  setProjectName: (n: string) => void
  markSaved: () => void
}

export const useStore = create<EditorState>((set, get) => ({
  projectName: '未命名曲谱',
  dirty: false,

  score: null,
  hLines: [],
  vLines: [],
  scorePages: [],

  tool: 'hline',
  lineWidth: 2,
  selected: null,

  scale: 1,

  audioName: null,
  audioDataUrl: null,
  audioDuration: 0,
  isPlaying: false,
  currentTime: 0,
  waveformPeaks: null,
  currentMeasure: null,
  measureTimes: {},
  measureBaseTimes: {},
  marking: false,
  markingTarget: null,

  cursorColor: '#E24B4A',
  cursorWidth: 5,

  videoMode: 'continuous',
  jumpColor: '#E24B4A',
  jumpOpacity: 0.24,
  nextColor: '#E24B4A',
  nextOpacity: 0.07,

  setScore: (s) => set({ score: s, dirty: true }),
  setScorePages: async (pages) => {
    if (pages.length === 0) {
      set({ score: null, scorePages: [], hLines: [], vLines: [], selected: null, dirty: true })
      return
    }
    const merged = await mergePages(pages)
    set({
      scorePages: pages,
      score: {
        kind: 'image',
        name: '合并曲谱',
        dataUrl: merged.dataUrl,
        width: merged.width,
        height: merged.height
      },
      // 合并图尺寸/内容变化,旧标注坐标失效 → 清空,提示重新分割
      hLines: [],
      vLines: [],
      selected: null,
      measureTimes: {},
      measureBaseTimes: {},
      currentMeasure: null,
      scale: 1,
      dirty: true
    })
  },
  reorderScorePage: async (from, to) => {
    const pages = [...useStore.getState().scorePages]
    if (from < 0 || from >= pages.length || to < 0 || to >= pages.length || from === to) return
    const [item] = pages.splice(from, 1)
    pages.splice(to, 0, item)
    await useStore.getState().setScorePages(pages)
  },
  removeScorePage: async (idx) => {
    const pages = [...useStore.getState().scorePages]
    if (idx < 0 || idx >= pages.length) return
    pages.splice(idx, 1)
    await useStore.getState().setScorePages(pages)
  },
  addHLine: (y) => {
    const s = get()
    const exists = s.hLines.some((v) => Math.abs(v - y) < 6)
    if (exists) return
    set({ hLines: [...s.hLines, y], dirty: true })
  },
  addVLine: (x, row, kind = 'measure') => {
    const s = get()
    const exists = s.vLines.some((v) => v.kind === kind && v.row === row && Math.abs(v.x - x) < 6)
    if (exists) return
    set({ vLines: [...s.vLines, { id: genId(), x, row, kind }], dirty: true })
  },
  updateHLine: (sortedIdx, y) => {
    const s = get()
    const sorted = [...s.hLines].sort((a, b) => a - b)
    if (sortedIdx < 0 || sortedIdx >= sorted.length) return
    const orig = sorted[sortedIdx]
    set({ hLines: s.hLines.map((v) => (Math.abs(v - orig) < 1e-6 ? y : v)), dirty: true })
  },
  updateVLine: (id, x) => {
    const s = get()
    set({ vLines: s.vLines.map((v) => (v.id === id ? { ...v, x } : v)), dirty: true })
  },
  removeLine: (sel) => {
    const s = get()
    if (sel.type === 'h') {
      const sorted = [...s.hLines].sort((a, b) => a - b)
      const idx = Number(sel.id)
      if (idx >= 0 && idx < sorted.length) {
        const val = sorted[idx]
        set({ hLines: s.hLines.filter((v) => Math.abs(v - val) > 1e-6), selected: null, dirty: true })
      }
    } else {
      set({ vLines: s.vLines.filter((v) => v.id !== sel.id), selected: null, dirty: true })
    }
  },
  clearHLines: () => set({ hLines: [], vLines: [], selected: null, dirty: true }),
  clearVLines: () => set({ vLines: [], selected: null, dirty: true }),

  setTool: (t) => set({ tool: t }),
  setLineWidth: (w) => set({ lineWidth: w, dirty: true }),
  setSelected: (s) => set({ selected: s }),
  setScale: (s) => set({ scale: s }),

  snapEnabled: false,
  setSnapEnabled: (b) => set({ snapEnabled: b }),
  measureLabel: {},
  setMeasureLabel: (m) => set({ measureLabel: m, dirty: true }),

  setAudio: (name, dataUrl) =>
    set({ audioName: name, audioDataUrl: dataUrl, isPlaying: false, currentTime: 0, dirty: true }),
  clearAudio: () =>
    set({
      audioName: null,
      audioDataUrl: null,
      audioDuration: 0,
      isPlaying: false,
      currentTime: 0,
      waveformPeaks: null,
      measureTimes: {},
      measureBaseTimes: {},
      currentMeasure: null
    }),
  setPlaying: (b) => set({ isPlaying: b }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setAudioDuration: (d) => set({ audioDuration: d }),
  setWaveform: (peaks) => set({ waveformPeaks: peaks }),
  selectMeasure: (n) => set({ currentMeasure: n }),
  setMeasureTime: (n, t) => set({ measureTimes: { ...get().measureTimes, [n]: t }, dirty: true }),
  setMeasureBase: (n, t) => set({ measureBaseTimes: { ...get().measureBaseTimes, [n]: t } }),
  setMarking: (b) => set({ marking: b }),
  setMarkingTarget: (n) => set({ markingTarget: n }),

  setCursorColor: (c) => set({ cursorColor: c }),
  setCursorWidth: (w) => set({ cursorWidth: w }),

  setVideoMode: (m) => set({ videoMode: m }),
  setJumpColor: (c) => set({ jumpColor: c }),
  setJumpOpacity: (o) => set({ jumpOpacity: o }),
  setNextColor: (c) => set({ nextColor: c }),
  setNextOpacity: (o) => set({ nextOpacity: o }),

  serialize: () => {
    const s = get()
    return {
      version: 1,
      name: s.projectName,
      score: s.score,
      scorePages: s.scorePages,
      hLines: s.hLines,
      vLines: s.vLines,
      measureTimes: Object.keys(s.measureTimes).length ? s.measureTimes : undefined,
      measureLabel: Object.keys(s.measureLabel).length ? s.measureLabel : undefined,
      audio:
        s.audioDataUrl && s.audioName
          ? { name: s.audioName, dataUrl: s.audioDataUrl }
          : null
    }
  },
  loadProject: (p) =>
    set({
      projectName: p.name || '未命名曲谱',
      score: p.score ?? null,
      scorePages: p.scorePages ?? [],
      hLines: p.hLines ?? [],
      vLines: (p.vLines ?? []).map((v) => ({ ...v, kind: v.kind ?? ('measure' as const) })),
      selected: null,
      dirty: false,
      scale: 1,
      measureTimes: p.measureTimes ?? {},
      measureBaseTimes: p.measureTimes ?? {},
      measureLabel: p.measureLabel ?? {},
      // 恢复音频(打开后自动加载,无需重新导入)
      audioName: p.audio?.name ?? null,
      audioDataUrl: p.audio?.dataUrl ?? null,
      audioDuration: 0,
      isPlaying: false,
      currentTime: 0,
      waveformPeaks: null,
      currentMeasure: null,
      marking: false,
      markingTarget: null
    }),
  setProjectName: (n) => set({ projectName: n }),
  markSaved: () => set({ dirty: false }),
  clearProject: () =>
    set({
      projectName: '未命名曲谱',
      dirty: false,
      score: null,
      scorePages: [],
      hLines: [],
      vLines: [],
      selected: null,
      scale: 1,
      audioName: null,
      audioDataUrl: null,
      audioDuration: 0,
      isPlaying: false,
      currentTime: 0,
      waveformPeaks: null,
      currentMeasure: null,
      measureTimes: {},
      measureBaseTimes: {},
      measureLabel: {},
      marking: false,
      markingTarget: null
    })
}))
