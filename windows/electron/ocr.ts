import { app } from 'electron'
import path from 'node:path'
import { createWorker, Worker } from 'tesseract.js'
import { OCRResult } from './contracts'

export class OfflineOCR {
  private workerPromise?: Promise<Worker>

  private languagePath() {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'ocr')
      : path.resolve(__dirname, '..', 'resources', 'ocr')
  }

  private getWorker() {
    if (!this.workerPromise) {
      this.workerPromise = createWorker(['chi_sim', 'eng'], 1, {
        langPath: this.languagePath(),
        gzip: true,
        cacheMethod: 'none',
      })
    }
    return this.workerPromise
  }

  async recognize(image: Buffer): Promise<OCRResult> {
    const worker = await this.getWorker()
    const result = await worker.recognize(image)
    return {
      text: result.data.text.trim(),
      confidence: Math.round(result.data.confidence * 10) / 10,
      language: '简体中文 + English',
    }
  }

  async terminate() {
    if (!this.workerPromise) return
    const worker = await this.workerPromise
    await worker.terminate()
    this.workerPromise = undefined
  }
}
