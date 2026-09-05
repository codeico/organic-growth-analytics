import { useEffect, useState } from "react";
import {
  confirmMagicLink,
  getCurrentUser,
  sendMagicLink,
  verifyEmailCode,
} from "./lib/auth.js";
import { routeForUser } from "./lib/access.js";
import {
  beginInstagramConnection,
  requestInstagramSync,
  buildMetricSummary,
  buildTrendPoints,
  listInstagramAccounts,
  loadAccountAnalytics,
  pickAccounts,
  requestAiInsight,
  sumWindow,
  summarizeContent,
  parseInline,
  parseMarkdown,
  summarizeMediaInteractions,
} from "./lib/dashboard.js";
import { supabase } from "./lib/supabase.js";
import {
  clearDashboardSnapshot,
  loadDashboardSnapshot,
  saveDashboardSnapshot,
} from "./lib/offline.js";

// iOS never fires beforeinstallprompt; install is Share -> Add to Home Screen.
const NEEDS_IOS_INSTALL_HINT =
  /iPhone|iPad|iPod/.test(navigator.userAgent) &&
  !matchMedia("(display-mode: standalone)").matches;

/** @typedef {{ id: string, username: string, name?: string | null, account_type: string, profile_picture_url?: string | null, status: string, last_synced_at?: string | null, created_at: string }} InstagramAccount */
/** @typedef {{ accountId: string | null, metrics: Array<Record<string, any>>, media: Array<Record<string, any>>, audience: Array<Record<string, any>>, breakdowns?: Array<Record<string, any>> }} AnalyticsState */
/** @typedef {Event & { prompt: () => Promise<void>, userChoice: Promise<{ outcome: string }> }} BeforeInstallPromptEvent */
/** @type {AnalyticsState} */
const emptyAnalytics = {
  accountId: null,
  metrics: [],
  media: [],
  audience: [],
};
const numberFormat = new Intl.NumberFormat("id-ID", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const dateFormat = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** @param {string} path */
function normalizePath(path) {
  return path !== "/" && path.endsWith("/") ? path.slice(0, -1) : path;
}

/** @param {string} path */
function go(path) {
  history.replaceState({}, "", path);
}

/** @param {number | null | undefined} value */
function formatMetric(value) {
  return typeof value === "number"
    ? numberFormat.format(value)
    : "Belum ada data";
}

/** @param {string | null | undefined} value */
function formatDate(value) {
  return value ? dateFormat.format(new Date(value)) : "Belum pernah";
}

export default function App() {
  const [state, setState] = useState(
    /** @type {{ loading: boolean, user: import("@supabase/supabase-js").User | null }} */ ({
      loading: true,
      user: null,
    }),
  );
  // Start optimistic: navigator.onLine is unreliable; the first server
  // round-trip in getCurrentUser decides.
  const [online, setOnline] = useState(true);
  const [installPrompt, setInstallPrompt] = useState(
    /** @type {BeforeInstallPromptEvent | null} */ (null),
  );
  const [updateWorker, setUpdateWorker] = useState(
    /** @type {ServiceWorker | null} */ (null),
  );

  useEffect(() => {
    let active = true;

    async function loadUser() {
      try {
        const user = await getCurrentUser(
          supabase,
          () => setOnline(false),
          () => setOnline(true),
        );
        if (!active) return;
        setState({ loading: false, user });
      } catch {
        if (active) setState({ loading: false, user: null });
      }
    }

    // "online" is a hint to re-validate; "offline" is ignored because Chrome
    // fires it spuriously with VPNs/virtual adapters. Real failures surface
    // through getCurrentUser -> onOffline.
    const setConnection = () => loadUser();
    /** @param {Event} event */
    const captureInstall = (event) => {
      event.preventDefault();
      setInstallPrompt(/** @type {BeforeInstallPromptEvent} */ (event));
    };
    /** @param {Event} event */
    const captureUpdate = (event) =>
      setUpdateWorker(/** @type {CustomEvent<ServiceWorker>} */ (event).detail);

    loadUser();
    addEventListener("online", setConnection);
    addEventListener("offline", setConnection);
    addEventListener("beforeinstallprompt", captureInstall);
    addEventListener("app-update-ready", captureUpdate);
    const { data } = supabase.auth.onAuthStateChange(() => loadUser());
    return () => {
      active = false;
      removeEventListener("online", setConnection);
      removeEventListener("offline", setConnection);
      removeEventListener("beforeinstallprompt", captureInstall);
      removeEventListener("app-update-ready", captureUpdate);
      data.subscription.unsubscribe();
    };
  }, []);

  if (state.loading) return <LoadingScreen />;

  const requestedPath = normalizePath(location.pathname);
  const path = routeForUser(requestedPath, state.user);
  if (path !== requestedPath) go(path);

  if (path === "/auth/confirm") return <Confirming />;
  if (path === "/dashboard" && state.user)
    return (
      <Dashboard
        user={state.user}
        online={online}
        installPrompt={installPrompt}
        updateWorker={updateWorker}
      />
    );
  return <Login />;
}

function LoadingScreen() {
  return (
    <main className="center" aria-busy="true">
      <div className="loader" aria-hidden="true" />
      <p>Memuat sesi…</p>
    </main>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  /** @param {import("react").FormEvent<HTMLFormElement>} event */
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (sent) {
        await verifyEmailCode(supabase, email, code);
        // onAuthStateChange in App routes to the dashboard.
      } else {
        try {
          await sendMagicLink(supabase, email, location.origin);
        } catch (error) {
          // Rate-limited means an email was already sent; let them use it.
          if (/** @type {{ status?: number }} */ (error)?.status !== 429)
            throw error;
        }
        setSent(true);
        setMessage(
          "Email terkirim. Masukkan kode 8 digit dari email tersebut.",
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Gagal memproses permintaan.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="intro">
        <span className="brand-mark" aria-hidden="true">
          OG
        </span>
        <p className="kicker">Organic Growth Analytics</p>
        <h1>Pertumbuhan yang bisa dijelaskan.</h1>
        <p className="lede">
          Pantau akun Instagram Professional dengan data resmi, bukan perkiraan.
        </p>
      </section>
      <form className="login-form" onSubmit={submit}>
        <h2>Masuk</h2>
        <p>
          {sent
            ? "Ketik kode dari email, atau klik tautan di email jika Anda memakai browser."
            : "Kami akan mengirim kode dan tautan sekali pakai ke email Anda."}
        </p>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          readOnly={sent}
          autoComplete="email"
          spellCheck="false"
        />
        {sent ? (
          <>
            <label htmlFor="code">Kode 8 digit</label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
              autoFocus
            />
          </>
        ) : null}
        <button disabled={busy}>
          {busy ? "Memproses…" : sent ? "Masuk" : "Kirim kode masuk"}
        </button>
        {sent ? (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setSent(false);
              setCode("");
              setMessage("");
            }}
          >
            Ganti email
          </button>
        ) : null}
        <p className="form-message" aria-live="polite">
          {message}
        </p>
      </form>
    </main>
  );
}

function Confirming() {
  const [error, setError] = useState("");

  useEffect(() => {
    async function confirm() {
      try {
        await confirmMagicLink(supabase, location.href);
        go("/dashboard");
        location.reload();
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Tautan masuk tidak dapat diproses.",
        );
      }
    }
    confirm();
  }, []);

  return (
    <main className="center">
      {error ? <p role="alert">{error}</p> : <p>Menyelesaikan login…</p>}
    </main>
  );
}

