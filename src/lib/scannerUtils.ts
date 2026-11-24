import { createWorker } from 'tesseract.js';

export type ScanFilter = 'original' | 'bw' | 'grayscale' | 'contrast' | 'shadow';

export interface Point2D {
  x: number; // Normalized 0..1
  y: number; // Normalized 0..1
}

export type QuadCorners = [Point2D, Point2D, Point2D, Point2D]; // TL, TR, BR, BL

/**
 * Simple Sobel-gradient + brightness boundary detector to propose 4 document corners.
 * Runs 100% locally on an offscreen downscaled canvas.
 */
export function detectDocumentCorners(img: HTMLImageElement | HTMLCanvasElement): QuadCorners {
  const maxDim = 240;
  const srcW = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const srcH = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const w = Math.max(32, Math.round(srcW * scale));
  const h = Math.max(32, Math.round(srcH * scale));

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) {
    return [
      { x: 0.06, y: 0.06 },
      { x: 0.94, y: 0.06 },
      { x: 0.94, y: 0.94 },
      { x: 0.06, y: 0.94 },
    ];
  }

  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  // Edge magnitude via Sobel
  const edges = new Float32Array(w * h);
  let sumEdge = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -gray[(y - 1) * w + (x - 1)] +
        gray[(y - 1) * w + (x + 1)] -
        2 * gray[y * w + (x - 1)] +
        2 * gray[y * w + (x + 1)] -
        gray[(y + 1) * w + (x - 1)] +
        gray[(y + 1) * w + (x + 1)];
      const gy =
        -gray[(y - 1) * w + (x - 1)] -
        2 * gray[(y - 1) * w + x] -
        gray[(y - 1) * w + (x + 1)] +
        gray[(y + 1) * w + (x - 1)] +
        2 * gray[(y + 1) * w + x] +
        gray[(y + 1) * w + (x + 1)];
      const mag = Math.hypot(gx, gy);
      edges[y * w + x] = mag;
      sumEdge += mag;
    }
  }

  const threshold = Math.max(45, (sumEdge / (w * h)) * 2.1);

  // Find extremal strong-edge pixels near each quadrant corner
  let tl = { x: Math.round(w * 0.06), y: Math.round(h * 0.06), score: Infinity };
  let tr = { x: Math.round(w * 0.94), y: Math.round(h * 0.06), score: Infinity };
  let br = { x: Math.round(w * 0.94), y: Math.round(h * 0.94), score: Infinity };
  let bl = { x: Math.round(w * 0.06), y: Math.round(h * 0.94), score: Infinity };

  const marginX = Math.round(w * 0.02);
  const marginY = Math.round(h * 0.02);
  let strongCount = 0;

  for (let y = marginY; y < h - marginY; y++) {
    for (let x = marginX; x < w - marginX; x++) {
      if (edges[y * w + x] > threshold) {
        strongCount++;
        const dTL = x + y;
        const dTR = w - 1 - x + y;
        const dBR = w - 1 - x + (h - 1 - y);
        const dBL = x + (h - 1 - y);
        if (dTL < tl.score) tl = { x, y, score: dTL };
        if (dTR < tr.score) tr = { x, y, score: dTR };
        if (dBR < br.score) br = { x, y, score: dBR };
        if (dBL < bl.score) bl = { x, y, score: dBL };
      }
    }
  }

  // Fallback to clean inset if image is low contrast or bounding box is tiny
  const areaSpan = (tr.x - tl.x) * (bl.y - tl.y);
  if (strongCount < 20 || areaSpan < w * h * 0.15) {
    return [
      { x: 0.05, y: 0.05 },
      { x: 0.95, y: 0.05 },
      { x: 0.95, y: 0.95 },
      { x: 0.05, y: 0.95 },
    ];
  }

  const clamp01 = (v: number) => Math.max(0.01, Math.min(0.99, v));
  return [
    { x: clamp01(tl.x / w), y: clamp01(tl.y / h) },
    { x: clamp01(tr.x / w), y: clamp01(tr.y / h) },
    { x: clamp01(br.x / w), y: clamp01(br.y / h) },
    { x: clamp01(bl.x / w), y: clamp01(bl.y / h) },
  ];
}

/**
 * Compute 3x3 homography matrix mapping dst (u,v) -> src (x,y) via Gaussian elimination.
 */
