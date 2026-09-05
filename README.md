# StudyPilot

StudyPilot is a Phase 1 static MVP for an agentic study assistant. It is designed around guided learning: prompts, hints, active recall, study planning, and progress signals instead of answer dumping.

## Run locally

On Windows PowerShell, use `npm.cmd` if the shell blocks `npm.ps1` with an execution-policy error:

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:3000` in a browser. If port 3000 is already in use, the app may already be running there.

```text
index.html
styles.css
app.js
```

## Included in this phase

- Dashboard with exam preparation, daily focus, subject progress, streak, and recent activity
- AI Tutor surface with context-aware Biology/Genetics prompts, hints, simpler explanations, and understanding checks
- Study plan, subjects, materials, and flashcards views with responsive layouts
- Mobile navigation and responsive desktop/tablet/mobile styling
- Accessible labels, semantic landmarks, visible focusable controls, and an AI accuracy disclaimer
- First-open account gate with email/password signup, six-digit verification, sign-in, password reset, and Google/GitHub/Discord OAuth entry points
- Real OAuth redirect server for Google, GitHub, and Discord with state validation and HttpOnly session cookies
- Notion OAuth connection for future AI-assisted note-taking, summarization, and review prompts
- PostgreSQL/Supabase-ready schema in `schema.sql` for profiles, subjects, topics, exams, materials, notes, mastery, quizzes, flashcards, sessions, and conversations
- Protected API foundation for tutor replies, material analysis, adaptive mastery updates, plan generation, notes, flashcards, progress, study sessions, and approved Notion pages
- Materials now open an AI analysis composer; study sessions, adaptive plan generation, and flashcard generation are connected to protected API actions from the existing workspace controls

## Architecture direction

The current client interactions remain isolated in `app.js`, while `server.js` now provides the first real API boundary. The planned production architecture is:

- Next.js + TypeScript + App Router for the application shell
- Prisma + PostgreSQL for users, subjects, topics, exams, materials, sessions, questions, flashcards, mastery, conversations, and agent tasks
- Zod validation at API boundaries
- An `AIProvider` interface for `generateText`, `generateStructuredOutput`, `createEmbeddings`, and `streamText`
- Server-side ownership checks for every student resource

## Environment variables for the next backend phase

Create `.env.local` from `.env.example` when the backend is introduced:

```text
DATABASE_URL=
AI_PROVIDER=
AI_API_KEY=
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=
SMTP_PASSWORD=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
APP_URL=http://localhost:3000
```

## OAuth callback URLs

Register these exact URLs in each provider's OAuth application while testing locally:

```text
Google:  http://localhost:3000/auth/google/callback
GitHub:  http://localhost:3000/auth/github/callback
Discord: http://localhost:3000/auth/discord/callback
Notion:  http://localhost:3000/auth/notion/callback
```

The OAuth buttons now redirect to the providers for real. A provider will show `redirect_uri_mismatch` until its callback URL is registered exactly, including protocol, port, path, and trailing-slash behavior. Notion requires selecting the pages/workspace the integration may access; StudyPilot should only use that approved content for note assistance.

## Remaining limitation

Email verification still displays a local demo code; production email delivery needs server-side password hashing, database-backed users, rate limiting, and Gmail SMTP. OAuth has real server-side redirects and callback exchange, but production deployment still needs a persistent session store and HTTPS. The SQL schema and API foundation are ready to connect to Supabase; the remaining work is wiring every view to those endpoints, executing migrations, adding file upload/storage, and completing the controlled Study Agent workflow.
