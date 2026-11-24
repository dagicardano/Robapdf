import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Camera, Clock3, CloudOff, Download, FileEdit, FileImage, FilePlus2,
  FileText, FileType, History, Layers, Maximize2, Menu, Moon, Presentation,
  Scissors, Search, ShieldCheck, Sparkles, Sun, Trash2, Upload, X, LayoutGrid
} from 'lucide-react';
import { OfflineGuideModal } from './components/OfflineGuideModal';
import { ToastContainer, ToastItem } from './components/ToastContainer';
import { downloadOfflineZipPackage } from './lib/offlinePackage';
import { getWorkHistory, clearWorkHistory, WorkHistoryEntry } from './lib/workHistory';
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

type ToolId = 'creator' | 'merger' | 'splitter' | 'editor' | 'img2pdf' | 'ppt2pdf' | 'txt2pdf' | 'docx2pdf' | 'resizer' | 'scanner';
type Group = 'Create & Convert' | 'Organize & Edit' | 'Capture & Scan';
interface ToolDefinition { id: ToolId; label: string; group: Group; description: string; icon: React.ElementType; accent: string; }
const TOOLS: ToolDefinition[] = [
  { id:'creator', label:'PDF Creator', group:'Create & Convert', description:'Build polished PDFs from formatted text and pages.', icon:FilePlus2, accent:'violet' },
  { id:'img2pdf', label:'Images to PDF', group:'Create & Convert', description:'Turn photos and images into a multi-page PDF.', icon:FileImage, accent:'pink' },
  { id:'docx2pdf', label:'Word to PDF', group:'Create & Convert', description:'Convert DOCX files locally on your device.', icon:FileText, accent:'blue' },
  { id:'ppt2pdf', label:'PowerPoint to PDF', group:'Create & Convert', description:'Convert PPTX slides into PDF pages.', icon:Presentation, accent:'orange' },
  { id:'txt2pdf', label:'Text to PDF', group:'Create & Convert', description:'Create clean PDFs from TXT documents.', icon:FileType, accent:'cyan' },
  { id:'merger', label:'Merge PDFs', group:'Organize & Edit', description:'Combine documents and arrange their pages.', icon:Layers, accent:'indigo' },
  { id:'splitter', label:'Split PDF', group:'Organize & Edit', description:'Extract pages or split by page ranges.', icon:Scissors, accent:'amber' },
  { id:'editor', label:'PDF Editor', group:'Organize & Edit', description:'Add text, drawings, highlights and signatures.', icon:FileEdit, accent:'emerald' },
  { id:'resizer', label:'Page Resizer', group:'Organize & Edit', description:'Resize pages and fit standard paper sizes.', icon:Maximize2, accent:'purple' },
  { id:'scanner', label:'Document Scanner', group:'Capture & Scan', description:'Scan with camera or import a photo; OCR runs offline.', icon:Camera, accent:'rose' },
];
const GROUPS: Group[] = ['Create & Convert','Organize & Edit','Capture & Scan'];
const ACCENT: Record<string,string> = {
  violet:'tool-violet',pink:'tool-pink',blue:'tool-blue',orange:'tool-orange',cyan:'tool-cyan',
  indigo:'tool-indigo',amber:'tool-amber',emerald:'tool-emerald',purple:'tool-purple',rose:'tool-rose'
};

