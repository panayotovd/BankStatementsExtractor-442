import React, { useState, useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Upload, 
  FileText, 
  Download, 
  Loader2, 
  AlertCircle, 
  CheckCircle2,
  Table as TableIcon,
  Trash2,
  Plus,
  PieChart as PieChartIcon,
  Wallet
} from 'lucide-react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip, 
  Legend 
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { extractTransactions, type Transaction } from './services/gemini';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface FileItem {
  file: File;
  status: 'idle' | 'processing' | 'completed' | 'error';
  id: string;
}

export default function App() {
  const [fileItems, setFileItems] = useState<FileItem[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const processingSessionRef = useRef<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const newItems: FileItem[] = acceptedFiles.map(file => ({
        file,
        status: 'idle',
        id: Math.random().toString(36).substring(7)
      }));
      setFileItems(prev => [...prev, ...newItems]);
      setError(null);
      setSuccess(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg']
    },
    multiple: true
  } as any);

  const handleProcess = async () => {
    if (fileItems.length === 0) return;

    setIsLoading(true);
    setError(null);
    setSuccess(false);
    
    const sessionId = Math.random().toString(36).substring(7);
    processingSessionRef.current = sessionId;

    try {
      let allTransactions: Transaction[] = [];
      
      for (let i = 0; i < fileItems.length; i++) {
        // Check if session was cancelled
        if (processingSessionRef.current !== sessionId) break;

        const item = fileItems[i];
        if (item.status === 'completed') continue;

        // Update status to processing
        if (processingSessionRef.current === sessionId) {
          setFileItems(prev => prev.map((fi, idx) => idx === i ? { ...fi, status: 'processing' } : fi));
        }
        
        try {
          const reader = new FileReader();
          const base64Promise = new Promise<string>((resolve) => {
            reader.onload = () => {
              const base64 = (reader.result as string).split(',')[1];
              resolve(base64);
            };
          });
          reader.readAsDataURL(item.file);
          const base64 = await base64Promise;

          // Check again after async file read
          if (processingSessionRef.current !== sessionId) break;

          const results = await extractTransactions(base64, item.file.type);
          
          // Check again after async API call
          if (processingSessionRef.current !== sessionId) break;

          allTransactions = [...allTransactions, ...results];
          
          // Update status to completed
          if (processingSessionRef.current === sessionId) {
            setFileItems(prev => prev.map((fi, idx) => idx === i ? { ...fi, status: 'completed' } : fi));
          }
        } catch (err) {
          console.error(`Error processing file ${item.file.name}:`, err);
          if (processingSessionRef.current === sessionId) {
            setFileItems(prev => prev.map((fi, idx) => idx === i ? { ...fi, status: 'error' } : fi));
          }
        }
      }

      // Only update state if session wasn't cancelled
      if (processingSessionRef.current === sessionId) {
        // Sort by date descending
        allTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        
        setTransactions(prev => {
          const combined = [...prev, ...allTransactions];
          // Deduplicate or just sort
          return combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        });
        setSuccess(true);
      }
    } catch (err) {
      console.error(err);
      setError('An unexpected error occurred during processing.');
    } finally {
      setIsLoading(false);
    }
  };

  const removeFile = (id: string) => {
    setFileItems(prev => prev.filter(item => item.id !== id));
  };

  const downloadCSV = () => {
    if (transactions.length === 0) return;

    const headers = ['Date', 'Description', 'Amount', 'Category', 'Notes'];
    const csvContent = [
      headers.join(','),
      ...transactions.map(t => [
        t.date,
        `"${t.description.replace(/"/g, '""')}"`,
        t.amount,
        `"${t.category}"`,
        `"${t.notes.replace(/"/g, '""')}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `bank_statement_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const clearAll = () => {
    processingSessionRef.current = null;
    setFileItems([]);
    setTransactions([]);
    setError(null);
    setSuccess(false);
    setIsLoading(false);
  };

  const totalIncome = transactions.reduce((acc, t) => t.amount > 0 ? acc + t.amount : acc, 0);
  const totalSpending = transactions.reduce((acc, t) => t.amount < 0 ? acc + Math.abs(t.amount) : acc, 0);
  const netBalance = totalIncome - totalSpending;

  const categorySpending = transactions
    .filter(t => t.amount < 0)
    .reduce((acc, t) => {
      const category = t.category || 'Other';
      acc[category] = (acc[category] || 0) + Math.abs(t.amount);
      return acc;
    }, {} as Record<string, number>);

  const categoryData = Object.entries(categorySpending)
    .map(([name, value]) => ({ name, value: value as number }))
    .sort((a, b) => b.value - a.value);

  const COLORS = ['#141414', '#4B4B4B', '#7A7A7A', '#A9A9A9', '#D8D8D8', '#F5F5F4'];

  const stats = {
    total: fileItems.length,
    completed: fileItems.filter(f => f.status === 'completed').length,
    processing: fileItems.filter(f => f.status === 'processing').length,
    pending: fileItems.filter(f => f.status === 'idle').length,
    error: fileItems.filter(f => f.status === 'error').length,
  };

  return (
    <div className="min-h-screen bg-[#F5F5F4] text-[#141414] font-sans selection:bg-[#141414] selection:text-white">
      {/* Header */}
      <header className="border-b border-[#141414]/10 bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#141414] rounded-lg flex items-center justify-center">
              <TableIcon className="w-5 h-5 text-white" />
            </div>
            <h1 className="font-semibold text-lg tracking-tight">Statement OCR</h1>
          </div>
          <div className="flex items-center gap-4">
            {transactions.length > 0 && (
              <button
                onClick={downloadCSV}
                className="flex items-center gap-2 px-4 py-2 bg-[#141414] text-white rounded-full text-sm font-medium hover:bg-[#141414]/90 transition-all active:scale-95"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Left Column: Upload & Controls */}
          <div className="lg:col-span-4 space-y-8">
            <section className="space-y-4">
              <h2 className="text-2xl font-serif italic text-[#141414]/80">Upload Statements</h2>
              <p className="text-sm text-[#141414]/60 leading-relaxed">
                Upload multiple bank statements (PDF or Image). Gemini AI will analyze the entire set and aggregate all transactions.
              </p>
            </section>

            <div
              {...getRootProps()}
              className={cn(
                "border-2 border-dashed rounded-3xl p-12 transition-all cursor-pointer flex flex-col items-center justify-center text-center gap-4",
                isDragActive ? "border-[#141414] bg-[#141414]/5" : "border-[#141414]/20 hover:border-[#141414]/40 hover:bg-white"
              )}
            >
              <input {...getInputProps()} />
              <div className="w-16 h-16 bg-[#141414]/5 rounded-2xl flex items-center justify-center">
                <Upload className="w-8 h-8 text-[#141414]/40" />
              </div>
              <div>
                <p className="font-medium text-[#141414]">Drop your statements here</p>
                <p className="text-xs text-[#141414]/40 mt-1">PDF, PNG, or JPG up to 10MB each</p>
              </div>
            </div>

            {/* Progress Summary */}
            {isLoading && (
              <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-mono uppercase tracking-widest text-[#141414]/40">Processing Progress</p>
                  <Loader2 className="w-4 h-4 animate-spin text-[#141414]/40" />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <p className="text-xl font-serif italic">{stats.total}</p>
                    <p className="text-[9px] font-mono uppercase tracking-widest text-[#141414]/40">Total</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-serif italic text-emerald-600">{stats.completed}</p>
                    <p className="text-[9px] font-mono uppercase tracking-widest text-[#141414]/40">Done</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-serif italic text-amber-600">{stats.pending}</p>
                    <p className="text-[9px] font-mono uppercase tracking-widest text-[#141414]/40">Left</p>
                  </div>
                </div>
                <div className="w-full bg-[#141414]/5 h-1 rounded-full overflow-hidden">
                  <div 
                    className="bg-[#141414] h-full transition-all duration-500" 
                    style={{ width: `${(stats.completed / stats.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* File List */}
            {fileItems.length > 0 && (
              <div className="space-y-3">
                <p className="text-[11px] font-mono uppercase tracking-widest text-[#141414]/40">Selected Files ({fileItems.length})</p>
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                  {fileItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-3 bg-white rounded-xl border border-[#141414]/5 group">
                      <div className="flex items-center gap-3 overflow-hidden">
                        {item.status === 'processing' ? (
                          <Loader2 className="w-4 h-4 text-[#141414] animate-spin shrink-0" />
                        ) : item.status === 'completed' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        ) : item.status === 'error' ? (
                          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                        ) : (
                          <FileText className="w-4 h-4 text-[#141414]/40 shrink-0" />
                        )}
                        <span className={cn(
                          "text-sm font-medium truncate",
                          item.status === 'completed' && "text-[#141414]/40"
                        )}>
                          {item.file.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {item.status === 'idle' && !isLoading && (
                          <button 
                            onClick={(e) => { e.stopPropagation(); removeFile(item.id); }}
                            className="p-1 hover:bg-red-50 hover:text-red-500 rounded-md transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        {item.status === 'completed' && (
                          <span className="text-[9px] font-mono uppercase tracking-widest text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                            Extracted
                          </span>
                        )}
                        {item.status === 'processing' && (
                          <span className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                            </span>
                            Processing
                          </span>
                        )}
                        {item.status === 'error' && (
                          <span className="text-[9px] font-mono uppercase tracking-widest text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                            Failed
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3">
              <button
                onClick={handleProcess}
                disabled={fileItems.length === 0 || isLoading || stats.pending === 0}
                className={cn(
                  "w-full py-4 rounded-2xl font-semibold transition-all flex items-center justify-center gap-2",
                  fileItems.length === 0 || isLoading || stats.pending === 0
                    ? "bg-[#141414]/10 text-[#141414]/40 cursor-not-allowed" 
                    : "bg-[#141414] text-white hover:shadow-lg active:scale-[0.98]"
                )}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Processing...
                  </>
                ) : stats.pending === 0 && stats.total > 0 ? (
                  <>
                    <CheckCircle2 className="w-5 h-5" />
                    All Files Processed
                  </>
                ) : (
                  <>
                    <Plus className="w-5 h-5" />
                    {stats.completed > 0 ? 'Analyze Remaining' : 'Analyze All Files'}
                  </>
                )}
              </button>

              {fileItems.length > 0 && (
                <button
                  onClick={clearAll}
                  className="w-full py-4 rounded-2xl font-medium text-[#141414]/60 hover:text-[#141414] hover:bg-[#141414]/5 transition-all flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Clear All
                </button>
              )}
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex gap-3 items-start">
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>

          {/* Right Column: Results & Summary */}
          <div className="lg:col-span-8 space-y-8">
            {/* Summary Section */}
            {transactions.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm">
                  <p className="text-[11px] font-mono uppercase tracking-widest text-[#141414]/40 mb-2">Total Records</p>
                  <div className="flex items-end justify-between">
                    <p className="text-3xl font-serif italic">{transactions.length}</p>
                    <div className="w-10 h-10 bg-[#141414]/5 rounded-xl flex items-center justify-center">
                      <FileText className="w-5 h-5 text-[#141414]/40" />
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm">
                  <p className="text-[11px] font-mono uppercase tracking-widest text-[#141414]/40 mb-2">Total Income</p>
                  <div className="flex items-end justify-between">
                    <p className="text-3xl font-serif italic text-emerald-600">
                      ${totalIncome.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                    <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm">
                  <p className="text-[11px] font-mono uppercase tracking-widest text-[#141414]/40 mb-2">Total Spending</p>
                  <div className="flex items-end justify-between">
                    <p className="text-3xl font-serif italic text-red-600">
                      ${totalSpending.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                    <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center">
                      <AlertCircle className="w-5 h-5 text-red-500" />
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm">
                  <p className="text-[11px] font-mono uppercase tracking-widest text-[#141414]/40 mb-2">Net Balance</p>
                  <div className="flex items-end justify-between">
                    <p className={cn(
                      "text-3xl font-serif italic",
                      netBalance >= 0 ? "text-emerald-600" : "text-red-600"
                    )}>
                      {netBalance >= 0 ? '+' : '-'}${Math.abs(netBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center",
                      netBalance >= 0 ? "bg-emerald-50" : "bg-red-50"
                    )}>
                      <Wallet className={cn(
                        "w-5 h-5",
                        netBalance >= 0 ? "text-emerald-500" : "text-red-500"
                      )} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {transactions.length > 0 && (
              <div className="bg-white p-8 rounded-[32px] border border-[#141414]/10 shadow-sm">
                <div className="flex items-center gap-3 mb-8">
                  <div className="w-10 h-10 bg-[#141414]/5 rounded-xl flex items-center justify-center">
                    <PieChartIcon className="w-5 h-5 text-[#141414]/40" />
                  </div>
                  <h3 className="font-serif italic text-xl">Spending by Category</h3>
                </div>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {categoryData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="none" />
                        ))}
                      </Pie>
                      <Tooltip 
                        formatter={(value: number) => `$${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                        contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      />
                      <Legend verticalAlign="middle" align="right" layout="vertical" />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <div className="bg-white rounded-[32px] border border-[#141414]/10 overflow-hidden shadow-sm min-h-[400px] flex flex-col">
              <div className="p-8 border-b border-[#141414]/5 flex items-center justify-between">
                <h3 className="font-serif italic text-xl">Transaction Data</h3>
                {transactions.length > 0 && (
                  <div className="flex items-center gap-3">
                    <span className={cn(
                      "text-xs font-mono font-bold px-3 py-1 rounded-full",
                      netBalance >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                    )}>
                      Net: {netBalance >= 0 ? '+' : '-'}${Math.abs(netBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-auto">
                {transactions.length > 0 ? (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#141414]/5">
                        <th className="px-6 py-4 text-[11px] font-mono uppercase tracking-widest text-[#141414]/40">Date</th>
                        <th className="px-6 py-4 text-[11px] font-mono uppercase tracking-widest text-[#141414]/40">Description</th>
                        <th className="px-6 py-4 text-[11px] font-mono uppercase tracking-widest text-[#141414]/40">Category</th>
                        <th className="px-6 py-4 text-[11px] font-mono uppercase tracking-widest text-[#141414]/40 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#141414]/5">
                      {transactions.map((t, i) => (
                        <tr key={i} className="group hover:bg-[#F5F5F4]/50 transition-colors">
                          <td className="px-6 py-4 text-sm font-mono text-[#141414]/60">{t.date}</td>
                          <td className="px-6 py-4">
                            <p className="text-sm font-medium text-[#141414]">{t.description}</p>
                            {t.notes && <p className="text-xs text-[#141414]/40 mt-0.5">{t.notes}</p>}
                          </td>
                          <td className="px-6 py-4">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-[#141414]/5 text-[#141414]/60">
                              {t.category}
                            </span>
                          </td>
                          <td className={cn(
                            "px-6 py-4 text-sm font-mono text-right font-medium",
                            t.amount < 0 ? "text-red-600" : "text-emerald-600"
                          )}>
                            {t.amount < 0 ? '-' : '+'}${Math.abs(t.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-12 space-y-4">
                    <div className="w-20 h-20 bg-[#F5F5F4] rounded-full flex items-center justify-center">
                      <TableIcon className="w-10 h-10 text-[#141414]/10" />
                    </div>
                    <div className="space-y-2">
                      <p className="font-medium text-[#141414]/40">No data extracted yet</p>
                      <p className="text-sm text-[#141414]/20 max-w-xs mx-auto">
                        Upload a bank statement and click extract to see your transactions here.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-[#141414]/5">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <p className="text-xs font-mono text-[#141414]/30 uppercase tracking-widest">
            Powered by Gemini 3 Flash Vision
          </p>
          <div className="flex gap-8">
            <a href="#" className="text-xs font-mono text-[#141414]/30 uppercase tracking-widest hover:text-[#141414] transition-colors">Privacy</a>
            <a href="#" className="text-xs font-mono text-[#141414]/30 uppercase tracking-widest hover:text-[#141414] transition-colors">Terms</a>
            <a href="#" className="text-xs font-mono text-[#141414]/30 uppercase tracking-widest hover:text-[#141414] transition-colors">Help</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
