import React from 'react';

interface ProgressBarProps {
  progress: number;
  label?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ progress, label }) => {
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  return (
    <div className="w-full rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300">
        <span className="truncate">{label || 'Processing locally...'}</span>
        <span className="font-mono-tabular ml-2 shrink-0 text-slate-500 dark:text-slate-400">
          {clamped}%
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className="h-full bg-blue-600 transition-[width] duration-150 ease-out dark:bg-blue-500"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
};
