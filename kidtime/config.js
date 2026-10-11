// Cấu hình KidTime.
// Để trống supabaseUrl → chạy CHẾ ĐỘ DEMO (đồng bộ giữa các tab trên cùng thiết bị).
// Điền Supabase (xem supabase/schema.sql) → đồng bộ realtime thật giữa iPhone và laptop.
export const CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  // Laptop được coi là offline nếu không có heartbeat trong khoảng này.
  offlineAfterMs: { demo: 5000, cloud: 60000 },
  // Demo: 1 giây thật = 60 giây sử dụng, để dễ thấy đồng hồ chạy.
  demoSpeed: 60,
};
