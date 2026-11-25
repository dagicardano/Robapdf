import React, { useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { ArrowDown, ArrowUp, Download, RotateCw, Trash2 } from 'lucide-react';
import { DropZone } from '../components/DropZone';
import { ProgressBar } from '../components/ProgressBar';
import {
  Orientation,
  PAGE_PRESETS_MM,
  PagePreset,
  downloadPdfBytesAsync,
  formatFileSize,
  imageFileToPngOrJpgBytes,
  mmToPt,
  resolvePageSizePt,
} from '../lib/pdfSetup';

interface ToolProps {
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

interface ImageItem {
  id: string;
  file: File;
  previewUrl: string;
  rotationDeg: number;
}

export const ImageToPdf: React.FC<ToolProps> = ({ onNotify }) => {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [preset, setPreset] = useState<Exclude<PagePreset, 'Custom'> | 'FitImage'>('A4');
  const [orientation, setOrientation] = useState<'auto' | Orientation>('auto');
  const [marginMm, setMarginMm] = useState(10);
  const [fitMode, setFitMode] = useState<'fit' | 'fill'>('fit');
  const [outputName, setOutputName] = useState('images-bundle.pdf');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleAddImages = (files: File[]) => {
    const valid = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name));
    if (valid.length === 0) {
      onNotify('error', 'Select JPG, PNG, WEBP, GIF, or BMP image files.');
      return;
    }
    const items = valid.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      rotationDeg: 0,
    }));
    setImages((prev) => [...prev, ...items]);
    onNotify('success', `Added ${items.length} image(s).`);
  };

  const moveImage = (idx: number, delta: number) => {
    const target = idx + delta;
    if (target < 0 || target >= images.length) return;
    setImages((prev) => {
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const handleExport = async () => {
    if (images.length === 0) return;
    setBusy(true);
    setProgress(0);
    try {
      const pdfDoc = await PDFDocument.create();
      const marginPt = mmToPt(Math.max(0, marginMm));

      for (let i = 0; i < images.length; i++) {
        const item = images[i];
        const { bytes, format, width, height } = await imageFileToPngOrJpgBytes(item.file, item.rotationDeg);
        const embedded = format === 'jpg' ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);

        let pageW: number;
        let pageH: number;

        if (preset === 'FitImage') {
          pageW = width * 0.75 + marginPt * 2;
          pageH = height * 0.75 + marginPt * 2;
        } else {
          const autoOrient: Orientation =
            orientation === 'auto' ? (width > height ? 'landscape' : 'portrait') : orientation;
          const resolved = resolvePageSizePt(preset, autoOrient);
          pageW = resolved.width;
          pageH = resolved.height;
        }

        const page = pdfDoc.addPage([pageW, pageH]);
        const availW = Math.max(10, pageW - marginPt * 2);
        const availH = Math.max(10, pageH - marginPt * 2);

        const scaleFit = Math.min(availW / width, availH / height);
        const scaleFill = Math.max(availW / width, availH / height);
        const scale = fitMode === 'fill' && preset !== 'FitImage' ? scaleFill : scaleFit;

        const drawW = width * scale;
        const drawH = height * scale;
        const x = (pageW - drawW) / 2;
        const y = (pageH - drawH) / 2;

        page.drawImage(embedded, { x, y, width: drawW, height: drawH });
        setProgress(Math.round(((i + 1) / images.length) * 95));
      }

      const outBytes = await pdfDoc.save();
      setProgress(100);
      await downloadPdfBytesAsync(outBytes, outputName || 'images-bundle.pdf');
      onNotify('success', `Converted ${images.length} image(s) into PDF.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Image conversion failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_310px]">
      <div className="space-y-4">
        <DropZone
          accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,.jpg,.jpeg,.png,.webp,.gif,.bmp"
          multiple
          onFiles={handleAddImages}
          title="Drop JPG, PNG, WEBP, GIF, or BMP images"
          subtitle="Multiple images combine into a single multi-page PDF in exact order"
          compact={images.length > 0}
        />

        {busy && <ProgressBar progress={progress} label="Embedding images locally into PDF..." />}

        {images.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((item, idx) => (
              <div
                key={item.id}
                className="flex flex-col rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                  <img
                    src={item.previewUrl}
                    alt={item.file.name}
                    className="max-h-full max-w-full object-contain transition-transform"
                    style={{ transform: `rotate(${item.rotationDeg}deg)` }}
                  />
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-slate-900 dark:text-slate-100">
                      {idx + 1}. {item.file.name}
                    </p>
                    <p className="font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                      {formatFileSize(item.file.size)}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setImages((prev) =>
                          prev.map((x) => (x.id === item.id ? { ...x, rotationDeg: (x.rotationDeg + 90) % 360 } : x))
                        )
                      }
                      title="Rotate 90°"
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveImage(idx, -1)}
                      title="Move earlier"
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === images.length - 1}
                      onClick={() => moveImage(idx, 1)}
                      title="Move later"
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        URL.revokeObjectURL(item.previewUrl);
                        setImages((prev) => prev.filter((x) => x.id !== item.id));
                      }}
                      title="Remove"
                      className="rounded p-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Layout Settings */}
      <div className="flex h-fit flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">PDF Output Options</h3>

        <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Page Size</label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as typeof preset)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              {(Object.keys(PAGE_PRESETS_MM) as Exclude<PagePreset, 'Custom'>[]).map((k) => (
                <option key={k} value={k}>
                  {PAGE_PRESETS_MM[k].label}
                </option>
              ))}
              <option value="FitImage">Exact Image Dimensions</option>
            </select>
          </div>

          {preset !== 'FitImage' && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Orientation
                </label>
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                  {(['auto', 'portrait', 'landscape'] as const).map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setOrientation(o)}
                      className={`rounded-md py-1.5 text-xs font-medium capitalize ${
                        orientation === o
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Scaling Mode
                </label>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                  {(['fit', 'fill'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setFitMode(m)}
                      className={`rounded-md py-1.5 text-xs font-medium capitalize ${
                        fitMode === m
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {m === 'fit' ? 'Fit (Contain)' : 'Fill (Cover)'}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Margin (mm)</label>
            <input
              type="number"
              min={0}
              max={50}
              value={marginMm}
              onChange={(e) => setMarginMm(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono-tabular text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              Output Filename
            </label>
            <input
              type="text"
              value={outputName}
              onChange={(e) => setOutputName(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
        </div>

        <button
          type="button"
          disabled={busy || images.length === 0}
          onClick={handleExport}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          <span>Convert {images.length || ''} to PDF</span>
        </button>
      </div>
    </div>
  );
};
