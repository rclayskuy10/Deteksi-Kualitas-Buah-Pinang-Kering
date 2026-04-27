"use client";

import { useId, useState } from "react";
import styles from "./SliderField.module.css";

type SliderFieldProps = {
  label: string;
  value: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: string) => void;
  unit?: string;
  hint?: string;
};

export default function SliderField({ label, value, min, max, step, onChange, unit, hint }: SliderFieldProps) {
  const id = useId();
  const [showHint, setShowHint] = useState(false);
  const numericValue = Number.parseFloat(value) || min;
  const percent = ((numericValue - min) / (max - min)) * 100;

  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor={id}>
          {label}
          {hint && (
            <button
              aria-label={`Info tentang ${label}`}
              className={styles.infoBtn}
              onClick={() => setShowHint((p) => !p)}
              type="button"
            >
              ?
            </button>
          )}
        </label>
        <span className={styles.valueDisplay}>
          {value}
          {unit && <span className={styles.unit}>{unit}</span>}
        </span>
      </div>
      {hint && showHint && (
        <div className={styles.hintBox}>
          <p className={styles.hintText}>{hint}</p>
        </div>
      )}
      <div className={styles.sliderWrap}>
        <input
          className={styles.slider}
          id={id}
          max={max}
          min={min}
          onChange={(e) => onChange(e.target.value)}
          step={step}
          style={{ "--fill": `${percent}%` } as React.CSSProperties}
          type="range"
          value={value}
        />
      </div>
      <div className={styles.range}>
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
