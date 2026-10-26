// Apply the saved theme before first paint without an inline script, preserving
// the local server's script-src 'self' Content Security Policy.
try {
  const preference = localStorage.getItem('zx-theme') || 'system';
  const dark = preference === 'dark' || (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
} catch { /* React will apply the system theme when storage is unavailable. */ }
