import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TrendingUp, AlertTriangle, Play } from "lucide-react";

export type AutoInsightItem = {
  question: string;
  sql: string;
  summary: string;
  result_preview: Record<string, any>[];
};

export type AutoInsightsResponse = {
  dataset_id: string;
  items: AutoInsightItem[];
  suggested_questions?: string[];
};

type CachePayload = {
  items: AutoInsightItem[];
  suggested_questions: string[];
};

const API_BASE = "https://fingenie-backend.vercel.app";
const makeCacheKey = (datasetId: string, schemaSheet: string, k: number) =>
  `auto_insights::${datasetId}::${schemaSheet || "<none>"}::${k}`;

function loadFromCache(key: string): CachePayload | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { items: parsed, suggested_questions: [] };
    if (parsed && typeof parsed === "object") {
      return {
        items: Array.isArray(parsed.items) ? parsed.items : [],
        suggested_questions: Array.isArray(parsed.suggested_questions) ? parsed.suggested_questions : [],
      };
    }
  } catch {}
  return null;
}

function saveToCache(key: string, payload: CachePayload) {
  try {
    sessionStorage.setItem(key, JSON.stringify(payload));
  } catch {}
}

const clampInt = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const coerceK = (input: string, fallback: number) => {
  const n = parseInt(input, 10);
  if (!Number.isFinite(n)) return fallback;
  return clampInt(n, 1, 20);
};