/** @param {InstagramAccount[]} accounts */
const accountTitle = (accounts) =>
  accounts.length > 1
    ? `${accounts.length} akun gabungan`
    : `@${accounts[0]?.username ?? ""}`;
/** @param {InstagramAccount[]} accounts */
const lastSynced = (accounts) =>
  accounts
    .map((a) => a.last_synced_at ?? "")
    .sort()
    .at(-1) || null;

/** @typedef {"overview" | "trend" | "content" | "audience"} View */
/** @type {Array<[View, string]>} */
const VIEWS = [
  ["overview", "Ringkasan"],
  ["trend", "Pertumbuhan"],
  ["content", "Konten"],
  ["audience", "Audiens"],
];
function readView() {
  const key = location.hash.slice(1).split("/")[0];
  return VIEWS.some(([k]) => k === key)
    ? /** @type {View} */ (key)
    : "overview";
}
/** `#content/<media row id>` opens the per-content detail page. */
function readDetailId() {
  const [key, id] = location.hash.slice(1).split("/");
  return key === "content" && id ? id : null;
}

/** @type {Record<string, string>} */
const THEME_LABEL = {
  system: "Tema mengikuti sistem. Klik untuk tema terang.",
  light: "Tema terang. Klik untuk tema gelap.",
  dark: "Tema gelap. Klik untuk mengikuti sistem.",
};
const THEMES = Object.keys(THEME_LABEL);
function ThemeToggle() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem("theme") ?? "system",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);
  return (
    <button
      type="button"
      className="icon-button"
      data-theme={theme}
      aria-label={THEME_LABEL[theme]}
      title={THEME_LABEL[theme]}
      onClick={() =>
        setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length])
      }
    />
  );
}

