async function request(token, method, body) {
  if (!token) throw new Error('Please log in to manage your profile.');
  const response = await fetch('/api/users/me', {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `Profile request failed (${response.status})`);
  return data.profile || data.user || data;
}

export const getMyProfile = token => request(token, 'GET');
export const updateMyProfile = (token, fields) => request(token, 'PATCH', fields);
