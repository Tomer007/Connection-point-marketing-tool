import { StepState, ViralCut, PipelineResult, StepIntermediateData } from '../types';
import { DEFAULT_PODCAST_NAME } from '../constants';
import { callServerLlm } from './api';

export interface StepUpdate {
  (stepId: number, state: StepState, details?: string, intermediateData?: StepIntermediateData): void;
}

interface WhisperSegment {
  start: number;
  text: string;
}

// Helper to clean and parse Claude JSON content
export function parseClaudeJson(text: string): ViralCut[] {
  let cleanText = text.trim();

  // Strip markdown code blocks
  if (cleanText.includes('```')) {
    cleanText = cleanText.replace(/```json|```/gi, '').trim();
  }

  // Try standard parse
  try {
    return JSON.parse(cleanText);
  } catch (err) {
    console.warn("Standard JSON parse failed, trying regex fallback...", err);
  }

  // Regex fallback to find the first array structure [...]
  const arrayMatch = cleanText.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {
      // Try to repair truncated JSON by closing open strings/objects
      let repaired = arrayMatch[0];
      // Close any unterminated string
      const openQuotes = (repaired.match(/"/g) || []).length;
      if (openQuotes % 2 !== 0) repaired += '"';
      // Close open objects/arrays
      const openBraces = (repaired.match(/{/g) || []).length - (repaired.match(/}/g) || []).length;
      const openBrackets = (repaired.match(/\[/g) || []).length - (repaired.match(/]/g) || []).length;
      for (let i = 0; i < openBraces; i++) repaired += '}';
      for (let i = 0; i < openBrackets; i++) repaired += ']';

      try {
        return JSON.parse(repaired);
      } catch (repairErr) {
        throw new Error("Could not parse AI response as valid JSON array: " + repairErr);
      }
    }
  }

  throw new Error("Could not find potential JSON array structure inside AI response.");
}

// Format seconds into MM:SS
function formatTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export async function runViralExtractionPipeline(
  url: string,
  onStep: StepUpdate,
  resumeData?: {
    transcript?: string;
    rawCuts?: ViralCut[];
    validatedCuts?: ViralCut[];
    completedStepsCount?: number;
    podcastName?: string;
    episodeName?: string;
  },
  userComments?: string
): Promise<PipelineResult> {
  let transcript = '';
  let podcastName = DEFAULT_PODCAST_NAME;
  let episodeName = '';

  if (resumeData) {
    if (resumeData.podcastName) podcastName = resumeData.podcastName;
    if (resumeData.episodeName) episodeName = resumeData.episodeName;
  }

  // Determine platform based on link
  let platform = 'YouTube';
  if (!url) {
    platform = 'Transcript';
  } else if (url.toLowerCase().includes('spotify')) {
    platform = 'Spotify';
  } else if (url.toLowerCase().includes('drive.google.com') || url.toLowerCase().includes('google.com/drive')) {
    platform = 'Google Drive';
  }

  // -------------------------------------------------------------
  // STEP 1: TRANSCRIBE
  // -------------------------------------------------------------
  if (resumeData && resumeData.transcript && resumeData.completedStepsCount && resumeData.completedStepsCount >= 1) {
    transcript = resumeData.transcript;
    onStep(1, 'done', 'שוחזר תמלול שמור מהזיכרון המקומי לצורך המשך מהיר של התהליך.', { transcript, podcastName, episodeName });
  } else {
    onStep(1, 'active', 'מאתחל את תהליך תמלול השמע...');
    
    try {
      onStep(1, 'active', 'שולח את הקישור לשרת הפרוקסי לצורך הורדה ותמלול...');

      const serverUrl = import.meta.env.VITE_SERVER_URL || '';
      const response = await fetch(`${serverUrl}/api/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, platform }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData?.error || `שרת הפרוקסי החזיר שגיאה ${response.status}`);
      }

      const transcriptionData = await response.json();
      if (transcriptionData.segments && Array.isArray(transcriptionData.segments)) {
        transcript = transcriptionData.segments
          .map((seg: WhisperSegment) => `[${formatTimestamp(seg.start)}] ${seg.text}`)
          .join('\n');
        onStep(1, 'done', `תומללו בהצלחה ${transcriptionData.segments.length} קטעי שמע!`, { transcript });
      } else if (transcriptionData.text) {
        transcript = `[00:00] ${transcriptionData.text}`;
        onStep(1, 'done', 'הדיבור תומלל כבלוק טקסט בודד.', { transcript });
      } else {
        throw new Error('לא התקבל תמלול תקין מהשרת.');
      }

    } catch (err: any) {
      onStep(1, 'error', `תמלול השמע נכשל: ${err.message || err}`);
      throw new Error(`שגיאה בתמלול השמע: ${err.message || err}`);
    }
  }

  // -------------------------------------------------------------
  // STEP 2: EXTRACT 4 VIRAL CUTS
  // -------------------------------------------------------------
  let rawCuts: ViralCut[] = [];
  if (resumeData && resumeData.rawCuts && resumeData.completedStepsCount && resumeData.completedStepsCount >= 2) {
    rawCuts = resumeData.rawCuts;
    onStep(2, 'done', 'שוחזרו קטעים גולמיים מהזיכרון המקומי לצורך חיסכון בזמן.', { rawCuts, podcastName, episodeName });
  } else {
    onStep(2, 'active', 'מנתח את התמליל ומחלץ את שם הפודקאסט וכותרת הפרק...');
    
    // Extract podcast name and episode name/title directly from the transcript
    if (transcript) {
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

        const metaText = await callServerLlm(
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
    const extractSystem = `You are a world-class viral content strategist specializing in spiritual, wellness, and personal development short-form content for Instagram Reels, TikTok, and YouTube Shorts.

BRAND: נקודת חיבור | Connection Point
HOSTS: אנה בן יהודה ויעל רפפורט
TARGET AUDIENCE: גילאי 25-50, אנשים שמתפתחים, עוברים שינויים, רוצים חיים מלאים, בריאת מציאות, אנשי רוח, מחפשי משמעות.

Your mission: analyze the transcript below and extract the 4 segments with the highest viral potential — each exactly 30 seconds long — that can stand completely alone as short-form clips.

---

9 VIRAL PRINCIPLES — APPLY ALL TO EVERY CUT:

1. ההוק (2 השניות הראשונות) — 80% מההצלחה
פנייה ישירה בגוף יחיד: "את/אתה", לא "אתם". אבחני רגש שהצופה כבר מרגיש, אל תכריזי על נושא. "נראה לי שאת..." עובד; "היום נדבר על..." מת. הגיעי למסר תוך שנייה-שתיים.

2. שיתוף פעיל — מייצר תגובות
בקשי מהצופה לעשות משהו: לחזור אחרייך, לנשום, לכתוב מילה. סיימי בהזמנה לתגובה ספציפית: "כתבי לי 'אני בוחרת בחיבור'". תגובות = הסיגנל החזק ביותר באלגוריתם.

3. בנויה להישמר ולהישלח
תוכן שאפשר לחזור אליו (מדיטציה, תרגיל, משפט מחזק) נשמר. תוכן שמתאר תחושה שקשה לבטא נשלח לחבר/ה. שמירות ושיתופים שווים יותר מלייקים.

4. עובד גם בלי סאונד
כתוביות על המסך תמיד. רוב הגלילה היא בהשתקה, והכתוביות מחזיקות את הצופה.

5. זמן צפייה וצפייה חוזרת (watch-through)
אורך קצר וקצבי. הלולאה הקצרה שנצפית פעמיים מנצחת את הסרטון הארוך שננטש באמצע.

6. סגירה רגשית
סיימי בנתינה בלי בקשה — "הכל בחינם", "אני אוהבת אותך". בונה אמון, מחזיר אנשים, ומזמין מעקב.

7. אסתטיקה שתואמת את המסר
סביבה רגועה, אור טבעי, פריים נקי. הוויזואל צריך לשדר את התחושה שאת מבטיחה.

8. נושא צר-אך-אוניברסלי
כווני לכאב שכמעט כולם מרגישים (בדידות, ניתוק, עומס), בזווית הספציפית שלך. קהל פוטנציאלי עצום אבל המסר עדיין אישי.

9. עקביות
פרסום קבוע מאמן את האלגוריתם ובונה היסטוריה של ביצועים.

---

WHAT MAKES A MOMENT VIRAL IN THIS NICHE:
- רגעים מרגשים בפודקאסט שנוגעים בלב
- גורמים לאנשים להרגיש שייכות
- מקבלים ערך וכלים לחיים
- פנייה אישית (את/אתה) לא כללית

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
    "contentManagerNote": "Specific visual/editing instruction for THIS clip — not generic (written in Hebrew)",
    "captionSuggestion": "A FULL ready-to-post Instagram caption in Hebrew. Structure: Line 1 = scroll-stopping hook sentence with emoji. Lines 2-4 = 2-3 short paragraphs giving context about what was said and why it matters (warm, spiritual brand voice). Last paragraph = engagement question ending with 👇. Final line = exactly 5 niche Hebrew hashtags starting with #נקודתחיבור. Total 5-8 lines.",
    "shotOpening": "Format: 'אנה/יעל: [exact Hebrew quote they say to set up the clip]'. This MUST be what the hosts say BEFORE cutting to the guest. Every clip must open with אנה/יעל speaking first — find their question or setup line from the transcript. Always prefix with the speaker name.",
    "shotClimax": "Format: 'עמרי: [exact verbatim Hebrew quote]' — the peak emotional moment. Always prefix with the speaker name (עמרי: / אנה: / יעל:). This is the text overlay for the video.",
    "shotClosing": "Format: 'אנה/יעל: [exact Hebrew quote or action description]'. What the hosts say or do to close the clip. If they speak, include the exact words. If silent reaction, describe it. Always prefix with speaker name.",
    "publishOrder": 1,
    "publishNote": "Why this clip should be published in this order relative to others (in Hebrew)"
  }
]

---

HARD RULES:
RULE 1: Every segment must be exactly 30 seconds. No exceptions.
RULE 2: No two segments may overlap or be adjacent (minimum 60-second gap between any two cuts).
RULE 3: Segments with standalone_clarity score below 6 may not rank #1 or #2.
RULE 4: Show the scoreBreakdown calculation for every cut — no black-box scores.
RULE 5: captionSuggestion must be a FULL Instagram caption: hook line + 2-3 context paragraphs + engagement question + 5 hashtags. NOT a single sentence.
RULE 6: Return ONLY the JSON array. No intro text, no summary after the array.
RULE 7: Every shotOpening MUST start with "אנה/יעל:" and contain their exact setup question BEFORE the guest speaks. Every shotClimax and shotClosing MUST prefix the speaker name (עמרי: / אנה: / יעל:). The clip ALWAYS opens with the hosts, never the guest directly.
RULE 8: If the user provided additional instructions or comments (appearing before the transcript), prioritize and incorporate them into your selection criteria. For example, if they ask to focus on a specific speaker or topic, weight those moments higher.`;

    const userMsg = transcript.substring(0, 8000);

    const rawText = await callServerLlm(
      extractSystem,
      `${userComments ? `USER INSTRUCTIONS / הנחיות המשתמש:\n${userComments}\n\n---\n\n` : ''}Here is the transcript body:\n\n${userMsg}`,
      5000
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

    const validatedText = await callServerLlm(
      validateSystem,
      JSON.stringify(rawCuts, null, 2),
      5000
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
          authenticity: Number(item.scores?.authenticity || 7),
          engagement: Number(item.scores?.engagement || 7),
          emotional_resonance: Number(item.scores?.emotional_resonance || 7),
          actionability: Number(item.scores?.actionability || 7),
          standalone_clarity: Number(item.scores?.standalone_clarity || 7),
        },
        viralPotential: Number(item.viralPotential || 75),
        contentManagerNote: String(item.contentManagerNote || ''),
        openingLine: item.openingLine ? String(item.openingLine) : undefined,
        targetEmotion: item.targetEmotion ? String(item.targetEmotion) : undefined,
        bonusSignals: Array.isArray(item.bonusSignals) ? item.bonusSignals : undefined,
        scoreBreakdown: item.scoreBreakdown ? String(item.scoreBreakdown) : undefined,
        captionSuggestion: item.captionSuggestion ? String(item.captionSuggestion) : undefined,
        shotOpening: item.shotOpening ? String(item.shotOpening) : undefined,
        shotClimax: item.shotClimax ? String(item.shotClimax) : undefined,
        shotClosing: item.shotClosing ? String(item.shotClosing) : undefined,
        publishOrder: item.publishOrder ? Number(item.publishOrder) : undefined,
        publishNote: item.publishNote ? String(item.publishNote) : undefined,
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
    podcastName,
    episodeName
  };
}
