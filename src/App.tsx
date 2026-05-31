import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import logoImg from './assets/images/anna_yael_logo_1780130406427.png';
import {
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileText,
  Flame,
  Download,
  RefreshCw,
  Video,
  RotateCcw,
  Scissors,
  PenTool,
  LogOut,
} from 'lucide-react';
import { runViralExtractionPipeline } from './utils/pipeline';
import { generateHtmlReport } from './utils/reportGenerator';
import { PipelineStep, PipelineResult, RecoveryData, CachedReport, StepIntermediateData } from './types';
import { STORAGE_KEYS, CACHE_TTL_MS, DEFAULT_PODCAST_NAME, INITIAL_STEPS, URL_PLACEHOLDERS } from './constants';
import { imageToBase64, downloadBlob, formatHebrewDate } from './utils/helpers';
import { TranscriptModal } from './components/TranscriptModal';
import { PipelineProgress } from './components/PipelineProgress';
import { ViralCutCard } from './components/ViralCutCard';
import { ContentGenerator } from './components/ContentGenerator';
import { LoginPage } from './components/LoginPage';

type AppTab = 'podcast2reels' | 'content-generator';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => localStorage.getItem('cp_auth') === 'true');
  const [appTab, setAppTab] = useState<AppTab>('podcast2reels');

  // Input fields
  const [activeTab, setActiveTab] = useState<'youtube' | 'drive' | 'transcript'>('youtube');
  const [url, setUrl] = useState('');
  const [pastedTranscript, setPastedTranscript] = useState('');
  const [podcastName, setPodcastName] = useState(DEFAULT_PODCAST_NAME);
  const [episodeName, setEpisodeName] = useState('');
  const [isTranscriptModalOpen, setIsTranscriptModalOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showSuccessFlash, setShowSuccessFlash] = useState(false);

  // Refs
  const resultsRef = useRef<HTMLDivElement>(null);

  const handleLogout = () => {
    localStorage.removeItem('cp_auth');
    setIsAuthenticated(false);
  };

  // UI state
  const [errorMessage, setErrorMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentResult, setCurrentResult] = useState<PipelineResult | null>(null);

  // Recovery & Caching states
  const [recoveryData, setRecoveryData] = useState<RecoveryData>({});
  const [showResumeBanner, setShowResumeBanner] = useState(false);
  const [cachedReportForUrl, setCachedReportForUrl] = useState<CachedReport | null>(null);

  // Pipeline state
  const [steps, setSteps] = useState<PipelineStep[]>(() => INITIAL_STEPS.map(s => ({ ...s })));
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);

  // Ref for current steps to avoid stale closures
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  // Update a single step status — uses functional updates to avoid stale closures
  const updateStep = useCallback((
    stepId: number,
    state: PipelineStep['state'],
    details?: string,
    intermediateData?: StepIntermediateData
  ) => {
    let updatedSteps: PipelineStep[] = [];
    let updatedLogs: string[] = [];

    setSteps(prev => {
      const next = prev.map(step =>
        step.id === stepId ? { ...step, state, details } : step
      );
      updatedSteps = next;
      return next;
    });

    setConsoleLogs(prev => {
      if (details) {
        const next = [...prev, `[Step ${stepId}] ${details}`];
        updatedLogs = next;
        return next;
      }
      updatedLogs = prev;
      return prev;
    });

    setRecoveryData(prev => {
      const next = { ...prev };
      if (state === 'done' && intermediateData) {
        if (stepId === 1) {
          next.transcript = intermediateData.transcript;
        } else if (stepId === 2) {
          next.rawCuts = intermediateData.rawCuts;
        } else if (stepId === 3) {
          next.validatedCuts = intermediateData.validatedCuts;
        }
        if (intermediateData.podcastName) next.podcastName = intermediateData.podcastName;
        if (intermediateData.episodeName) next.episodeName = intermediateData.episodeName;
      }

      const completedStepsCount = updatedSteps.filter(s => s.state === 'done').length;

      localStorage.setItem(STORAGE_KEYS.RECOVERY_PAYLOAD, JSON.stringify({
        url, activeTab, steps: updatedSteps,
        consoleLogs: updatedLogs,
        recoveryData: next, completedStepsCount, timestamp: Date.now()
      }));

      return next;
    });
  }, [url, activeTab]);

  // Load recovery state on mount
  useEffect(() => {
    const recoveryString = localStorage.getItem(STORAGE_KEYS.RECOVERY_PAYLOAD);
    if (recoveryString) {
      try {
        const payload = JSON.parse(recoveryString);
        if (payload?.url) {
          setUrl(payload.url);
          if (payload.activeTab) setActiveTab(payload.activeTab);
          if (payload.steps) setSteps(payload.steps);
          if (payload.consoleLogs) setConsoleLogs(payload.consoleLogs);
          if (payload.recoveryData) setRecoveryData(payload.recoveryData);
          if (payload.currentResult) {
            setCurrentResult(payload.currentResult);
            if (payload.currentResult.podcastName) setPodcastName(payload.currentResult.podcastName);
            if (payload.currentResult.episodeName) setEpisodeName(payload.currentResult.episodeName);
          }
          if (!payload.currentResult && payload.completedStepsCount > 0) {
            setShowResumeBanner(true);
          }
        }
      } catch (e) {
        console.warn('Failed to parse recovery payload on mount', e);
      }
    }
  }, []);

  // Check URL cache for a computed report
  useEffect(() => {
    if (!url) { setCachedReportForUrl(null); return; }
    const cached = localStorage.getItem(`${STORAGE_KEYS.REPORT_CACHE_PREFIX}${url}`);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp <= CACHE_TTL_MS) {
          setCachedReportForUrl(parsed);
        } else {
          localStorage.removeItem(`${STORAGE_KEYS.REPORT_CACHE_PREFIX}${url}`);
          setCachedReportForUrl(null);
        }
      } catch { setCachedReportForUrl(null); }
    } else {
      setCachedReportForUrl(null);
    }
  }, [url]);

  // Cleanup expired cache on mount
  useEffect(() => {
    try {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith(STORAGE_KEYS.REPORT_CACHE_PREFIX)) {
          const cached = localStorage.getItem(key);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (Date.now() - parsed.timestamp > CACHE_TTL_MS) localStorage.removeItem(key);
          }
        }
      });
    } catch (e) { console.warn('Failed to clean up old report cache', e); }
  }, []);

  // Cache HTML report
  const cacheHtmlReport = useCallback(async (result: PipelineResult) => {
    try {
      const logoBase64 = await imageToBase64(logoImg);
      const formattedDate = formatHebrewDate();
      const reportHtml = generateHtmlReport(
        result.cuts, result.sourceUrl, result.sourcePlatform,
        formattedDate, logoBase64,
        result.podcastName || podcastName, result.episodeName || episodeName
      );
      const cacheObject: CachedReport & { url: string } = {
        html: reportHtml, result, timestamp: Date.now(),
        url: result.sourceUrl, platform: result.sourcePlatform,
        title: result.cuts[0]?.title || 'דו"ח קטעים ויראליים',
        dateString: formattedDate,
        transcript: recoveryData.transcript
      };
      localStorage.setItem(`${STORAGE_KEYS.REPORT_CACHE_PREFIX}${result.sourceUrl}`, JSON.stringify(cacheObject));
    } catch (e) { console.warn('Failed to cache HTML report', e); }
  }, [podcastName, episodeName, recoveryData.transcript]);

  // Start pipeline
  const handleStartPipeline = useCallback(async (isResume = false) => {
    setErrorMessage('');

    if (activeTab === 'transcript') {
      if (!pastedTranscript.trim()) {
        setErrorMessage('אנא הדביקו תמלול לפני ההפעלה.');
        return;
      }
    } else {
      if (!url.trim()) {
        setErrorMessage('אנא הזינו קישור תחילה.');
        return;
      }
    }

    if (!isResume) {
      setCurrentResult(null);
      setConsoleLogs(['Starting extraction pipeline...', `Source URL: ${url}`]);
      setRecoveryData({});
      setSteps(INITIAL_STEPS.map(s => ({ ...s })));
    } else {
      setConsoleLogs(prev => [...prev, '🔄 Resuming pipeline from last successful step...']);
    }

    setIsProcessing(true);

    try {
      const completedStepsCount = stepsRef.current.filter(s => s.state === 'done').length;
      const result = await runViralExtractionPipeline(
        activeTab === 'transcript' ? '' : url,
        updateStep,
        isResume ? { ...recoveryData, completedStepsCount } : 
        activeTab === 'transcript' ? { transcript: pastedTranscript, completedStepsCount: 1 } : undefined
      );

      const extractedPodcast = result.podcastName || DEFAULT_PODCAST_NAME;
      const extractedEpisode = result.episodeName || '';
      setPodcastName(extractedPodcast);
      setEpisodeName(extractedEpisode);

      const enrichedResult: PipelineResult = { ...result, podcastName: extractedPodcast, episodeName: extractedEpisode };
      setCurrentResult(enrichedResult);
      setShowSuccessFlash(true);
      setTimeout(() => {
        setShowSuccessFlash(false);
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 800);
      setConsoleLogs(prev => [...prev, '✓ Pipeline completed successfully.']);
      localStorage.removeItem(STORAGE_KEYS.RECOVERY_PAYLOAD);
      await cacheHtmlReport(enrichedResult);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred during extraction.';
      setErrorMessage(message);
      setConsoleLogs(prev => [...prev, `❌ Error: ${message}`]);
    } finally {
      setIsProcessing(false);
    }
  }, [url, recoveryData, updateStep, cacheHtmlReport, activeTab, pastedTranscript]);

  const handleResume = useCallback(() => {
    setShowResumeBanner(false);
    handleStartPipeline(true);
  }, [handleStartPipeline]);

  const handleDiscardRecovery = useCallback(() => {
    setShowResumeBanner(false);
    localStorage.removeItem(STORAGE_KEYS.RECOVERY_PAYLOAD);
    setRecoveryData({});
    setSteps(INITIAL_STEPS.map(s => ({ ...s })));
    setConsoleLogs([]);
  }, []);

  const triggerDownloadReport = useCallback(async () => {
    if (!currentResult || isDownloading) return;
    setIsDownloading(true);
    try {
      const logoBase64 = await imageToBase64(logoImg);
      const formattedDate = formatHebrewDate();
      const reportHtml = generateHtmlReport(
        currentResult.cuts, currentResult.sourceUrl, currentResult.sourcePlatform,
        formattedDate, logoBase64,
        currentResult.podcastName || podcastName, currentResult.episodeName || episodeName
      );
      const filename = `viral_cuts_report_${currentResult.sourcePlatform.toLowerCase().replace(' ', '_')}.html`;
      downloadBlob(reportHtml, filename);
    } finally {
      setIsDownloading(false);
    }
  }, [currentResult, podcastName, episodeName, isDownloading]);

  const handleLoadCachedResult = useCallback(() => {
    if (!cachedReportForUrl) return;
    setCurrentResult(cachedReportForUrl.result);
    if (cachedReportForUrl.result.podcastName) setPodcastName(cachedReportForUrl.result.podcastName);
    if (cachedReportForUrl.result.episodeName) setEpisodeName(cachedReportForUrl.result.episodeName);
    if (cachedReportForUrl.transcript) setRecoveryData(prev => ({ ...prev, transcript: cachedReportForUrl.transcript }));
    setConsoleLogs(['שוחזר דו"ח מוכן מהמטמון המקומי של הדפדפן.']);
  }, [cachedReportForUrl]);

  const handleDownloadCachedReport = useCallback(() => {
    if (!cachedReportForUrl) return;
    const filename = `viral_cuts_report_${cachedReportForUrl.platform.toLowerCase().replace(' ', '_')}.html`;
    downloadBlob(cachedReportForUrl.html, filename);
  }, [cachedReportForUrl]);

  const handleNewExtraction = useCallback(() => {
    setCurrentResult(null);
    setUrl('');
    setPastedTranscript('');
    setRecoveryData({});
    setSteps(INITIAL_STEPS.map(s => ({ ...s })));
    setConsoleLogs([]);
    setErrorMessage('');
  }, []);

  // Derived state
  const allDone = currentResult !== null;
  const hasError = steps.some(s => s.state === 'error');

  const headerDots = useMemo(() => {
    return steps.map((step, idx) => {
      let dotClass = 'bg-cp-line';
      if (allDone) {
        dotClass = 'bg-cp-sage';
      } else if (hasError) {
        const errorIdx = steps.findIndex(s => s.state === 'error');
        if (idx < errorIdx) dotClass = 'bg-cp-sage';
        else if (idx === errorIdx) dotClass = 'bg-cp-clay';
      } else if (isProcessing) {
        const activeIdx = steps.findIndex(s => s.state === 'active');
        if (idx < activeIdx) dotClass = 'bg-cp-sage';
        else if (idx === activeIdx) dotClass = 'bg-cp-sage animate-pulse';
      }
      return { id: step.id, name: step.name, dotClass };
    });
  }, [steps, allDone, hasError, isProcessing]);

  if (!isAuthenticated) {
    return <LoginPage onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="min-h-screen bg-cp-cream text-cp-ink flex flex-col selection:bg-cp-clay selection:text-white font-sans">
      {/* Top accent bar */}
      <div className="h-1.5 bg-gradient-to-r from-cp-clay via-cp-ochre to-cp-sage" />

      {/* Header */}
      <header className="border-b border-cp-line bg-cp-cream/90 backdrop-blur sticky top-0 z-50 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img
                src={logoImg}
                alt="Connection Point Logo"
                className="w-10 h-10 rounded-full border border-cp-line object-cover shadow-md"
                referrerPolicy="no-referrer"
              />
              <div>
                <h1 className="text-2xl font-serif font-semibold text-cp-clay tracking-tight">Connection Point</h1>
                <p className="text-[10px] text-cp-ink-3 uppercase tracking-widest">
                  אנה ויעל <span className="text-cp-line mx-1">|</span> נקודת חיבור
                </p>
              </div>
            </div>

            {appTab === 'podcast2reels' && (
              <div className="flex flex-col items-end">
                <span className="text-[10px] text-cp-ink-3 uppercase tracking-wider">סטטוס</span>
                <div className="flex space-x-2 mt-1" role="group" aria-label="Pipeline progress indicators">
                  {headerDots.map(dot => (
                    <div key={dot.id} title={dot.name} className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${dot.dotClass}`} />
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleLogout}
              className="p-2 rounded-full hover:bg-cp-sand border border-transparent hover:border-cp-line transition cursor-pointer"
              title="התנתק"
              aria-label="Logout"
            >
              <LogOut className="w-4 h-4 text-cp-ink-3" />
            </button>
          </div>

          {/* Capability Tabs */}
          <nav className="flex border-t border-cp-line/50 pt-2 -mb-3" role="tablist" aria-label="App capabilities">
            <button
              role="tab"
              aria-selected={appTab === 'podcast2reels'}
              onClick={() => setAppTab('podcast2reels')}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-t-lg transition cursor-pointer border-b-2 ${
                appTab === 'podcast2reels'
                  ? 'border-cp-clay text-cp-clay bg-cp-paper'
                  : 'border-transparent text-cp-ink-3 hover:text-cp-ink-2'
              }`}
            >
              <Scissors className="w-3.5 h-3.5" />
              <span>Podcast 2 Reels</span>
              <span className="text-[9px] opacity-60">| חילוץ קטעים</span>
            </button>
            <button
              role="tab"
              aria-selected={appTab === 'content-generator'}
              onClick={() => setAppTab('content-generator')}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-t-lg transition cursor-pointer border-b-2 ${
                appTab === 'content-generator'
                  ? 'border-cp-clay text-cp-clay bg-cp-paper'
                  : 'border-transparent text-cp-ink-3 hover:text-cp-ink-2'
              }`}
            >
              <PenTool className="w-3.5 h-3.5" />
              <span>Content Generator</span>
              <span className="text-[9px] opacity-60">| יצירת תוכן</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-grow max-w-6xl w-full mx-auto px-4 py-8 flex flex-col gap-8">
        {/* Content Generator Tab — always mounted, hidden when inactive */}
        <div className={appTab === 'content-generator' ? '' : 'hidden'}>
          <ContentGenerator />
        </div>

        {/* Podcast 2 Reels Tab — always mounted, hidden when inactive */}
        <div className={appTab === 'podcast2reels' ? '' : 'hidden'}>
        {/* Resume Banner */}
        {showResumeBanner && (
          <div className="bg-cp-sage/10 border border-cp-sage/30 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4" dir="rtl">
            <div className="flex items-start gap-4">
              <RefreshCw className="w-6 h-6 text-cp-sage shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <strong className="block text-sm font-bold text-cp-ink">זוהה תהליך קודם שלא הושלם</strong>
                <span className="text-xs text-cp-ink-2 mt-1 block leading-relaxed">
                  באפשרותך להמשיך מהשלב האחרון שהושלם בהצלחה מבלי להתחיל מחדש.
                </span>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={handleDiscardRecovery} className="px-4 py-2 text-xs border border-cp-line hover:bg-cp-bone text-cp-ink-2 rounded-full transition font-semibold cursor-pointer">
                התחל מחדש
              </button>
              <button onClick={handleResume} className="px-5 py-2 text-xs bg-cp-sage hover:bg-cp-sage-deep text-white rounded-full transition font-bold shadow-sm cursor-pointer">
                המשך ({steps.filter(s => s.state === 'done').length} שלבים הושלמו)
              </button>
            </div>
          </div>
        )}

        {/* Intro */}
        <div className="text-center max-w-2xl mx-auto mb-2">
          <h2 className="text-3xl sm:text-4xl font-serif text-cp-ink font-bold tracking-tight mb-2">
            Podcast 2 Reels
          </h2>
        </div>

        {/* Workspace Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
          {/* Left Panel: Config & Input */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            <div className="bg-cp-paper border border-cp-line rounded-2xl p-6 shadow-sm flex flex-col gap-5">
              <h3 className="text-lg font-bold text-cp-ink font-serif flex items-center gap-2">
                <Video className="w-5 h-5 text-cp-clay" />
                <span>הגדרות מקור ומדיה</span>
              </h3>

              {/* Platform Tabs */}
              <div>
                <label className="text-[10px] uppercase text-cp-ink-3 ml-1 block mb-2 font-semibold tracking-wider">בחירת מקור</label>
                <div className="flex p-1 bg-cp-sand rounded-lg border border-cp-line" role="tablist" aria-label="Source selection">
                  {(['youtube', 'drive', 'transcript'] as const).map(tab => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      id={`tab-${tab}`}
                      aria-selected={activeTab === tab}
                      aria-controls="input-panel"
                      onClick={() => { if (activeTab !== tab) { setActiveTab(tab); setUrl(''); } }}
                      className={`flex-1 py-1.5 text-xs font-medium rounded transition cursor-pointer ${
                        activeTab === tab
                          ? 'bg-cp-paper text-cp-clay border border-cp-line font-bold shadow-sm'
                          : 'text-cp-ink-2 hover:text-cp-ink'
                      }`}
                    >
                      {tab === 'youtube' ? 'YouTube' : tab === 'drive' ? 'Google Drive' : 'תמלול'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Input Panel */}
              <div className="flex flex-col gap-1.5" id="input-panel" role="tabpanel" aria-labelledby={`tab-${activeTab}`}>
                {activeTab === 'transcript' ? (
                  <>
                    <div className="flex items-center justify-between">
                      <label htmlFor="transcript-input" className="text-[10px] uppercase text-cp-ink-3 ml-1 font-semibold tracking-wider">הדביקו תמלול</label>
                      {pastedTranscript && (
                        <button onClick={() => setPastedTranscript('')} className="text-[10px] text-cp-ink-3 hover:text-cp-clay transition cursor-pointer">נקה</button>
                      )}
                    </div>
                    <textarea
                      id="transcript-input"
                      value={pastedTranscript}
                      onChange={(e) => setPastedTranscript(e.target.value)}
                      placeholder="הדביקו כאן את תמלול הפודקאסט..."
                      rows={6}
                      className="w-full bg-cp-bone border border-cp-line rounded-lg px-3 py-2 text-sm text-cp-ink focus:outline-none focus:border-cp-clay placeholder:text-cp-ink-3/65 font-medium transition resize-y min-h-[120px]"
                      dir="rtl"
                    />
                    <p className="text-[10px] text-cp-ink-3">{pastedTranscript.length > 0 ? `${pastedTranscript.split(/\s+/).length} מילים` : ''}</p>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <label htmlFor="url-input" className="text-[10px] uppercase text-cp-ink-3 ml-1 font-semibold tracking-wider">קישור (url)</label>
                      {url && (
                        <button onClick={() => setUrl('')} className="text-[10px] text-cp-ink-3 hover:text-cp-clay transition cursor-pointer">נקה</button>
                      )}
                    </div>
                    <input
                      id="url-input"
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder={URL_PLACEHOLDERS[activeTab]}
                      className="w-full bg-cp-bone border border-cp-line rounded-lg px-3 py-2 text-sm text-cp-ink focus:outline-none focus:border-cp-clay placeholder:text-cp-ink-3/65 font-medium transition"
                    />
                  </>
                )}
              </div>

              {/* Cached report notice */}
              {cachedReportForUrl && !currentResult && !isProcessing && (
                <div className="bg-cp-sage/10 border border-cp-sage/25 p-4 rounded-xl flex flex-col gap-3 text-xs text-cp-ink" dir="rtl">
                  <div className="flex gap-2 items-start">
                    <CheckCircle2 className="w-4 h-4 text-cp-sage mt-0.5 shrink-0" />
                    <div>
                      <strong className="font-semibold block text-cp-sage-deep">נמצא דו"ח שמור במטמון (תקף ל-48 שעות)</strong>
                      <span className="text-cp-ink-2 block mt-0.5 leading-relaxed">
                        נשמר ב: {new Date(cachedReportForUrl.timestamp).toLocaleDateString('he-IL', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}.
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={handleLoadCachedResult} className="bg-cp-sage text-white font-bold py-1.5 px-4 rounded-full transition text-[11px] hover:bg-cp-sage-deep cursor-pointer">
                      טען תוצאות למסך
                    </button>
                    <button type="button" onClick={handleDownloadCachedReport} className="bg-transparent border border-cp-sage text-cp-sage-deep font-bold py-1.5 px-4 rounded-full transition text-[11px] hover:bg-cp-sage/10 cursor-pointer">
                      הורד קובץ HTML ישירות
                    </button>
                  </div>
                </div>
              )}

              {/* Extract Button */}
              <button
                type="button"
                onClick={() => handleStartPipeline(false)}
                disabled={isProcessing}
                className="w-full bg-cp-clay hover:bg-cp-clay-deep text-white font-semibold py-3 px-4 rounded-full transition-all flex items-center justify-center space-x-2 text-sm disabled:opacity-50 cursor-pointer shadow-md hover:shadow-lg active:scale-98"
              >
                {isProcessing ? (
                  <><Loader2 className="w-5 h-5 animate-spin text-white" /><span>מחלץ קטעים...</span></>
                ) : (
                  <><Sparkles className="w-5 h-5 text-cp-cream" /><span>חלץ קטעים ויראליים</span></>
                )}
              </button>

              {/* Error */}
              <div aria-live="assertive" aria-atomic="true">
                {errorMessage && (
                  <div className="bg-cp-rose/10 border border-cp-rose/25 p-4 rounded-xl flex gap-3 text-sm text-cp-clay items-start" role="alert">
                    <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                    <div>
                      <strong className="block font-semibold">שגיאה</strong>
                      <span className="text-xs text-cp-ink-2 mt-1 block leading-relaxed">{errorMessage}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Panel: Progress & Results */}
          <div className="lg:col-span-3 flex flex-col gap-6">
            {/* Pipeline Progress */}
            {(isProcessing || consoleLogs.length > 0) && (
              <PipelineProgress steps={steps} consoleLogs={consoleLogs} isProcessing={isProcessing} />
            )}

            {/* Results */}
            {currentResult && (
              <div className="flex flex-col gap-6" ref={resultsRef}>
                {/* Success flash */}
                {showSuccessFlash && (
                  <div className="bg-cp-sage/20 border border-cp-sage/40 rounded-2xl p-6 flex items-center justify-center gap-3 animate-pulse">
                    <CheckCircle2 className="w-8 h-8 text-cp-sage" />
                    <span className="text-lg font-serif font-bold text-cp-sage-deep">הושלם בהצלחה!</span>
                  </div>
                )}

                {/* Result Header */}
                <div className="bg-cp-paper border border-cp-line rounded-2xl p-6 shadow-sm flex flex-col gap-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-bold text-cp-ink font-serif flex items-center gap-2">
                        <Flame className="w-5 h-5 text-cp-ochre" />
                        <span>הופקו בהצלחה {currentResult.cuts.length} קטעים ויראליים!</span>
                      </h3>
                      <p className="text-xs text-cp-ink-2 mt-1 max-w-md">
                        הקטעים עברו סינון, נרמול ודירוג. מוכנים לפרסום ברשתות החברתיות.
                      </p>
                    </div>
                    <div className="shrink-0 flex gap-2">
                      <button
                        onClick={() => setIsTranscriptModalOpen(true)}
                        disabled={!recoveryData.transcript}
                        title="צפה בתמלול"
                        className="inline-flex items-center gap-2 bg-cp-bone hover:bg-cp-sand border border-cp-line text-cp-ink font-semibold px-4 py-2 rounded-full transition shadow-sm text-xs tracking-wider uppercase cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <FileText className="w-4 h-4" /><span>תמלול</span>
                      </button>
                    </div>
                  </div>
                  {/* Source breadcrumb */}
                  <div className="flex items-center gap-2 text-[11px] text-cp-ink-3 bg-cp-sand/40 px-3 py-1.5 rounded-lg border border-cp-line/50" dir="ltr">
                    <span className="font-semibold text-cp-ink-2">{currentResult.sourcePlatform}</span>
                    <span className="text-cp-line">→</span>
                    <span className="truncate max-w-[300px]">{currentResult.sourceUrl}</span>
                  </div>
                </div>

                {/* Cut Cards */}
                <div className="space-y-6">
                  {currentResult.cuts.map((cut, idx) => (
                    <ViralCutCard key={cut.id || idx} cut={cut} index={idx} />
                  ))}
                </div>

                {/* Actions */}
                <div className="mt-4 flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={triggerDownloadReport}
                    disabled={isDownloading}
                    className="flex-1 py-3.5 bg-cp-clay hover:bg-cp-clay-deep text-white font-bold uppercase tracking-widest text-xs rounded-full flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" />
                    <span>{isDownloading ? 'מוריד...' : 'הורד דו"ח HTML'}</span>
                  </button>
                  <button
                    onClick={handleNewExtraction}
                    className="flex-1 py-3.5 border-2 border-cp-line bg-transparent hover:bg-cp-sand text-cp-ink-2 hover:text-cp-ink font-bold uppercase tracking-widest text-xs rounded-full flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>חלץ קישור חדש</span>
                  </button>
                </div>
              </div>
            )}

            {/* Empty State */}
            {!isProcessing && !currentResult && (
              <div className="bg-cp-paper rounded-2xl border-2 border-cp-line border-dashed py-12 px-6 text-center shadow-inner flex flex-col items-center justify-center min-h-[350px]">
                <div className="w-12 h-12 rounded-full bg-cp-sand flex items-center justify-center border border-cp-line text-cp-ink-3 mb-4">
                  <Flame className="w-5 h-5 text-cp-clay" />
                </div>
                <h3 className="text-lg font-bold text-cp-ink font-serif">איך זה עובד?</h3>
                <div className="mt-4 flex flex-col gap-3 text-right max-w-sm mx-auto" dir="rtl">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-cp-clay text-white text-xs font-bold flex items-center justify-center shrink-0">1</span>
                    <span className="text-xs text-cp-ink-2">הדביקו קישור לפרק פודקאסט (YouTube / Spotify / Drive)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-cp-clay text-white text-xs font-bold flex items-center justify-center shrink-0">2</span>
                    <span className="text-xs text-cp-ink-2">לחצו "חלץ קטעים ויראליים" והמתינו ~1-2 דקות</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-cp-clay text-white text-xs font-bold flex items-center justify-center shrink-0">3</span>
                    <span className="text-xs text-cp-ink-2">קבלו 4 קטעים מדורגים מוכנים לפרסום ברילס</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        </div>
      </main>

      {/* Transcript Modal */}
      {isTranscriptModalOpen && recoveryData.transcript && (
        <TranscriptModal
          transcript={recoveryData.transcript}
          onClose={() => setIsTranscriptModalOpen(false)}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-cp-line bg-cp-sand/50 py-6 text-center text-xs text-cp-ink-3 mt-auto px-4">
        <div className="max-w-6xl mx-auto">
          <p>אנה ויעל | נקודת חיבור</p>
        </div>
      </footer>

    </div>
  );
}