export default function App() {
  const [activeTool,setActiveTool] = useState<ToolId|null>(null);
  const [page,setPage] = useState<'home'|'history'>('home');
  const [menuOpen,setMenuOpen] = useState(false);
  const [guideOpen,setGuideOpen] = useState(false);
  const [downloadingZip,setDownloadingZip] = useState(false);
  const [search,setSearch] = useState('');
  const [history,setHistory] = useState<WorkHistoryEntry[]>(()=>getWorkHistory());
  const [toasts,setToasts] = useState<ToastItem[]>([]);
  const [darkMode,setDarkMode] = useState<boolean>(()=>{ try{return localStorage.getItem('ropdf_theme')==='dark';}catch{return false;} });

  useEffect(()=>{ const root=document.documentElement; root.classList.toggle('dark',darkMode); try{localStorage.setItem('ropdf_theme',darkMode?'dark':'light');}catch{} },[darkMode]);
  useEffect(()=>{ const refresh=()=>setHistory(getWorkHistory()); window.addEventListener('ropdf-history',refresh); window.addEventListener('storage',refresh); return()=>{window.removeEventListener('ropdf-history',refresh);window.removeEventListener('storage',refresh);}; },[]);
  const notify=(type:ToastItem['type'],message:string)=>{const id=`${Date.now()}-${Math.random().toString(36).slice(2,7)}`;setToasts(prev=>[...prev.slice(-3),{id,type,message}]);window.setTimeout(()=>setToasts(prev=>prev.filter(t=>t.id!==id)),4200);};
  const filteredTools=useMemo(()=>TOOLS.filter(t=>`${t.label} ${t.description}`.toLowerCase().includes(search.toLowerCase())),[search]);
  const currentTool=TOOLS.find(t=>t.id===activeTool);
  const renderTool=()=>{if(!activeTool)return null; switch(activeTool){
    case'creator':return <PdfCreator onNotify={notify}/>;case'merger':return <PdfMerger onNotify={notify}/>;
    case'splitter':return <PdfSplitter onNotify={notify}/>;case'editor':return <PdfEditor onNotify={notify}/>;
    case'img2pdf':return <ImageToPdf onNotify={notify}/>;case'ppt2pdf':return <PptToPdf onNotify={notify}/>;
    case'txt2pdf':return <TxtToPdf onNotify={notify}/>;case'docx2pdf':return <DocxToPdf onNotify={notify}/>;
    case'resizer':return <PageResizer onNotify={notify}/>;case'scanner':return <DocumentScanner onNotify={notify}/>;
  }};
  const openTool=(id:ToolId)=>{setActiveTool(id);setPage('home');setMenuOpen(false);window.scrollTo({top:0,behavior:'smooth'});};
  const grouped=(group:Group)=>filteredTools.filter(t=>t.group===group);
  return <div className="ropdf-shell">
    <header className="ropdf-header">
      <div className="brand-lockup">
        <div className="brand-mark"><FileText size={22}/><span>R</span></div>
        <div><div className="brand-name">RoPDF</div><div className="brand-tagline">Your private PDF workspace</div></div>
      </div>
      <div className="header-actions">
        <span className="offline-pill"><CloudOff size={14}/> Works offline</span>
        <button className="icon-button" onClick={()=>setDarkMode(v=>!v)} aria-label="Toggle theme">{darkMode?<Sun size={18}/>:<Moon size={18}/>}</button>
        <button className="icon-button mobile-menu-button" onClick={()=>setMenuOpen(v=>!v)} aria-label="Open menu">{menuOpen?<X size={19}/>:<Menu size={19}/>}</button>
      </div>
    </header>

    <div className="ropdf-layout">
      <aside className={`ropdf-sidebar ${menuOpen?'sidebar-open':''}`}>
        <button className={`nav-link ${page==='home'?'nav-active':''}`} onClick={()=>{setPage('home');setActiveTool(null);setMenuOpen(false);}}><LayoutGrid size={18}/>All tools</button>
        <button className={`nav-link ${page==='history'?'nav-active':''}`} onClick={()=>{setPage('history');setActiveTool(null);setHistory(getWorkHistory());setMenuOpen(false);}}><History size={18}/>Work history <span className="nav-count">{history.length}</span></button>
        <div className="sidebar-divider"/>
        <div className="sidebar-label">TOOLS</div>
        {GROUPS.map(group=><section className="sidebar-group" key={group}><div className="sidebar-group-title">{group}</div>{TOOLS.filter(t=>t.group===group).map(t=>{const Icon=t.icon;return <button key={t.id} className={`nav-link nav-tool ${activeTool===t.id?'nav-active':''}`} onClick={()=>openTool(t.id)}><Icon size={17}/><span>{t.label}</span></button>;})}</section>)}
        <div className="sidebar-bottom">
          <div className="privacy-note"><ShieldCheck size={17}/><span><b>Private by design</b><small>Files stay on your device.</small></span></div>
          <button className="sidebar-download" disabled={downloadingZip} onClick={async()=>{setDownloadingZip(true);try{await downloadOfflineZipPackage(notify);}finally{setDownloadingZip(false);}}}><Download size={16}/>{downloadingZip?'Preparing package…':'Get offline web package'}</button>
          <button className="sidebar-help" onClick={()=>setGuideOpen(true)}>How offline mode works</button>
        </div>
      </aside>

      <main className="ropdf-main">
        {page==='history'?<section className="page-section">
          <div className="page-heading-row"><div><div className="eyebrow">YOUR ACTIVITY</div><h1>Work history</h1><p className="page-subtitle">A private list of files created on this device.</p></div><button className="secondary-button" disabled={!history.length} onClick={()=>{clearWorkHistory();setHistory([]);}}><Trash2 size={16}/>Clear history</button></div>
          {history.length===0?<div className="empty-state"><div className="empty-icon"><History size={30}/></div><h2>No activity yet</h2><p>Your exported PDFs will appear here automatically.</p><button className="primary-button" onClick={()=>{setPage('home');setActiveTool(null);}}>Explore tools</button></div>:
          <div className="history-list">{history.map(item=><div className="history-row" key={item.id}><div className="history-file-icon"><FileText size={20}/></div><div className="history-file-info"><b>{item.fileName}</b><span>{item.tool} · {new Date(item.createdAt).toLocaleString()}</span></div><div className="history-size">{item.sizeLabel}</div><span className="history-status">Saved</span></div>)}</div>}
          <p className="history-footnote"><ShieldCheck size={14}/> History is stored locally on this device. Clearing app data removes it.</p>
        </section>:activeTool&&currentTool?<section className="page-section tool-page">
          <button className="back-link" onClick={()=>setActiveTool(null)}><ArrowLeft size={17}/>Back to all tools</button>
          <div className="tool-page-heading"><div className={`tool-icon-large ${ACCENT[currentTool.accent]}`}>{React.createElement(currentTool.icon,{size:24})}</div><div><div className="eyebrow">{currentTool.group}</div><h1>{currentTool.label}</h1><p className="page-subtitle">{currentTool.description}</p></div></div>
          <div className="tool-workspace">{renderTool()}</div>
        </section>:<section className="page-section">
          <div className="hero-panel"><div className="hero-copy"><div className="hero-kicker"><Sparkles size={15}/> SIMPLE · PRIVATE · OFFLINE</div><h1>Everything you need<br/>to work with PDFs.</h1><p>Create, convert, organize and scan documents in one clean workspace. Your files are processed on your device.</p><div className="hero-actions"><button className="primary-button" onClick={()=>openTool('creator')}><FilePlus2 size={17}/>Create a PDF</button><button className="hero-secondary" onClick={()=>{setPage('history');setHistory(getWorkHistory());}}><Clock3 size={17}/>View history</button></div></div><div className="hero-art"><div className="hero-document"><div className="doc-ribbon">PDF</div><div className="doc-line wide"/><div className="doc-line"/><div className="doc-line short"/><div className="doc-chart"><i/><i/><i/><i/><i/></div><div className="doc-line wide"/><div className="doc-line short"/></div><div className="floating-bubble bubble-one"><ShieldCheck size={18}/></div><div className="floating-bubble bubble-two"><Download size={18}/></div></div></div>
          <div className="section-title-row"><div><div className="eyebrow">WORKSPACE</div><h2>Choose a tool</h2></div><div className="tool-search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find a tool…"/></div></div>
          {GROUPS.map(group=><div className="tool-group" key={group}><h3>{group}</h3><div className="tool-grid">{grouped(group).map(tool=>{const Icon=tool.icon;return <button className="tool-card" key={tool.id} onClick={()=>openTool(tool.id)}><div className={`tool-icon ${ACCENT[tool.accent]}`}><Icon size={21}/></div><div className="tool-card-copy"><b>{tool.label}</b><span>{tool.description}</span></div><span className="tool-arrow">›</span></button>;})}</div></div>)}
          <div className="feature-strip"><div className="feature-item"><ShieldCheck size={19}/><span><b>On-device processing</b><small>No cloud upload required</small></span></div><div className="feature-item"><CloudOff size={19}/><span><b>Offline-ready</b><small>Core tools work without internet</small></span></div><div className="feature-item"><History size={19}/><span><b>Work history</b><small>Keep track of exports</small></span></div></div>
        </section>}
      </main>
    </div>
    <OfflineGuideModal open={guideOpen} onClose={()=>setGuideOpen(false)} onNotify={notify}/>
    <ToastContainer toasts={toasts} onDismiss={id=>setToasts(prev=>prev.filter(t=>t.id!==id))}/>
  </div>;
}
