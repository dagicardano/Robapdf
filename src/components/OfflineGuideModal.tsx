import React, { useState } from 'react';
import { ShieldCheck, X, HardDrive, Cpu, Download } from 'lucide-react';
import { downloadOfflineZipPackage } from '../lib/offlinePackage';

interface OfflineGuideModalProps {
  open: boolean;
  onClose: () => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

const VENDORED_ASSETS = [
  { name: 'pdf-lib', role: 'PDF creation, merging, splitting, annotation & scaling', location: 'Bundled locally' },
  { name: 'pdfjs-dist', role: 'Canvas rendering & page previews', location: './libs/pdf.worker.min.mjs' },
  { name: 'jszip', role: 'PPTX archive extraction & multi-PDF zip export', location: 'Bundled locally' },
  { name: 'mammoth', role: 'DOCX to HTML + embedded image conversion', location: 'Bundled locally' },
  { name: 'tesseract.js + WASM', role: 'Offline optical character recognition (OCR)', location: './libs/tesseract/' },
  { name: 'eng.traineddata.gz', role: 'English OCR trained model (10.9 MB)', location: './libs/tesseract/lang/' },
  { name: 'Fontsource (Sans & Mono)', role: 'Local typography without external CDNs', location: 'Bundled locally' },
];

export const OfflineGuideModal: React.FC<OfflineGuideModalProps> = ({ open, onClose, onNotify }) => {
  const [downloading, setDownloading] = useState(false);

  if (!open) return null;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadOfflineZipPackage(onNotify);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Offline Architecture & Local Libraries"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                100% Offline Architecture
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Zero external network calls, zero CDNs, zero telemetry.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                <HardDrive className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                Local Memory Processing
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                All uploaded PDFs, Office files, images, and camera frames stay inside browser RAM and Canvas buffers.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                <Cpu className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                Vendored WASM & Workers
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                PDF.js workers and Tesseract OCR WASM binaries load strictly from the local <code className="font-mono">./libs/</code> directory.
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                <tr>
                  <th className="px-3 py-2 font-semibold">Library</th>
                  <th className="px-3 py-2 font-semibold">Capability</th>
                  <th className="px-3 py-2 font-semibold">Local Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {VENDORED_ASSETS.map((item) => (
                  <tr key={item.name} className="text-slate-700 dark:text-slate-300">
                    <td className="px-3 py-2 font-mono font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {item.name}
                    </td>
                    <td className="px-3 py-2">{item.role}</td>
                    <td className="px-3 py-2 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {item.location}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            disabled={downloading}
            onClick={handleDownload}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{downloading ? 'Packaging Offline .zip...' : 'Download Offline .zip (index.html inside)'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
