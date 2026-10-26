const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Đảm bảo thư mục lưu ảnh upload tồn tại
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
app.use('/uploads', express.static(UPLOADS_DIR));

// Paths to database files
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const TRANSACTIONS_FILE = path.join(DATA_DIR, 'transactions.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Helper functions for reading/writing JSON files
function readJSON(filePath, defaultValue = []) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf8');
      return defaultValue;
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
    return defaultValue;
  }
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
    return false;
  }
}

// ---------------- SEED TÀI KHOẢN ADMIN HQK ----------------
function seedAdminUser() {
  const users = readJSON(USERS_FILE, []);
  let admin = users.find(u => u.username.toLowerCase() === 'hqk');
  const salt = bcrypt.genSaltSync(10);
  const hashedPassword = bcrypt.hashSync('khanh2k9', salt);

  if (!admin) {
    admin = {
      id: 'admin_hqk',
      username: 'hqk',
      password: hashedPassword,
      fullname: 'Admin HQK (Chủ Shop)',
      balance: 10000000,
      role: 'admin',
      createdAt: new Date().toISOString()
    };
    users.unshift(admin);
    writeJSON(USERS_FILE, users);
    console.log('[OK] Da khoi tao tai khoan Admin hqk mac dinh (pass: khanh2k9).');
  } else {
    admin.role = 'admin';
    admin.password = hashedPassword;
    if (admin.balance === undefined) admin.balance = 10000000;
    writeJSON(USERS_FILE, users);
    console.log('[OK] Da dong bo quyen Admin va mat khau cho tai khoan hqk.');
  }
}
seedAdminUser();

function seedDefaultProducts() {
  const products = readJSON(PRODUCTS_FILE, []);
  if (products.length === 0) {
    const defaults = [
      {
        id: "prod_hqk_1",
        name: "Tài Khoản Youtube Premium 1 Năm",
        price: 100000,
        stock: 99,
        category: "FreeFire Thường",
        description: "Tài khoản Youtube Premium không quảng cáo, nghe nhạc tắt màn hình, chất lượng âm thanh cao cấp.",
        image: "https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=500&auto=format&fit=crop&q=60",
        downloadUrl: "https://youtube.com/premium",
        createdAt: new Date().toISOString()
      },
      {
        id: "prod_hqk_2",
        name: "Gói Định Vị Android VIP Antiban 2026",
        price: 120000,
        stock: 50,
        category: "FreeFireMax",
        description: "Gói định vị chuyên nghiệp cho Android, cập nhật liên tục, hỗ trợ cài đặt nhanh gọn 100%.",
        image: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=500&auto=format&fit=crop&q=60",
        downloadUrl: "https://shophqk.netlify.app",
        createdAt: new Date().toISOString()
      }
    ];
    writeJSON(PRODUCTS_FILE, defaults);
    console.log('[OK] Da khoi tao san pham mac dinh cho Shophqk.');
  }
}
seedDefaultProducts();

// Middleware kiểm tra quyền Admin
function requireAdmin(req, res, next) {
  const adminUsername = req.headers['x-admin-username'] || 
    (req.body && req.body.adminUsername) || 
    (req.query && req.query.adminUsername);
  if (!adminUsername) {
    return res.status(403).json({ success: false, message: 'Yêu cầu quyền Quản trị viên!' });
  }

  const users = readJSON(USERS_FILE, []);
  const admin = users.find(u => u.username.toLowerCase() === adminUsername.trim().toLowerCase());
  if (!admin || admin.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Bạn không có quyền quản trị viên!' });
  }

  req.adminUser = admin;
  next();
}

// ---------------- API SẢN PHẨM (PRODUCTS) ----------------
// Lấy danh sách sản phẩm
app.get('/api/products', (req, res) => {
  const products = readJSON(PRODUCTS_FILE, []);
  res.json({ success: true, data: products });
});

