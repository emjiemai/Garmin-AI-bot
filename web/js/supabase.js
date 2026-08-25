// Live Supabase Sync (Garmin Uzbekistan)
export const SUPABASE_CONFIG = {
  url: "https://urfcwwyrpndynvwrusku.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyZmN3d3lycG5keW52d3J1c2t1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMTUyNDcsImV4cCI6MjA5Mzc5MTI0N30.uXge6vKE4ncIZqTB9m_ipD_rKiX27zV9k1-b0gmj2A0"
};

export async function fetchLiveProducts() {
  try {
    const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/products?select=*`, {
      headers: {
        'apikey': SUPABASE_CONFIG.anonKey,
        'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`
      }
    });
    if (!res.ok) throw new Error('Failed to fetch from Supabase');
    const data = await res.json();
    return data;
  } catch (err) {
    console.warn('Using bundled product dataset (offline fallback):', err);
    return null;
  }
}
