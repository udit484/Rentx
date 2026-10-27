export async function getMyBookings(token) {
  if (!token) {
    throw new Error('Please log in to view your rentals.');
  }

  const response = await fetch('/api/bookings', {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? 'Your session has expired. Please log in again.'
        : `Could not load bookings (HTTP ${response.status}).`
    );
  }

  const data = await response.json();
  return Array.isArray(data.items) ? data.items : data.bookings || data;
}

export async function createBooking(token, {
  product_id,
  start_date,
  end_date
}) {
  if (!token) {
    throw new Error('Please log in before booking.');
  }

  const response = await fetch('/api/bookings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      product_id,
      start_date,
      end_date
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || `Booking failed (HTTP ${response.status})`);
  }

  return data;
}

export async function getOwnerBookings(token) {
if (!token) {
throw new Error('Please log in as an owner.');
}

const response = await fetch('/api/owner/bookings', {
headers: {
Authorization: `Bearer ${token}`
}
});

const data = await response.json().catch(() => ({}));

if (!response.ok) {
throw new Error(
data.message || `Could not load owner bookings (HTTP ${response.status})`
);
}

return Array.isArray(data.items) ? data.items : [];
}

export async function decideBooking(token, bookingId, decision) {
if (!token) {
throw new Error('Please log in as an owner.');
}

if (!['approve', 'reject'].includes(decision)) {
throw new Error('Invalid booking decision.');
}

const response = await fetch(`/api/bookings/${bookingId}/decision`, {
method: 'PATCH',
headers: {
'Content-Type': 'application/json',
Authorization: `Bearer ${token}`
},
body: JSON.stringify({ decision })
});

const data = await response.json().catch(() => ({}));

if (!response.ok) {
throw new Error(
data.message || `Could not update booking (HTTP ${response.status})`
);
}

return data;
}

export async function cancelBooking(token, bookingId) {
  if (!token) throw new Error('Please log in to cancel a booking.');
  const response = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/cancel`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `Could not cancel booking (${response.status})`);
  }
  return data;
}