// Thêm sản phẩm mới (Yêu cầu quyền Admin)
app.post('/api/products', (req, res) => {
  const { name, price, stock, category, description, image, downloadUrl, adminUsername } = req.body;
  
  if (!name || price === undefined || stock === undefined) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập tên, giá tiền và số lượng sản phẩm!' });
  }

  // Kiểm tra quyền Admin khi thêm sản phẩm
  if (adminUsername) {
    const users = readJSON(USERS_FILE, []);
    const admin = users.find(u => u.username.toLowerCase() === adminUsername.trim().toLowerCase());
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền thêm sản phẩm!' });
    }
  }

  const products = readJSON(PRODUCTS_FILE, []);
  const newProduct = {
    id: 'prod_' + Date.now(),
    name: name.trim(),
    price: Number(price) || 0,
    stock: Number(stock) || 0,
    category: category ? category.trim() : 'Sản phẩm số',
    description: description ? description.trim() : '',
    image: image && image.trim() !== '' ? image.trim() : 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=500&auto=format&fit=crop&q=60',
    downloadUrl: downloadUrl ? downloadUrl.trim() : '',
    createdAt: new Date().toISOString()
  };

  products.unshift(newProduct);
  writeJSON(PRODUCTS_FILE, products);

  res.status(201).json({ success: true, message: 'Thêm sản phẩm thành công!', data: newProduct });
});

// Xóa sản phẩm (Chỉ Admin)
app.delete('/api/products/:id', (req, res) => {
  const { id } = req.params;
  const adminUsername = req.query.adminUsername || req.headers['x-admin-username'];
  if (adminUsername) {
    const users = readJSON(USERS_FILE, []);
    const admin = users.find(u => u.username.toLowerCase() === adminUsername.trim().toLowerCase());
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền xóa sản phẩm!' });
    }
  }

  let products = readJSON(PRODUCTS_FILE, []);
  const initialLength = products.length;
  products = products.filter(p => p.id !== id);

  if (products.length === initialLength) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm cần xóa!' });
  }

  writeJSON(PRODUCTS_FILE, products);
  res.json({ success: true, message: 'Đã xóa sản phẩm thành công!' });
});

// Sửa / cập nhật thông tin sản phẩm (Chỉ Admin)
app.put('/api/products/:id', (req, res) => {
  const { id } = req.params;
  const { name, price, stock, category, description, image, downloadUrl, adminUsername } = req.body;

  if (adminUsername) {
    const users = readJSON(USERS_FILE, []);
    const admin = users.find(u => u.username.toLowerCase() === adminUsername.trim().toLowerCase());
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền sửa sản phẩm!' });
    }
  }

  let products = readJSON(PRODUCTS_FILE, []);
  const pIndex = products.findIndex(p => p.id === id);
  if (pIndex === -1) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm cần sửa!' });
  }

  if (name !== undefined) products[pIndex].name = name.trim();
  if (price !== undefined) products[pIndex].price = Number(price);
  if (stock !== undefined) products[pIndex].stock = Number(stock);
  if (category !== undefined) products[pIndex].category = category.trim();
  if (description !== undefined) products[pIndex].description = description.trim();
  if (image !== undefined && image.trim() !== '') products[pIndex].image = image.trim();
  if (downloadUrl !== undefined) products[pIndex].downloadUrl = downloadUrl.trim();
  products[pIndex].updatedAt = new Date().toISOString();

  writeJSON(PRODUCTS_FILE, products);
  res.json({ success: true, message: 'Đã cập nhật sản phẩm thành công!', data: products[pIndex] });
});

// Upload ảnh sản phẩm (Kéo thả hoặc mở thư mục - Chỉ Admin)
app.post('/api/admin/upload-image', (req, res) => {
  const { imageBase64, filename, adminUsername } = req.body;
  if (adminUsername) {
    const users = readJSON(USERS_FILE, []);
    const admin = users.find(u => u.username.toLowerCase() === adminUsername.trim().toLowerCase());
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền tải ảnh!' });
    }
  }

  if (!imageBase64) {
    return res.status(400).json({ success: false, message: 'Vui lòng cung cấp dữ liệu hình ảnh!' });
  }

  try {
    const matches = imageBase64.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
    let ext = 'png';
    let buffer;
    if (matches && matches.length === 3) {
      ext = matches[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(imageBase64, 'base64');
    }

    const safeName = 'img_' + Date.now() + '_' + Math.floor(Math.random() * 10000) + '.' + ext;
    const savePath = path.join(UPLOADS_DIR, safeName);
    fs.writeFileSync(savePath, buffer);

    const imageUrl = `/uploads/${safeName}`;
    res.json({ success: true, message: 'Tải ảnh thành công!', imageUrl: imageUrl });
  } catch (err) {
    console.error('Lỗi lưu ảnh:', err);
    res.status(500).json({ success: false, message: 'Lỗi khi lưu ảnh lên máy chủ!' });
  }
});

