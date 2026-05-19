import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import type { PDFPage, PDFFont } from 'https://esm.sh/pdf-lib@1.17.1';

const GROQ_API_URL = 'https://api.groq.com/openai/v1';
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ActionItem {
  task: string;
  owner: string;
  deadline: string;
  priority: 'High' | 'Medium' | 'Low';
}

interface AIResult {
  agenda: string[];
  keyDiscussionPoints: string[];
  decisions: string[];
  actionItems: ActionItem[];
  summary: string;
}

// ── Groq Transcription ────────────────────────────────────────────────────────

async function transcribeChunk(audioBytes: Uint8Array, chunkIndex: number): Promise<string> {
  const formData = new FormData();
  const blob = new Blob([audioBytes], { type: 'audio/mp4' });
  formData.append('file', blob, `chunk_${chunkIndex}.m4a`);
  formData.append('model', 'whisper-large-v3');
  formData.append('response_format', 'text');
  formData.append('language', 'en');

  const response = await fetch(`${GROQ_API_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Transcription failed for chunk ${chunkIndex}: ${err}`);
  }

  return await response.text();
}

// ── Groq AI Summary ───────────────────────────────────────────────────────────

async function generateMeetingSummary(
  transcript: string,
  nextSteps: string,
  meetingTitle: string,
  clientName: string
): Promise<AIResult> {
  const systemPrompt = `You are a senior business analyst and professional meeting minutes writer for FITS Express, a cargo and logistics company based in Sri Lanka.
Your job is to produce high-quality, detailed, and professional meeting minutes from meeting transcripts.
Always respond with a valid JSON object only — no markdown, no code fences, no explanation outside the JSON.`;

  const userPrompt = `Analyse the meeting transcript below and return a single JSON object with exactly these keys:

{
  "summary": "A detailed 4-6 sentence executive summary covering: the purpose of the meeting, the main topics discussed, key outcomes, and what happens next. Write in formal business language. Be specific — mention the client name, the meeting topic, and the confirmed next steps.",
  "agenda": ["Topic 1", "Topic 2", "Topic 3", ...],
  "keyDiscussionPoints": ["Full sentence describing point 1", "Full sentence describing point 2", ...],
  "decisions": ["Decision 1", "Decision 2", ...],
  "actionItems": [
    {
      "task": "Clear description of the task",
      "owner": "Person name or 'TBD'",
      "deadline": "Specific date or timeframe, or 'TBD'",
      "priority": "High" | "Medium" | "Low"
    }
  ]
}

Rules — follow exactly:
- summary: Write 4-6 complete sentences based only on what was actually discussed in the transcript. Mention the client (${clientName}), meeting purpose (${meetingTitle}), what was discussed, decisions made, and next steps.
- agenda: List the main topics that were actually discussed. Only include topics present in the transcript.
- keyDiscussionPoints: Write full sentences describing what was actually discussed. Each point must be a complete sentence with context.
- decisions: Only list confirmed decisions from the transcript. If none were made, return [].
- actionItems: Convert the confirmed next steps into concrete action items.
- Priority rules: tasks due immediately = High, tasks due this week = Medium, longer-term = Low.
- Use formal, professional language throughout.
- Do NOT invent or assume facts not present in the transcript or next steps.

MEETING DETAILS:
- Title: ${meetingTitle}
- Client: ${clientName}
- Confirmed next steps: ${nextSteps || 'None specified'}

TRANSCRIPT:
${transcript.slice(0, 12000)}`;

  const response = await fetch(`${GROQ_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`AI summary failed: ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? '{}';

  try {
    return JSON.parse(content) as AIResult;
  } catch {
    return {
      summary: 'Meeting summary could not be generated automatically.',
      agenda: [],
      keyDiscussionPoints: [],
      decisions: [],
      actionItems: [],
    };
  }
}

// ── PDF Generation ────────────────────────────────────────────────────────────

const NAVY = rgb(0.1, 0.235, 0.431);        // #1A3C6E
const DARK_TEXT = rgb(0.1, 0.169, 0.29);    // #1A2B4A
const GREY_TEXT = rgb(0.353, 0.42, 0.541);  // #5A6B8A
const LIGHT_BG = rgb(0.933, 0.945, 0.969);  // #EEF2F7
const WHITE = rgb(1, 1, 1);
const DIVIDER = rgb(0.886, 0.918, 0.957);   // #E2EAF4
const GOLD = rgb(0.91, 0.627, 0.125);       // #E8A020

interface MeetingData {
  meeting_title: string;
  client_name: string;
  meeting_date: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  attendees: Array<{ name: string; designation: string; company: string }>;
  prepared_by: string;
  has_transcript: boolean;
  summary: string;
  agenda: string[];
  key_discussion_points: string[];
  decisions: string[];
  action_items: ActionItem[];
  next_steps: string | null;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatDuration(s: number): string {
  if (s < 60) return `${s} second${s !== 1 ? 's' : ''}`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} hour${h > 1 ? 's' : ''} ${m} minute${m !== 1 ? 's' : ''}`;
  return `${m} minute${m !== 1 ? 's' : ''}`;
}

function wrapText(text: string, maxWidth: number, font: PDFFont, size: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function generatePDF(data: MeetingData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const oblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const PAGE_W = 595;
  const PAGE_H = 842;
  const MARGIN = 48;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const newPage = () => {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
    drawPageHeader();
    y -= 8;
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN + 20) newPage();
  };

  const drawPageHeader = () => {
    page.drawRectangle({ x: 0, y: PAGE_H - 32, width: PAGE_W, height: 32, color: NAVY });
    page.drawText('FITS MeetTrack AI  ·  Confidential', {
      x: MARGIN,
      y: PAGE_H - 22,
      size: 9,
      font: regularFont,
      color: rgb(1, 1, 1, 0.6),
    });
    page.drawText(data.meeting_title, {
      x: PAGE_W - MARGIN - boldFont.widthOfTextAtSize(data.meeting_title, 9),
      y: PAGE_H - 22,
      size: 9,
      font: boldFont,
      color: WHITE,
    });
  };

  // ── Cover Header ──────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: PAGE_H - 120, width: PAGE_W, height: 120, color: NAVY });

  page.drawText('MEETING SUMMARY', {
    x: MARGIN,
    y: PAGE_H - 48,
    size: 22,
    font: boldFont,
    color: WHITE,
  });

  page.drawText(`FITS Express  ·  ${data.client_name}`, {
    x: MARGIN,
    y: PAGE_H - 72,
    size: 11,
    font: regularFont,
    color: rgb(1, 1, 1, 0.75),
  });

  // Gold accent line
  page.drawRectangle({ x: MARGIN, y: PAGE_H - 88, width: 60, height: 3, color: GOLD });

  page.drawText(formatDate(data.meeting_date), {
    x: MARGIN,
    y: PAGE_H - 108,
    size: 10,
    font: regularFont,
    color: rgb(1, 1, 1, 0.65),
  });

  y = PAGE_H - 140;

  // ── Section Helper ─────────────────────────────────────────────────────────
  const drawSectionHeader = (title: string) => {
    ensureSpace(40);
    page.drawRectangle({ x: MARGIN, y: y - 22, width: CONTENT_W, height: 24, color: NAVY });
    page.drawText(title.toUpperCase(), {
      x: MARGIN + 10,
      y: y - 15,
      size: 9.5,
      font: boldFont,
      color: WHITE,
    });
    y -= 30;
  };

  const drawKeyValue = (key: string, value: string) => {
    const keyW = 130;
    page.drawText(key, { x: MARGIN, y, size: 9, font: boldFont, color: GREY_TEXT });
    const valLines = wrapText(value, CONTENT_W - keyW - 8, regularFont, 9.5);
    valLines.forEach((line, i) => {
      page.drawText(line, { x: MARGIN + keyW, y: y - i * 13, size: 9.5, font: regularFont, color: DARK_TEXT });
    });
    y -= Math.max(1, valLines.length) * 13 + 4;
  };

  const drawDivider = () => {
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: DIVIDER });
    y -= 8;
  };

  const drawBodyText = (text: string, indent = 0, size = 9.5) => {
    const lines = wrapText(text, CONTENT_W - indent, regularFont, size);
    lines.forEach((line) => {
      ensureSpace(14);
      page.drawText(line, { x: MARGIN + indent, y, size, font: regularFont, color: DARK_TEXT });
      y -= 14;
    });
  };

  const drawBullet = (text: string, indent = 12, prefix = '•') => {
    ensureSpace(16);
    page.drawText(prefix, { x: MARGIN + indent, y, size: 9.5, font: boldFont, color: NAVY });
    const lines = wrapText(text, CONTENT_W - indent - 14, regularFont, 9.5);
    lines.forEach((line, i) => {
      if (i > 0) ensureSpace(14);
      page.drawText(line, { x: MARGIN + indent + 14, y: y - 0, size: 9.5, font: regularFont, color: DARK_TEXT });
      if (i < lines.length - 1) y -= 14;
    });
    y -= 16;
  };

  // ── Executive Summary / No-transcript notice ──────────────────────────────
  if (data.has_transcript && data.summary) {
    drawSectionHeader('Executive Summary');
    const sentences = data.summary
      .replace(/([.!?])\s+/g, '$1\n')
      .split('\n')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);
    sentences.forEach((sentence: string) => drawBullet(sentence, 8));
    y -= 10;
  } else if (!data.has_transcript) {
    drawSectionHeader('Meeting Note');
    drawBodyText(
      'This meeting was recorded without audio. Meeting details and next steps are documented below. ' +
      'To generate a full AI summary, please ensure the microphone is active during recording.',
      0, 9.5
    );
    y -= 14;
  }

  // ── 1. Meeting Details ─────────────────────────────────────────────────────
  drawSectionHeader('1. Meeting Details');

  const locationDisplay = data.address
    ?? (data.latitude && data.longitude
      ? `${data.latitude.toFixed(5)}, ${data.longitude.toFixed(5)}`
      : 'Not captured');

  const details = [
    ['Date', formatDate(data.meeting_date)],
    ['Start Time', formatTime(data.start_time)],
    ['End Time', formatTime(data.end_time)],
    ['Duration', formatDuration(data.duration_seconds)],
    ['Location', locationDisplay],
    ['Client Name', data.client_name],
    ['Meeting Title', data.meeting_title],
    ['Prepared By', data.prepared_by],
  ];

  details.forEach(([k, v], i) => {
    ensureSpace(18);
    if (i > 0 && i % 2 === 0) {
      page.drawRectangle({ x: MARGIN, y: y - 4, width: CONTENT_W, height: 18, color: LIGHT_BG });
    }
    drawKeyValue(k + ':', v);
  });

  y -= 10;

  // ── 2. Attendees ───────────────────────────────────────────────────────────
  drawSectionHeader('2. Attendees');

  // Table header
  ensureSpace(24);
  page.drawRectangle({ x: MARGIN, y: y - 18, width: CONTENT_W, height: 20, color: LIGHT_BG });
  const colWidths = [CONTENT_W * 0.37, CONTENT_W * 0.32, CONTENT_W * 0.31];
  const colX = [MARGIN + 6, MARGIN + colWidths[0] + 6, MARGIN + colWidths[0] + colWidths[1] + 6];
  ['Name', 'Designation', 'Company'].forEach((h, i) => {
    page.drawText(h, { x: colX[i], y: y - 13, size: 8.5, font: boldFont, color: GREY_TEXT });
  });
  y -= 22;

  data.attendees.forEach((att, idx) => {
    ensureSpace(18);
    if (idx % 2 === 0) {
      page.drawRectangle({ x: MARGIN, y: y - 4, width: CONTENT_W, height: 16, color: LIGHT_BG });
    }
    [att.name, att.designation || '—', att.company || '—'].forEach((val, i) => {
      page.drawText(val.slice(0, 36), { x: colX[i], y: y - 1, size: 9, font: regularFont, color: DARK_TEXT });
    });
    y -= 16;
  });
  y -= 8;

  // ── 3–6. AI-generated sections (only when audio was recorded) ────────────
  if (data.has_transcript) {
    // ── 3. Agenda ───────────────────────────────────────────────────────────
    drawSectionHeader('3. Agenda');
    if (data.agenda.length === 0) {
      drawBodyText('No agenda topics were identified from the recording.', 0, 9);
    } else {
      data.agenda.forEach((item, i) => drawBullet(item, 12, `${i + 1}.`));
    }
    y -= 6;

    // ── 4. Key Discussion Points ─────────────────────────────────────────────
    drawSectionHeader('4. Key Discussion Points');
    if (data.key_discussion_points.length === 0) {
      drawBodyText('No key discussion points were identified from the recording.', 0, 9);
    } else {
      data.key_discussion_points.forEach((item, i) => drawBullet(item, 12, `${i + 1}.`));
    }
    y -= 6;

    // ── 5. Decisions Made ───────────────────────────────────────────────────
    drawSectionHeader('5. Decisions Made');
    if (data.decisions.length === 0) {
      drawBodyText('No specific decisions were identified from the recording.', 0, 9);
    } else {
      data.decisions.forEach((d) => drawBullet(d));
    }
    y -= 6;

    // ── 6. Action Items ─────────────────────────────────────────────────────
    drawSectionHeader('6. Action Items');
    if (data.action_items.length === 0) {
      drawBodyText('No action items were identified from the recording.', 0, 9);
    } else {
    // Table
    ensureSpace(24);
    page.drawRectangle({ x: MARGIN, y: y - 18, width: CONTENT_W, height: 20, color: LIGHT_BG });
    const aiColW = [CONTENT_W * 0.38, CONTENT_W * 0.2, CONTENT_W * 0.22, CONTENT_W * 0.2];
    const aiColX = [
      MARGIN + 6,
      MARGIN + aiColW[0] + 6,
      MARGIN + aiColW[0] + aiColW[1] + 6,
      MARGIN + aiColW[0] + aiColW[1] + aiColW[2] + 6,
    ];
    ['Task', 'Owner', 'Deadline', 'Priority'].forEach((h, i) => {
      page.drawText(h, { x: aiColX[i], y: y - 13, size: 8.5, font: boldFont, color: GREY_TEXT });
    });
    y -= 22;

    data.action_items.forEach((item, idx) => {
      ensureSpace(18);
      if (idx % 2 === 0) {
        page.drawRectangle({ x: MARGIN, y: y - 4, width: CONTENT_W, height: 16, color: LIGHT_BG });
      }
      const taskLines = wrapText(item.task, aiColW[0] - 12, regularFont, 8.5);
      page.drawText(taskLines[0] ?? '', { x: aiColX[0], y: y - 1, size: 8.5, font: regularFont, color: DARK_TEXT });
      page.drawText((item.owner ?? '—').slice(0, 22), { x: aiColX[1], y: y - 1, size: 8.5, font: regularFont, color: DARK_TEXT });
      page.drawText((item.deadline ?? 'TBD').slice(0, 24), { x: aiColX[2], y: y - 1, size: 8.5, font: regularFont, color: DARK_TEXT });
      const priColor = item.priority === 'High' ? rgb(0.937, 0.267, 0.267) : item.priority === 'Medium' ? rgb(0.957, 0.62, 0.043) : rgb(0.133, 0.773, 0.369);
      page.drawText(item.priority, { x: aiColX[3], y: y - 1, size: 8.5, font: boldFont, color: priColor });
      y -= 16;
    });
    }
    y -= 8;
  } // end has_transcript sections

  // ── 7. Next Steps ─────────────────────────────────────────────────────────
  drawSectionHeader('7. Next Steps / Future Follow-up');
  if (data.next_steps) {
    const nsLines = data.next_steps.split('\n');
    nsLines.forEach((line) => {
      if (line.trim()) {
        ensureSpace(16);
        drawBodyText(line.trim());
      }
    });
  } else {
    drawBodyText('No specific next steps were recorded.', 0, 9);
  }
  y -= 10;

  // ── Footer on last page ────────────────────────────────────────────────────
  ensureSpace(40);
  page.drawLine({ start: { x: MARGIN, y: y - 10 }, end: { x: PAGE_W - MARGIN, y: y - 10 }, thickness: 0.5, color: DIVIDER });
  page.drawText(`Prepared by: ${data.prepared_by}`, { x: MARGIN, y: y - 24, size: 9, font: boldFont, color: GREY_TEXT });
  page.drawText(`Generated by FITS MeetTrack AI  ·  ${formatDate(data.meeting_date)}`, {
    x: PAGE_W - MARGIN - regularFont.widthOfTextAtSize('Generated by FITS MeetTrack AI  ·  ' + formatDate(data.meeting_date), 8),
    y: y - 24,
    size: 8,
    font: regularFont,
    color: GREY_TEXT,
  });

  // Page numbers
  const pages = pdfDoc.getPages();
  pages.forEach((p, i) => {
    p.drawText(`Page ${i + 1} of ${pages.length}`, {
      x: PAGE_W / 2 - 20,
      y: 20,
      size: 8,
      font: regularFont,
      color: GREY_TEXT,
    });
  });

  return await pdfDoc.save();
}

// ── Main Handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const {
      meetingId,
      chunkStoragePaths = [],
      nextSteps,
      transcript: sttTranscript,  // text from expo-speech-recognition (STT mode)
    } = await req.json();

    if (!meetingId) {
      return new Response(JSON.stringify({ success: false, error: 'meetingId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load meeting record
    const { data: meeting, error: meetingErr } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .single();

    if (meetingErr || !meeting) {
      throw new Error('Meeting not found');
    }

    // ── Step 1: Obtain transcript ─────────────────────────────────────────────
    // STT mode: transcript text was produced on-device by expo-speech-recognition.
    // Whisper mode (legacy): download audio chunks and transcribe via Groq Whisper.
    let hasRealTranscript: boolean;
    let fullTranscript: string | null;
    const processedPaths: string[] = [];

    if (sttTranscript?.trim()) {
      // ── STT mode ────────────────────────────────────────────────────────────
      fullTranscript = sttTranscript.trim();
      hasRealTranscript = true;
      console.log(`[process-meeting] STT mode: meetingId=${meetingId} transcript length=${fullTranscript.length}`);
    } else {
      // ── Whisper mode (audio chunks) ──────────────────────────────────────────
      const transcripts: string[] = [];

      for (let i = 0; i < chunkStoragePaths.length; i++) {
        const storagePath = chunkStoragePaths[i];
        try {
          const { data: audioData, error: dlErr } = await supabase.storage
            .from('meeting-audio')
            .download(storagePath);

          if (dlErr || !audioData) continue;

          const arrayBuffer = await audioData.arrayBuffer();
          const audioBytes = new Uint8Array(arrayBuffer);

          if (audioBytes.length < 1000) continue;

          const text = await transcribeChunk(audioBytes, i);
          if (text.trim()) transcripts.push(text.trim());
          processedPaths.push(storagePath);
        } catch (chunkErr) {
          console.error(`Chunk ${i} error:`, chunkErr);
        }
      }

      hasRealTranscript = transcripts.length > 0;
      fullTranscript = hasRealTranscript ? transcripts.join('\n\n') : null;
      console.log(`[process-meeting] Whisper mode: meetingId=${meetingId} chunks=${chunkStoragePaths.length} transcribed=${transcripts.length}`);
    }

    await supabase.from('meetings').update({ transcript: fullTranscript }).eq('id', meetingId);

    // ── Step 2: AI Summary (only when real audio was recorded) ────────────────
    let aiResult: AIResult | null = null;
    if (hasRealTranscript && fullTranscript) {
      aiResult = await generateMeetingSummary(
        fullTranscript,
        nextSteps ?? '',
        meeting.meeting_title,
        meeting.client_name
      );
    }

    // ── Step 3: Generate PDF ──────────────────────────────────────────────────
    const pdfData: MeetingData = {
      meeting_title: meeting.meeting_title,
      client_name: meeting.client_name,
      meeting_date: meeting.meeting_date,
      start_time: meeting.start_time,
      end_time: meeting.end_time,
      duration_seconds: meeting.duration_seconds,
      latitude: meeting.latitude ?? null,
      longitude: meeting.longitude ?? null,
      address: meeting.address,
      attendees: meeting.attendees ?? [],
      prepared_by: meeting.prepared_by,
      has_transcript: hasRealTranscript,
      summary: aiResult?.summary ?? '',
      agenda: aiResult?.agenda ?? [],
      key_discussion_points: aiResult?.keyDiscussionPoints ?? [],
      decisions: aiResult?.decisions ?? [],
      action_items: aiResult?.actionItems ?? [],
      next_steps: nextSteps ?? null,
    };

    const pdfBytes = await generatePDF(pdfData);

    // ── Step 4: Upload PDF ────────────────────────────────────────────────────
    const pdfPath = `meeting-pdfs/${meetingId}.pdf`;
    const { error: pdfUploadErr } = await supabase.storage
      .from('meeting-pdfs')
      .upload(pdfPath, pdfBytes, { contentType: 'application/pdf', upsert: true });

    if (pdfUploadErr) throw new Error(`PDF upload failed: ${pdfUploadErr.message}`);

    // Use a signed URL (service role can create these regardless of bucket visibility).
    // 1 year expiry is sufficient for practical use.
    const { data: signedUrlData, error: signedUrlErr } = await supabase.storage
      .from('meeting-pdfs')
      .createSignedUrl(pdfPath, 60 * 60 * 24 * 365);

    if (signedUrlErr || !signedUrlData?.signedUrl) {
      throw new Error(`Could not create PDF download URL: ${signedUrlErr?.message ?? 'unknown'}`);
    }
    const pdfUrl = signedUrlData.signedUrl;

    // ── Step 5: Update meeting record ─────────────────────────────────────────
    await supabase
      .from('meetings')
      .update({
        transcript: fullTranscript,
        agenda: aiResult?.agenda ?? null,
        summary: aiResult?.summary ?? null,
        key_discussion_points: aiResult?.keyDiscussionPoints ?? null,
        decisions: aiResult?.decisions ?? null,
        action_items: aiResult?.actionItems ?? null,
        next_steps: nextSteps ?? null,
        pdf_url: pdfUrl,
        status: 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', meetingId);

    // ── Step 6: Delete audio chunks ───────────────────────────────────────────
    if (processedPaths.length > 0) {
      await supabase.storage.from('meeting-audio').remove(processedPaths);
    }

    return new Response(JSON.stringify({ success: true, pdfUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('process-meeting error:', error);

    return new Response(
      JSON.stringify({ success: false, error: error?.message ?? 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