/** @param {{ user: import("@supabase/supabase-js").User, online: boolean, installPrompt: BeforeInstallPromptEvent | null, updateWorker: ServiceWorker | null }} props */
function Dashboard({ user, online, installPrompt, updateWorker }) {
  const [accounts, setAccounts] = useState(
    /** @type {InstagramAccount[]} */ ([]),
  );
  const [selectedIds, setSelectedIds] = useState(/** @type {string[]} */ ([]));
  const [analytics, setAnalytics] = useState(
    /** @type {AnalyticsState} */ (emptyAnalytics),
  );
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  const selected = pickAccounts(accounts, selectedIds);
  const selectionKey = selected.map((a) => a.id).join(",");
  const [view, setView] = useState(readView);
  const [detailId, setDetailId] = useState(readDetailId);
  useEffect(() => {
    const onHash = () => {
      setView(readView());
      setDetailId(readDetailId());
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadAccounts() {
      if (!online) {
        const snapshot = await loadDashboardSnapshot(caches, user.id);
        if (!active) return;
        if (snapshot) {
          setAccounts(/** @type {InstagramAccount[]} */ (snapshot.accounts));
          setSelectedIds(/** @type {string[]} */ (snapshot.selectedIds ?? []));
          setAnalytics(/** @type {AnalyticsState} */ (snapshot.analytics));
        }
        setLoading(false);
        return;
      }

      try {
        const rows = await listInstagramAccounts(supabase);
        if (!active) return;
        setAccounts(rows);
        setSelectedIds((current) =>
          pickAccounts(rows, current).map((a) => a.id),
        );
      } catch (reason) {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Gagal memuat akun Instagram.",
          );
      } finally {
        if (active) setLoading(false);
      }
    }

    loadAccounts();
    return () => {
      active = false;
    };
  }, [online, user.id]);

  useEffect(() => {
    if (!selectionKey || !online) return;
    let active = true;
    loadAccountAnalytics(supabase, selectionKey.split(","))
      .then((data) => {
        if (active) setAnalytics({ accountId: selectionKey, ...data });
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : "Gagal memuat analitik.",
          );
      });
    return () => {
      active = false;
    };
  }, [online, selectionKey]);

  useEffect(() => {
    if (
      !online ||
      !user.id ||
      !selectionKey ||
      analytics.accountId !== selectionKey
    )
      return;
    saveDashboardSnapshot(caches, user.id, {
      accounts,
      selectedIds: selectionKey.split(","),
      analytics,
    }).catch(() => undefined);
  }, [accounts, analytics, online, selectionKey, user.id]);

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
  }

  function updateApp() {
    updateWorker?.postMessage("SKIP_WAITING");
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => location.reload(),
      { once: true },
    );
  }

  async function syncInstagram() {
    if (!online || syncing) return;
    setSyncing(true);
    setError("");
    try {
      const results = await requestInstagramSync(supabase);
      if (results.some((result) => result.status === "failed"))
        throw new Error("Sebagian data Instagram gagal disinkronkan.");
      if (selectionKey) {
        const data = await loadAccountAnalytics(
          supabase,
          selectionKey.split(","),
        );
        setAnalytics({ accountId: selectionKey, ...data });
      }
      const rows = await listInstagramAccounts(supabase);
      setAccounts(rows);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Sinkronisasi Instagram gagal.",
      );
    } finally {
      setSyncing(false);
    }
  }

  async function connectInstagram() {
    if (!online) {
      setError("Sambungkan internet untuk menghubungkan akun Instagram.");
      return;
    }
    setConnecting(true);
    setError("");
    try {
      location.assign(await beginInstagramConnection(supabase));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Koneksi Instagram belum tersedia.",
      );
      setConnecting(false);
    }
  }

  async function logout() {
    await clearDashboardSnapshot(caches, user.id);
    await supabase.auth.signOut();
    go("/login");
    location.reload();
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Lewati ke konten
      </a>
      <aside className="sidebar">
        <a
          className="wordmark"
          href="#overview"
          aria-label="Organic Growth Analytics"
        >
          <span aria-hidden="true">OG</span>
          <strong>Organic Growth</strong>
        </a>
        <nav aria-label="Navigasi dashboard">
          {VIEWS.map(([key, label]) => (
            <a
              key={key}
              href={`#${key}`}
              className={view === key ? "active" : undefined}
              aria-current={view === key ? "page" : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="sidebar-footer">
          <p>{user.email}</p>
          <ThemeToggle />
          <button className="text-button" onClick={logout}>
            Keluar
          </button>
        </div>
      </aside>

      <main id="main-content" className="dashboard">
        <div className="app-status" role="status" aria-live="polite">
          <span className={online ? "online" : "offline"}>
            {online ? (
              "Online"
            ) : (
              <>
                Offline - menampilkan snapshot terakhir{" "}
                <button
                  type="button"
                  className="status-action"
                  // Reuses App's existing "online" listener, which re-validates
                  // against the server.
                  onClick={() => dispatchEvent(new Event("online"))}
                >
                  Coba sambungkan
                </button>
              </>
            )}
          </span>
          <div>
            {installPrompt ? (
              <button className="status-action" onClick={installApp}>
                Instal aplikasi
              </button>
            ) : NEEDS_IOS_INSTALL_HINT ? (
              <small>Instal: Bagikan → Tambah ke Layar Utama</small>
            ) : null}
            {updateWorker ? (
              <button className="status-action" onClick={updateApp}>
                Perbarui
              </button>
            ) : null}
          </div>
        </div>
        <header
          className="dashboard-header"
          id="overview"
          hidden={view !== "overview"}
        >
          <div>
            <p className="kicker">Ringkasan akun</p>
            <h1>{selected.length ? accountTitle(selected) : "Dashboard"}</h1>
            <p className="muted">
              {selected.length
                ? `Sinkronisasi terakhir ${formatDate(lastSynced(selected))}`
                : "Hubungkan akun Instagram Professional untuk mulai membaca data."}
            </p>
          </div>
          <div className="header-actions">
            {accounts.length > 0 ? (
              <>
                <details className="account-picker">
                  <summary>
                    {selected.length === 1
                      ? `@${selected[0].username}`
                      : `${selected.length} akun dipilih`}
                  </summary>
                  <div>
                    {accounts.map((account) => {
                      const checked = selected.some((a) => a.id === account.id);
                      return (
                        <label key={account.id}>
                          <input
                            type="checkbox"
                            checked={checked}
                            // Keep at least one account selected.
                            disabled={checked && selected.length === 1}
                            onChange={() =>
                              setSelectedIds(
                                checked
                                  ? selected
                                      .filter((a) => a.id !== account.id)
                                      .map((a) => a.id)
                                  : [...selected.map((a) => a.id), account.id],
                              )
                            }
                          />
                          @{account.username}
                        </label>
                      );
                    })}
                  </div>
                </details>
                <button
                  className="secondary-action"
                  onClick={syncInstagram}
                  disabled={!online || syncing}
                >
                  {syncing ? "Menyinkronkan…" : "Sinkronkan"}
                </button>
              </>
            ) : null}
            <button
              onClick={connectInstagram}
              disabled={!online || connecting || accounts.length >= 5}
            >
              {connecting
                ? "Menghubungkan…"
                : accounts.length
                  ? "Tambah akun"
                  : "Hubungkan Instagram"}
            </button>
          </div>
        </header>

        {error ? (
          <div className="notice error" role="alert">
            {error}
          </div>
        ) : null}
        {accounts.length >= 5 ? (
          <p className="limit-note">Batas lima akun telah tercapai.</p>
        ) : null}

        {loading || (selectionKey && analytics.accountId !== selectionKey) ? (
          <DashboardSkeleton />
        ) : selected.length ? (
          <AnalyticsDashboard
            accounts={selected}
            analytics={analytics}
            online={online}
            view={view}
            detailId={detailId}
          />
        ) : (
          <EmptyDashboard onConnect={connectInstagram} busy={connecting} />
        )}
      </main>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <section
      className="skeleton-grid"
      aria-label="Memuat dashboard"
      aria-busy="true"
    >
      {Array.from({ length: 8 }, (_, index) => (
        <div className="skeleton" key={index} />
      ))}
    </section>
  );
}

/** @param {{ onConnect: () => void, busy: boolean }} props */
function EmptyDashboard({ onConnect, busy }) {
  return (
    <section className="empty-dashboard">
      <p className="section-index">Belum ada data</p>
      <h2>Hubungkan akun pertama Anda.</h2>
      <p>
        Setelah tersambung, metrik, demografi, dan konten teratas akan muncul di
        sini.
      </p>
      <button onClick={onConnect} disabled={busy}>
        {busy ? "Menghubungkan…" : "Hubungkan Instagram"}
      </button>
    </section>
  );
}

/** @param {{ account: InstagramAccount, analytics: AnalyticsState }} props */
const METRIC_TABS = [
  ["followers_count", "Followers"],
  ["reach", "Reach"],
  ["views", "Views"],
  ["total_interactions", "Interaksi"],
];
/** @type {Array<["summary" | "ask" | "captions" | "ideas", string]>} */
const AI_MODES = [
  ["summary", "Ringkasan 30 hari"],
  ["captions", "Analisis caption"],
  ["ideas", "Ide konten"],
  ["ask", "Tanya data"],
];
/** @type {Record<string, string>} */
const DIMENSION_LABELS = {
  country: "Negara",
  city: "Kota",
  age: "Usia",
  gender: "Gender",
  engaged_country: "Negara (audiens terlibat)",
};

/** @param {number | null} change */
function formatChange(change) {
  if (change === null) return "belum ada pembanding";
  const pct = Math.round(change * 100);
  return `${pct >= 0 ? "+" : ""}${pct}% vs 7 hari sebelumnya`;
}

/** @param {{ accounts: InstagramAccount[], analytics: AnalyticsState, online: boolean, view: View, detailId: string | null }} props */
function AnalyticsDashboard({ accounts, analytics, online, view, detailId }) {
  const account = accounts[0];
  const title = accountTitle(accounts);
  const [metricKey, setMetricKey] = useState("followers_count");
  const [dimension, setDimension] = useState("country");
  const summary = buildMetricSummary(analytics.metrics);
  const points = buildTrendPoints(analytics.metrics, 640, 220, metricKey);
  const reach7 = sumWindow(analytics.metrics, "reach", 7);
  const views7 = sumWindow(analytics.metrics, "views", 7);
  const interactions7 = sumWindow(analytics.metrics, "total_interactions", 7);
  const latest = analytics.metrics.at(-1) ?? {};
  const content = summarizeContent(analytics.media);
  const dimensions = [...new Set(analytics.audience.map((r) => r.dimension))];
  const activeDimension = dimensions.includes(dimension)
    ? dimension
    : (dimensions[0] ?? "country");
  const audience = analytics.audience
    .filter((row) => row.dimension === activeDimension)
    .slice(0, 8);
  const audienceMax = Math.max(
    ...audience.map((row) => Number(row.value) || 0),
    1,
  );
  const metrics = [
    [
      "Followers",
      formatMetric(summary.followers),
      summary.followerGrowth === null
        ? "Perlu lebih banyak data"
        : `${summary.followerGrowth >= 0 ? "+" : ""}${numberFormat.format(summary.followerGrowth)} periode ini`,
    ],
    ["Reach 7 hari", formatMetric(reach7.current), formatChange(reach7.change)],
    ["Views 7 hari", formatMetric(views7.current), formatChange(views7.change)],
    [
      "Interaksi 7 hari",
      formatMetric(interactions7.current),
      formatChange(interactions7.change),
    ],
  ];
  const daily = [
    ["Follows", latest.follows],
    ["Unfollows", latest.unfollows],
    ["Likes", latest.likes],
    ["Komentar", latest.comments],
    ["Disimpan", latest.saves],
    ["Dibagikan", latest.shares],
    ["Balasan story", latest.replies],
    ["Tap link profil", latest.profile_links_taps],
    ["Akun terlibat", latest.accounts_engaged],
  ];

  if (view === "trend")
    return (
      <section className="dashboard-grid" id="trend">
        <article className="panel trend-panel">
          <div className="section-heading">
            <div>
              <p className="section-index">
                {analytics.metrics.length} hari data
              </p>
              <h2>Tren harian</h2>
            </div>
            <div className="tabs" role="tablist" aria-label="Pilih metrik">
              {METRIC_TABS.map(([key, label]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={metricKey === key}
                  className={metricKey === key ? "tab active" : "tab"}
                  onClick={() => setMetricKey(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {points ? (
            <div className="chart-wrap">
              <svg
                className="trend-chart"
                viewBox="0 0 640 220"
                role="img"
                aria-label={`Grafik ${metricKey} ${title}`}
              >
                <line x1="0" y1="219" x2="640" y2="219" />
                <polyline points={points} />
              </svg>
              <details>
                <summary>Lihat data tabel</summary>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Tanggal</th>
                        <th>Followers</th>
                        <th>Reach</th>
                        <th>Views</th>
                        <th>Interaksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...analytics.metrics].reverse().map((row) => (
                        <tr key={row.metric_date}>
                          <td>{formatDate(row.metric_date)}</td>
                          <td>{formatMetric(row.followers_count)}</td>
                          <td>{formatMetric(row.reach)}</td>
                          <td>{formatMetric(row.views)}</td>
                          <td>{formatMetric(row.total_interactions)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          ) : (
            <PanelEmpty text="Metrik ini belum punya dua titik data. Instagram hanya menyediakan histori reach; metrik lain terisi harian mulai sekarang." />
          )}
        </article>

        <article className="panel account-panel">
          <p className="section-index">Hari terakhir</p>
          <h2>{title}</h2>
          <dl className="daily-grid">
            {daily.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{formatMetric(value)}</dd>
              </div>
            ))}
            <div>
              <dt>Sinkronisasi</dt>
              <dd>{formatDate(lastSynced(accounts))}</dd>
            </div>
          </dl>
        </article>
      </section>
    );
  if (view === "content" && detailId) {
    const item = analytics.media.find((m) => String(m.id) === detailId);
    return item ? (
      <ContentDetail item={item} />
    ) : (
      <section className="dashboard-grid lower-grid">
        <article className="panel">
          <PanelEmpty text="Konten tidak ditemukan pada akun yang dipilih." />
          <a className="text-button" href="#content">
            Kembali ke konten
          </a>
        </article>
      </section>
    );
  }
  if (view === "content")
    return (
      <section className="dashboard-grid lower-grid" id="content">
        <article className="panel content-panel" id="content">
          <div className="section-heading">
            <div>
              <p className="section-index">Konten</p>
              <h2>Format & jam tayang</h2>
            </div>
          </div>
          {content.byFormat.length ? (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Format</th>
                      <th>Jumlah</th>
                      <th>Rata-rata reach</th>
                      <th>Rata-rata interaksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {content.byFormat.map((row) => (
                      <tr key={row.format}>
                        <td>{row.format}</td>
                        <td>{row.count}</td>
                        <td>{formatMetric(row.avgReach)}</td>
                        <td>{formatMetric(row.avgInteractions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {content.bestHours.length ? (
                <p className="hint">
                  Jam tayang dengan reach rata-rata tertinggi (WIB):{" "}
                  {content.bestHours
                    .map(
                      (h) =>
                        `${String(h.hour).padStart(2, "0")}:00 (${h.count} konten, reach ${formatMetric(h.avgReach)})`,
                    )
                    .join(" · ")}
                  . Dihitung dari konten Anda sendiri, bukan estimasi.
                </p>
              ) : null}
              <details>
                <summary>Semua konten ({analytics.media.length})</summary>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Konten</th>
                        <th>Format</th>
                        <th>Reach</th>
                        <th>Views</th>
                        <th>Interaksi</th>
                        <th>Disimpan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.media.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <a
                              className="media-cell"
                              href={`#content/${item.id}`}
                            >
                              {item.thumbnail_url ? (
                                <img
                                  src={item.thumbnail_url}
                                  alt=""
                                  loading="lazy"
                                  width="56"
                                  height="56"
                                />
                              ) : (
                                <span className="media-thumb-empty" />
                              )}
                              <span>
                                <span className="media-caption">
                                  {item.caption?.trim() || item.media_type}
                                </span>
                                <small>{formatDate(item.published_at)}</small>
                              </span>
                            </a>
                          </td>
                          <td>{item.media_product_type ?? item.media_type}</td>
                          <td>{formatMetric(item.reach)}</td>
                          <td>{formatMetric(item.views)}</td>
                          <td>{formatMetric(item.total_interactions)}</td>
                          <td>{formatMetric(item.saved)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          ) : (
            <PanelEmpty text="Konten akan muncul setelah sinkronisasi pertama." />
          )}
        </article>
      </section>
    );
  if (view === "audience")
    return (
      <>
        <section className="dashboard-grid lower-grid" id="audience">
          <article className="panel audience-panel" id="audience">
            <div className="section-heading">
              <div>
                <p className="section-index">Audiens</p>
                <h2>Demografi</h2>
              </div>
            </div>
            {dimensions.length ? (
              <>
                <div className="tabs" role="tablist" aria-label="Pilih dimensi">
                  {dimensions.map((dim) => (
                    <button
                      key={dim}
                      role="tab"
                      aria-selected={activeDimension === dim}
                      className={activeDimension === dim ? "tab active" : "tab"}
                      onClick={() => setDimension(dim)}
                    >
                      {DIMENSION_LABELS[dim] ?? dim}
                    </button>
                  ))}
                </div>
                <ol className="audience-list">
                  {audience.map((row) => (
                    <li key={`${row.dimension}-${row.label}`}>
                      <div>
                        <span>{row.label}</span>
                        <strong>{formatMetric(row.value)}</strong>
                      </div>
                      <span
                        className="audience-bar"
                        style={
                          /** @type {import("react").CSSProperties} */ ({
                            "--bar-width": `${(Number(row.value) / audienceMax) * 100}%`,
                          })
                        }
                      />
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <PanelEmpty text="Demografi tersedia setelah akun punya minimal 100 followers dan Instagram mengembalikan data agregat." />
            )}
          </article>
        </section>
        <AiPanel
          account={account}
          merged={accounts.length > 1}
          online={online}
        />
      </>
    );
  return (
    <>
      <section className="metrics" aria-label="Metrik utama">
        {metrics.map(([label, value, note]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{note}</small>
          </article>
        ))}
      </section>
      <AiPanel account={account} merged={accounts.length > 1} online={online} />
    </>
  );
}

/** @param {{ text: string }} props */
function AiAnswer({ text }) {
  /** @param {string} t */
  const inline = (t) =>
    parseInline(t).map((seg, i) =>
      seg.bold ? <strong key={i}>{seg.text}</strong> : seg.text,
    );
  return (
    <div className="ai-answer">
      {parseMarkdown(text).map((block, i) => {
        if (block.type === "h2")
          return <h4 key={i}>{inline(block.text ?? "")}</h4>;
        if (block.type === "h3")
          return <h5 key={i}>{inline(block.text ?? "")}</h5>;
        if (block.type === "p")
          return <p key={i}>{inline(block.text ?? "")}</p>;
        const List = block.type === "ol" ? "ol" : "ul";
        return (
          <List key={i}>
            {(block.items ?? []).map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

/** @param {{ account: InstagramAccount, merged: boolean, online: boolean }} props */
function AiPanel({ account, merged, online }) {
  const accountId = account.id;
  const [mode, setMode] = useState(
    /** @type {"summary" | "ask" | "captions" | "ideas"} */ ("summary"),
  );
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      setAnswer(await requestAiInsight(supabase, accountId, mode, question));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Analisis AI gagal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel ai-panel" id="ai" aria-labelledby="ai-title">
      <div className="section-heading">
        <div>
          <p className="section-index">AI</p>
          <h2 id="ai-title">Analisis berbasis data Anda</h2>
        </div>
        <div className="tabs" role="tablist" aria-label="Mode AI">
          {AI_MODES.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={mode === key}
              className={mode === key ? "tab active" : "tab"}
              onClick={() => setMode(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="ai-controls">
        {mode === "ask" ? (
          <input
            type="text"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Contoh: kenapa reach minggu ini turun?"
            aria-label="Pertanyaan"
            maxLength={500}
          />
        ) : null}
        <button
          className="primary"
          onClick={run}
          disabled={!online || busy || (mode === "ask" && !question.trim())}
        >
          {busy ? "Menganalisis…" : "Jalankan"}
        </button>
      </div>
      {error ? (
        <p className="form-message" role="alert">
          {error}
        </p>
      ) : null}
      {answer ? (
        <AiAnswer text={answer} />
      ) : (
        <p className="hint">
          {merged
            ? `AI menganalisis satu akun: @${account.username}. Data gabungan tidak dikirim ke AI.`
            : "AI hanya membaca angka yang tersimpan dari Instagram API. Ia tidak menebak metrik yang tidak tersedia."}
        </p>
      )}
    </section>
  );
}

/** @param {number} v */
const pct = (v) => `${Math.round(v * 100)}%`;
/** @param {{ item: Record<string, any> }} props */
function InteractionSummary({ item }) {
  const s = summarizeMediaInteractions(item);
  if (!s.mixTotal && !s.funnel && !s.retention)
    return (
      <PanelEmpty text="Belum ada metrik interaksi untuk konten ini dari API." />
    );
  return (
    <div className="interaction-summary">
      {s.mixTotal ? (
        <div>
          <div className="stack-bar" aria-hidden="true">
            {s.mix.map((m, i) =>
              m.share ? (
                <span
                  key={m.label}
                  className={`seg seg-${i}`}
                  style={{ width: pct(m.share) }}
                />
              ) : null,
            )}
          </div>
          <ol className="legend">
            {s.mix.map((m, i) => (
              <li key={m.label}>
                <i className={`seg-${i}`} />
                <span>{m.label}</span>
                <strong>
                  {formatMetric(m.value)} · {pct(m.share)}
                </strong>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {s.funnel ? (
        <ol className="audience-list compact">
          <li>
            <div>
              <span>Reach (akun unik)</span>
              <strong>{formatMetric(s.funnel.reach)}</strong>
            </div>
            <span
              className="audience-bar"
              style={
                /** @type {import("react").CSSProperties} */ ({
                  "--bar-width": pct(
                    Math.min(1, s.funnel.reach / s.funnel.views),
                  ),
                })
              }
            />
          </li>
          <li>
            <div>
              <span>Views · {s.funnel.viewsPerReach.toFixed(2)}× per akun</span>
              <strong>{formatMetric(s.funnel.views)}</strong>
            </div>
            <span
              className="audience-bar"
              style={
                /** @type {import("react").CSSProperties} */ ({
                  "--bar-width": "100%",
                })
              }
            />
          </li>
        </ol>
      ) : null}
      {s.retention ? (
        <div>
          <div className="stack-bar" aria-hidden="true">
            <span
              className="seg seg-0"
              style={{ width: pct(s.retention.watched) }}
            />
            <span
              className="seg seg-3"
              style={{ width: pct(s.retention.skipped) }}
            />
          </div>
          <ol className="legend">
            <li>
              <i className="seg-0" />
              <span>Lanjut menonton setelah 3 detik</span>
              <strong>{pct(s.retention.watched)}</strong>
            </li>
            <li>
              <i className="seg-3" />
              <span>Skip di 3 detik pertama</span>
              <strong>{pct(s.retention.skipped)}</strong>
            </li>
          </ol>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Per-content page. Only metrics the Graph API exposes for that surface are
 * shown; the rest is stated as unavailable instead of rendered as 0.
 * @param {{ item: Record<string, any> }} props
 */
function ContentDetail({ item }) {
  const isReel = item.media_product_type === "REELS";
  /** @param {unknown} num @param {unknown} den */
  const rate = (num, den) =>
    typeof num === "number" && typeof den === "number" && den > 0
      ? `${((num / den) * 100).toFixed(1)}%`
      : "—";
  /** @param {unknown} ms */
  const seconds = (ms) =>
    typeof ms === "number" ? `${(ms / 1000).toFixed(1)} dtk` : "—";
  /** @type {Array<[string, string, string?]>} */
  const rows = [
    ["Reach", formatMetric(item.reach), "akun unik yang melihat"],
    ["Views", formatMetric(item.views), "total pemutaran/tayang"],
    ["Likes", formatMetric(item.likes)],
    ["Komentar", formatMetric(item.comments)],
    ["Disimpan", formatMetric(item.saved)],
    ["Dibagikan", formatMetric(item.shares)],
    ["Total interaksi", formatMetric(item.total_interactions)],
    [
      "Engagement / reach",
      rate(item.total_interactions, item.reach),
      "interaksi dibagi reach",
    ],
    ["Simpan / reach", rate(item.saved, item.reach)],
  ];
  const watch = isReel
    ? [
        [
          "Rata-rata ditonton",
          seconds(item.avg_watch_time_ms),
          "per pemutaran",
        ],
        ["Total waktu tonton", seconds(item.total_watch_time_ms)],
        [
          "Skip 3 detik pertama",
          typeof item.skip_rate === "number"
            ? `${(item.skip_rate * 100).toFixed(1)}%`
            : "—",
          "persentase penonton yang skip",
        ],
      ]
    : [
        ["Kunjungan profil", formatMetric(item.profile_visits)],
        ["Follow dari konten ini", formatMetric(item.follows)],
      ];
  return (
    <section className="dashboard-grid lower-grid" id="content-detail">
      <article className="panel content-detail">
        <a className="text-button back-link" href="#content">
          ← Semua konten
        </a>
        <div className="content-hero">
          {item.thumbnail_url ? (
            <img src={item.thumbnail_url} alt="" width="160" height="160" />
          ) : (
            <span className="media-thumb-empty" />
          )}
          <div>
            <p className="section-index">
              {item.media_product_type ?? item.media_type} ·{" "}
              {formatDate(item.published_at)}
            </p>
            <p className="content-caption">
              {item.caption?.trim() || "(tanpa caption)"}
            </p>
            {item.permalink ? (
              <a
                className="text-button"
                href={item.permalink}
                target="_blank"
                rel="noreferrer"
              >
                Buka di Instagram ↗
              </a>
            ) : null}
          </div>
        </div>
        <h3>Ringkasan interaksi</h3>
        <InteractionSummary item={item} />
        <h3>Performa</h3>
        <dl className="stat-grid">
          {rows.map(([label, value, note]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
              {note ? <small>{note}</small> : null}
            </div>
          ))}
        </dl>
        <h3>{isReel ? "Waktu tonton" : "Dampak ke profil"}</h3>
        <dl className="stat-grid">
          {watch.map(([label, value, note]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
              {note ? <small>{note}</small> : null}
            </div>
          ))}
        </dl>
        <p className="hint">
          {isReel
            ? "Waktu tonton dan skip rate hanya tersedia untuk Reels."
            : "Kunjungan profil dan follow hanya tersedia untuk post feed."}{" "}
          Audiens per konten (usia/kota/gender) tidak disediakan API resmi
          Instagram; lihat halaman Audiens untuk demografi akun.
          {item.insights_synced_at
            ? ` Diperbarui ${formatDate(item.insights_synced_at)}.`
            : " Metrik lengkap terisi setelah sinkronisasi berikutnya."}
        </p>
      </article>
    </section>
  );
}

/** @param {{ text: string }} props */
function PanelEmpty({ text }) {
  return <p className="panel-empty">{text}</p>;
}
