import React, { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Bot, User, ChevronDown, ChevronRight, Send, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Plotly from "plotly.js-dist-min";
import { Textarea } from "@/components/ui/textarea";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

const Plot = lazy(() => import("react-plotly.js"));

interface Message {
  id: string;
  sender: "user" | "bot";
  timestamp: string;
  content: string;          // summary or user text
  sqlQuery?: string;        // for bot
  preview?: any[];          // rows
  columns?: string[];
  chartPlotly?: any | null; // plotly fig json
  collapsed?: boolean;
}

type QAResponse = {
  sql?: string;
  result?: { rows?: any; columns?: string[] };
  chart?: any | string | null;
  table_name?: string;
  summary?: string;
  message?: string;
  error?: string;
  session_id?: string | null;
  session_name?: string | null;
};

type GetSessionResponse = {
  session?: { name?: string };
  messages?: Array<{ role: "user" | "assistant"; content: string; ts?: string; sql?: string }>;
  error?: string;
  message?: string;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || "https://fingenie-backend.vercel.app";
const QA_ENDPOINT = `${API_BASE}/v1/qa/answer`;

/* ---------------- utils ---------------- */
const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2));

const getDatasetId = () =>
  localStorage.getItem("dataset_id") ||
  localStorage.getItem("datasetId") ||
  localStorage.getItem("db_path") ||
  localStorage.getItem("dbPath") ||
  "";

const formatTs = (ts?: string) => {
  try {
    if (ts) return new Date(ts).toLocaleString();
  } catch {}
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });
};

// simple stable hash for (summary|sql)
const hashKey = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
};

type CachePayload = { rows?: any[]; columns?: string[]; chart?: any | null };

// cache helpers
const cacheSet = (sessionId: string, summary: string, sql?: string, payload?: CachePayload) => {
  if (!sessionId || !summary) return;
  const key = `fg_cache_${sessionId}_${hashKey(`${summary}|${sql || ""}`)}`;
  try {
    localStorage.setItem(key, JSON.stringify(payload || {}));
  } catch {}
};

