import * as pdfjsLib from 'pdfjs-dist';
import { rgb } from 'pdf-lib';

/**
 * Configure PDF.js to use the locally vendored worker in ./libs/pdf.worker.min.mjs,
 * and register the bundled worker module lazily only when opened over file:// protocol.
 */
let workerInitialized = false;
export async function ensurePdfJsWorker(): Promise<void> {
  if (workerInitialized) return;
  if (window.location.protocol === 'file:') {
    try {
      const pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.mjs');
      (globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;
    } catch {
      // Fallback to relative workerSrc
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = './libs/pdf.worker.min.mjs';
  } else {
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./libs/pdf.worker.min.mjs', window.location.href).href;
    } catch {
      pdfjsLib.GlobalWorkerOptions.workerSrc = './libs/pdf.worker.min.mjs';
    }
  }
  workerInitialized = true;
}

export { pdfjsLib };

export type PagePreset = 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal' | 'Custom';
export type Orientation = 'portrait' | 'landscape';

/** Standard page dimensions in millimeters (width x height in portrait) */
export const PAGE_PRESETS_MM: Record<Exclude<PagePreset, 'Custom'>, { width: number; height: number; label: string }> = {
  A4: { width: 210, height: 297, label: 'A4 (210 × 297 mm)' },
  A3: { width: 297, height: 420, label: 'A3 (297 × 420 mm)' },
  A5: { width: 148, height: 210, label: 'A5 (148 × 210 mm)' },
  Letter: { width: 215.9, height: 279.4, label: 'Letter (8.5 × 11 in)' },
  Legal: { width: 215.9, height: 355.6, label: 'Legal (8.5 × 14 in)' },
};

const PT_PER_MM = 72 / 25.4;

export function mmToPt(mm: number): number {
  return mm * PT_PER_MM;
}

export function ptToMm(pt: number): number {
  return pt / PT_PER_MM;
}

export function resolvePageSizePt(
  preset: PagePreset,
  orientation: Orientation,
  customMm?: { width: number; height: number }
): { width: number; height: number } {
  const base =
    preset === 'Custom'
      ? { width: Math.max(40, customMm?.width || 210), height: Math.max(40, customMm?.height || 297) }
      : PAGE_PRESETS_MM[preset];

  const wPt = mmToPt(base.width);
  const hPt = mmToPt(base.height);
  if (orientation === 'landscape') {
    return { width: Math.max(wPt, hPt), height: Math.min(wPt, hPt) };
  }
  return { width: Math.min(wPt, hPt), height: Math.max(wPt, hPt) };
}

/**
 * Convert #RRGGBB or rgb(...) CSS color string into pdf-lib RGB (0..1).
 */
export function cssColorToRgb(colorStr: string | null | undefined, fallbackHex = '#0f172a') {
  const parseHex = (hex: string) => {
    const clean = hex.replace('#', '').trim();
    if (clean.length === 3) {
      const r = parseInt(clean[0] + clean[0], 16) / 255;
      const g = parseInt(clean[1] + clean[1], 16) / 255;
      const b = parseInt(clean[2] + clean[2], 16) / 255;
      return rgb(r || 0, g || 0, b || 0);
    }
    if (clean.length >= 6) {
      const r = parseInt(clean.slice(0, 2), 16) / 255;
      const g = parseInt(clean.slice(2, 4), 16) / 255;
      const b = parseInt(clean.slice(4, 6), 16) / 255;
      return rgb(isNaN(r) ? 0 : r, isNaN(g) ? 0 : g, isNaN(b) ? 0 : b);
    }
    return rgb(0.06, 0.09, 0.16);
  };

  if (!colorStr) return parseHex(fallbackHex);
  const trimmed = colorStr.trim();
  if (trimmed.startsWith('#')) return parseHex(trimmed);
  const rgbMatch = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgbMatch) {
    return rgb(
      Math.min(255, Number(rgbMatch[1])) / 255,
      Math.min(255, Number(rgbMatch[2])) / 255,
      Math.min(255, Number(rgbMatch[3])) / 255
    );
  }
  return parseHex(fallbackHex);
}

/**
 * Standard PDF fonts (Helvetica, TimesRoman, Courier) support WinAnsi encoding.
 * This normalizes smart punctuation & strips unsupported glyphs so pdf-lib never throws.
 */
const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

