# Ultimate Tic Tac Toe

Play Ultimate Tic Tac Toe with local hotseat or bots. Cat games are settled with Rock Paper Scissors Lizard Spock.

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Remote play (Supabase Realtime)

1. Create a Supabase project (free tier is fine) and grab the project URL and anon key.
2. Copy `.env.example` to `.env.local` and set:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Restart `npm run dev`. Use the “Remote play (Supabase)” card to host/join a match with a short code.

## Notes / features

- State is stored in cookies only; Supabase is used only for realtime move sync.
- AI levels: Easy (random), Smart (depth-2 heuristic), Hard (depth-3 heuristic).
- Designed for Vercel (Next.js App Router + Tailwind).

## Docker

```bash
docker-compose up --build
```
