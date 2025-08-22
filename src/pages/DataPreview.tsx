import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

type SchemaField = {
  field: string;
  type?: string;
  description?: string;
};

type PreviewResponse = {
  rows?: Array<Record<string, any>>;
  schema?: SchemaField[];
  columns?: string[]; // optional; if your backend sends a list of columns
  message?: string;
  error?: string;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || "https://fingenie-backend.vercel.app";

const inferType = (v: any): string => {
  if (v === null || v === undefined) return "Null";
  if (typeof v === "number") return Number.isInteger(v) ? "Integer" : "Number";
  if (typeof v === "boolean") return "Boolean";
  if (typeof v === "string") {
    // naive date sniff
    const d = new Date(v);
    if (!isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(v)) return "Date";
    return "String";
  }
  if (Array.isArray(v)) return "Array";
  return "Object";
};

const DataPreview = () => {
  const { dsId } = useParams<{ dsId: string }>();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<"preview" | "schema">("preview");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<PreviewResponse["rows"]>([]);
  const [schema, setSchema] = useState<SchemaField[] | undefined>(undefined);
  const [columns, setColumns] = useState<string[]>([]);

  // Fallback to localStorage if route param not present
  const resolvedId = useMemo(() => dsId || localStorage.getItem("db_path") || "", [dsId]);

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      if (!resolvedId) {
        setErr("Missing dataset id. Try re-uploading your dataset.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setErr(null);

      try {
        const res = await fetch(
          `${API_BASE}/v1/datasets/${encodeURIComponent(resolvedId)}/preview`,
          { method: "GET" }
        );

        // parse safely
        const ct = res.headers.get("content-type") || "";
        const body: PreviewResponse = ct.includes("application/json")
          ? await res.json()
          : (() => {
              // try text->json else wrap as error
              // @ts-ignore
              return {};
            })();

        if (!res.ok) {
          throw new Error(body?.error || body?.message || `Preview failed (status ${res.status})`);
        }

        const fetchedRows = body.rows ?? [];
        const fetchedColumns =
          body.columns ??
          (fetchedRows.length > 0 ? Object.keys(fetchedRows[0]) : []);

        if (isMounted) {
          setRows(fetchedRows);
          setColumns(fetchedColumns);
          setSchema(
            body.schema ??
              // Infer when backend doesn't send schema
              fetchedColumns.map((col) => ({
                field: col,
                type: inferType(fetchedRows[0]?.[col]),
                description: "",
              }))
          );
        }
      } catch (e: any) {
        if (isMounted) setErr(e?.message || "Failed to load preview.");
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    run();
    return () => {
      isMounted = false;
    };
  }, [resolvedId]);

  const maxRowsToShow = 100; // avoid rendering huge tables
  const previewRows = useMemo(
    () => (rows || []).slice(0, maxRowsToShow),
    [rows]
  );

  useEffect(() => {
  if (!loading && !err) {
    // Auto-redirect to /chat after 5 seconds
    const timer = setTimeout(() => {
      navigate("/insights");
    }, 10000);

    return () => clearTimeout(timer);
  }
}, [loading, err, navigate]);





  return (
  <div className="flex-1 min-h-0 flex flex-col">
    <div className="max-w-6xl mx-auto p-8 flex-1 min-h-0 flex flex-col space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Data Preview</h1>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate("/insights")}>
            Continue to Insights
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <X className="w-4 h-4" />
            Close
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 bg-muted p-1 rounded-lg w-fit">
        <Button
          variant={activeTab === "preview" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("preview")}
          className={activeTab === "preview" ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}
        >
          Data Preview
        </Button>
        <Button
          variant={activeTab === "schema" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("schema")}
        >
          Data Schema
        </Button>
      </div>

      {/* Content Card: fixed frame, internal scroll */}
      <Card className="mt-1 flex-1 min-h-0 p-0 overflow-hidden">
        {/* Non-scrolling status header (only shown on load/error) */}
        {(loading || err) && (
          <div className="p-6 border-b">
            {loading ? (
              <div className="text-muted-foreground">Loading preview…</div>
            ) : (
              <div className="space-y-3">
                <div className="text-destructive font-medium">Failed to load preview</div>
                <div className="text-muted-foreground text-sm">{err}</div>
                <Button
                  onClick={() => {
                    setLoading(true);
                    setErr(null);
                    window.location.reload();
                  }}
                  size="sm"
                >
                  Retry
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Scrollable content area */}
        {!loading && !err && (
          <div className="h-full overflow-auto p-6">
            {activeTab === "preview" ? (
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  Showing up to {Math.min(maxRowsToShow, rows?.length || 0)} of {rows?.length || 0} rows
                </div>

                <div className="rounded-lg border overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        {columns.map((col) => (
                          <th
                            key={col}
                            className="text-left p-3 font-medium text-foreground whitespace-nowrap"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.length === 0 ? (
                        <tr>
                          <td className="p-3 text-muted-foreground" colSpan={columns.length}>
                            No rows returned for this dataset.
                          </td>
                        </tr>
                      ) : (
                        previewRows.map((row, idx) => (
                          <tr key={idx} className="border-t">
                            {columns.map((col) => (
                              <td key={col} className="p-3 text-foreground align-top">
                                {String(row?.[col] ?? "")}
                              </td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-foreground">Data Schema</h3>
                <div className="space-y-3">
                  {(schema ?? []).map((f) => (
                    <div
                      key={f.field}
                      className="flex items-center justify-between p-4 bg-secondary rounded-lg"
                    >
                      <div className="flex items-center space-x-4">
                        <span className="font-medium text-foreground">{f.field}</span>
                        <Badge variant="outline">{f.type || "Unknown"}</Badge>
                      </div>
                      <span className="text-muted-foreground text-sm max-w-md">
                        {f.description || ""}
                      </span>
                    </div>
                  ))}
                  {(!schema || schema.length === 0) && (
                    <div className="text-muted-foreground text-sm">No schema provided.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Auto-redirect note (non-scrolling) */}
      {!loading && !err && (
        <div className="text-center text-muted-foreground text-sm">
          Automatically redirecting to chat in a few seconds...
        </div>
      )}
    </div>
  </div>
);

};

export default DataPreview;
