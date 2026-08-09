import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url'

let workerReady = false
export function ensurePdfWorker(): void {
  if (!workerReady) {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    workerReady = true
  }
}

/** 加载 PDF 文档(不渲染) */
export async function loadPdfDoc(data: ArrayBuffer | Uint8Array): Promise<PDFDocumentProxy> {
  ensurePdfWorker()
  return pdfjs.getDocument({ data }).promise
}

/** 渲染指定页为 dataURL 图像。按目标宽度自适应分辨率(保证视频导出清晰度) */
export async function renderPdfPageDoc(
  doc: PDFDocumentProxy,
  pageNumber: number,
  targetWidth = 2200
): Promise<{ dataUrl: string; width: number; height: number }> {
  const page = await doc.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  // 目标宽度 2200px(1080p/2K 输出足够),限制范围避免超大
  const scale = Math.min(Math.max(targetWidth / Math.max(base.width, 1), 1.2), 4)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 不可用')
  await page.render({ canvasContext: ctx, viewport }).promise
  page.cleanup()
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
}

/** 便捷:一步完成 加载 + 渲染单页(P1 遗留用法) */
export async function renderPdfPage(
  data: ArrayBuffer | Uint8Array,
  pageNumber: number
): Promise<{ dataUrl: string; width: number; height: number; numPages: number }> {
  const doc = await loadPdfDoc(data)
  const r = await renderPdfPageDoc(doc, pageNumber)
  const numPages = doc.numPages
  void doc.destroy()
  return { ...r, numPages }
}

export { base64ToUint8 }
import { base64ToUint8 } from './base64'
