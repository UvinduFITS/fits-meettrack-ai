# FITS MeetTrack AI

Professional meeting intelligence app for the FITS Cargo team. Record client meetings, auto-transcribe audio, generate AI meeting minutes, and produce a branded PDF — all in one tap.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Mobile | React Native + Expo (iOS & Android) |
| Language | TypeScript |
| Auth | Supabase Auth |
| Database | Supabase PostgreSQL |
| Storage | Supabase Storage |
| AI Transcription | Groq Whisper (`whisper-large-v3`) |
| AI Summary | Groq LLaMA (`llama-3.3-70b-versatile`) |
| PDF Generation | `pdf-lib` (in Supabase Edge Function) |
| Backend | Supabase Edge Functions (Deno) |
| State | Zustand |
| Navigation | React Navigation v6 |

---

## Prerequisites

- Node.js 18+
- [Expo CLI](https://docs.expo.dev/get-started/installation/) — `npm install -g expo-cli`
- [Supabase CLI](https://supabase.com/docs/guides/cli) — `npm install -g supabase`
- A [Supabase](https://supabase.com) project
- A [Groq](https://console.groq.com) API key
- Physical Android or iOS device (microphone required)

---

## Setup

### 1. Clone & Install

```bash
git clone <repo>
cd fits-meettrack-ai
npm install
```

### 2. Environment Variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

> **Never put your Groq API key in the mobile app.** It lives only in the Supabase Edge Function secret.

### 3. Supabase Database Setup

Go to your Supabase project → **SQL Editor** and run these in order:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/rls_policies.sql`
3. `supabase/storage_setup.sql`

### 4. Supabase Storage Buckets

In Supabase Dashboard → **Storage**, create two buckets:

| Bucket Name | Public |
|---|---|
| `meeting-audio` | No (private) |
| `meeting-pdfs` | Yes (public) |

### 5. Deploy the Edge Function

```bash
# Login to Supabase CLI
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Set the Groq secret (never committed to git)
supabase secrets set GROQ_API_KEY=your-groq-api-key

# Deploy the function
supabase functions deploy process-meeting
```

### 6. Create a Test User

In Supabase → **Authentication** → **Users** → **Invite user**

Or use the Supabase email signup (enabled by default).

After signup, optionally update the user's name:
```sql
UPDATE public.profiles SET full_name = 'Your Name' WHERE email = 'your@email.com';
```

### 7. Run the App

```bash
# Start Expo
npx expo start

# Scan QR code with Expo Go app on your phone
# OR build for device:
npx expo run:android
npx expo run:ios
```

---

## App Flow

```
Login
  └─► Home (meeting list + Start Meeting button)
        └─► Meeting Setup (title, client, attendees)
              └─► Recording Screen (live timer, location, stop button)
                    └─► Next Steps Screen (follow-up input)
                          └─► Processing Screen (AI progress)
                                └─► Meeting Result (minutes + share PDF)
```

---

## Architecture Notes

### Audio Chunking (Internal)
The user experiences **one continuous recording**. Internally:

1. Every 10 minutes, the current recording is silently stopped and saved.
2. A new recording immediately begins.
3. All chunks are uploaded to Supabase Storage after "Stop Meeting".
4. The Edge Function transcribes each chunk sequentially via Groq Whisper.
5. Transcripts are concatenated and fed to LLaMA for summarisation.
6. All audio is deleted after successful transcription.

### Edge Function Security
- The Groq API key is stored as a Supabase secret — never exposed to the mobile app.
- All AI processing happens server-side in the Edge Function.
- The mobile app only calls `supabase.functions.invoke('process-meeting', ...)`.

### RLS
- Users can only read/write their own meetings.
- Admins (role = 'admin' in profiles table) can read all meetings.
- The Edge Function uses the service role key, bypassing RLS for processing.

---

## PDF Structure

The generated PDF follows this structure:

1. **Meeting Summary** (cover header)
2. **Meeting Details** — date, times, duration, location, client, title
3. **Attendees** — name, designation, company table
4. **Agenda** — AI-generated from transcript
5. **Key Discussion Points** — numbered, AI-generated
6. **Decisions Made** — AI-extracted, or "No specific decisions recorded"
7. **Action Items** — task/owner/deadline/priority table
8. **Next Steps / Future Follow-up** — user input + AI detected
9. **Prepared By** — user name
10. **Page numbers** and footer on every page

---

## Environment Variables Reference

### Mobile App (`.env`)
```
EXPO_PUBLIC_SUPABASE_URL       Your Supabase project URL
EXPO_PUBLIC_SUPABASE_ANON_KEY  Your Supabase anon/public key
```

### Edge Function Secrets (set via `supabase secrets set`)
```
GROQ_API_KEY              Your Groq API key
SUPABASE_URL              Auto-set by Supabase
SUPABASE_SERVICE_ROLE_KEY Auto-set by Supabase
```

---

## Troubleshooting

| Issue | Fix |
|---|---|
| Microphone permission denied | Go to phone Settings → Apps → FITS MeetTrack AI → Permissions |
| Location not captured | Grant location permission; GPS works best outdoors |
| Processing stuck | Check Supabase Edge Function logs in Dashboard → Edge Functions |
| PDF not generated | Verify Groq API key is set: `supabase secrets list` |
| Auth not working | Confirm Supabase URL and anon key in `.env` |
| App crashes on start | Run `npx expo start --clear` to clear Metro cache |

---

## Production Build

```bash
# Install EAS CLI
npm install -g eas-cli
eas login

# Configure project
eas build:configure

# Build for Android
eas build --platform android

# Build for iOS
eas build --platform ios
```

Update `app.json` with your actual EAS project ID before building.

---

## Project Structure

```
fits-meettrack-ai/
├── app/
│   └── _layout.tsx              # Expo Router root
├── src/
│   ├── components/
│   │   └── ui/                  # Button, Card, FormField, SectionHeader
│   ├── constants/
│   │   └── theme.ts             # Colors, spacing, typography
│   ├── hooks/
│   │   ├── useAuth.ts           # Supabase auth state
│   │   ├── useAudioRecording.ts # Audio chunking logic
│   │   └── useLocation.ts       # GPS + reverse geocoding
│   ├── lib/
│   │   └── supabase.ts          # Supabase client
│   ├── navigation/
│   │   └── AppNavigator.tsx     # React Navigation stack
│   ├── screens/
│   │   ├── LoginScreen.tsx
│   │   ├── HomeScreen.tsx
│   │   ├── MeetingSetupScreen.tsx
│   │   ├── RecordingScreen.tsx
│   │   ├── NextStepsScreen.tsx
│   │   ├── ProcessingScreen.tsx
│   │   ├── MeetingResultScreen.tsx
│   │   └── MeetingDetailsScreen.tsx
│   ├── services/
│   │   └── meetingService.ts    # Supabase data + storage operations
│   ├── stores/
│   │   └── meetingStore.ts      # Zustand global state
│   ├── types/
│   │   └── index.ts             # TypeScript interfaces
│   └── utils/
│       ├── format.ts            # Duration formatting
│       └── nanoid.ts            # ID generation
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   └── 001_initial_schema.sql
│   ├── functions/
│   │   └── process-meeting/
│   │       └── index.ts         # Edge Function: transcribe + AI + PDF
│   ├── rls_policies.sql
│   └── storage_setup.sql
├── .env.example
├── app.json
├── babel.config.js
├── package.json
└── tsconfig.json
```
