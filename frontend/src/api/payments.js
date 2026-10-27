async function request(path, token, options = {}) {
  if (!token) throw new Error('Please log in to view payments.');
  const response = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Payment request failed (${response.status})`);
  return data;
}

export async function getPaymentHistory(token) {
  const data = await request('/api/payments', token);
  return Array.isArray(data.payments) ? data.payments : [];
}

/*
 * This endpoint is a simulation only; it does not charge real money.
 * The caller must explicitly choose "success" or "failure".
 */
export async function simulatePayment(token, bookingId, outcome, idempotencyKey) {
  if (!['success', 'failure'].includes(outcome)) {
    throw new Error('Choose a simulation outcome.');
  }
  return request('/api/payments', token, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      booking_id: Number(bookingId),
      outcome,
      idempotency_key: idempotencyKey
    })
  });
}