export function sanitizePdfText(input: string): string {
  const replaced = input
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2010\u2011\u2012]/g, '-')
    .replace(/\u2212/g, '-')
    .replace(/\u25cf|\u25cb|\u25a0/g, '•')
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/\u2713|\u2714/g, '[x]')
    .replace(/\t/g, '    ');

  let out = '';
  for (const ch of replaced) {
    const code = ch.codePointAt(0) ?? 32;
    if (
      code === 0x0a ||
      code === 0x0d ||
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xff) ||
      WIN_ANSI_EXTRA.has(code)
    ) {
      out += ch;
    } else {
      out += '?';
    }
  }
  return out;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadPdfBytes(bytes: Uint8Array, filename: string): void {
  const safeName = filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  downloadBlob(new Blob([copy.buffer], { type: 'application/pdf' }), safeName);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export interface PdfPagePreview {
  pageNumber: number;
  dataUrl: string;
  widthPt: number;
  heightPt: number;
}

/**
 * Render all (or first N) pages of a PDF ArrayBuffer to PNG data URLs completely offline.
 */
export async function renderPdfThumbnails(
  buffer: ArrayBuffer,
  options?: {
    scale?: number;
    maxPages?: number;
    onProgress?: (current: number, total: number) => void;
  }
): Promise<{ numPages: number; previews: PdfPagePreview[] }> {
  await ensurePdfJsWorker();
  const dataCopy = new Uint8Array(buffer.slice(0));
  const loadingTask = pdfjsLib.getDocument({ data: dataCopy });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const limit = options?.maxPages ? Math.min(numPages, options.maxPages) : numPages;
  const scale = options?.scale ?? 0.35;
  const previews: PdfPagePreview[] = [];

  for (let i = 1; i <= limit; i++) {
    const page = await pdf.getPage(i);
    const baseViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    }
    previews.push({
      pageNumber: i,
      dataUrl: canvas.toDataURL('image/png'),
      widthPt: baseViewport.width,
      heightPt: baseViewport.height,
    });
    options?.onProgress?.(i, limit);
  }

  await loadingTask.destroy();
  return { numPages, previews };
}

/**
 * Render a single PDF page onto a target HTMLCanvasElement at a given scale.
 */
export async function renderSinglePdfPage(
  buffer: ArrayBuffer,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1.5,
  extraRotationDeg = 0
): Promise<{ widthPt: number; heightPt: number; renderWidth: number; renderHeight: number }> {
  await ensurePdfJsWorker();
  const dataCopy = new Uint8Array(buffer.slice(0));
  const loadingTask = pdfjsLib.getDocument({ data: dataCopy });
  const pdf = await loadingTask.promise;
  const safePage = Math.max(1, Math.min(pageNumber, pdf.numPages));
  const page = await pdf.getPage(safePage);

  const totalRot = ((page.rotate + extraRotationDeg) % 360 + 360) % 360;
  const baseViewport = page.getViewport({ scale: 1, rotation: totalRot });
  const viewport = page.getViewport({ scale, rotation: totalRot });

  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  }

  await loadingTask.destroy();
  return {
    widthPt: baseViewport.width,
    heightPt: baseViewport.height,
    renderWidth: canvas.width,
    renderHeight: canvas.height,
  };
}

/**
 * Normalize any browser-supported image file (JPG, PNG, WEBP, GIF, BMP) into PNG or JPEG bytes.
 */
export async function imageFileToPngOrJpgBytes(
  fileOrDataUrl: File | string,
  rotationDeg = 0
): Promise<{ bytes: Uint8Array; format: 'png' | 'jpg'; width: number; height: number }> {
  const dataUrl =
    typeof fileOrDataUrl === 'string'
      ? fileOrDataUrl
      : await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Failed to read image file'));
          reader.readAsDataURL(fileOrDataUrl);
        });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Unsupported or corrupted image'));
    el.src = dataUrl;
  });

  const normRot = ((rotationDeg % 360) + 360) % 360;
  const swap = normRot === 90 || normRot === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? img.naturalHeight : img.naturalWidth;
  canvas.height = swap ? img.naturalWidth : img.naturalHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((normRot * Math.PI) / 180);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  ctx.restore();

  const isJpeg =
    typeof fileOrDataUrl !== 'string' &&
    (fileOrDataUrl.type === 'image/jpeg' || /\.jpe?g$/i.test(fileOrDataUrl.name));

  const mime = isJpeg ? 'image/jpeg' : 'image/png';
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image encode failed'))), mime, 0.92);
  });

  const ab = await blob.arrayBuffer();
  return {
    bytes: new Uint8Array(ab),
    format: isJpeg ? 'jpg' : 'png',
    width: canvas.width,
    height: canvas.height,
  };
}
