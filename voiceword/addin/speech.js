// Nhận dạng giọng nói. Bản đầu dùng Web Speech API (có trong Word chạy trên Edge/Chrome).
// Nếu môi trường không hỗ trợ (một số bản Word desktop), giao diện chuyển sang ô nhập chữ;
// bước sau sẽ thêm Azure Speech / FPT.AI qua máy chủ trung gian (xem README).

export function createRecognizer({ lang = 'vi-VN', onInterim, onFinal, onState, onError }) {
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!SR) return { supported: false, start() {}, stop() {} };

  let rec = null;
  let wanted = false;

  const make = () => {
    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
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
          ? 'Chưa được cấp quyền dùng micro. Hãy cho phép micro rồi thử lại.'
          : e.error === 'network' ? 'Mất kết nối tới dịch vụ nhận dạng giọng nói.' : `Lỗi nhận dạng: ${e.error}`,
      );
    };
    // Trình duyệt tự dừng sau một lúc im lặng → tự bật lại nếu người dùng vẫn đang nghe.
    r.onend = () => {
      onInterim?.('');
      if (wanted) { try { r.start(); return; } catch { /* rơi xuống dừng hẳn */ } }
      onState?.(false);
    };
    return r;
  };

  return {
    supported: true,
    start() {
      wanted = true;
      rec = rec || make();
      try { rec.start(); onState?.(true); } catch { /* đang chạy rồi */ }
    },
    stop() {
      wanted = false;
      rec?.stop();
    },
  };
}
