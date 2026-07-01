# Dealer Portal Application

## Overview

This is a multi-step Dealer Portal web application for managing dealer application submissions. It features a React frontend with a wizard-style form that walks dealers through identity verification (simulated OCR scanning), profile/social status collection, product selection with pricing logic, and final submission. The backend is an Express server with PostgreSQL for data persistence and session management.

The application is designed to be managed via n8n workflows and handles complex pricing logic, AI-simulated OCR, and multi-file uploads (as base64 strings).

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend (`client/`)
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight client-side router)
- **State Management**: TanStack React Query for server state; local React state for form wizard
- **UI Components**: shadcn/ui (new-york style) built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode support)
- **Animations**: Framer Motion for page transitions and wizard step animations
- **Typography**: Plus Jakarta Sans (display) and Inter (body)
- **Build Tool**: Vite with React plugin

**Key Frontend Patterns:**
- Multi-step wizard form (4 steps): Identity Scanning → Profile & Social Status → Product & Pricing → Finalize
- Auth guard component wraps all routes to enforce login
- `useAuth` hook manages login/logout/session via React Query
- `useSubmission` hook handles form submission mutation
- File uploads are converted to base64 strings client-side via `fileToBase64` utility
- Path aliases: `@/` → `client/src/`, `@shared/` → `shared/`

### Backend (`server/`)
- **Framework**: Express 5 (TypeScript, ESM)
- **HTTP Server**: Node.js `http.createServer` wrapping Express
- **Authentication**: Passport.js with LocalStrategy, express-session
- **Session Store**: connect-pg-simple (PostgreSQL-backed sessions)
- **API Pattern**: JSON REST endpoints under `/api/` prefix
- **Dev Server**: Vite dev server middleware in development; static file serving in production

**Key Backend Patterns:**
- Routes are registered in `server/routes.ts` via `registerRoutes()`
- Storage layer abstraction in `server/storage.ts` with `IStorage` interface and `DatabaseStorage` implementation
- Password comparison is currently plaintext (not hashed) — this is intentional per the spec (password: `Energo123#`)
- Build script bundles server with esbuild and client with Vite

### Shared (`shared/`)
- **Schema**: Drizzle ORM schema definitions in `shared/schema.ts`
- **Routes/API contracts**: Typed API route definitions with Zod schemas in `shared/routes.ts`
- **Validation**: `submissionSchema` defines the full form submission shape with Zod

### Database
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Database**: PostgreSQL (required via `DATABASE_URL` environment variable)
- **Schema Push**: `npm run db:push` uses drizzle-kit to push schema changes
- **Current Tables**: `users` table (id, username, password)
- **Migrations**: Output to `./migrations` directory

### Build & Deploy
- **Dev**: `npm run dev` runs tsx with the Express server (Vite middleware for HMR)
- **Build**: `npm run build` bundles client (Vite) and server (esbuild) into `dist/`
- **Production**: `npm start` serves the built bundle from `dist/index.cjs`
- Server dependencies in the build allowlist are bundled; others are externalized

## External Dependencies

### Database
- **PostgreSQL**: Required. Connection via `DATABASE_URL` environment variable. Used for user data and session storage.

### Key NPM Packages
- **drizzle-orm** + **drizzle-kit**: ORM and migration tooling for PostgreSQL
- **express** (v5): HTTP server framework
- **passport** + **passport-local**: Authentication
- **express-session** + **connect-pg-simple**: Session management backed by PostgreSQL
- **@tanstack/react-query**: Server state management on the client
- **shadcn/ui** (Radix UI primitives): Complete UI component library
- **framer-motion**: Animations
- **wouter**: Client-side routing
- **zod** + **drizzle-zod**: Schema validation
- **react-day-picker**: Calendar component
- **vaul**: Drawer component
- **embla-carousel-react**: Carousel component
- **recharts**: Chart components

### Replit-Specific
- **@replit/vite-plugin-runtime-error-modal**: Runtime error overlay in development
- **@replit/vite-plugin-cartographer**: Dev tooling (dev only)
- **@replit/vite-plugin-dev-banner**: Dev banner (dev only)

### Environment Variables Required
- `DATABASE_URL`: PostgreSQL connection string (required)
- `SESSION_SECRET`: Session encryption secret (falls back to `"dealer-portal-secret"`)
