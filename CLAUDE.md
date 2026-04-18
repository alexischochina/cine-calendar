# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Approach
- Think before acting. Read existing files before writing code.
- Be concise in output but thorough in reasoning.
- Prefer editing over rewriting whole files.
- Do not re-read files you have already read unless the file may have changed.
- Skip files over 100KB unless explicitly required.
- Suggest running /cost when a session is running long to monitor cache ratio.
- Recommend starting a new session when switching to an unrelated task.
- Test your code before declaring done.
- No sycophantic openers or closing fluff.
- Keep solutions simple and direct.
- User instructions always override this file.

## Commands

```bash
npm run dev       # Start dev server at http://localhost:3000
npm run build     # Build for production
npm run generate  # Generate static site
npm run preview   # Preview production build
```

No test suite is configured.

## Architecture

**Stack:** Nuxt 3 (Vue 3) + Pinia + Supabase + TMDB API. Source lives in `app/`.

**Routing:** File-based via `app/pages/`. Auth middleware (`app/middleware/auth.js`) protects the home route. Login/register use Supabase auth.

**Data flow:**
- User movie calendar entries (movie_id, media type, watch state) are stored in Supabase table `calendar`
- Movie metadata (title, poster, genres, release dates) comes from TMDB API
- Server-side routes in `app/server/api/movies/` proxy TMDB requests (search, details, release dates)
- French release dates are filtered from TMDB's `release_dates` endpoint
- Pinia store at `app/stores/movies.js` manages the movies list state

**Key pages:**
- `/` — Calendar home, movies grouped by year → month → day
- `/search` — TMDB movie search with debounce
- `/movies/[id]` — Movie detail page

**Components:** `MovieListItem.vue` (per-movie row with media type + watch state dropdowns), `SelectBtn.vue` (shared dropdown), `nav/Header.vue` (bottom-floating nav with add-movie form), `Svg.vue` (SVG icon wrapper).

## Environment Variables

Required in `.env`:
```
SUPABASE_URL=
SUPABASE_KEY=
TMD_TOKEN=          # TMDB bearer token
NUXT_API_KEY=       # TMDB API key
NUXT_API_BASE_URL=  # TMDB API base URL
NUXT_API_IMG_URL=   # TMDB image CDN base URL
```

Runtime config is exposed to server-side code via `useRuntimeConfig()` in `nuxt.config.ts`.

## Styling

SCSS with global styles in `app/assets/styles/`. Variables (colors, fonts, breakpoints) are auto-injected via `additionalData` in `nuxt.config.ts` — no need to import `_variables.scss` manually in components.

Breakpoints: mobile ≤767px, tablet ≤1024px, desktop ≥1024px, large ≥1275px.

Dark theme. Primary accent: hot pink (`#ec008b`). Font families: `'f'` (Futura), `'d'` (Do Hyeon).

## Nuxt Config Notes

- `srcDir: 'app/'` — all source under `app/`
- SVG loader Vite plugin enabled for custom element support
- Modules: `@nuxt/image`, `nuxt-swiper`, `@nuxtjs/supabase`, `@pinia/nuxt`
- Homepage (`/`) configured as prerendered in route rules
