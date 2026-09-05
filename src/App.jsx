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
  pickAccount,
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
/** @typedef {{ accountId: string | null, metrics: Array<Record<string, any>>, media: Array<Record<string, any>>, audience: Array<Record<string, any>> }} AnalyticsState */
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

/** @param {{ user: import("@supabase/supabase-js").User, online: boolean, installPrompt: BeforeInstallPromptEvent | null, updateWorker: ServiceWorker | null }} props */
function Dashboard({ user, online, installPrompt, updateWorker }) {
  const [accounts, setAccounts] = useState(
    /** @type {InstagramAccount[]} */ ([]),
  );
  const [selectedId, setSelectedId] = useState(
    /** @type {string | null} */ (null),
  );
  const [analytics, setAnalytics] = useState(
    /** @type {AnalyticsState} */ (emptyAnalytics),
  );
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  const selected = pickAccount(accounts, selectedId);

  useEffect(() => {
    let active = true;

    async function loadAccounts() {
      if (!online) {
        const snapshot = await loadDashboardSnapshot(caches, user.id);
        if (!active) return;
        if (snapshot) {
          setAccounts(/** @type {InstagramAccount[]} */ (snapshot.accounts));
          setSelectedId(/** @type {string | null} */ (snapshot.selectedId));
          setAnalytics(/** @type {AnalyticsState} */ (snapshot.analytics));
        }
        setLoading(false);
        return;
      }

      try {
        const rows = await listInstagramAccounts(supabase);
        if (!active) return;
        setAccounts(rows);
        setSelectedId((current) => pickAccount(rows, current)?.id ?? null);
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
    if (!selected?.id || !online) return;
    let active = true;
    loadAccountAnalytics(supabase, selected.id)
      .then((data) => {
        if (active) setAnalytics({ accountId: selected.id, ...data });
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
  }, [online, selected?.id]);

  useEffect(() => {
    if (
      !online ||
      !user.id ||
      !selected?.id ||
      analytics.accountId !== selected.id
    )
      return;
    saveDashboardSnapshot(caches, user.id, {
      accounts,
      selectedId: selected.id,
      analytics,
    }).catch(() => undefined);
  }, [accounts, analytics, online, selected?.id, user.id]);

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
      if (selected?.id) {
        const data = await loadAccountAnalytics(supabase, selected.id);
        setAnalytics({ accountId: selected.id, ...data });
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
          <a className="active" href="#overview">
            Ringkasan
          </a>
          <a href="#trend">Pertumbuhan</a>
          <a href="#content">Konten</a>
          <a href="#audience">Audiens</a>
        </nav>
        <div className="sidebar-footer">
          <p>{user.email}</p>
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
        <header className="dashboard-header" id="overview">
          <div>
            <p className="kicker">Ringkasan akun</p>
            <h1>{selected ? `@${selected.username}` : "Dashboard"}</h1>
            <p className="muted">
              {selected
                ? `Sinkronisasi terakhir ${formatDate(selected.last_synced_at)}`
                : "Hubungkan akun Instagram Professional untuk mulai membaca data."}
            </p>
          </div>
          <div className="header-actions">
            {accounts.length > 0 ? (
              <>
                <label className="account-picker">
                  <span>Akun Instagram</span>
                  <select
                    value={selected?.id ?? ""}
                    onChange={(event) => setSelectedId(event.target.value)}
                  >
                    {accounts.map((account) => (
                      <option value={account.id} key={account.id}>
                        @{account.username}
                      </option>
                    ))}
                  </select>
                </label>
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

        {loading || (selected && analytics.accountId !== selected.id) ? (
          <DashboardSkeleton />
        ) : selected ? (
          <AnalyticsDashboard account={selected} analytics={analytics} />
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
function AnalyticsDashboard({ account, analytics }) {
  const summary = buildMetricSummary(analytics.metrics);
  const points = buildTrendPoints(analytics.metrics, 640, 220);
  const metrics = [
    [
      "Followers",
      formatMetric(summary.followers),
      summary.followerGrowth === null
        ? null
        : `${summary.followerGrowth >= 0 ? "+" : ""}${numberFormat.format(summary.followerGrowth)} periode ini`,
    ],
    ["Reach", formatMetric(summary.reach), "Snapshot terbaru"],
    ["Interaksi", formatMetric(summary.interactions), "Snapshot terbaru"],
    [
      "Akun terlibat",
      formatMetric(summary.accountsEngaged),
      "Snapshot terbaru",
    ],
  ];
  const audience = analytics.audience.slice(0, 8);
  const audienceMax = Math.max(
    ...audience.map((row) => Number(row.value) || 0),
    1,
  );

  return (
    <>
      <section className="metrics" aria-label="Metrik utama">
        {metrics.map(([label, value, note]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{note ?? "Perlu lebih banyak data"}</small>
          </article>
        ))}
      </section>

      <section className="dashboard-grid" id="trend">
        <article className="panel trend-panel">
          <div className="section-heading">
            <div>
              <p className="section-index">90 hari terakhir</p>
              <h2>Pertumbuhan followers</h2>
            </div>
            <span className={`status ${account.status}`}>
              {account.status.replace("_", " ")}
            </span>
          </div>
          {points ? (
            <div className="chart-wrap">
              <svg
                className="trend-chart"
                viewBox="0 0 640 220"
                role="img"
                aria-label={`Grafik followers @${account.username}`}
              >
                <line x1="0" y1="219" x2="640" y2="219" />
                <polyline points={points} />
              </svg>
              <details>
                <summary>Lihat data tabel</summary>
                <table>
                  <thead>
                    <tr>
                      <th>Tanggal</th>
                      <th>Followers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.metrics.map((row) => (
                      <tr key={row.metric_date}>
                        <td>{formatDate(row.metric_date)}</td>
                        <td>{formatMetric(row.followers_count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
          ) : (
            <PanelEmpty text="Grafik muncul setelah minimal dua sinkronisasi." />
          )}
        </article>

        <article className="panel account-panel">
          <p className="section-index">Akun aktif</p>
          <div className="profile-row">
            {account.profile_picture_url ? (
              <img src={account.profile_picture_url} alt="" />
            ) : (
              <span className="avatar" aria-hidden="true">
                {account.username.slice(0, 2).toUpperCase()}
              </span>
            )}
            <div>
              <h2>@{account.username}</h2>
              <p>{account.name || account.account_type}</p>
            </div>
          </div>
          <dl>
            <div>
              <dt>Jenis akun</dt>
              <dd>{account.account_type.replace("MEDIA_", "")}</dd>
            </div>
            <div>
              <dt>Sinkronisasi</dt>
              <dd>{formatDate(account.last_synced_at)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{account.status.replace("_", " ")}</dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="dashboard-grid lower-grid">
        <article className="panel content-panel" id="content">
          <div className="section-heading">
            <div>
              <p className="section-index">Konten</p>
              <h2>Performa terbaru</h2>
            </div>
          </div>
          {analytics.media.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Konten</th>
                    <th>Reach</th>
                    <th>Interaksi</th>
                    <th>Disimpan</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.media.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <a
                          href={item.permalink || undefined}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {item.caption?.trim() || item.media_type}
                        </a>
                        <small>{formatDate(item.published_at)}</small>
                      </td>
                      <td>{formatMetric(item.reach)}</td>
                      <td>{formatMetric(item.total_interactions)}</td>
                      <td>{formatMetric(item.saved)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <PanelEmpty text="Konten akan muncul setelah sinkronisasi pertama." />
          )}
        </article>

        <article className="panel audience-panel" id="audience">
          <div className="section-heading">
            <div>
              <p className="section-index">Audiens</p>
              <h2>Demografi utama</h2>
            </div>
          </div>
          {audience.length ? (
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
          ) : (
            <PanelEmpty text="Demografi tersedia setelah Instagram mengembalikan data agregat." />
          )}
        </article>
      </section>
    </>
  );
}

/** @param {{ text: string }} props */
function PanelEmpty({ text }) {
  return <p className="panel-empty">{text}</p>;
}
