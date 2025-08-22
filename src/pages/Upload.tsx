// src/pages/Upload.tsx
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { AiOutlineCloudUpload } from "react-icons/ai";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

type UploadResponse = {
  message?: string;
  db_path?: string;
  dataset_id?: string | number;
  id?: string | number;
  error?: string;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || "https://fingenie-backend.vercel.app";
const ENDPOINT = `${API_BASE}/v1/datasets`;

// --- API call ---
async function uploadFile(file: File, name?: string): Promise<UploadResponse> {
  const fd = new FormData();
  fd.append("file", file);
  if (name) fd.append("name", name);

  console.log("[uploadFile] POST", ENDPOINT, { fileName: file.name, name });

  let res: Response;
  try {
    res = await fetch(ENDPOINT, { method: "POST", body: fd });
  } catch (err) {
    console.error("[uploadFile] Network error:", err);
    throw new Error(`Network error (possibly CORS): ${String(err)}`);
  }

  const contentType = res.headers.get("content-type") || "";
  let body: UploadResponse;
  if (contentType.includes("application/json")) {
    body = (await res.json()) as UploadResponse;
  } else {
    const text = await res.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text || "Unknown server response" };
    }
  }

  if (!res.ok) {
    const msg = body?.error || body?.message || `Upload failed (${res.status})`;
    throw new Error(msg);
  }

  const handle =
    body.db_path ??
    (body.dataset_id != null ? String(body.dataset_id) : undefined) ??
    (body.id != null ? String(body.id) : undefined);

  if (!handle) {
    throw new Error("Upload succeeded but no dataset handle was returned");
  }

  console.log("[uploadFile] Success. Handle:", handle);
  return body;
}

export default function Upload() {
  const [file, setFile] = useState<File | null>(null);
  const [datasetName, setDatasetName] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false); // flips chip + button
  const [handleValue, setHandleValue] = useState<string>(""); // saved id/db_path
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const navigate = useNavigate();
  const { toast } = useToast();

  // Auto-upload on selection
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    setFile(f);
    setUploaded(false);
    setHandleValue("");

    try {
      setIsUploading(true);
      toast({ title: "Uploading file...", description: f.name });

      const data = await uploadFile(f, datasetName);
      const idOrPath =
        (data.db_path as string) ??
        (data.dataset_id != null ? String(data.dataset_id) : undefined) ??
        (data.id != null ? String(data.id) : undefined);

      if (!idOrPath) throw new Error("Upload succeeded but returned no handle");

      localStorage.setItem("db_path", idOrPath);
      setHandleValue(idOrPath);
      setUploaded(true); // ✅ flip visuals now

      toast({
        title: "File uploaded successfully!",
        description: data.message ?? "",
      });
    } catch (e: any) {
      console.error("[handleFileSelect] Upload failed:", e);
      toast({
        title: "Upload failed",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Optional: a manual submit (fallback) — not required anymore
  const handleSubmit = async () => {
    if (!file) {
      toast({ title: "Please select a file", variant: "destructive" });
      return;
    }
    if (uploaded) return; // already uploaded via auto-upload

    try {
      setIsUploading(true);
      toast({ title: "Uploading file...", description: file.name });

      const data = await uploadFile(file, datasetName);
      const idOrPath =
        (data.db_path as string) ??
        (data.dataset_id != null ? String(data.dataset_id) : undefined) ??
        (data.id != null ? String(data.id) : undefined);

      if (!idOrPath) throw new Error("Upload succeeded but returned no handle");

      localStorage.setItem("db_path", idOrPath);
      setHandleValue(idOrPath);
      setUploaded(true);

      toast({
        title: "File uploaded successfully!",
        description: data.message ?? "",
      });
    } catch (e: any) {
      toast({
        title: "Upload failed",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleContinue = () => {
    if (!handleValue) return;
    // Choose one:
    // navigate(`/datasets/${encodeURIComponent(handleValue)}/preview`);
    navigate("/data-preview");
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-6xl w-full space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-3xl font-bold text-foreground">
            What decision are we powering up today?
          </h1>
        </div>

        <Card className="p-8 bg-card">
          <div className="rounded-xl p-12 text-center border border-border bg-card">
            <AiOutlineCloudUpload className="w-16 h-16 mx-auto mb-6 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2 text-foreground">
              Upload your financial dataset
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              Supported: CSV (.csv) and Excel (.xlsx, .xls)
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileSelect} // 👈 auto-upload happens here
              className="hidden"
            />

            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              <AiOutlineCloudUpload className="w-4 h-4 mr-2" />
              {isUploading ? "Uploading..." : "Browse files"}
            </Button>

            {/* Selected file chip */}
            {file && (
              <div
                className={cn(
                  "mt-4 relative w-full overflow-hidden rounded-md border",
                  uploaded
                    ? "!bg-green-50 !border-green-200"
                    : "!bg-gray-100 !border-gray-300"
                )}
              >
                {/* Left green rail after upload */}
                {uploaded && (
                  <span className="absolute inset-y-0 left-0 w-1 bg-green-600" />
                )}

                <div className="flex items-center justify-between p-3 pl-4">
                  <span className="text-black">
                    Selected: {file.name}
                  </span>

                  {uploaded && (
                    <span className="inline-flex items-center gap-1 text-green-700 font-medium">
                      <CheckCircle2 className="w-4 h-4" /> Uploaded
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Optional dataset name */}
          <div className="mt-6">
            <label className="block text-sm font-medium mb-2 text-foreground" htmlFor="ds-name">
              Dataset name (optional)
            </label>
            <input
              id="ds-name"
              type="text"
              value={datasetName}
              onChange={(e) => setDatasetName(e.target.value)}
              placeholder="e.g. Q2_2025_PnL"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              disabled={isUploading}
            />
          </div>

          {/* Bottom CTA changes after upload */}
          <div className="mt-8 flex justify-center gap-3">
            {!uploaded ? (
              // Fallback manual submit (you can remove this button if you want only auto-upload)
              <Button
                onClick={handleSubmit}
                disabled={!file || isUploading}
                variant="ghost"
                className={cn(
                  "px-8 border transition-colors",
                  "!bg-white !text-black !border-black hover:!bg-white"
                )}
              >
                {isUploading ? "Uploading..." : "Submit Dataset"}
              </Button>
            ) : (
              <Button
                onClick={handleContinue}
                variant="ghost"
                className="px-8 !bg-black !text-white !border !border-black hover:!bg-black"
              >
                Submit
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
