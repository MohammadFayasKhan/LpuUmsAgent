/*
 * ONEE Microphone Permission Request Runtime
 *
 * Dedicated top-level extension page to reliably prompt the browser
 * for microphone access, bypassing Chrome's side-panel permission restriction.
 */

async function initPermissionPage() {
  const statusBox = document.getElementById('status-box')!;
  const statusText = document.getElementById('status-text')!;
  const enableBtn = document.getElementById('enable-btn')!;
  const guideBox = document.getElementById('guide-box')!;

  const setSuccess = () => {
    statusBox.className = 'status-box status-success';
    statusText.textContent = '✅ Microphone Connected! Returning to ONEE...';
    enableBtn.textContent = 'Access Granted';
    (enableBtn as HTMLButtonElement).disabled = true;
    enableBtn.style.opacity = '0.6';
    guideBox.classList.add('hidden');

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'ONEE_MIC_PERMISSION_GRANTED' }).catch(() => {});
    }

    setTimeout(() => {
      window.close();
    }, 1200);
  };

  const setError = (err: any) => {
    statusBox.className = 'status-box status-error';
    statusText.textContent = '❌ Microphone access was dismissed or blocked';
    guideBox.classList.remove('hidden');
    console.warn('[ONEE Permission] Mic request error:', err);
  };

  const requestMicrophone = async () => {
    try {
      statusBox.className = 'status-box status-prompt';
      statusText.textContent = 'Requesting access... Click "Allow" in browser prompt';

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setSuccess();
    } catch (err: any) {
      setError(err);
    }
  };

  enableBtn.addEventListener('click', () => {
    requestMicrophone();
  });

  // Check if permission was already granted previously
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const perm = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      if (perm.state === 'granted') {
        setSuccess();
        return;
      }
    } catch {}
  }

  // Attempt prompt on initial load
  requestMicrophone();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPermissionPage);
} else {
  initPermissionPage();
}
