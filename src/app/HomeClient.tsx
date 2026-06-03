"use client";

import Image from "next/image";
import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import Onboarding from "./components/Onboarding";
import ResultCard from "./components/ResultCard";
import SliderField from "./components/SliderField";
import styles from "./page.module.css";

/* ─── Types ─── */

type Detection = {
  className: string;
  confidence: number;
  box: { x1: number; y1: number; x2: number; y2: number };
};

type PredictResponse = {
  detections: Detection[];
  annotatedImage: string;
  imageWidth: number;
  imageHeight: number;
  modelPath: string;
  modelNames: Record<string, string>;
  classCounts: Record<string, number>;
  usedParams: { conf: number; iou: number; imgsz: number };
};

type AppMode = "upload" | "realtime";

type HistoryEntry = {
  id: string;
  thumbnail: string;
  count: number;
  timestamp: number;
  result: PredictResponse;
};

/** Letterbox rect for object-fit: contain (video preview + overlay alignment). */
function getObjectFitRect(
  containerW: number,
  containerH: number,
  contentW: number,
  contentH: number,
) {
  const scale = Math.min(containerW / contentW, containerH / contentH);
  const width = contentW * scale;
  const height = contentH * scale;
  return {
    scale,
    offsetX: (containerW - width) / 2,
    offsetY: (containerH - height) / 2,
  };
}

const REALTIME_JPEG_QUALITY = 0.94;

/* ─── Component ─── */

