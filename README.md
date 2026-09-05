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

## Dashboard dan multi-akun

Dashboard membaca akun, metrik harian, demografi agregat, dan media langsung dari tabel Supabase ber-RLS. Setiap pengguna dapat menghubungkan maksimal lima akun Instagram Professional. Browser hanya memiliki akses baca; perubahan akun dan token dilakukan oleh Edge Functions.

## Konfigurasi Instagram

Sebelum tombol koneksi digunakan, isi Supabase secrets `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `TOKEN_ENCRYPTION_KEY` (base64 32 byte), dan `APP_URL`. Tambahkan callback berikut ke OAuth redirect URI aplikasi Meta:

`https://fqwpwisjsvolpoqigbms.supabase.co/functions/v1/instagram-callback`

## Belum termasuk

Sinkronisasi insight terjadwal, offline snapshot privat, push, AI, dan billing belum dibangun. Dashboard sengaja menampilkan empty state sampai data resmi Instagram tersedia.