// ---------------- API TÀI KHOẢN (AUTH) ----------------
// Đăng ký tài khoản
app.post('/api/auth/register', (req, res) => {
  const { username, password, fullname } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập tên đăng nhập và mật khẩu!' });
  }

  const cleanUser = username.trim().toLowerCase();
  if (cleanUser.length < 3) {
    return res.status(400).json({ success: false, message: 'Tên đăng nhập phải có ít nhất 3 ký tự!' });
  }

  const users = readJSON(USERS_FILE, []);
  const existingUser = users.find(u => u.username.toLowerCase() === cleanUser);
  if (existingUser) {
    return res.status(400).json({ success: false, message: 'Tên đăng nhập này đã được sử dụng!' });
  }

  const salt = bcrypt.genSaltSync(10);
  const hashedPassword = bcrypt.hashSync(password, salt);

  const newUser = {
    id: 'user_' + Date.now(),
    username: cleanUser,
    password: hashedPassword,
    fullname: fullname ? fullname.trim() : username,
    balance: 0,
    role: cleanUser === 'hqk' ? 'admin' : 'user',
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  writeJSON(USERS_FILE, users);

  const { password: _, ...userWithoutPass } = newUser;
  res.status(201).json({ success: true, message: 'Tạo tài khoản thành công!', data: userWithoutPass });
});

// Đăng nhập
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập tài khoản và mật khẩu!' });
  }

  const cleanUser = username.trim().toLowerCase();
  const users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.username.toLowerCase() === cleanUser);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(400).json({ success: false, message: 'Tài khoản hoặc mật khẩu không chính xác!' });
  }

  const { password: _, ...userWithoutPass } = user;
  res.json({ success: true, message: `Chào mừng ${user.role === 'admin' ? 'Quản trị viên ' : ''}${user.fullname || user.username}!`, data: userWithoutPass });
});

// Lấy thông tin user hiện tại (cập nhật số dư)
app.get('/api/auth/me/:username', (req, res) => {
  const { username } = req.params;
  const users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());

  if (!user) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng!' });
  }

  const { password: _, ...userWithoutPass } = user;
  res.json({ success: true, data: userWithoutPass });
});

// ---------------- API QUẢN TRỊ ADMIN (ADMIN PANEL) ----------------
// 1. Lấy danh sách toàn bộ Users
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = readJSON(USERS_FILE, []);
  const safeUsers = users.map(({ password, ...u }) => u);
  res.json({ success: true, data: safeUsers });
});

