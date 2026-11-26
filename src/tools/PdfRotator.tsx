import React, { useState } from 'react';
import { PDFDocument, degrees } from 'pdf-lib';
import { Download, RotateCw, FileText, CheckCircle2 } from 'lucide-react';
import { DropZone } from '../components/DropZone';
import { ProgressBar } from '../components/ProgressBar';
import { downloadPdfBytes, formatFileSize } from '../lib/pdfSetup';

interface ToolProps { onNotify: (type: 'success' | 'error' | 'info', msg: string) => void; }

export const PdfRotator: React.FC<ToolProps> = ({ onNotify }) => {
  const [file, setFile] = useState<File | null>(null);
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [angle, setAngle] = useState<90 | 180 | 270>(90);
  const [scope, setScope] = useState<'all' | 'odd' | 'even' | 'custom'>('all');
  const [custom, setCustom] = useState('1,3-5');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [count, setCount] = useState(0);

  const load = async (items: File[]) => {
    const next = items.find((item) => item.type === 'application/pdf' || item.name.toLowerCase().endsWith('.pdf'));
    if (!next) { onNotify('error', 'Choose a valid PDF file.'); return; }
    try {
      const data = await next.arrayBuffer();
      const doc = await PDFDocument.load(data, { ignoreEncryption: true, throwOnInvalidObject: false });
      setFile(next); setBuffer(data); setCount(doc.getPageCount());
      onNotify('success', `Loaded ${doc.getPageCount()} pages.`);
    } catch (error) { onNotify('error', error instanceof Error ? error.message : 'Could not open this PDF.'); }
  };

  const parsePages = (total: number) => {
    if (scope === 'all') return Array.from({ length: total }, (_, i) => i);
    if (scope === 'odd') return Array.from({ length: total }, (_, i) => i).filter((i) => (i + 1) % 2 === 1);
    if (scope === 'even') return Array.from({ length: total }, (_, i) => i).filter((i) => (i + 1) % 2 === 0);
    const selected = new Set<number>();
    custom.split(',').map((part) => part.trim()).filter(Boolean).forEach((part) => {
      const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match) return;
      const first = Number(match[1]); const last = Number(match[2] || match[1]);
      for (let page = Math.min(first, last); page <= Math.max(first, last); page++) if (page >= 1 && page <= total) selected.add(page - 1);
    });
    return [...selected].sort((a, b) => a - b);
  };

  const rotate = async () => {
    if (!buffer || !file) return;
    setBusy(true); setProgress(8);
    try {
      const doc = await PDFDocument.load(buffer, { ignoreEncryption: true, throwOnInvalidObject: false });
      const targets = parsePages(doc.getPageCount());
      if (!targets.length) { onNotify('error', 'No valid pages selected. Check your page numbers.'); return; }
      const pages = doc.getPages();
      targets.forEach((index, i) => {
        const page = pages[index];
        page.setRotation(degrees((page.getRotation().angle + angle) % 360));
        if (i % 10 === 0) setProgress(Math.min(85, 10 + Math.round((i / targets.length) * 75)));
      });
      const bytes = await doc.save({ useObjectStreams: true });
      setProgress(100);
      downloadPdfBytes(bytes, file.name.replace(/\.pdf$/i, '') + '-rotated.pdf');
      onNotify('success', `Rotated ${targets.length} of ${pages.length} pages.`);
    } catch (error) { onNotify('error', error instanceof Error ? error.message : 'PDF rotation failed.'); }
    finally { setBusy(false); }
  };

  return <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_300px]">
    <div className="space-y-4">
      <DropZone accept="application/pdf,.pdf" onFiles={load} title="Choose a PDF to rotate" subtitle="Rotate pages without converting them to images — text and vectors stay sharp." compact={!!file}/>
      {file && <div className="flex items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-900/40 p-4">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-cyan-500/15 text-cyan-300"><FileText size={21}/></div>
        <div className="min-w-0 flex-1"><b className="block truncate text-sm text-slate-100">{file.name}</b><span className="text-xs text-slate-400">{count} pages · {formatFileSize(file.size)}</span></div>
        <CheckCircle2 className="text-emerald-400" size={19}/>
      </div>}
      {busy && <ProgressBar progress={progress} label="Rotating selected PDF pages…"/>}
    </div>
    <aside className="h-fit space-y-4 rounded-xl border border-slate-700/60 bg-slate-900/50 p-5">
      <h3 className="text-sm font-bold text-slate-100">Rotation settings</h3>
      <div><label className="mb-2 block text-xs text-slate-300">Rotate by</label><div className="grid grid-cols-3 gap-2">
        {([90,180,270] as const).map((value)=><button key={value} type="button" onClick={()=>setAngle(value)} className={`rounded-lg border py-2 text-xs font-bold ${angle===value?'border-cyan-400 bg-cyan-500/20 text-cyan-200':'border-slate-700 text-slate-300'}`}>{value}°</button>)}
      </div></div>
      <div><label className="mb-2 block text-xs text-slate-300">Apply to</label><select value={scope} onChange={e=>setScope(e.target.value as typeof scope)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100">
        <option value="all">All pages</option><option value="odd">Odd pages</option><option value="even">Even pages</option><option value="custom">Custom page numbers</option>
      </select></div>
      {scope==='custom' && <div><label className="mb-1 block text-xs text-slate-300">Pages (e.g. 1, 3-5)</label><input value={custom} onChange={e=>setCustom(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100"/></div>}
      <button type="button" disabled={!file||busy} onClick={rotate} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 px-4 py-3 text-xs font-extrabold text-white shadow-lg shadow-cyan-950/30 disabled:opacity-40"><RotateCw size={16}/> Rotate & download</button>
      <p className="text-[10px] leading-relaxed text-slate-400">The original file stays unchanged. Rotation is applied to page instructions, preserving searchable text and vector quality.</p>
    </aside>
  </div>;
};
