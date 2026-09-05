# Organic Growth Analytics

React + Vite PWA untuk analitik pertumbuhan organik akun Instagram Professional. Supabase menangani Auth, PostgreSQL, RLS, Edge Functions, dan Cron; Vercel hanya melayani build statis.

## Menjalankan lokal

1. Salin `.env.example` ke `.env.local` dan isi URL serta publishable key Supabase.
2. Di Supabase Auth, tambahkan `http://localhost:5173/auth/confirm` ke Redirect URLs.
3. Jalankan `npm run dev`.

## Pemeriksaan

```sh
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

## Batas keamanan

Browser hanya menerima publishable key Supabase dan sesi pengguna. Instagram access token, app secret, service-role key, encryption key, cron, OAuth callback, dan AI berada di Supabase Edge Functions mulai Fase 2.

## Belum termasuk

Koneksi Instagram produksi, ingestion, dashboard data, offline snapshot privat, push, AI, dan billing belum dibangun. Fase 1 hanya auth shell, PWA installability, offline fallback publik, dan fondasi Supabase.
