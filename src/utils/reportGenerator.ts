import { ViralCut } from '../types';

export function generateHtmlReport(
  cuts: ViralCut[],
  sourceUrl: string,
  platform: string,
  dateString: string,
  logoSrc?: string,
  podcastName?: string,
  episodeName?: string
): string {
  const checklistItems = [
    "גזרו את קטעי הוידאו בדיוק לפי חותמות הזמן בדו\"ח.",
    "הוסיפו כתוביות בולטות וקריאות להגברת המעורבות.",
    "השתמשו ב\"אסטרטגיית הוק\" כטקסט פותח ב-3 השניות הראשונות.",
    "שלבו סאונד או מוזיקת רקע טרנדית לשיפור אחוזי החשיפה.",
    "הוסיפו הנעה ברורה לפעולה (CTA) בסוף הסרטון ובתיאור."
  ];

  const cutsHtml = cuts.map((cut, idx) => {
    const scores = cut.scores;
    const isHighPotential = cut.viralPotential >= 75;
    const badgeColor = isHighPotential 
      ? 'background-color: rgba(126, 140, 106, 0.15); color: #5D6B4D; border: 1px solid rgba(126, 140, 106, 0.4);' 
      : 'background-color: rgba(212, 162, 74, 0.15); color: #9E5A38; border: 1px solid rgba(212, 162, 74, 0.4);';

    const getScoreColor = (val: number) => {
      if (val >= 8) return 'color: #5D6B4D; background-color: rgba(126, 140, 106, 0.1); border-color: rgba(126, 140, 106, 0.3);';
      if (val >= 6) return 'color: #9E5A38; background-color: rgba(212, 162, 74, 0.1); border-color: rgba(212, 162, 74, 0.3);';
      return 'color: #C2754B; background-color: rgba(214, 154, 138, 0.1); border-color: rgba(214, 154, 138, 0.3);';
    };

    return `
      <div class="card" id="cut-card-${idx}">
        <div class="card-header">
          <div class="rank-badge">#${idx + 1}</div>
          <div class="header-details">
            <h3 class="cut-title">${escapeHtml(cut.title)}</h3>
            <span class="timestamp">${escapeHtml(cut.startTime)} &ndash; ${escapeHtml(cut.endTime)}</span>
          </div>
          <div class="overall-badge" style="${badgeColor}">
            <span class="badge-label">פוטנציאל ויראלי</span>
            <span class="badge-value">${cut.viralPotential}/100</span>
          </div>
        </div>

        <div class="quote-section">
          <p class="quote">"${escapeHtml(cut.quote)}"</p>
        </div>

        <div class="meta-grid">
          <div class="meta-item">
            <strong class="meta-label">אסטרטגיית הוק (3 שניות ראשונות):</strong>
            <p class="meta-text">${escapeHtml(cut.hook)}</p>
          </div>
          <div class="meta-item">
            <strong class="meta-label">למה זה יעבוד ויראלית:</strong>
            <p class="meta-text">${escapeHtml(cut.whyViral)}</p>
          </div>
        </div>

        <div class="score-grid">
          <div class="score-card" style="${getScoreColor(scores.authenticity)}">
            <span class="score-name">אותנטיות</span>
            <span class="score-num">${scores.authenticity}/10</span>
          </div>
          <div class="score-card" style="${getScoreColor(scores.engagement)}">
            <span class="score-name">מעורבות</span>
            <span class="score-num">${scores.engagement}/10</span>
          </div>
          <div class="score-card" style="${getScoreColor(scores.emotional_resonance)}">
            <span class="score-name">תהודה רגשית</span>
            <span class="score-num">${scores.emotional_resonance}/10</span>
          </div>
          <div class="score-card" style="${getScoreColor(scores.actionability)}">
            <span class="score-name">פרקטיות וישימות</span>
            <span class="score-num">${scores.actionability}/10</span>
          </div>
        </div>

        ${cut.contentManagerNote ? `
          <div class="manager-note">
            <svg class="note-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            <div>
              <strong>מדריך אופטימיזציה למנהלי תוכן:</strong>
              <p>${escapeHtml(cut.contentManagerNote)}</p>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  const checklistHtml = checklistItems.map((item, index) => `
    <div class="checklist-item">
      <input type="checkbox" id="check-${index}" class="checklist-checkbox">
      <label for="check-${index}" class="checklist-label">
        <span class="checklist-num">${index + 1}.</span>
        ${escapeHtml(item)}
      </label>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(podcastName || "אנה ויעל | נקודת חיבור")} - דו"ח זיקוק רגעים ויראליים</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@400;500;700;900&family=Heebo:wght@300;400;500;700&family=Assistant:wght@300;400;500;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #2B2A26;
      --primary-foreground: #FFFFFF;
      --secondary: #5A564E;
      --muted: #8C8678;
      --border: #D9CFB9;
      --card: #FBF7EF;
      --background: #F6EFE4;
      --accent: #C2754B;
      --accent-deep: #9E5A38;
      --sand: #EADFC9;
      --sage: #7E8C6A;
      --ochre: #D4A24A;
      --rose: #D69A8A;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Heebo', 'Assistant', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--background);
      color: var(--primary);
      line-height: 1.6;
      padding: 40px 20px;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
    }

    header {
      background-color: var(--card);
      color: var(--primary);
      border: 1px solid var(--border);
      padding: 32px;
      border-radius: 20px;
      margin-bottom: 32px;
      box-shadow: 0 4px 12px rgba(43, 42, 38, 0.04);
    }

    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      margin-bottom: 24px;
    }

    .header-branding {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .report-logo {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: 1px solid var(--border);
      object-fit: cover;
    }

    h1 {
      font-family: 'Frank Ruhl Libre', serif;
      font-size: 1.85rem;
      font-weight: 700;
      color: var(--accent);
      line-height: 1.25;
      margin-bottom: 4px;
    }

    .podcast-title {
      font-family: 'Frank Ruhl Libre', serif;
      font-size: 2.1rem;
      font-weight: 900;
      color: var(--accent-deep);
      line-height: 1.2;
      margin-bottom: 6px;
    }

    .episode-title {
      font-family: 'Heebo', sans-serif;
      font-size: 1.25rem;
      font-weight: 500;
      color: var(--secondary);
      line-height: 1.3;
      margin-bottom: 12px;
    }

    .badge-niche {
      background-color: var(--sand);
      color: var(--primary);
      border: 1px solid var(--border);
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 700;
      display: inline-block;
    }

    .meta-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      border-top: 1px solid var(--border);
      padding-top: 20px;
    }

    .meta-chunk {
      display: flex;
      flex-direction: column;
    }

    .meta-chunk span {
      font-size: 0.72rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
      font-weight: 700;
    }

    .meta-chunk strong {
      font-size: 0.925rem;
      font-weight: 700;
      color: var(--primary);
      word-break: break-all;
    }

    .meta-chunk a {
      color: var(--accent);
      text-decoration: none;
      font-weight: 600;
    }

    .meta-chunk a:hover {
      text-decoration: underline;
      color: var(--accent-deep);
    }

    .section-title {
      font-family: 'Frank Ruhl Libre', serif;
      font-size: 1.45rem;
      font-weight: 700;
      color: var(--primary);
      margin-bottom: 20px;
      margin-top: 40px;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .section-title::after {
      content: '';
      flex: 1;
      height: 1px;
      background-color: var(--border);
    }

    .card {
      background-color: var(--card);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 32px;
      margin-bottom: 24px;
      box-shadow: 0 4px 12px rgba(43, 42, 38, 0.02);
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .card:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 20px rgba(43, 42, 38, 0.05);
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .rank-badge {
      background-color: var(--accent);
      color: #FFFFFF;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Frank Ruhl Libre', serif;
      font-size: 1.2rem;
      font-weight: 700;
    }

    .header-details {
      flex: 1;
      min-width: 200px;
    }

    .cut-title {
      font-family: 'Frank Ruhl Libre', serif;
      font-size: 1.3rem;
      font-weight: 700;
      color: var(--primary);
      line-height: 1.3;
      margin-bottom: 6px;
    }

    .timestamp {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8rem;
      color: var(--secondary);
      font-weight: 600;
      background-color: var(--background);
      padding: 3px 10px;
      border-radius: 9999px;
      border: 1px solid var(--border);
      display: inline-block;
    }

    .overall-badge {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 6px 16px;
      border-radius: 14px;
    }

    .badge-label {
      font-size: 0.68rem;
      font-weight: 700;
      opacity: 0.95;
    }

    .badge-value {
      font-size: 1.2rem;
      font-weight: 800;
    }

    .quote-section {
      background-color: var(--background);
      border-right: 4px solid var(--accent);
      padding: 16px 20px;
      border-radius: 0 12px 12px 0;
      margin-bottom: 24px;
    }

    .quote {
      font-style: italic;
      color: var(--secondary);
      font-size: 1.05rem;
      line-height: 1.6;
      font-family: 'Frank Ruhl Libre', serif;
    }

    .meta-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
      margin-bottom: 24px;
    }

    @media (min-width: 640px) {
      .meta-grid {
        grid-template-columns: 1fr 1fr;
      }
    }

    .meta-item {
      background-color: var(--background);
      border: 1px solid var(--border);
      padding: 16px;
      border-radius: 12px;
    }

    .meta-label {
      display: block;
      font-size: 0.75rem;
      color: var(--muted);
      margin-bottom: 6px;
      font-weight: 700;
    }

    .meta-text {
      font-size: 0.925rem;
      color: var(--primary);
    }

    .score-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-top: 16px;
    }

    @media (min-width: 640px) {
      .score-grid {
        grid-template-columns: repeat(4, 1fr);
      }
    }

    .score-card {
      padding: 12px;
      border-radius: 12px;
      border: 1px solid;
      text-align: center;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .score-name {
      font-size: 0.7rem;
      font-weight: 700;
    }

    .score-num {
      font-size: 1.1rem;
      font-weight: 800;
    }

    .manager-note {
      margin-top: 24px;
      background-color: rgba(234, 223, 201, 0.25);
      border: 1px solid var(--border);
      color: var(--primary);
      padding: 16px;
      border-radius: 16px;
      display: flex;
      gap: 12px;
    }

    .note-icon {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
      stroke: var(--accent);
      margin-top: 2px;
    }

    .manager-note strong {
      font-size: 0.85rem;
      display: block;
      margin-bottom: 4px;
      color: var(--accent-deep);
    }

    .manager-note p {
      font-size: 0.875rem;
      line-height: 1.5;
    }

    .checklist-card {
      background-color: var(--card);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 32px;
      margin-bottom: 40px;
      box-shadow: 0 4px 12px rgba(43, 42, 38, 0.02);
    }

    .checklist-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 0;
      border-bottom: 1px solid var(--border);
    }

    .checklist-item:last-child {
      border-bottom: none;
    }

    .checklist-checkbox {
      width: 18px;
      height: 18px;
      margin-top: 3.5px;
      accent-color: var(--accent);
      cursor: pointer;
    }

    .checklist-label {
      font-size: 0.95rem;
      color: var(--secondary);
      cursor: pointer;
      user-select: none;
    }

    .checklist-num {
      font-weight: 800;
      color: var(--accent);
      margin-left: 6px;
    }

    .checklist-checkbox:checked + .checklist-label {
      text-decoration: line-through;
      color: var(--muted);
    }

    footer {
      text-align: center;
      color: var(--muted);
      font-size: 0.8rem;
      margin-top: 60px;
      border-top: 1px solid var(--border);
      padding-top: 24px;
    }

    @media print {
      body {
        background-color: #ffffff;
        color: #000000;
        padding: 0;
      }
      .card {
        box-shadow: none !important;
        page-break-inside: avoid;
        margin-bottom: 30px;
      }
      header {
        box-shadow: none !important;
        background-color: #ffffff;
        color: #000000;
        border: 2px solid #2B2A26;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="header-top">
        <div class="header-branding">
          ${logoSrc ? `<img src="${logoSrc}" alt="אנה ויעל | נקודת חיבור Logo" class="report-logo" />` : ''}
          <div>
            <h1 class="podcast-title">${escapeHtml(podcastName || "אנה ויעל | נקודת חיבור")}</h1>
            ${episodeName ? `<h2 class="episode-title">${escapeHtml(episodeName)}</h2>` : ''}
            <span class="badge-niche">דו"ח זיקוק רגעים ויראליים</span>
          </div>
        </div>
      </div>
      <div class="meta-list">
        <div class="meta-chunk">
          <span>קישור מקור</span>
          <strong><a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceUrl)}</a></strong>
        </div>
        <div class="meta-chunk">
          <span>פלטפורמה</span>
          <strong>${escapeHtml(platform)}</strong>
        </div>
        <div class="meta-chunk">
          <span>תאריך הפקה</span>
          <strong>${escapeHtml(dateString)}</strong>
        </div>
        <div class="meta-chunk">
          <span>סה"כ קטעים</span>
          <strong>${cuts.length} (מתוכם ${cuts.filter(c => c.viralPotential >= 75).length} עם פוטנציאל גבוה)</strong>
        </div>
      </div>
    </header>

    <h2 class="section-title">🏆 4 קטעי הוידאו המובילים</h2>
    ${cutsHtml}

    <h2 class="section-title">📋 צ'קליסט מעשי למנהלי תוכן</h2>
    <div class="checklist-card">
      <p style="color: var(--muted); margin-bottom: 20px; font-size: 0.925rem; font-weight: 500;">
        בצעו את הפעולות הבאות שלב אחר שלב כדי לקבל חשיפה מקסימלית באלגוריתמים החברתיים והוורטיקליים (Instagram Reels, TikTok, YouTube Shorts).
      </p>
      <div class="checklist">
        ${checklistHtml}
      </div>
    </div>

    <footer>
      <p>דו"ח זיקוק רגעים ויראליים • אנה ויעל | נקודת חיבור</p>
    </footer>
  </div>
</body>
</html>
`;
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