function solveHomography(
  dstPts: [number, number][],
  srcPts: [number, number][]
): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dstPts[i];
    const [u, v] = srcPts[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const n = 8;
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
    }
    [A[i], A[maxRow]] = [A[maxRow], A[i]];
    [b[i], b[maxRow]] = [b[maxRow], b[i]];

    const pivot = A[i][i] || 1e-10;
    for (let j = i; j < n; j++) A[i][j] /= pivot;
    b[i] /= pivot;

    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = A[k][i];
      for (let j = i; j < n; j++) A[k][j] -= factor * A[i][j];
      b[k] -= factor * b[i];
    }
  }
  return [...b, 1];
}

/**
 * Warp quad region from source image, rotate, deskew, and apply document enhancement filter.
 */
export function processScannedImage(
  sourceImg: HTMLImageElement,
  corners: QuadCorners,
  options: {
    rotateDeg: number;
    deskewDeg: number;
    filter: ScanFilter;
    maxOutputDim?: number;
  }
): HTMLCanvasElement {
  const srcW = sourceImg.naturalWidth;
  const srcH = sourceImg.naturalHeight;

  const p0: [number, number] = [corners[0].x * srcW, corners[0].y * srcH];
  const p1: [number, number] = [corners[1].x * srcW, corners[1].y * srcH];
  const p2: [number, number] = [corners[2].x * srcW, corners[2].y * srcH];
  const p3: [number, number] = [corners[3].x * srcW, corners[3].y * srcH];

  const topW = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const botW = Math.hypot(p2[0] - p3[0], p2[1] - p3[1]);
  const leftH = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  const rightH = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);

  let outW = Math.max(40, Math.round((topW + botW) / 2));
  let outH = Math.max(40, Math.round((leftH + rightH) / 2));

  const maxOut = options.maxOutputDim ?? 1600;
  const downscale = Math.min(1, maxOut / Math.max(outW, outH));
  outW = Math.max(40, Math.round(outW * downscale));
  outH = Math.max(40, Math.round(outH * downscale));

  // Read source pixels
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.drawImage(sourceImg, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;

  // Perspective warp into warpedCanvas
  const warpedCanvas = document.createElement('canvas');
  warpedCanvas.width = outW;
  warpedCanvas.height = outH;
  const warpedCtx = warpedCanvas.getContext('2d')!;
  const dstImgData = warpedCtx.createImageData(outW, outH);
  const dstData = dstImgData.data;

  const H = solveHomography(
    [
      [0, 0],
      [outW - 1, 0],
      [outW - 1, outH - 1],
      [0, outH - 1],
    ],
    [p0, p1, p2, p3]
  );

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const denom = H[6] * x + H[7] * y + H[8];
      const sx = (H[0] * x + H[1] * y + H[2]) / denom;
      const sy = (H[3] * x + H[4] * y + H[5]) / denom;

      const x0 = Math.max(0, Math.min(srcW - 2, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(srcH - 2, Math.floor(sy)));
      const fx = Math.max(0, Math.min(1, sx - x0));
      const fy = Math.max(0, Math.min(1, sy - y0));

      const i00 = (y0 * srcW + x0) * 4;
      const i10 = (y0 * srcW + (x0 + 1)) * 4;
      const i01 = ((y0 + 1) * srcW + x0) * 4;
      const i11 = ((y0 + 1) * srcW + (x0 + 1)) * 4;

      const dIdx = (y * outW + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const v0 = srcData[i00 + ch] * (1 - fx) + srcData[i10 + ch] * fx;
        const v1 = srcData[i01 + ch] * (1 - fx) + srcData[i11 + ch] * fx;
        dstData[dIdx + ch] = Math.round(v0 * (1 - fy) + v1 * fy);
      }
      dstData[dIdx + 3] = 255;
    }
  }
  warpedCtx.putImageData(dstImgData, 0, 0);

  // Rotate + Deskew pass
  const totalRad = ((options.rotateDeg + options.deskewDeg) * Math.PI) / 180;
  const normRot = ((options.rotateDeg % 360) + 360) % 360;
  const swap = normRot === 90 || normRot === 270;
  const rotCanvas = document.createElement('canvas');
  rotCanvas.width = swap ? outH : outW;
  rotCanvas.height = swap ? outW : outH;
  const rotCtx = rotCanvas.getContext('2d')!;
  rotCtx.fillStyle = '#ffffff';
  rotCtx.fillRect(0, 0, rotCanvas.width, rotCanvas.height);
  rotCtx.save();
  rotCtx.translate(rotCanvas.width / 2, rotCanvas.height / 2);
  rotCtx.rotate(totalRad);
  rotCtx.drawImage(warpedCanvas, -outW / 2, -outH / 2);
  rotCtx.restore();

  if (options.filter === 'original') {
    return rotCanvas;
  }

  // Pixel-level filter processing
  const rw = rotCanvas.width;
  const rh = rotCanvas.height;
  const imgData = rotCtx.getImageData(0, 0, rw, rh);
  const px = imgData.data;

  if (options.filter === 'grayscale') {
    for (let i = 0; i < px.length; i += 4) {
      const l = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
      px[i] = px[i + 1] = px[i + 2] = l;
    }
  } else if (options.filter === 'contrast') {
    const factor = 1.65;
    for (let i = 0; i < px.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        px[i + c] = Math.max(0, Math.min(255, Math.round((px[i + c] - 128) * factor + 134)));
      }
    }
  } else if (options.filter === 'shadow' || options.filter === 'bw') {
    // Compute luminance array & local integral image for illumination normalization
    const n = rw * rh;
    const lum = new Float32Array(n);
    const integral = new Float64Array((rw + 1) * (rh + 1));

    for (let y = 0; y < rh; y++) {
      let rowSum = 0;
      for (let x = 0; x < rw; x++) {
        const idx = (y * rw + x) * 4;
        const v = 0.299 * px[idx] + 0.587 * px[idx + 1] + 0.114 * px[idx + 2];
        lum[y * rw + x] = v;
        rowSum += v;
        integral[(y + 1) * (rw + 1) + (x + 1)] = integral[y * (rw + 1) + (x + 1)] + rowSum;
      }
    }

    const radius = Math.max(12, Math.round(Math.min(rw, rh) * 0.04));
    for (let y = 0; y < rh; y++) {
      const y1 = Math.max(0, y - radius);
      const y2 = Math.min(rh - 1, y + radius);
      for (let x = 0; x < rw; x++) {
        const x1 = Math.max(0, x - radius);
        const x2 = Math.min(rw - 1, x + radius);
        const count = (x2 - x1 + 1) * (y2 - y1 + 1);
        const sum =
          integral[(y2 + 1) * (rw + 1) + (x2 + 1)] -
          integral[y1 * (rw + 1) + (x2 + 1)] -
          integral[(y2 + 1) * (rw + 1) + x1] +
          integral[y1 * (rw + 1) + x1];
        const localMean = sum / count;
        const v = lum[y * rw + x];
        const idx = (y * rw + x) * 4;

        if (options.filter === 'bw') {
          // Adaptive Sauvola-like local threshold
          const isDark = v < localMean * 0.88 && v < 210;
          const outVal = isDark ? 12 : 255;
          px[idx] = px[idx + 1] = px[idx + 2] = outVal;
        } else {
          // Shadow removal: divide pixel by local illumination estimate
          const normScale = localMean > 10 ? Math.min(3.5, 245 / localMean) : 1;
          for (let c = 0; c < 3; c++) {
            px[idx + c] = Math.max(0, Math.min(255, Math.round(px[idx + c] * normScale)));
          }
        }
      }
    }
  }

  rotCtx.putImageData(imgData, 0, 0);
  return rotCanvas;
}

/**
 * Run 100% offline OCR using locally vendored Tesseract worker, WASM core, and eng.traineddata.gz.
 */
export async function runOfflineOcr(
  imageSource: HTMLCanvasElement | string,
  onProgress?: (pct: number) => void
): Promise<string> {
  const baseUrl = new URL('./libs/tesseract/', window.location.href).href;
  const worker = await createWorker('eng', 1, {
    workerPath: `${baseUrl}worker.min.js`,
    corePath: `${baseUrl}tesseract-core-lstm.wasm.js`,
    langPath: `${baseUrl}lang`,
    workerBlobURL: false,
    logger: (m) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        onProgress?.(Math.round(m.progress * 100));
      }
    },
  });

  try {
    const result = await worker.recognize(imageSource);
    return result.data.text.trim();
  } finally {
    await worker.terminate();
  }
}
