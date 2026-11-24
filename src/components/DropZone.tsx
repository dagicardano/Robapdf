import React, { useRef, useState } from 'react';
import { Upload } from 'lucide-react';

interface DropZoneProps {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  title: string;
  subtitle: string;
  compact?: boolean;
}

export const DropZone: React.FC<DropZoneProps> = ({
  accept,
  multiple = false,
  onFiles,
  title,
  subtitle,
  compact = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    onFiles(Array.from(fileList));
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={`group flex flex-col items-center justify-center rounded-xl border border-dashed text-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
        compact ? 'px-4 py-5' : 'px-6 py-10'
      } ${
        dragging
          ? 'border-blue-600 bg-blue-50/70 dark:border-blue-400 dark:bg-blue-950/30'
          : 'border-slate-300 bg-white hover:border-blue-500 hover:bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-500 dark:hover:bg-slate-800/70'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 group-hover:border-blue-200 group-hover:bg-blue-50 group-hover:text-blue-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:group-hover:border-blue-800 dark:group-hover:bg-blue-950/50 dark:group-hover:text-blue-400 transition-colors">
        <Upload className="h-5 w-5" />
      </div>
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
    </div>
  );
};