export default function Home() {
  /* State */
  const [mode, setMode] = useState<AppMode>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [result, setResult] = useState<PredictResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [showMeta, setShowMeta] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);

  /* Params */
  const [conf, setConf] = useState("0.25");
  const [iou, setIou] = useState("0.70");
  const [imgsz, setImgsz] = useState("768");
  const [realtimeEveryMs, setRealtimeEveryMs] = useState("600");

  /* Refs */
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const imageCaptureRef = useRef<{ grabFrame: () => Promise<ImageBitmap> } | null>(null);
  const isSendingRef = useRef(false);
  const streamingRef = useRef(false);
  const realtimeReqIdRef = useRef(0);
  const paramsRef = useRef({ conf, iou, imgsz });
  const lastCaptureSizeRef = useRef({ width: 0, height: 0 });

  useEffect(() => {
    paramsRef.current = { conf, iou, imgsz };
  }, [conf, iou, imgsz]);

  /* Computed */
  const detectionCount = result?.detections.length ?? 0;
  const predictEndpoint = process.env.NEXT_PUBLIC_PREDICT_API_URL?.trim() || "/api/predict";
  const statusText = useMemo(() => {
    if (!result) return "Belum ada hasil";
    return `${detectionCount} objek terdeteksi`;
  }, [result, detectionCount]);

  /* ─── Onboarding ─── */
  useEffect(() => {
    if (!localStorage.getItem("onboarding_done")) {
      setShowOnboarding(true);
    }
  }, []);

  const closeOnboarding = useCallback(() => {
    setShowOnboarding(false);
    localStorage.setItem("onboarding_done", "1");
  }, []);

  /* ─── Dark Mode ─── */
  useEffect(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "dark") {
      setDarkMode(true);
      document.documentElement.classList.add("dark");
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setDarkMode((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  }, []);

  /* ─── File Handling ─── */
  const handleFile = useCallback(
    (chosen: File | null) => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setFile(chosen);
      setResult(null);
      setError("");
      setPreviewUrl(chosen ? URL.createObjectURL(chosen) : "");
    },
    [previewUrl],
  );

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleFile(e.target.files?.[0] ?? null);
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };
  const onDragLeave = () => setDragging(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.type.startsWith("image/")) handleFile(dropped);
  };

  /* ─── Inference ─── */
  const inferFromBlob = async (blob: Blob, isRealtime = false, requestId = 0) => {
    const fd = new FormData();
    fd.append("image", blob, isRealtime ? "frame.jpg" : "image.jpg");
    fd.append("conf", isRealtime ? paramsRef.current.conf : conf);
    fd.append("iou", isRealtime ? paramsRef.current.iou : iou);
    fd.append("imgsz", isRealtime ? paramsRef.current.imgsz : imgsz);
    if (isRealtime) fd.append("lite", "1");

    const res = await fetch(predictEndpoint, { method: "POST", body: fd });
    if (!res.ok) {
      const payload = (await res.json()) as { error?: string };
      throw new Error(payload.error ?? "Terjadi kesalahan saat inferensi.");
    }

    const payload = (await res.json()) as PredictResponse;

    if (isRealtime) {
      if (!streamingRef.current || requestId !== realtimeReqIdRef.current) return;

      setResult((prev) => ({
        detections: payload.detections,
        classCounts: payload.classCounts,
        modelNames: payload.modelNames,
        imageWidth: payload.imageWidth,
        imageHeight: payload.imageHeight,
        modelPath: payload.modelPath,
        usedParams: payload.usedParams,
        annotatedImage: prev?.annotatedImage ?? "",
      }));

      drawOverlay(
        payload.detections,
        payload.imageWidth || lastCaptureSizeRef.current.width,
        payload.imageHeight || lastCaptureSizeRef.current.height,
      );
      return;
    }

    setResult(payload);
    setHistory((prev) => {
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        thumbnail: payload.annotatedImage,
        count: payload.detections.length,
        timestamp: Date.now(),
        result: payload,
      };
      return [entry, ...prev].slice(0, 20);
    });
  };

  const drawOverlay = (
    detections: Detection[],
    sourceWidth: number,
    sourceHeight: number,
  ) => {
    const canvas = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || video.videoWidth === 0 || !sourceWidth || !sourceHeight) return;

    const displayWidth = video.clientWidth;
    const displayHeight = video.clientHeight;
    if (!displayWidth || !displayHeight) return;

    canvas.width = displayWidth;
    canvas.height = displayHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const { scale, offsetX, offsetY } = getObjectFitRect(
      displayWidth,
      displayHeight,
      sourceWidth,
      sourceHeight,
    );

    detections.forEach((det) => {
      const x = offsetX + det.box.x1 * scale;
      const y = offsetY + det.box.y1 * scale;
      const w = (det.box.x2 - det.box.x1) * scale;
      const h = (det.box.y2 - det.box.y1) * scale;

      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, w, h);

      ctx.fillStyle = "#10b981";
      const label = `${det.className} ${Math.round(det.confidence * 100)}%`;
      ctx.font = "bold 14px sans-serif";
      const textWidth = ctx.measureText(label).width;
      const labelY = Math.max(y, 22);

      ctx.fillRect(x, labelY - 22, textWidth + 10, 22);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, x + 5, labelY - 6);
    });
  };

  const captureFrameToCanvas = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.imageSmoothingEnabled = false;

    try {
      const capture = imageCaptureRef.current;
      if (capture) {
        const frame = await capture.grabFrame();
        canvas.width = frame.width;
        canvas.height = frame.height;
        ctx.drawImage(frame, 0, 0);
        frame.close?.();
      } else {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
    } catch (err) {
      console.warn("Realtime capture fallback:", err);
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    lastCaptureSizeRef.current = { width: canvas.width, height: canvas.height };
    return canvas;
  };

  /* ─── Webcam ─── */
  const captureAndInferRealtime = async () => {
    if (isSendingRef.current || !streamingRef.current) return;

    const canvas = await captureFrameToCanvas();
    if (!canvas) return;

    const requestId = ++realtimeReqIdRef.current;
    isSendingRef.current = true;
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((value) => resolve(value), "image/jpeg", REALTIME_JPEG_QUALITY),
      );
      if (!blob) throw new Error("Gagal mengambil frame.");
      await inferFromBlob(blob, true, requestId);
    } catch (err) {
      console.error(err);
    } finally {
      isSendingRef.current = false;
    }
  };

  const captureAndInfer = async () => {
    if (isSendingRef.current) return;

    isSendingRef.current = true;
    setLoading(true);
    try {
      const canvas = await captureFrameToCanvas();
      if (!canvas) throw new Error("Kamera belum siap.");
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((value) => resolve(value), "image/jpeg", REALTIME_JPEG_QUALITY),
      );
      if (!blob) throw new Error("Gagal mengambil frame.");
      await inferFromBlob(blob, false);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memproses frame.");
    } finally {
      isSendingRef.current = false;
      setLoading(false);
    }
  };

  const stopRealtime = () => {
    streamingRef.current = false;
    realtimeReqIdRef.current += 1;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    imageCaptureRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    const overlay = overlayCanvasRef.current;
    if (overlay) {
      const ctx = overlay.getContext("2d");
      ctx?.clearRect(0, 0, overlay.width, overlay.height);
    }
    setCameraReady(false);
    setStreaming(false);
  };

  const runRealtimeLoop = async () => {
    const gapMs = () => {
      const ms = Number.parseInt(realtimeEveryMs, 10);
      return Number.isNaN(ms) ? 600 : Math.max(300, Math.min(5000, ms));
    };

    while (streamingRef.current) {
      await captureAndInferRealtime();
      if (!streamingRef.current) break;
      await new Promise((resolve) => window.setTimeout(resolve, gapMs()));
    }
  };

  const startRealtime = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Browser tidak mendukung webcam.");
      return;
    }
    try {
      setError("");
      setResult(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (track && typeof ImageCapture !== "undefined") {
        imageCaptureRef.current = new ImageCapture(track) as unknown as {
          grabFrame: () => Promise<ImageBitmap>;
        };
      } else {
        imageCaptureRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        await new Promise<void>((resolve) => {
          const video = videoRef.current;
          if (!video) {
            resolve();
            return;
          }
          if (video.videoWidth > 0) {
            resolve();
            return;
          }
          video.onloadeddata = () => resolve();
        });
      }
      setCameraReady(true);
      setStreaming(true);
      streamingRef.current = true;
      void runRealtimeLoop();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tidak dapat mengakses kamera.");
      stopRealtime();
    }
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) {
      setError("Pilih gambar terlebih dahulu.");
      return;
    }
    try {
      setLoading(true);
      setError("");
      await inferFromBlob(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memproses gambar.");
    } finally {
      setLoading(false);
    }
  };

  /* ─── Download PDF Report ─── */
  const downloadResult = async () => {
    if (!result) return;
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.getWidth();   // 210
    const ph = doc.internal.pageSize.getHeight();   // 297
    const M = 18;                                   // margin
    const W = pw - M * 2;                           // usable width (174)
    let y = 0;
    const reportId = `VL-${Date.now().toString(36).toUpperCase()}`;
    const now = new Date();
    const dateStr = now.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const timeStr = now.toLocaleTimeString("id-ID");

    /* -- Palette -- */
    const C = {
      primary:    [55, 48, 163] as const,
      primaryLt:  [99, 102, 241] as const,
      accent:     [139, 92, 246] as const,
      ink:        [15, 23, 42] as const,
      inkSec:     [51, 65, 85] as const,
      inkMut:     [100, 116, 139] as const,
      bgAlt:      [248, 250, 252] as const,
      border:     [226, 232, 240] as const,
      white:      [255, 255, 255] as const,
      green:      [22, 163, 74] as const,
      yellow:     [202, 138, 4] as const,
      red:        [220, 38, 38] as const,
    };
    type RGB = readonly [number, number, number];
    const tc = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
    const fc = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
    const dc = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);

    const footerY = ph - 10;
    const maxBodyY = footerY - 8;

    const ensureSpace = (need: number) => {
      if (y + need > maxBodyY) { doc.addPage(); y = 20; }
    };

    /* -- Shared: Section Number -- */
    let sectionNum = 0;

    /* -- Shared: Section Title with colored number pill -- */
    const sectionTitle = (title: string) => {
      sectionNum++;
      ensureSpace(16);
      dc(C.border);
      doc.setLineWidth(0.4);
      doc.line(M, y, M + W, y);
      y += 8;
      /* Number pill */
      fc(C.primaryLt);
      doc.roundedRect(M, y - 5, 8, 8, 2, 2, "F");
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      tc(C.white);
      doc.text(`${sectionNum}`, M + 4, y + 0.5, { align: "center" });
      /* Title text */
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      tc(C.primary);
      doc.text(title, M + 12, y + 0.5);
      y += 7;
    };

    /* -- Shared: Key-Value Row -- */
    const kvRow = (label: string, value: string) => {
      ensureSpace(6);
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "bold");
      tc(C.inkSec);
      doc.text(label, M + 2, y);
      doc.setFont("helvetica", "normal");
      tc(C.ink);
      doc.text(value, M + 52, y);
      y += 5;
    };

    /* ====== PAGE 1 -- HEADER ====== */

    /* Top accent bar */
    fc(C.primary);
    doc.rect(0, 0, pw, 3, "F");

    /* Header block */
    y = 14;
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    tc(C.primary);
    doc.text("LAPORAN DETEKSI OBJEK", M, y);
    y += 6;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    tc(C.inkMut);
    doc.text("Vision Lab  |  YOLOv8 Deep Learning Object Detection System", M, y);
    y += 9;

    /* Meta info strip */
    fc(C.bgAlt);
    dc(C.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(M, y, W, 18, 2, 2, "FD");
    const metaY = y + 5.5;
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    tc(C.inkSec);
    doc.text("REPORT ID", M + 4, metaY);
    doc.text("TANGGAL", M + 50, metaY);
    doc.text("WAKTU", M + 110, metaY);
    doc.text("MODE", M + 145, metaY);
    doc.setFont("helvetica", "normal");
    tc(C.ink);
    doc.text(reportId, M + 4, metaY + 5.5);
    doc.text(dateStr, M + 50, metaY + 5.5);
    doc.text(timeStr, M + 110, metaY + 5.5);
    doc.text(mode.toUpperCase(), M + 145, metaY + 5.5);
    y += 24;

    /* ====== SECTION 1 -- IMAGE ====== */
    sectionTitle("Gambar Hasil Deteksi");

    if (result.annotatedImage) {
      const imgData = result.annotatedImage;
      const iW = result.imageWidth || 800;
      const iH = result.imageHeight || 800;
      const ratio = iH / iW;
      const imgW = Math.min(W - 8, 164);
      const imgH = imgW * ratio;
      ensureSpace(imgH + 10);
      const imgX = M + (W - imgW) / 2;
      dc(C.border);
      doc.setLineWidth(0.4);
      doc.roundedRect(imgX - 1.5, y - 1.5, imgW + 3, imgH + 3, 1.5, 1.5, "S");
      doc.addImage(imgData, "JPEG", imgX, y, imgW, imgH);
      y += imgH + 5;
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "italic");
      tc(C.inkMut);
      doc.text(`Resolusi asli: ${iW} x ${iH} px`, pw / 2, y, { align: "center" });
      y += 7;
    }

    /* ====== SECTION 2 -- SUMMARY CARDS ====== */
    sectionTitle("Ringkasan Deteksi");

    ensureSpace(32);
    const cardW = (W - 6) / 3;
    const avgConfVal = result.detections.length > 0
      ? result.detections.reduce((s, d) => s + d.confidence, 0) / result.detections.length
      : 0;
    const cards: { label: string; value: string; sub: string; color: RGB }[] = [
      { label: "Total Objek", value: `${result.detections.length}`, sub: "terdeteksi", color: C.primaryLt },
      { label: "Jumlah Kelas", value: `${Object.keys(result.classCounts).length}`, sub: "kategori unik", color: C.accent },
      {
        label: "Rata-rata Conf.",
        value: result.detections.length > 0 ? `${(avgConfVal * 100).toFixed(1)}%` : "-",
        sub: "mean score",
        color: result.detections.length > 0
          ? (avgConfVal >= 0.7 ? C.green : C.yellow)
          : C.inkMut,
      },
    ];
    cards.forEach((card, i) => {
      const cx = M + i * (cardW + 3);
      fc(C.bgAlt);
      dc(C.border);
      doc.setLineWidth(0.3);
      doc.roundedRect(cx, y, cardW, 26, 2, 2, "FD");
      /* Color accent bar at top */
      fc(card.color);
      doc.roundedRect(cx, y, cardW, 3, 2, 0, "F");
      doc.rect(cx, y + 1.5, cardW, 1.5, "F");
      /* Label */
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      tc(C.inkMut);
      doc.text(card.label.toUpperCase(), cx + 4, y + 9);
      /* Value */
      doc.setFontSize(15);
      doc.setFont("helvetica", "bold");
      tc(card.color);
      doc.text(card.value, cx + 4, y + 18);
      /* Sub label on separate line */
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      tc(C.inkMut);
      doc.text(card.sub, cx + 4, y + 23);
    });
    y += 32;

    /* Per-class breakdown line */
    if (Object.keys(result.classCounts).length > 0) {
      ensureSpace(8);
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "normal");
      tc(C.inkSec);
      const classParts = Object.entries(result.classCounts).map(([n, c]) => `${n}: ${c}`);
      doc.text("Distribusi per kelas:  " + classParts.join("  /  "), M + 2, y);
      y += 8;
    }

    /* ====== SECTION 3 -- DETAIL TABLE ====== */
    if (result.detections.length > 0) {
      sectionTitle("Detail Setiap Deteksi");

      const colDefs = [
        { header: "No.",          width: 12,  align: "center" as const },
        { header: "Kelas",        width: 42,  align: "left"   as const },
        { header: "Confidence",   width: 26,  align: "center" as const },
        { header: "Level",        width: 22,  align: "center" as const },
        { header: "Posisi (X,Y)", width: 30,  align: "center" as const },
        { header: "Ukuran (WxH)", width: 30,  align: "center" as const },
        { header: "Area (px)",    width: W - 162, align: "right" as const },
      ];

      const drawTableHeader = () => {
        ensureSpace(10);
        fc(C.primary);
        doc.roundedRect(M, y, W, 8, 1.5, 1.5, "F");
        doc.rect(M, y + 4, W, 4, "F");
        doc.setFontSize(7.5);
        doc.setFont("helvetica", "bold");
        tc(C.white);
        let hx = M;
        for (const col of colDefs) {
          const tx = col.align === "center" ? hx + col.width / 2
                   : col.align === "right"  ? hx + col.width - 2
                   : hx + 2;
          doc.text(col.header, tx, y + 5.5, { align: col.align });
          hx += col.width;
        }
        y += 8;
      };

      drawTableHeader();

      result.detections.forEach((det, idx) => {
        if (y + 7.5 > maxBodyY) {
          doc.addPage();
          y = 20;
          drawTableHeader();
        }
        const isEven = idx % 2 === 0;
        if (isEven) { fc(C.bgAlt); doc.rect(M, y, W, 7, "F"); }
        dc(C.border);
        doc.setLineWidth(0.15);
        doc.line(M, y + 7, M + W, y + 7);

        const bw = Math.round(det.box.x2 - det.box.x1);
        const bh = Math.round(det.box.y2 - det.box.y1);
        const area = bw * bh;
        const confPct = (det.confidence * 100).toFixed(1);
        const level = det.confidence >= 0.75 ? "Tinggi" : det.confidence >= 0.5 ? "Sedang" : "Rendah";
        const levelColor: RGB = det.confidence >= 0.75 ? C.green : det.confidence >= 0.5 ? C.yellow : C.red;

        const rowData = [
          `${idx + 1}`,
          det.className,
          `${confPct}%`,
          level,
          `${Math.round(det.box.x1)}, ${Math.round(det.box.y1)}`,
          `${bw} x ${bh}`,
          area.toLocaleString("id-ID"),
        ];

        doc.setFontSize(7.5);
        let rx = M;
        rowData.forEach((text, ci) => {
          const col = colDefs[ci];
          const tx = col.align === "center" ? rx + col.width / 2
                   : col.align === "right"  ? rx + col.width - 2
                   : rx + 2;
          if (ci === 3) {
            tc(levelColor);
            doc.setFont("helvetica", "bold");
          } else {
            tc(C.ink);
            doc.setFont("helvetica", ci === 0 ? "bold" : "normal");
          }
          doc.text(text, tx, y + 5, { align: col.align });
          rx += col.width;
        });
        y += 7;
      });

      /* Table border */
      dc(C.border);
      doc.setLineWidth(0.3);
      const tableBodyH = 8 + 7 * Math.min(result.detections.length, Math.floor((maxBodyY - 20) / 7));
      doc.roundedRect(M, y - 7 * result.detections.length - 8, W, tableBodyH, 1.5, 1.5, "S");
      y += 6;
    }

    /* ====== SECTION 4 -- CONFIDENCE CHART ====== */
    if (result.detections.length > 0) {
      sectionTitle("Distribusi Confidence");

      const sorted = [...result.detections].sort((a, b) => b.confidence - a.confidence);
      const barH = 5;
      const labelW = 46;
      const pctW = 18;
      const barMaxW = W - labelW - pctW - 4;

      sorted.forEach((det) => {
        ensureSpace(barH + 4);
        /* Label */
        doc.setFontSize(7.5);
        doc.setFont("helvetica", "normal");
        tc(C.ink);
        const clsLabel = det.className.length > 18 ? det.className.substring(0, 16) + "..." : det.className;
        doc.text(clsLabel, M + 2, y + 3.5);

        /* Bar track */
        const barX = M + labelW;
        fc([235, 238, 244] as const);
        doc.roundedRect(barX, y, barMaxW, barH, 1.5, 1.5, "F");

        /* Bar fill */
        const barW = Math.max(2, barMaxW * det.confidence);
        const barColor: RGB = det.confidence >= 0.75 ? C.green : det.confidence >= 0.5 ? C.yellow : C.red;
        fc(barColor);
        doc.roundedRect(barX, y, barW, barH, 1.5, 1.5, "F");

        /* Percentage */
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        tc(barColor);
        doc.text(`${(det.confidence * 100).toFixed(1)}%`, M + labelW + barMaxW + 3, y + 3.8);

        y += barH + 3;
      });

      /* Legend */
      y += 2;
      ensureSpace(8);
      const legends: { label: string; color: RGB }[] = [
        { label: "Tinggi (>=75%)", color: C.green },
        { label: "Sedang (50-74%)", color: C.yellow },
        { label: "Rendah (<50%)", color: C.red },
      ];
      let lx = M + 2;
      legends.forEach((leg) => {
        fc(leg.color);
        doc.roundedRect(lx, y - 1.5, 3, 3, 0.5, 0.5, "F");
        doc.setFontSize(6.5);
        doc.setFont("helvetica", "normal");
        tc(C.inkMut);
        doc.text(leg.label, lx + 5, y + 0.8);
        lx += 42;
      });
      y += 8;
    }

    /* ====== SECTION 5 -- KESIMPULAN ====== */
    sectionTitle("Kesimpulan");
    ensureSpace(30);

    fc([245, 248, 255] as const);
    dc(C.primaryLt);
    doc.setLineWidth(0.4);
    const conclusionLines: string[] = [];
    const totalDet = result.detections.length;
    if (totalDet === 0) {
      conclusionLines.push("Tidak ditemukan objek yang terdeteksi pada gambar ini dengan parameter yang digunakan.");
      conclusionLines.push("Saran: coba turunkan nilai Confidence threshold atau gunakan gambar dengan objek yang lebih jelas.");
    } else {
      const avgConf = result.detections.reduce((s, d) => s + d.confidence, 0) / totalDet;
      const highCount = result.detections.filter(d => d.confidence >= 0.75).length;
      const lowCount = result.detections.filter(d => d.confidence < 0.5).length;
      const topClass = Object.entries(result.classCounts).sort(([, a], [, b]) => b - a)[0];

      conclusionLines.push(
        `Model berhasil mendeteksi ${totalDet} objek dari ${Object.keys(result.classCounts).length} kelas berbeda.`,
      );
      if (topClass) {
        conclusionLines.push(
          `Kelas dominan: "${topClass[0]}" dengan ${topClass[1]} deteksi (${((topClass[1] / totalDet) * 100).toFixed(0)}% dari total).`,
        );
      }
      conclusionLines.push(
        `Rata-rata confidence: ${(avgConf * 100).toFixed(1)}% -- ${avgConf >= 0.75 ? "kualitas deteksi tinggi" : avgConf >= 0.5 ? "kualitas deteksi cukup baik" : "perlu peninjauan ulang parameter"}.`,
      );
      if (highCount > 0) {
        conclusionLines.push(`${highCount} dari ${totalDet} deteksi memiliki confidence tinggi (>=75%).`);
      }
      if (lowCount > 0) {
        conclusionLines.push(`Perhatian: ${lowCount} deteksi memiliki confidence rendah (<50%), kemungkinan false positive.`);
      }
    }

    const conclusionH = conclusionLines.length * 5.5 + 10;
    doc.roundedRect(M, y, W, conclusionH, 2, 2, "FD");
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    tc(C.ink);
    let cy = y + 6;
    conclusionLines.forEach((line) => {
      doc.text(`-  ${line}`, M + 5, cy);
      cy += 5.5;
    });
    y += conclusionH + 6;

    /* ====== SECTION 6 -- TECHNICAL INFO ====== */
    sectionTitle("Parameter & Informasi Teknis");
    ensureSpace(42);

    fc(C.bgAlt);
    dc(C.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(M, y, W, 36, 2, 2, "FD");
    y += 5;
    
    const modelStr = result.modelPath ? result.modelPath.split(/[\\/]/).slice(-2).join("/") : "YOLOv8 (Hugging Face)";
    
    kvRow("Model", modelStr);
    kvRow("Confidence Threshold", `${result.usedParams?.conf || "-"}`);
    kvRow("IoU NMS Threshold", `${result.usedParams?.iou || "-"}`);
    kvRow("Inference Image Size", `${result.usedParams?.imgsz || "-"} px`);
    kvRow("Resolusi Asli", `${result.imageWidth || "-"} x ${result.imageHeight || "-"} px`);
    kvRow("Kelas Model", Object.entries(result.modelNames || {}).map(([id, n]) => `${n} (${id})`).join(", ") || "-");
    y += 4;

    /* ====== ALL PAGES -- FOOTER ====== */
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      /* Bottom accent line */
      dc(C.primaryLt);
      doc.setLineWidth(0.4);
      doc.line(M, footerY - 2, M + W, footerY - 2);
      /* Left: branding */
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      tc(C.inkMut);
      doc.text(`Vision Lab  |  ${reportId}  |  ${dateStr}`, M, footerY + 1);
      /* Right: page number */
      doc.text(`Halaman ${p} / ${totalPages}`, M + W, footerY + 1, { align: "right" });
      /* Top bar on every page */
      fc(C.primary);
      doc.rect(0, 0, pw, 3, "F");
    }

    doc.save(`laporan-deteksi-${reportId}.pdf`);
  };

  /* ─── Load History Entry ─── */
  const loadHistoryEntry = (entry: HistoryEntry) => {
    setResult(entry.result);
  };

  /* ─── Cleanup ─── */
  useEffect(() => () => stopRealtime(), []);
  useEffect(() => {
    setResult(null);
    setError("");
    if (mode === "upload") stopRealtime();
  }, [mode]);

  /* ─── Time Formatter ─── */
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  /* ═══ RENDER ═══ */

  return (
    <div className={styles.page}>
      {showOnboarding && <Onboarding onClose={closeOnboarding} />}
      <main className={styles.shell}>
        {/* ── Navbar ── */}
        <nav className={styles.navbar}>
          <div className={styles.navLeft}>
            <div className={styles.logo}>
              <span className={styles.logoIcon}>⚡</span>
            </div>
            <div className={styles.brandText}>
              <span className={styles.brand}>Vision Lab</span>
              <span className={styles.brandSub}>Object Detection</span>
            </div>
          </div>
          <div className={styles.navRight}>
            <div className={styles.statusPill}>
              <span className={styles.statusDot} />
              <span className={styles.statusText}>
                {streaming ? "Live" : "Ready"}
              </span>
            </div>
            <button
              className={styles.themeToggle}
              onClick={() => setShowOnboarding(true)}
              title="Panduan penggunaan"
              type="button"
            >
              ❓
            </button>
            <button
              className={styles.themeToggle}
              onClick={toggleTheme}
              title="Toggle dark mode"
              type="button"
            >
              {darkMode ? "☀️" : "🌙"}
            </button>
          </div>
        </nav>

        {/* ── Hero ── */}
        <section className={styles.hero}>
          <div className={styles.heroContent}>
            <div className={styles.heroLeft}>
              <span className={styles.badge}>YOLOv8 Engine</span>
              <h1 className={styles.heroTitle}>Object Detection Workspace</h1>
              <p className={styles.heroDesc}>
                Analisis gambar dan monitoring realtime dengan YOLOv8.
                Siap untuk riset, demo, dan production.
              </p>
            </div>
            <div className={styles.heroRight}>
              <div className={styles.modeToggle}>
                <button
                  className={`${styles.modeBtn} ${mode === "upload" ? styles.modeBtnActive : ""}`}
                  onClick={() => setMode("upload")}
                  type="button"
                >
                  <span className={styles.modeBtnIcon}>📤</span>
                  Upload
                </button>
                <button
                  className={`${styles.modeBtn} ${mode === "realtime" ? styles.modeBtnActive : ""}`}
                  onClick={() => setMode("realtime")}
                  type="button"
                >
                  <span className={styles.modeBtnIcon}>📹</span>
                  Realtime
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ── Content Grid ── */}
        <div className={styles.content}>
          <section className={styles.grid}>
            {/* ▸ Input Panel */}
            <article className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={`${styles.cardIcon} ${styles.cardIconInput}`}>📤</div>
                <div>
                  <h2 className={styles.cardTitle}>Input</h2>
                  <p className={styles.cardSubtitle}>
                    {mode === "upload" ? "Upload atau drag & drop gambar" : "Webcam realtime capture"}
                  </p>
                </div>
              </div>

              <form onSubmit={onSubmit} className={styles.form}>
                {/* Upload Zone */}
                {mode === "upload" && (
                  <div
                    className={`${styles.uploadZone} ${file ? styles.hasFile : ""} ${dragging ? styles.uploadZoneDrag : ""}`}
                    onDragLeave={onDragLeave}
                    onDragOver={onDragOver}
                    onDrop={onDrop}
                  >
                    <input
                      accept="image/*"
                      className={styles.hiddenInput}
                      onChange={onFileChange}
                      type="file"
                    />
                    <div className={styles.uploadContent}>
                      {file ? (
                        <>
                          <span className={styles.uploadIcon}>✅</span>
                          <p className={styles.uploadFileName}>{file.name}</p>
                          <p className={styles.uploadHint}>Klik atau drop untuk mengganti</p>
                        </>
                      ) : (
                        <>
                          <span className={styles.uploadIcon}>☁️</span>
                          <p className={styles.uploadTitle}>
                            {dragging ? "Lepaskan gambar di sini" : "Drag & drop atau klik untuk upload"}
                          </p>
                          <p className={styles.uploadHint}>JPG, PNG, WebP — maks 10 MB</p>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Parameters */}
                <p className={styles.sectionLabel}>Parameters</p>
                <div className={styles.slidersGroup}>
                  <SliderField
                    hint="Tingkat keyakinan minimum model. Semakin tinggi, hanya deteksi paling akurat yang ditampilkan."
                    label="Confidence"
                    max={0.99}
                    min={0.01}
                    onChange={setConf}
                    step={0.01}
                    value={conf}
                  />
                  <SliderField
                    hint="Mengontrol overlap kotak deteksi. Nilai rendah = hapus duplikat lebih agresif. Nilai tinggi = izinkan kotak bertumpuk."
                    label="IoU NMS"
                    max={0.95}
                    min={0.1}
                    onChange={setIou}
                    step={0.01}
                    value={iou}
                  />
                  <SliderField
                    hint="Resolusi gambar saat diproses oleh model. Lebih besar = lebih detail tapi lebih lambat."
                    label="Image Size"
                    max={1280}
                    min={320}
                    onChange={setImgsz}
                    step={32}
                    unit="px"
                    value={imgsz}
                  />
                  {mode === "realtime" && (
                    <SliderField
                      hint="Jeda waktu antar-frame pada mode realtime. 1000ms = 1 frame per detik."
                      label="Interval"
                      max={5000}
                      min={200}
                      onChange={setRealtimeEveryMs}
                      step={100}
                      unit="ms"
                      value={realtimeEveryMs}
                    />
                  )}
                </div>

                {/* Action Buttons */}
                {mode === "upload" ? (
                  <button className={styles.btnPrimary} disabled={loading || !file} type="submit">
                    {loading && <span className={styles.spinner} />}
                    {loading ? "Processing..." : "🚀 Jalankan Deteksi"}
                  </button>
                ) : (
                  <div className={styles.actionRow}>
                    <button
                      className={styles.btnPrimary}
                      disabled={streaming}
                      onClick={() => void startRealtime()}
                      type="button"
                    >
                      {!streaming && "▶"} Start Realtime
                    </button>
                    <button
                      className={styles.btnDanger}
                      disabled={!streaming}
                      onClick={stopRealtime}
                      type="button"
                    >
                      ⏹ Stop
                    </button>
                  </div>
                )}

                {error && <p className={styles.error}>{error}</p>}
              </form>

              {/* Preview */}
              {mode === "upload" && previewUrl && (
                <div className={styles.previewArea}>
                  <p className={styles.label}>Preview</p>
                  <div className={styles.mediaFrame}>
                    {loading && (
                      <div className={styles.processing}>
                        <div className={styles.processingSpinner} />
                        <p className={styles.processingText}>Menganalisis gambar...</p>
                      </div>
                    )}
                    <Image alt="Preview" className={styles.mediaImage} fill src={previewUrl} />
                  </div>
                </div>
              )}

              {mode === "realtime" && (
                <div className={styles.previewArea}>
                  <p className={styles.label}>
                    Webcam {cameraReady ? "aktif" : "belum aktif"}
                    {streaming ? " — deteksi berjalan" : ""}
                  </p>
                  <div className={styles.mediaFrame}>
                    {loading && !streaming && (
                      <div className={styles.processing}>
                        <div className={styles.processingSpinner} />
                        <p className={styles.processingText}>Processing frame...</p>
                      </div>
                    )}
                    <video
                      autoPlay
                      className={styles.mediaImage}
                      muted
                      playsInline
                      ref={videoRef}
                    />
                    {streaming && (
                      <canvas
                        className={styles.overlayCanvas}
                        ref={overlayCanvasRef}
                      />
                    )}
                  </div>
                  <canvas className={styles.hiddenCanvas} ref={canvasRef} />
                </div>
              )}
            </article>

            {/* ▸ Output Panel */}
            <article className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={`${styles.cardIcon} ${styles.cardIconOutput}`}>📊</div>
                <div>
                  <h2 className={styles.cardTitle}>Output</h2>
                  <p className={styles.cardSubtitle}>Hasil analisis deteksi objek</p>
                </div>
              </div>

              {/* Stat */}
              <div className={styles.outputStat}>
                <span className={`${styles.statBadge} ${detectionCount === 0 ? styles.statBadgeEmpty : ""}`}>
                  {detectionCount}
                </span>
                <span className={styles.statLabel}>{statusText}</span>
              </div>

              {/* Result Image */}
              {result?.annotatedImage ? (
                <>
                  <div className={styles.resultFrame}>
                    <Image
                      alt="Detection result"
                      className={styles.resultImage}
                      fill
                      src={result.annotatedImage}
                      unoptimized
                    />
                  </div>
                  <div className={styles.downloadRow}>
                    <button className={styles.btnDownload} onClick={() => void downloadResult()} type="button">
                      📄 Export PDF Report
                    </button>
                  </div>
                </>
              ) : streaming && result && result.detections.length > 0 ? (
                <div className={styles.placeholder}>
                  <span className={styles.placeholderIcon}>📹</span>
                  Kotak deteksi ditampilkan langsung di preview webcam. Gunakan mode upload untuk gambar beranotasi penuh.
                </div>
              ) : (
                <div className={styles.placeholder}>
                  <span className={styles.placeholderIcon}>🔍</span>
                  Hasil deteksi akan muncul di sini
                </div>
              )}

              {/* Detection Cards */}
              {result && result.detections.length > 0 && (
                <>
                  <p className={styles.sectionLabel} style={{ marginTop: 22 }}>
                    Detail Deteksi
                  </p>
                  <ul className={styles.detectionGrid}>
                    {result.detections.map((item, i) => (
                      <ResultCard
                        className={item.className}
                        confidence={item.confidence}
                        index={i}
                        key={`${item.className}-${i}`}
                      />
                    ))}
                  </ul>
                </>
              )}

              {/* No detection message */}
              {result && result.detections.length === 0 && (
                <div className={styles.placeholder} style={{ marginTop: 16, padding: "24px 16px" }}>
                  <span className={styles.placeholderIcon}>🚫</span>
                  Tidak ada objek terdeteksi
                </div>
              )}

              {/* Collapsible Meta */}
              {result && (
                <>
                  <button
                    className={styles.metaToggle}
                    onClick={() => setShowMeta((p) => !p)}
                    type="button"
                  >
                    <span className={`${styles.metaToggleIcon} ${showMeta ? styles.metaToggleOpen : ""}`}>
                      ▶
                    </span>
                    Detail Teknis
                  </button>
                  {showMeta && (
                    <div className={styles.metaBox}>
                      <p className={styles.metaRow}>Model: {result.modelPath}</p>
                      <p className={styles.metaRow}>
                        conf {result.usedParams.conf} · iou {result.usedParams.iou} · imgsz{" "}
                        {result.usedParams.imgsz}
                      </p>
                      <p className={styles.metaRow}>
                        Kelas:{" "}
                        {Object.entries(result.modelNames)
                          .map(([id, n]) => `${id}:${n}`)
                          .join(" · ")}
                      </p>
                      <p className={styles.metaRow}>
                        Ringkasan:{" "}
                        {Object.entries(result.classCounts)
                          .map(([n, c]) => `${n}=${c}`)
                          .join(" · ") || "—"}
                      </p>
                    </div>
                  )}
                </>
              )}
            </article>
          </section>
        </div>

        {/* ── History ── */}
        <section className={styles.historySection}>
          <div className={styles.historyHeader}>
            <h3 className={styles.historyTitle}>
              🕘 Riwayat Deteksi
              <span className={styles.historyCount}>{history.length}</span>
            </h3>
            {history.length > 0 && (
              <button
                className={styles.btnClearHistory}
                onClick={() => setHistory([])}
                type="button"
              >
                Hapus
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <p className={styles.historyEmpty}>Belum ada riwayat deteksi</p>
          ) : (
            <div className={styles.historyScroll}>
              {history.map((entry) => (
                <div
                  className={styles.historyCard}
                  key={entry.id}
                  onClick={() => loadHistoryEntry(entry)}
                >
                  <div className={styles.historyThumb}>
                    <Image
                      alt="History thumbnail"
                      className={styles.historyThumbImg}
                      fill
                      src={entry.thumbnail}
                      unoptimized
                    />
                  </div>
                  <div className={styles.historyMeta}>
                    <p className={styles.historyMetaCount}>{entry.count} objek</p>
                    <p className={styles.historyMetaTime}>{formatTime(entry.timestamp)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Footer ── */}
        <footer className={styles.footer}>
          Endpoint: <code>{predictEndpoint}</code> · Mode: {mode}
        </footer>
      </main>
    </div>
  );
}
