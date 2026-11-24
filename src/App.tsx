/**
 * OfflinePDF Studio — 100% Offline Client-Side PDF Workstation
 *
 * Local Vendoring Architecture:
 * - Zero external CDN links, zero remote APIs, zero telemetry.
 * - PDF creation/manipulation: pdf-lib (bundled)
 * - PDF rendering/thumbnails: pdfjs-dist + ./libs/pdf.worker.min.mjs
 * - Archive & PPTX parsing: jszip + XML DOMParser (bundled)
 * - DOCX conversion: mammoth (bundled)
 * - Offline OCR: tesseract.js + ./libs/tesseract/{worker.min.js, tesseract-core*.wasm, lang/eng.traineddata.gz}
 * - Fonts: @fontsource/plus-jakarta-sans & @fontsource/jetbrains-mono (bundled)
 */

import React, { useEffect, useState } from 'react';
import {
  Camera,
  Download,
  FileEdit,
  FilePlus2,
  FileText,
  FileType,
  Image as ImageIcon,
  Layers,
  Maximize2,
  Menu,
  Moon,
  Presentation,
  Scissors,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import { OfflineGuideModal } from './components/OfflineGuideModal';
import { ToastContainer, ToastItem } from './components/ToastContainer';
import { downloadOfflineZipPackage } from './lib/offlinePackage';
import { DocxToPdf } from './tools/DocxToPdf';
import { DocumentScanner } from './tools/DocumentScanner';
import { ImageToPdf } from './tools/ImageToPdf';
import { PageResizer } from './tools/PageResizer';
import { PdfCreator } from './tools/PdfCreator';
import { PdfEditor } from './tools/PdfEditor';
import { PdfMerger } from './tools/PdfMerger';
import { PdfSplitter } from './tools/PdfSplitter';
import { PptToPdf } from './tools/PptToPdf';
import { TxtToPdf } from './tools/TxtToPdf';

type ToolId =
  | 'creator'
  | 'merger'
  | 'splitter'
  | 'editor'
  | 'img2pdf'
  | 'ppt2pdf'
  | 'txt2pdf'
  | 'docx2pdf'
  | 'resizer'
  | 'scanner';

interface ToolDefinition {
  id: ToolId;
  label: string;
  group: 'Create & Convert' | 'Organize & Edit' | 'Capture & Scan';
  description: string;
  icon: React.ElementType;
}

const TOOLS: ToolDefinition[] = [
  {
    id: 'creator',
    label: 'PDF Creator',
    group: 'Create & Convert',
    description: 'Compose formatted documents with headings, colors, margins, and custom page sizes.',
    icon: FilePlus2,
  },
  {
    id: 'img2pdf',
    label: 'Image → PDF',
    group: 'Create & Convert',
    description: 'Convert JPG, PNG, WEBP, GIF, and BMP images into a multi-page PDF.',
    icon: ImageIcon,
  },
  {
    id: 'docx2pdf',
    label: 'Word (.docx) → PDF',
    group: 'Create & Convert',
    description: 'Convert Word documents locally with headings, lists, tables, and images intact.',
    icon: FileText,
  },
  {
    id: 'ppt2pdf',
    label: 'PPT (.pptx) → PDF',
    group: 'Create & Convert',
    description: 'Parse PowerPoint slides client-side and export formatted slide decks to PDF.',
    icon: Presentation,
  },
  {
    id: 'txt2pdf',
    label: 'TXT → PDF',
    group: 'Create & Convert',
    description: 'Convert plain text files with custom typography, word wrap, margins, and pagination.',
    icon: FileType,
  },
  {
    id: 'merger',
    label: 'PDF Merger',
    group: 'Organize & Edit',
    description: 'Combine multiple PDFs and reorder entire files or individual pages.',
    icon: Layers,
  },
  {
    id: 'splitter',
    label: 'PDF Splitter',
    group: 'Organize & Edit',
    description: 'Split PDFs by page selection, custom ranges, or fixed N-page intervals.',
    icon: Scissors,
  },
  {
    id: 'editor',
    label: 'PDF Editor',
    group: 'Organize & Edit',
    description: 'Annotate pages with text, images, highlights, freehand ink, signatures, and rotations.',
    icon: FileEdit,
  },
  {
    id: 'resizer',
    label: 'Page Resizer',
    group: 'Organize & Edit',
    description: 'Scale PDF pages from 50% to 200% or re-center onto standard paper presets.',
    icon: Maximize2,
  },
  {
    id: 'scanner',
    label: 'Document Scanner',
    group: 'Capture & Scan',
    description: 'Scan from camera or photos with edge detection, perspective crop, filters, and offline OCR.',
    icon: Camera,
  },
];

const GROUPS: ToolDefinition['group'][] = ['Create & Convert', 'Organize & Edit', 'Capture & Scan'];

export default function App() {
  const [activeTool, setActiveTool] = useState<ToolId>('creator');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('offlinepdf_theme') === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
    try {
      localStorage.setItem('offlinepdf_theme', darkMode ? 'dark' : 'light');
    } catch {
      // Ignore storage restriction
    }
  }, [darkMode]);

  const notify = (type: ToastItem['type'], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  const currentTool = TOOLS.find((t) => t.id === activeTool) || TOOLS[0];

  const renderTool = () => {
    switch (activeTool) {
      case 'creator':
        return <PdfCreator onNotify={notify} />;
      case 'merger':
        return <PdfMerger onNotify={notify} />;
      case 'splitter':
        return <PdfSplitter onNotify={notify} />;
      case 'editor':
        return <PdfEditor onNotify={notify} />;
      case 'img2pdf':
        return <ImageToPdf onNotify={notify} />;
      case 'ppt2pdf':
        return <PptToPdf onNotify={notify} />;
      case 'txt2pdf':
        return <TxtToPdf onNotify={notify} />;
      case 'docx2pdf':
        return <DocxToPdf onNotify={notify} />;
      case 'resizer':
        return <PageResizer onNotify={notify} />;
      case 'scanner':
        return <DocumentScanner onNotify={notify} />;
    }
  };

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between">
      <div>
        {/* Brand Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
            OfflinePDF Studio
          </span>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation"
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation Groups */}
        <nav className="space-y-5 px-3 py-4">
          {GROUPS.map((group) => (
            <div key={group}>
              <p className="px-2.5 pb-1.5 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                {group}
              </p>
              <div className="space-y-0.5">
                {TOOLS.filter((t) => t.group === group).map((tool) => {
                  const Icon = tool.icon;
                  const isActive = tool.id === activeTool;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      onClick={() => {
                        setActiveTool(tool.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors whitespace-nowrap ${
                        isActive
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/80'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{tool.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* Bottom Offline Architecture & Theme Controls */}
      <div className="space-y-2 border-t border-slate-200 p-3 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setGuideOpen(true)}
          className="flex w-full items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-left text-xs font-medium text-emerald-800 hover:bg-emerald-100/70 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/70 transition-colors"
        >
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="leading-tight">100% Offline — No data leaves your device</span>
        </button>

        <button
          type="button"
          disabled={downloadingZip}
          onClick={async () => {
            setDownloadingZip(true);
            try {
              await downloadOfflineZipPackage(notify);
            } finally {
              setDownloadingZip(false);
            }
          }}
          className="flex w-full items-center justify-between rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
        >
          <span>{downloadingZip ? 'Packaging .zip...' : 'Download Offline .zip'}</span>
          <Download className="h-3.5 w-3.5 shrink-0" />
        </button>

        <button
          type="button"
          onClick={() => setDarkMode((d) => !d)}
          className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/80"
        >
          <span>{darkMode ? 'Light Mode' : 'Dark Mode'}</span>
          {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="hidden w-[256px] shrink-0 border-r border-slate-200 bg-white lg:block dark:border-slate-800 dark:bg-slate-900">
        <div className="sticky top-0 h-screen overflow-y-auto">{sidebarContent}</div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="fixed inset-0 bg-slate-950/50" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative z-10 w-64 bg-white dark:bg-slate-900">{sidebarContent}</aside>
        </div>
      )}

      {/* Main Workspace */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 py-3.5 backdrop-blur sm:px-6 dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open tool navigation"
              className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50 lg:hidden dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold text-slate-900 sm:text-lg dark:text-slate-100">
                {currentTool.label}
              </h1>
              <p className="hidden truncate text-xs text-slate-500 sm:block dark:text-slate-400">
                {currentTool.description}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="hidden items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 sm:flex dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/70 whitespace-nowrap"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>100% Offline — No data leaves your device</span>
            </button>

            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label="Toggle dark mode"
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1320px] flex-1 p-4 sm:p-6">{renderTool()}</main>
      </div>

      <OfflineGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} onNotify={notify} />
      <ToastContainer
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
    </div>
  );
}
