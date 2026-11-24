import React, { useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { ArrowDown, ArrowUp, Download, FileText, Layers, Trash2 } from 'lucide-react';
import { DropZone } from '../components/DropZone';
import { ProgressBar } from '../components/ProgressBar';
import { downloadPdfBytes, formatFileSize, renderPdfThumbnails } from '../lib/pdfSetup';

interface ToolProps {
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

interface LoadedPdfFile {
  id: string;
  name: string;
  size: number;
  buffer: ArrayBuffer;
  numPages: number;
  coverDataUrl: string;
}

interface PageEntry {
  id: string;
  fileId: string;
  fileName: string;
  pageIndex: number; // 0-based
  thumbUrl: string;
}

export const PdfMerger: React.FC<ToolProps> = ({ onNotify }) => {
  const [files, setFiles] = useState<LoadedPdfFile[]>([]);
  const [mode, setMode] = useState<'files' | 'pages'>('files');
  const [pages, setPages] = useState<PageEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [outputName, setOutputName] = useState('merged-document.pdf');
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const handleAddFiles = async (incoming: File[]) => {
    const pdfFiles = incoming.filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (pdfFiles.length === 0) {
      onNotify('error', 'Please select valid PDF files.');
      return;
    }

    setLoading(true);
    setProgress(0);
    try {
      const addedFiles: LoadedPdfFile[] = [];
      for (let i = 0; i < pdfFiles.length; i++) {
        const f = pdfFiles[i];
        const buffer = await f.arrayBuffer();
        const { numPages, previews } = await renderPdfThumbnails(buffer, { scale: 0.3, maxPages: 1 });
        addedFiles.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: f.name,
          size: f.size,
          buffer,
          numPages,
          coverDataUrl: previews[0]?.dataUrl || '',
        });
        setProgress(Math.round(((i + 1) / pdfFiles.length) * 100));
      }

      setFiles((prev) => [...prev, ...addedFiles]);
      // Reset expanded pages if user adds new files so they stay in sync
      if (mode === 'pages') {
        await buildExpandedPages([...files, ...addedFiles]);
      }
      onNotify('success', `Loaded ${addedFiles.length} PDF file(s).`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to read one or more PDFs.');
    } finally {
      setLoading(false);
    }
  };

  const buildExpandedPages = async (sourceFiles: LoadedPdfFile[]) => {
    setLoading(true);
    setProgress(0);
    try {
      const allPages: PageEntry[] = [];
      for (let fIdx = 0; fIdx < sourceFiles.length; fIdx++) {
        const f = sourceFiles[fIdx];
        const { previews } = await renderPdfThumbnails(f.buffer, { scale: 0.28 });
        previews.forEach((p) => {
          allPages.push({
            id: `${f.id}-p${p.pageNumber}`,
            fileId: f.id,
            fileName: f.name,
            pageIndex: p.pageNumber - 1,
            thumbUrl: p.dataUrl,
          });
        });
        setProgress(Math.round(((fIdx + 1) / sourceFiles.length) * 100));
      }
      setPages(allPages);
    } catch {
      onNotify('error', 'Could not expand page thumbnails.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = async (next: 'files' | 'pages') => {
    setMode(next);
    if (next === 'pages' && files.length > 0 && pages.length === 0) {
      await buildExpandedPages(files);
    }
  };

  const moveItem = <T,>(arr: T[], from: number, to: number): T[] => {
    if (to < 0 || to >= arr.length) return arr;
    const copy = [...arr];
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    return copy;
  };

  const handleMerge = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setProgress(0);

    try {
      const merged = await PDFDocument.create();
      const docCache = new Map<string, PDFDocument>();
      for (const f of files) {
        docCache.set(f.id, await PDFDocument.load(f.buffer, { ignoreEncryption: true }));
      }

      if (mode === 'files') {
        for (let i = 0; i < files.length; i++) {
          const src = docCache.get(files[i].id)!;
          const copied = await merged.copyPages(src, src.getPageIndices());
          copied.forEach((p) => merged.addPage(p));
          setProgress(Math.round(((i + 1) / files.length) * 90));
        }
      } else {
        for (let i = 0; i < pages.length; i++) {
          const entry = pages[i];
          const src = docCache.get(entry.fileId);
          if (!src) continue;
          const [copied] = await merged.copyPages(src, [entry.pageIndex]);
          merged.addPage(copied);
          setProgress(Math.round(((i + 1) / pages.length) * 90));
        }
      }

      const bytes = await merged.save();
      setProgress(100);
      downloadPdfBytes(bytes, outputName || 'merged-document.pdf');
      onNotify('success', `Merged ${merged.getPageCount()} total pages into ${outputName}.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'PDF merge failed.');
    } finally {
      setLoading(false);
    }
  };

  const totalPages = mode === 'files' ? files.reduce((s, f) => s + f.numPages, 0) : pages.length;

  return (
    <div className="space-y-5">
      <DropZone
        accept="application/pdf,.pdf"
        multiple
        onFiles={handleAddFiles}
        title="Drop PDF files here or click to browse"
        subtitle="Select 2 or more PDF documents to reorder and combine offline"
        compact={files.length > 0}
      />

      {loading && <ProgressBar progress={progress} label="Processing PDFs locally..." />}

      {files.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => switchMode('files')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                    mode === 'files'
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>By File ({files.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('pages')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                    mode === 'pages'
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span>All Pages ({totalPages})</span>
                </button>
              </div>
              <span className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
                {totalPages} pages queued
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={outputName}
                onChange={(e) => setOutputName(e.target.value)}
                aria-label="Output filename"
                className="w-48 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              <button
                type="button"
                disabled={loading || totalPages === 0}
                onClick={handleMerge}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Merge & Download</span>
              </button>
            </div>
          </div>

          {mode === 'files' ? (
            <ul className="mt-4 divide-y divide-slate-200 dark:divide-slate-800">
              {files.map((f, idx) => (
                <li
                  key={f.id}
                  draggable
                  onDragStart={() => setDragIdx(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIdx !== null && dragIdx !== idx) {
                      setFiles((prev) => moveItem(prev, dragIdx, idx));
                    }
                    setDragIdx(null);
                  }}
                  className="flex items-center gap-4 py-3 cursor-grab active:cursor-grabbing hover:bg-slate-50/70 dark:hover:bg-slate-800/40 px-2 rounded-lg"
                >
                  <span className="font-mono-tabular w-6 text-xs text-slate-400">{idx + 1}.</span>
                  {f.coverDataUrl && (
                    <img
                      src={f.coverDataUrl}
                      alt={f.name}
                      className="h-14 w-10 rounded border border-slate-200 object-cover dark:border-slate-700"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{f.name}</p>
                    <p className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
                      {f.numPages} {f.numPages === 1 ? 'page' : 'pages'} · {formatFileSize(f.size)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => setFiles((p) => moveItem(p, idx, idx - 1))}
                      title="Move up"
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === files.length - 1}
                      onClick={() => setFiles((p) => moveItem(p, idx, idx + 1))}
                      title="Move down"
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFiles((p) => p.filter((x) => x.id !== f.id));
                        setPages((p) => p.filter((x) => x.fileId !== f.id));
                      }}
                      title="Remove"
                      className="rounded p-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {pages.map((p, idx) => (
                <div
                  key={p.id}
                  draggable
                  onDragStart={() => setDragIdx(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIdx !== null && dragIdx !== idx) {
                      setPages((prev) => moveItem(prev, dragIdx, idx));
                    }
                    setDragIdx(null);
                  }}
                  className="group relative flex flex-col rounded-lg border border-slate-200 bg-slate-50 p-2 cursor-grab dark:border-slate-700 dark:bg-slate-800/60"
                >
                  <img
                    src={p.thumbUrl}
                    alt={`Page ${p.pageIndex + 1}`}
                    className="aspect-[3/4] w-full rounded border border-slate-200 bg-white object-contain dark:border-slate-700"
                  />
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                    <span className="truncate font-mono-tabular">
                      #{idx + 1} · p.{p.pageIndex + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPages((prev) => prev.filter((x) => x.id !== p.id))}
                      title="Remove page"
                      className="rounded p-1 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950/60"
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
