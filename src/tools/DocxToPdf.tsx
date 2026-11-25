import React, { useState } from 'react';
import mammoth from 'mammoth';
import { Download, FileText } from 'lucide-react';
import { DropZone } from '../components/DropZone';
import { ProgressBar } from '../components/ProgressBar';
import { renderHtmlToPdfBytes } from '../lib/htmlToPdf';
import {
  Orientation,
  PAGE_PRESETS_MM,
  PagePreset,
  downloadPdfBytes,
  mmToPt,
  resolvePageSizePt,
} from '../lib/pdfSetup';

interface ToolProps {
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const DocxToPdf: React.FC<ToolProps> = ({ onNotify }) => {
  const [html, setHtml] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [outputName, setOutputName] = useState('word-document.pdf');
  const [preset, setPreset] = useState<Exclude<PagePreset, 'Custom'>>('A4');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [marginMm, setMarginMm] = useState(20);
  const [fontFamily, setFontFamily] = useState<'sans' | 'serif'>('sans');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleFile = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      onNotify('error', 'Please select a .docx Word document.');
      return;
    }

    setBusy(true);
    setProgress(25);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });
      setHtml(result.value || '<p>(Empty document)</p>');
      setWarnings(result.messages.map((m) => m.message));
      setOutputName(file.name.replace(/\.docx$/i, '.pdf'));
      setProgress(100);
      onNotify('success', `Parsed ${file.name} locally with Mammoth.js.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to read .docx file.');
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    if (!html) return;
    setBusy(true);
    setProgress(5);
    try {
      const { width, height } = resolvePageSizePt(preset, orientation);
      const mPt = mmToPt(Math.max(5, marginMm));
      const bytes = await renderHtmlToPdfBytes(html, {
        pageWidthPt: width,
        pageHeightPt: height,
        marginTopPt: mPt,
        marginRightPt: mPt,
        marginBottomPt: mPt,
        marginLeftPt: mPt,
        fontFamily,
        baseFontSizePt: 11.5,
        onProgress: setProgress,
      });
      downloadPdfBytes(bytes, outputName || 'word-document.pdf');
      onNotify('success', `Converted DOCX into ${outputName}.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'DOCX to PDF export failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_310px]">
      <div className="space-y-4">
        <DropZone
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onFiles={handleFile}
          title="Drop a .docx Word document"
          subtitle="Parsed locally with Mammoth.js preserving headings, bold/italic, lists, tables, and embedded images"
          compact={Boolean(html)}
        />

        {busy && <ProgressBar progress={progress} label="Converting DOCX locally..." />}

        {html && (
          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span>Document Preview</span>
              </div>
              {warnings.length > 0 && (
                <span className="font-mono-tabular text-[11px] text-amber-600 dark:text-amber-400">
                  {warnings.length} parser note(s)
                </span>
              )}
            </div>
            <div className="max-h-[620px] overflow-auto bg-slate-100/70 p-4 sm:p-6 dark:bg-slate-950/50">
              <div
                className="mx-auto max-w-[720px] rounded-md border border-slate-200 bg-white p-8 text-sm leading-relaxed text-slate-900 shadow-sm [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-3 [&_table]:w-full [&_table]:border-collapse [&_table]:my-4 [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_td]:border [&_td]:border-slate-300 [&_td]:px-2.5 [&_td]:py-1.5 [&_img]:max-w-full [&_img]:my-3"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex h-fit flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">PDF Export Settings</h3>

        <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Page Size</label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as Exclude<PagePreset, 'Custom'>)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              {(Object.keys(PAGE_PRESETS_MM) as Exclude<PagePreset, 'Custom'>[]).map((k) => (
                <option key={k} value={k}>
                  {PAGE_PRESETS_MM[k].label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Orientation</label>
              <select
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as Orientation)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Margins (mm)</label>
              <input
                type="number"
                min={5}
                max={50}
                value={marginMm}
                onChange={(e) => setMarginMm(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono-tabular text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">PDF Font</label>
            <select
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value as 'sans' | 'serif')}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="sans">Helvetica (Clean Sans)</option>
              <option value="serif">Times Roman (Editorial Serif)</option>
            </select>
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
          disabled={busy || !html}
          onClick={handleExport}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          <span>Export PDF</span>
        </button>
      </div>
    </div>
  );
};