const Insights = () => {
  const [schemaSheet, setSchemaSheet] = useState<string>(() => localStorage.getItem("schema_sheet") || "");
  const [k, setK] = useState<number>(() => {
    const raw = localStorage.getItem("auto_k");
    const n = raw ? parseInt(raw, 10) : 5;
    return Number.isFinite(n) && n > 0 ? n : 5;
  });
  // ► Separate input buffer so typing doesn't snap to 1
  const [kInput, setKInput] = useState<string>(String(k));

  const [question, setQuestion] = useState<string>("");
  const [items, setItems] = useState<AutoInsightItem[]>([]);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  const navigate = useNavigate();

  const datasetId = useMemo(() => {
    const ds = localStorage.getItem("dataset_id") || "";
    const legacy = localStorage.getItem("db_path") || "";
    return ds || legacy;
  }, []);

  const cacheKey = useMemo(() => makeCacheKey(datasetId, schemaSheet.trim(), k), [datasetId, schemaSheet, k]);

  const isSkipped = (x: AutoInsightItem) => x.summary?.startsWith("(skipped)");

  // Fetch helper: optionally accept a k override so Refresh uses the typed value
  const fetchInsights = async (kOverride?: number) => {
    if (!datasetId) {
      setErr("No dataset selected. Please upload/select a dataset first.");
      return;
    }

    const effectiveK = typeof kOverride === "number" ? kOverride : k;

    setLoading(true);
    setErr(null);

    try {
      localStorage.setItem("schema_sheet", schemaSheet);
      localStorage.setItem("auto_k", String(effectiveK));

      const resp = await fetch(`${API_BASE}/v1/insights/auto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_id: datasetId,
          k: effectiveK,
          schema_sheet: schemaSheet?.trim() || undefined,
        }),
      });

      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || `Request failed with ${resp.status}`);
      }

      const data: AutoInsightsResponse = await resp.json();
      const newItems = Array.isArray(data?.items) ? data.items : [];
      const newSuggested = Array.isArray(data?.suggested_questions) ? data.suggested_questions : [];

      setItems(newItems);
      setSuggested(newSuggested);

      // Update stateful k when we intentionally refreshed with a new number
      if (typeof kOverride === "number") {
        setK(effectiveK);
      }

      // Cache under the *new* cache key
      const newKey = makeCacheKey(datasetId, schemaSheet.trim(), effectiveK);
      saveToCache(newKey, { items: newItems, suggested_questions: newSuggested });
    } catch (e: any) {
      console.error("Failed to fetch auto insights", e);
      setErr(e?.message ?? "Failed to fetch auto insights");
    } finally {
      setLoading(false);
    }
  };

  // ► FIRST LOAD ONLY (or when dataset changes): try cache; if none, auto-fetch once.
  useEffect(() => {
    if (!datasetId) return;

    const cached = loadFromCache(cacheKey);
    if (cached) {
      setItems(cached.items || []);
      setSuggested(cached.suggested_questions || []);
      setErr(null);
      setLoading(false);
    } else {
      // Auto-generate only on first visit/no cache
      fetchInsights();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId]); // ← NOT watching schema/k here to avoid auto-regeneration later

  // ► If user changes schema/k, show cached (if any) but DO NOT auto-fetch
  useEffect(() => {
    if (!datasetId) return;
    const cached = loadFromCache(cacheKey);
    if (cached) {
      setItems(cached.items || []);
      setSuggested(cached.suggested_questions || []);
      setErr(null);
      setLoading(false);
    }
  }, [cacheKey, datasetId]);

  // Ask-in-chat
  const handleRunInChat = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;

    const params = new URLSearchParams();
    params.set("ask", trimmed);
    if (schemaSheet?.trim()) params.set("schema_sheet", schemaSheet.trim());

    navigate(`/chat?${params.toString()}`, {
      state: { question: trimmed, schema_sheet: schemaSheet?.trim() || undefined },
    });
  };

  // Normalize k on blur, but don't fetch automatically
  const handleKBlur = () => {
    const next = coerceK(kInput, k);
    setK(next);
    setKInput(String(next));
  };

  // Refresh uses whatever is typed in the input (clamped 1–20)
  const handleRefresh = () => {
    const next = coerceK(kInput, k);
    setK(next);
    fetchInsights(next);
  };

  return (
    <div className="flex-1 p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground mb-1">Auto Insights</h1>
            <p className="text-sm text-muted-foreground">
              Generate LLM-guided questions, SQL, and previews. You can also ask your own question using the schema sheet.
            </p>
          </div>

          {/* Controls */}
          <div className="flex items-end gap-3">
            <div className="grid gap-1">
              <Label htmlFor="schemaSheet" className="text-xs text-muted-foreground">
                Schema sheet (optional)
              </Label>
              <Input
                id="schemaSheet"
                placeholder="e.g., Dictionary or Schema"
                value={schemaSheet}
                onChange={(e) => setSchemaSheet(e.target.value)} // no auto-fetch
                className="w-64"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="k" className="text-xs text-muted-foreground">
                # of insights
              </Label>
              <Input
                id="k"
                type="number"
                min={1}
                max={20}
                // Use input buffer so editing doesn't bounce to 1
                value={kInput}
                onChange={(e) => setKInput(e.target.value)}
                onBlur={handleKBlur}
                className="w-28"
              />
            </div>
            <Button onClick={handleRefresh} disabled={loading}>
              Refresh
            </Button>
          </div>
        </div>

      {/* Status */}
        {loading && (
          <Card className="p-6 flex items-center gap-3">
            {/* Spinner */}
            <svg
              className="animate-spin h-5 w-5 text-emerald-600"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              ></path>
            </svg>

            {/* Message */}
            <p className="text-sm text-muted-foreground">
              Please wait, we are generating auto-insights...
            </p>
          </Card>
        )}

        {err && (
          <Card className="p-6">
            <p className="text-sm text-red-600">Error: {err}</p>
          </Card>
        )}

        {/* Insights */}
        {!err && (
          <>
            {items.length === 0 && !loading ? (
              <Card className="p-6">
                <p className="text-sm text-muted-foreground">No insights yet.</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {items.map((ins, idx) => {
                  const error = isSkipped(ins);
                  const Icon = error ? AlertTriangle : TrendingUp;
                  const iconBg = error ? "bg-red-500" : "bg-primary";

                  return (
                    <Card key={idx} className="p-6 hover:shadow-md transition-shadow">
                      <div className="flex items-start gap-4">
                        <div className={`p-3 rounded-lg ${iconBg} text-white`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-semibold text-foreground leading-snug">{ins.question}</h3>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleRunInChat(ins.question)}
                              title={schemaSheet ? `Will include schema sheet: ${schemaSheet}` : undefined}
                            >
                              <Play className="w-4 h-4 mr-1" /> Ask in Chat
                            </Button>
                          </div>

                          {ins.summary && (
                            <p className={`text-sm ${error ? "text-red-600" : "text-muted-foreground"}`}>{ins.summary}</p>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Suggested Questions from backend */}
            {suggested.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-lg font-semibold text-foreground">Suggested questions</h2>
                <div className="grid grid-cols-1 md:grid-cols-1">
                  {suggested.slice(0, 8).map((q, index) => (
                    <button
                      key={index}
                      onClick={() => handleRunInChat(q)}
                      className="text-left p-3 text-muted-foreground hover:bg-secondary rounded-lg transition-colors"
                      title={schemaSheet ? `Will include schema sheet: ${schemaSheet}` : undefined}
                    >
                      • {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="text-center text-muted-foreground text-sm">
          InsightGuru can make mistakes. Check important info.
        </div>
      </div>
    </div>
  );
};

export default Insights;
