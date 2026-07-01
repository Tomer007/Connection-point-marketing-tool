import { StepState, ViralCut, PipelineResult, StepIntermediateData } from '../types';
import { DEFAULT_PODCAST_NAME } from '../constants';
import { callServerLlm } from './api';
import { METADATA_PROMPT } from './prompts/metadataPrompt';
import { buildTranscriptCleanupPrompt } from './prompts/transcriptCleanupPrompt';

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
    const parsed = JSON.parse(cleanText);
    // Handle wrapped object from OpenAI json_object mode (e.g. { "cuts": [...] })
    if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
      // Look for the first array property
      const arrayProp = Object.values(parsed).find(v => Array.isArray(v));
      if (arrayProp && Array.isArray(arrayProp) && arrayProp.length > 0) {
        return arrayProp;
      }
      // Single object response (when clipCount=1, LLM may return {} instead of [{}])
      if (parsed.startTime || parsed.title || parsed.rank) {
        return [parsed];
      }
    }
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (err) {
    console.warn("Standard JSON parse failed, trying regex fallback...", err);
  }

  // Regex fallback: try to find an array [...]
  const arrayMatch = cleanText.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {
      // Try to repair truncated JSON by closing open strings/objects
      let repaired = arrayMatch[0];
      const openQuotes = (repaired.match(/"/g) || []).length;
      if (openQuotes % 2 !== 0) repaired += '"';
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

  // Regex fallback: try to find a single object {...}
  const objectMatch = cleanText.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const obj = JSON.parse(objectMatch[0]);
      return [obj];
    } catch {
      // Try repair
      let repaired = objectMatch[0];
      const openQuotes = (repaired.match(/"/g) || []).length;
      if (openQuotes % 2 !== 0) repaired += '"';
      const openBraces = (repaired.match(/{/g) || []).length - (repaired.match(/}/g) || []).length;
      for (let i = 0; i < openBraces; i++) repaired += '}';
      try {
        return [JSON.parse(repaired)];
      } catch { /* fall through */ }
    }
  }

  throw new Error("Could not find potential JSON structure inside AI response.");
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
  userComments?: string,
  clipCount: number = 1
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
  let skipCleanup = false;
  if (resumeData && resumeData.transcript && resumeData.completedStepsCount && resumeData.completedStepsCount >= 1) {
    transcript = resumeData.transcript;
    skipCleanup = true; // Cached transcript is already cleaned
    onStep(1, 'done', '📋 שוחזר תמלול מנוקה מהמטמון (חוסך תמלול + ניקוי מחדש).', { transcript, podcastName, episodeName });
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

    } catch (err: unknown) {
      onStep(1, 'error', `תמלול השמע נכשל: ${err instanceof Error ? err.message : String(err)}`);
      throw new Error(`שגיאה בתמלול השמע: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- LLM Cleanup Pass: fix Hebrew artifacts, add speaker labels, repair boundaries ---
  if (!skipCleanup && transcript && transcript.length > 100) {
    try {
      onStep(1, 'active', 'מבצע תיקון שגיאות תמלול, זיהוי דוברים ותיקון גבולות משפטים...');

      // Process in chunks of ~4000 chars to stay within token limits
      const CHUNK_SIZE = 4000;
      const lines = transcript.split('\n');
      const chunks: string[] = [];
      let currentChunk = '';

      for (const line of lines) {
        if ((currentChunk + '\n' + line).length > CHUNK_SIZE && currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = line;
        } else {
          currentChunk = currentChunk ? currentChunk + '\n' + line : line;
        }
      }
      if (currentChunk) chunks.push(currentChunk);

      // Process each chunk through LLM cleanup
      const cleanedChunks: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        try {
          const cleaned = await callServerLlm(
            buildTranscriptCleanupPrompt(),
            chunks[i],
            4000
          );
          const trimmed = cleaned.trim();
          // If cleanup returned something suspiciously short (less than 20% of input),
          // the LLM likely failed silently — keep original chunk
          if (trimmed.length < chunks[i].length * 0.2 || trimmed.length < 20) {
            console.warn(`[Cleanup] Chunk ${i + 1} returned suspiciously short (${trimmed.length} chars vs ${chunks[i].length} input). Keeping original.`);
            cleanedChunks.push(chunks[i]);
          } else {
            cleanedChunks.push(trimmed);
          }
        } catch (cleanupErr) {
          // If cleanup fails for a chunk, keep original
          console.warn(`[Cleanup] Chunk ${i + 1} failed, keeping original`, cleanupErr);
          cleanedChunks.push(chunks[i]);
        }
      }

      transcript = cleanedChunks.join('\n');
      onStep(1, 'done', `תמלול נוקה בהצלחה: תיקון שגיאות עברית, זיהוי דוברים ותיקון גבולות משפטים. (${chunks.length} קטעים עובדו)`, { transcript, podcastName, episodeName });
    } catch (cleanupErr) {
      // If the entire cleanup fails, continue with raw transcript
      console.warn('[Cleanup] Full cleanup pass failed, using raw transcript', cleanupErr);
      onStep(1, 'done', 'תמלול הושלם (ללא תיקון שגיאות — שלב הניקוי נכשל).', { transcript, podcastName, episodeName });
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
        const metaText = await callServerLlm(
          METADATA_PROMPT,
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
    const extractSystem = `You are a world-class viral content strategist specializing in spiritual, somatic, and personal development short-form content for Instagram Reels, TikTok, and YouTube Shorts.

BRAND: נקודת חיבור | Connection Point
HOSTS: אנה בן יהודה ויעל רפפורט
CORE THEMES: גוף • רגש • תודעה • אנרגיה | ריפוי סומטי | שחרור דפוסים | בריאת מציאות | חיבור אותנטי
TARGET AUDIENCE: גילאי 25-50, אנשים שמתפתחים, עוברים שינויים, מרגישים עומס/תקיעות/כאבים כרוניים, מחפשי ריפוי וחיים מלאים יותר.

Your mission: analyze the transcript below and extract up to ${clipCount} segment${clipCount > 1 ? 's' : ''} with the highest viral potential, each 28 to 35 seconds long, that can stand completely alone as powerful short-form clips. Quality over quantity: only include a segment if its viralPotential is 60 or higher. If fewer than ${clipCount} clear that bar, return only those that do. Never pad with weak clips.

INPUT FORMAT:
The transcript should include speaker labels and timestamps.
- If timestamps are missing, estimate startTime and endTime from position in the transcript, and flag the estimate in contentManagerNote.
- If speaker labels are missing, infer the speaker from context, or use [דובר] / [אורח] as a placeholder, and note it in contentManagerNote.

---

INSTAGRAM ALGORITHM 2026 — OPTIMIZE EVERY CUT FOR THESE SIGNALS (in order of weight):

1. WATCH TIME & COMPLETION (the #1 signal). A clip watched to the end, and rewatched, beats a longer clip abandoned early. The first 3 seconds decide whether the viewer stays. Choose moments with a tight, self-resolving loop that pays off before the viewer can scroll. Short and complete beats long and abandoned.

2. SENDS PER REACH / DM SHARES (the strongest signal for reaching NON-followers, the engine of real growth). Prioritize moments a viewer would privately send to one specific person: "this is exactly you", a feeling named that is hard to put into words, a moment that makes someone think of a person they love. Sends are worth far more than likes for discovery.

3. SAVES (content worth returning to). Body tools, breathing practices, a strengthening sentence. These earn saves.

4. COMMENT DEPTH, not comment count. The caption's closing question must invite a real reply, not a one-word answer.

Also true in 2026: original, made-for-Instagram content gets more distribution than recycled content; under the "Your Algorithm" topic system, niche consistency matters more than ever; hashtags act as topic signals, so use 3 to 5 specific, on-niche Hebrew tags, not a wall of them.

SELECTION IMPLICATION: every clip you choose must be strong on at least one of SEND, SAVE, or REPLAY. State which in the "algorithmLever" field. A clip that triggers none of these will not travel, no matter how moving it felt inside the episode.

---

9 VIRAL PRINCIPLES — APPLY ALL TO EVERY CUT:

1. ההוק (2 השניות הראשונות): 80% מההצלחה
פנייה ישירה בגוף יחיד: "את/אתה", לא "אתם". אבחני רגש שהצופה כבר מרגיש (עומס, תקיעות, ניתוק מהגוף), אל תכריזי על נושא. "נראה לי שאת..." עובד; "היום נדבר על..." מת. הגיעי למסר תוך שנייה-שתיים.

2. שיתוף פעיל: מייצר תגובות
בקשי מהצופה לעשות משהו פשוט (לנשום, להניח יד על הגוף, לכתוב מילה). סיימי בשאלה ספציפית שמזמינה תגובה אמיתית. תגובות ושליחות = הסיגנל החזק ביותר באלגוריתם.

3. בנויה להישמר ולהישלח
תרגילים, משפטי עוצמה, או תחושה שקשה לבטא: דברים שאפשר לחזור אליהם (שמירה) או לשלוח לחברה (שליחה). שמירות ושיתופים שווים יותר מלייקים.

4. עובד גם בלי סאונד
כתוביות גדולות וברורות חובה. רוב הגלילה היא בהשתקה.

5. זמן צפייה גבוה וצפייה חוזרת
קצבי, רגשי, עם לולאה טבעית. הלולאה הקצרה שנצפית פעמיים מנצחת את הסרטון הארוך שננטש באמצע.

6. סגירה רגשית חמה
סיימי בנתינה בלי בקשה: "את לא לבד", "הגוף שלך יודע", "אני אוהבת אותך". בונה אמון, מחזיר אנשים, ומזמין מעקב.

7. אסתטיקה שתואמת את המסר
אור טבעי, סביבה רגועה, מגע בגוף, הבעות פנים אותנטיות: שידור של בטחון וריפוי.

8. נושא צר-אך-אוניברסלי
כאבים כרוניים, עומס רגשי, ניתוק מהגוף, תקיעות: דרך הגישה הספציפית של נקודת חיבור. קהל פוטנציאלי עצום אבל המסר אישי.

9. עקביות
פרסום קבוע של תוכן אמיתי ועמוק מאמן את האלגוריתם ובונה היסטוריה של ביצועים.

---

WHAT MAKES A MOMENT VIRAL IN THIS NICHE — PRIORITIZE THESE:

🔥 TIER 1 (highest priority, these ALWAYS go viral):
- רגע פגיעות אמיתי או שחרור: דמעות, קול רועד, הודאה בטעות/כאב, בקשת סליחה
- רגע טרנספורמציה חי: האסימון נופל בזמן אמת
- סיפור אישי עם מפנה: מכאב/תקיעות אל שחרור/חיבור
- חיבור אנושי עמוק בין אנה ויעל או עם אורח: רגע שבו באמת רואים אחד את השני

🔥 TIER 2 (high priority):
- כלי גוף-רגש פרקטי: נשימה, מגע, תנועה, שחרור שאפשר לעשות עכשיו
- משפט שמתאר בדיוק תחושה שהצופים מרגישים אבל לא ידעו לנסח: "זה בדיוק מה שאני מרגישה"
- שבירת מיתוס: "לימדו אותנו ש... אבל בעצם..."
- רגע של שחרור אנרגיה, חיבור לגוף, או הומור אותנטי שצומח מתוך פגיעות

⚠️ TIER 3 (lower priority, use only if nothing better exists):
- מידע כללי על התפתחות אישית
- הסבר תיאורטי ללא דוגמה אישית
- הקדמות ופתיחות של הפרק

KEY INSIGHT: הרגע הכי ויראלי הוא לא הרגע הכי "שנון", הוא הרגע הכי אמיתי. פגיעות מנצחת שנינות.

---

CRITERION 1 — EMOTIONAL RESONANCE (weight: 35%)
Score 1–10. Triggers a strong, immediate feeling.
High score = viewer thinks "this is exactly my life" or feels their heart tighten, touching vulnerability, hope, relief, grief, or transformation in real-time. Moments where someone cries, apologizes, admits weakness, or has a breakthrough score 9-10. Low score = purely informational, no emotional charge.

CRITERION 2 — AUTHENTICITY & VULNERABILITY (weight: 30%)
Score 1–10. Raw, real, unscripted human moment.
High score = someone exposing their wound, admitting failure, asking for help, showing they're not perfect. A host or guest breaking down, sharing something they've never shared, or revealing something that goes against the "guru" image. Low score = polished advice, rehearsed delivery, or generic wisdom.

CRITERION 3 — ENGAGEMENT HOOK (weight: 15%)
Score 1–10. The first 3 seconds must stop a scroller cold.
High score = opens with a moment of tension, surprise, emotion, or a provocative statement; a question that touches a universal pain. Low score = starts mid-thought, with a greeting, or with context-setting.

CRITERION 4 — ACTIONABILITY & VALUE (weight: 10%)
Score 1–10. Viewer takes something concrete away.
High score = a specific tool (breathing, body practice, reframe technique) or a perspective shift they can apply today. Low score = vague "be more mindful" type advice.

CRITERION 5 — STANDALONE CLARITY (weight: 10%)
Score 1–10. Makes 100% sense without the rest of the episode.
High score = a stranger with zero context gets full value. INSTANT DISQUALIFIER: any segment containing "as I said earlier", "like we discussed", "going back to", or dangling references to prior content scores 1 on this criterion and cannot rank #1 or #2.

---

TRANSFORMATION & CONNECTION BONUS SIGNALS
Apply a flat +5 to viralPotential, once (NOT per signal, NOT stackable), before capping at 100, if the segment contains ANY of:
✓ Someone crying, voice breaking, or showing raw emotion in real-time
✓ A personal story about making a mistake and what it taught them
✓ A moment of genuine apology or asking for forgiveness
✓ A host admitting vulnerability or imperfection (breaking the "expert" mask)
✓ A concrete body-based tool (breathing, movement, touch) demonstrated or explained
✓ A reframe that flips pain/failure into opportunity, with a real personal example
✓ A moment of genuine human connection between two people (presence, not just words)
✓ A relatable struggle (loneliness, feeling stuck, disconnection from the body) named with specificity

The bonus is a tiebreaker for raw, real moments. It is +5 whether the segment matches one signal or five. List every matched signal in the bonusSignals array regardless.

---

SCORING FORMULA (use exactly — do not deviate):
viralPotential = ROUND(
  (emotional_resonance × 0.35 +
   authenticity × 0.30 +
   engagement × 0.15 +
   actionability × 0.10 +
   standalone_clarity × 0.10) × 10
  + bonusFlag
, 0)

where bonusFlag = 5 if the segment matches one or more bonus signals, otherwise 0.
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
    "whyViral": "One sentence: the specific mechanism that makes this shareable, and which algorithm lever it pulls (written in Hebrew)",
    "targetEmotion": "hope | relief | grief | love | connection | inspiration | curiosity | surprise",
    "algorithmLever": "send | save | replay (the primary 2026 Instagram signal this clip is built to trigger; choose ONE)",
    "bonusSignals": ["list of matched bonus signals, or empty array"],
    "scores": {
      "engagement": 0,
      "emotional_resonance": 0,
      "authenticity": 0,
      "actionability": 0,
      "standalone_clarity": 0
    },
    "scoreBreakdown": "9×0.35 + 8×0.30 + 7×0.15 + 8×0.10 + 9×0.10 = 8.30 ×10 = 83, +5 bonus = 88",
    "viralPotential": 88,
    "contentManagerNote": "Specific visual/editing instruction for THIS clip, not generic (written in Hebrew)",
    "captionSuggestion": "A FULL ready-to-post Instagram caption in Hebrew. Structure: Line 1 = scroll-stopping hook sentence with one emoji. Lines 2-4 = 2-3 short paragraphs giving context about what was said and why it matters (warm, spiritual brand voice). Last paragraph = an engagement question that invites a real reply (not a one-word answer) ending with 👇, and where it fits naturally, a soft nudge to send the clip to someone who needs it. Final line = exactly 3 to 5 specific niche Hebrew hashtags starting with #נקודתחיבור. Total 5-8 lines.",
    "shotOpening": "Format: '[Speaker]: [exact Hebrew quote]'. Open on whatever line is the strongest hook in the first 2 seconds, host or guest. Prefer a host (אנה/יעל) setup line only when that line is itself a strong hook; otherwise open on the guest's hook line. Always prefix with the speaker name as it appears in the transcript.",
    "shotClimax": "Format: '[Speaker name]: [exact verbatim Hebrew quote]', the peak emotional moment. Always prefix with the actual speaker name as it appears in the transcript (אנה: / יעל: / [guest name]:). This is the text overlay for the video.",
    "shotClosing": "Format: '[Speaker]: [exact Hebrew quote or action description]'. What the hosts say or do to close the clip. If they speak, include the exact words. If silent reaction, describe it. Always prefix with speaker name.",
    "publishOrder": 1,
    "publishNote": "Why this clip is in this publish position relative to the others (in Hebrew)"
  }
]

---

HARD RULES:
RULE 1: Every segment should be 28 to 35 seconds. Prioritize a clean, self-contained beat over hitting an exact length. A clip that resolves and invites a replay is worth more than one stretched to a target number.
RULE 2: No two segments may overlap or be adjacent (minimum 60-second gap between any two cuts).
RULE 3: Segments with standalone_clarity score below 6 may not rank #1 or #2.
RULE 4: Show the scoreBreakdown calculation for every cut, using the exact formula weights (0.35 / 0.30 / 0.15 / 0.10 / 0.10). No black-box scores.
RULE 5: captionSuggestion must be a FULL Instagram caption: hook line + 2-3 context paragraphs + a real engagement question + 3 to 5 hashtags. NOT a single sentence.
RULE 6: Return ONLY the JSON array. No intro text, no summary after the array.
RULE 7: Always prefix shotClimax and shotClosing with the speaker name exactly as it appears in the transcript. For shotOpening, lead with the strongest hook line (host or guest) that lands in the first 2 seconds; never spend the opening on weak context-setting.
RULE 8: Every selected clip must be strong on at least one of SEND, SAVE, or REPLAY, named in algorithmLever. Do not select a clip that pulls none of these levers.
RULE 9: publishOrder defaults to viralPotential descending (strongest first, to train the algorithm early). Then adjust so no two consecutive clips share the same targetEmotion; if two adjacent clips share an emotion, swap their positions to break the streak. publishNote must state the chosen order's logic in Hebrew.
RULE 10: If the user provided additional instructions before the transcript (focus on a speaker, a topic, etc.), prioritize and incorporate them, weighting those moments higher.
RULE 11: Always keep the warm, contained, professional tone of נקודת חיבור in every Hebrew field you write.`;

    const userMsg = transcript.substring(0, 8000);

    const rawText = await callServerLlm(
      extractSystem,
      `${userComments ? `USER INSTRUCTIONS / הנחיות המשתמש:\n${userComments}\n\n---\n\n` : ''}Here is the transcript body:\n\n${userMsg}`,
      8000
    );

    console.log('[Extract] Raw LLM response length:', rawText.length);
    console.log('[Extract] First 500 chars:', rawText.substring(0, 500));

    rawCuts = parseClaudeJson(rawText);
    
    if (!Array.isArray(rawCuts) || rawCuts.length === 0) {
      console.error('[Extract] Parse succeeded but empty result. Full response:', rawText.substring(0, 2000));
      throw new Error('השרת החזיר פורמט JSON ריק או לא תקין. ייתכן שהתמלול קצר מדי או שה-API חזר ריק.');
    }

    onStep(2, 'done', `אותרו בהצלחה ${rawCuts.length} קטעים מבטיחים. מכין לתיקוף מדדים.`, { rawCuts, podcastName, episodeName });
  } catch (err: unknown) {
    onStep(2, 'error', `חילוץ הקטעים נכשל: ${err instanceof Error ? err.message : String(err)}`);
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
        algorithmLever: item.algorithmLever ? String(item.algorithmLever) : undefined,
      };
    });

    onStep(3, 'done', 'התיקוף והערכת המדדים הושלמו בהצלחה. פרמטרי אופטימיזציה מותאמים אישית נטענו.', { validatedCuts, podcastName, episodeName });
  } catch (err: unknown) {
    onStep(3, 'error', `תיקוף הקטעים נכשל: ${err instanceof Error ? err.message : String(err)}`);
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

    // Brief pause for UI to update
    await new Promise((resolve) => setTimeout(resolve, 300));
    onStep(4, 'done', 'הציונים נורמלו והקטעים דורגו לפי פוטנציאל ההצלחה.');
  } catch (err: unknown) {
    onStep(4, 'error', `דירוג הקטעים נכשל: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }

  // -------------------------------------------------------------
  // STEP 5: CONTENT REPORT READY
  // -------------------------------------------------------------
  onStep(5, 'active', 'כתובת הדו"ח אונליין. מאגד את הדו"ח הניהולי להורדה...');
  try {
    await new Promise((resolve) => setTimeout(resolve, 300));
    onStep(5, 'done', 'קובץ הדו"ח הורכב בהצלחה. מערכת חילוץ הלהיטים זמינה במלואה!');
  } catch (err: unknown) {
    onStep(5, 'error', `בניית הדו"ח נכשלה: ${err instanceof Error ? err.message : String(err)}`);
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
