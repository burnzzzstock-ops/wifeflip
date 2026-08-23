// Barcode scanning that works fully offline (the camera + decoding run on-device).
// Primary path: ZXing (vendored locally), which works in iPhone Safari and Android.
// Fast path: the browser's built-in BarcodeDetector when present (Chrome/Android).

let _zxingLoading = null;

function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (_zxingLoading) return _zxingLoading;
  _zxingLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "js/zxing.min.js";
    s.onload = () => (window.ZXing ? resolve(window.ZXing) : reject(new Error("ZXing missing")));
    s.onerror = () => reject(new Error("Failed to load scanner"));
    document.head.appendChild(s);
  });
  return _zxingLoading;
}

export function cameraSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// Opens the camera and scans for a barcode. Calls onResult(code) once on success.
// Returns a controller with .stop(). onError(err) fires if the camera can't open.
export async function startScanner(videoEl, onResult, onError) {
  if (!cameraSupported()) {
    onError && onError(new Error("no-camera"));
    return { stop() {} };
  }

  // Fast path: native BarcodeDetector (Android/Chrome).
  if ("BarcodeDetector" in window) {
    return startNativeScanner(videoEl, onResult, onError);
  }

  // Cross-platform path: ZXing (iPhone Safari included).
  let reader;
  let stopped = false;
  try {
    const ZXing = await loadZxing();
    reader = new ZXing.BrowserMultiFormatReader();
    reader.decodeFromVideoDevice(null, videoEl, (result, err) => {
      if (stopped) return;
      if (result) {
        stop();
        onResult(result.getText());
      }
      // err on each frame with no code is normal; ignore.
    });
  } catch (err) {
    onError && onError(err);
    return { stop() {} };
  }

  function stop() {
    stopped = true;
    try { reader && reader.reset(); } catch (_) {}
  }
  return { stop };
}

async function startNativeScanner(videoEl, onResult, onError) {
  let stream, raf, stopped = false;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    const detector = new window.BarcodeDetector({
      formats: formats.filter((f) =>
        ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"].includes(f)
      ),
    });
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    videoEl.srcObject = stream;
    videoEl.setAttribute("playsinline", "true");
    await videoEl.play();

    const tick = async () => {
      if (stopped) return;
      try {
        const codes = await detector.detect(videoEl);
        if (codes && codes.length) { stop(); onResult(codes[0].rawValue); return; }
      } catch (_) {}
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  } catch (err) {
    onError && onError(err);
    return { stop() {} };
  }

  function stop() {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (videoEl) videoEl.srcObject = null;
  }
  return { stop };
}
