import { useState, useCallback, useRef, useEffect } from 'react';
import { runViralExtractionPipeline } from '../utils/pipeline';
import { PipelineStep, PipelineResult, RecoveryData, CachedReport, StepIntermediateData } from '../types';
import { STORAGE_KEYS, CACHE_TTL_MS, DEFAULT_PODCAST_NAME, INITIAL_STEPS } from '../constants';

export interface PipelineInputs {
  activeTab: 'youtube' | 'drive' | 'upload' | 'transcript';
  url: string;
  pastedTranscript: string;
  uploadedFile: File | null;
  userComments: string;
}

export interface PipelineState {
  isProcessing: boolean;
  errorMessage: string;
  currentResult: PipelineResult | null;
  steps: PipelineStep[];
  consoleLogs: string[];
  recoveryData: RecoveryData;
  showResumeBanner: boolean;
  cachedReportForUrl: CachedReport | null;
  podcastName: string;
  episodeName: string;
}

export interface PipelineActions {
  handleStartPipeline: (isResume?: boolean) => Promise<PipelineResult | undefined>;
  handleResume: () => void;
  handleDiscardRecovery: () => void;
  handleNewExtraction: () => void;
  handleLoadCachedResult: () => void;
  setErrorMessage: (msg: string) => void;
  setPodcastName: (name: string) => void;
  setEpisodeName: (name: string) => void;
  setCurrentResult: (result: PipelineResult | null) => void;
  setRecoveryData: React.Dispatch<React.SetStateAction<RecoveryData>>;
}