// 2. Quản lý số dư User: Cộng tiền, Giảm/Trừ tiền, Xóa sạch tiền về 0đ (Admin HQK)
app.post('/api/admin/add-balance', requireAdmin, (req, res) => {
  const { targetUsername, amount, action = 'add', reason } = req.body;

  if (!targetUsername) {
    return res.status(400).json({ success: false, message: 'Vui lòng chọn tài khoản cần điều chỉnh số dư!' });
  }

  const users = readJSON(USERS_FILE, []);
  const userIndex = users.findIndex(u => u.username.toLowerCase() === targetUsername.trim().toLowerCase());

  if (userIndex === -1) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng này!' });
  }

  const currentBal = users[userIndex].balance || 0;
  let newBal = currentBal;
  let txType = 'ADMIN_DEPOSIT';
  let txAmount = 0;
  let successMsg = '';

  if (action === 'reset') {
    // Xóa sạch tiền về 0 VNĐ
    txType = 'ADMIN_RESET';
    txAmount = currentBal;
    newBal = 0;
    users[userIndex].balance = 0;
    successMsg = `Đã xóa sạch số dư của user [${users[userIndex].username}] về 0 đ! (Đã trừ hết ${currentBal.toLocaleString('vi-VN')} đ)`;
  } else if (action === 'deduct') {
    // Giảm / Trừ tiền
    const deductAmt = Math.abs(Number(amount) || 0);
    if (deductAmt <= 0) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập số tiền cần giảm hợp lệ!' });
    }
    txType = 'ADMIN_DEDUCT';
    txAmount = deductAmt;
    newBal = Math.max(0, currentBal - deductAmt);
    users[userIndex].balance = newBal;
    successMsg = `Đã giảm trừ -${deductAmt.toLocaleString('vi-VN')} đ của user [${users[userIndex].username}]. Số dư mới: ${newBal.toLocaleString('vi-VN')} đ`;
  } else {
    // Cộng tiền (Mặc định)
    const addAmt = Number(amount) || 0;
    if (addAmt === 0) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập số tiền cần cộng hợp lệ!' });
    }
    if (addAmt < 0) {
      // Nếu nhập số âm thì tự động chuyển thành giảm tiền
      txType = 'ADMIN_DEDUCT';
      txAmount = Math.abs(addAmt);
      newBal = Math.max(0, currentBal + addAmt);
      users[userIndex].balance = newBal;
      successMsg = `Đã giảm -${Math.abs(addAmt).toLocaleString('vi-VN')} đ của user [${users[userIndex].username}]. Số dư mới: ${newBal.toLocaleString('vi-VN')} đ`;
    } else {
      txType = 'ADMIN_DEPOSIT';
      txAmount = addAmt;
      newBal = currentBal + addAmt;
      users[userIndex].balance = newBal;
      successMsg = `Đã cộng +${addAmt.toLocaleString('vi-VN')} đ cho user [${users[userIndex].username}]. Số dư mới: ${newBal.toLocaleString('vi-VN')} đ`;
    }
  }

  writeJSON(USERS_FILE, users);

  // Ghi nhật ký giao dịch
  const transactions = readJSON(TRANSACTIONS_FILE, []);
  transactions.unshift({
    id: 'tx_admin_' + Date.now(),
    type: txType,
    username: users[userIndex].username,
    amount: txAmount,
    memo: reason || (
      action === 'reset' ? 'Admin HQK xóa sạch tiền tài khoản về 0đ' :
      action === 'deduct' ? `Admin HQK giảm trừ tiền tài khoản` :
      'Admin HQK cộng tiền vào tài khoản'
    ),
    adminBy: req.adminUser.username,
    status: 'COMPLETED',
    createdAt: new Date().toISOString()
  });
  writeJSON(TRANSACTIONS_FILE, transactions);

  res.json({
    success: true,
    message: successMsg,
    newBalance: newBal
  });
});

// 3. Lấy danh sách tất cả các đơn nạp tiền VietQR để duyệt
app.get('/api/admin/deposits', requireAdmin, (req, res) => {
  const transactions = readJSON(TRANSACTIONS_FILE, []);
  const deposits = transactions.filter(t => t.type === 'DEPOSIT');
  res.json({ success: true, data: deposits });
});

// 4. Duyệt nạp tiền cho đơn VietQR (Admin duyệt)
app.post('/api/admin/approve-deposit', requireAdmin, (req, res) => {
  const txId = req.body.txId || req.body.transactionId || req.body.id;

  if (!txId) {
    return res.status(400).json({ success: false, message: 'Thiếu mã giao dịch!' });
  }

  const transactions = readJSON(TRANSACTIONS_FILE, []);
  const txIndex = transactions.findIndex(t => t.id === txId);

  if (txIndex === -1) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy giao dịch!' });
  }

  const tx = transactions[txIndex];
  if (tx.status === 'COMPLETED') {
    return res.status(400).json({ success: false, message: 'Giao dịch này đã được duyệt trước đó!' });
  }

  const users = readJSON(USERS_FILE, []);
  const userIndex = users.findIndex(u => u.username.toLowerCase() === tx.username.toLowerCase());
  if (userIndex === -1) {
    return res.status(404).json({ success: false, message: 'Người dùng nạp tiền không còn tồn tại!' });
  }

  users[userIndex].balance = (users[userIndex].balance || 0) + tx.amount;
  writeJSON(USERS_FILE, users);

  transactions[txIndex].status = 'COMPLETED';
  transactions[txIndex].approvedBy = req.adminUser.username;
  transactions[txIndex].completedAt = new Date().toISOString();
  writeJSON(TRANSACTIONS_FILE, transactions);

  res.json({
    success: true,
    message: `Đã duyệt thành công đơn ${tx.code}! Đã cộng +${tx.amount.toLocaleString('vi-VN')} đ cho ${tx.username}.`,
    targetUser: tx.username,
    newBalance: users[userIndex].balance
  });
});

