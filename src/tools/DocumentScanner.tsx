import React, { useEffect, useRef, useState } from 'react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  Camera,
  Check,
  Copy,
  Crop,
  Download,
  FileSearch,
  Plus,
  RotateCcw,
  RotateCw,
  Trash2,
  VideoOff,
} from 'lucide-react';
import { DropZone } from '../components/DropZone';
import { ProgressBar } from '../components/ProgressBar';
import { downloadPdfBytesAsync, imageFileToPngOrJpgBytes } from '../lib/pdfSetup';
import {
  QuadCorners,
  ScanFilter,
  detectDocumentCorners,
  processScannedImage,
  runOfflineOcr,
} from '../lib/scannerUtils';

interface ToolProps {
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

interface ScannedPage {
  id: string;
  dataUrl: string;
  ocrText?: string;
}

export const DocumentScanner: React.FC<ToolProps> = ({ onNotify }) => {
  const [cameraActive, setCameraActive] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [sourceDataUrl, setSourceDataUrl] = useState<string | null>(null);
  const [sourceImg, setSourceImg] = useState<HTMLImageElement | null>(null);
  const [corners, setCorners] = useState<QuadCorners>([
    { x: 0.06, y: 0.06 },
    { x: 0.94, y: 0.06 },
    { x: 0.94, y: 0.94 },
    { x: 0.06, y: 0.94 },
  ]);
  const [draggingCorner, setDraggingCorner] = useState<number | null>(null);

  const [rotateDeg, setRotateDeg] = useState(0);
  const [deskewDeg, setDeskewDeg] = useState(0);
  const [filter, setFilter] = useState<ScanFilter>('bw');
  const [processedDataUrl, setProcessedDataUrl] = useState<string | null>(null);

  const [queue, setQueue] = useState<ScannedPage[]>([]);
  const [ocrText, setOcrText] = useState('');
  const [embedOcrLayer, setEmbedOcrLayer] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('Processing...');
  const [progress, setProgress] = useState(0);

  const cropCanvasRef = useRef<HTMLCanvasElement>(null);

  // Clean up camera stream on unmount
  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      onNotify('error', 'Camera API is unavailable in this browser context. Use photo upload instead.');
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      setStream(media);
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = media;
        }
      }, 60);
    } catch {
      onNotify('error', 'Camera permission denied or no camera found. You can still upload document photos.');
    }
  };

  const stopCamera = () => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    setCameraActive(false);
  };

  const loadSourceDataUrl = (url: string) => {
    const img = new Image();
    img.onload = () => {
      setSourceDataUrl(url);
      setSourceImg(img);
      setRotateDeg(0);
      setDeskewDeg(0);
      const detected = detectDocumentCorners(img);
      setCorners(detected);
    };
    img.src = url;
  };

  const captureFromCamera = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext('2d')?.drawImage(video, 0, 0);
    const dataUrl = c.toDataURL('image/png');
    stopCamera();
    loadSourceDataUrl(dataUrl);
    onNotify('success', 'Captured snapshot and auto-detected document edges.');
  };

  const handlePhotoUpload = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      loadSourceDataUrl(String(reader.result));
      onNotify('success', 'Loaded photo and auto-detected page boundaries.');
    };
    reader.readAsDataURL(file);
  };

  // Draw interactive 4-corner crop overlay
  useEffect(() => {
    const c = cropCanvasRef.current;
    if (!c || !sourceImg) return;
    const maxW = 540;
    const scale = Math.min(1, maxW / sourceImg.naturalWidth);
    c.width = Math.round(sourceImg.naturalWidth * scale);
    c.height = Math.round(sourceImg.naturalHeight * scale);
    const ctx = c.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(sourceImg, 0, 0, c.width, c.height);

    // Dim outside quad
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.beginPath();
    ctx.rect(0, 0, c.width, c.height);
    ctx.moveTo(corners[0].x * c.width, corners[0].y * c.height);
    ctx.lineTo(corners[3].x * c.width, corners[3].y * c.height);
    ctx.lineTo(corners[2].x * c.width, corners[2].y * c.height);
    ctx.lineTo(corners[1].x * c.width, corners[1].y * c.height);
    ctx.closePath();
    ctx.fill('evenodd');
    ctx.restore();

    // Quad outline
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    corners.forEach((pt, idx) => {
      if (idx === 0) ctx.moveTo(pt.x * c.width, pt.y * c.height);
      else ctx.lineTo(pt.x * c.width, pt.y * c.height);
    });
    ctx.closePath();
    ctx.stroke();

    // Corner handles
    corners.forEach((pt) => {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(pt.x * c.width, pt.y * c.height, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }, [sourceImg, corners]);

  // Update processed scan preview whenever crop/rotate/deskew/filter changes
  useEffect(() => {
    if (!sourceImg) return;
    const timer = setTimeout(() => {
      const processed = processScannedImage(sourceImg, corners, {
        rotateDeg,
        deskewDeg,
        filter,
        maxOutputDim: 1100,
      });
      setProcessedDataUrl(processed.toDataURL('image/png'));
    }, 60);
    return () => clearTimeout(timer);
  }, [sourceImg, corners, rotateDeg, deskewDeg, filter]);

  const handleCropPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = cropCanvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;

    let bestIdx = -1;
    let bestDist = 0.07;
    corners.forEach((pt, idx) => {
      const d = Math.hypot(pt.x - nx, pt.y - ny);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    });

    if (bestIdx >= 0) {
      c.setPointerCapture(e.pointerId);
      setDraggingCorner(bestIdx);
    }
  };

  const handleCropPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggingCorner === null || !cropCanvasRef.current) return;
    const rect = cropCanvasRef.current.getBoundingClientRect();
    const nx = Math.max(0.01, Math.min(0.99, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0.01, Math.min(0.99, (e.clientY - rect.top) / rect.height));
    setCorners((prev) => prev.map((pt, i) => (i === draggingCorner ? { x: nx, y: ny } : pt)) as QuadCorners);
  };

  const handleAddToQueue = () => {
    if (!sourceImg) return;
    const highRes = processScannedImage(sourceImg, corners, {
      rotateDeg,
      deskewDeg,
      filter,
      maxOutputDim: 1800,
    });
    const url = highRes.toDataURL('image/jpeg', 0.9);
    setQueue((prev) => [...prev, { id: `scan-${Date.now()}`, dataUrl: url, ocrText: ocrText || undefined }]);
    onNotify('success', `Added scanned page #${queue.length + 1} to document queue.`);
  };

  const handleRunOcr = async () => {
    if (!processedDataUrl) return;
    setBusy(true);
    setBusyLabel('Running local Tesseract WASM OCR...');
    setProgress(5);
    try {
      const text = await runOfflineOcr(processedDataUrl, setProgress);
      setOcrText(text);
      onNotify('success', text ? 'Offline OCR completed.' : 'OCR finished (no readable text detected).');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Offline OCR failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleExportPdf = async () => {
    const pagesToExport =
      queue.length > 0
        ? queue
        : processedDataUrl
          ? [{ id: 'single', dataUrl: processedDataUrl, ocrText: ocrText || undefined }]
          : [];

    if (pagesToExport.length === 0) {
      onNotify('error', 'Scan or upload at least one page first.');
      return;
    }

    setBusy(true);
    setBusyLabel('Building multi-page scanned PDF...');
    setProgress(5);
    try {
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      for (let i = 0; i < pagesToExport.length; i++) {
        const item = pagesToExport[i];
        const { bytes, format, width, height } = await imageFileToPngOrJpgBytes(item.dataUrl);
        const emb = format === 'jpg' ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);

        // Fit inside A4-scale points while matching aspect ratio
        const pageW = 595.28;
        const pageH = (height / Math.max(1, width)) * pageW;
        const page = pdfDoc.addPage([pageW, pageH]);

        // Optional invisible searchable OCR text layer beneath image
        if (embedOcrLayer && item.ocrText) {
          const lines = item.ocrText.split('\n').slice(0, 60);
          lines.forEach((line, lIdx) => {
            const safe = line.replace(/[^\x20-\x7e]/g, ' ').trim();
            if (!safe) return;
            page.drawText(safe, {
              x: 20,
              y: Math.max(16, pageH - 28 - lIdx * 12),
              size: 9,
              font,
              color: rgb(1, 1, 1),
              opacity: 0.01,
            });
          });
        }

        page.drawImage(emb, { x: 0, y: 0, width: pageW, height: pageH });
        setProgress(Math.round(((i + 1) / pagesToExport.length) * 95));
      }

      const out = await pdfDoc.save();
      setProgress(100);
      await downloadPdfBytesAsync(out, 'scanned-document.pdf');
      onNotify('success', `Saved ${pagesToExport.length}-page scanned PDF to your selected location.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'PDF export failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Capture Source Bar */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <DropZone
          accept="image/*"
          onFiles={handlePhotoUpload}
          title="Upload Document Photo"
          subtitle="JPG, PNG, or WEBP photo — auto edge detection & perspective correction"
          compact
        />

        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-5 text-center dark:border-slate-800 dark:bg-slate-900">
          {!cameraActive ? (
            <>
              <button
                type="button"
                onClick={startCamera}
                className="flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
              >
                <Camera className="h-4 w-4" />
                <span>Open Device Camera</span>
              </button>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Uses local browser MediaDevices API (no upload or cloud stream)
              </p>
            </>
          ) : (
            <div className="w-full space-y-3">
              <video ref={videoRef} autoPlay playsInline className="max-h-60 w-full rounded-lg bg-black object-contain" />
              <div className="flex justify-center gap-2">
                <button
                  type="button"
                  onClick={captureFromCamera}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  <Camera className="h-3.5 w-3.5" />
                  <span>Capture Page</span>
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <VideoOff className="h-3.5 w-3.5" />
                  <span>Close</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {busy && <ProgressBar progress={progress} label={busyLabel} />}

      {/* Interactive Crop, Filter & Preview Workspace */}
      {sourceDataUrl && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          {/* Controls Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  ['original', 'Original'],
                  ['bw', 'B&W Crisp'],
                  ['grayscale', 'Grayscale'],
                  ['contrast', 'Enhance Contrast'],
                  ['shadow', 'Shadow Removal'],
                ] as [ScanFilter, string][]
              ).map(([fId, label]) => (
                <button
                  key={fId}
                  type="button"
                  onClick={() => setFilter(fId)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                    filter === fId
                      ? 'bg-blue-600 text-white'
                      : 'border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => sourceImg && setCorners(detectDocumentCorners(sourceImg))}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Crop className="h-3.5 w-3.5" />
                <span>Auto Edges</span>
              </button>
              <button
                type="button"
                onClick={() => setRotateDeg((r) => (r - 90) % 360)}
                title="Rotate Left"
                className="rounded-lg border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setRotateDeg((r) => (r + 90) % 360)}
                title="Rotate Right"
                className="rounded-lg border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <span>Deskew</span>
                <input
                  type="range"
                  min={-15}
                  max={15}
                  step={0.5}
                  value={deskewDeg}
                  onChange={(e) => setDeskewDeg(Number(e.target.value))}
                  className="w-24 accent-blue-600"
                />
                <span className="font-mono-tabular w-10 text-right">{deskewDeg}°</span>
              </label>
            </div>
          </div>

          {/* Side-by-side Crop & Processed Result */}
          <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                1. Drag Corner Handles to Crop & Perspective-Correct
              </p>
              <div className="flex justify-center rounded-lg border border-slate-200 bg-slate-100 p-3 dark:border-slate-800 dark:bg-slate-950">
                <canvas
                  ref={cropCanvasRef}
                  onPointerDown={handleCropPointerDown}
                  onPointerMove={handleCropPointerMove}
                  onPointerUp={() => setDraggingCorner(null)}
                  className="max-w-full touch-none rounded cursor-crosshair"
                />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  2. Enhanced Scan Output
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy || !processedDataUrl}
                    onClick={handleRunOcr}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <FileSearch className="h-3.5 w-3.5" />
                    <span>Run Offline OCR</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleAddToQueue}
                    className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Page to PDF</span>
                  </button>
                </div>
              </div>

              <div className="flex min-h-[260px] items-center justify-center rounded-lg border border-slate-200 bg-slate-100 p-3 dark:border-slate-800 dark:bg-slate-950">
                {processedDataUrl && (
                  <img
                    src={processedDataUrl}
                    alt="Enhanced scan preview"
                    className="max-h-[420px] max-w-full rounded border border-slate-200 bg-white object-contain shadow-sm dark:border-slate-700"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Optional Offline OCR Output */}
          {ocrText && (
            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Extracted OCR Text (Tesseract WASM Offline)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(ocrText);
                    onNotify('success', 'Copied OCR text to clipboard.');
                  }}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy Text</span>
                </button>
              </div>
              <textarea
                value={ocrText}
                onChange={(e) => setOcrText(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-slate-200 bg-white p-2.5 font-mono text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              />
            </div>
          )}
        </div>
      )}

      {/* Multi-Page Scan Queue & PDF Export */}
      {(queue.length > 0 || processedDataUrl) && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Multi-Page Scan Queue ({queue.length} queued)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {queue.length === 0
                  ? 'Exporting now saves the current scan, or click "Add Page to PDF" to build a multi-page document.'
                  : 'All queued pages combine into a single PDF.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={embedOcrLayer}
                  onChange={(e) => setEmbedOcrLayer(e.target.checked)}
                />
                <span>Embed searchable OCR text layer</span>
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={handleExportPdf}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Export Scanned PDF</span>
              </button>
            </div>
          </div>

          {queue.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-6">
              {queue.map((item, idx) => (
                <div
                  key={item.id}
                  className="relative flex flex-col rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/60"
                >
                  <img
                    src={item.dataUrl}
                    alt={`Scan ${idx + 1}`}
                    className="aspect-[3/4] w-full rounded border border-slate-200 bg-white object-contain dark:border-slate-700"
                  />
                  <div className="mt-1.5 flex items-center justify-between text-[11px]">
                    <span className="font-mono-tabular text-slate-600 dark:text-slate-300">
                      Page {idx + 1}
                      {item.ocrText && (
                        <Check className="ml-1 inline h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQueue((prev) => prev.filter((x) => x.id !== item.id))}
                      className="rounded p-1 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950/50"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
