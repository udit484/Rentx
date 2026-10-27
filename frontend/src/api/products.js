export async function getProducts({
  q = '',
  city = 'Noida',
  category = '',
  page = 1,
  limit = 10
} = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });

  if (q.trim()) params.set('q', q.trim());
  if (city.trim()) params.set('city', city.trim());
  if (category.trim()) params.set('category', category.trim());

  const response = await fetch(
    `/api/products?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error(`Product API failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  return data;
}
