import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNotifications, markNotificationRead } from '../notifications';
import { getMyProfile, updateMyProfile } from '../profile';
import { getPaymentHistory, simulatePayment } from '../payments';
import { cancelBooking, getMyBookings } from '../bookings';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

describe('Notifications API', () => {
  it('requires a token', async () => {
    await expect(getNotifications('')).rejects.toThrow(/log in/i);
  });

  it('returns notifications and sends the bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ notifications: [{ id: 7, message: 'Test' }] })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getNotifications('test-token')).resolves.toEqual([
      { id: 7, message: 'Test' }
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token');
  });

  it('marks a notification as read with PATCH', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    await markNotificationRead('token', 'n/1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/n%2F1/read');
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
  });
});

describe('Profile API', () => {
  it('loads the current profile', async () => {
    const profile = { city: 'Noida', bio: 'Renter' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ profile })));

    await expect(getMyProfile('token')).resolves.toEqual(profile);
  });

  it('sends profile updates using PATCH JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ profile: { city: 'Gurugram' } }));
    vi.stubGlobal('fetch', fetchMock);

    await updateMyProfile('token', { city: 'Gurugram' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/users/me');
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(options.body)).toEqual({ city: 'Gurugram' });
    expect(options.headers.Authorization).toBe('Bearer token');
  });
});

describe('Payments API', () => {
  it('returns payment history', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockResponse({ payments: [{ id: 2, status: 'success' }] })
    ));

    await expect(getPaymentHistory('token')).resolves.toEqual([
      { id: 2, status: 'success' }
    ]);
  });

  it('rejects invalid simulation outcomes before making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(simulatePayment('token', 5, 'real-charge', 'idempotency-key'))
      .rejects.toThrow(/simulation outcome/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts an explicitly selected simulation outcome', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ status: 'success' }));
    vi.stubGlobal('fetch', fetchMock);

    await simulatePayment('token', 5, 'success', 'rentx-test-key-123');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/payments');
    expect(options.method).toBe('POST');
    expect(options.headers['Idempotency-Key']).toBe('rentx-test-key-123');
    expect(JSON.parse(options.body)).toEqual({
      booking_id: 5,
      outcome: 'success',
      idempotency_key: 'rentx-test-key-123'
    });
  });
});

describe('Bookings API', () => {
  it('requires a token to list bookings', async () => {
    await expect(getMyBookings('')).rejects.toThrow(/log in/i);
  });

  it('cancels a booking using PATCH', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ status: 'cancelled' }));
    vi.stubGlobal('fetch', fetchMock);

    await cancelBooking('token', 42);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/bookings/42/cancel');
    expect(options.method).toBe('PATCH');
    expect(options.headers.Authorization).toBe('Bearer token');
  });

  it('reports backend errors for failed cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockResponse({ message: 'Booking cannot be cancelled' }, 409)
    ));

    await expect(cancelBooking('token', 42)).rejects.toThrow('Booking cannot be cancelled');
  });
});
