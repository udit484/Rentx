export async function getOwnerProducts(token) {
  if (!token) throw new Error('Please log in as an owner.');

  const response = await fetch('/api/owner/products', {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || `Could not load listings (HTTP ${response.status})`);
  }

  return Array.isArray(data.items) ? data.items : [];
}

export async function updateOwnerProduct(token, productId, changes) {
  if (!token) throw new Error('Please log in as an owner.');

  const response = await fetch(`/api/products/${productId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(changes)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || `Could not update listing (HTTP ${response.status})`);
  }

  return data;
}
