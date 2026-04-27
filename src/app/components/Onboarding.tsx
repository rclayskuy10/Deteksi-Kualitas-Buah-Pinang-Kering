"use client";

import { useState } from "react";
import styles from "./Onboarding.module.css";

type Step = {
  emoji: string;
  title: string;
  description: string;
  tip: string;
};

const STEPS: Step[] = [
  {
    emoji: "👋",
    title: "Selamat Datang di Vision Lab",
    description:
      "Aplikasi ini menggunakan model YOLOv8 untuk mendeteksi objek dalam gambar secara otomatis. Berikut penjelasan singkat tentang setiap parameter yang ada.",
    tip: "Klik 'Lanjut' untuk melihat penjelasan setiap parameter.",
  },
  {
    emoji: "🎯",
    title: "Confidence Threshold",
    description:
      "Confidence adalah tingkat keyakinan model bahwa objek benar-benar ada di area tertentu. Nilai 0 — 1 (0% — 100%). Jika di-set ke 0.25, maka hanya deteksi dengan keyakinan ≥ 25% yang ditampilkan.",
    tip: "Nilai rendah → lebih banyak objek terdeteksi (tapi bisa ada false-positive). Nilai tinggi → hanya deteksi paling akurat yang muncul.",
  },
  {
    emoji: "📐",
    title: "IoU NMS (Non-Maximum Suppression)",
    description:
      "IoU (Intersection over Union) mengukur seberapa besar overlap antara dua kotak deteksi. NMS menghapus kotak-kotak yang terlalu bertumpuk. Jika IoU kotak A dan B > threshold, kotak dengan skor lebih rendah akan dihapus.",
    tip: "Nilai rendah (misal 0.3) → lebih agresif menghapus duplikat. Nilai tinggi (misal 0.9) → memperbolehkan lebih banyak kotak yang overlap.",
  },
  {
    emoji: "📏",
    title: "Image Size",
    description:
      "Resolusi gambar saat diproses oleh model (dalam piksel). Model akan me-resize gambar ke ukuran ini sebelum mendeteksi. Ukuran standar: 640px.",
    tip: "Lebih besar (1280px) → detail lebih baik tapi lebih lambat. Lebih kecil (320px) → lebih cepat tapi kurang detail.",
  },
  {
    emoji: "⏱️",
    title: "Interval (Mode Realtime)",
    description:
      "Jeda waktu antar-frame yang dikirim ke model saat mode realtime webcam aktif. Contoh: 1000ms berarti 1 frame per detik.",
    tip: "Interval pendek → deteksi lebih sering tapi beban lebih berat. Interval panjang → lebih ringan tapi update lebih jarang.",
  },
  {
    emoji: "🚀",
    title: "Siap Menggunakan!",
    description:
      "Sekarang Anda sudah memahami semua parameter. Upload gambar atau gunakan webcam, atur parameter sesuai kebutuhan, lalu jalankan deteksi.",
    tip: "Anda bisa menekan tombol '?' di samping setiap parameter kapan saja untuk melihat penjelasan singkat.",
  },
];

type OnboardingProps = {
  onClose: () => void;
};

export default function Onboarding({ onClose }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog}>
        <div className={styles.header}>
          <span className={styles.iconLarge}>{current.emoji}</span>
          <h2 className={styles.title}>{current.title}</h2>
          <p className={styles.subtitle}>Panduan penggunaan Vision Lab</p>
        </div>

        <div className={styles.body}>
          {/* Dots */}
          <div className={styles.stepIndicator}>
            {STEPS.map((_, i) => (
              <span
                className={`${styles.dot} ${i === step ? styles.dotActive : ""} ${i < step ? styles.dotDone : ""}`}
                key={i}
              />
            ))}
          </div>

          {/* Content */}
          <div className={styles.stepCard} key={step}>
            <p className={styles.stepDesc}>{current.description}</p>
            <p className={styles.stepTip}>
              <span className={styles.stepTipLabel}>💡 Tips:</span>
              {current.tip}
            </p>
          </div>
        </div>

        <div className={styles.footer}>
          <span className={styles.stepCounter}>
            {step + 1} / {STEPS.length}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            {step > 0 && (
              <button
                className={styles.btnSecondary}
                onClick={() => setStep((p) => p - 1)}
                type="button"
              >
                ← Kembali
              </button>
            )}
            {isLast ? (
              <button className={styles.btnPrimary} onClick={onClose} type="button">
                Mulai Gunakan ✨
              </button>
            ) : (
              <button
                className={styles.btnPrimary}
                onClick={() => setStep((p) => p + 1)}
                type="button"
              >
                Lanjut →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
