import { create } from 'zustand'
import type { MarkEvent, ProjectFile, ScoreSource, Selected, Tool, VLine } from './types'
import { mergePages, type PageImage } from './merge'

let uid = 0
function genId(): string {
  uid += 1
  return `id_${Date.now().toString(36)}_${uid}`
}

interface EditorState {
  projectName: string
  dirty: boolean
  /** 界面主题:system=跟随系统 / light=白天 / dark=黑夜;持久化到 localStorage */
  theme: 'system' | 'light' | 'dark'
  setTheme: (t: 'system' | 'light' | 'dark') => void
  /** 专业版授权状态(离线激活码) */
  licensed: boolean
  licenseKey: string | null
  setLicensed: (b: boolean, key: string | null) => void
  /** 激活弹窗开关(App 顶层渲染,避免被顶栏层级遮挡) */
  licenseModalOpen: boolean
  setLicenseModalOpen: (b: boolean) => void

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
  /** 对点事件序列(按时间排序;同一小节可多次出现 = 反复) */
  markEvents: MarkEvent[]
  /** 对点模式开关:开启后点击曲谱小节 = 给该小节追加一个时间点(反复可多点几次) */
  marking: boolean
  /** 对点模式下"下一个待打点的小节"(打点后自动+1,曲谱上橙色虚线框提示) */
  markingNext: number | null

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
  /** 标线颜色(横线/竖线/当前小节预览选框统一跟随) */
  markLineColor: string
  setMarkLineColor: (c: string) => void

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
  /** 追加对点事件(同一小节可多次打点=反复);按时间排序 */
  addMarkEvent: (n: number, time: number) => void
  /** 微调当前小节最近一个事件的时间(±delta) */
  adjustMarkEvent: (n: number, delta: number) => void
  /** 按事件索引微调时间(±delta);排序后索引会变化,调用方先 indexOf 定位 */
  adjustMarkEventByIndex: (idx: number, delta: number) => void
  /** 修改某事件的演奏序号(编号):该事件及之后所有事件序号顺延为 newN, newN+1…(不影响播放的物理小节引用) */
  setMarkEventNumber: (idx: number, newN: number) => void
  /** 直接设置某个事件的时间(秒) */
  setMarkEventTime: (idx: number, time: number) => void
  /** 删除某个对点事件(误打点修正);删除后所有事件编号重新连续匹配 */
  removeMarkEvent: (idx: number) => void
  /** 清除所有对点 */
  clearMarkEvents: () => void
  setMarking: (b: boolean) => void
  setMarkingNext: (n: number | null) => void

  // ---------- 视频导出:光标线设置(连续模式) ----------
  cursorColor: string
  cursorWidth: number
  /** 光标线浓度(颜色深浅,0.2~1) */
  cursorOpacity: number
  setCursorColor: (c: string) => void
  setCursorWidth: (w: number) => void
  setCursorOpacity: (o: number) => void

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
  theme: (localStorage.getItem('wb-theme') as 'system' | 'light' | 'dark') || 'system',
  setTheme: (t) => set({ theme: t }),
  licensed: false,
  licenseKey: null,
  setLicensed: (b, key) => set({ licensed: b, licenseKey: key }),
  licenseModalOpen: false,
  setLicenseModalOpen: (b) => set({ licenseModalOpen: b }),
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
  markEvents: [],
  marking: false,
  markingNext: null,

  cursorColor: '#E24B4A',
  cursorWidth: 5,
  cursorOpacity: 0.85,

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
      markEvents: [],
      currentMeasure: null,
      markingNext: null,
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
  markLineColor: '#378ADD',
  setMarkLineColor: (c) => set({ markLineColor: c }),

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
      markEvents: [],
      currentMeasure: null
    }),
  setPlaying: (b) => set({ isPlaying: b }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setAudioDuration: (d) => set({ audioDuration: d }),
  setWaveform: (peaks) => set({ waveformPeaks: peaks }),
  selectMeasure: (n) => set({ currentMeasure: n }),
  addMarkEvent: (n, time) => {
    const evs = [...get().markEvents, { n, time, base: time }]
    evs.sort((a, b) => a.time - b.time)
    // 打点后预选框自动指向下一个小节(物理顺序)
    set({ markEvents: evs, markingNext: n + 1, dirty: true })
  },
  adjustMarkEvent: (n, delta) => {
    const evs = [...get().markEvents]
    let idx = -1
    for (let i = evs.length - 1; i >= 0; i--) {
      if (evs[i].n === n) {
        idx = i
        break
      }
    }
    if (idx < 0) return
    const limit = get().audioDuration > 0 ? get().audioDuration : Number.MAX_SAFE_INTEGER
    evs[idx] = { ...evs[idx], time: Math.min(Math.max(evs[idx].time + delta, 0), limit) }
    evs.sort((a, b) => a.time - b.time)
    set({ markEvents: evs, dirty: true })
  },
  setMarking: (b) => set({ marking: b }),
  setMarkingNext: (n) => set({ markingNext: n }),
  clearMarkEvents: () => set({ markEvents: [], currentMeasure: null, markingNext: null, dirty: true }),
  adjustMarkEventByIndex: (idx, delta) => {
    const evs = [...get().markEvents]
    if (idx < 0 || idx >= evs.length) return
    const limit = get().audioDuration > 0 ? get().audioDuration : Number.MAX_SAFE_INTEGER
    evs[idx] = { ...evs[idx], time: Math.min(Math.max(evs[idx].time + delta, 0), limit) }
    evs.sort((a, b) => a.time - b.time)
    set({ markEvents: evs, dirty: true })
  },
  setMarkEventNumber: (idx, newN) => {
    const evs = [...get().markEvents]
    if (idx < 0 || idx >= evs.length || !Number.isFinite(newN) || newN < 1) return
    // 该事件及之后所有事件的演奏序号顺延为 newN, newN+1…(不改变物理小节引用,播放仍按物理小节跳转)
    for (let j = idx; j < evs.length; j++) {
      evs[j] = { ...evs[j], label: newN + (j - idx) }
    }
    set({ markEvents: evs, dirty: true })
  },
  setMarkEventTime: (idx, time) => {
    const evs = [...get().markEvents]
    if (idx < 0 || idx >= evs.length) return
    const limit = get().audioDuration > 0 ? get().audioDuration : Number.MAX_SAFE_INTEGER
    evs[idx] = { ...evs[idx], time: Math.min(Math.max(time, 0), limit) }
    evs.sort((a, b) => a.time - b.time)
    set({ markEvents: evs, dirty: true })
  },
  removeMarkEvent: (idx) => {
    const evs = [...get().markEvents]
    if (idx < 0 || idx >= evs.length) return
    evs.splice(idx, 1)
    // 删除后重新连续编号:清除自定义序号,按 1..N 自动匹配
    const renumbered = evs.map((e) => ({ ...e, label: undefined }))
    set({ markEvents: renumbered, dirty: true })
  },

  setCursorColor: (c) => set({ cursorColor: c }),
  setCursorWidth: (w) => set({ cursorWidth: w }),
  setCursorOpacity: (o) => set({ cursorOpacity: o }),

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
      markEvents: s.markEvents.length ? s.markEvents : undefined,
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
      // 事件序列:新格式优先;旧格式(measureTimes)自动转换
      markEvents: p.markEvents ?? Object.entries(p.measureTimes ?? {})
        .map(([n, t]) => ({ n: Number(n), time: t, base: t }))
        .sort((a, b) => a.time - b.time),
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
      markingNext: null
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
      markEvents: [],
      measureLabel: {},
      marking: false,
      markingNext: null
    })
}))
