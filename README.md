
# Chuyển Đổi Sổ Phụ Ngân Hàng Thành Sổ Kế Toán

Ứng dụng này sử dụng AI (Gemini Pro) để xử lý sao kê ngân hàng và chuyển đổi chúng thành định dạng sổ kế toán tiêu chuẩn. Người dùng có thể tải lên file sao kê, cung cấp số dư đầu kỳ và nhận được một bảng dữ liệu đã được định dạng sẵn sàng cho các phần mềm kế toán.

## Tính năng chính

- **Upload đa định dạng**: Hỗ trợ các file PDF, DOCX, XLSX, TXT và các định dạng hình ảnh (PNG, JPG, ...).
- **OCR bằng AI**: Sử dụng Gemini Pro để trích xuất văn bản từ file hình ảnh với độ chính xác cao, đặc biệt với các tài liệu tài chính.
- **Phân tích thông minh**: AI tự động phân tích văn bản thô, nhận diện thông tin tài khoản, số dư, và bóc tách các giao dịch (bao gồm cả phí và thuế GTGT một cách riêng biệt).
- **Đối chiếu tự động**: Hệ thống tự động tính toán và so sánh số dư cuối kỳ với số dư trên sao kê, đưa ra cảnh báo nếu có sự chênh lệch.
- **Chỉnh sửa linh hoạt**: Người dùng có thể chỉnh sửa trực tiếp trên bảng kết quả bằng cách gõ, ra lệnh giọng nói, hoặc tương tác với Trợ lý AI.
- **Trợ lý AI tương tác**: Chat với AI để truy vấn thông tin, ra lệnh chỉnh sửa, hoặc thêm giao dịch mới (hỗ trợ cả việc dán hình ảnh/văn bản).
- **Xuất dữ liệu**: Dễ dàng sao chép dữ liệu ra clipboard (định dạng TSV), tải về dưới dạng file CSV, hoặc mở trong một trang HTML mới để xem và in.

## Hướng dẫn triển khai lên Vercel

Bạn có thể đưa ứng dụng này lên mạng một cách miễn phí và dễ dàng bằng Vercel.

**Yêu cầu:**
- Một tài khoản [GitHub](https://github.com/).
- Một tài khoản [Vercel](https://vercel.com/), có thể đăng nhập bằng tài khoản GitHub.

**Các bước thực hiện:**

### Bước 1: Đưa mã nguồn lên GitHub

1.  Tạo một kho chứa (repository) mới trên GitHub.
2.  Trên máy tính của bạn, dùng các lệnh `git` để đẩy toàn bộ mã nguồn của dự án này (bao gồm các file vừa được cập nhật) lên kho chứa đó.

### Bước 2: Tạo dự án trên Vercel

1.  Đăng nhập vào Vercel.
2.  Trên trang Dashboard, chọn **"Add New..."** -> **"Project"**.
3.  Ở phần **"Import Git Repository"**, tìm và chọn kho chứa GitHub bạn vừa tạo ở Bước 1.
4.  Vercel sẽ tự động nhận diện đây là một ứng dụng web tĩnh. Bạn không cần thay đổi bất kỳ cài đặt Build & Development nào. Chỉ cần giữ nguyên các thiết lập mặc định.
5.  Mở mục **"Environment Variables"** (Biến môi trường).
6.  Thêm một biến môi trường mới:
    -   **Name**: `API_KEY`
    -   **Value**: Dán khóa API Gemini của bạn vào đây.
7.  Nhấn nút **"Deploy"**.

Vercel sẽ tự động build và triển khai website của bạn. Sau vài phút, bạn sẽ có một đường link công khai cho ứng dụng của mình.
