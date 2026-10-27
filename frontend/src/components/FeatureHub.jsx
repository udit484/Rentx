import React, { useEffect, useState } from 'react';
import { cancelBooking } from '../api/bookings';
import { getNotifications, markNotificationRead } from '../api/notifications';
import { getMyProfile, updateMyProfile } from '../api/profile';
import { getPaymentHistory, simulatePayment } from '../api/payments';

const panelStyle = {
  position: 'fixed', inset: 0, zIndex: 1000,
  background: 'rgba(15,23,42,.45)', display: 'grid',
  placeItems: 'center', padding: 16
};
const cardStyle = {
  background: '#fff', color: '#172033', borderRadius: 18,
  padding: 24, width: 'min(760px, 100%)', maxHeight: '85vh',
  overflow: 'auto', boxShadow: '0 20px 70px rgba(0,0,0,.2)'
};
const buttonStyle = {
  border: '1px solid #d8deea', borderRadius: 9,
  padding: '9px 12px', background: '#fff', cursor: 'pointer',
  margin: '4px'
};
const fieldStyle = {
  display: 'block', width: '100%', padding: 10,
  margin: '6px 0 14px', border: '1px solid #d8deea',
  borderRadius: 8, boxSizing: 'border-box'
};

export default function FeatureHub({
  section, token, user, onClose, notify,
  bookings = [], onBookingsChange = () => {}
}) {
  const [items, setItems] = useState([]);
  const [profile, setProfile] = useState({
    phone: '', bio: '', city: '', avatar_url: ''
  });
  const [payments, setPayments] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcomes, setOutcomes] = useState({});

  useEffect(() => {
    let alive = true;
    setError('');
    setItems([]);
    if (!token) {
      setError('Log in to access this section.');
      return () => { alive = false; };
    }

    const load = async () => {
      try {
        if (section === 'notifications') {
          const result = await getNotifications(token);
          if (alive) setItems(result);
        } else if (section === 'payments') {
          const result = await getPaymentHistory(token);
          if (alive) setPayments(result);
        } else if (section === 'settings') {
          const result = await getMyProfile(token);
          if (alive) setProfile({
            phone: result.phone || '',
            bio: result.bio || '',
            city: result.city || '',
            avatar_url: result.avatar_url || ''
          });
        }
      } catch (e) {
        if (alive) setError(e.message || 'Could not load this section.');
      }
    };
    load();
    return () => { alive = false; };
  }, [section, token]);

  const run = async action => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e.message || 'The action failed.');
    } finally {
      setBusy(false);
    }
  };

  const title = {
    rentals: 'My Rentals',
    payments: 'Payment History',
    settings: 'Profile Settings',
    notifications: 'Notifications'
  }[section] || 'RentX';

  const saveProfile = () => run(async () => {
    await updateMyProfile(token, profile);
    notify('Profile saved.');
  });

  const cancel = booking => {
    if (!window.confirm(`Cancel booking #${booking.id}?`)) return;
    run(async () => {
      await cancelBooking(token, booking.id);
      const response = await fetch('/api/bookings', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not refresh bookings.');
      onBookingsChange(Array.isArray(data.items) ? data.items : []);
      notify(`Booking #${booking.id} cancellation requested.`);
    });
  };

  const pay = booking => run(async () => {
    const outcome = outcomes[booking.id] || 'success';
    const key = `rentx-${booking.id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await simulatePayment(token, booking.id, outcome, key);
    setPayments(await getPaymentHistory(token));
    notify(`Payment simulation recorded as ${outcome}. No real money was charged.`);
  });

  const markRead = item => run(async () => {
    await markNotificationRead(token, item.id);
    setItems(old => old.map(n => String(n.id) === String(item.id)
      ? { ...n, is_read: true } : n));
  });

  return (
    <div style={panelStyle} onClick={onClose}>
      <section style={cardStyle} role="dialog" aria-modal="true"
        aria-label={title} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2 style={{ margin: '0 0 6px' }}>{title}</h2>
            <p style={{ marginTop: 0, color: '#64748b' }}>
              {user?.email || user?.name || 'Your RentX account'}
            </p>
          </div>
          <button style={buttonStyle} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}
        {busy && <p role="status">Saving…</p>}

        {section === 'rentals' && (
          !token ? <p>Log in to view your rentals.</p> :
          bookings.length === 0 ? <p>No bookings found.</p> :
          bookings.map(b => (
            <article key={b.id} style={{ borderTop: '1px solid #e5e7eb', padding: '14px 0' }}>
              <b>Booking #{b.id} · Product #{b.product_id}</b>
              <p>{b.start_date ? new Date(b.start_date).toLocaleString() : 'Start unavailable'}
                {' – '}{b.end_date ? new Date(b.end_date).toLocaleString() : 'End unavailable'}</p>
              <p>Status: <strong>{b.status || 'unknown'}</strong> · Rental amount: ₹{Number(b.rental_amount || 0).toLocaleString('en-IN')}</p>
              {['pending', 'confirmed'].includes(String(b.status).toLowerCase()) &&
                <button style={buttonStyle} disabled={busy} onClick={() => cancel(b)}>Cancel booking</button>}
            </article>
          ))
        )}

        {section === 'notifications' && (
          items.length === 0 ? <p>No notifications found.</p> :
          items.map(n => (
            <article key={n.id} style={{ borderTop: '1px solid #e5e7eb', padding: '12px 0' }}>
              <b>{n.title || n.type || 'Notification'}</b>
              <p>{n.message}</p>
              <small>{n.created_at ? new Date(n.created_at).toLocaleString() : ''}</small>
              {!n.is_read && <button style={buttonStyle} disabled={busy} onClick={() => markRead(n)}>Mark as read</button>}
              {n.is_read && <small> · Read</small>}
            </article>
          ))
        )}

        {section === 'payments' && (
          <>
            <p><strong>Simulation mode:</strong> no real payment is processed.</p>
            {payments.length === 0 ? <p>No payment records found.</p> :
              payments.map(p => (
                <article key={p.id} style={{ borderTop: '1px solid #e5e7eb', padding: '12px 0' }}>
                  <b>Payment #{p.id} · Booking #{p.booking_id}</b>
                  <p>Amount: {p.currency || 'INR'} {Number(p.amount || 0).toLocaleString('en-IN')} · Status: {p.status}</p>
                  <small>{p.created_at ? new Date(p.created_at).toLocaleString() : ''}</small>
                </article>
              ))}
            <h3>Simulate payment for a confirmed booking</h3>
            {bookings.filter(b => String(b.status).toLowerCase() === 'confirmed').map(b => (
              <article key={b.id} style={{ borderTop: '1px solid #e5e7eb', padding: '12px 0' }}>
                <b>Booking #{b.id}</b>
                <select style={buttonStyle} value={outcomes[b.id] || 'success'}
                  onChange={e => setOutcomes(old => ({ ...old, [b.id]: e.target.value }))}>
                  <option value="success">Simulate success</option>
                  <option value="failure">Simulate failure</option>
                </select>
                <button style={buttonStyle} disabled={busy} onClick={() => pay(b)}>Run simulation</button>
              </article>
            ))}
          </>
        )}

        {section === 'settings' && (
          <form onSubmit={e => { e.preventDefault(); saveProfile(); }}>
            <label>Phone<input style={fieldStyle} value={profile.phone}
              onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))} /></label>
            <label>City<input style={fieldStyle} value={profile.city}
              onChange={e => setProfile(p => ({ ...p, city: e.target.value }))} /></label>
            <label>Bio<textarea style={fieldStyle} rows="3" value={profile.bio}
              onChange={e => setProfile(p => ({ ...p, bio: e.target.value }))} /></label>
            <label>Avatar URL<input style={fieldStyle} type="url" value={profile.avatar_url}
              onChange={e => setProfile(p => ({ ...p, avatar_url: e.target.value }))} /></label>
            <button style={buttonStyle} type="submit" disabled={busy}>Save profile</button>
          </form>
        )}
      </section>
    </div>
  );
}
