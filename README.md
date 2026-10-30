# Printbelle Order Desk

Web app Node/Express nhỏ để đọc packing slip PDF, ghép artwork theo tên khách hàng, ánh xạ SPU/kích cỡ/màu và xuất file import order theo template Printbelle. Artwork được đưa lên Cloudflare R2 để dùng URL ổn định trong file Excel. UI dùng HTML/CSS/JS thuần để các phần có thể sửa độc lập, không cần frontend build pipeline.

## Chạy local

```bash
npm install
cp .env.example .env
npm test
npm start
```

Mở `http://localhost:3000`, chọn hoặc kéo thả một file PDF và các file artwork vào hai vùng tương ứng. Tên artwork mẫu như `1_Stacey Wierman_0.png` sẽ được ghép với khách hàng `Stacey Wierman` trong PDF; không cần đổi tên file PDF thành `input.pdf`.

## Mapping trên giao diện

Mở trang cấu hình riêng tại `http://localhost:3000/settings` hoặc bấm **Cấu hình SPU** trên trang chính. Không cần đọc PDF trước và không cần chỉnh JSON thủ công:

- **Danh mục sản phẩm**: thêm tên hiển thị, mã SPU Printbelle, SKU prefix và các từ khóa xuất hiện trong PDF. Các giá trị ngăn cách bằng dấu phẩy và được dùng cho tự nhận diện. Ví dụ prefix `GF` sẽ khớp `GF-10`, `GF_10`, `GF-20` và các SKU tương ứng.
- **Ánh xạ kích cỡ**: nhập một hoặc nhiều SKU prefix (ngăn cách bằng dấu phẩy) hoặc mã sản phẩm trong PDF, sau đó thêm từng cặp `Kích thước trong PDF` → `Kích thước Printbelle`. Ví dụ `GF, JS` sẽ áp dụng cho `GF-10`, `GF_10`, `GF-20`, `JS-3` và các SKU bắt đầu bằng các prefix đó; nếu nhập mã đầy đủ thì chỉ áp dụng cho mã đó.
- **Default size when PDF has no size**: trong mục Advanced, thêm các prefix như `EJ-7, GF` và kích cỡ Printbelle mặc định. Rule này chỉ chạy khi PDF không có kích cỡ; nếu PDF có kích cỡ thì mapping cụ thể trong phần Size mappings vẫn được ưu tiên.
- **Product_Code rules (Advanced)**: mở mục thu gọn này khi file export thành công của Printbelle có mã gộp SPU, màu và kích cỡ, ví dụ `ULCNP-Pink/5.8X8.5INCH`. Có thể bấm **Choose .xlsx** để import các dòng `Product_Spu` + `Product_Code`; các rule được thêm dưới dạng bản nháp để kiểm tra trước khi lưu. Một rule có thể có nhiều SKU prefix, nhập cách nhau bằng dấu phẩy, ví dụ `GF, JS`.
- Bấm **Lưu cấu hình** để lưu trên server; mọi trình duyệt đều dùng chung cấu hình.
- **Tải lại từ server** bỏ các chỉnh sửa chưa lưu trên giao diện và tải cấu hình hiện tại từ server.

SPU hoặc kích thước cũng có thể được sửa trực tiếp trên từng order trước khi tạo preview. Cấu hình mặc định nằm trong [`data/catalog.json`](data/catalog.json) để server có fallback khi chưa có file cấu hình đã lưu. `colorMappings` và `variantMappings` cũ vẫn được giữ để tương thích; rule mới dùng `variantRules` và có thể chỉnh trực tiếp trong giao diện.

### Mapping Product_Code từ file export thành công

File export mẫu dùng cột `Product_Spu` cùng `Product_Code`, trong đó `Product_Code` có dạng `SPU-Color/Size`. Trang Settings đọc hai cột này, tách thành các trường SPU, color, size và mã đích, sau đó thêm thành rule. Khi tạo order, app ưu tiên rule có SKU prefix dài hơn và các điều kiện size/color cụ thể hơn; nếu PDF không có size thì một rule duy nhất khớp theo SPU/prefix/color vẫn được dùng để giữ size trong Product_Code. Nếu có nhiều rule size khác nhau mà PDF không cung cấp size, app không tự đoán.

Shipping method cho đơn US mặc định là `STANDARD SHIPPING-USPS`; nếu tổng quantity của đơn US từ 10 item trở lên, app tự dùng `FAST   SHIPPING`. Đơn đi đến quốc gia khác US luôn dùng `STANDARD SHIPPING`.

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

`R2_PUBLIC_BASE_URL` phải là HTTPS custom domain hoặc public `r2.dev` domain có thể truy cập trực tiếp từ bên ngoài, không cần đăng nhập, token hoặc query signature. Không dùng URL quản trị hoặc endpoint S3 `*.r2.cloudflarestorage.com`; đó là endpoint API/private và có thể yêu cầu xác thực. Khi cấu hình sai, app sẽ không cho export để tránh tạo file Excel với artwork URL không dùng được.

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
