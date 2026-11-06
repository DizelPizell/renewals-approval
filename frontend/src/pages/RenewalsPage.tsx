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

function formatDate(d: string) {
  if (!d) return '—';
  return d.substring(0, 10);
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

  // Modal states
  const [createModal, setCreateModal] = useState(false);
  const [historyModal, setHistoryModal] = useState<string | null>(null); // request id
  const [rejectModal, setRejectModal] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [creating, setCreating] = useState(false);
  const [createResourceId, setCreateResourceId] = useState('');
  const [rejectComment, setRejectComment] = useState('');
  const [history, setHistory] = useState<RequestHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 600);

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
    const handler = () => setIsMobile(window.innerWidth <= 600);
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
  const processingCount = requests.filter(
    (r) => r.status === 'PROCESSING' || r.status === 'NEEDS_ATTENTION',
  ).length;

  // resource map
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

  const workspaceLabel = user?.workspaceId === 'alpha' ? 'Alpha' : user?.workspaceId === 'beta' ? 'Beta' : user?.workspaceId;

  return (
    <div style={{ paddingBottom: 48 }}>
      {/* Header */}
      <div style={{ background: 'var(--card)', borderBottom: '1px solid rgba(169,184,185,0.1)', marginBottom: 32 }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 0' }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700 }}>Заявки на продление</h1>
            <span style={{ fontSize: 13, color: 'var(--secondary)' }}>
              Рабочее пространство: <strong style={{ color: 'var(--accent)' }}>{workspaceLabel}</strong>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--secondary)' }}>{user?.username}</span>
            <button className="btn-secondary" onClick={logout} style={{ fontSize: 13, padding: '6px 14px' }}>
              Выйти
            </button>
          </div>
        </div>
      </div>

      <div className="container">
        {/* Stats */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
          {[
            { label: 'Всего', value: totalCount, color: 'var(--text)' },
            { label: 'Ожидают', value: pendingCount, color: 'var(--accent)' },
            { label: 'Выполняется', value: processingCount, color: 'var(--yellow)' },
          ].map(({ label, value, color }) => (
            <div key={label} className="card" style={{ flex: '1 1 140px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 700, color }}>{value}</div>
              <div style={{ fontSize: 13, color: 'var(--secondary)', marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Table header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Ресурсы и заявки</h2>
          {canCreate && (
            <button
              className="btn-primary"
              onClick={() => { setCreateModal(true); setCreateResourceId(''); setActionError(''); }}
            >
              + Создать заявку
            </button>
          )}
        </div>

        {loading && (
          <div style={{ textAlign: 'center', color: 'var(--secondary)', padding: 32 }}>Загрузка...</div>
        )}
        {error && <div className="error-banner">{error}</div>}

        {!loading && !isMobile && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ресурс</th>
                  <th>Срок</th>
                  <th>Стоимость</th>
                  <th>Статус заявки</th>
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
          </div>
        )}

        {/* Mobile cards */}
        {!loading && isMobile && (
          <div>
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
          </div>
        )}

        {/* All requests list (below resources) */}
        {!loading && requests.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Все заявки</h2>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ресурс</th>
                    <th>Новый срок</th>
                    <th className="hide-mobile">Создана</th>
                    <th>Статус</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((req) => (
                    <tr key={req.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{resourceMap[req.resourceId]?.name || req.resourceId}</div>
                        <div style={{ fontSize: 12, color: 'var(--secondary)' }}>
                          {req.oldDate} → {req.newDate}
                        </div>
                      </td>
                      <td>{formatDate(req.newDate)}</td>
                      <td className="hide-mobile" style={{ color: 'var(--secondary)', fontSize: 13 }}>
                        {new Date(req.createdAt).toLocaleDateString('ru-RU')}
                      </td>
                      <td><StatusBadge status={req.status} /></td>
                      <td>{renderActions(req)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
              style={{
                width: '100%',
                background: 'var(--bg)',
                border: '1px solid var(--secondary)',
                borderRadius: 8,
                color: 'var(--text)',
                padding: '10px 14px',
                fontSize: 15,
                outline: 'none',
                fontFamily: 'var(--font)',
              }}
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
            const d = new Date(res.expiryDate);
            d.setDate(d.getDate() + 30);
            const newDate = d.toISOString().substring(0, 10);
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
                <div>Новый срок: <strong style={{ color: 'var(--accent)' }}>{newDate}</strong></div>
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
              style={{
                width: '100%',
                background: 'var(--bg)',
                border: '1px solid var(--secondary)',
                borderRadius: 8,
                color: 'var(--text)',
                padding: '10px 14px',
                fontSize: 14,
                fontFamily: 'var(--font)',
                resize: 'vertical',
                minHeight: 80,
                outline: 'none',
              }}
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
                  {h.comment && (
                    <div style={{ fontSize: 13, color: 'var(--secondary)', marginTop: 4 }}>
                      {h.comment}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--secondary)', marginTop: 4 }}>
                    {new Date(h.createdAt).toLocaleString('ru-RU')}
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
