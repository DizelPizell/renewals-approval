import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { requestsApi, resourcesApi } from '../api/client';
import type { RenewalRequest, RequestHistory, Resource, User } from '../types';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';

function formatMoney(minor: string, currency: string) {
  const amount = parseInt(minor) / 100;
  return (
    amount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
    ' ' +
    currency
  );
}

// String-only date formatter — no new Date(), timezone-safe
function formatDate(d: string): string {
  if (!d) return '—';
  const s = d.substring(0, 10);
  const [y, m, day] = s.split('-');
  if (!y || !m || !day) return s;
  return `${day}.${m}.${y}`;
}

// Timestamp formatter: extracts date/time from ISO string without new Date()
function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const date = iso.substring(0, 10); // YYYY-MM-DD
  const time = iso.substring(11, 16); // HH:mm
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}, ${time}`;
}

function getUser(): User | null {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
}

export default function RenewalsPage() {
  const navigate = useNavigate();
  const user = getUser();

  const [resources, setResources] = useState<Resource[]>([]);
  const [requests, setRequests] = useState<RenewalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [createModal, setCreateModal] = useState(false);
  const [historyModal, setHistoryModal] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [creating, setCreating] = useState(false);
  const [createResourceId, setCreateResourceId] = useState('');
  const [rejectComment, setRejectComment] = useState('');
  const [history, setHistory] = useState<RequestHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 480);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [resRes, reqRes] = await Promise.all([
        resourcesApi.list(),
        requestsApi.list(),
      ]);
      setResources(resRes.data);
      setRequests(reqRes.data);
      setError('');
    } catch (err: any) {
      if (err.response?.status !== 401) {
        setError('Ошибка загрузки данных');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 480);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  function logout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    navigate('/login', { replace: true });
  }

  const canCreate = user?.roles.includes('create');
  const canApprove = user?.roles.includes('approve');

  const totalCount = requests.length;
  const pendingCount = requests.filter((r) => r.status === 'PENDING').length;
  const processingCount = requests.filter((r) => r.status === 'PROCESSING').length;
  const needsAttentionCount = requests.filter((r) => r.status === 'NEEDS_ATTENTION').length;

  const resourceMap = Object.fromEntries(resources.map((r) => [r.id, r]));

  async function handleCreate() {
    setActionError('');
    setCreating(true);
    try {
      await requestsApi.create(createResourceId);
      setCreateModal(false);
      setCreateResourceId('');
      await load();
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Ошибка создания заявки';
      setActionError(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setCreating(false);
    }
  }

  async function handleApprove(id: string) {
    setActionError('');
    try {
      await requestsApi.approve(id);
      await load();
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Ошибка одобрения';
      alert(Array.isArray(msg) ? msg[0] : msg);
    }
  }

  async function handleReject() {
    if (!rejectModal) return;
    setActionError('');
    try {
      await requestsApi.reject(rejectModal, rejectComment || undefined);
      setRejectModal(null);
      setRejectComment('');
      await load();
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Ошибка отклонения';
      setActionError(Array.isArray(msg) ? msg[0] : msg);
    }
  }

  async function handleRetry(id: string) {
    try {
      await requestsApi.retry(id);
      await load();
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Ошибка повтора';
      alert(Array.isArray(msg) ? msg[0] : msg);
    }
  }

  async function openHistory(id: string) {
    setHistoryModal(id);
    setHistoryLoading(true);
    try {
      const res = await requestsApi.history(id);
      setHistory(res.data);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  function canApproveRequest(req: RenewalRequest) {
    return canApprove && user?.id !== req.createdById;
  }

  function renderActions(req: RenewalRequest) {
    const approvable = req.status === 'PENDING' && canApproveRequest(req);
    const rejectable = req.status === 'PENDING' && canApproveRequest(req);
    const retryable = req.status === 'NEEDS_ATTENTION' && canApproveRequest(req);

    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {approvable && (
          <button className="btn-success" onClick={() => handleApprove(req.id)}>
            Одобрить
          </button>
        )}
        {rejectable && (
          <button className="btn-danger" onClick={() => { setRejectModal(req.id); setActionError(''); }}>
            Отклонить
          </button>
        )}
        {retryable && (
          <button className="btn-warn" onClick={() => handleRetry(req.id)}>
            Повторить
          </button>
        )}
        <button className="btn-secondary" onClick={() => openHistory(req.id)} style={{ fontSize: 12 }}>
          История
        </button>
      </div>
    );
  }

  const workspaceLabel =
    user?.workspaceId === 'alpha' ? 'Alpha' :
    user?.workspaceId === 'beta' ? 'Beta' :
    user?.workspaceId;

  // UTC-safe +30 days preview in create modal
  function computeNewDate(expiryDate: string): string {
    const [y, m, d] = expiryDate.substring(0, 10).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 30)).toISOString().substring(0, 10);
  }

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 48 }}>
      {/* Top bar: username + logout */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '16px 32px', gap: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: 'var(--secondary)' }}>{user?.username}</span>
        <button
          className="btn-secondary"
          onClick={logout}
          style={{ fontSize: 13, padding: '6px 14px' }}
        >
          Выйти
        </button>
      </div>

      <div className="container">
        {/* Page heading */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.2 }}>Заявки на продление</h1>
          <p style={{ fontSize: 14, color: 'var(--secondary)', marginTop: 6 }}>
            Рабочее пространство: {workspaceLabel}
          </p>
        </div>

        {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

        {/* Main card */}
        <div className="card">
          {/* Counters row */}
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 20 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>
              Всего: {totalCount}
            </span>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>
              Ожидают: {pendingCount}
            </span>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--yellow)' }}>
              Выполняется: {processingCount}
            </span>
            {needsAttentionCount > 0 && (
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--red)' }}>
                Требует внимания: {needsAttentionCount}
              </span>
            )}
          </div>

          <div style={{ borderTop: '1px solid rgba(169,184,185,0.12)', marginBottom: 0 }} />

          {/* Table / cards */}
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--secondary)', padding: 32 }}>Загрузка...</div>
          ) : !isMobile ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ресурс</th>
                  <th>Срок</th>
                  <th>Стоимость</th>
                  <th>Статус</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {resources.map((res) => {
                  const activeReq = requests.find(
                    (r) => r.resourceId === res.id && ['PENDING', 'PROCESSING', 'NEEDS_ATTENTION'].includes(r.status),
                  );
                  const latestReq = requests.find((r) => r.resourceId === res.id);
                  const displayReq = activeReq || latestReq;

                  return (
                    <tr key={res.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{res.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--secondary)' }}>{res.id}</div>
                      </td>
                      <td>{formatDate(res.expiryDate)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatMoney(res.amountMinor, res.currency)}</td>
                      <td>
                        {displayReq ? <StatusBadge status={displayReq.status} /> : (
                          <span style={{ color: 'var(--secondary)', fontSize: 13 }}>—</span>
                        )}
                      </td>
                      <td>{displayReq ? renderActions(displayReq) : null}</td>
                    </tr>
                  );
                })}
                {resources.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: 'var(--secondary)', padding: 32 }}>
                      Нет ресурсов
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            /* Mobile cards */
            <div style={{ paddingTop: 8 }}>
              {resources.map((res) => {
                const activeReq = requests.find(
                  (r) => r.resourceId === res.id && ['PENDING', 'PROCESSING', 'NEEDS_ATTENTION'].includes(r.status),
                );
                const latestReq = requests.find((r) => r.resourceId === res.id);
                const displayReq = activeReq || latestReq;

                return (
                  <div key={res.id} className="mobile-card">
                    <div className="mobile-card-row">
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{res.name}</div>
                        <div style={{ color: 'var(--secondary)', fontSize: 12 }}>{res.id}</div>
                      </div>
                      {displayReq && <StatusBadge status={displayReq.status} />}
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">Срок</span>
                      <span style={{ fontSize: 14 }}>{formatDate(res.expiryDate)}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">Стоимость</span>
                      <span style={{ fontSize: 14 }}>{formatMoney(res.amountMinor, res.currency)}</span>
                    </div>
                    {displayReq && (
                      <div style={{ marginTop: 8 }}>{renderActions(displayReq)}</div>
                    )}
                  </div>
                );
              })}
              {resources.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--secondary)', padding: 24 }}>
                  Нет ресурсов
                </div>
              )}
            </div>
          )}

          {/* Footer divider + create button */}
          {!loading && (
            <>
              <div style={{ borderTop: '1px solid rgba(169,184,185,0.12)', margin: '8px 0 20px' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
                {canCreate && (
                  <button
                    className="btn-create-pill"
                    onClick={() => { setCreateModal(true); setCreateResourceId(''); setActionError(''); }}
                  >
                    Создать заявку
                  </button>
                )}
                <span style={{ fontSize: 13, color: 'var(--secondary)' }}>
                  Данные обновляются каждые 5 секунд
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Create request modal */}
      {createModal && (
        <Modal title="Создать заявку" onClose={() => setCreateModal(false)}>
          <p style={{ color: 'var(--secondary)', marginBottom: 16, fontSize: 14 }}>
            Продление на +30 дней от текущего срока
          </p>
          <label style={{ display: 'block', marginBottom: 16 }}>
            <span style={{ display: 'block', marginBottom: 6, fontSize: 13, color: 'var(--secondary)' }}>
              Ресурс
            </span>
            <select
              value={createResourceId}
              onChange={(e) => setCreateResourceId(e.target.value)}
              autoFocus
            >
              <option value="">Выберите ресурс...</option>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} — до {formatDate(r.expiryDate)}
                </option>
              ))}
            </select>
          </label>

          {createResourceId && (() => {
            const res = resourceMap[createResourceId];
            if (!res) return null;
            const newDate = computeNewDate(res.expiryDate);
            return (
              <div
                style={{
                  background: 'rgba(128,163,255,0.08)',
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 16,
                  fontSize: 13,
                }}
              >
                <div>Текущий срок: <strong>{formatDate(res.expiryDate)}</strong></div>
                <div>Новый срок: <strong style={{ color: 'var(--accent)' }}>{formatDate(newDate)}</strong></div>
                <div>Стоимость: <strong>{formatMoney(res.amountMinor, res.currency)}</strong></div>
              </div>
            );
          })()}

          {actionError && <div className="error-banner">{actionError}</div>}

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button
              className="btn-primary"
              onClick={handleCreate}
              disabled={!createResourceId || creating}
              style={{ flex: 1 }}
            >
              {creating ? 'Создание...' : 'Создать'}
            </button>
            <button className="btn-secondary" onClick={() => setCreateModal(false)}>
              Отмена
            </button>
          </div>
        </Modal>
      )}

      {/* Reject modal */}
      {rejectModal && (
        <Modal title="Отклонить заявку" onClose={() => setRejectModal(null)}>
          <label style={{ display: 'block', marginBottom: 16 }}>
            <span style={{ display: 'block', marginBottom: 6, fontSize: 13, color: 'var(--secondary)' }}>
              Комментарий (необязательно)
            </span>
            <textarea
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              autoFocus
              style={{ resize: 'vertical', minHeight: 80 }}
            />
          </label>
          {actionError && <div className="error-banner">{actionError}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button className="btn-danger" onClick={handleReject} style={{ flex: 1 }}>
              Отклонить
            </button>
            <button className="btn-secondary" onClick={() => setRejectModal(null)}>
              Отмена
            </button>
          </div>
        </Modal>
      )}

      {/* History modal */}
      {historyModal && (
        <Modal title="История заявки" onClose={() => setHistoryModal(null)}>
          {historyLoading ? (
            <p style={{ color: 'var(--secondary)' }}>Загрузка...</p>
          ) : history.length === 0 ? (
            <p style={{ color: 'var(--secondary)' }}>История пуста</p>
          ) : (
            <div>
              {history.map((h, i) => (
                <div
                  key={h.id}
                  style={{
                    padding: '12px 0',
                    borderBottom: i < history.length - 1 ? '1px solid rgba(169,184,185,0.1)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    {h.fromStatus && (
                      <StatusBadge status={h.fromStatus as any} />
                    )}
                    {h.fromStatus && <span style={{ color: 'var(--secondary)', fontSize: 12 }}>→</span>}
                    <StatusBadge status={h.toStatus as any} />
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--secondary)', marginTop: 4 }}>
                    {h.actorUsername ?? 'система'}
                  </div>
                  {h.comment && (
                    <div style={{ fontSize: 13, color: 'var(--secondary)', marginTop: 2, fontStyle: 'italic' }}>
                      {h.comment}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--secondary)', marginTop: 4 }}>
                    {formatDateTime(h.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