export function usePipelineExecution(inputs: PipelineInputs): PipelineState & PipelineActions {
  const { activeTab, url, pastedTranscript, uploadedFile, userComments } = inputs;

  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [currentResult, setCurrentResult] = useState<PipelineResult | null>(null);
  const [recoveryData, setRecoveryData] = useState<RecoveryData>({});
  const [showResumeBanner, setShowResumeBanner] = useState(false);
  const [cachedReportForUrl, setCachedReportForUrl] = useState<CachedReport | null>(null);
  const [steps, setSteps] = useState<PipelineStep[]>(() => INITIAL_STEPS.map(s => ({ ...s })));
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [podcastName, setPodcastName] = useState(DEFAULT_PODCAST_NAME);
  const [episodeName, setEpisodeName] = useState('');

  // Refs
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const latestTranscriptRef = useRef<string | undefined>(undefined);

  // Update a single step status
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
          latestTranscriptRef.current = intermediateData.transcript;
        } else if (stepId === 2) {
          next.rawCuts = intermediateData.rawCuts;
        } else if (stepId === 3) {
          next.validatedCuts = intermediateData.validatedCuts;
        }
        if (intermediateData.podcastName) next.podcastName = intermediateData.podcastName;
        if (intermediateData.episodeName) next.episodeName = intermediateData.episodeName;
      }

      const completedStepsCount = updatedSteps.filter(s => s.state === 'done').length;

      try {
        localStorage.setItem(STORAGE_KEYS.RECOVERY_PAYLOAD, JSON.stringify({
          url, activeTab, steps: updatedSteps,
          consoleLogs: updatedLogs,
          recoveryData: next, completedStepsCount, timestamp: Date.now()
        }));
      } catch (e) { console.warn('Failed to save recovery payload', e); }

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
        if (key.startsWith(STORAGE_KEYS.REPORT_CACHE_PREFIX) || key.startsWith(STORAGE_KEYS.TRANSCRIPT_CACHE_PREFIX)) {
          const cached = localStorage.getItem(key);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (Date.now() - parsed.timestamp > CACHE_TTL_MS) localStorage.removeItem(key);
          }
        }
      });
    } catch (e) { console.warn('Failed to clean up old cache', e); }
  }, []);

  // Start pipeline
  const handleStartPipeline = useCallback(async (isResume = false) => {
    setErrorMessage('');

    if (activeTab === 'transcript') {
      if (!pastedTranscript.trim()) {
        setErrorMessage('אנא הדביקו תמלול לפני ההפעלה.');
        return;
      }
    } else if (activeTab === 'upload') {
      if (!uploadedFile) {
        setErrorMessage('אנא העלו קובץ שמע לפני ההפעלה.');
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

      let resumeDataForPipeline = isResume ? { ...recoveryData, completedStepsCount } :
        activeTab === 'transcript' ? { transcript: pastedTranscript, completedStepsCount: 1 } : undefined;

      if (activeTab === 'upload' && uploadedFile && !isResume) {
        const fileCacheKey = `${STORAGE_KEYS.TRANSCRIPT_CACHE_PREFIX}file_${uploadedFile.name}_${uploadedFile.size}`;
        const cachedTranscript = localStorage.getItem(fileCacheKey);

        if (cachedTranscript) {
          try {
            const cached = JSON.parse(cachedTranscript);
            if (cached.transcript && Date.now() - cached.timestamp <= CACHE_TTL_MS) {
              setConsoleLogs(prev => [...prev, `📋 נמצא תמלול שמור עבור "${uploadedFile.name}" — משתמש בתמלול מהמטמון (חוסך קריאה ל-Groq)`]);
              resumeDataForPipeline = { transcript: cached.transcript, completedStepsCount: 1 };
            } else {
              localStorage.removeItem(fileCacheKey);
            }
          } catch { /* ignore parse errors */ }
        }

        if (!resumeDataForPipeline) {
          const serverUrl = import.meta.env.VITE_SERVER_URL || '';
          const formData = new FormData();
          formData.append('file', uploadedFile);

          setConsoleLogs(prev => [...prev, `Uploading ${uploadedFile.name} (${(uploadedFile.size / 1024 / 1024).toFixed(1)}MB)...`]);

          const uploadResponse = await fetch(`${serverUrl}/api/transcribe-file`, {
            method: 'POST',
            body: formData,
          });

          if (!uploadResponse.ok) {
            const errData = await uploadResponse.json().catch(() => ({}));
            throw new Error(errData?.error || 'שגיאה לא ידועה בהעלאת הקובץ');
          }

          const transcriptionData = await uploadResponse.json();
          let transcript = '';
          if (transcriptionData.segments && Array.isArray(transcriptionData.segments)) {
            transcript = transcriptionData.segments
              .map((seg: { start: number; text: string }) => {
                const min = Math.floor(seg.start / 60);
                const sec = Math.floor(seg.start % 60);
                return `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}] ${seg.text}`;
              })
              .join('\n');
          } else if (transcriptionData.text) {
            transcript = `[00:00] ${transcriptionData.text}`;
          }

          try {
            localStorage.setItem(fileCacheKey, JSON.stringify({ transcript, timestamp: Date.now() }));
          } catch (e) { console.warn('Failed to cache transcript', e); }

          setConsoleLogs(prev => [...prev, `תמלול הושלם בהצלחה! (נשמר במטמון לשימוש חוזר)`]);
          resumeDataForPipeline = { transcript, completedStepsCount: 1 };
        }
      } else if ((activeTab === 'youtube' || activeTab === 'drive') && url.trim() && !isResume) {
        const urlCacheKey = `${STORAGE_KEYS.TRANSCRIPT_CACHE_PREFIX}url_${url.trim()}`;
        const cachedTranscript = localStorage.getItem(urlCacheKey);

        if (cachedTranscript) {
          try {
            const cached = JSON.parse(cachedTranscript);
            if (cached.transcript && Date.now() - cached.timestamp <= CACHE_TTL_MS) {
              setConsoleLogs(prev => [...prev, `📋 נמצא תמלול שמור עבור הקישור — משתמש בתמלול מהמטמון (חוסך קריאה ל-Groq)`]);
              resumeDataForPipeline = { transcript: cached.transcript, completedStepsCount: 1 };
            } else {
              localStorage.removeItem(urlCacheKey);
            }
          } catch { /* ignore parse errors */ }
        }
      }

      const result = await runViralExtractionPipeline(
        activeTab === 'transcript' || activeTab === 'upload' ? '' : url,
        updateStep,
        resumeDataForPipeline,
        userComments.trim() || undefined
      );

      const extractedPodcast = result.podcastName || DEFAULT_PODCAST_NAME;
      const extractedEpisode = result.episodeName || '';
      setPodcastName(extractedPodcast);
      setEpisodeName(extractedEpisode);

      const enrichedResult: PipelineResult = { ...result, podcastName: extractedPodcast, episodeName: extractedEpisode };
      setCurrentResult(enrichedResult);
      setConsoleLogs(prev => [...prev, '✓ Pipeline completed successfully.']);
      localStorage.removeItem(STORAGE_KEYS.RECOVERY_PAYLOAD);

      // Cache the transcript for URL-based sources
      if ((activeTab === 'youtube' || activeTab === 'drive') && url.trim()) {
        try {
          const transcriptToCache = latestTranscriptRef.current;
          if (transcriptToCache) {
            const urlCacheKey = `${STORAGE_KEYS.TRANSCRIPT_CACHE_PREFIX}url_${url.trim()}`;
            localStorage.setItem(urlCacheKey, JSON.stringify({ transcript: transcriptToCache, timestamp: Date.now() }));
          }
        } catch (e) { console.warn('Failed to cache URL transcript', e); }
      }

      return enrichedResult;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred during extraction.';
      setErrorMessage(message);
      setConsoleLogs(prev => [...prev, `❌ Error: ${message}`]);
      return undefined;
    } finally {
      setIsProcessing(false);
    }
  }, [url, recoveryData, updateStep, activeTab, pastedTranscript, uploadedFile, userComments]);

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

  const handleNewExtraction = useCallback(() => {
    setCurrentResult(null);
    setRecoveryData({});
    setSteps(INITIAL_STEPS.map(s => ({ ...s })));
    setConsoleLogs([]);
    setErrorMessage('');
  }, []);

  const handleLoadCachedResult = useCallback(() => {
    if (!cachedReportForUrl) return;
    setCurrentResult(cachedReportForUrl.result);
    if (cachedReportForUrl.result.podcastName) setPodcastName(cachedReportForUrl.result.podcastName);
    if (cachedReportForUrl.result.episodeName) setEpisodeName(cachedReportForUrl.result.episodeName);
    if (cachedReportForUrl.transcript) setRecoveryData(prev => ({ ...prev, transcript: cachedReportForUrl.transcript }));
    setConsoleLogs(['שוחזר דו"ח מוכן מהמטמון המקומי של הדפדפן.']);
  }, [cachedReportForUrl]);

  return {
    // State
    isProcessing,
    errorMessage,
    currentResult,
    steps,
    consoleLogs,
    recoveryData,
    showResumeBanner,
    cachedReportForUrl,
    podcastName,
    episodeName,
    // Actions
    handleStartPipeline,
    handleResume,
    handleDiscardRecovery,
    handleNewExtraction,
    handleLoadCachedResult,
    setErrorMessage,
    setPodcastName,
    setEpisodeName,
    setCurrentResult,
    setRecoveryData,
  };
}