const cacheGet = (sessionId: string, summary: string, sql?: string): CachePayload | null => {
  if (!sessionId || !summary) return null;
  const key = `fg_cache_${sessionId}_${hashKey(`${summary}|${sql || ""}`)}`;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/* ---------------- component ---------------- */
const Chat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [searchParams] = useSearchParams();
  const [sessionId, setSessionId] = useState<string>(searchParams.get("sid") || "");
  const [sessionName, setSessionName] = useState<string>("");

  const { toast } = useToast();

  const location = useLocation() as any;
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // ⬇️ ADDED: seed from Insights (ask + schema_sheet)
  const asked = params.get("ask") || location?.state?.question || "";
  const schemaSheet = params.get("schema_sheet") || location?.state?.schema_sheet || "";
  const [composerSchemaSheet, setComposerSchemaSheet] = useState<string>("");

  // When we adopt a new session_id from QA response, skip one reload (prevents wiping fresh rows/chart)
  const skipNextReloadRef = useRef(false);

  // Scroll anchors
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // ⬇️ NEW: helper that snaps to the very bottom marker
  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      block: "end",
      inline: "nearest",
    });
  };

  const clientId = useMemo(() => {
    let cid = localStorage.getItem("client_id");
    if (!cid) {
      cid = uid();
      localStorage.setItem("client_id", cid);
    }
    return cid;
  }, []);

  // compact history for backend
  const history = useMemo(
    () =>
      messages.slice(-10).map((m) => ({
        role: m.sender === "user" ? "user" : "assistant",
        content: m.content,
      })),
    [messages]
  );

  // ⬇️ ADDED: apply incoming question + schema into composer once
  useEffect(() => {
    if (asked) setNewMessage(asked);
    if (schemaSheet) setComposerSchemaSheet(schemaSheet);
  }, [asked, schemaSheet]);

  // sync sessionId from URL
  useEffect(() => {
    const sid = searchParams.get("sid") || "";
    if (sid && sid !== sessionId) setSessionId(sid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // load session messages; hydrate rows/chart from cache
  useEffect(() => {
    const loadSession = async () => {
      const dsId = getDatasetId();
      if (!sessionId || !clientId || !dsId) return;

      if (skipNextReloadRef.current) {
        skipNextReloadRef.current = false;
        return;
      }

      try {
        const url = new URL(`${API_BASE}/v1/chats/${encodeURIComponent(sessionId)}`);
        url.searchParams.set("client_id", clientId);
        url.searchParams.set("dataset_id", dsId);
        const res = await fetch(url.toString());
        const data: GetSessionResponse = await res.json();

        if (!res.ok) {
          console.warn("Failed to load session:", data?.error || data?.message);
          return;
        }

        if (data.session?.name) setSessionName(data.session.name);

        const arr = data.messages || [];
        const incoming: Message[] = arr.map((m, idx, all) => {
          const isLastBot =
            m.role === "assistant" &&
            [...all].reverse().find((x) => x.role === "assistant") === m;

          // HYDRATE from cache using (summary/content + sql)
          let hydrated = cacheGet(sessionId, m.content || "", m.sql || undefined);
          const rows = hydrated?.rows;
          const columns = hydrated?.columns;
          const chartPlotly = hydrated?.chart ?? undefined;

          return {
            id: uid(),
            sender: m.role === "user" ? "user" : "bot",
            timestamp: formatTs(m.ts),
            content: m.content || "",
            sqlQuery: m.sql,
            preview: Array.isArray(rows) ? rows : undefined,
            columns: Array.isArray(columns) ? columns : undefined,
            chartPlotly: chartPlotly,
            collapsed: m.role === "assistant" ? !isLastBot : false,
          };
        });

        setMessages(incoming);

        // ⬇️ NEW: ensure we land at the bottom after hydrating a session
        requestAnimationFrame(() => scrollToBottom(false));
      } catch (e) {
        console.warn("Error loading session:", e);
      }
    };

    loadSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, clientId]);

  const askQuestion = async (question: string, datasetId: string): Promise<QAResponse> => {
    let res: Response;
    try {
      res = await fetch(QA_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": clientId,
        },
        body: JSON.stringify({
          client_id: clientId,
          session_id: sessionId || undefined,
          dataset_id: datasetId,
          question,
          history,
          // ⬇️ ADDED: include schema sheet coming from Insights
          schema_sheet: composerSchemaSheet || "",
        }),
      });
    } catch (e: any) {
      throw new Error(`Network error: ${e?.message || e}`);
    }

    const ct = res.headers.get("content-type") || "";
    let data: QAResponse = {};
    if (ct.includes("application/json")) {
      data = await res.json();
    } else {
      const text = await res.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text || "Unknown server response" } as any;
      }
    }

    if (!res.ok) {
      throw new Error(data.error || data.message || `Request failed (status ${res.status})`);
    }

    return data;
  };

  const normalize = (data: QAResponse) => {
    // rows coercion
    let rows: any[] = [];
    const r = data?.result?.rows;
    if (Array.isArray(r)) rows = r;
    else if (r && typeof r === "object") {
      const maybeArray = Object.values(r);
      if (maybeArray.every((x) => typeof x === "object")) rows = maybeArray as any[];
    }

    const columns =
      data?.result?.columns && Array.isArray(data.result.columns) && data.result.columns.length > 0
        ? data.result.columns
        : rows.length
        ? Object.keys(rows[0])
        : [];

    // chart coercion
    let chartPlotly: any | null = null;
    const rawChart = data?.chart;
    if (rawChart) {
      if (typeof rawChart === "string") {
        try {
          chartPlotly = JSON.parse(rawChart);
        } catch {
          chartPlotly = null;
        }
      } else if (typeof rawChart === "object") {
        chartPlotly = rawChart;
      }
    }

    const content =
      (data.summary && data.summary.trim()) ||
      data.message ||
      (rows.length
        ? `Returned ${rows.length} rows × ${columns.length} columns.`
        : "No rows returned for this question.");

    return { sqlQuery: data.sql, rows, columns, chartPlotly, content };
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || isLoading) return;

    const datasetId = getDatasetId();
    if (!datasetId) {
      toast({
        title: "No dataset found",
        description: "Please upload a dataset first.",
        variant: "destructive",
      });
      return;
    }

    const userMessage: Message = {
      id: uid(),
      sender: "user",
      timestamp: formatTs(),
      content: newMessage,
    };

    setMessages((prev) => [...prev, userMessage]);

    // ⬇️ NEW: immediately scroll to the user's question smoothly
    requestAnimationFrame(() => scrollToBottom(true));

    const question = newMessage;
    setNewMessage("");
    setIsLoading(true);

    try {
      const raw = await askQuestion(question, datasetId);

      // if server created session now, adopt it but don't reload/wipe
     if (raw.session_id && raw.session_id !== sessionId) {
        skipNextReloadRef.current = true;
        setSessionId(raw.session_id);

        const params = new URLSearchParams(window.location.search);
        params.set("sid", raw.session_id);
        window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
        window.dispatchEvent(new CustomEvent("fin-genie:sessions-updated"));
      }
       
      if (raw.session_name) setSessionName(raw.session_name || "");

      const { sqlQuery, rows, columns, chartPlotly, content } = normalize(raw);

      // ⚡ persist rows/columns/chart in cache so they survive future reloads
      cacheSet(sessionId || raw.session_id || "", content || "", sqlQuery, {
        rows,
        columns,
        chart: chartPlotly,
      });

      const botMessage: Message = {
        id: uid(),
        sender: "bot",
        timestamp: formatTs(),
        content,
        sqlQuery,
        preview: rows,
        columns,
        chartPlotly,
        collapsed: false,
      };

      // collapse previous bot messages so heavy charts don't stack
      setMessages((prev) =>
        prev.map((m) => (m.sender === "bot" ? { ...m, collapsed: true } : m)).concat(botMessage)
      );
      // The effect below will auto-scroll when messages length changes
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to process your question";
      toast({ title: "Error", description: msg, variant: "destructive" });
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          sender: "bot",
          timestamp: formatTs(),
          content: "I hit an error while processing your question. Please try again.",
          collapsed: false,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleCollapse = (id: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, collapsed: !m.collapsed } : m)));
  };

  // ⬇️ NEW: global auto-scroll when message list changes or loading state flips
  useEffect(() => {
    scrollToBottom(true);
  }, [messages.length, isLoading]);

  const formatValue = (val: any): string => {
    if (val == null || val === "") return "";
    const num = Number(val);
    if (!isNaN(num)) {
      // Format with commas and two decimals, but remove decimals if it's a whole number
      return num % 1 === 0
        ? new Intl.NumberFormat("en-IN", {
            style: "decimal",
            maximumFractionDigits: 0, // No decimals if it's an integer
          }).format(num)
        : new Intl.NumberFormat("en-IN", {
            style: "decimal",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(num); // Two decimals otherwise
    }
    return String(val);
  };

  return (
    <div className="flex-1 flex flex-col p-8">
      {/* Widen the working area so side-by-side has room */}
      <div className="max-w-7xl mx-auto w-full flex-1 flex flex-col space-y-6">
        
        {/* Messages */}
        {/* pb-28 adds space so content doesn't sit under the fixed composer */}
        <div ref={scrollContainerRef} className="flex-1 space-y-6 overflow-y-auto pb-28 scroll-smooth">
          {messages.map((message) => {
            const isUser = message.sender === "user";

            // NEW: compute what's actually available to show
            const hasSql =
              typeof message.sqlQuery === "string" && message.sqlQuery.trim().length > 0;
            const hasRows =
              Array.isArray(message.preview) && message.preview.length > 0;
            const hasChart =
              !!(message.chartPlotly &&
                 Array.isArray(message.chartPlotly.data) &&
                 message.chartPlotly.data.length > 0);
            const hasDetails = hasSql || hasRows || hasChart;

            // Check if Data Preview or Graph should be shown (only when > 1 row and 1 column)
            const shouldShowPreview = hasRows && message.preview!.length > 1 && message.columns!.length > 1;
            const shouldShowChart = hasChart && !(message.preview!.length === 1 && message.columns!.length === 1);

            return (
              <div key={message.id} className={`relative isolate flex items-start space-x-3 ${isUser ? "flex-row-reverse space-x-reverse" : ""}`}>
                <Avatar className="w-8 h-8">
                  <AvatarFallback className={isUser ? "bg-black" : "bg-yellow-400"}>
                    {isUser ? (
                      <User className="w-4 h-4 text-white" />
                    ) : (
                      <Bot className="w-4 h-4 text-black" />
                    )}
                  </AvatarFallback>
                </Avatar>

                <div className={`max-w-3xl md:max-w-none ${isUser ? "text-right" : "w-full"}`}>
                  {/* meta line */}
                  <div className="text-xs text-muted-foreground mb-3">
                    {isUser ? "You" : "InsightGuru"} · {message.timestamp}
                  </div>

                  <Card className={`relative isolate overflow-hidden p-4 ${isUser ? "bg-black text-white border border-black" : "bg-card"}`}>
                    {/* summary / main text */}
                    <p className={isUser ? "text-white" : "text-foreground"}>
                      {message.content}
                    </p>

                    {/* Collapse toggle for bot messages (only if any details exist) */}
                    {!isUser && hasDetails && (
                      <div className="mt-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleCollapse(message.id)}
                          className="px-2"
                        >
                          {message.collapsed ? (
                            <>
                              <ChevronRight className="w-4 h-4 mr-1" /> Show details
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-4 h-4 mr-1" /> Hide details
                            </>
                          )}
                        </Button>
                      </div>
                    )}

                    {/* Details (SQL + Table + Chart) — render ONLY if something exists */}
                    {!isUser && hasDetails && !message.collapsed && (
                      <>
                        {/* Grid: Data Preview × Chart (shape adapts to what exists) */}
                        {(shouldShowPreview || shouldShowChart) && (
                          <div className={`mt-4 grid grid-cols-1 ${shouldShowPreview && shouldShowChart ? "md:grid-cols-2" : ""} gap-4 items-stretch`}>
                            {/* Data Preview */}
                            {shouldShowPreview && (
                              <div className="p-3 bg-secondary rounded-lg h-[420px] md:h-[520px] flex flex-col">
                                <p className="text-sm font-semibold text-foreground mb-2">
                                  Data Preview:
                                </p>
                                <div className="text-xs text-muted-foreground overflow-auto flex-1">
                                  <table className="w-full text-xs">
                                    <thead className="sticky top-0 bg-secondary">
                                      <tr>
                                        {(message.columns ??
                                          (message.preview?.length
                                            ? Object.keys(message.preview[0])
                                            : []))?.map((col) => (
                                          <th key={col} className="text-left p-2 font-medium whitespace-nowrap">
                                            {col}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {message.preview!.slice(0, 200).map((row, i) => (
                                        <tr key={i} className="border-t">
                                          {(message.columns ?? Object.keys(row)).map((col) => (
                                            <td key={col} className="p-2 align-top whitespace-pre-wrap">
                                              {formatValue(row?.[col])}
                                            </td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}

                            {/* Plotly Chart */}
                            {shouldShowChart && (
                              <div className="relative w-full h-[420px] md:h-[520px] p-3 bg-secondary rounded-lg">
                                <p className="text-sm font-semibold text-foreground mb-2">Chart:</p>
                                <div className="absolute inset-x-3 bottom-3 top-12">
                                  <Suspense fallback={<div className="text-muted-foreground text-sm">Loading chart…</div>}>
                                    <Plot
                                      key={`${message.id}-plot`}
                                      data={message.chartPlotly!.data}
                                      layout={{
                                        ...(message.chartPlotly!.layout || {}),
                                        autosize: true,
                                        margin: {
                                          ...(message.chartPlotly!.layout?.margin || {}),
                                          t: Math.max(96, message.chartPlotly!.layout?.margin?.t || 0),
                                          r: Math.max(32, message.chartPlotly!.layout?.margin?.r || 0),
                                          b: Math.max(60, message.chartPlotly!.layout?.margin?.b || 0),
                                          l: Math.max(60, message.chartPlotly!.layout?.margin?.l || 0),
                                        },
                                        title: {
                                          ...(message.chartPlotly!.layout?.title || {}),
                                          pad: {
                                            ...(message.chartPlotly!.layout?.title?.pad || {}),
                                            t: Math.max(24, message.chartPlotly!.layout?.title?.pad?.t || 0),
                                          },
                                        },
                                      }}
                                      config={{ displayModeBar: true, responsive: true }}
                                      style={{ width: "100%", height: "100%" }}
                                      useResizeHandler
                                      plotly={Plotly}
                                    />
                                  </Suspense>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </Card>
                </div>
              </div>
          );
        })}
        

        {isLoading && (
          <div className="relative isolate flex items-start space-x-3">
            <Avatar className="w-8 h-8">
              <AvatarFallback className="bg-chat-bot">
                <Bot className="w-4 h-4 text-foreground" />
              </AvatarFallback>
            </Avatar>
            <div className="w-full">
              {/* meta */}
              <div className="text-xs text-muted-foreground mb-3">
                InsightGuru · Processing...
              </div>
              <Card className="relative isolate overflow-hidden p-4 bg-card">
                <p className="text-foreground">Processing your query...</p>
              </Card>
            </div>
          </div>
        )}

        {/* Invisible marker for end of chat */}
        <div ref={messagesEndRef} />
      </div>

      <br />

      {/* ChatGPT-like composer (fixed footer, compact height, styled input) */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-background shadow-lg border-t">
        <div className="mx-auto w-full max-w-5xl px-4 py-3">
          <div className="relative left-40">
            <Textarea
              placeholder="Ask anything..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !isLoading && newMessage.trim()) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 200) + "px";
              }}
              rows={1}
              className="w-full resize-none rounded-2xl border border-gray-300 
                         bg-white px-4 py-3 pr-14 text-sm font-medium text-start
                         shadow-md min-h-[54px] max-h-[220px] overflow-auto
                         focus:outline-none focus:border-transparent focus:ring-0"
            />

            <Button
              type="button"
              size="icon"
              onClick={handleSendMessage}
              disabled={!newMessage.trim() || isLoading}
              className="absolute right-2 bottom-2 h-9 w-9 rounded-full 
                         bg-primary text-white hover:bg-primary/90 
                         shadow-md border border-primary"
              aria-label="Send message"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>

          <div className="mt-2 text-center text-xs text-muted-foreground">
            InsightGuru can make mistakes — check important info.
          </div>
        </div>
      </div>
    </div>
  </div>
);
};

export default Chat;
