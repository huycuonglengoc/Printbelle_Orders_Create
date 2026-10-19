# Printbelle Order Desk

Web app Node/Express nhỏ để đọc packing slip PDF, ghép artwork theo tên khách hàng, ánh xạ SPU/kích cỡ/màu và xuất file import order theo template Printbelle. Artwork được đưa lên Cloudflare R2 để dùng URL ổn định trong file Excel. UI dùng HTML/CSS/JS thuần để các phần có thể sửa độc lập, không cần frontend build pipeline.

## Chạy local

```bash
npm install
cp .env.example .env
npm test
npm start
```

Mở `http://localhost:3000`, chọn `input.pdf` và các file artwork trong cùng thư mục order. Tên artwork mẫu như `1_Stacey Wierman_0.png` sẽ được ghép với khách hàng `Stacey Wierman` trong PDF.

## Mapping trên giao diện

Mở trang cấu hình riêng tại `http://localhost:3000/settings` hoặc bấm **Cấu hình SPU** trên trang chính. Không cần đọc PDF trước và không cần chỉnh JSON thủ công:

- **Danh mục sản phẩm**: thêm tên hiển thị, mã SPU Printbelle, SKU prefix và các từ khóa xuất hiện trong PDF. Các giá trị ngăn cách bằng dấu phẩy và được dùng cho tự nhận diện. Ví dụ prefix `GF` sẽ khớp `GF-10`, `GF-20`.
- **Ánh xạ kích cỡ**: nhập SKU prefix hoặc mã sản phẩm trong PDF, sau đó thêm từng cặp `Kích thước trong PDF` → `Kích thước Printbelle`. Ví dụ prefix `GF` sẽ áp dụng cho `GF-10`, `GF-20` và các SKU bắt đầu bằng `GF`; nếu nhập mã đầy đủ thì chỉ áp dụng cho mã đó.
- Bấm **Lưu cấu hình** để lưu trên server; mọi trình duyệt đều dùng chung cấu hình.
- **Tải lại từ server** bỏ các chỉnh sửa chưa lưu trên giao diện và tải cấu hình hiện tại từ server.

SPU hoặc kích thước cũng có thể được sửa trực tiếp trên từng order trước khi tạo preview. Cấu hình mặc định nằm trong [`data/catalog.json`](data/catalog.json) để server có fallback khi chưa có file cấu hình đã lưu. `colorMappings` và `variantMappings` hiện vẫn là các nhóm nâng cao trong file cấu hình.

### Quy tắc nhiều artwork

- Một order chỉ có một item: giữ một line item; nếu có nhiều artwork thì quantity được lấy theo số artwork. Tất cả artwork vẫn hiển thị để đối chiếu, còn API item dùng artwork đầu tiên theo schema hiện tại.
- Một order có nhiều item: artwork được ghép từ trên xuống theo số thứ tự trong filename. Số artwork phải đúng bằng số item và mỗi item phải có quantity 1.
- Nếu thiếu/thừa artwork, thiếu SPU hoặc thiếu mapping kích cỡ bắt buộc, order được đánh dấu lỗi, bị bỏ qua khi submit và hiển thị lý do trên giao diện.

Mỗi payload được dựng trong `src/services/orderBuilder.js`, export Excel nằm trong `src/services/orderImportExporter.js`, lưu artwork nằm trong `src/services/r2Storage.js`, còn gọi API nằm trong `src/services/printbelleClient.js`. Hai file API này có thể dùng lại sau khi chuyển từ import Excel sang API.

## Xuất file import order

Sau khi đọc PDF và tạo preview, bấm **Export import Excel**. App sẽ:

1. Upload artwork vào Cloudflare R2.
2. Dùng URL public của R2 trong cột `*Artwork`.
3. Dựng từng dòng theo template `order_import_template.xlsx`.
4. Giữ lại sheet `Country Code` và cấu trúc 19 cột của template.
5. Bỏ qua order lỗi và thông báo số lượng order bị bỏ qua trên giao diện.

Các biến R2 cần cấu hình:

```env
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET=your_bucket_name
R2_PUBLIC_BASE_URL=https://artwork.example.com
R2_REQUIRED=true
```

`R2_PUBLIC_BASE_URL` phải là custom domain hoặc public `r2.dev` domain có thể truy cập từ bên ngoài. Không dùng URL quản trị hoặc endpoint S3 private trong cột artwork.

## Printbelle API và dry-run

Luồng submit thật đã được nối qua adapter `src/services/printbelleClient.js`. App dùng `PB-ACCESS-TOKEN`, kiểm tra `orderId` trước bằng endpoint danh sách đơn, bỏ qua đơn đã tồn tại, sau đó gửi từng order hợp lệ theo thứ tự. Nếu một order trả lỗi, các order còn lại vẫn được xử lý và kết quả từng order hiển thị trên giao diện.

App vẫn đặt `PRINTBELLE_DRY_RUN=true` mặc định. Để bật live API:

1. Set `PRINTBELLE_API_TOKEN` bằng token của tài khoản Printbelle.
2. Kiểm tra `PRINTBELLE_CREATE_ORDER_PATH` theo endpoint được Printbelle cấp cho account; mặc định là `/prod_api/api/orders/v2/create`.
3. Đặt `ARTWORK_BASE_URL` là public HTTPS domain để Printbelle tải artwork.
4. Chạy dry-run, kiểm tra payload, sau đó đổi `PRINTBELLE_DRY_RUN=false`.

Tài liệu API công khai xác nhận token endpoint, header `PB-ACCESS-TOKEN` và endpoint tra cứu order theo `orderIds`; endpoint tạo order không hiển thị đầy đủ schema trong trang public, nên path vẫn được để trong biến môi trường để có thể đổi mà không sửa code.

## Railway

Project có `Dockerfile`, `railway.json`, endpoint `/api/health` và bind server trên `0.0.0.0:$PORT`. Khi deploy, set `ARTWORK_BASE_URL` về public Railway domain để Printbelle fetch được artwork, ví dụ `https://your-app.up.railway.app`.

File upload hiện được lưu trong `UPLOAD_DIR` để Printbelle lấy ngay trong lúc submit. Railway filesystem có tính ephemeral. Nếu muốn cấu hình SPU/kích cỡ và artwork được giữ sau redeploy, attach Railway Volume rồi đặt:

```env
CATALOG_CONFIG_PATH=/data/catalog.json
UPLOAD_DIR=/data/uploads
```

Nếu không gắn Volume, cấu hình vẫn dùng chung giữa các trình duyệt trong lúc instance hiện tại còn tồn tại, nhưng có thể mất khi Railway redeploy/recreate instance.
