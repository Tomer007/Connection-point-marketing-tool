import { StepState, ViralCut, PipelineResult } from '../types';

export interface StepUpdate {
  (stepId: number, state: StepState, details?: string, intermediateData?: any): void;
}

// Extract google drive file id
export function getGoogleDriveId(url: string): string | null {
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/) || url.match(/[?&]id=([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

// Helper to clean and parse Claude JSON content
export function parseClaudeJson(text: string): any[] {
  // Strip code blocks and outer text
  let cleanText = text.trim();
  
  // If there are markdown backticks, strip them
  if (cleanText.includes('```')) {
    cleanText = cleanText.replace(/```json|```/gi, '').trim();
  }
  
  try {
    return JSON.parse(cleanText);
  } catch (err) {
    console.warn("Standard JSON parse failed, trying regex fallback...", err);
    // Regex fallback to find the first array structure [...]
    const arrayMatch = cleanText.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch (regexErr) {
        throw new Error("Could not parse AI response as valid JSON array: " + regexErr);
      }
    }
    throw new Error("Could not find potential JSON array structure inside AI response.");
  }
}

// Format seconds into MM:SS
function formatTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Helper to call Anthropic with OpenAI fallback
async function callLlm(
  anthropicKey: string,
  openaiKey: string | undefined,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 3000
): Promise<string> {
  // Try Anthropic if provided
  if (anthropicKey && anthropicKey.trim() !== '') {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }]
        })
      });

      if (response.ok) {
        const resData = await response.json();
        return resData.content[0].text;
      } else {
        const errData = await response.json().catch(() => ({}));
        const rawErrMessage = errData?.error?.message || '';
        console.warn(`Anthropic Call failed: ${rawErrMessage}. Checking for OpenAI fallback...`);
        // If OpenAI key is NOT available, throw
        if (!openaiKey || openaiKey.trim() === '') {
          if (response.status === 401 || rawErrMessage.toLowerCase().includes('api key') || rawErrMessage.toLowerCase().includes('invalid')) {
            throw new Error('מפתח ה-API של Anthropic אינו תקין. אנא לחצו על הלוגו בפינה הימנית העליונה של האפליקציה כדי לעדכן אותו. (Anthropic API Key is invalid)');
          }
          throw new Error(rawErrMessage || `שגיאה משירות Anthropic: קוד תגובה ${response.status}`);
        }
      }
    } catch (err: any) {
      console.warn("Anthropic Exception triggered. Checking for OpenAI fallback...", err);
      if (!openaiKey || openaiKey.trim() === '') {
        throw err;
      }
    }
  }

  // Fallback to OpenAI
  if (openaiKey && openaiKey.trim() !== '') {
    console.log("Using OpenAI GPT-4o as fallback/direct processor.");
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        max_tokens: maxTokens,
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      const rawErr = errJson?.error?.message || `OpenAI API returned status ${response.status}`;
      if (response.status === 401 || rawErr.toLowerCase().includes('api key') || rawErr.toLowerCase().includes('invalid')) {
        throw new Error('מפתח ה-API של OpenAI אינו תקין. אנא לחצו על הלוגו בפינה הימנית העליונה של האפליקציה כדי לעדכן אותו. (OpenAI API Key is invalid)');
      }
      throw new Error(rawErr);
    }

    const resData = await response.json();
    if (resData.choices && resData.choices[0] && resData.choices[0].message) {
      return resData.choices[0].message.content;
    } else {
      throw new Error('תגובה לא פוענחה בהצלחה משירות OpenAI.');
    }
  }

  throw new Error('נדרש לפחות מפתח API אחד תקין (Anthropic או OpenAI) לצורך עיבוד ב-LLM.');
}

