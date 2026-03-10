@echo off
rem Đổi thư mục sang project local
cd /d "E:\Projects\TBC-FnB"

rem 1. Commit & push code lên GitHub
git add .
git commit -m "."
git push

rem 2. Đợi 5 giây
timeout /t 5 /nobreak >nul

rem 3. SSH vào server và pull code + build + restart pm2
ssh root1@192.168.10.79 "cd ~/TBC-FnB && git pull && npm install --production=false && npm run build && pm2 restart tbc-fnb"

rem Tạm dừng màn hình cho dễ xem lỗi (tuỳ chọn)
pause