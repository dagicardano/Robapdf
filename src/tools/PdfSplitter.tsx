import React, { useState } from 'react';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { Check, Download, Scissors } from 'lucide-react';
import { DropZone } from '../components/DropZone';
import { ProgressBar } from '../components/ProgressBar';
import { PdfPagePreview, downloadBlob, downloadPdfBytes, renderPdfThumbnails } from '../lib/pdfSetup';

interface ToolProps {
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

type SplitMode = 'selected' | 'ranges' | 'everyN';

function parsePageRanges(input: string, maxPage: number): number[][] {
  const parts = input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const groups: number[][] = [];
  for (const part of parts) {
    if (part.includes('-')) {
      const [aRaw, bRaw] = part.split('-').map((x) => parseInt(x.trim(), 10));
      if (!isNaN(aRaw) && !isNaN(bRaw)) {
        const start = Math.max(1, Math.min(aRaw, bRaw));
        const end = Math.min(maxPage, Math.max(aRaw, bRaw));
        const list: number[] = [];
        for (let p = start; p <= end; p++) list.push(p);
        if (list.length > 0) groups.push(list);
      }
    } else {
      const n = parseInt(part, 10);
      if (!isNaN(n) && n >= 1 && n <= maxPage) {
        groups.push([n]);
      }
    }
  }
  return groups;
}

export const PdfSplitter: React.FC<ToolProps> = ({ onNotify }) => {
  const [fileName, setFileName] = useState('');
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [previews, setPreviews] = useState<PdfPagePreview[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<SplitMode>('selected');
  const [rangesStr, setRangesStr] = useState('1-2, 3-4');
  const [everyN, setEveryN] = useState(2);
  const [combineSelected, setCombineSelected] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleLoad = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setBusy(true);
    setProgress(0);
    try {
      const ab = await file.arrayBuffer();
      const { numPages, previews: thumbs } = await renderPdfThumbnails(ab, {
        scale: 0.35,
        onProgress: (cur, tot) => setProgress(Math.round((cur / tot) * 100)),
      });
      setFileName(file.name.replace(/\.pdf$/i, ''));
      setBuffer(ab);
      setPreviews(thumbs);
      setSelected(new Set(thumbs.map((t) => t.pageNumber)));
      setRangesStr(numPages > 2 ? `1-${Math.ceil(numPages / 2)}, ${Math.ceil(numPages / 2) + 1}-${numPages}` : `1-${numPages}`);
      onNotify('success', `Loaded ${file.name} (${numPages} pages).`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to parse PDF.');
    } finally {
      setBusy(false);
    }
  };

  const togglePage = (p: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const handleExport = async () => {
    if (!buffer) return;
    setBusy(true);
    setProgress(5);
    try {
      const srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const total = srcDoc.getPageCount();

      let groups: number[][] = [];
      if (mode === 'selected') {
        const sorted = Array.from(selected).sort((a, b) => a - b);
        if (sorted.length === 0) {
          onNotify('error', 'Select at least one page.');
          setBusy(false);
          return;
        }
        groups = combineSelected ? [sorted] : sorted.map((p) => [p]);
      } else if (mode === 'ranges') {
        groups = parsePageRanges(rangesStr, total);
        if (groups.length === 0) {
          onNotify('error', 'Enter valid page ranges (e.g. 1-3, 4-5).');
          setBusy(false);
          return;
        }
      } else {
        const step = Math.max(1, everyN);
        for (let i = 1; i <= total; i += step) {
          const chunk: number[] = [];
          for (let j = i; j < i + step && j <= total; j++) chunk.push(j);
          groups.push(chunk);
        }
      }

      if (groups.length === 1) {
        const out = await PDFDocument.create();
        const copied = await out.copyPages(
          srcDoc,
          groups[0].map((p) => p - 1)
        );
        copied.forEach((p) => out.addPage(p));
        const bytes = await out.save();
        setProgress(100);
        downloadPdfBytes(bytes, `${fileName || 'split'}-extracted.pdf`);
        onNotify('success', `Exported ${groups[0].length} page(s) as PDF.`);
      } else {
        const zip = new JSZip();
        for (let gIdx = 0; gIdx < groups.length; gIdx++) {
          const grp = groups[gIdx];
          const out = await PDFDocument.create();
          const copied = await out.copyPages(
            srcDoc,
            grp.map((p) => p - 1)
          );
          copied.forEach((p) => out.addPage(p));
          const bytes = await out.save();
          const label = grp.length === 1 ? `p${grp[0]}` : `p${grp[0]}-p${grp[grp.length - 1]}`;
          zip.file(`${fileName || 'split'}-${label}.pdf`, bytes);
          setProgress(Math.round(((gIdx + 1) / groups.length) * 90));
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        setProgress(100);
        downloadBlob(zipBlob, `${fileName || 'split'}-parts.zip`);
        onNotify('success', `Exported ${groups.length} PDF files inside ZIP archive.`);
      }
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Split failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <DropZone
        accept="application/pdf,.pdf"
        onFiles={handleLoad}
        title="Drop a PDF file to split or extract pages"
        subtitle="Preview all pages as thumbnails and split by selection, ranges, or fixed intervals"
        compact={Boolean(buffer)}
      />

      {busy && <ProgressBar progress={progress} label="Rendering & splitting pages locally..." />}

      {buffer && previews.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          {/* Controls Header */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              {(
                [
                  ['selected', 'Select Pages'],
                  ['ranges', 'Page Ranges'],
                  ['everyN', 'Every N Pages'],
                ] as [SplitMode, string][]
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                    mode === m
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={handleExport}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
            >
              {mode === 'selected' && combineSelected ? (
                <Download className="h-3.5 w-3.5" />
              ) : (
                <Scissors className="h-3.5 w-3.5" />
              )}
              <span>Split & Download</span>
            </button>
          </div>

          {/* Mode-Specific Options */}
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs">
            {mode === 'selected' && (
              <>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelected(new Set(previews.map((p) => p.pageNumber)))}
                    className="rounded-md border border-slate-200 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="rounded-md border border-slate-200 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Clear
                  </button>
                  <span className="font-mono-tabular text-slate-500 dark:text-slate-400">
                    {selected.size} / {previews.length} selected
                  </span>
                </div>
                <label className="ml-auto flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={combineSelected}
                    onChange={(e) => setCombineSelected(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Combine selected into one PDF (unchecked = ZIP of individual pages)</span>
                </label>
              </>
            )}

            {mode === 'ranges' && (
              <div className="flex flex-1 flex-wrap items-center gap-3">
                <label className="font-medium text-slate-700 dark:text-slate-300">Ranges (comma-separated):</label>
                <input
                  type="text"
                  value={rangesStr}
                  onChange={(e) => setRangesStr(e.target.value)}
                  placeholder="e.g. 1-3, 4-6, 7"
                  className="w-64 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono-tabular text-xs dark:border-slate-700 dark:bg-slate-800"
                />
                <span className="text-slate-500 dark:text-slate-400">
                  Produces {parsePageRanges(rangesStr, previews.length).length} PDF file(s)
                </span>
              </div>
            )}

            {mode === 'everyN' && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="font-medium text-slate-700 dark:text-slate-300">Pages per split PDF:</label>
                <input
                  type="number"
                  min={1}
                  max={previews.length}
                  value={everyN}
                  onChange={(e) => setEveryN(Math.max(1, Number(e.target.value) || 1))}
                  className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono-tabular text-xs dark:border-slate-700 dark:bg-slate-800"
                />
                <span className="font-mono-tabular text-slate-500 dark:text-slate-400">
                  Produces {Math.ceil(previews.length / Math.max(1, everyN))} PDF file(s)
                </span>
              </div>
            )}
          </div>

          {/* Thumbnail Grid */}
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {previews.map((p) => {
              const isSelected = selected.has(p.pageNumber);
              return (
                <button
                  key={p.pageNumber}
                  type="button"
                  onClick={() => mode === 'selected' && togglePage(p.pageNumber)}
                  className={`relative flex flex-col rounded-lg border p-2 text-left transition-colors ${
                    mode === 'selected' ? 'cursor-pointer' : 'cursor-default'
                  } ${
                    mode === 'selected' && isSelected
                      ? 'border-blue-600 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-950/30'
                      : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60'
                  }`}
                >
                  {mode === 'selected' && (
                    <span
                      className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border ${
                        isSelected
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-slate-300 bg-white/90 text-transparent dark:border-slate-600 dark:bg-slate-800'
                      }`}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                  <img
                    src={p.dataUrl}
                    alt={`Page ${p.pageNumber}`}
                    className="aspect-[3/4] w-full rounded border border-slate-200 bg-white object-contain dark:border-slate-700"
                  />
                  <span className="mt-1.5 font-mono-tabular text-[11px] font-medium text-slate-600 dark:text-slate-300">
                    Page {p.pageNumber}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
