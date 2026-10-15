// Ba nguồn giọng nói, cùng một giao diện { supported, start(), stop() }:
//   webspeech – nhận dạng có sẵn của trình duyệt (Word trên web với Edge/Chrome)
//   azure     – Azure Speech SDK (tiếng Việt tốt, tự thêm dấu câu); cần micro dùng được trong trang
//   relay     – nhận chữ từ "trang micro" mở bằng trình duyệt thường (cách chắc chắn cho Word desktop)

export const SOURCES = {
  webspeech: 'Nhận dạng của trình duyệt',
  azure: 'Azure Speech',
  relay: 'Trang micro riêng (Word desktop)',
};

// ---------- Web Speech API ----------
export function createWebSpeech({ lang = 'vi-VN', onInterim, onFinal, onState, onError }) {
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!SR) return { supported: false, start() {}, stop() {} };
  let rec = null;
  let wanted = false;
  let started = false;
  let watchdog = null;

  const make = () => {
    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) onFinal?.(res[0].transcript);
        else interim += res[0].transcript;
      }
      onInterim?.(interim);
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      wanted = false;
      onError?.(
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'Không dùng được micro ở đây. Hãy cho phép micro, hoặc chuyển sang “Trang micro riêng”.'
          : e.error === 'network' ? 'Mất kết nối tới dịch vụ nhận dạng giọng nói.'
            : e.error === 'language-not-supported' ? 'Trình duyệt này không nhận dạng được tiếng Việt. Hãy dùng Azure Speech.'
              : `Lỗi nhận dạng: ${e.error}`,
      );
    };
    r.onstart = () => { started = true; clearTimeout(watchdog); onState?.(true); };
    r.onend = () => {
      onInterim?.('');
      if (wanted && started) { try { r.start(); return; } catch { /* dừng hẳn */ } }
      wanted = false;
      onState?.(false);
    };
    return r;
  };

  return {
    supported: true,
    start() {
      wanted = true;
      rec = rec || make();
      started = false;
      try { rec.start(); } catch (e) { onError?.(`Không bật được micro: ${e.message}`); return; }
      // Một số môi trường (Word desktop) có API nhưng không bao giờ bắt đầu nghe và không báo lỗi.
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (started) return;
        wanted = false;
        try { rec.abort(); } catch { /* bỏ qua */ }
        onError?.('Micro không bật được ở đây. Trên Word desktop, hãy dùng “Trang micro riêng” (Cài đặt → nhập máy chủ).');
      }, 4000);
    },
    stop() { wanted = false; rec?.stop(); },
  };
}

// ---------- Azure Speech ----------
let sdkPromise = null;
function loadAzureSdk(src = new URL('./vendor/speech-sdk-1.50.0.min.js', import.meta.url).href) {
  if (globalThis.SpeechSDK) return Promise.resolve(globalThis.SpeechSDK);
  sdkPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(globalThis.SpeechSDK);
    s.onerror = () => { sdkPromise = null; reject(new Error('Không tải được thư viện Azure Speech')); };
    document.head.append(s);
  });
  return sdkPromise;
}

