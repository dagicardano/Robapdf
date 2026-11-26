import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Highlighter,
  Image as ImageIcon,
  MousePointer,
  Pen,
  PenTool,
  RotateCcw,
  RotateCw,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from 'lucide-react';
import { DropZone } from '../components/DropZone';
import { ProgressBar } from '../components/ProgressBar';
import {
  cssColorToRgb,
  downloadPdfBytes,
  imageFileToPngOrJpgBytes,
  renderSinglePdfPage,
  sanitizePdfText,
} from '../lib/pdfSetup';

interface ToolProps {
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

type EditorTool = 'select' | 'text' | 'rect' | 'highlight' | 'draw' | 'image' | 'signature';

interface BaseAnn {
  id: string;
  pageId: string;
}

interface TextAnn extends BaseAnn {
  kind: 'text';
  xNorm: number;
  yNorm: number;
  text: string;
  fontSizePt: number;
  color: string;
  bold: boolean;
}

interface RectAnn extends BaseAnn {
  kind: 'rect' | 'highlight';
  xNorm: number;
  yNorm: number;
  wNorm: number;
  hNorm: number;
  color: string;
  opacity: number;
}

interface DrawAnn extends BaseAnn {
  kind: 'draw';
  points: { x: number; y: number }[];
  color: string;
  strokeWidth: number;
}

interface ImageAnn extends BaseAnn {
  kind: 'image';
  xNorm: number;
  yNorm: number;
  wNorm: number;
  hNorm: number;
  dataUrl: string;
}

type Annotation = TextAnn | RectAnn | DrawAnn | ImageAnn;

interface PageState {
  id: string;
  origIndex: number; // 0-based index in loaded PDF
  extraRotation: number; // 0, 90, 180, 270
}

export const PdfEditor: React.FC<ToolProps> = ({ onNotify }) => {
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState('edited.pdf');
  const [pages, setPages] = useState<PageState[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  const [tool, setTool] = useState<EditorTool>('select');
  const [color, setColor] = useState('#2563eb');
  const [highlightColor, setHighlightColor] = useState('#fde047');
  const [fontSize, setFontSize] = useState(16);
  const [textBold, setTextBold] = useState(false);
  const [textDraft, setTextDraft] = useState('Approved');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);

  const [pendingImgUrl, setPendingImgUrl] = useState<string | null>(null);
  const [sigModalOpen, setSigModalOpen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const sigCanvasRef = useRef<HTMLCanvasElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);

  const [pageSizePt, setPageSizePt] = useState({ width: 595, height: 842 });
  const dragState = useRef<{
    mode: 'draw' | 'rect' | 'move' | null;
    startX: number;
    startY: number;
    annId?: string;
    points?: { x: number; y: number }[];
    origX?: number;
    origY?: number;
  }>({ mode: null, startX: 0, startY: 0 });
  const [previewRect, setPreviewRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [sigDrawing, setSigDrawing] = useState(false);

  const activePage = pages[activeIdx] || null;

  const handleLoadPdf = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setBusy(true);
    setProgress(20);
    try {
      const ab = await file.arrayBuffer();
      const doc = await PDFDocument.load(ab, { ignoreEncryption: true });
      const count = doc.getPageCount();
      const list: PageState[] = Array.from({ length: count }, (_, idx) => ({
        id: `pg-${idx}-${Date.now()}`,
        origIndex: idx,
        extraRotation: 0,
      }));
      setBuffer(ab);
      setFileName(file.name.replace(/\.pdf$/i, '') + '-edited.pdf');
      setPages(list);
      setActiveIdx(0);
      setAnnotations([]);
      setSelectedAnnId(null);
      setProgress(100);
      onNotify('success', `Loaded ${file.name} (${count} pages) into editor.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to open PDF.');
    } finally {
      setBusy(false);
    }
  };

  // Render active page to background canvas
  useEffect(() => {
    if (!buffer || !activePage || !bgCanvasRef.current || !overlayCanvasRef.current) return;
    let cancelled = false;
    (async () => {
      const dims = await renderSinglePdfPage(
        buffer,
        activePage.origIndex + 1,
        bgCanvasRef.current!,
        1.4,
        activePage.extraRotation
      );
      if (cancelled) return;
      setPageSizePt({ width: dims.widthPt, height: dims.heightPt });
      overlayCanvasRef.current!.width = dims.renderWidth;
      overlayCanvasRef.current!.height = dims.renderHeight;
    })();
    return () => {
      cancelled = true;
    };
  }, [buffer, activePage]);

  // Draw annotations onto overlay canvas
  const redrawOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas || !activePage) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const pageAnns = annotations.filter((a) => a.pageId === activePage.id);
    for (const ann of pageAnns) {
      const isSelected = ann.id === selectedAnnId;
      ctx.save();

      if (ann.kind === 'rect' || ann.kind === 'highlight') {
        ctx.globalAlpha = ann.opacity;
        if (ann.kind === 'highlight') {
          ctx.fillStyle = ann.color;
          ctx.fillRect(ann.xNorm * w, ann.yNorm * h, ann.wNorm * w, ann.hNorm * h);
        } else {
          ctx.strokeStyle = ann.color;
          ctx.lineWidth = 2.5;
          ctx.strokeRect(ann.xNorm * w, ann.yNorm * h, ann.wNorm * w, ann.hNorm * h);
        }
      } else if (ann.kind === 'draw') {
        if (ann.points.length > 1) {
          ctx.strokeStyle = ann.color;
          ctx.lineWidth = ann.strokeWidth * (w / pageSizePt.width);
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(ann.points[0].x * w, ann.points[0].y * h);
          for (let i = 1; i < ann.points.length; i++) {
            ctx.lineTo(ann.points[i].x * w, ann.points[i].y * h);
          }
          ctx.stroke();
        }
      } else if (ann.kind === 'text') {
        const pxSize = ann.fontSizePt * (w / pageSizePt.width);
        ctx.font = `${ann.bold ? 'bold ' : ''}${pxSize}px Helvetica, Arial, sans-serif`;
        ctx.fillStyle = ann.color;
        ctx.textBaseline = 'top';
        ctx.fillText(ann.text, ann.xNorm * w, ann.yNorm * h);
        if (isSelected) {
          const metrics = ctx.measureText(ann.text);
          ctx.strokeStyle = '#2563eb';
          ctx.lineWidth = 1.2;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(ann.xNorm * w - 4, ann.yNorm * h - 4, metrics.width + 8, pxSize + 8);
        }
      } else if (ann.kind === 'image') {
        const img = new Image();
        img.src = ann.dataUrl;
        if (img.complete) {
          ctx.drawImage(img, ann.xNorm * w, ann.yNorm * h, ann.wNorm * w, ann.hNorm * h);
        } else {
          img.onload = () => redrawOverlay();
        }
        if (isSelected) {
          ctx.strokeStyle = '#2563eb';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(ann.xNorm * w, ann.yNorm * h, ann.wNorm * w, ann.hNorm * h);
        }
      }
      ctx.restore();
    }

    if (previewRect) {
      ctx.save();
      ctx.strokeStyle = tool === 'highlight' ? highlightColor : color;
      ctx.fillStyle = highlightColor;
      ctx.globalAlpha = tool === 'highlight' ? 0.35 : 0.9;
      ctx.lineWidth = 2;
      if (tool === 'highlight') ctx.fillRect(previewRect.x*w,previewRect.y*h,previewRect.w*w,previewRect.h*h);
      else if (tool === 'underline' || tool === 'strikeout') { ctx.beginPath(); const yy=(previewRect.y+(tool==='underline'?previewRect.h*.8:previewRect.h*.5))*h; ctx.moveTo(previewRect.x*w,yy); ctx.lineTo((previewRect.x+previewRect.w)*w,yy); ctx.stroke(); }
      else if (tool === 'ellipse') { ctx.beginPath(); ctx.ellipse((previewRect.x+previewRect.w/2)*w,(previewRect.y+previewRect.h/2)*h,Math.max(1,previewRect.w*w/2),Math.max(1,previewRect.h*h/2),0,0,Math.PI*2); ctx.stroke(); }
      else if (tool === 'arrow') { ctx.beginPath(); ctx.moveTo(previewRect.x*w,(previewRect.y+previewRect.h)*h); ctx.lineTo((previewRect.x+previewRect.w)*w,previewRect.y*h); ctx.stroke(); }
      else ctx.strokeRect(previewRect.x*w,previewRect.y*h,previewRect.w*w,previewRect.h*h);
      ctx.restore();
    }
  }, [annotations, activePage, selectedAnnId, pageSizePt, previewRect, tool, highlightColor, color]);

  useEffect(() => {
    redrawOverlay();
  }, [redrawOverlay]);

  const getNormCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const hitTest = (nx: number, ny: number): Annotation | undefined => {
    if (!activePage) return undefined;
    const pageAnns = [...annotations].filter((a) => a.pageId === activePage.id).reverse();
    return pageAnns.find((a) => {
      if (a.kind === 'rect' || a.kind === 'highlight' || a.kind === 'image') {
        return nx >= a.xNorm && nx <= a.xNorm + a.wNorm && ny >= a.yNorm && ny <= a.yNorm + a.hNorm;
      }
      if (a.kind === 'text') {
        return nx >= a.xNorm - 0.02 && nx <= a.xNorm + 0.25 && ny >= a.yNorm - 0.02 && ny <= a.yNorm + 0.05;
      }
      return false;
    });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activePage) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = getNormCoords(e);

    if (tool === 'select') {
      const hit = hitTest(x, y);
      setSelectedAnnId(hit?.id ?? null);
      if (hit && hit.kind !== 'draw') {
        dragState.current = {
          mode: 'move',
          startX: x,
          startY: y,
          annId: hit.id,
          origX: hit.xNorm,
          origY: hit.yNorm,
        };
      }
      return;
    }

    if (tool === 'text') {
      const content = textDraft.trim() || 'Annotation';
      const newAnn: TextAnn = {
        id: `ann-${Date.now()}`,
        pageId: activePage.id,
        kind: 'text',
        xNorm: x,
        yNorm: y,
        text: content,
        fontSizePt: fontSize,
        color,
        bold: textBold,
      };
      setAnnotations((p) => [...p, newAnn]);
      setSelectedAnnId(newAnn.id);
      setTool('select');
      return;
    }

    if ((tool === 'image' || tool === 'signature') && pendingImgUrl) {
      const img = new Image();
      img.onload = () => {
        const aspect = img.naturalHeight / Math.max(1, img.naturalWidth);
        const wNorm = tool === 'signature' ? 0.24 : 0.22;
        const hNorm = (wNorm * pageSizePt.width * aspect) / pageSizePt.height;
        const newAnn: ImageAnn = {
          id: `ann-${Date.now()}`,
          pageId: activePage.id,
          kind: 'image',
          xNorm: Math.max(0, x - wNorm / 2),
          yNorm: Math.max(0, y - hNorm / 2),
          wNorm,
          hNorm,
          dataUrl: pendingImgUrl,
        };
        setAnnotations((p) => [...p, newAnn]);
        setSelectedAnnId(newAnn.id);
        setPendingImgUrl(null);
        setTool('select');
      };
      img.src = pendingImgUrl;
      return;
    }

    if (tool === 'draw') {
      dragState.current = { mode: 'draw', startX: x, startY: y, points: [{ x, y }] };
      const tempAnn: DrawAnn = {
        id: `draw-${Date.now()}`,
        pageId: activePage.id,
        kind: 'draw',
        points: [{ x, y }],
        color,
        strokeWidth,
      };
      dragState.current.annId = tempAnn.id;
      setAnnotations((p) => [...p, tempAnn]);
      return;
    }

    if (tool === 'rect' || tool === 'highlight') {
      dragState.current = { mode: 'rect', startX: x, startY: y };
      setPreviewRect({ x, y, w: 0, h: 0 });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const st = dragState.current;
    if (!st.mode) return;
    const { x, y } = getNormCoords(e);

    if (st.mode === 'move' && st.annId !== undefined) {
      const dx = x - st.startX;
      const dy = y - st.startY;
      setAnnotations((prev) =>
        prev.map((a) => {
          if (a.id !== st.annId || a.kind === 'draw') return a;
          return {
            ...a,
            xNorm: Math.max(0, Math.min(0.95, (st.origX ?? a.xNorm) + dx)),
            yNorm: Math.max(0, Math.min(0.95, (st.origY ?? a.yNorm) + dy)),
          };
        })
      );
    } else if (st.mode === 'draw' && st.annId) {
      setAnnotations((prev) =>
        prev.map((a) => (a.id === st.annId && a.kind === 'draw' ? { ...a, points: [...a.points, { x, y }] } : a))
      );
    } else if (st.mode === 'rect') {
      setPreviewRect({
        x: Math.min(st.startX, x),
        y: Math.min(st.startY, y),
        w: Math.abs(x - st.startX),
        h: Math.abs(y - st.startY),
      });
    }
  };

  const handlePointerUp = () => {
    const st = dragState.current;
    if (st.mode === 'rect' && previewRect && activePage && previewRect.w > 0.01 && previewRect.h > 0.01) {
      const newAnn: RectAnn = {
        id: `rect-${Date.now()}`,
        pageId: activePage.id,
        kind: tool === 'highlight' ? 'highlight' : 'rect',
        xNorm: previewRect.x,
        yNorm: previewRect.y,
        wNorm: previewRect.w,
        hNorm: previewRect.h,
        color: tool === 'highlight' ? highlightColor : color,
        opacity: tool === 'highlight' ? 0.38 : 1,
      };
      setAnnotations((p) => [...p, newAnn]);
      setSelectedAnnId(newAnn.id);
    }
    dragState.current = { mode: null, startX: 0, startY: 0 };
    setPreviewRect(null);
  };

  const handleRotatePage = (delta: number) => {
    if (!activePage) return;
    setPages((prev) =>
      prev.map((p, idx) =>
        idx === activeIdx ? { ...p, extraRotation: ((p.extraRotation + delta) % 360 + 360) % 360 } : p
      )
    );
  };

  const handleDeletePage = () => {
    if (pages.length <= 1) {
      onNotify('error', 'Cannot delete the only remaining page.');
      return;
    }
    const removedId = activePage.id;
    setPages((prev) => prev.filter((_, idx) => idx !== activeIdx));
    setAnnotations((prev) => prev.filter((a) => a.pageId !== removedId));
    setActiveIdx((i) => Math.max(0, Math.min(i, pages.length - 2)));
    onNotify('info', 'Page removed from document.');
  };

  const handleUploadImage = (files: File[]) => {
    const f = files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPendingImgUrl(String(reader.result));
      setTool('image');
      onNotify('info', 'Click anywhere on the page to place the image.');
    };
    reader.readAsDataURL(f);
  };

  const saveSignature = () => {
    const c = sigCanvasRef.current;
    if (!c) return;
    setPendingImgUrl(c.toDataURL('image/png'));
    setSigModalOpen(false);
    setTool('signature');
    onNotify('info', 'Click anywhere on the page to stamp your signature.');
  };

  const handleSavePdf = async () => {
    if (!buffer || pages.length === 0) return;
    setBusy(true);
    setProgress(0);
    try {
      const srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const outDoc = await PDFDocument.create();
      const fontReg = await outDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await outDoc.embedFont(StandardFonts.HelveticaBold);

      for (let i = 0; i < pages.length; i++) {
        const pgState = pages[i];
        const [copied] = await outDoc.copyPages(srcDoc, [pgState.origIndex]);
        if (pgState.extraRotation !== 0) {
          const curRot = copied.getRotation().angle;
          copied.setRotation(degrees((curRot + pgState.extraRotation) % 360));
        }
        outDoc.addPage(copied);

        // Normalize visual orientation via embedded page if rotated, or draw onto page directly
        const page = outDoc.getPage(outDoc.getPageCount() - 1);
        const { width: pw, height: ph } = page.getSize();
        const pageAnns = annotations.filter((a) => a.pageId === pgState.id);

        for (const ann of pageAnns) {
          if (ann.kind === 'text') {
            const pdfX = ann.xNorm * pw;
            const pdfY = ph - ann.yNorm * ph - ann.fontSizePt;
            page.drawText(sanitizePdfText(ann.text), {
              x: pdfX,
              y: pdfY,
              size: ann.fontSizePt,
              font: ann.bold ? fontBold : fontReg,
              color: cssColorToRgb(ann.color),
            });
          } else if (ann.kind === 'rect' || ann.kind === 'highlight') {
            const rx = ann.xNorm * pw;
            const rw = ann.wNorm * pw;
            const rh = ann.hNorm * ph;
            const ry = ph - ann.yNorm * ph - rh;
            if (ann.kind === 'highlight') {
              page.drawRectangle({
                x: rx,
                y: ry,
                width: rw,
                height: rh,
                color: cssColorToRgb(ann.color),
                opacity: ann.opacity,
              });
            } else {
              page.drawRectangle({
                x: rx,
                y: ry,
                width: rw,
                height: rh,
                borderColor: cssColorToRgb(ann.color),
                borderWidth: 2,
              });
            }
          } else if (ann.kind === 'draw' && ann.points.length > 1) {
            const cRgb = cssColorToRgb(ann.color);
            for (let k = 1; k < ann.points.length; k++) {
              const p1 = ann.points[k - 1];
              const p2 = ann.points[k];
              page.drawLine({
                start: { x: p1.x * pw, y: ph - p1.y * ph },
                end: { x: p2.x * pw, y: ph - p2.y * ph },
                thickness: ann.strokeWidth,
                color: cRgb,
              });
            }
          } else if (ann.kind === 'image') {
            const { bytes, format } = await imageFileToPngOrJpgBytes(ann.dataUrl);
            const emb = format === 'jpg' ? await outDoc.embedJpg(bytes) : await outDoc.embedPng(bytes);
            const iw = ann.wNorm * pw;
            const ih = ann.hNorm * ph;
            page.drawImage(emb, {
              x: ann.xNorm * pw,
              y: ph - ann.yNorm * ph - ih,
              width: iw,
              height: ih,
            });
          }
        }
        setProgress(Math.round(((i + 1) / pages.length) * 95));
      }

      const bytes = await outDoc.save();
      setProgress(100);
      downloadPdfBytes(bytes, fileName || 'edited.pdf');
      onNotify('success', `Saved edited PDF (${pages.length} pages).`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to save edited PDF.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {!buffer && (
        <DropZone
          accept="application/pdf,.pdf"
          onFiles={handleLoadPdf}
          title="Drop a PDF document to annotate & edit"
          subtitle="Add text, images, highlights, rectangles, freehand drawings, signatures, and rotate or delete pages"
        />
      )}

      {busy && <ProgressBar progress={progress} label="Processing PDF document..." />}

      {buffer && activePage && (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          {/* Primary Editor Toolbar */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 p-2.5 dark:border-slate-800">
            {(
              [
                ['select', 'Select', MousePointer],
                ['text', 'Text', Type],
                ['rect', 'Rectangle', Square],
                ['highlight', 'Highlight', Highlighter],
                ['draw', 'Draw', Pen],
              ] as [EditorTool, string, React.ElementType][]
            ).map(([tId, label, Icon]) => (
              <button
                key={tId}
                type="button"
                onClick={() => setTool(tId)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                  tool === tId
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </button>
            ))}

            <button
              type="button"
              onClick={() => imgInputRef.current?.click()}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                tool === 'image'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <ImageIcon className="h-3.5 w-3.5" />
              <span>Image</span>
            </button>
            <input
              ref={imgInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleUploadImage(Array.from(e.target.files));
                e.target.value = '';
              }}
            />

            <button
              type="button"
              onClick={() => setSigModalOpen(true)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                tool === 'signature'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <PenTool className="h-3.5 w-3.5" />
              <span>Signature</span>
            </button>

            <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

            {/* Contextual Tool Options */}
            {tool === 'text' && (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={textDraft}
                  onChange={(e) => setTextDraft(e.target.value)}
                  placeholder="Text to stamp"
                  className="w-32 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
                />
                <input
                  type="number"
                  min={8}
                  max={64}
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value) || 16)}
                  className="w-14 rounded-md border border-slate-200 bg-white px-2 py-1 font-mono-tabular text-xs dark:border-slate-700 dark:bg-slate-800"
                />
                <button
                  type="button"
                  onClick={() => setTextBold((b) => !b)}
                  className={`rounded border px-2 py-1 text-xs font-bold ${
                    textBold
                      ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  B
                </button>
              </div>
            )}

            {tool === 'draw' && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                <span>Width</span>
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={strokeWidth}
                  onChange={(e) => setStrokeWidth(Number(e.target.value) || 3)}
                  className="w-12 rounded border border-slate-200 px-1.5 py-1 font-mono-tabular text-xs dark:border-slate-700 dark:bg-slate-800"
                />
              </label>
            )}

            <input
              type="color"
              aria-label="Annotation color"
              value={tool === 'highlight' ? highlightColor : color}
              onChange={(e) => (tool === 'highlight' ? setHighlightColor(e.target.value) : setColor(e.target.value))}
              className="h-7 w-7 cursor-pointer rounded border border-slate-200 bg-transparent p-0.5 dark:border-slate-700"
            />

            <button
              type="button"
              onClick={() => {
                if (selectedAnnId) {
                  setAnnotations((p) => p.filter((a) => a.id !== selectedAnnId));
                  setSelectedAnnId(null);
                } else {
                  setAnnotations((p) => p.slice(0, -1));
                }
              }}
              title="Undo / Delete selected annotation"
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Undo2 className="h-3.5 w-3.5" />
              <span>{selectedAnnId ? 'Delete Item' : 'Undo'}</span>
            </button>

            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleRotatePage(-90)}
                title="Rotate page left"
                className="rounded-lg border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleRotatePage(90)}
                title="Rotate page right"
                className="rounded-lg border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleDeletePage}
                title="Delete current page"
                className="rounded-lg border border-slate-200 p-1.5 text-red-600 hover:bg-red-50 dark:border-slate-700 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={handleSavePdf}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Save PDF</span>
              </button>
            </div>
          </div>

          {/* Page Navigation Strip */}
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs dark:border-slate-800 dark:bg-slate-900/60">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={activeIdx === 0}
                onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}
                className="rounded border border-slate-200 bg-white p-1 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="font-mono-tabular font-medium text-slate-700 dark:text-slate-300">
                Page {activeIdx + 1} of {pages.length}
              </span>
              <button
                type="button"
                disabled={activeIdx >= pages.length - 1}
                onClick={() => setActiveIdx((i) => Math.min(pages.length - 1, i + 1))}
                className="rounded border border-slate-200 bg-white p-1 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <span className="text-slate-500 dark:text-slate-400">
              {tool === 'text' && 'Click page to place text'}
              {tool === 'draw' && 'Drag mouse or finger to draw freehand'}
              {(tool === 'rect' || tool === 'highlight') && 'Click and drag to draw box'}
              {(tool === 'image' || tool === 'signature') &&
                (pendingImgUrl ? 'Click page to stamp' : 'Select image or draw signature')}
              {tool === 'select' && 'Click an item to select or drag to move'}
            </span>

