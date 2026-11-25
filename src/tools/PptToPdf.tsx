import React, { useState } from 'react';
import { Download, Presentation } from 'lucide-react';
import { DropZone } from '../components/DropZone';
import { ProgressBar } from '../components/ProgressBar';
import { downloadPdfBytesAsync } from '../lib/pdfSetup';
import { ParsedPptxSlide, exportPptxSlidesToPdf, parsePptxFile } from '../lib/pptxParser';

interface ToolProps {
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const PptToPdf: React.FC<ToolProps> = ({ onNotify }) => {
  const [slides, setSlides] = useState<ParsedPptxSlide[]>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleFile = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pptx')) {
      onNotify('error', 'Please select a .pptx PowerPoint file.');
      return;
    }

    setBusy(true);
    setProgress(5);
    try {
      const ab = await file.arrayBuffer();
      const parsed = await parsePptxFile(ab, setProgress);
      setSlides(parsed);
      setFileName(file.name.replace(/\.pptx$/i, '.pdf'));
      onNotify('success', `Parsed ${parsed.length} slide(s) from ${file.name}.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to parse PPTX file.');
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    if (slides.length === 0) return;
    setBusy(true);
    setProgress(0);
    try {
      const bytes = await exportPptxSlidesToPdf(slides, setProgress);
      await downloadPdfBytesAsync(bytes, fileName || 'presentation.pdf');
      onNotify('success', `Exported ${slides.length} slide(s) to PDF.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to export PPTX to PDF.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <DropZone
        accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        onFiles={handleFile}
        title="Drop a .pptx presentation file"
        subtitle="Parsed 100% client-side using JSZip + XML DOMParser (text, formatting, shapes & embedded images)"
        compact={slides.length > 0}
      />

      {busy && <ProgressBar progress={progress} label="Processing presentation locally..." />}

      {slides.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <Presentation className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {slides.length} Slide{slides.length === 1 ? '' : 's'} Ready
              </span>
              <span className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
                {Math.round(slides[0].widthPt)} × {Math.round(slides[0].heightPt)} pt
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                aria-label="Output filename"
                className="w-52 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
              />
              <button
                type="button"
                disabled={busy}
                onClick={handleExport}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Export PDF</span>
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
            {slides.map((slide) => (
              <div
                key={slide.slideNumber}
                className="flex flex-col rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50"
              >
                <div className="mb-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-mono-tabular font-semibold">Slide {slide.slideNumber}</span>
                  <span className="font-mono-tabular">{slide.elements.length} element(s)</span>
                </div>

                {/* Scaled Slide Canvas Preview */}
                <div
                  className="relative w-full overflow-hidden rounded border border-slate-200 shadow-sm dark:border-slate-700"
                  style={{
                    aspectRatio: `${slide.widthPt} / ${slide.heightPt}`,
                    backgroundColor: slide.bgHex,
                  }}
                >
                  {slide.elements.map((el, idx) => {
                    const left = `${(el.xPt / slide.widthPt) * 100}%`;
                    const top = `${(el.yPt / slide.heightPt) * 100}%`;
                    const width = `${(el.wPt / slide.widthPt) * 100}%`;
                    const height = `${(el.hPt / slide.heightPt) * 100}%`;

                    if (el.type === 'image') {
                      return (
                        <img
                          key={idx}
                          src={el.dataUrl}
                          alt={`Slide ${slide.slideNumber} visual`}
                          className="absolute object-contain"
                          style={{ left, top, width, height }}
                        />
                      );
                    }

                    return (
                      <div
                        key={idx}
                        className="absolute overflow-hidden p-1.5"
                        style={{
                          left,
                          top,
                          width,
                          height,
                          backgroundColor: el.fillHex || 'transparent',
                          border: el.strokeHex ? `1px solid ${el.strokeHex}` : undefined,
                        }}
                      >
                        {el.paragraphs.map((para, pIdx) => (
                          <p
                            key={pIdx}
                            style={{ textAlign: para.align }}
                            className="leading-snug mb-1"
                          >
                            {para.runs.map((r, rIdx) => (
                              <span
                                key={rIdx}
                                style={{
                                  fontSize: `clamp(7px, ${(r.fontSizePt / slide.widthPt) * 100}cqw, 18px)`,
                                  fontWeight: r.bold ? 700 : 400,
                                  fontStyle: r.italic ? 'italic' : 'normal',
                                  color: r.colorHex,
                                }}
                              >
                                {r.text}
                              </span>
                            ))}
                          </p>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
