async function request(path, token, options = {}) {
  if (!token) throw new Error('Please log in first.');
  const response = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
  return data;
}

export async function getNotifications(token) {
  const data = await request('/api/notifications', token);
  return Array.isArray(data.notifications) ? data.notifications : [];
}

export async function markNotificationRead(token, id) {
  return request(`/api/notifications/${encodeURIComponent(id)}/read`, token, {
    method: 'PATCH'
  });
}
