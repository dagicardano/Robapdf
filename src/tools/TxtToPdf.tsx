import React, { useState } from 'react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Download } from 'lucide-react';
import { DropZone } from '../components/DropZone';
import { ProgressBar } from '../components/ProgressBar';
import {
  Orientation,
  PAGE_PRESETS_MM,
  PagePreset,
  downloadPdfBytes,
  mmToPt,
  resolvePageSizePt,
  sanitizePdfText,
} from '../lib/pdfSetup';

interface ToolProps {
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const TxtToPdf: React.FC<ToolProps> = ({ onNotify }) => {
  const [text, setText] = useState(
    'Paste or import a .txt file here.\n\nAll line breaks, spacing, word wrapping, margins, and page numbers are rendered locally in your browser using pdf-lib.'
  );
  const [fontFamily, setFontFamily] = useState<'Helvetica' | 'TimesRoman' | 'Courier'>('Courier');
  const [fontSizePt, setFontSizePt] = useState(11);
  const [lineHeight, setLineHeight] = useState(1.4);
  const [preset, setPreset] = useState<Exclude<PagePreset, 'Custom'>>('A4');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [marginMm, setMarginMm] = useState(18);
  const [wordWrap, setWordWrap] = useState(true);
  const [pageNumbers, setPageNumbers] = useState(true);
  const [outputName, setOutputName] = useState('text-document.pdf');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleFile = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    try {
      const content = await file.text();
      setText(content);
      setOutputName(file.name.replace(/\.[^.]+$/, '') + '.pdf');
      onNotify('success', `Imported ${file.name} (${content.length.toLocaleString()} characters).`);
    } catch {
      onNotify('error', 'Failed to read text file.');
    }
  };

  const handleExport = async () => {
    if (!text.trim()) {
      onNotify('error', 'Enter or import text before exporting.');
      return;
    }
    setBusy(true);
    setProgress(10);
    try {
      const pdfDoc = await PDFDocument.create();
      const fontMap = {
        Helvetica: StandardFonts.Helvetica,
        TimesRoman: StandardFonts.TimesRoman,
        Courier: StandardFonts.Courier,
      };
      const font = await pdfDoc.embedFont(fontMap[fontFamily]);
      const { width, height } = resolvePageSizePt(preset, orientation);
      const mPt = mmToPt(Math.max(4, marginMm));
      const maxLineWidth = Math.max(60, width - mPt * 2);
      const stepY = fontSizePt * lineHeight;

      const rawLines = sanitizePdfText(text).replace(/\r\n/g, '\n').split('\n');
      const wrappedLines: string[] = [];

      for (const raw of rawLines) {
        if (!wordWrap) {
          wrappedLines.push(raw);
          continue;
        }
        if (raw.length === 0) {
          wrappedLines.push('');
          continue;
        }
        const words = raw.match(/(\S+|\s+)/g) || [raw];
        let current = '';
        for (const w of words) {
          const test = current + w;
          if (font.widthOfTextAtSize(test, fontSizePt) > maxLineWidth && current.length > 0) {
            wrappedLines.push(current.trimEnd());
            current = w.trimStart();
          } else {
            current = test;
          }
        }
        if (current.length > 0) wrappedLines.push(current);
      }

      let page = pdfDoc.addPage([width, height]);
      let y = height - mPt - fontSizePt;

      for (let i = 0; i < wrappedLines.length; i++) {
        if (y < mPt + (pageNumbers ? 14 : 0)) {
          page = pdfDoc.addPage([width, height]);
          y = height - mPt - fontSizePt;
        }
        const line = wrappedLines[i];
        if (line.length > 0) {
          page.drawText(line, {
            x: mPt,
            y,
            size: fontSizePt,
            font,
            color: rgb(0.07, 0.09, 0.14),
          });
        }
        y -= stepY;
        if (i % 50 === 0) setProgress(10 + Math.round((i / wrappedLines.length) * 80));
      }

      if (pageNumbers) {
        const allPages = pdfDoc.getPages();
        const total = allPages.length;
        allPages.forEach((p, idx) => {
          const footer = `Page ${idx + 1} of ${total}`;
          const fw = font.widthOfTextAtSize(footer, 9);
          p.drawText(footer, {
            x: (width - fw) / 2,
            y: Math.max(12, mPt / 2),
            size: 9,
            font,
            color: rgb(0.45, 0.5, 0.58),
          });
        });
      }

      const bytes = await pdfDoc.save();
      setProgress(100);
      downloadPdfBytes(bytes, outputName || 'text-document.pdf');
      onNotify('success', `Converted text into ${pdfDoc.getPageCount()} PDF page(s).`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'TXT to PDF conversion failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_310px]">
      <div className="space-y-4">
        <DropZone
          accept=".txt,text/plain"
          onFiles={handleFile}
          title="Drop a .txt file or edit directly below"
          subtitle="Supports large plain-text logs, scripts, notes, and source documents"
          compact
        />

        {busy && <ProgressBar progress={progress} label="Paginating text into PDF..." />}

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Plain Text Source</span>
            <span className="font-mono-tabular">
              {text.split('\n').length.toLocaleString()} lines · {text.length.toLocaleString()} chars
            </span>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={18}
            spellCheck={false}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>
      </div>

      <div className="flex h-fit flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Typography & Layout</h3>

        <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Font Family</label>
            <select
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value as typeof fontFamily)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="Courier">Courier (Monospace)</option>
              <option value="Helvetica">Helvetica (Sans-serif)</option>
              <option value="TimesRoman">Times Roman (Serif)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Font Size (pt)</label>
              <input
                type="number"
                min={7}
                max={28}
                value={fontSizePt}
                onChange={(e) => setFontSizePt(Number(e.target.value) || 11)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono-tabular text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Line Height</label>
              <input
                type="number"
                min={1}
                max={2.4}
                step={0.1}
                value={lineHeight}
                onChange={(e) => setLineHeight(Number(e.target.value) || 1.4)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono-tabular text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
          </div>

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

          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={wordWrap} onChange={(e) => setWordWrap(e.target.checked)} />
            <span>Word-wrap long lines</span>
          </label>

          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={pageNumbers} onChange={(e) => setPageNumbers(e.target.checked)} />
            <span>Include footer page numbers</span>
          </label>

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
          disabled={busy}
          onClick={handleExport}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          <Download className="h-4 w-4" />
          <span>Export PDF</span>
        </button>
      </div>
    </div>
  );
};
