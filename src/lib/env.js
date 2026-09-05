/** @param {Record<string, unknown>} env */
export function parsePublicEnv(env) {
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (typeof supabaseUrl !== "string" || typeof supabaseKey !== "string") {
    throw new Error("Konfigurasi Supabase belum lengkap");
  }

  try {
    if (new URL(supabaseUrl).protocol !== "https:") throw new Error();
  } catch {
    throw new Error("VITE_SUPABASE_URL harus berupa URL HTTPS");
  }

  return { supabaseUrl, supabaseKey };
}