            <button
              type="button"
              onClick={() => {
                setBuffer(null);
                setPages([]);
                setAnnotations([]);
              }}
              className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Load Another PDF
            </button>
          </div>

          {/* Interactive Canvas Workspace */}
          <div className="flex justify-center overflow-auto bg-slate-100 p-4 sm:p-6 dark:bg-slate-950/70">
            <div className="relative inline-block shadow-md">
              <canvas ref={bgCanvasRef} className="block max-w-full rounded bg-white" />
              <canvas
                ref={overlayCanvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                className={`absolute inset-0 h-full w-full touch-none ${
                  tool === 'select' ? 'cursor-default' : 'cursor-crosshair'
                }`}
              />
            </div>
          </div>
        </div>
      )}

      {/* Signature Drawing Modal */}
      {sigModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Draw Signature</h3>
              <button
                type="button"
                onClick={() => setSigModalOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <canvas
              ref={sigCanvasRef}
              width={420}
              height={180}
              onPointerDown={(e) => {
                const c = sigCanvasRef.current;
                if (!c) return;
                c.setPointerCapture(e.pointerId);
                const rect = c.getBoundingClientRect();
                const ctx = c.getContext('2d')!;
                ctx.strokeStyle = '#0f172a';
                ctx.lineWidth = 2.8;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(((e.clientX - rect.left) / rect.width) * c.width, ((e.clientY - rect.top) / rect.height) * c.height);
                setSigDrawing(true);
              }}
              onPointerMove={(e) => {
                if (!sigDrawing || !sigCanvasRef.current) return;
                const c = sigCanvasRef.current;
                const rect = c.getBoundingClientRect();
                const ctx = c.getContext('2d')!;
                ctx.lineTo(((e.clientX - rect.left) / rect.width) * c.width, ((e.clientY - rect.top) / rect.height) * c.height);
                ctx.stroke();
              }}
              onPointerUp={() => setSigDrawing(false)}
              className="w-full touch-none rounded-lg border border-slate-300 bg-white cursor-crosshair"
            />
            <div className="mt-4 flex justify-between">
              <button
                type="button"
                onClick={() => {
                  const c = sigCanvasRef.current;
                  c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
                }}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={saveSignature}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Use Signature
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
