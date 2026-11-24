export interface WorkHistoryEntry {
  id: string;
  fileName: string;
  tool: string;
  sizeLabel: string;
  createdAt: number;
}
const KEY = 'ropdf_work_history';
function toolFromName(name: string): string {
  const n=name.toLowerCase();
  if(n.includes('merged')) return 'PDF Merger';
  if(n.includes('split')) return 'PDF Splitter';
  if(n.includes('scan')) return 'Document Scanner';
  if(n.includes('image')) return 'Image to PDF';
  if(n.includes('word')) return 'Word to PDF';
  if(n.includes('presentation')) return 'PowerPoint to PDF';
  if(n.includes('text')) return 'Text to PDF';
  if(n.includes('edited')) return 'PDF Editor';
  return 'PDF export';
}
export function getWorkHistory(): WorkHistoryEntry[] {
  try { const parsed=JSON.parse(localStorage.getItem(KEY)||'[]'); return Array.isArray(parsed)?parsed:[]; } catch { return []; }
}
export function recordWorkHistory(fileName: string, bytes: number): void {
  try {
    const sizeLabel=bytes<1024?bytes+' B':bytes<1048576?(bytes/1024).toFixed(1)+' KB':(bytes/1048576).toFixed(2)+' MB';
    const entry:WorkHistoryEntry={id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,fileName,tool:toolFromName(fileName),sizeLabel,createdAt:Date.now()};
    localStorage.setItem(KEY,JSON.stringify([entry,...getWorkHistory()].slice(0,100)));
    window.dispatchEvent(new Event('ropdf-history'));
  } catch { /* Private browsing or storage quota: export must still succeed. */ }
}
export function clearWorkHistory(): void {
  try { localStorage.removeItem(KEY); } catch {}
  window.dispatchEvent(new Event('ropdf-history'));
}
