import { useState, useRef } from "react";
import type { DragEvent, ChangeEvent, FormEvent } from "react";
import { useNavigate } from "react-router";
import { FileUp, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { submitGpxJob } from "@/api/client";
import { useT } from "@/i18n/useT";
import { useJobStore } from "@/stores/jobStore";
import { toast } from "sonner";

export function GpxPage() {
  const navigate = useNavigate();
  const t = useT();
  const setJobId = useJobStore((s) => s.setJobId);

  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("09:00");
  const [avgSpeed, setAvgSpeed] = useState(15);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.name.toLowerCase().endsWith(".gpx")) {
      setFile(dropped);
    } else {
      toast.error("Bitte eine .gpx-Datei auswählen");
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.error(t.gpx.errors.noFile);
      return;
    }
    if (!startDate) {
      toast.error(t.gpx.errors.noDate);
      return;
    }
    setSubmitting(true);
    try {
      const { jobId } = await submitGpxJob(file, startDate, startTime, avgSpeed);
      setJobId(jobId);
      navigate(`/progress/${jobId}`);
    } catch (err) {
      toast.error(
        t.gpx.errors.submissionFailed +
          (err instanceof Error ? `: ${err.message}` : "")
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl p-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" />
            {t.gpx.heading}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>{t.gpx.uploadLabel}</Label>
              <div
                className={[
                  "mt-1 flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed p-6 transition-colors",
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50",
                ].join(" ")}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
                {file ? (
                  <span className="text-sm font-medium">{file.name}</span>
                ) : (
                  <>
                    <span className="text-sm text-muted-foreground">{t.gpx.dropHint}</span>
                    <span className="mt-1 text-xs text-muted-foreground">{t.gpx.uploadButton}</span>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".gpx"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="startDate">{t.gpx.startDate}</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="startTime">{t.gpx.startTime}</Label>
                <Input
                  id="startTime"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="avgSpeed">{t.gpx.avgSpeed}</Label>
              <p className="text-xs text-muted-foreground">{t.gpx.avgSpeedDesc}</p>
              <Input
                id="avgSpeed"
                type="number"
                min={1}
                max={200}
                value={avgSpeed}
                onChange={(e) => setAvgSpeed(Number(e.target.value))}
                className="mt-1"
              />
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? t.gpx.submitting : t.gpx.submit}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