// 5. Xóa User (Admin có thể xóa tài khoản vi phạm)
app.delete('/api/admin/users/:username', requireAdmin, (req, res) => {
  const { username } = req.params;
  if (username.toLowerCase() === 'hqk') {
    return res.status(400).json({ success: false, message: 'Không thể xóa tài khoản Admin gốc!' });
  }

  let users = readJSON(USERS_FILE, []);
  const initLen = users.length;
  users = users.filter(u => u.username.toLowerCase() !== username.toLowerCase());

  if (users.length === initLen) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng!' });
  }

  writeJSON(USERS_FILE, users);
  res.json({ success: true, message: `Đã xóa tài khoản [${username}] thành công!` });
});

// ---------------- API CẤU HÌNH SHOP & VIETQR (SETTINGS) ----------------
// Lấy toàn bộ cấu hình Shop (Tên, mô tả, thông báo, danh mục, liên hệ, VietQR)
app.get('/api/settings', (req, res) => {
  const defaultSettings = {
    shopName: "ShopHQK",
    shopTitle: "Cửa Hàng Số Tiện Lợi ShopHQK",
    shopDesc: "Cung cấp tài khoản, phần mềm và dịch vụ trực tuyến bản quyền toàn quốc. Nạp tiền nhận ngay số dư qua quét mã VietQR chỉ trong vài giây.",
    shopNotice: "⚡ Ưu đãi nạp tiền: Khuyến mãi nạp tự động qua VietQR duyệt siêu tốc! Hỗ trợ 24/7.",
    shopNoticeActive: true,
    contactZalo: "0349340730",
    contactPhone: "0349340730",
    contactTelegram: "hqk_support",
    contactFacebook: "https://facebook.com",
    logoText: "ShopHQK",
    bankId: "MOMO",
    accountNo: "0349340730",
    accountName: "SHOPHQK STORE",
    categories: ["Tất cả", "Tài khoản", "Phần mềm", "Game", "Thẻ cào", "Khác"]
  };
  const current = readJSON(SETTINGS_FILE, {});
  const settings = Object.assign({}, defaultSettings, current);
  res.json({ success: true, data: settings });
});

// Cập nhật cấu hình Shop (Admin toàn quyền thay đổi mọi thứ)
app.post('/api/settings', requireAdmin, (req, res) => {
  const currentSettings = readJSON(SETTINGS_FILE, {});
  const updatedSettings = {
    ...currentSettings,
    ...req.body
  };

  // Làm sạch các trường quan trọng nếu có gửi lên
  if (updatedSettings.accountName) {
    updatedSettings.accountName = updatedSettings.accountName.toUpperCase();
  }
  if (Array.isArray(updatedSettings.categories)) {
    // Đảm bảo không trùng lặp và có ít nhất "Tất cả"
    let cats = updatedSettings.categories.map(c => typeof c === 'string' ? c.trim() : c).filter(Boolean);
    if (!cats.some(c => c.toLowerCase() === 'tất cả')) {
      cats.unshift('Tất cả');
    }
    updatedSettings.categories = cats;
  }

  writeJSON(SETTINGS_FILE, updatedSettings);
  res.json({ success: true, message: 'Đã lưu toàn bộ thay đổi cấu hình Shop thành công!', data: updatedSettings });
});

// Tạo đơn nạp tiền qua VietQR
app.post('/api/wallet/create-deposit', (req, res) => {
  const { username, amount } = req.body;

  if (!username || !amount || Number(amount) < 10000) {
    return res.status(400).json({ success: false, message: 'Số tiền nạp tối thiểu là 10.000 VNĐ!' });
  }

  const users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
  if (!user) {
    return res.status(404).json({ success: false, message: 'Người dùng không tồn tại!' });
  }

  const settings = readJSON(SETTINGS_FILE, {
    bankId: 'MB',
    accountNo: '0987654321',
    accountName: 'SHOPHQK STORE'
  });

  const depositAmount = Number(amount);
  const code = 'NAP' + Math.floor(100000 + Math.random() * 900000);
  const memo = `${code} ${user.username}`;
  
  const qrUrl = `https://img.vietqr.io/image/${settings.bankId}-${settings.accountNo}-compact2.png?amount=${depositAmount}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(settings.accountName)}`;

  const transactions = readJSON(TRANSACTIONS_FILE, []);
  const newTx = {
    id: 'tx_' + Date.now(),
    type: 'DEPOSIT',
    username: user.username,
    amount: depositAmount,
    code: code,
    memo: memo,
    bankId: settings.bankId,
    accountNo: settings.accountNo,
    accountName: settings.accountName,
    qrUrl: qrUrl,
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };

  transactions.unshift(newTx);
  writeJSON(TRANSACTIONS_FILE, transactions);

  res.json({
    success: true,
    data: newTx
  });
});

