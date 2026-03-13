# Đổi thư mục sang project local
Set-Location "E:\Projects\TBC-FnB"

# 1. Commit & push code lên GitHub
git add .
git commit -m "."
git push

# 2. Đợi 5 giây
#Start-Sleep -Seconds 5

# 3. SSH vào server và pull code + build + restart pm2
#ssh root1@192.168.10.201 "cd ~/TBC-FnB && git pull && npm install --production=false && npm run build && pm2 restart tbc-fnb"