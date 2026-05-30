import { useState, useEffect } from 'react';
// @ts-expect-error - Vite handles PNG asset imports dynamically
import logoImg from './assets/images/anna_yael_logo_1780130406427.png';
import { 
  Scissors, 
  Sparkles, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Loader2, 
  Play, 
  Lock, 
  Shield, 
  Info, 
  FileText, 
  Flame, 
  Download, 
  ExternalLink,
  Laptop,
  Heart,
  HelpCircle,
  Eye,
  EyeOff,
  RefreshCw,
  Video,
  Music,
  FolderDot,
  X,
  Key
} from 'lucide-react';
import { runViralExtractionPipeline } from './utils/pipeline';
import { generateHtmlReport } from './utils/reportGenerator';
import { PipelineStep, ViralCut, PipelineResult } from './types';

export default function App() {
  // Input fields
  const [activeTab, setActiveTab] = useState<'youtube' | 'spotify' | 'drive'>('youtube');
  const [url, setUrl] = useState('');
  const [podcastName, setPodcastName] = useState('אנה ויעל | נקודת חיבור');
  const [episodeName, setEpisodeName] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [saveKeysLocal, setSaveKeysLocal] = useState(false);
  const [isKeysModalOpen, setIsKeysModalOpen] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [showGroqKey, setShowGroqKey] = useState(false);

  // Load keys from localStorage on mount if saved
  useEffect(() => {
    const savedGroq = localStorage.getItem('vce_groq_key');
    const savedAnthropic = localStorage.getItem('vce_anthropic_key');
    const savedOpenai = localStorage.getItem('vce_openai_key');
    if (savedGroq || savedAnthropic || savedOpenai) {
      if (savedGroq) setGroqKey(savedGroq);
      if (savedAnthropic) setAnthropicKey(savedAnthropic);
      if (savedOpenai) setOpenaiKey(savedOpenai);
      setSaveKeysLocal(true);
    }
  }, []);

  // Save/Unsave keys when state or values change
  const handleSaveKeysToggle = (checked: boolean) => {
    setSaveKeysLocal(checked);
    if (checked) {
      if (groqKey) localStorage.setItem('vce_groq_key', groqKey);
      if (anthropicKey) localStorage.setItem('vce_anthropic_key', anthropicKey);
      if (openaiKey) localStorage.setItem('vce_openai_key', openaiKey);
    } else {
      localStorage.removeItem('vce_groq_key');
      localStorage.removeItem('vce_anthropic_key');
      localStorage.removeItem('vce_openai_key');
    }
  };

  // Sync keys if saved
  useEffect(() => {
    if (saveKeysLocal) {
      if (groqKey) localStorage.setItem('vce_groq_key', groqKey);
      if (anthropicKey) localStorage.setItem('vce_anthropic_key', anthropicKey);
      if (openaiKey) localStorage.setItem('vce_openai_key', openaiKey);
    }
  }, [groqKey, anthropicKey, openaiKey, saveKeysLocal]);

  // UI state
  const [errorMessage, setErrorMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentResult, setCurrentResult] = useState<PipelineResult | null>(null);

  // Recovery & Caching states
  const [recoveryData, setRecoveryData] = useState<{
    transcript?: string;
    isSimulated?: boolean;
    rawCuts?: any[];
    validatedCuts?: ViralCut[];
    podcastName?: string;
    episodeName?: string;
  }>({});
  const [showResumeBanner, setShowResumeBanner] = useState(false);
  const [cachedReportForUrl, setCachedReportForUrl] = useState<{
    html: string;
    result: PipelineResult;
    timestamp: number;
    platform: string;
    title: string;
    dateString: string;
  } | null>(null);

  // Pipeline execution process checklist state
  const [steps, setSteps] = useState<PipelineStep[]>([
    { id: 1, name: 'תמלול קובץ השמע', state: 'idle' },
    { id: 2, name: 'חילוץ 4 קטעים בעלי פוטנציאל ויראלי', state: 'idle' },
    { id: 3, name: 'תיקוף קטעים מול מדדי ויראליות', state: 'idle' },
    { id: 4, name: 'דירוג ושקלול ציונים', state: 'idle' },
    { id: 5, name: 'הפקת דו"ח תוכן ניהולי מותאם', state: 'idle' }
  ]);

  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);

  // Update a single step status in real-time and handle persistence
  const updateStep = (
    stepId: number, 
    state: 'idle' | 'active' | 'done' | 'error', 
    details?: string,
    intermediateData?: any
  ) => {
    let updatedSteps: PipelineStep[] = [];
    setSteps(prev => {
      const next = prev.map(step => {
        if (step.id === stepId) {
          return { ...step, state, details };
        }
        return step;
      });
      updatedSteps = next;
      return next;
    });

    let updatedLogs: string[] = [];
    if (details) {
      setConsoleLogs(prev => {
        const next = [...prev, `[Step ${stepId}] ${details}`];
        updatedLogs = next;
        return next;
      });
    } else {
      updatedLogs = consoleLogs;
    }

    setRecoveryData(prev => {
      const next = { ...prev };
      if (state === 'done' && intermediateData) {
        if (stepId === 1) {
          next.transcript = intermediateData.transcript;
          next.isSimulated = intermediateData.isSimulated;
        } else if (stepId === 2) {
          next.rawCuts = intermediateData.rawCuts;
        } else if (stepId === 3) {
          next.validatedCuts = intermediateData.validatedCuts;
        }
        
        if (intermediateData.podcastName) {
          next.podcastName = intermediateData.podcastName;
        }
        if (intermediateData.episodeName) {
          next.episodeName = intermediateData.episodeName;
        }
      }

      const completedStepsCount = updatedSteps.filter(s => s.state === 'done').length;

      // Persist the state progress to browser local session
      localStorage.setItem('vce_recovery_payload', JSON.stringify({
        url,
        activeTab,
        steps: updatedSteps,
        consoleLogs: updatedLogs,
        recoveryData: next,
        completedStepsCount,
        timestamp: Date.now()
      }));

      return next;
    });
  };

  // Load recovery states on mount
  useEffect(() => {
    const recoveryString = localStorage.getItem('vce_recovery_payload');
    if (recoveryString) {
      try {
        const payload = JSON.parse(recoveryString);
        if (payload && payload.url) {
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

  // Check URL cache for a computed report (under 48h limit)
  useEffect(() => {
    if (url) {
      const reportCacheKey = `vce_report_cache_${url}`;
      const cached = localStorage.getItem(reportCacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          const isExpired = Date.now() - parsed.timestamp > 172800000; // 48h limit
          if (!isExpired) {
            setCachedReportForUrl(parsed);
          } else {
            localStorage.removeItem(reportCacheKey);
            setCachedReportForUrl(null);
          }
        } catch (e) {
          setCachedReportForUrl(null);
        }
      } else {
        setCachedReportForUrl(null);
      }
    } else {
      setCachedReportForUrl(null);
    }
  }, [url]);

  // Cleanup old cached reports (> 48 hours)
  useEffect(() => {
    try {
      const keys = Object.keys(localStorage);
      const currentTime = Date.now();
      const fortyEightHours = 172800000;

      keys.forEach(key => {
        if (key.startsWith('vce_report_cache_')) {
          const cached = localStorage.getItem(key);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (currentTime - parsed.timestamp > fortyEightHours) {
              localStorage.removeItem(key);
            }
          }
        }
      });
    } catch (e) {
      console.warn('Failed to clean up old report cache', e);
    }
  }, []);

  const getPlaceholder = () => {
    switch (activeTab) {
      case 'youtube':
        return 'e.g., https://www.youtube.com/watch?v=dQw4w9WgXcQ or https://youtu.be/...';
      case 'spotify':
        return 'e.g., https://open.spotify.com/episode/7mK9A... or spotify:episode:...';
      case 'drive':
        return 'e.g., https://drive.google.com/file/d/1X2Y3Z... or share link';
    }
  };

  const cacheHtmlReport = async (result: PipelineResult) => {
    try {
      // Convert logo to base64
      let logoBase64 = '';
      try {
        const response = await fetch(logoImg);
        const blob = await response.blob();
        logoBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        logoBase64 = logoImg;
      }

      const formattedDate = new Date().toLocaleDateString('he-IL', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      const reportHtml = generateHtmlReport(
        result.cuts,
        result.sourceUrl,
        result.sourcePlatform,
        formattedDate,
        logoBase64,
        result.podcastName || podcastName,
        result.episodeName || episodeName
      );

      // Save to localStorage with timestamp
      const cacheObject = {
        html: reportHtml,
        result: result,
        timestamp: Date.now(),
        url: result.sourceUrl,
        platform: result.sourcePlatform,
        title: result.cuts[0]?.title || 'דו"ח קטעים ויראליים',
        dateString: formattedDate
      };

      localStorage.setItem(`vce_report_cache_${result.sourceUrl}`, JSON.stringify(cacheObject));
    } catch (e) {
      console.warn('Failed to cache HTML report offline', e);
    }
  };

  const handleStartPipeline = async (isResumeOption: any = false) => {
    const isResume = isResumeOption === true;
    setErrorMessage('');
    
    // Strict validation
    if (!url.trim()) {
      setErrorMessage('אנא הזינו קישור תחילה (Please paste a link first)');
      return;
    }

    if (!anthropicKey.trim() && !openaiKey.trim()) {
      setErrorMessage('מפתח ה-API של Anthropic וגם מפתח OpenAI חסרים. אנא לחצו על הלוגו של אנה ויעל בפינה הימנית העליונה כדי להזין מפתח API. (Both Anthropic and OpenAI API Keys are missing. Please click the logo in the top right to configure at least one of them.)');
      return;
    }

    if (!isResume) {
      setCurrentResult(null);
      setConsoleLogs(['Starting extraction request pipeline...', `Source Target URL: ${url}`]);
      setRecoveryData({});
      // Set all steps to idle
      setSteps(prev => prev.map(s => ({ ...s, state: 'idle', details: undefined })));
    } else {
      setConsoleLogs(prev => [...prev, '🔄 Resuming pipeline from the last successful step...']);
    }

    setIsProcessing(true);

    try {
      const completedStepsCount = steps.filter(s => s.state === 'done').length;
      
      const result = await runViralExtractionPipeline(
        url,
        groqKey,
        anthropicKey,
        updateStep,
        isResume ? {
          transcript: recoveryData.transcript,
          isSimulated: recoveryData.isSimulated,
          rawCuts: recoveryData.rawCuts,
          validatedCuts: recoveryData.validatedCuts,
          completedStepsCount,
          podcastName: recoveryData.podcastName,
          episodeName: recoveryData.episodeName
        } : undefined,
        openaiKey
      );
      
      const extractedPodcast = result.podcastName || 'אנה ויעל | נקודת חיבור';
      const extractedEpisode = result.episodeName || '';
      
      setPodcastName(extractedPodcast);
      setEpisodeName(extractedEpisode);
      
      const enrichedResult: PipelineResult = {
        ...result,
        podcastName: extractedPodcast,
        episodeName: extractedEpisode
      };
      
      setCurrentResult(enrichedResult);
      setConsoleLogs(prev => [...prev, '✓ Pipeline processing completed flawlessly! Enjoy your high potential clips.']);
      
      // Cleanup backup/recovery payload on successful run
      localStorage.removeItem('vce_recovery_payload');
      
      // Cache completed report for 48 hours
      await cacheHtmlReport(enrichedResult);
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred during extraction processing. Check API keys and network connection.');
      setConsoleLogs(prev => [...prev, `❌ Error triggered: ${err.message || err}`]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleResume = () => {
    setShowResumeBanner(false);
    handleStartPipeline(true);
  };

  const handleDiscardRecovery = () => {
    setShowResumeBanner(false);
    localStorage.removeItem('vce_recovery_payload');
    setRecoveryData({});
    setSteps([
      { id: 1, name: 'תמלול קובץ השמע', state: 'idle' },
      { id: 2, name: 'חילוץ 4 קטעים בעלי פוטנציאל ויראלי', state: 'idle' },
      { id: 3, name: 'תיקוף קטעים מול מדדי ויראליות', state: 'idle' },
      { id: 4, name: 'דירוג ושקלול ציונים', state: 'idle' },
      { id: 5, name: 'הפקת דו"ח תוכן ניהולי מותאם', state: 'idle' }
    ]);
    setConsoleLogs([]);
  };

  const triggerDownloadReport = async () => {
    if (!currentResult) return;
    
    // Convert logo image to base64 so it is fully self-contained in the offline HTML report
    let logoBase64 = '';
    try {
      const response = await fetch(logoImg);
      const blob = await response.blob();
      logoBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn('Failed to embed logo as base64, falling back to original source URL', e);
      logoBase64 = logoImg;
    }

    const formattedDate = new Date().toLocaleDateString('he-IL', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const reportHtml = generateHtmlReport(
      currentResult.cuts,
      currentResult.sourceUrl,
      currentResult.sourcePlatform,
      formattedDate,
      logoBase64,
      currentResult.podcastName || podcastName,
      currentResult.episodeName || episodeName
    );

    const blob = new Blob([reportHtml], { type: 'text/html;charset=utf-8;' });
    const urlBlob = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = urlBlob;
    link.setAttribute('download', `viral_cuts_report_${currentResult.sourcePlatform.toLowerCase().replace(' ', '_')}.html`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(urlBlob);
  };

  const activeStep = steps.find(s => s.state === 'active');
  const allDone = currentResult !== null;
  const hasError = steps.some(s => s.state === 'error');

  const getMetricBadgeClass = (score: number) => {
    if (score >= 8) return 'text-cp-sage-deep bg-cp-sage/15 border border-cp-sage/30';
    if (score >= 6) return 'text-cp-ochre bg-cp-ochre/15 border border-cp-ochre/30';
    return 'text-cp-clay bg-cp-clay/15 border border-cp-clay/30';
  };

  return (
    <div className="min-h-screen bg-cp-cream text-cp-ink flex flex-col selection:bg-cp-clay selection:text-white font-sans">
      {/* Visual Accent Top Bar */}
      <div className="h-1.5 bg-gradient-to-r from-cp-clay via-cp-ochre to-cp-sage" />

      {/* Main Elegant Header */}
      <header className="border-b border-cp-line bg-cp-cream/90 backdrop-blur sticky top-0 z-50 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setIsKeysModalOpen(true)}
              className="relative group transition cursor-pointer focus:outline-none shrink-0"
              title="הגדרות מפתחות API"
            >
              <img 
                src={logoImg} 
                alt="אנה ויעל Logo" 
                className="w-14 h-14 rounded-full border border-cp-line object-cover shadow-md group-hover:border-cp-clay/60 transition duration-200"
                referrerPolicy="no-referrer"
              />
              <span className="absolute bottom-0 right-0 bg-cp-clay text-white p-0.5 rounded-full border border-cp-cream shadow-sm group-hover:bg-cp-clay-deep transition-colors">
                <Lock className="w-3 h-3" />
              </span>
            </button>
            <div>
              <h1 className="text-3xl font-serif font-semibold text-cp-clay tracking-tight">מזקק רגעים ויראליים</h1>
              <p className="text-xs text-cp-ink-3 uppercase tracking-widest mt-1">
                אנה ויעל <span className="text-cp-line mx-1">|</span> נקודת חיבור
              </p>
            </div>
          </div>
          
          <div className="flex items-center space-x-6">
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-cp-ink-3 uppercase tracking-wider">סטטוס תהליך</span>
              <div className="flex space-x-2 mt-1.5">
                {steps.map((step, idx) => {
                  let dotClass = 'bg-cp-line';
                  if (allDone) {
                    dotClass = 'bg-cp-sage';
                  } else if (hasError) {
                    const errorIdx = steps.findIndex(s => s.state === 'error');
                    if (idx < errorIdx) dotClass = 'bg-cp-sage';
                    else if (idx === errorIdx) dotClass = 'bg-cp-clay';
                    else dotClass = 'bg-cp-line';
                  } else if (isProcessing) {
                    const activeIdx = steps.findIndex(s => s.state === 'active');
                    if (idx < activeIdx) dotClass = 'bg-cp-sage';
                    else if (idx === activeIdx) dotClass = 'bg-cp-sage animate-pulse';
                    else dotClass = 'bg-cp-line';
                  }
                  return (
                    <div key={step.id} title={step.name} className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${dotClass}`} />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-grow max-w-6xl w-full mx-auto px-4 py-8 flex flex-col gap-8">
        {showResumeBanner && (
          <div className="bg-cp-sage/10 border border-cp-sage/30 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4" dir="rtl">
            <div className="flex items-start gap-4">
              <RefreshCw className="w-6 h-6 text-cp-sage shrink-0 mt-0.5 animate-spin-[20s_linear_infinite]" />
              <div>
                <strong className="block text-sm font-bold text-cp-ink">זוהה תהליך קודם שלא הושלם (Unfinished sequence recovered)</strong>
                <span className="text-xs text-cp-ink-2 mt-1 block leading-relaxed">
                  החיבור התנתק או הדף עבר רענון במהלך העבודה על הקישור שלך. באפשרותך להמשיך ברגע זה מהשלב האחרון שהושלם בהצלחה מבלי להתחיל מחדש!
                </span>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={handleDiscardRecovery}
                className="px-4 py-2 text-xs border border-cp-line hover:bg-cp-bone text-cp-ink-2 rounded-full transition font-semibold cursor-pointer"
              >
                התחל מחדש
              </button>
              <button
                onClick={handleResume}
                className="px-5 py-2 text-xs bg-cp-sage hover:bg-cp-sage-deep text-white rounded-full transition font-bold shadow-sm cursor-pointer"
              >
                המשך מהשלב האחרון ({steps.filter(s => s.state === 'done').length} שלבים הושלמו)
              </button>
            </div>
          </div>
        )}

        {/* Intro */}
        <div className="text-center max-w-2xl mx-auto mb-2">
          <h2 className="text-3xl sm:text-4xl font-serif text-cp-ink font-bold tracking-tight mb-2">
            מפודקאסט לקליפ ויראלי
          </h2>

        </div>

        {/* Workspace Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
          {/* Section 1 - Left Panel: Config & Input */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            <div className="bg-cp-paper border border-cp-line rounded-2xl p-6 shadow-sm flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-cp-ink font-serif flex items-center gap-2">
                  <Video className="w-5 h-5 text-cp-clay" />
                  <span>הגדרות מקור ומדיה</span>
                </h3>
              </div>

              {/* Source Tab Selector */}
              <div>
                <label className="text-[10px] uppercase text-cp-ink-3 ml-1 block mb-2 font-semibold tracking-wider">
                  בחירת פלטפורמה
                </label>
                <div className="flex p-1 bg-cp-sand rounded-lg border border-cp-line">
                  <button
                    type="button"
                    onClick={() => { setActiveTab('youtube'); if(url.includes('drive') || url.includes('spotify')) setUrl(''); }}
                    className={`flex-1 py-1.5 text-xs font-medium rounded transition cursor-pointer ${
                      activeTab === 'youtube'
                        ? 'bg-cp-paper text-cp-clay border border-cp-line font-bold shadow-sm'
                        : 'text-cp-ink-2 hover:text-cp-ink'
                    }`}
                  >
                    YouTube
                  </button>
                  <button
                    type="button"
                    onClick={() => { setActiveTab('spotify'); if(url.includes('drive') || url.includes('youtube')) setUrl(''); }}
                    className={`flex-1 py-1.5 text-xs font-medium rounded transition cursor-pointer ${
                      activeTab === 'spotify'
                        ? 'bg-cp-paper text-cp-clay border border-cp-line font-bold shadow-sm'
                        : 'text-cp-ink-2 hover:text-cp-ink'
                    }`}
                  >
                    Spotify
                  </button>
                  <button
                    type="button"
                    onClick={() => { setActiveTab('drive'); if(url.includes('youtube') || url.includes('spotify')) setUrl(''); }}
                    className={`flex-1 py-1.5 text-xs font-medium rounded transition cursor-pointer ${
                      activeTab === 'drive'
                        ? 'bg-cp-paper text-cp-clay border border-cp-line font-bold shadow-sm'
                        : 'text-cp-ink-2 hover:text-cp-ink'
                    }`}
                  >
                    Google Drive
                  </button>
                </div>
              </div>

              {/* URL Input */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase text-cp-ink-3 ml-1 font-semibold tracking-wider">
                    קישור (url)
                  </label>
                  {url && (
                    <button onClick={() => setUrl('')} className="text-[10px] text-cp-ink-3 hover:text-cp-clay transition cursor-pointer">
                      נקה
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={getPlaceholder()}
                  className="w-full bg-cp-bone border border-cp-line rounded-lg px-3 py-2 text-sm text-cp-ink focus:outline-none focus:border-cp-clay placeholder:text-cp-ink-3/65 font-medium transition"
                />
              </div>



              {cachedReportForUrl && !currentResult && !isProcessing && (
                <div className="bg-cp-sage/10 border border-cp-sage/25 p-4 rounded-xl flex flex-col gap-3 text-xs text-cp-ink" dir="rtl">
                  <div className="flex gap-2 items-start">
                    <CheckCircle2 className="w-4 h-4 text-cp-sage mt-0.5 shrink-0" />
                    <div>
                      <strong className="font-semibold block text-cp-sage-deep">נמצא דו"ח שמור במטמון (תקף ל-48 שעות)</strong>
                      <span className="text-cp-ink-2 block mt-0.5 leading-relaxed">
                        נשמר ב: {new Date(cachedReportForUrl.timestamp).toLocaleDateString('he-IL', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}. באפשרותך לשחזר את התוצאות ישירות ללא שימוש ב-API!
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentResult(cachedReportForUrl.result);
                        if (cachedReportForUrl.result.podcastName) setPodcastName(cachedReportForUrl.result.podcastName);
                        if (cachedReportForUrl.result.episodeName) setEpisodeName(cachedReportForUrl.result.episodeName);
                        setConsoleLogs(['שוחזר דו"ח מוכן מהמטמון המקומי של הדפדפן.']);
                      }}
                      className="bg-cp-sage text-white font-bold py-1.5 px-4 rounded-full transition text-[11px] hover:bg-cp-sage-deep cursor-pointer"
                    >
                      טען תוצאות למסך
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const blob = new Blob([cachedReportForUrl.html], { type: 'text/html;charset=utf-8;' });
                        const urlBlob = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = urlBlob;
                        link.setAttribute('download', `viral_cuts_report_${cachedReportForUrl.platform.toLowerCase().replace(' ', '_')}.html`);
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(urlBlob);
                      }}
                      className="bg-transparent border border-cp-sage text-cp-sage-deep font-bold py-1.5 px-4 rounded-full transition text-[11px] hover:bg-cp-sage/10 cursor-pointer"
                    >
                      הורד קובץ HTML ישירות
                    </button>
                  </div>
                </div>
              )}



              {/* Action Trigger */}
              <button
                type="button"
                onClick={() => handleStartPipeline(false)}
                disabled={isProcessing}
                className="w-full bg-cp-clay hover:bg-cp-clay-deep text-white font-semibold py-3 px-4 rounded-full transition-all flex items-center justify-center space-x-2 text-sm disabled:opacity-50 cursor-pointer shadow-md hover:shadow-lg active:scale-98"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin text-white" />
                    <span>Extracting...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 text-cp-cream" />
                    <span>Extract</span>
                  </>
                )}
              </button>


              {/* Error Warning Segment */}
              {errorMessage && (
                <div className="bg-cp-rose/10 border border-cp-rose/25 p-4 rounded-xl flex gap-3 text-sm text-cp-clay items-start">
                  <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                  <div>
                    <strong className="block font-semibold">עלתה שגיאה בנתונים</strong>
                    <span className="text-xs text-cp-ink-2 mt-1 block leading-relaxed">{errorMessage}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Section 2 - Pipeline progress dashboard / Section 3 Results & report */}
          <div className="lg:col-span-3 flex flex-col gap-6">
            
            {/* If pipeline is active or was started */}
            {(isProcessing || consoleLogs.length > 0) && (
              <div className="bg-cp-paper border border-cp-line rounded-2xl p-6 shadow-sm flex flex-col gap-6">
                <h3 className="text-sm uppercase text-cp-ink-2 font-semibold tracking-wider flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Loader2 className={`w-4 h-4 text-cp-sage ${isProcessing ? 'animate-spin' : ''}`} />
                    <span>יומן התקדמות שלבי העבודה</span>
                  </div>
                  <span className="text-xs text-cp-ink-3 font-mono">
                    {isProcessing ? 'מעבד כעת' : 'הושלם'}
                  </span>
                </h3>

                {/* Steps List */}
                <div className="space-y-3">
                  {steps.map((step) => (
                    <div 
                      key={step.id} 
                      className={`flex gap-4 p-3.5 rounded-xl border transition ${
                        step.state === 'active' 
                          ? 'bg-cp-sand/45 border-cp-sage/35 shadow-inner' 
                          : step.state === 'done'
                          ? 'bg-cp-sage/5 border-cp-line'
                          : step.state === 'error'
                          ? 'bg-cp-rose/5 border-cp-line'
                          : 'bg-cp-bone/40 border-cp-line/50'
                      }`}
                    >
                      <div className="mt-0.5">
                        {step.state === 'active' && (
                          <div className="w-5 h-5 rounded-full border-2 border-cp-line border-t-cp-sage animate-spin" />
                        )}
                        {step.state === 'done' && (
                          <CheckCircle2 className="w-5 h-5 text-cp-sage" />
                        )}
                        {step.state === 'error' && (
                          <XCircle className="w-5 h-5 text-cp-clay" />
                        )}
                        {step.state === 'idle' && (
                          <div className="w-5 h-5 rounded-full border border-cp-line bg-cp-sand" />
                        )}
                      </div>

                      <div className="flex-grow">
                        <div className="flex justify-between items-center">
                          <span className={`text-sm font-semibold ${
                            step.state === 'active' ? 'text-cp-ink' : 'text-cp-ink-2'
                          }`}>
                            {step.name}
                          </span>
                          <span className="text-[10px] font-bold text-cp-ink-3 tracking-wider uppercase">
                            {step.state === 'idle' ? 'בהמתנה' : step.state === 'active' ? 'מבצע...' : step.state === 'done' ? 'הושלם' : 'שגיאה'}
                          </span>
                        </div>
                        {step.details && (
                          <p className={`text-[11px] mt-1.5 ${
                            step.state === 'error' ? 'text-cp-clay' : 'text-cp-ink-2'
                          }`}>
                            {step.details}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Micro Console Output */}
                <div className="bg-cp-sand rounded-lg border border-cp-line p-4 font-mono text-[11px] text-cp-ink-2 h-28 overflow-y-auto space-y-1">
                  <div className="text-cp-ink-3 border-b border-cp-line pb-1.5 mb-2 flex justify-between">
                    <span>CONSOLE_LOGS_STREAM</span>
                    <span>UTF-8</span>
                  </div>
                  {consoleLogs.map((log, i) => (
                    <div key={i} className="leading-5 text-right" dir="ltr">
                      <span className="text-cp-clay/70 mr-2">&gt;&gt;</span>
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Results Segment (Section 3) */}
            {currentResult && (
              <div className="flex flex-col gap-6">
                
                {/* Result Top Dashboard Control */}
                <div className="bg-cp-paper border border-cp-line rounded-2xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-bold text-cp-ink font-serif flex items-center gap-2">
                      <Flame className="w-5 h-5 text-cp-ochre" />
                      <span>הופקו בהצלחה 4 קטעים ויראליים!</span>
                    </h3>
                    <p className="text-xs text-cp-ink-2 mt-1 max-w-md">
                      הקטעים עברו סינון, נרמול ודירוג לקבלת שימור צופים מרבי. מוכנים לחלוטין לפרסום ברשתות החברתיות.
                    </p>
                    {currentResult.isSimulated && (
                      <span className="text-[10px] uppercase font-bold text-cp-sage bg-cp-sage/10 px-2 py-0.5 rounded border border-cp-sage/20 inline-block mt-2 font-mono">
                        הופק באמצעות סימולציית דיבור מומחה של Claude
                      </span>
                    )}
                  </div>
                  
                  {/* Download Action */}
                  <div className="shrink-0">
                    <button
                      onClick={triggerDownloadReport}
                      title='הורד דו"ח קטעים מלא'
                      className="inline-flex items-center gap-2 bg-cp-clay hover:bg-cp-clay-deep text-white font-semibold px-5 py-2.5 rounded-full transition shadow-md text-xs tracking-wider uppercase cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      <span>הורד דו"ח HTML</span>
                    </button>
                  </div>
                </div>

                {/* Score and Ranked Cards Display (Exact mockup alignment) */}
                <div className="space-y-6">
                  {currentResult.cuts.map((cut, idx) => {
                    const isHighPotential = cut.viralPotential >= 75;
                    return (
                      <div 
                        key={idx}
                        className="bg-cp-paper border border-cp-line rounded-2xl p-6 flex flex-col relative shadow-sm"
                      >
                        {/* Potential score badge matched exactly to the mockup position */}
                        <div className={`absolute top-4 left-5 border px-3 py-1 rounded-full text-xs font-bold leading-normal ${
                          isHighPotential 
                            ? 'bg-cp-sage/10 text-cp-sage-deep border-cp-sage/30' 
                            : 'bg-cp-ochre/15 text-cp-ochre border-cp-ochre/30'
                        }`}>
                          {cut.viralPotential}/100
                        </div>

                        {/* Rank & Title header layout */}
                        <div className="flex items-start space-x-4 mb-3 border-b border-cp-line pb-3">
                          <span className="text-4xl font-serif text-cp-clay/35 font-bold select-none pl-3">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <div className="pl-12">
                            <h3 className="font-serif font-bold text-cp-ink leading-tight text-base sm:text-lg">
                              {cut.title}
                            </h3>
                            <p className="text-[11px] text-cp-clay font-mono mt-1">
                              {cut.startTime} &mdash; {cut.endTime}
                            </p>
                          </div>
                        </div>

                        {/* Key segment quote strictly themed as blockquote */}
                        <blockquote className="text-base italic text-cp-ink-2 border-r-4 border-cp-clay pr-4 pl-1 py-1.5 mb-4 leading-relaxed font-serif">
                          "{cut.quote}"
                        </blockquote>

                        {/* Hook Metadata Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4" dir="rtl">
                          <div className="bg-cp-sand/30 p-3.5 rounded-xl border border-cp-line">
                            <span className="text-[10px] uppercase text-cp-clay font-bold block">אסטרטגיית הוק (3 שניות ראשונות)</span>
                            <p className="text-[11px] text-cp-ink-2 leading-normal mt-1 font-medium">{cut.hook}</p>
                          </div>
                          
                          <div className="bg-cp-sand/30 p-3.5 rounded-xl border border-cp-line">
                            <span className="text-[10px] uppercase text-cp-clay font-bold block">למה זה יעבוד ויראלית</span>
                            <p className="text-[11px] text-cp-ink-2 leading-normal mt-1">{cut.whyViral}</p>
                          </div>
                        </div>

                        {/* Validation Grid Score Matrix matched to mockup */}
                        <div className="mb-4" dir="rtl">
                          <span className="text-[9px] uppercase tracking-wider text-cp-ink-3 mb-2 block font-semibold">מדדי תיקוף ואישרור ויראלי</span>
                          <div className="grid grid-cols-4 gap-2">
                            <div className="bg-cp-sand/20 border border-cp-line/60 p-2 rounded text-center">
                              <p className="text-[8px] uppercase text-cp-ink-3">אותנטיות</p>
                              <p className={`text-xs font-bold mt-0.5 ${getMetricBadgeClass(cut.scores.authenticity).split(' ')[0]}`}>{cut.scores.authenticity}</p>
                            </div>
                            <div className="bg-cp-sand/20 border border-cp-line/60 p-2 rounded text-center">
                              <p className="text-[8px] uppercase text-cp-ink-3">מעורבות</p>
                              <p className={`text-xs font-bold mt-0.5 ${getMetricBadgeClass(cut.scores.engagement).split(' ')[0]}`}>{cut.scores.engagement}</p>
                            </div>
                            <div className="bg-cp-sand/20 border border-cp-line/60 p-2 rounded text-center">
                              <p className="text-[8px] uppercase text-cp-ink-3">רגש ויזואלי</p>
                              <p className={`text-xs font-bold mt-0.5 ${getMetricBadgeClass(cut.scores.emotional_resonance).split(' ')[0]}`}>{cut.scores.emotional_resonance}</p>
                            </div>
                            <div className="bg-cp-sand/20 border border-cp-line/60 p-2 rounded text-center">
                              <p className="text-[8px] uppercase text-cp-ink-3">ישימות</p>
                              <p className={`text-xs font-bold mt-0.5 ${getMetricBadgeClass(cut.scores.actionability).split(' ')[0]}`}>{cut.scores.actionability}</p>
                            </div>
                          </div>
                        </div>

                        {/* Content Manager Note matched exactly to Sophisticated Dark layout */}
                        {cut.contentManagerNote && (
                          <div className="mt-auto bg-cp-sand/50 p-4 rounded-xl border border-cp-line" dir="rtl">
                            <p className="text-[10px] text-cp-clay font-semibold mb-1 uppercase tracking-tighter">הנחיית הפקה למנהלי תוכן</p>
                            <p className="text-[11px] text-cp-ink-2 leading-relaxed">{cut.contentManagerNote}</p>
                          </div>
                        )}

                      </div>
                    );
                  })}
                </div>

                {/* Section 4 - Full size report Download button (Clean bordered aesthetics from layout) */}
                <div className="mt-4">
                  <button
                    onClick={triggerDownloadReport}
                    className="w-full py-4 border-2 border-cp-clay/60 bg-transparent hover:bg-cp-clay/5 text-cp-clay hover:text-cp-clay-deep font-bold uppercase tracking-widest text-xs rounded-full flex items-center justify-center space-x-3 transition-all cursor-pointer"
                  >
                    <svg className="w-4 h-4 text-cp-clay animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    <span>הורד דו"ח HTML מלא למנהלי התוכן</span>
                  </button>
                </div>

              </div>
            )}

            {/* Empty Context State Panel */}
            {!isProcessing && !currentResult && (
              <div className="bg-cp-paper rounded-2xl border-2 border-cp-line border-dashed py-16 px-6 text-center shadow-inner flex flex-col items-center justify-center min-h-[400px]">
                <div className="w-14 h-14 rounded-full bg-cp-sand flex items-center justify-center border border-cp-line text-cp-ink-3 mb-4 animate-pulse">
                  <Flame className="w-6 h-6 text-cp-clay" />
                </div>
                <h3 className="text-lg font-bold text-cp-ink font-serif">ההפקה החכמה ממתינה לכם</h3>
                <p className="text-xs text-cp-ink-3 mt-2 max-w-sm leading-relaxed mx-auto">
                  הזינו קישור לפודקאסט
                </p>
                
                {/* Visual Placeholder mockup of cards */}
                <div className="mt-8 flex gap-3 max-w-md w-full opacity-35 select-none md:px-4">
                  <div className="bg-cp-sand h-20 rounded-xl flex-1 border border-cp-line" />
                  <div className="bg-cp-sand h-20 rounded-xl flex-1 border border-cp-line" />
                  <div className="bg-cp-sand h-20 rounded-xl flex-1 border border-cp-line" />
                </div>
              </div>
            )}

          </div>
        </div>
      </main>

      {/* Footer credits banner */}
      <footer className="border-t border-cp-line bg-cp-sand/50 py-6 text-center text-xs text-cp-ink-3 mt-auto px-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 אנה ויעל | נקודת חיבור</p>
        </div>
      </footer>

      {/* Modal Popup for API Keys */}
      {isKeysModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-cp-paper border border-cp-line rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col" dir="rtl">
            {/* Header */}
            <div className="bg-cp-bone border-b border-cp-line px-6 py-4 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Key className="w-5 h-5 text-cp-clay" />
                <h3 className="text-sm font-bold text-cp-ink font-serif">הגדרות מפתחות API</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsKeysModalOpen(false)}
                className="text-cp-ink-3 hover:text-cp-ink transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-cp-ink-2 block">
                    מפתח Anthropic <span className="text-cp-ink-3 font-normal">(ראשי / מומלץ)</span>
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type={showAnthropicKey ? "text" : "password"}
                      value={anthropicKey}
                      onChange={(e) => setAnthropicKey(e.target.value)}
                      placeholder="sk-ant-••••••••••••"
                      className="w-full bg-cp-bone border border-cp-line rounded-lg pl-20 pr-3 py-2 text-sm text-cp-ink focus:outline-none focus:border-cp-clay font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                      className="absolute left-2.5 text-[11px] font-semibold text-cp-clay hover:text-cp-clay-deep transition-all cursor-pointer flex items-center gap-1.5 px-2 py-1 bg-cp-sand hover:bg-cp-sand/85 border border-cp-line/60 rounded-md shadow-sm"
                      title={showAnthropicKey ? "הסתר מפתח" : "הצג מפתח"}
                    >
                      <span>{showAnthropicKey ? "הסתר" : "הצג"}</span>
                      {showAnthropicKey ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-cp-ink-2 block">
                    מפתח OpenAI <span className="text-cp-ink-3 font-normal">(גיבוי / חלופי)</span>
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type={showOpenaiKey ? "text" : "password"}
                      value={openaiKey}
                      onChange={(e) => setOpenaiKey(e.target.value)}
                      placeholder="sk-proj-••••••••••••"
                      className="w-full bg-cp-bone border border-cp-line rounded-lg pl-20 pr-3 py-2 text-sm text-cp-ink focus:outline-none focus:border-cp-clay font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                      className="absolute left-2.5 text-[11px] font-semibold text-cp-clay hover:text-cp-clay-deep transition-all cursor-pointer flex items-center gap-1.5 px-2 py-1 bg-cp-sand hover:bg-cp-sand/85 border border-cp-line/60 rounded-md shadow-sm"
                      title={showOpenaiKey ? "הסתר מפתח" : "הצג מפתח"}
                    >
                      <span>{showOpenaiKey ? "הסתר" : "הצג"}</span>
                      {showOpenaiKey ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
                
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-cp-ink-2 block">
                    מפתח Groq <span className="text-cp-ink-3 font-normal">(אופציונלי - לתמלול Drive)</span>
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type={showGroqKey ? "text" : "password"}
                      value={groqKey}
                      onChange={(e) => setGroqKey(e.target.value)}
                      placeholder="gsk_••••••••••••"
                      className="w-full bg-cp-bone border border-cp-line rounded-lg pl-20 pr-3 py-2 text-sm text-cp-ink focus:outline-none focus:border-cp-clay font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowGroqKey(!showGroqKey)}
                      className="absolute left-2.5 text-[11px] font-semibold text-cp-clay hover:text-cp-clay-deep transition-all cursor-pointer flex items-center gap-1.5 px-2 py-1 bg-cp-sand hover:bg-cp-sand/85 border border-cp-line/60 rounded-md shadow-sm"
                      title={showGroqKey ? "הסתר מפתח" : "הצג מפתח"}
                    >
                      <span>{showGroqKey ? "הסתר" : "הצג"}</span>
                      {showGroqKey ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between border-b border-cp-line pb-2 pt-2">
                <span className="text-[11px] uppercase text-cp-ink-3 font-semibold tracking-wider">
                  שמירת מפתחות בדפדפן
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="save-keys"
                    checked={saveKeysLocal}
                    onChange={(e) => handleSaveKeysToggle(e.target.checked)}
                    className="w-3.5 h-3.5 rounded text-cp-clay focus:ring-cp-clay bg-cp-bone border-cp-line cursor-pointer"
                  />
                  <label htmlFor="save-keys" className="text-xs text-cp-ink-2 cursor-pointer select-none font-medium">
                    שמור מפתח באופן מקומי
                  </label>
                </div>
              </div>

              {/* Key security note */}
              <div className="bg-cp-sand/60 border border-cp-line p-3.5 rounded-xl flex gap-3 text-xs text-cp-ink-2 items-start">
                <Shield className="w-4 h-4 text-cp-sage mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold text-cp-ink block">המפתחות נשמרים אצלך במחשב</span>
                  <span className="text-[11px] mt-0.5 text-cp-ink-3 block leading-relaxed">
                    ההגדרות נשמרות בדפדפן שלך בלבד לצורך אבטחה מרבית, ומועברות אך ורק ישירות לשרתי ה-API הרשמיים.
                  </span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-cp-bone border-t border-cp-line px-6 py-4 flex justify-end font-sans">
              <button
                type="button"
                onClick={() => setIsKeysModalOpen(false)}
                className="bg-cp-clay hover:bg-cp-clay-deep text-white font-semibold py-2 px-6 rounded-full text-xs transition cursor-pointer shadow-sm hover:shadow active:scale-98"
              >
                שמור וסגור
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