// Xác nhận giao dịch nạp tiền (ĐÃ TẮT TỰ ĐỘNG DUYỆT TIỀN THEO YÊU CẦU CỦA ADMIN)
// Tiền chỉ được cộng vào ví khi Admin HQK bấm nút Duyệt trong Bảng Quản Trị (/api/admin/approve-deposit)
app.post('/api/wallet/confirm-deposit', (req, res) => {
  return res.status(403).json({
    success: false,
    message: 'Tính năng tự động duyệt tiền đã được tắt. Đơn nạp sẽ do Admin HQK kiểm tra và duyệt thủ công qua Bảng Quản Trị!'
  });
});

// ---------------- API MUA HÀNG (CHECKOUT) ----------------
app.post('/api/orders/buy', (req, res) => {
  const { username, productId, quantity } = req.body;

  if (!username || !productId || !quantity || quantity < 1) {
    return res.status(400).json({ success: false, message: 'Thông tin mua hàng không hợp lệ!' });
  }

  const qty = Number(quantity);
  const users = readJSON(USERS_FILE, []);
  const userIndex = users.findIndex(u => u.username.toLowerCase() === username.trim().toLowerCase());
  if (userIndex === -1) {
    return res.status(404).json({ success: false, message: 'Vui lòng đăng nhập để mua hàng!' });
  }

  const products = readJSON(PRODUCTS_FILE, []);
  const productIndex = products.findIndex(p => p.id === productId);
  if (productIndex === -1) {
    return res.status(404).json({ success: false, message: 'Sản phẩm không tồn tại!' });
  }

  const product = products[productIndex];
  if (product.stock < qty) {
    return res.status(400).json({ success: false, message: `Số lượng trong kho không đủ (Hiện còn: ${product.stock})!` });
  }

  const totalCost = product.price * qty;
  if (users[userIndex].balance < totalCost) {
    return res.status(400).json({
      success: false,
      message: `Số dư không đủ! Cần ${totalCost.toLocaleString('vi-VN')} VNĐ, số dư hiện tại là ${users[userIndex].balance.toLocaleString('vi-VN')} VNĐ. Hãy nạp thêm tiền qua VietQR!`
    });
  }

  users[userIndex].balance -= totalCost;
  products[productIndex].stock -= qty;

  writeJSON(USERS_FILE, users);
  writeJSON(PRODUCTS_FILE, products);

  const transactions = readJSON(TRANSACTIONS_FILE, []);
  transactions.unshift({
    id: 'order_' + Date.now(),
    type: 'PURCHASE',
    username: users[userIndex].username,
    productName: product.name,
    productId: product.id,
    downloadUrl: product.downloadUrl || '',
    quantity: qty,
    price: product.price,
    totalCost: totalCost,
    status: 'COMPLETED',
    createdAt: new Date().toISOString()
  });
  writeJSON(TRANSACTIONS_FILE, transactions);

  res.json({
    success: true,
    message: `Mua thành công ${qty}x ${product.name}!`,
    newBalance: users[userIndex].balance,
    remainingStock: products[productIndex].stock,
    downloadUrl: product.downloadUrl || '',
    productName: product.name
  });
});

// Lịch sử giao dịch của user
app.get('/api/transactions/:username', (req, res) => {
  const { username } = req.params;
  const transactions = readJSON(TRANSACTIONS_FILE, []);
  const userTx = transactions.filter(t => t.username.toLowerCase() === username.trim().toLowerCase());
  res.json({ success: true, data: userTx });
});

// SPA fallback routing (Express 4 & 5 compatible)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Khởi chạy server
app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`  Shophqk Server dang chay tai: http://localhost:${PORT}`);
  console.log(`===============================================`);
});
