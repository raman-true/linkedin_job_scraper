import { useState, FormEvent, ChangeEvent } from "react";

type ScrapeResult = {
  status: string;
  total_jobs: number;
  file: string;
};

function App() {
  const [searchUrl, setSearchUrl] = useState<string>(
    "https://www.linkedin.com/jobs/search/?keywords=freelance&location=France&geoId=105015875&f_WT=2&refresh=true"
  );
  const [maxPages, setMaxPages] = useState<number>(2);
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [error, setError] = useState<string>("");

  const [logs, setLogs] = useState<string[]>([]);
  const [pollId, setPollId] = useState<number | null>(null);

  // Cookies
  const [cookieText, setCookieText] = useState<string>("");
  const [cookieFileName, setCookieFileName] = useState<string>("");

  const handleCookieFileChange = async (
    e: ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCookieText(text);
    setCookieFileName(file.name);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    setLogs([]);

    // Clear previous polling if any
    if (pollId !== null) {
      window.clearInterval(pollId);
      setPollId(null);
    }

    try {
      // 1) Start scraping in background
      const startResp = await fetch("http://127.0.0.1:8000/scrape_start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          search_url: searchUrl,
          max_pages: maxPages,
          cookie_text: cookieText || null, // send cookie text if present
        }),
      });

      if (!startResp.ok) {
        const data = await startResp.json().catch(() => null);
        throw new Error(
          data?.detail || `Start failed with status ${startResp.status}`
        );
      }

      // 2) Poll status
      const id = window.setInterval(async () => {
        try {
          const statusResp = await fetch("http://127.0.0.1:8000/scrape_status");
          if (!statusResp.ok) return;

          const status = await statusResp.json();

          if (Array.isArray(status.logs)) {
            setLogs(status.logs);
          }

          if (status.result) {
            setResult(status.result);
          }

          if (!status.running) {
            setLoading(false);
            window.clearInterval(id);
            setPollId(null);

            if (status.result && status.result.status === "error") {
              setError(status.result.detail || "Scrape failed");
            }
          }
        } catch (err) {
          console.error(err);
        }
      }, 1000);

      setPollId(id);
    } catch (err: any) {
      console.error(err);
      setError(
        err.message || "Something went wrong while starting the scraper."
      );
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const url =
      "http://127.0.0.1:8000/download/" + encodeURIComponent(result.file);
    window.open(url, "_blank");
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        background:
          "radial-gradient(circle at top, #1f2937 0, #020617 45%, #000 100%)",
        color: "#e5e7eb",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "900px",
          margin: "24px auto",
          padding: "24px 20px 26px",
          borderRadius: "20px",
          background:
            "linear-gradient(135deg, rgba(15,23,42,0.96), rgba(15,23,42,0.98))",
          border: "1px solid rgba(148,163,184,0.35)",
          boxShadow: "0 30px 80px rgba(15,23,42,0.9)",
        }}
      >
        {/* Header */}
        <div
          style={{
            marginBottom: "22px",
            display: "flex",
            justifyContent: "space-between",
            gap: "16px",
            alignItems: "flex-start",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "11px",
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "#64748b",
                marginBottom: "6px",
              }}
            >
              Hello Intelligence // Utility
            </div>
            <h1
              style={{
                fontSize: "26px",
                fontWeight: 800,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "#e5e7eb",
                marginBottom: "4px",
              }}
            >
              LinkedIn Job Scraper
            </h1>
            <p
              style={{
                fontSize: "13px",
                color: "#9ca3af",
                maxWidth: "520px",
              }}
            >
              Paste any LinkedIn job search URL, choose how many pages to scan,
              and launch a headless scrape via your local API.
            </p>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: "6px",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                padding: "6px 12px",
                borderRadius: "999px",
                border: "1px solid rgba(52,211,153,0.4)",
                background:
                  "radial-gradient(circle at top left, rgba(16,185,129,0.25), rgba(15,23,42,0.95))",
                color: "#bbf7d0",
                fontWeight: 500,
              }}
            >
              API · <span style={{ color: "#22c55e" }}>ONLINE</span>
            </div>
            <div
              style={{
                fontSize: "11px",
                color: "#6b7280",
              }}
            >
              Backend: <span style={{ color: "#e5e7eb" }}>127.0.0.1:8000</span>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: "16px" }}>
          {/* URL */}
          <div>
            <label
              htmlFor="searchUrl"
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: 500,
                marginBottom: "6px",
                color: "#cbd5f5",
              }}
            >
              LinkedIn Search URL
            </label>
            <textarea
              id="searchUrl"
              value={searchUrl}
              onChange={(e) => setSearchUrl(e.target.value)}
              rows={3}
              placeholder="Paste full LinkedIn jobs search URL here..."
              style={{
                width: "100%",
                background: "rgba(15,23,42,0.95)",
                borderRadius: "12px",
                border: "1px solid rgba(148,163,184,0.4)",
                padding: "10px 12px",
                fontSize: "13px",
                color: "#e5e7eb",
                resize: "vertical",
                outline: "none",
              }}
            />
          </div>

          {/* Cookies */}
          <div
            style={{
              display: "grid",
              gap: "8px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "8px",
                alignItems: "center",
              }}
            >
              <label
                htmlFor="cookieText"
                style={{
                  display: "block",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "#cbd5f5",
                }}
              >
                LinkedIn Cookies (optional)
              </label>
              <span
                style={{
                  fontSize: "11px",
                  color: "#9ca3af",
                }}
              >
                If empty, server uses <code>LINKEDIN_COOKIES.txt</code>
              </span>
            </div>

            <textarea
              id="cookieText"
              value={cookieText}
              onChange={(e) => setCookieText(e.target.value)}
              rows={5}
              placeholder="# Netscape HTTP Cookie File&#10;.linkedin.com   TRUE   /   TRUE   ..."
              style={{
                width: "100%",
                background: "rgba(15,23,42,0.95)",
                borderRadius: "10px",
                border: "1px solid rgba(148,163,184,0.4)",
                padding: "8px 10px",
                fontSize: "11px",
                color: "#e5e7eb",
                resize: "vertical",
                outline: "none",
                fontFamily: "monospace",
              }}
            />

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                flexWrap: "wrap",
              }}
            >
              <label
                style={{
                  fontSize: "12px",
                  padding: "4px 10px",
                  borderRadius: "999px",
                  border: "1px solid rgba(148,163,184,0.5)",
                  background: "rgba(15,23,42,0.9)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="file"
                  accept=".txt"
                  onChange={handleCookieFileChange}
                  style={{ display: "none" }}
                />
                Upload cookie TXT
              </label>
              {cookieFileName && (
                <span
                  style={{
                    fontSize: "11px",
                    color: "#9ca3af",
                  }}
                >
                  Loaded: {cookieFileName}
                </span>
              )}
            </div>
          </div>

          {/* Max pages + button */}
          <div
            style={{
              display: "flex",
              gap: "14px",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <div style={{ width: "110px" }}>
              <label
                htmlFor="maxPages"
                style={{
                  display: "block",
                  fontSize: "13px",
                  fontWeight: 500,
                  marginBottom: "6px",
                  color: "#cbd5f5",
                }}
              >
                Max pages
              </label>
              <input
                id="maxPages"
                type="number"
                min={1}
                max={50}
                value={maxPages}
                onChange={(e) => setMaxPages(Number(e.target.value))}
                style={{
                  width: "100%",
                  background: "rgba(15,23,42,0.95)",
                  borderRadius: "999px",
                  border: "1px solid rgba(148,163,184,0.5)",
                  padding: "7px 10px",
                  fontSize: "13px",
                  color: "#e5e7eb",
                  outline: "none",
                  textAlign: "center",
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                flex: "1 1 auto",
                marginTop: "20px",
                padding: "11px 18px",
                borderRadius: "999px",
                border: "none",
                cursor: loading ? "default" : "pointer",
                fontSize: "14px",
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                background:
                  "linear-gradient(135deg, #4f46e5, #6366f1, #22c55e)",
                color: "#f9fafb",
                opacity: loading ? 0.7 : 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                boxShadow: "0 16px 40px rgba(79,70,229,0.55)",
                transition: "transform 0.12s ease, box-shadow 0.12s ease",
              }}
            >
              {loading ? (
                <>
                  <span
                    style={{
                      width: "14px",
                      height: "14px",
                      borderRadius: "999px",
                      border: "2px solid rgba(248,250,252,0.25)",
                      borderTopColor: "#f9fafb",
                      animation: "spin 0.7s linear infinite",
                    }}
                  />
                  RUNNING SCRAPER…
                </>
              ) : (
                <>RUN SCRAPER</>
              )}
            </button>
          </div>
        </form>

        {/* Error */}
        {error && (
          <div
            style={{
              marginTop: "18px",
              padding: "10px 12px",
              borderRadius: "10px",
              border: "1px solid rgba(239,68,68,0.5)",
              background: "rgba(127,29,29,0.35)",
              fontSize: "12px",
              color: "#fecaca",
            }}
          >
            <strong style={{ fontWeight: 600 }}>Error:</strong> {error}
          </div>
        )}

        {/* Live logs / progress */}
        {logs.length > 0 && (
          <div
            style={{
              marginTop: "18px",
              padding: "10px 12px",
              borderRadius: "10px",
              border: "1px solid rgba(148,163,184,0.45)",
              background: "rgba(15,23,42,0.95)",
              fontSize: "12px",
              maxHeight: "200px",
              overflowY: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "#9ca3af",
                marginBottom: "6px",
              }}
            >
              Live progress
            </div>
            {logs.map((line, idx) => (
              <div key={idx}>{line}</div>
            ))}
          </div>
        )}

        {/* Result */}
        {result && result.status !== "error" && (
          <div
            style={{
              marginTop: "20px",
              padding: "14px 16px",
              borderRadius: "14px",
              border: "1px solid rgba(34,197,94,0.45)",
              background:
                "radial-gradient(circle at top left, rgba(34,197,94,0.24), rgba(15,23,42,0.98))",
              fontSize: "13px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "10px",
                marginBottom: "8px",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#bbf7d0",
                  }}
                >
                  Scrape Completed
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "#d1fae5",
                  }}
                >
                  Headless session finished successfully.
                </div>
              </div>
              <span
                style={{
                  fontSize: "11px",
                  padding: "4px 8px",
                  borderRadius: "999px",
                  background: "rgba(22,163,74,0.9)",
                  color: "#ecfdf5",
                }}
              >
                STATUS: {result.status?.toUpperCase() || "OK"}
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)",
                gap: "10px",
                alignItems: "center",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "11px",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "#9ca3af",
                    marginBottom: "2px",
                  }}
                >
                  Total Jobs
                </div>
                <div style={{ fontSize: "18px", fontWeight: 700 }}>
                  {result.total_jobs}
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: "11px",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "#9ca3af",
                    marginBottom: "2px",
                  }}
                >
                  CSV File
                </div>
                <div
                  style={{
                    fontSize: "12px",
                    color: "#e5e7eb",
                    wordBreak: "break-all",
                  }}
                >
                  {result.file}
                </div>
                <div
                  style={{
                    marginTop: "6px",
                    display: "flex",
                    gap: "8px",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    type="button"
                    onClick={handleDownload}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "999px",
                      border: "none",
                      fontSize: "12px",
                      fontWeight: 500,
                      cursor: "pointer",
                      background:
                        "linear-gradient(135deg, #22c55e, #16a34a)",
                      color: "#ecfdf5",
                      boxShadow: "0 8px 20px rgba(22,163,74,0.55)",
                    }}
                  >
                    Download CSV
                  </button>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "#a7f3d0",
                    }}
                  >
                    Saved next to the API script on the server.
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* spinner keyframes */}
        <style>
          {`
            @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
          `}
        </style>
      </div>
    </div>
  );
}

export default App;
