import React, { useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { Download, Maximize2 } from 'lucide-react';
import { DropZone } from '../components/DropZone';
import { ProgressBar } from '../components/ProgressBar';
import {
  Orientation,
  PAGE_PRESETS_MM,
  PagePreset,
  downloadPdfBytes,
  ptToMm,
  renderPdfThumbnails,
  resolvePageSizePt,
} from '../lib/pdfSetup';

interface ToolProps {
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const PageResizer: React.FC<ToolProps> = ({ onNotify }) => {
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState('resized.pdf');
  const [pageCount, setPageCount] = useState(0);
  const [origSizePt, setOrigSizePt] = useState({ width: 595, height: 842 });
  const [previewUrl, setPreviewUrl] = useState('');

  const [resizeMode, setResizeMode] = useState<'scale' | 'target'>('scale');
  const [scalePct, setScalePct] = useState(125);
  const [targetPreset, setTargetPreset] = useState<PagePreset>('A3');
  const [orientation, setOrientation] = useState<'auto' | Orientation>('auto');
  const [customMm, setCustomMm] = useState({ width: 210, height: 297 });
  const [fitContent, setFitContent] = useState(true);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleFile = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setBusy(true);
    setProgress(20);
    try {
      const ab = await file.arrayBuffer();
      const { numPages, previews } = await renderPdfThumbnails(ab, { scale: 0.45, maxPages: 1 });
      setBuffer(ab);
      setFileName(file.name.replace(/\.pdf$/i, '') + '-resized.pdf');
      setPageCount(numPages);
      if (previews[0]) {
        setOrigSizePt({ width: previews[0].widthPt, height: previews[0].heightPt });
        setPreviewUrl(previews[0].dataUrl);
      }
      setProgress(100);
      onNotify('success', `Loaded ${file.name} (${numPages} pages).`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to load PDF.');
    } finally {
      setBusy(false);
    }
  };

  const computeTargetDimensions = (srcW: number, srcH: number) => {
    if (resizeMode === 'scale') {
      const f = scalePct / 100;
      return { targetW: srcW * f, targetH: srcH * f, scale: f };
    }
    const resolvedOrient: Orientation =
      orientation === 'auto' ? (srcW > srcH ? 'landscape' : 'portrait') : orientation;
    const target = resolvePageSizePt(targetPreset, resolvedOrient, customMm);
    const scale = fitContent ? Math.min(target.width / srcW, target.height / srcH) : 1;
    return { targetW: target.width, targetH: target.height, scale };
  };

  const previewDims = computeTargetDimensions(origSizePt.width, origSizePt.height);

  const handleExport = async () => {
    if (!buffer) return;
    setBusy(true);
    setProgress(0);
    try {
      const srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const outDoc = await PDFDocument.create();
      const srcPages = srcDoc.getPages();

      for (let i = 0; i < srcPages.length; i++) {
        const srcPage = srcPages[i];
        const { width: srcW, height: srcH } = srcPage.getSize();
        const { targetW, targetH, scale } = computeTargetDimensions(srcW, srcH);

        const [embedded] = await outDoc.embedPages([srcPage]);
        const newPage = outDoc.addPage([targetW, targetH]);
        const drawW = srcW * scale;
        const drawH = srcH * scale;
        newPage.drawPage(embedded, {
          x: (targetW - drawW) / 2,
          y: (targetH - drawH) / 2,
          width: drawW,
          height: drawH,
        });
        setProgress(Math.round(((i + 1) / srcPages.length) * 95));
      }

      const bytes = await outDoc.save();
      setProgress(100);
      downloadPdfBytes(bytes, fileName || 'resized.pdf');
      onNotify('success', `Resized all ${srcPages.length} pages and saved PDF.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to resize PDF pages.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_330px]">
      <div className="space-y-5">
        <DropZone
          accept="application/pdf,.pdf"
          onFiles={handleFile}
          title="Drop a PDF file to resize or scale pages"
          subtitle="Scale every page between 50%–200% or re-center onto A3, A4, A5, Letter, Legal, or custom dimensions"
          compact={Boolean(buffer)}
        />

        {busy && <ProgressBar progress={progress} label="Scaling PDF pages locally..." />}

        {buffer && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <Maximize2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span>Scale & Placement Preview (Page 1 of {pageCount})</span>
              </div>
              <div className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
                {Math.round(ptToMm(origSizePt.width))}×{Math.round(ptToMm(origSizePt.height))} mm →{' '}
                <strong className="text-slate-900 dark:text-slate-100">
                  {Math.round(ptToMm(previewDims.targetW))}×{Math.round(ptToMm(previewDims.targetH))} mm
                </strong>
              </div>
            </div>

            <div className="flex items-center justify-center rounded-lg bg-slate-100 p-6 dark:bg-slate-950/70">
              {/* Target paper visual representation */}
              <div
                className="relative flex items-center justify-center border border-slate-300 bg-white shadow-sm dark:border-slate-600"
                style={{
                  width: previewDims.targetW >= previewDims.targetH ? 340 : 340 * (previewDims.targetW / previewDims.targetH),
                  height: previewDims.targetH > previewDims.targetW ? 340 : 340 * (previewDims.targetH / previewDims.targetW),
                }}
              >
                {previewUrl && (
                  <img
                    src={previewUrl}
                    alt="Scaled page preview"
                    className="border border-dashed border-blue-400 object-contain"
                    style={{
                      width: `${Math.min(100, ((origSizePt.width * previewDims.scale) / previewDims.targetW) * 100)}%`,
                      height: `${Math.min(100, ((origSizePt.height * previewDims.scale) / previewDims.targetH) * 100)}%`,
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Resizer Controls */}
      <div className="flex h-fit flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Resize Configuration</h3>

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setResizeMode('scale')}
            className={`rounded-md py-1.5 text-xs font-medium ${
              resizeMode === 'scale'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Scale % (50–200)
          </button>
          <button
            type="button"
            onClick={() => setResizeMode('target')}
            className={`rounded-md py-1.5 text-xs font-medium ${
              resizeMode === 'target'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Target Page Size
          </button>
        </div>

        {resizeMode === 'scale' ? (
          <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-300">Scale Factor</span>
              <span className="font-mono-tabular font-semibold text-blue-600 dark:text-blue-400">{scalePct}%</span>
            </div>
            <input
              type="range"
              min={50}
              max={200}
              step={5}
              value={scalePct}
              onChange={(e) => setScalePct(Number(e.target.value))}
              className="w-full accent-blue-600"
            />
            <div className="grid grid-cols-4 gap-1.5">
              {[50, 75, 125, 150, 200].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setScalePct(v)}
                  className={`rounded-md border py-1 font-mono-tabular text-xs ${
                    scalePct === v
                      ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-300'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
                >
                  {v}%
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                Target Page Size
              </label>
              <select
                value={targetPreset}
                onChange={(e) => setTargetPreset(e.target.value as PagePreset)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                {(Object.keys(PAGE_PRESETS_MM) as Exclude<PagePreset, 'Custom'>[]).map((k) => (
                  <option key={k} value={k}>
                    {PAGE_PRESETS_MM[k].label}
                  </option>
                ))}
                <option value="Custom">Custom (mm)</option>
              </select>
            </div>

            {targetPreset === 'Custom' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Width (mm)</label>
                  <input
                    type="number"
                    min={40}
                    max={1200}
                    value={customMm.width}
                    onChange={(e) => setCustomMm((p) => ({ ...p, width: Number(e.target.value) || 210 }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono-tabular text-sm dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Height (mm)</label>
                  <input
                    type="number"
                    min={40}
                    max={1200}
                    value={customMm.height}
                    onChange={(e) => setCustomMm((p) => ({ ...p, height: Number(e.target.value) || 297 }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono-tabular text-sm dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Orientation</label>
              <select
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as 'auto' | Orientation)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="auto">Auto (Match Page)</option>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={fitContent} onChange={(e) => setFitContent(e.target.checked)} />
              <span>Scale content proportionally to fit & center</span>
            </label>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Output Filename</label>
          <input
            type="text"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </div>

        <button
          type="button"
          disabled={busy || !buffer}
          onClick={handleExport}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          <span>Resize & Download PDF</span>
        </button>
      </div>
    </div>
  );
};
