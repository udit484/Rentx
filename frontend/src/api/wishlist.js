const BASE_URL = '/api/wishlist';

async function requestWishlist(path, token, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || 'Wishlist request failed');
  }

  return data;
}

export function getWishlist(token) {
  return requestWishlist('', token);
}

export function addToWishlist(token, productId) {
  return requestWishlist(`/${productId}`, token, {
    method: 'POST',
  });
}

export function removeFromWishlist(token, productId) {
  return requestWishlist(`/${productId}`, token, {
    method: 'DELETE',
  });
}
