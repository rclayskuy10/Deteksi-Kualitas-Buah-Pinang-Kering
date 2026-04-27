"use client";

import styles from "./ResultCard.module.css";

type ResultCardProps = {
  className: string;
  confidence: number;
  index: number;
};

export default function ResultCard({ className, confidence, index }: ResultCardProps) {
  const pct = (confidence * 100).toFixed(1);
  const isLow = confidence < 0.5;
  const isMed = confidence >= 0.5 && confidence < 0.75;

  return (
    <li
      className={styles.card}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className={styles.top}>
        <span className={styles.name}>{className}</span>
        <span className={`${styles.pct} ${isLow ? styles.low : isMed ? styles.med : styles.high}`}>
          {pct}%
        </span>
      </div>
      <div className={styles.barTrack}>
        <div
          className={`${styles.barFill} ${isLow ? styles.fillLow : isMed ? styles.fillMed : styles.fillHigh}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </li>
  );
}
