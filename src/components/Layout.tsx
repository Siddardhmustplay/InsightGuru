import React, { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, MessageSquare, Search, Link as LinkIcon } from "lucide-react";
import { RiTableLine, RiLightbulbLine } from "react-icons/ri";
import { useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: ReactNode;
}

type SessionListItem = {
  session_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  message_count: number;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || "https://fingenie-backend.vercel.app";

const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2));

const getClientId = () => {
  let cid = localStorage.getItem("client_id");
  if (!cid) {
    cid = uid();
    localStorage.setItem("client_id", cid);
  }
  return cid;
};

const getDatasetId = () =>
  localStorage.getItem("dataset_id") ||
  localStorage.getItem("datasetId") ||
  localStorage.getItem("db_path") ||
  localStorage.getItem("dbPath") ||
  "";

const Layout = ({ children }: LayoutProps) => {
  const navigate = useNavigate();
  const location = useLocation();

  const sidebarItems = [
    { icon: Upload, label: "Upload Data", path: "/" },
    { icon: RiTableLine, label: "Data Preview", path: "/data-preview" },
    { icon: RiLightbulbLine, label: "Insights", path: "/insights" },
    { icon: MessageSquare, label: "New Chat", path: "/chat", makeNew: true as const },
    { icon: Search, label: "Search Chat", path: "/search" },
  ];

  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [errorSessions, setErrorSessions] = useState<string | null>(null);

  const clientId = useMemo(getClientId, []);
  const datasetId = getDatasetId();
  const datasetName = localStorage.getItem("dataset_name") || "";

  // --- URL state parsing -----------------------------------------------------
  // Keep a stable initial reading of ?sid to avoid first-paint flicker
  const initialHasSidRef = useRef<boolean>(
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).has("sid")
      : false
  );

  // Parse search params reactively
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);

  // Presence of sid in URL (use initial ref to prevent first-render mismatch)
  const hasSid = searchParams.has("sid") || initialHasSidRef.current;

  // For session list row highlighting
  const activeSessionId = useMemo(() => searchParams.get("sid") || "", [searchParams]);

  // ROUTE/STATE → ACTIVE/INACTIVE STYLES -------------------------------------
  const baseBtnClasses =
    "w-full justify-start group transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-black dark:focus-visible:ring-white";

  const activeNavClasses = "bg-black text-white hover:bg-black hover:text-white";
  const inactiveNavClasses = "text-sidebar-text hover:bg-gray-200 dark:hover:bg-gray-700";
  const inactiveSessionClasses = "text-sidebar-text hover:bg-gray-200 dark:hover:bg-gray-700 text-sm";
  const activeSessionClasses =
    "bg-gray-200 text-foreground hover:bg-gray-200 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-700";

  const listSessions = async () => {
    if (!clientId || !datasetId) {
      setSessions([]);
      return;
    }
    setLoadingSessions(true);
    setErrorSessions(null);
    try {
      const url = new URL(`${API_BASE}/v1/chats/sessions`);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("dataset_id", datasetId);
      const res = await fetch(url.toString(), { method: "GET" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.message || `Failed (${res.status})`);
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (e: any) {
      setErrorSessions(e?.message || "Failed to load sessions");
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  };

  const createSession = async (): Promise<string | null> => {
    if (!clientId || !datasetId) return null;
    try {
      const res = await fetch(`${API_BASE}/v1/chats/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          dataset_id: datasetId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.message || `Create failed (${res.status})`);
      const sid = data?.session?.session_id as string | undefined;
      if (!sid) throw new Error("No session_id returned");
      await listSessions();
      window.dispatchEvent(new CustomEvent("fin-genie:sessions-updated"));
      return sid;
    } catch (e: any) {
      setErrorSessions(e?.message || "Failed to create session");
      return null;
    }
  };

  useEffect(() => {
    listSessions();
    const onFocus = () => listSessions();
    const onUpdated = () => listSessions();
    window.addEventListener("focus", onFocus);
    window.addEventListener("fin-genie:sessions-updated", onUpdated as EventListener);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("fin-genie:sessions-updated", onUpdated as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, datasetId]);

  const handleNavClick = async (item: (typeof sidebarItems)[number]) => {
    if (item.makeNew) {
      if (!datasetId) {
        navigate("/");
        return;
      }
      const sid = await createSession();
      if (sid) {
        navigate(`/chat?sid=${encodeURIComponent(sid)}`);
      }
      return;
    }
    navigate(item.path);
  };

  const activePath = location.pathname;

  // Only highlight "New Chat" nav when at /chat with NO sid
  const isChatBare = activePath === "/chat" && !hasSid;

  console.log("Dataset ID:", datasetId);

  return (
    // Root wrapper fixed and full-viewport
    <div className="fixed inset-0 flex bg-background">
      {/* Sidebar */}
      <div className="w-64 shrink-0 bg-sidebar-bg border-r border-border flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-lg text-foreground">InsightGuru</span>
          </div>
        </div>

        {/* Dataset card */}
        <div className="px-4 pt-4">
          <div className="rounded-lg border border-border p-3">
            <div className="text-xs text-muted-foreground mb-1">Current dataset</div>
            {datasetId ? (
              <>
                {datasetName && (
                  <div className="text-foreground text-sm font-medium mb-1 break-all">
                    {datasetName}
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-muted-foreground truncate" title={datasetId}>
                    {datasetId}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground">
                No dataset selected. Upload to start.
              </div>
            )}
            <div className="mt-2 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate("/")} className="w-full">
                <LinkIcon className="w-3.5 h-3.5 mr-2" />
                Change
              </Button>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex-1 p-4 space-y-2 overflow-auto">
          {/* Always-available buttons */}
          {sidebarItems.map((item, index) => {
            const isActive = item.path === "/chat" ? isChatBare : activePath === item.path;

            return (
              <Button
                key={index}
                variant="ghost"
                className={cn(
                  baseBtnClasses,
                  isActive ? activeNavClasses : inactiveNavClasses
                )}
                onClick={() => handleNavClick(item)}
                disabled={item.makeNew && !datasetId}
                title={item.makeNew && !datasetId ? "Upload a dataset first" : undefined}
                aria-current={isActive ? "page" : undefined}
                data-active={isActive ? "true" : "false"}
              >
                <item.icon
                  className={cn(
                    "shrink-0",
                    isActive ? "text-white" : "text-muted-foreground group-hover:text-foreground"
                  )}
                />
                {item.label}
              </Button>
            );
          })}

          {/* Chat Sessions */}
          <div className="mt-6">
            <h3 className="text-sm font-medium text-sidebar-text mb-3">Chats</h3>

            {!datasetId && (
              <div className="text-xs text-muted-foreground">
                Upload a dataset to start chatting.
              </div>
            )}

            {datasetId && loadingSessions && (
              <div className="text-xs text-muted-foreground">Loading sessions…</div>
            )}

            {datasetId && errorSessions && (
              <div className="text-xs text-destructive">{errorSessions}</div>
            )}

            {datasetId && !loadingSessions && !errorSessions && sessions.length === 0 && (
              <div className="text-xs text-muted-foreground">
                No chats yet. Click <em>New Chat</em> to begin.
              </div>
            )}

            {datasetId && sessions.length > 0 && (
              <div className="space-y-1">
                {sessions.map((s) => {
                  const isActive = s.session_id === activeSessionId;
                  return (
                    <Button
                      key={s.session_id}
                      variant="ghost"
                      className={cn(
                        baseBtnClasses,
                        isActive ? activeSessionClasses : inactiveSessionClasses
                      )}
                      onClick={() => navigate(`/chat?sid=${encodeURIComponent(s.session_id)}`)}
                      title={new Date(s.updated_at).toLocaleString()}
                      aria-current={isActive ? "true" : undefined}
                      data-active={isActive ? "true" : "false"}
                    >
                      <span className="truncate">{s.name || "Untitled chat"}</span>
                    </Button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col overflow-auto">{children}</div>
    </div>
  );
};

export default Layout;
