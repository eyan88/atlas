import { useEffect, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { METRIC_LABELS } from '../../types';
import styles from './HoverTooltip.module.css';

function formatValue(value: number, metric: string): string {
  if (metric.includes('oi') || metric === 'volume') {
    if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
    return value.toFixed(0);
  }
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  return value.toFixed(2);
}

const OFFSET_X = 16;
const OFFSET_Y = 16;

export function HoverTooltip() {
  const hoveredCell    = useAppStore((s) => s.hoveredCell);
  const selectedMetric = useAppStore((s) => s.selectedMetric);
  const tooltipRef     = useRef<HTMLDivElement>(null);

  // Position tooltip near cursor, but keep it within viewport
  useEffect(() => {
    if (!hoveredCell || !tooltipRef.current) return;
    const el = tooltipRef.current;
    const { mouseX, mouseY } = hoveredCell;
    const { innerWidth, innerHeight } = window;
    const rect = el.getBoundingClientRect();

    let left = mouseX + OFFSET_X;
    let top  = mouseY + OFFSET_Y;

    // Flip left if it overflows right edge
    if (left + rect.width > innerWidth - 8) {
      left = mouseX - rect.width - OFFSET_X;
    }
    // Flip up if it overflows bottom edge
    if (top + rect.height > innerHeight - 8) {
      top = mouseY - rect.height - OFFSET_Y;
    }

    el.style.left = `${left}px`;
    el.style.top  = `${top}px`;
  }, [hoveredCell]);

  if (!hoveredCell) return null;

  const isPositive = hoveredCell.value >= 0;
  const strikeLabel = Number.isInteger(hoveredCell.strike)
    ? hoveredCell.strike.toFixed(0)
    : hoveredCell.strike.toFixed(2).replace(/\.?0+$/, '');

  return (
    <div ref={tooltipRef} className={styles.tooltip}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.ticker}>{hoveredCell.ticker}</span>
        <span className={`${styles.sign} ${isPositive ? styles.positive : styles.negative}`}>
          {isPositive ? '▲ Long' : '▼ Short'}
        </span>
      </div>

      {/* Main value */}
      <div className={`${styles.value} ${isPositive ? styles.positive : styles.negative}`}>
        {isPositive ? '+' : ''}{formatValue(hoveredCell.value, selectedMetric)}
        <span className={styles.metric}>{METRIC_LABELS[selectedMetric]}</span>
      </div>

      {/* Details */}
      <div className={styles.details}>
        <div className={styles.row}>
          <span className={styles.label}>Strike</span>
          <span className={styles.val}>${strikeLabel}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Expiration</span>
          <span className={styles.val}>{hoveredCell.expiration}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Evolution</span>
          <span className={`${styles.val} ${hoveredCell.pctChange >= 0 ? styles.positive : styles.negative}`}>
            {hoveredCell.pctChange >= 0 ? '▲ +' : '▼ '}{hoveredCell.pctChange.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
}
