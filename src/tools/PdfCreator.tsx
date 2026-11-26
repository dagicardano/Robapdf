import React, { useEffect, useRef, useState } from 'react';
import {
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  ListOrdered,
  Minus,
  Download,
  RotateCcw,
} from 'lucide-react';
import { renderHtmlToPdfBytes } from '../lib/htmlToPdf';
import {
  Orientation,
  PAGE_PRESETS_MM,
  PagePreset,
  downloadPdfBytes,
  mmToPt,
  ptToMm,
  resolvePageSizePt,
} from '../lib/pdfSetup';
import { ProgressBar } from '../components/ProgressBar';

interface ToolProps {
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

const INITIAL_HTML = `<h1>Project Specification</h1>
<p>Welcome to <strong>OfflinePDF Studio</strong>. Edit this document directly in your browser—every keystroke and PDF export runs 100% locally on your device.</p>
<h2>Key Highlights</h2>
<ul>
  <li>Rich headings, <strong>bold</strong>, <em>italic</em>, and <u>underlined</u> formatting</li>
  <li>Configurable page presets (A4, A3, A5, Letter, Legal, or custom mm)</li>
  <li>Custom margins, orientation, and background color</li>
</ul>
<p>Use the toolbar above to style text, insert lists, or adjust layout settings on the right.</p>`;

export const PdfCreator: React.FC<ToolProps> = ({ onNotify }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [preset, setPreset] = useState<PagePreset>('A4');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [customMm, setCustomMm] = useState({ width: 210, height: 297 });
  const [marginMm, setMarginMm] = useState(20);
  const [bgColor, setBgColor] = useState('#ffffff');
  const [fontSizePx, setFontSizePx] = useState('14');
  const [textColor, setTextColor] = useState('#0f172a');
  const [fileName, setFileName] = useState('document.pdf');
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (editorRef.current && !editorRef.current.innerHTML.trim()) {
      editorRef.current.innerHTML = INITIAL_HTML;
    }
  }, []);

  const exec = (cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
  };

  const applyFontSize = (ptSize: string) => {
    setFontSizePx(ptSize);
    editorRef.current?.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    if (sel.isCollapsed) return;

    document.execCommand('fontSize', false, '7');
    if (editorRef.current) {
      const fonts = editorRef.current.querySelectorAll('font[size="7"]');
      fonts.forEach((f) => {
        const span = document.createElement('span');
        span.style.fontSize = `${ptSize}pt`;
        span.innerHTML = f.innerHTML;
        f.replaceWith(span);
      });
    }
  };

  const pagePt = resolvePageSizePt(preset, orientation, customMm);
  const widthMm = Math.round(ptToMm(pagePt.width));
  const heightMm = Math.round(ptToMm(pagePt.height));

  const handleExport = async () => {
    const html = editorRef.current?.innerHTML || '';
    if (!html.trim()) {
      onNotify('error', 'Document is empty. Please add some content before exporting.');
      return;
    }
    setExporting(true);
    setProgress(5);
    try {
      const mPt = mmToPt(Math.max(0, Math.min(80, marginMm)));
      const bytes = await renderHtmlToPdfBytes(html, {
        pageWidthPt: pagePt.width,
        pageHeightPt: pagePt.height,
        marginTopPt: mPt,
        marginRightPt: mPt,
        marginBottomPt: mPt,
        marginLeftPt: mPt,
        backgroundHex: bgColor,
        baseFontSizePt: 12,
        onProgress: setProgress,
      });
      downloadPdfBytes(bytes, fileName || 'document.pdf');
      onNotify('success', `Exported ${fileName || 'document.pdf'} (${widthMm} × ${heightMm} mm).`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to generate PDF.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
      {/* Editor Column */}
      <div className="flex flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {/* Formatting Toolbar */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 p-2.5 dark:border-slate-800">
          <select
            aria-label="Block format"
            onChange={(e) => exec('formatBlock', e.target.value)}
            defaultValue="p"
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="p">Paragraph</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
            <option value="blockquote">Quote</option>
          </select>

          <select
            aria-label="Font size"
            value={fontSizePx}
            onChange={(e) => applyFontSize(e.target.value)}
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {[10, 11, 12, 14, 16, 18, 22, 26, 32].map((sz) => (
              <option key={sz} value={String(sz)}>
                {sz} pt
              </option>
            ))}
          </select>

          <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

          <button
            type="button"
            onClick={() => exec('bold')}
            title="Bold"
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => exec('italic')}
            title="Italic"
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => exec('underline')}
            title="Underline"
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Underline className="h-4 w-4" />
          </button>

          <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 px-2 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            <span>Color</span>
            <input
              type="color"
              value={textColor}
              onChange={(e) => {
                setTextColor(e.target.value);
                exec('foreColor', e.target.value);
              }}
              className="h-4 w-4 cursor-pointer border-0 bg-transparent p-0"
            />
          </label>

          <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

          <button
            type="button"
            onClick={() => exec('justifyLeft')}
            title="Align Left"
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <AlignLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => exec('justifyCenter')}
            title="Align Center"
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <AlignCenter className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => exec('justifyRight')}
            title="Align Right"
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <AlignRight className="h-4 w-4" />
          </button>

          <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

          <button
            type="button"
            onClick={() => exec('insertUnorderedList')}
            title="Bullet List"
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => exec('insertOrderedList')}
            title="Numbered List"
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <ListOrdered className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => exec('insertHorizontalRule')}
            title="Divider Line"
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Minus className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              if (editorRef.current) editorRef.current.innerHTML = '<p><br></p>';
            }}
            title="Clear Document"
            className="ml-auto flex h-8 items-center gap-1 rounded-md px-2.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Clear</span>
          </button>
        </div>

        {/* Paper Sheet Preview Surface */}
        <div className="flex justify-center overflow-auto bg-slate-100/80 p-4 sm:p-8 dark:bg-slate-950/60">
          <div
            className="w-full max-w-[720px] min-h-[540px] rounded-md border border-slate-200 shadow-sm transition-colors"
            style={{
              backgroundColor: bgColor,
              padding: `${Math.max(16, Math.min(56, marginMm * 1.4))}px`,
              color: '#0f172a',
            }}
          >
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              className="rich-editor-content min-h-[460px] text-sm leading-relaxed"
            />
          </div>
        </div>
      </div>

      {/* Settings Sidebar */}
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 h-fit">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Page Setup</h3>
          <p className="mt-0.5 font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
            {widthMm} × {heightMm} mm · {Math.round(pagePt.width)} × {Math.round(pagePt.height)} pt
          </p>
        </div>

        <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              Page Size
            </label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as PagePreset)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {(Object.keys(PAGE_PRESETS_MM) as Exclude<PagePreset, 'Custom'>[]).map((k) => (
                <option key={k} value={k}>
                  {PAGE_PRESETS_MM[k].label}
                </option>
              ))}
              <option value="Custom">Custom (mm)</option>
            </select>
          </div>

          {preset === 'Custom' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Width (mm)</label>
                <input
                  type="number"
                  min={40}
                  max={1000}
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
                  max={1000}
                  value={customMm.height}
                  onChange={(e) => setCustomMm((p) => ({ ...p, height: Number(e.target.value) || 297 }))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono-tabular text-sm dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              Orientation
            </label>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              {(['portrait', 'landscape'] as Orientation[]).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOrientation(o)}
                  className={`rounded-md py-1.5 text-xs font-medium capitalize transition-colors ${
                    orientation === o
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                Margins (mm)
              </label>
              <input
                type="number"
                min={0}
                max={60}
                value={marginMm}
                onChange={(e) => setMarginMm(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono-tabular text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                Page Color
              </label>
              <div className="flex h-[38px] items-center gap-2 rounded-lg border border-slate-200 px-2.5 dark:border-slate-700 dark:bg-slate-800">
                <input
                  type="color"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  className="h-6 w-6 cursor-pointer border-0 bg-transparent p-0"
                />
                <span className="font-mono-tabular text-xs text-slate-600 dark:text-slate-300">{bgColor}</span>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              Output Filename
            </label>
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        </div>

        {exporting && <ProgressBar progress={progress} label="Generating PDF..." />}

        <button
          type="button"
          disabled={exporting}
          onClick={handleExport}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
        >
          <Download className="h-4 w-4" />
          <span>{exporting ? 'Exporting...' : 'Export PDF'}</span>
        </button>
      </div>
    </div>
  );
};
