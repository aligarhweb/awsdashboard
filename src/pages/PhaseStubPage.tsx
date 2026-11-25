import { ArrowRight } from 'lucide-react';

interface PhaseStubPageProps {
  title: string;
  phase: number;
  description: string;
  items: string[];
  onBackToDashboard: () => void;
}

export function PhaseStubPage({
  title,
  phase,
  description,
  items,
  onBackToDashboard,
}: PhaseStubPageProps) {
  return (
    <div className="max-w-2xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{title}</h1>
        <span className="font-mono text-xs text-sky-600 dark:text-sky-400">
          Scheduled · Phase {phase}
        </span>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{description}</p>
      <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400 list-disc pl-5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <div className="pt-2">
        <button
          type="button"
          onClick={onBackToDashboard}
          className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700"
        >
          Return to Dashboard
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
