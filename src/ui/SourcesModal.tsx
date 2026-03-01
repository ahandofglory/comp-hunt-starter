import React, { useEffect, useMemo, useRef, useState } from "react";
import { Clipboard, Download, Upload, X, Plus, Trash2 } from "lucide-react";
import {
  UserSourcesV1,
  loadUserSources,
  saveUserSources,
  addRssSource,
  addSiteSource,
  removeRss,
  removeSite,
  toggleRss,
  toggleSite,
  exportUserSourcesJson,
  parseUserSourcesJson,
} from "../lib/userSources";

type Props = {
  open: boolean;
  onClose: () => void;
};

function cn(...a: (string | false | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(a.href);
  a.remove();
}

export function SourcesModal({ open, onClose }: Props) {
  const [state, setState] = useState<UserSourcesV1>(() => loadUserSources());
  const [rssUrl, setRssUrl] = useState("");
  const [siteIndex, setSiteIndex] = useState("");
  const [siteLabel, setSiteLabel] = useState("");
  const [importText, setImportText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setState(loadUserSources());
    setError(null);
    setImportText("");
    // Close on escape
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    saveUserSources(state);
  }, [open, state]);

  const counts = useMemo(
    () => ({ rss: state.rss.length, sites: state.sites.length }),
    [state.rss.length, state.sites.length]
  );

  if (!open) return null;

  function addRss() {
    setError(null);
    const next = addRssSource(state, rssUrl);
    if (next === state) {
      setError("Please enter a valid RSS URL (http or https). It must be new.");
      return;
    }
    setState(next);
    setRssUrl("");
  }

  function addSite() {
    setError(null);
    const next = addSiteSource(state, siteIndex, siteLabel);
    if (next === state) {
      setError("Please enter a valid site index URL (http or https). It must be new.");
      return;
    }
    setState(next);
    setSiteIndex("");
    setSiteLabel("");
  }

  function doExport() {
    const json = exportUserSourcesJson(state);
    const date = new Date().toISOString().slice(0, 10);
    downloadText(`parlay-sources-${date}.json`, json);
  }

  async function copyExport() {
    try {
      await navigator.clipboard.writeText(exportUserSourcesJson(state));
    } catch {
      // ignore
    }
  }

  function doImport() {
    setError(null);
    try {
      const parsed = parseUserSourcesJson(importText);
      setState(parsed);
      setImportText("");
    } catch {
      setError("Could not import. Check the JSON is a sources export.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Manage sources"
      onMouseDown={(e) => {
        if (!(e.target instanceof Node)) return;
        if (dialogRef.current && !dialogRef.current.contains(e.target)) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/30" />

      <div
        ref={dialogRef}
        className="relative w-[min(720px,calc(100vw-32px))] max-h-[calc(100vh-32px)] overflow-auto rounded-2xl border border-gray-200 bg-white shadow-xl"
      >
        <div className="px-5 py-4 border-b flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Manage sources</h2>
            <div className="mt-1 text-sm text-gray-500">
              Stored in this browser. RSS: {counts.rss}, Sites: {counts.sites}
            </div>
          </div>

          <button
            className="p-2 rounded-lg hover:bg-gray-100"
            onClick={onClose}
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-6">
          {error && <div className="text-sm text-red-600">{error}</div>}

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">RSS feeds</h3>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                className="flex-1 px-3 py-2 rounded-lg border border-gray-300 bg-white outline-none focus:ring-2"
                placeholder="https://example.com/feed.xml"
                value={rssUrl}
                onChange={(e) => setRssUrl(e.target.value)}
              />
              <button
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-100"
                onClick={addRss}
              >
                <Plus className="h-4 w-4" />
                Add RSS
              </button>
            </div>

            {state.rss.length === 0 ? (
              <div className="text-sm text-gray-500">No RSS feeds added yet.</div>
            ) : (
              <div className="space-y-2">
                {state.rss.map((r) => (
                  <div
                    key={r.url}
                    className="flex items-start justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3"
                  >
                    <label className="flex items-start gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={() => setState((s) => toggleRss(s, r.url))}
                        className="mt-1"
                      />
                      <div className="min-w-0">
                        <div
                          className={cn(
                            "text-sm break-all",
                            !r.enabled && "text-gray-400 line-through"
                          )}
                        >
                          {r.url}
                        </div>
                        <div className="text-xs text-gray-500">Added {r.addedAt.slice(0, 10)}</div>
                      </div>
                    </label>

                    <button
                      className="p-2 rounded-lg hover:bg-gray-50"
                      onClick={() => setState((s) => removeRss(s, r.url))}
                      title="Remove"
                    >
                      <Trash2 className="h-4 w-4 text-gray-700" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Site indexes</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                className="sm:col-span-2 px-3 py-2 rounded-lg border border-gray-300 bg-white outline-none focus:ring-2"
                placeholder="https://example.com/competitions"
                value={siteIndex}
                onChange={(e) => setSiteIndex(e.target.value)}
              />
              <input
                className="px-3 py-2 rounded-lg border border-gray-300 bg-white outline-none focus:ring-2"
                placeholder="Label (optional)"
                value={siteLabel}
                onChange={(e) => setSiteLabel(e.target.value)}
              />
              <div className="sm:col-span-3">
                <button
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-100"
                  onClick={addSite}
                >
                  <Plus className="h-4 w-4" />
                  Add site
                </button>
              </div>
            </div>

            {state.sites.length === 0 ? (
              <div className="text-sm text-gray-500">No sites added yet.</div>
            ) : (
              <div className="space-y-2">
                {state.sites.map((s) => (
                  <div
                    key={s.index}
                    className="flex items-start justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3"
                  >
                    <label className="flex items-start gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={s.enabled}
                        onChange={() => setState((st) => toggleSite(st, s.index))}
                        className="mt-1"
                      />
                      <div className="min-w-0">
                        <div className={cn("text-sm break-all", !s.enabled && "text-gray-400 line-through")}>
                          {s.index}
                        </div>
                        <div className="text-xs text-gray-500">
                          {s.source ? `Label: ${s.source} • ` : ""}Added {s.addedAt.slice(0, 10)}
                        </div>
                      </div>
                    </label>

                    <button
                      className="p-2 rounded-lg hover:bg-gray-50"
                      onClick={() => setState((st) => removeSite(st, s.index))}
                      title="Remove"
                    >
                      <Trash2 className="h-4 w-4 text-gray-700" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="font-semibold">Export and import</h3>

            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-100"
                onClick={doExport}
              >
                <Download className="h-4 w-4" />
                Download JSON
              </button>

              <button
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-100"
                onClick={copyExport}
              >
                <Clipboard className="h-4 w-4" />
                Copy JSON
              </button>
            </div>

            <div className="space-y-2">
              <textarea
                className="w-full min-h-[140px] px-3 py-2 rounded-lg border border-gray-300 bg-white outline-none focus:ring-2 font-mono text-xs"
                placeholder="Paste a sources JSON export here to replace your current browser sources."
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <button
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-100"
                onClick={doImport}
                disabled={!importText.trim()}
              >
                <Upload className="h-4 w-4" />
                Import (replace)
              </button>
            </div>

            <div className="text-xs text-gray-500">
              This does not update the repo sources yet. It only stores your own list in this browser.
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