// getToken: async () => ({ token, region }) – lấy từ máy chủ trung gian, không bao giờ để khóa Azure ở trình duyệt.
export function createAzureSpeech({ lang = 'vi-VN', getToken, onInterim, onFinal, onState, onError }) {
  let rec = null;
  let refresh = null;
  let busy = false;

  const cleanup = () => {
    clearInterval(refresh);
    refresh = null;
    try { rec?.close(); } catch { /* bỏ qua */ }
    rec = null;
    onInterim?.('');
    onState?.(false);
  };

  return {
    supported: true,
    async start() {
      if (rec || busy) return;
      busy = true;
      try {
        const SDK = await loadAzureSdk();
        const { token, region } = await getToken();
        const cfg = SDK.SpeechConfig.fromAuthorizationToken(token, region);
        cfg.speechRecognitionLanguage = lang;
        rec = new SDK.SpeechRecognizer(cfg, SDK.AudioConfig.fromDefaultMicrophoneInput());
        rec.recognizing = (_, e) => onInterim?.(e.result.text);
        rec.recognized = (_, e) => {
          onInterim?.('');
          if (e.result.reason === SDK.ResultReason.RecognizedSpeech && e.result.text) onFinal?.(e.result.text);
        };
        rec.canceled = (_, e) => {
          if (e.reason === SDK.CancellationReason.Error) {
            const micIssue = /microphone|getUserMedia|Permission|NotAllowed|NotFound/i.test(e.errorDetails || '');
            onError?.(micIssue
              ? 'Không mở được micro ở đây. Hãy chuyển sang “Trang micro riêng” trong Cài đặt.'
              : `Azure Speech báo lỗi: ${e.errorDetails}`);
          }
          cleanup();
        };
        // Mã Azure hết hạn sau 10 phút → làm mới mỗi 9 phút.
        refresh = setInterval(async () => {
          try { if (rec) rec.authorizationToken = (await getToken()).token; } catch { /* lần sau thử lại */ }
        }, 9 * 60 * 1000);
        const started = rec;
        await new Promise((resolve, reject) => started.startContinuousRecognitionAsync(resolve, (err) => reject(new Error(String(err)))));
        if (rec === started) onState?.(true); // có thể đã bị hủy (mất mạng, sai mã) trong lúc khởi động
      } catch (e) {
        onError?.(/microphone|getUserMedia|Permission|NotAllowed/i.test(e.message)
          ? 'Không mở được micro ở đây. Hãy chuyển sang “Trang micro riêng” trong Cài đặt.'
          : e.message);
        cleanup();
      } finally {
        busy = false;
      }
    },
    stop() {
      if (!rec) return;
      const r = rec;
      r.stopContinuousRecognitionAsync(cleanup, cleanup);
    },
  };
}

// ---------- Nhận chữ từ trang micro (long-polling qua máy chủ) ----------
// Không dùng luồng SSE: một số đường hầm/proxy (Cloudflare) giữ dữ liệu lại nên chữ không tới Word.
// Long-polling đi qua được mọi proxy: hỏi máy chủ, máy chủ trả lời ngay khi có chữ mới (chờ tối đa ~25 giây).
export function createRelayListener({ serverUrl, appToken, pair, onInterim, onFinal, onMic, onConnected, onError }) {
  let active = false;
  let ctrl = null;

  const handle = (ev) => {
    if (ev.type === 'mic') onMic?.(ev.on);
    else if (ev.final) { onInterim?.(''); onFinal?.(ev.text); } else onInterim?.(ev.text);
  };

  async function loop() {
    let after = -1;
    let connected = false;
    while (active) {
      try {
        ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 40000);
        const res = await fetch(`${serverUrl}/api/pair/${pair}/poll?after=${after}&t=${Date.now()}`, {
          headers: { Authorization: `Bearer ${appToken}` }, signal: ctrl.signal, cache: 'no-store',
        });
        clearTimeout(timer);
        if (res.status === 404) { onError?.('Phiên ghép đã hết hạn. Bấm micro để ghép lại.', true); active = false; break; }
        if (!res.ok) throw new Error(`Máy chủ trả lỗi ${res.status}`);
        const { events = [], last } = await res.json();
        if (!connected) { connected = true; onConnected?.(true); }
        // Chỉ xử lý chữ tạm mới nhất, nhưng mọi câu hoàn chỉnh và trạng thái micro theo đúng thứ tự.
        const lastInterim = [...events].reverse().find((e) => e.type === 'text' && !e.final);
        for (const ev of events) if (ev.type === 'mic' || ev.final || ev === lastInterim) handle(ev);
        after = typeof last === 'number' ? last : after;
      } catch (e) {
        if (!active) break;
        if (e.name !== 'AbortError') {
          if (connected) { connected = false; onConnected?.(false); }
          onError?.(e instanceof TypeError ? 'Mất kết nối máy chủ, đang thử lại…' : e.message, false);
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }
    if (connected) onConnected?.(false);
  }

  return {
    supported: true,
    start() { if (!active) { active = true; loop(); } },
    stop() { active = false; ctrl?.abort(); },
  };
}
