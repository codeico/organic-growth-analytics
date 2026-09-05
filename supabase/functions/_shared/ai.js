const MODES = {
  summary:
    "Buat ringkasan performa 30 hari terakhir: 3-5 poin temuan utama dengan angka, lalu 3 rekomendasi konkret yang bisa dilakukan minggu ini. Sebutkan bila suatu metrik tidak tersedia.",
  ask: "Jawab pertanyaan pengguna hanya berdasarkan data di atas. Jika data tidak cukup untuk menjawab, katakan apa yang tidak tersedia.",
  captions:
    "Analisis caption konten teratas vs terbawah: pola panjang, hook pembuka, CTA, emoji, hashtag. Simpulkan pola yang terbukti bekerja untuk akun INI, bukan tips umum.",
  ideas:
    "Usulkan 5 ide konten baru yang meniru pola konten berperforma terbaik akun ini (jenis, tema, jam tayang). Setiap ide: judul, format, hook kalimat pertama, alasan berbasis data.",
};

const SYSTEM = `Anda analis pertumbuhan Instagram untuk akun Professional. Bahasa Indonesia, ringkas, berorientasi tindakan.
Aturan keras: gunakan HANYA angka yang ada di data. Jangan mengarang metrik, tren, atau benchmark. Jika sesuatu tidak tersedia di data, tulis "tidak tersedia". Jangan menyebut sumber trafik (Explore/Home/hashtag) karena API tidak menyediakannya.
Format: markdown ringan (poin, bold seperlunya), maksimal ~250 kata.`;

/** @param {unknown} v */
const n = (v) => (typeof v === "number" ? v : null);
/** @param {unknown} v */
const show = (v) => (n(v) === null ? "n/a" : String(v));

/**
 * Turns DB rows into a compact, human-readable context. Whatever is not here,
 * the model cannot know — that is the grounding guarantee.
 * @param {{ account: Record<string, any>, metrics: Array<Record<string, any>>, media: Array<Record<string, any>>, audience: Array<Record<string, any>>, breakdowns?: Array<Record<string, any>> }} input
 */
export function buildAnalyticsContext({
  account,
  metrics,
  media,
  audience,
  breakdowns = [],
}) {
  const rows = [...metrics].sort((a, b) =>
    String(a.metric_date).localeCompare(String(b.metric_date)),
  );
  const first = rows[0] ?? {};
  const last = rows.at(-1) ?? {};
  const sum = (key) => rows.reduce((acc, r) => acc + (n(r[key]) ?? 0), 0);
  const lines = [
    `Akun: @${account.username} (${account.account_type})`,
    `Periode: ${first.metric_date ?? "n/a"} s/d ${last.metric_date ?? "n/a"} (${rows.length} hari data)`,
    `followers ${show(first.followers_count)} -> ${show(last.followers_count)}`,
    `reach total ${sum("reach")}, views total ${sum("views")}, interaksi total ${sum("total_interactions")}`,
    `hari terakhir: likes ${show(last.likes)}, comments ${show(last.comments)}, saves ${show(last.saves)}, shares ${show(last.shares)}, follows ${show(last.follows)}, unfollows ${show(last.unfollows)}, taps link profil ${show(last.profile_links_taps)}`,
  ];

  const daily = rows
    .map(
      (r) => `${r.metric_date}: reach ${show(r.reach)}, views ${show(r.views)}`,
    )
    .join("; ");
  if (daily) lines.push(`Harian: ${daily}`);

  if (breakdowns.length) {
    lines.push(
      `Per format (hari terakhir): ${breakdowns
        .map((b) => `${b.metric} ${b.product_type}=${b.value}`)
        .join(", ")}`,
    );
  }

  const ranked = [...media].sort(
    (a, b) => (n(b.reach) ?? n(b.likes) ?? 0) - (n(a.reach) ?? n(a.likes) ?? 0),
  );
  if (ranked.length) {
    lines.push("Konten (urut reach):");
    for (const m of ranked.slice(0, 15)) {
      const at = new Date(m.published_at);
      const caption = String(m.caption ?? "(tanpa caption)")
        .replace(/\s+/g, " ")
        .slice(0, 140);
      lines.push(
        `- [${m.media_product_type ?? m.media_type ?? "?"}] ${at.toISOString().slice(0, 10)} ${String(at.getUTCHours() + 7).padStart(2, "0")}:00 WIB | reach ${show(m.reach)} views ${show(m.views)} likes ${show(m.likes)} comments ${show(m.comments)} saves ${show(m.saved)} shares ${show(m.shares)} | "${caption}"`,
      );
    }
  }

  const byDim = new Map();
  for (const a of audience) {
    const list = byDim.get(a.dimension) ?? [];
    list.push(`${a.label}: ${a.value}`);
    byDim.set(a.dimension, list);
  }
  for (const [dim, list] of byDim) {
    lines.push(`Audiens ${dim}: ${list.slice(0, 8).join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * @param {string} mode
 * @param {string} context
 * @param {string} question
 */
export function buildMessages(mode, context, question) {
  const task = MODES[mode];
  if (!task) throw new Error("Mode AI tidak dikenal");
  const user = [
    "DATA (satu-satunya sumber kebenaran):",
    context,
    "",
    "TUGAS:",
    task,
    mode === "ask" ? `\nPERTANYAAN: ${question.trim().slice(0, 500)}` : "",
  ].join("\n");
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}

/**
 * Calls any OpenAI-compatible /chat/completions endpoint.
 * @param {typeof fetch} fetcher
 * @param {{ baseUrl: string, apiKey: string, model: string }} cfg
 * @param {Array<{ role: string, content: string }>} messages
 */
export async function complete(fetcher, cfg, messages) {
  const response = await fetcher(
    `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: 0.3,
        max_tokens: 700,
      }),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body?.error?.message ?? `LLM ${response.status}`);
  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim())
    throw new Error("LLM tidak mengembalikan jawaban");
  return text.trim();
}
