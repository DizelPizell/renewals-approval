import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

export default api;

export const authApi = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
};

export const resourcesApi = {
  list: () => api.get('/resources'),
};

export const requestsApi = {
  list: () => api.get('/renewal-requests'),
  create: (resourceId: string) => api.post('/renewal-requests', { resourceId }),
  approve: (id: string) => api.post(`/renewal-requests/${id}/approve`),
  reject: (id: string, comment?: string) =>
    api.post(`/renewal-requests/${id}/reject`, { comment }),
  retry: (id: string) => api.post(`/renewal-requests/${id}/retry`),
  history: (id: string) => api.get(`/renewal-requests/${id}/history`),
};

export const statsApi = {
  get: (resourceId: string) => api.get(`/stats?resource_id=${resourceId}`),
};
