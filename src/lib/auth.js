/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} email
 * @param {string} origin
 */
export async function sendMagicLink(supabase, email, origin) {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: `${origin}/auth/confirm` },
  });

  if (error) throw error;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} email
 * @param {string} code
 */
export async function verifyEmailCode(supabase, email, code) {
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code.replace(/\s+/g, ""),
    type: "email",
  });

  if (error) throw error;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {boolean} online
 * @param {() => void} onOffline
 */
export async function getCurrentUser(
  supabase,
  online = true,
  onOffline = () => {},
) {
  if (online) {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      return data.user;
    } catch (error) {
      const status = /** @type {{ status?: number }} */ (error)?.status;
      if (!(error instanceof TypeError) && status !== 0) throw error;
      onOffline();
    }
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.user ?? null;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} url
 */
export async function confirmMagicLink(supabase, url) {
  const params = new URL(url).searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }

  if (tokenHash && type === "email") {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "email",
    });
    if (error) throw error;
    return;
  }

  throw new Error("Tautan masuk tidak valid");
}
