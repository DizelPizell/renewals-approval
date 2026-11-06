import React from 'react';
import type { RequestStatus } from '../types';

const CONFIG: Record<RequestStatus, { label: string; color: string; bg: string }> = {
  PENDING: { label: 'На согласовании', color: '#80A3FF', bg: 'rgba(128,163,255,0.12)' },
  REJECTED: { label: 'Отклонена', color: '#F87171', bg: 'rgba(248,113,113,0.12)' },
  PROCESSING: { label: 'Выполняется', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  COMPLETED: { label: 'Завершена', color: '#34D399', bg: 'rgba(52,211,153,0.12)' },
  NEEDS_ATTENTION: { label: 'Требует внимания', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
};

export default function StatusBadge({ status }: { status: RequestStatus }) {
  const { label, color, bg } = CONFIG[status] ?? {
    label: status,
    color: 'var(--secondary)',
    bg: 'rgba(169,184,185,0.1)',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '4px 10px',
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 600,
        color,
        background: bg,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}