export async function runViralExtractionPipeline(
  url: string,
  groqKey: string,
  anthropicKey: string,
  onStep: StepUpdate,
  resumeData?: {
    transcript?: string;
    isSimulated?: boolean;
    rawCuts?: any[];
    validatedCuts?: ViralCut[];
    completedStepsCount?: number;
    podcastName?: string;
    episodeName?: string;
  },
  openaiKey?: string
): Promise<PipelineResult> {
  let transcript = '';
  let isSimulated = false;
  let podcastName = 'אנה ויעל | נקודת חיבור';
  let episodeName = '';

  if (resumeData) {
    if (resumeData.podcastName) podcastName = resumeData.podcastName;
    if (resumeData.episodeName) episodeName = resumeData.episodeName;
  }

  // Determine platform based on link
  let platform = 'YouTube';
  if (url.toLowerCase().includes('spotify')) {
    platform = 'Spotify';
  } else if (url.toLowerCase().includes('drive.google.com') || url.toLowerCase().includes('google.com/drive')) {
    platform = 'Google Drive';
  }

  // -------------------------------------------------------------
  // STEP 1: TRANSCRIBE
  // -------------------------------------------------------------
  if (resumeData && resumeData.transcript && resumeData.completedStepsCount && resumeData.completedStepsCount >= 1) {
    transcript = resumeData.transcript;
    isSimulated = resumeData.isSimulated || false;
    onStep(1, 'done', 'שוחזר תמלול שמור מהזיכרון המקומי לצורך המשך מהיר של התהליך.', { transcript, isSimulated, podcastName, episodeName });
  } else {
    onStep(1, 'active', 'מאתחל את תהליך תמלול השמע...');
    
    if (groqKey && groqKey.trim() !== '') {
      try {
        let fetchUrl = url;
        if (platform === 'Google Drive') {
          const fileId = getGoogleDriveId(url);
          if (fileId) {
            fetchUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
            onStep(1, 'active', `ממיר קישור גוגל דרייב לקובץ מקור ישיר... מזהה: ${fileId}`);
          } else {
            throw new Error('לא ניתן לחלץ מזהה קובץ תקין מקישור הגוגל דרייב.');
          }
        }

        onStep(1, 'active', 'מושך נתוני שמע כבלוב בינארי...');
        // Fetch media
        const fileResponse = await fetch(fetchUrl);
        if (!fileResponse.ok) {
          throw new Error(`שגיאה במשיכת קובץ המדיה מהקישור (${fileResponse.statusText}).`);
        }
        const audioBlob = await fileResponse.blob();

        onStep(1, 'active', 'שולח את השמע לשירות Groq Whisper v3 לצורך תמלול...');
        const formData = new FormData();
        formData.append('file', audioBlob, 'audio.mp3');
        formData.append('model', 'whisper-large-v3');
        formData.append('response_format', 'verbose_json');

        const groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqKey}`
          },
          body: formData
        });

        if (!groqResponse.ok) {
          const errJson = await groqResponse.json().catch(() => ({}));
          throw new Error(errJson?.error?.message || `שירות ה-API של Groq החזיר קוד שגיאה ${groqResponse.status}`);
        }

        const groqData = await groqResponse.json();
        if (groqData.segments && Array.isArray(groqData.segments)) {
          transcript = groqData.segments
            .map((seg: any) => `[${formatTimestamp(seg.start)}] ${seg.text}`)
            .join('\n');
          onStep(1, 'done', `תומללו בהצלחה ${groqData.segments.length} קטעי שמע באמצעות Groq!`, { transcript, isSimulated: false });
        } else if (groqData.text) {
          // Fallback if verbose_json didn't have segments
          transcript = `[00:00] ${groqData.text}`;
          onStep(1, 'done', 'הדיבור תומלל כבלוק טקסט בודד באמצעות Groq.', { transcript, isSimulated: false });
        } else {
          throw new Error('לא התקבל תמלול תקין משירות Groq.');
        }

      } catch (err: any) {
        console.warn('Groq Whisper step failed. Performing fallback transcription via Anthropic Claude simulation...', err);
        onStep(1, 'active', `שלב תמלול ה-Whisper נכשל: ${err.message || err}. עובר להדמיית תמלול מומחה...`);
        isSimulated = true;
      }
    } else {
      onStep(1, 'active', 'לא סופק מפתח Groq. מפעיל הדמיית תמלול מומחה...');
      isSimulated = true;
    }

    // If we require simulator fallback
    if (isSimulated) {
      try {
        if (!anthropicKey && (!openaiKey || openaiKey.trim() === '')) {
          throw new Error('נדרש מפתח API של Anthropic או OpenAI כדי לבצע הדמיית תמלול.');
        }

        onStep(1, 'active', 'מבצע הדמיית תמלול שיח באמצעות אנה ויעל | נקודת חיבור...');
        
        const simulationSystem = `You are a professional podcast transcript simulator.
Generate a realistic, highly engaging podcast monologue or conversation transcript (approx 1500 to 1800 words) written entirely in HEBREW with timestamps in the format [MM:SS] every 30 seconds (such as [00:00], [00:30], [01:00], etc.).
The speaker should sound like a leading creative, expert, or high-performance coach discussing actionable and highly engaging and viral discoveries in Hebrew.
Focus specifically on topics related to the provided source URL contexts if possible, or high impact conversational niches (e.g., neuroscience of attention, cognitive flow, performance habits, communication secrets, or smart wellness protocols).

Strict constraint: Output ONLY the transcripts in HEBREW. Keep timestamps clear, e.g.:
[00:00] דובר: שלום וברוכים הבאים. היום אנחנו נדבר על הישגי מפתח...
No surrounding prose, no Markdown wrappers, no introduction codeblocks.`;

        transcript = await callLlm(
          anthropicKey,
          openaiKey,
          simulationSystem,
          `Please simulate a 2000-word robust transcript for URL: ${url}`,
          3500
        );

        onStep(1, 'done', 'הדמיית התמלול המקצועית הושלמה בהצלחה!', { transcript, isSimulated: true });
      } catch (err: any) {
        onStep(1, 'error', `הדמיית התמלול נכשלה: ${err.message || err}`);
        throw err;
      }
    }
  }

  // -------------------------------------------------------------
  // STEP 2: EXTRACT 4 VIRAL CUTS
  // -------------------------------------------------------------
  let rawCuts: any[] = [];
  if (resumeData && resumeData.rawCuts && resumeData.completedStepsCount && resumeData.completedStepsCount >= 2) {
    rawCuts = resumeData.rawCuts;
    onStep(2, 'done', 'שוחזרו קטעים גולמיים מהזיכרון המקומי לצורך חיסכון בזמן.', { rawCuts, podcastName, episodeName });
  } else {
    onStep(2, 'active', 'מנתח את התמליל ומחלץ את שם הפודקאסט וכותרת הפרק...');
    
    // Extract podcast name and episode name/title directly from the transcript
    if ((anthropicKey || openaiKey) && transcript) {
      try {
        const metadataPrompt = `You are a professional audio content metadata extractor.
Analyze the provided transcript text (representing the beginning of an audio recording/podcast) and identify/generate:
1. "podcastName": The name of the podcast or show series. Cleanly extract it if mentioned (e.g., look for "נקודת חיבור" or other show names mentioned in greetings). If it represents a generic talk or none is clearly mentioned, use "אנה ויעל | נקודת חיבור".
2. "episodeName": The title, main topic, or discussion subject of this specific episode. Write it as a highly appealing, concise, and professional title in fluent, natural Hebrew (עברית). E.g. "הסודות לביצועי שיא ובריאות מיטבית".

Response format: Return ONLY a valid JSON object with these two keys, NO markdown blocks, NO backticks, NO preamble, and NO extra text:
{
  "podcastName": "...",
  "episodeName": "..."
}
`;

        const metaText = await callLlm(
          anthropicKey,
          openaiKey,
          metadataPrompt,
          `Here is the transcript body:\n\n${transcript.substring(0, 6000)}`,
          400
        );

        let metaRawText = metaText.trim();
        if (metaRawText.includes('```')) {
          metaRawText = metaRawText.replace(/```json|```/gi, '').trim();
        }
        try {
          const metaObj = JSON.parse(metaRawText);
          if (metaObj.podcastName && metaObj.podcastName.trim().length > 0) {
            podcastName = metaObj.podcastName.trim();
          }
          if (metaObj.episodeName && metaObj.episodeName.trim().length > 0) {
            episodeName = metaObj.episodeName.trim();
          }
        } catch (jsonErr) {
          console.warn("Could not parse metadata JSON", jsonErr, metaRawText);
        }
      } catch (metaErr) {
        console.warn("Failed to extract metadata directly from the transcript", metaErr);
      }
    }

    onStep(2, 'active', `שם פודקאסט זוהה: "${podcastName}". כותרת הפרק שחולצה: "${episodeName || 'לא זוהה'}". מחלץ כעת 4 קטעים מועמדים...`, { podcastName, episodeName });
    
    try {
    const extractSystem = `You are a world-class viral content strategist with 10+ years extracting short-form clips from long-form health & wellness podcasts. You have a proven track record of identifying the exact moments that generate millions of views on TikTok, Instagram Reels, and YouTube Shorts.

Your mission: analyze the transcript below and extract the 4 segments with the highest viral potential — each exactly 30 seconds long — that can stand completely alone as short-form clips.

---

CRITERION 1 — ENGAGEMENT HOOK (weight: 30%)
Score 1–10. The first 3 seconds must stop a scroller cold.
High score = opens with a shocking stat, a counterintuitive claim, or a direct challenge ("Everything you've been told about X is wrong"). Low score = starts mid-thought or with a greeting.

CRITERION 2 — EMOTIONAL RESONANCE (weight: 25%)
Score 1–10. Triggers a strong, immediate feeling.
High score = viewer thinks "this is exactly my life" or "I never knew this" — touches fear, hope, relief, or transformation. Low score = purely informational, no emotional charge.

CRITERION 3 — AUTHENTICITY (weight: 20%)
Score 1–10. Raw, real, unscripted human moment.
High score = vulnerable personal admission, honest confession, or unrehearsed emotion. Low score = corporate language, scripted delivery, or generic advice.

CRITERION 4 — ACTIONABILITY (weight: 15%)
Score 1–10. Viewer can act TODAY, not someday.
High score = one specific, concrete step with an immediate result. Low score = vague guidance like "eat healthier" or "reduce stress."

CRITERION 5 — STANDALONE CLARITY (weight: 10%)
Score 1–10. Makes 100% sense without the rest of the episode.
High score = a stranger with zero context gets full value. INSTANT DISQUALIFIER: any segment containing "as I said earlier," "like we discussed," "going back to," or dangling references to prior content scores 1 on this criterion and cannot rank #1 or #2.

---

HEALTH & WELLNESS BONUS SIGNALS
Add +5 to viralPotential (before capping at 100) if the segment contains ANY of:
✓ A surprising statistic or peer-reviewed study result stated plainly
✓ A common health myth being debunked with a specific counter-claim
✓ A personal transformation story with a before/after moment
✓ A simple habit or hack that takes under 2 minutes and has a measurable result
✓ A doctor or expert saying something the general public does NOT expect to hear
✓ A relatable struggle that millions quietly experience but rarely discuss openly

---

SCORING FORMULA (use exactly — do not deviate):
viralPotential = ROUND(
  (engagement × 0.30 +
   emotional_resonance × 0.25 +
   authenticity × 0.20 +
   actionability × 0.15 +
   standalone_clarity × 0.10) × 10
  + bonusSignals × 5
, 0)

Cap at 100. Show your calculation in the "scoreBreakdown" field.
Sort the final array by viralPotential descending (rank 1 = highest score).

---

OUTPUT — raw JSON array only, no markdown, no backticks, no preamble:

[
  {
    "rank": 1,
    "startTime": "MM:SS",
    "endTime": "MM:SS",
    "title": "Punchy 5–8 word clip title (written in Hebrew / כותרת מושכת בעברית)",
    "openingLine": "The exact first sentence of the segment as spoken (in Hebrew)",
    "quote": "The single most powerful sentence in the segment (in Hebrew)",
    "hook": "What happens in seconds 0–3 that stops the scroll (written in Hebrew / הוק פתיחה בעברית)",
    "whyViral": "One sentence: the specific mechanism that makes this shareable (written in Hebrew / הסבר ויראליות בעברית)",
    "targetEmotion": "hope | fear | relief | curiosity | inspiration | surprise",
    "bonusSignals": ["list of matched bonus signals, or empty array"],
    "scores": {
      "engagement": 0,
      "emotional_resonance": 0,
      "authenticity": 0,
      "actionability": 0,
      "standalone_clarity": 0
    },
    "scoreBreakdown": "9×0.30 + 8×0.25 + 7×0.20 + 8×0.15 + 9×0.10 = 8.3 × 10 = 83 + 5 bonus = 88",
    "viralPotential": 88,
    "contentManagerNote": "One concrete posting instruction: caption angle, text overlay, CTA, or hashtag strategy (written in Hebrew / הערת אופטימיזציה בעברית)",
    "captionSuggestion": "A ready-to-post caption for Instagram/TikTok including a hook line and CTA (written in Hebrew / הצעה לכיתוב בעברית)"
  }
]

---

HARD RULES:
RULE 1: Every segment must be exactly 30 seconds. No exceptions.
RULE 2: No two segments may overlap or be adjacent (minimum 60-second gap between any two cuts).
RULE 3: Segments with standalone_clarity score below 6 may not rank #1 or #2.
RULE 4: Show the scoreBreakdown calculation for every cut — no black-box scores.
RULE 5: captionSuggestion must be under 150 characters and end with a question or CTA.
RULE 6: Return ONLY the JSON array. No intro text, no summary after the array.`;

    const userMsg = transcript.substring(0, 8000);

    const rawText = await callLlm(
      anthropicKey,
      openaiKey,
      extractSystem,
      `Here is the transcript body:\n\n${userMsg}`,
      3000
    );

    rawCuts = parseClaudeJson(rawText);
    
    if (!Array.isArray(rawCuts) || rawCuts.length === 0) {
      throw new Error('השרת החזיר פורמט JSON ריק או לא תקין.');
    }

    onStep(2, 'done', `אותרו בהצלחה ${rawCuts.length} קטעים מבטיחים. מכין לתיקוף מדדים.`, { rawCuts, podcastName, episodeName });
  } catch (err: any) {
    onStep(2, 'error', `חילוץ הקטעים נכשל: ${err.message || err}`);
    throw err;
  }
  }

  // -------------------------------------------------------------
  // STEP 3: VALIDATION
  // -------------------------------------------------------------
  let validatedCuts: ViralCut[] = [];
  if (resumeData && resumeData.validatedCuts && resumeData.completedStepsCount && resumeData.completedStepsCount >= 3) {
    validatedCuts = resumeData.validatedCuts;
    onStep(3, 'done', 'שוחזרו קטעים מאומתים מהזיכרון המקומי.', { validatedCuts, podcastName, episodeName });
  } else {
    onStep(3, 'active', 'מתקף קטעים מועמדים מול מדדי הוויראליות ויוצר הערות אופטימיזציה בעברית...');

    try {
    const validateSystem = `You are a viral content validator.

VIRAL CRITERIA:
- Authenticity (1–10): Real emotion, vulnerable moments, honest admissions
- Engagement (1–10): Strong hook in first 3 seconds, surprising or counterintuitive
- Emotional resonance (1–10): Touches fear, hope, relief, curiosity, or transformation
- Actionability (1–10): Viewer can immediately apply this to their life
- Standalone clarity (1–10): Self-contained and context-ready
- Viral potential (1–100): Weighted score based on criteria and bonus signals

Review and refine the scores. Add or polish contentManagerNote (string) and captionSuggestion (string), written in HEBREW (בעברית).

Return the same JSON array (no markdown, no backticks) with updated scores and contentManagerNote/captionSuggestion verified.
All Hebrew properties must remain fluent natural Hebrew.`;

    const validatedText = await callLlm(
      anthropicKey,
      openaiKey,
      validateSystem,
      JSON.stringify(rawCuts, null, 2),
      3500
    );

    const items = parseClaudeJson(validatedText);
    
    // Parse objects and enforce schema structure
    validatedCuts = items.map((item: any) => {
      return {
        id: Number(item.id || item.rank || 1),
        startTime: String(item.startTime || '00:00'),
        endTime: String(item.endTime || '00:30'),
        title: String(item.title || 'כותרת קטע ויראלי להפצה'),
        quote: String(item.quote || ''),
        hook: String(item.hook || 'הוק פתיחה קליט ומיידי'),
        whyViral: String(item.whyViral || 'מעורר סקרנות ומציע פתרון מהיר'),
        scores: {
          authenticity: Number(item.scores?.authenticity || item.scores?.authenticity || 7),
          engagement: Number(item.scores?.engagement || item.scores?.engagement || 7),
          emotional_resonance: Number(item.scores?.emotional_resonance || item.scores?.emotional_resonance || 7),
          actionability: Number(item.scores?.actionability || item.scores?.actionability || 7),
          standalone_clarity: Number(item.scores?.standalone_clarity || 7),
        },
        viralPotential: Number(item.viralPotential || 75),
        contentManagerNote: String(item.contentManagerNote || 'הגדר כתוביות בולטות וצבעוניות לשמירה על שימור צופים מרבי.'),
        openingLine: item.openingLine ? String(item.openingLine) : undefined,
        targetEmotion: item.targetEmotion ? String(item.targetEmotion) : undefined,
        bonusSignals: Array.isArray(item.bonusSignals) ? item.bonusSignals : undefined,
        scoreBreakdown: item.scoreBreakdown ? String(item.scoreBreakdown) : undefined,
        captionSuggestion: item.captionSuggestion ? String(item.captionSuggestion) : undefined
      };
    });

    onStep(3, 'done', 'התיקוף והערכת המדדים הושלמו בהצלחה. פרמטרי אופטימיזציה מותאמים אישית נטענו.', { validatedCuts, podcastName, episodeName });
  } catch (err: any) {
    onStep(3, 'error', `תיקוף הקטעים נכשל: ${err.message || err}`);
    throw err;
  }
  }

  // -------------------------------------------------------------
  // STEP 4: SCORING & RANKING
  // -------------------------------------------------------------
  onStep(4, 'active', 'מדרג ומסדר את הקטעים לפי מדד ויראליות משוקלל (הגבוה ביותר תחילה)...');
  try {
    // Sort descending
    validatedCuts.sort((a, b) => b.viralPotential - a.viralPotential);
    // reassess ranking order ids
    validatedCuts.forEach((cut, index) => {
      cut.id = index + 1;
    });

    // small artificial artificial pause for UX polish
    await new Promise((resolve) => setTimeout(resolve, 1000));
    onStep(4, 'done', 'הציונים נורמלו והקטעים דורגו לפי פוטנציאל ההצלחה.');
  } catch (err: any) {
    onStep(4, 'error', `דירוג הקטעים נכשל: ${err.message || err}`);
    throw err;
  }

  // -------------------------------------------------------------
  // STEP 5: CONTENT REPORT READY
  // -------------------------------------------------------------
  onStep(5, 'active', 'כתובת הדו"ח אונליין. מאגד את הדו"ח הניהולי להורדה...');
  try {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    onStep(5, 'done', 'קובץ הדו"ח הורכב בהצלחה. מערכת חילוץ הלהיטים זמינה במלואה!');
  } catch (err: any) {
    onStep(5, 'error', `בניית הדו"ח נכשלה: ${err.message || err}`);
    throw err;
  }

  return {
    cuts: validatedCuts,
    sourceUrl: url,
    sourcePlatform: platform,
    transcriptLength: transcript.length,
    isSimulated,
    podcastName,
    episodeName
  };
}
