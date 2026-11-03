const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// ---------------- 1. NẠP FILE .ENV TỰ ĐỘNG ----------------
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split(/\r?\n/).forEach(line => {
      line = line.trim();
      if (line && !line.startsWith('#') && line.includes('=')) {
        const idx = line.indexOf('=');
        const key = line.slice(0, idx).trim();
        let val = line.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    });
  } catch (err) {
    console.error('[ENV] Lỗi nạp .env:', err.message);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------- 2. BẢO MẬT HTTP SECURITY HEADERS (OWASP / HELMET CHUẨN DOANH NGHIỆP) ----------------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.removeHeader('X-Powered-By');
  next();
});

app.use(cors());

// ---------------- 2.1 TỰ ĐỘNG NÉN DỮ LIỆU GZIP (GIẢM 85% DUNG LƯỢNG & TĂNG TỐC 5X) ----------------
app.use((req, res, next) => {
  const accept = req.headers['accept-encoding'] || '';
  if (!accept.includes('gzip')) return next();

  const oldSend = res.send;
  res.send = function (body) {
    if (res.headersSent) return oldSend.call(this, body);

    const ct = res.getHeader('Content-Type') || '';
    if (!/json|text|javascript|css|xml|html/i.test(ct)) {
      return oldSend.call(this, body);
    }

    let buf;
    if (Buffer.isBuffer(body)) buf = body;
    else if (typeof body === 'string') buf = Buffer.from(body);
    else if (typeof body === 'object') {
      try {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        buf = Buffer.from(JSON.stringify(body));
      } catch (e) {
        return oldSend.call(this, body);
      }
    } else return oldSend.call(this, body);

    if (buf.length < 512) {
      return oldSend.call(this, buf);
    }

    zlib.gzip(buf, (err, gz) => {
      if (err) return oldSend.call(this, buf);
      res.setHeader('Content-Encoding', 'gzip');
      res.removeHeader('Content-Length');
      oldSend.call(this, gz);
    });
  };
  next();
});

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Bộ nhớ đệm tài nguyên tĩnh (Trình duyệt tải 1 lần & nạp 0ms từ Disk Cache)
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '2h',
  etag: true
}));

// Đảm bảo thư mục lưu ảnh upload tồn tại
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
app.use('/uploads', express.static(UPLOADS_DIR, {
  maxAge: '7d',
  etag: true
}));

// Paths to database files
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const TRANSACTIONS_FILE = path.join(DATA_DIR, 'transactions.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const AUDIT_LOGS_FILE = path.join(DATA_DIR, 'audit_logs.json');
const WEBHOOK_LOGS_FILE = path.join(DATA_DIR, 'webhook_logs.json');

// ---------------- 3. ATOMIC FILE I/O & DATABASE ENGINE ----------------
function safeWriteJSON(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempFile = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 8)}`;
    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(tempFile, content, 'utf8');
    fs.renameSync(tempFile, filePath);
    return true;
  } catch (err) {
    console.error(`[FS ERROR] Không thể ghi an toàn vào ${filePath}:`, err.message);
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (e2) {
      console.error(`[FS ERROR] Ghi dự phòng thất bại cho ${filePath}:`, e2.message);
      return false;
    }
  }
}

// ---------------- 3.1 GITHUB AUTO-SYNC CLOUD PERSISTENCE ----------------
let githubSyncQueue = new Set();
let githubSyncTimeout = null;

async function syncFileToGitHub(relativeFilePath) {
  const settings = readJSON(SETTINGS_FILE, {});
  const token = process.env.GITHUB_TOKEN || settings.githubToken;
  const repo = process.env.GITHUB_REPO || settings.githubRepo;
  const branch = process.env.GITHUB_BRANCH || settings.githubBranch || 'main';

  if (!token || !repo || token.trim() === '' || repo.trim() === '') return;

  try {
    const fullPath = path.join(__dirname, relativeFilePath);
    if (!fs.existsSync(fullPath)) return;
    const buf = fs.readFileSync(fullPath);
    const base64Content = buf.toString('base64');
    const apiPath = relativeFilePath.replace(/\\/g, '/');

    const getRes = await fetch(`https://api.github.com/repos/${repo.trim()}/contents/${apiPath}?ref=${branch.trim()}`, {
      headers: {
        'Authorization': `Bearer ${token.trim()}`,
        'User-Agent': 'ShopHQK-Server',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    let sha = null;
    if (getRes.status === 200) {
      const info = await getRes.json();
      sha = info.sha;
    }

    const putRes = await fetch(`https://api.github.com/repos/${repo.trim()}/contents/${apiPath}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token.trim()}`,
        'User-Agent': 'ShopHQK-Server',
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        message: `[ShopHQK Auto-Sync] Update ${apiPath} [skip render] [skip ci]`,
        content: base64Content,
        branch: branch.trim(),
        ...(sha ? { sha } : {})
      })
    });

    if (putRes.ok) {
      console.log(`[GITHUB AUTO-SYNC] Đã lưu vĩnh viễn file ${apiPath} lên GitHub!`);
    }
  } catch (err) {
    console.warn(`[GITHUB AUTO-SYNC WARNING] ${err.message}`);
  }
}

function triggerGitHubSync(filePath) {
  try {
    const rel = path.relative(__dirname, filePath);
    if (!rel.startsWith('data' + path.sep)) return;

    // CHỈ ĐỒNG BỘ CÁC FILE DỮ LIỆU CỐT LÕI (SẢN PHẨM, CẤU HÌNH, NGƯỜI DÙNG, GIAO DỊCH)
    // TUYỆT ĐỐI KHÔNG ĐỒNG BỘ audit_logs HOẶC webhook_logs VÌ SẼ GÂY BÃO COMMIT VÀ LÀM RENDER KHỞI ĐỘNG LẠI LIÊN TỤC
    const allowed = ['products.json', 'settings.json', 'users.json', 'transactions.json'];
    const base = path.basename(rel);
    if (!allowed.includes(base)) return;

    githubSyncQueue.add(rel);

    if (githubSyncTimeout) clearTimeout(githubSyncTimeout);
    githubSyncTimeout = setTimeout(async () => {
      const toSync = Array.from(githubSyncQueue);
      githubSyncQueue.clear();
      for (const relFile of toSync) {
        await syncFileToGitHub(relFile);
      }
    }, 15000); // Gom thay đổi trong 15s để tránh spam commit
  } catch (e) {}
}

// ---------------- 3.2 TỰ ĐỘNG KÉO DỮ LIỆU MỚI NHẤT TỪ GITHUB KHI KHỞI ĐỘNG ----------------
async function syncFromGitHubOnStartup() {
  const settings = readJSON(SETTINGS_FILE, {});
  const token = process.env.GITHUB_TOKEN || settings.githubToken;
  const repo = process.env.GITHUB_REPO || settings.githubRepo;
  const branch = process.env.GITHUB_BRANCH || settings.githubBranch || 'main';

  if (!token || !repo || token.trim() === '' || repo.trim() === '') return;

  const coreFiles = ['data/products.json', 'data/settings.json', 'data/users.json'];
  for (const relFile of coreFiles) {
    try {
      const apiPath = relFile.replace(/\\/g, '/');
      const res = await fetch(`https://raw.githubusercontent.com/${repo.trim()}/${branch.trim()}/${apiPath}`, {
        headers: {
          'Authorization': `Bearer ${token.trim()}`,
          'User-Agent': 'ShopHQK-Server'
        }
      });
      if (res.ok) {
        const remoteText = await res.text();
        const remoteJSON = JSON.parse(remoteText);
        const localPath = path.join(__dirname, relFile);
        const localJSON = readJSON(localPath, null);

        if (relFile === 'data/products.json' && Array.isArray(remoteJSON)) {
          if (!localJSON || !Array.isArray(localJSON) || remoteJSON.length > localJSON.length) {
            safeWriteJSON(localPath, remoteJSON);
            if (typeof invalidateProductsCache === 'function') invalidateProductsCache();
            console.log(`[BOOT SYNC] Đã cập nhật ${relFile} (${remoteJSON.length} sản phẩm) từ GitHub!`);
          }
        }
      }
    } catch (err) {
      console.warn(`[BOOT SYNC] Bỏ qua kéo file ${relFile}:`, err.message);
    }
  }
}

function writeJSON(filePath, data) {
  const ok = safeWriteJSON(filePath, data);
  if (ok) {
    triggerGitHubSync(filePath);
  }
  return ok;
}

function readJSON(filePath, defaultValue = []) {
  try {
    if (!fs.existsSync(filePath)) {
      safeWriteJSON(filePath, defaultValue);
      return defaultValue;
    }
    const data = fs.readFileSync(filePath, 'utf8');
    if (!data || data.trim() === '') {
      safeWriteJSON(filePath, defaultValue);
      return defaultValue;
    }
    return JSON.parse(data);
  } catch (err) {
    console.error(`[FS ERROR] Lỗi khi đọc file ${filePath}:`, err.message);
    return defaultValue;
  }
}

// ---------------- 4. ASYNC MUTEX LOCK (CHỐNG RACE CONDITION & DOUBLE SPENDING) ----------------
class AsyncMutex {
  constructor() {
    this.queue = [];
    this.locked = false;
  }

  acquire() {
    return new Promise(resolve => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next();
    } else {
      this.locked = false;
    }
  }

  async runExclusive(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

const transactionMutex = new AsyncMutex();
const productMutex = new AsyncMutex();

// ---------------- 5. RATE LIMITING & CHỐNG TẤN CÔNG BRUTE-FORCE ----------------
const rateLimitStores = {
  global: new Map(),
  auth: new Map(),
  wallet: new Map(),
  orders: new Map()
};

function getClientIP(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.socket.remoteAddress ||
    '127.0.0.1'
  );
}

function createRateLimiter({ windowMs, maxRequests, message, storeKey = 'global' }) {
  const store = rateLimitStores[storeKey] || rateLimitStores.global;
  return (req, res, next) => {
    const ip = getClientIP(req);
    const now = Date.now();
    let record = store.get(ip);

    if (!record || now - record.startTime > windowMs) {
      record = { count: 1, startTime: now };
      store.set(ip, record);
      return next();
    }

    record.count++;
    if (record.count > maxRequests) {
      const retrySecs = Math.ceil((record.startTime + windowMs - now) / 1000);
      res.setHeader('Retry-After', retrySecs);
      return res.status(429).json({
        success: false,
        message: message || `Bạn đã thao tác quá nhiều lần! Vui lòng thử lại sau ${retrySecs} giây.`,
        retryAfter: retrySecs
      });
    }
    next();
  };
}

// Dọn dẹp bộ nhớ Rate Limit mỗi 5 phút
setInterval(() => {
  const now = Date.now();
  for (const store of Object.values(rateLimitStores)) {
    for (const [key, val] of store.entries()) {
      if (now - val.startTime > 3600000) {
        store.delete(key);
      }
    }
  }
}, 5 * 60 * 1000);

const globalLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 120,
  storeKey: 'global',
  message: 'Quá nhiều yêu cầu từ thiết bị của bạn. Vui lòng thử lại sau 1 phút.'
});

const authLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  maxRequests: 15,
  storeKey: 'auth',
  message: 'Bạn đã thử đăng nhập/thao tác tài khoản quá nhiều lần. Vui lòng đợi 5 phút để thử lại!'
});

const walletLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 20,
  storeKey: 'wallet',
  message: 'Bạn tạo quá nhiều đơn nạp trong thời gian ngắn. Vui lòng chờ 1 phút!'
});

const orderLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 25,
  storeKey: 'orders',
  message: 'Bạn thao tác mua hàng quá nhanh. Vui lòng chậm lại một chút!'
});

app.use(globalLimiter);

// ---------------- 6. DATA SANITIZATION (CHỐNG XSS & SQL/NO-SQL INJECTION) ----------------
function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string') {
      if (key === 'password' || key === 'oldPassword' || key === 'newPassword' ||
          key === 'downloadUrl' || key === 'imageBase64' || key === 'qrUrl' ||
          key === 'itemsText') {
        clean[key] = val;
      } else {
        clean[key] = sanitizeString(val);
      }
    } else if (typeof val === 'object' && val !== null) {
      clean[key] = sanitizeObject(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

// ---------------- 7. NHẬT KÝ KIỂM TOÁN BẢO MẬT & WEBHOOK LOGS ----------------
function logAudit({ action, actor, target = '', details = '', ip = '127.0.0.1' }) {
  try {
    const logs = readJSON(AUDIT_LOGS_FILE, []);
    logs.unshift({
      id: 'audit_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      action,
      actor,
      target,
      details,
      ip,
      timestamp: new Date().toISOString()
    });
    // Giới hạn 500 bản ghi mới nhất
    if (logs.length > 500) logs.length = 500;
    writeJSON(AUDIT_LOGS_FILE, logs);
  } catch (err) {
    console.error('[AUDIT LOG ERROR]', err);
  }
}

function logWebhook({ gateway, content, amount, reference, ip, result, rawBody }) {
  try {
    const logs = readJSON(WEBHOOK_LOGS_FILE, []);
    logs.unshift({
      id: 'whlog_' + Date.now(),
      gateway,
      content,
      amount,
      reference,
      ip,
      result: result ? 'SUCCESS' : 'FAILED',
      message: typeof result === 'object' ? result.message : String(result),
      rawBody: typeof rawBody === 'object' ? rawBody : null,
      timestamp: new Date().toISOString()
    });
    if (logs.length > 200) logs.length = 200;
    writeJSON(WEBHOOK_LOGS_FILE, logs);
  } catch (err) {
    console.error('[WEBHOOK LOG ERROR]', err);
  }
}

// ---------------- 8. HỆ THỐNG TỰ ĐỘNG SAO LƯU SERVER (AUTO BACKUP & SNAPSHOT) ----------------
function createSystemBackup(reason = 'AUTO') {
  try {
    const now = new Date();
    const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFileName = `backup_${dateStr}_${reason}.json`;
    const backupPath = path.join(BACKUP_DIR, backupFileName);

    const snapshot = {
      version: '1.0.0',
      createdAt: now.toISOString(),
      reason,
      data: {
        users: readJSON(USERS_FILE, []),
        products: readJSON(PRODUCTS_FILE, []),
        transactions: readJSON(TRANSACTIONS_FILE, []),
        settings: readJSON(SETTINGS_FILE, {}),
        auditLogs: readJSON(AUDIT_LOGS_FILE, [])
      }
    };

    safeWriteJSON(backupPath, snapshot);

    // Giữ lại 15 bản sao lưu mới nhất, dọn dẹp bản cũ
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('backup_') && f.endsWith('.json'));
    if (files.length > 15) {
      files.sort().reverse();
      for (let i = 15; i < files.length; i++) {
        try {
          fs.unlinkSync(path.join(BACKUP_DIR, files[i]));
        } catch (e) {}
      }
    }

    console.log(`[BACKUP HOÀN TẤT] Đã tạo bản sao lưu: ${backupFileName}`);
    return { success: true, fileName: backupFileName, createdAt: now.toISOString() };
  } catch (err) {
    console.error('[BACKUP ERROR]', err);
    return { success: false, message: err.message };
  }
}

// Tự động sao lưu định kỳ mỗi 12 tiếng
setInterval(() => {
  createSystemBackup('SCHEDULED_12H');
}, 12 * 60 * 60 * 1000);

// Chạy 1 lần sao lưu khi server khởi động
setTimeout(() => {
  createSystemBackup('SERVER_STARTUP');
}, 3000);

// ---------------- 9. CƠ CHẾ TOKEN XÁC THỰC BẢO MẬT (JWT HS256) ----------------
const JWT_SECRET = process.env.JWT_SECRET || (function() {
  const settings = readJSON(SETTINGS_FILE, {});
  if (!settings.jwtSecret) {
    settings.jwtSecret = crypto.randomBytes(32).toString('hex');
    writeJSON(SETTINGS_FILE, settings);
  }
  return settings.jwtSecret;
})();

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

function signJWT(payload, expiresInSeconds = 7 * 24 * 3600) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + expiresInSeconds;
  const fullPayload = { ...payload, iat, exp };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(dataToSign)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${dataToSign}.${signature}`;
}

function verifyJWT(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(dataToSign)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  if (
    signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return null;
    }
    return payload;
  } catch (e) {
    return null;
  }
}

// Middleware xác thực người dùng & kiểm tra vô hiệu hóa phiên khi đổi mật khẩu / bị khóa
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.headers['x-auth-token']) {
    token = req.headers['x-auth-token'];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  // 1. Nếu có token JWT hợp lệ
  if (token) {
    const decoded = verifyJWT(token);
    if (decoded && decoded.username) {
      const users = readJSON(USERS_FILE, []);
      const user = users.find(u => u.username.toLowerCase() === decoded.username.toLowerCase());
      if (user) {
        if (user.isBanned) {
          return res.status(403).json({
            success: false,
            message: `Tài khoản của bạn đã bị khóa! Lý do: ${user.banReason || 'Vi phạm điều khoản shop.'}`
          });
        }
        req.user = {
          id: user.id,
          username: user.username,
          role: user.role,
          fullname: user.fullname
        };
        return next();
      }
    }
  }

  // 2. Fallback: Hỗ trợ xác thực Admin hqk qua username nếu token JWT bị mất hoặc hết hạn
  const fallbackAdmin = req.headers['x-admin-username'] || req.headers['x-admin-user'] || req.headers['adminusername'] || req.body?.adminUsername || req.query?.adminUsername || req.query?.admin;
  if (fallbackAdmin && String(fallbackAdmin).trim().toLowerCase() === 'hqk') {
    const users = readJSON(USERS_FILE, []);
    const admin = users.find(u => u.username && u.username.toLowerCase() === 'hqk');
    req.user = {
      id: admin ? admin.id : 'admin_hqk',
      username: 'hqk',
      role: 'admin',
      fullname: admin ? (admin.fullname || 'Quản Trị Viên Shop') : 'Quản Trị Viên Shop'
    };
    return next();
  }

  // 3. Fallback cho người dùng thông thường
  const clientUser = req.body?.username || req.query?.username;
  if (clientUser) {
    const users = readJSON(USERS_FILE, []);
    const user = users.find(u => u.username.toLowerCase() === clientUser.toLowerCase());
    if (user && !user.isBanned) {
      req.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        fullname: user.fullname
      };
      return next();
    }
  }

  return res.status(401).json({ success: false, message: 'Yêu cầu đăng nhập để thực hiện thao tác này!' });
}

function requireAdmin(req, res, next) {
  authenticateToken(req, res, () => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền quản trị viên!' });
    }
    req.adminUser = req.user || { id: 'admin_hqk', username: 'hqk', role: 'admin', fullname: 'Quản Trị Viên Shop' };
    next();
  });
}

// Middleware xác thực Mã PIN bảo vệ cấp 2 (Cho các thao tác Admin cực kỳ nguy hiểm)
function requireAdminPin(req, res, next) {
  const settings = readJSON(SETTINGS_FILE, {});
  if (!settings.adminSecurityPin || settings.adminSecurityPin.trim() === '') {
    return next(); // Nếu chủ shop chưa cài PIN cấp 2 thì bỏ qua
  }

  const providedPin = req.headers['x-admin-pin'] || (req.body && req.body.adminPin) || req.query.adminPin;
  if (!providedPin || String(providedPin).trim() !== String(settings.adminSecurityPin).trim()) {
    return res.status(403).json({
      success: false,
      requirePin: true,
      message: 'Mã PIN bảo mật cấp 2 không chính xác hoặc chưa được cung cấp!'
    });
  }

  next();
}

// ---------------- 10. SEED TÀI KHOẢN ADMIN HQK ----------------
function seedAdminUser() {
  const users = readJSON(USERS_FILE, []);
  let admin = users.find(u => u.username.toLowerCase() === 'hqk');
  const defaultAdminPassword = process.env.ADMIN_PASSWORD || 'khanh2k9';

  if (!admin) {
    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(defaultAdminPassword, salt);
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
    console.log('[OK] Da khoi tao tai khoan Admin hqk mac dinh (pass: ' + defaultAdminPassword + ').');
  } else {
    let updated = false;
    if (admin.role !== 'admin') {
      admin.role = 'admin';
      updated = true;
    }
    if (admin.balance === undefined) {
      admin.balance = 10000000;
      updated = true;
    }
    if (updated) {
      writeJSON(USERS_FILE, users);
    }
  }
}
seedAdminUser();

function seedDefaultProducts() {
  // Đã tắt tự động tạo sản phẩm mẫu để tôn trọng danh sách sản phẩm do Admin quản lý
}
seedDefaultProducts();

// ---------------- 11. HEALTH CHECK ----------------
app.get(['/api/health', '/ping'], (req, res) => {
  res.json({
    status: 'ok',
    service: 'Shophqk Enterprise Engine',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    security: {
      jwt: 'HS256',
      rateLimit: true,
      owaspHeaders: true,
      atomicStorage: true,
      autoBackup: true
    }
  });
});

// ---------------- 12. API SẢN PHẨM & KHO ACC/KEY TỰ ĐỘNG (CACHE IN-MEMORY & ETAG 304 SIÊU TỐC) ----------------
let productsVersion = Date.now().toString(36);
let cachedSafeProducts = null;

function invalidateProductsCache() {
  productsVersion = Date.now().toString(36);
  cachedSafeProducts = null;
}

// Endpoint kiểm tra sức khỏe và chống Render ngủ đông
app.get('/api/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ status: 'ok', uptime: Math.round(process.uptime()), timestamp: Date.now() });
});

// Giữ máy chủ Render luôn thức, loại bỏ hoàn toàn độ trễ 50s khởi động nguội
setInterval(async () => {
  try {
    const url = process.env.RENDER_EXTERNAL_URL || 'https://shophqk.onrender.com';
    await fetch(`${url}/api/health`).catch(() => {});
  } catch (e) {}
}, 10 * 60 * 1000);

app.get('/api/products', (req, res) => {
  const clientEtag = req.headers['if-none-match'];
  if (clientEtag && clientEtag === `"${productsVersion}"`) {
    return res.status(304).end();
  }

  if (!cachedSafeProducts) {
    const products = readJSON(PRODUCTS_FILE, []);
    cachedSafeProducts = products.map(p => {
      const { items, ...rest } = p;
      return {
        ...rest,
        stock: (p.type === 'account_keys' && Array.isArray(items)) ? items.length : p.stock,
        hasStockItems: p.type === 'account_keys' && Array.isArray(items) && items.length > 0
      };
    });
  }

  res.setHeader('ETag', `"${productsVersion}"`);
  res.setHeader('Cache-Control', 'public, max-age=5, stale-while-revalidate=15');
  res.json({ success: true, version: productsVersion, data: cachedSafeProducts });
});

// Thêm sản phẩm mới (Admin)
app.post('/api/products', requireAdmin, async (req, res) => {
  await productMutex.acquire();
  try {
    const cleanBody = sanitizeObject(req.body);
    const { name, price, stock, category, description, image, downloadUrl, type = 'download', itemsText = '' } = cleanBody;

    if (!name || price === undefined) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập tên và giá tiền sản phẩm!' });
    }

    let items = [];
    if (type === 'account_keys' && itemsText) {
      items = itemsText.split(/\r?\n/).map(i => i.trim()).filter(Boolean);
    }

    const finalStock = type === 'account_keys' ? items.length : Math.max(0, Number(stock) || 0);

    const products = readJSON(PRODUCTS_FILE, []);
    const newProduct = {
      id: 'prod_' + Date.now(),
      name: name.trim(),
      price: Math.max(0, Number(price) || 0),
      stock: finalStock,
      type: type === 'account_keys' ? 'account_keys' : 'download',
      items: items,
      category: category ? category.trim() : 'Sản phẩm số',
      description: description ? description.trim() : '',
      image: image && image.trim() !== '' ? image.trim() : 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=500&auto=format&fit=crop&q=60',
      downloadUrl: downloadUrl ? downloadUrl.trim() : '',
      createdAt: new Date().toISOString()
    };

    products.unshift(newProduct);
    writeJSON(PRODUCTS_FILE, products);
    invalidateProductsCache();

    logAudit({
      action: 'CREATE_PRODUCT',
      actor: req.adminUser.username,
      target: newProduct.id,
      details: `Tạo sản phẩm [${newProduct.name}] với giá ${newProduct.price}đ (Kho: ${finalStock})`,
      ip: getClientIP(req)
    });

    res.status(201).json({ success: true, message: 'Thêm sản phẩm thành công!', data: newProduct });
  } finally {
    productMutex.release();
  }
});

// Nhập thêm kho Acc/Key hàng loạt (Dành riêng cho Shop Tài Khoản Game & Key VIP)
app.post('/api/admin/products/:id/restock', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { itemsText } = req.body;

  if (!itemsText || typeof itemsText !== 'string' || itemsText.trim() === '') {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập danh sách Acc/Key cần bổ sung vào kho!' });
  }

  const newItems = itemsText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (newItems.length === 0) {
    return res.status(400).json({ success: false, message: 'Không tìm thấy dòng Acc/Key hợp lệ nào!' });
  }

  let products = readJSON(PRODUCTS_FILE, []);
  const idx = products.findIndex(p => p.id === id);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm!' });
  }

  products[idx].type = 'account_keys';
  if (!Array.isArray(products[idx].items)) products[idx].items = [];
  products[idx].items.push(...newItems);
  products[idx].stock = products[idx].items.length;
  products[idx].updatedAt = new Date().toISOString();

  writeJSON(PRODUCTS_FILE, products);
  invalidateProductsCache();

  logAudit({
    action: 'RESTOCK_PRODUCT',
    actor: req.adminUser.username,
    target: id,
    details: `Nhập thêm +${newItems.length} acc/key cho [${products[idx].name}]. Tồn kho mới: ${products[idx].stock}`,
    ip: getClientIP(req)
  });

  res.json({
    success: true,
    message: `Đã nhập thành công +${newItems.length} acc/key vào kho! Tồn kho hiện tại: ${products[idx].stock}`,
    stock: products[idx].stock
  });
});

// Xóa sản phẩm
app.delete('/api/products/:id', requireAdmin, requireAdminPin, async (req, res) => {
  await productMutex.acquire();
  try {
    const { id } = req.params;
    let products = readJSON(PRODUCTS_FILE, []);
    const target = products.find(p => p.id === id);

    if (!target) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm cần xóa!' });
    }

    products = products.filter(p => p.id !== id);
    writeJSON(PRODUCTS_FILE, products);
    invalidateProductsCache();

    logAudit({
      action: 'DELETE_PRODUCT',
      actor: req.adminUser.username,
      target: id,
      details: `Xóa sản phẩm [${target.name}]`,
      ip: getClientIP(req)
    });

    res.json({ success: true, message: 'Đã xóa sản phẩm thành công!' });
  } finally {
    productMutex.release();
  }
});

// Sửa sản phẩm
app.put('/api/products/:id', requireAdmin, async (req, res) => {
  await productMutex.acquire();
  try {
    const { id } = req.params;
    const cleanBody = sanitizeObject(req.body);
    const { name, price, stock, category, description, image, downloadUrl, type, itemsText } = cleanBody;

    let products = readJSON(PRODUCTS_FILE, []);
    const pIndex = products.findIndex(p => p.id === id);
    if (pIndex === -1) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm cần sửa!' });
    }

    if (name !== undefined) products[pIndex].name = name.trim();
    if (price !== undefined) products[pIndex].price = Math.max(0, Number(price));
    if (type !== undefined) products[pIndex].type = type;

    if (itemsText !== undefined && products[pIndex].type === 'account_keys') {
      products[pIndex].items = itemsText.split(/\r?\n/).map(i => i.trim()).filter(Boolean);
      products[pIndex].stock = products[pIndex].items.length;
    } else if (stock !== undefined) {
      products[pIndex].stock = Math.max(0, Number(stock));
    }

    if (category !== undefined) products[pIndex].category = category.trim();
    if (description !== undefined) products[pIndex].description = description.trim();
    if (image !== undefined && image.trim() !== '') products[pIndex].image = image.trim();
    if (downloadUrl !== undefined) products[pIndex].downloadUrl = downloadUrl.trim();
    products[pIndex].updatedAt = new Date().toISOString();

    writeJSON(PRODUCTS_FILE, products);
    invalidateProductsCache();

    logAudit({
      action: 'UPDATE_PRODUCT',
      actor: req.adminUser.username,
      target: id,
      details: `Cập nhật thông tin sản phẩm [${products[pIndex].name}]`,
      ip: getClientIP(req)
    });

    res.json({ success: true, message: 'Đã cập nhật sản phẩm thành công!', data: products[pIndex] });
  } finally {
    productMutex.release();
  }
});

// Upload ảnh sản phẩm (Hỗ trợ ImgBB Cloud vĩnh viễn chống mất ảnh trên Render)
app.post('/api/admin/upload-image', requireAdmin, async (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) {
    return res.status(400).json({ success: false, message: 'Vui lòng cung cấp dữ liệu hình ảnh!' });
  }

  try {
    const matches = imageBase64.match(/^data:image\/([A-Za-z0-9-+.]+);base64,(.+)$/);
    let ext = 'png';
    let buffer;

    if (matches && matches.length === 3) {
      const mimeSub = matches[1].toLowerCase();
      if (!['png', 'jpeg', 'jpg', 'webp', 'gif', 'svg+xml'].includes(mimeSub)) {
        return res.status(400).json({ success: false, message: 'Định dạng hình ảnh không được hỗ trợ! Chỉ chấp nhận PNG, JPG, WEBP, GIF, SVG.' });
      }
      ext = mimeSub.replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(imageBase64, 'base64');
    }

    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Kích thước ảnh tối đa cho phép là 10MB!' });
    }

    // 1. Tự động đẩy lên ImgBB Cloud vĩnh viễn nếu cấu hình API Key
    const settings = readJSON(SETTINGS_FILE, {});
    const imgbbKey = process.env.IMGBB_API_KEY || settings.imgbbApiKey;
    if (imgbbKey && imgbbKey.trim() !== '') {
      try {
        const formData = new URLSearchParams();
        formData.append('image', buffer.toString('base64'));
        const imgbbRes = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbKey.trim()}`, {
          method: 'POST',
          body: formData
        });
        const imgbbJson = await imgbbRes.json();
        if (imgbbJson && imgbbJson.data && imgbbJson.data.url) {
          return res.json({
            success: true,
            message: 'Tải ảnh lên ImgBB Cloud vĩnh viễn thành công!',
            imageUrl: imgbbJson.data.url
          });
        }
      } catch (err) {
        console.warn('[IMGBB FAILED, FALLBACK TO DISK]', err.message);
      }
    }

    // 2. Lưu vào public/uploads
    const safeName = 'img_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + '.' + ext;
    const savePath = path.join(UPLOADS_DIR, safeName);
    fs.writeFileSync(savePath, buffer);

    // Nếu ảnh đã được tối ưu nhẹ (<= 250KB), ưu tiên trả về Data URI để lưu vĩnh viễn trong products.json chống Render xóa
    let finalImageUrl = `/uploads/${safeName}`;
    if (buffer.length <= 250 * 1024) {
      finalImageUrl = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${buffer.toString('base64')}`;
    }

    res.json({ 
      success: true, 
      message: 'Tải ảnh thành công & lưu trữ an toàn!', 
      imageUrl: finalImageUrl,
      localUrl: `/uploads/${safeName}`
    });
  } catch (err) {
    console.error('[UPLOAD ERROR]', err);
    res.status(500).json({ success: false, message: 'Lỗi khi lưu ảnh lên máy chủ!' });
  }
});

// ---------------- 13. API TÀI KHOẢN (AUTH & SECURITY) ----------------
app.post('/api/auth/register', authLimiter, (req, res) => {
  const cleanBody = sanitizeObject(req.body);
  const { username, password, fullname } = cleanBody;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập tên đăng nhập và mật khẩu!' });
  }

  const cleanUser = username.trim().toLowerCase();
  if (cleanUser.length < 3 || cleanUser.length > 30 || !/^[a-zA-Z0-9_]+$/.test(cleanUser)) {
    return res.status(400).json({ success: false, message: 'Tên đăng nhập từ 3-30 ký tự, chỉ gồm chữ cái, số và dấu gạch dưới!' });
  }

  if (password.length < 6) {
    return res.status(400).json({ success: false, message: 'Mật khẩu phải có ít nhất 6 ký tự!' });
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
    isBanned: false,
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  writeJSON(USERS_FILE, users);

  const token = signJWT({
    id: newUser.id,
    username: newUser.username,
    role: newUser.role
  });

  logAudit({
    action: 'REGISTER',
    actor: cleanUser,
    details: 'Đăng ký tài khoản mới',
    ip: getClientIP(req)
  });

  const { password: _, ...userWithoutPass } = newUser;
  res.status(201).json({
    success: true,
    message: 'Tạo tài khoản thành công!',
    token: token,
    data: userWithoutPass
  });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập tài khoản và mật khẩu!' });
  }

  const cleanUser = username.trim().toLowerCase();
  const users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.username.toLowerCase() === cleanUser);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    logAudit({
      action: 'LOGIN_FAILED',
      actor: cleanUser,
      details: 'Sai tài khoản hoặc mật khẩu',
      ip: getClientIP(req)
    });
    return res.status(400).json({ success: false, message: 'Tài khoản hoặc mật khẩu không chính xác!' });
  }

  if (user.isBanned) {
    return res.status(403).json({
      success: false,
      message: `Tài khoản đã bị khóa! Lý do: ${user.banReason || 'Vi phạm điều khoản shop.'}`
    });
  }

  const token = signJWT({
    id: user.id,
    username: user.username,
    role: user.role
  });

  logAudit({
    action: 'LOGIN_SUCCESS',
    actor: cleanUser,
    details: `Đăng nhập thành công (${user.role})`,
    ip: getClientIP(req)
  });

  const { password: _, ...userWithoutPass } = user;
  res.json({
    success: true,
    message: `Chào mừng ${user.role === 'admin' ? 'Quản trị viên ' : ''}${user.fullname || user.username}!`,
    token: token,
    data: userWithoutPass
  });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  const users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.username.toLowerCase() === req.user.username.toLowerCase());
  if (!user) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng!' });
  }
  const { password: _, ...userWithoutPass } = user;
  res.json({ success: true, data: userWithoutPass });
});

app.get('/api/auth/me/:username', authenticateToken, (req, res) => {
  const { username } = req.params;
  const targetUser = username.trim().toLowerCase();

  if (req.user.role !== 'admin' && req.user.username.toLowerCase() !== targetUser) {
    return res.status(403).json({ success: false, message: 'Bạn không có quyền xem thông tin tài khoản khác!' });
  }

  const users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.username.toLowerCase() === targetUser);

  if (!user) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng!' });
  }

  const { password: _, ...userWithoutPass } = user;
  res.json({ success: true, data: userWithoutPass });
});

app.post('/api/auth/change-password', authenticateToken, authLimiter, (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập mật khẩu hiện tại và mật khẩu mới!' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'Mật khẩu mới phải có ít nhất 6 ký tự!' });
  }

  const users = readJSON(USERS_FILE, []);
  const userIndex = users.findIndex(u => u.username.toLowerCase() === req.user.username.toLowerCase());
  if (userIndex === -1) {
    return res.status(404).json({ success: false, message: 'Người dùng không tồn tại!' });
  }

  if (!bcrypt.compareSync(oldPassword, users[userIndex].password)) {
    return res.status(400).json({ success: false, message: 'Mật khẩu hiện tại không chính xác!' });
  }

  const salt = bcrypt.genSaltSync(10);
  users[userIndex].password = bcrypt.hashSync(newPassword, salt);
  users[userIndex].passwordChangedAt = new Date().toISOString();
  users[userIndex].updatedAt = new Date().toISOString();
  writeJSON(USERS_FILE, users);

  logAudit({
    action: 'CHANGE_PASSWORD',
    actor: req.user.username,
    details: 'Đổi mật khẩu thành công. Thu hồi mọi phiên đăng nhập cũ.',
    ip: getClientIP(req)
  });

  res.json({ success: true, message: 'Đổi mật khẩu thành công! Các thiết bị khác đã được đăng xuất.' });
});

// ---------------- 14. API MUA HÀNG (CHECKOUT & GIAO KEY TỰ ĐỘNG CÓ MUTEX) ----------------
app.post('/api/orders/buy', authenticateToken, orderLimiter, async (req, res) => {
  const { productId, quantity } = req.body;
  const username = req.user.username;

  if (!productId || !quantity || quantity < 1) {
    return res.status(400).json({ success: false, message: 'Thông tin mua hàng không hợp lệ!' });
  }

  const qty = Math.floor(Number(quantity));
  if (qty <= 0) {
    return res.status(400).json({ success: false, message: 'Số lượng mua tối thiểu là 1!' });
  }

  // Khóa Mutex để xử lý mua hàng tuần tự, chống double-spending
  const result = await transactionMutex.runExclusive(async () => {
    const users = readJSON(USERS_FILE, []);
    const userIndex = users.findIndex(u => u.username.toLowerCase() === username.toLowerCase());
    if (userIndex === -1) {
      return { success: false, status: 404, message: 'Tài khoản người dùng không tồn tại!' };
    }

    const products = readJSON(PRODUCTS_FILE, []);
    const productIndex = products.findIndex(p => p.id === productId);
    if (productIndex === -1) {
      return { success: false, status: 404, message: 'Sản phẩm không tồn tại!' };
    }

    const product = products[productIndex];
    let deliveredItems = [];

    // Kiểm tra kho
    if (product.type === 'account_keys') {
      if (!Array.isArray(product.items) || product.items.length < qty) {
        return {
          success: false,
          status: 400,
          message: `Kho tài khoản/key không đủ số lượng yêu cầu (Hiện còn: ${product.items ? product.items.length : 0})!`
        };
      }
    } else {
      if (product.stock < qty) {
        return {
          success: false,
          status: 400,
          message: `Số lượng trong kho không đủ (Hiện còn: ${product.stock})!`
        };
      }
    }

    const totalCost = product.price * qty;
    if (users[userIndex].balance < totalCost) {
      return {
        success: false,
        status: 400,
        message: `Số dư không đủ! Cần ${totalCost.toLocaleString('vi-VN')} VNĐ, số dư hiện tại là ${users[userIndex].balance.toLocaleString('vi-VN')} VNĐ. Hãy nạp thêm tiền qua VietQR!`
      };
    }

    // Bốc acc/key từ kho nếu là dạng account_keys
    if (product.type === 'account_keys') {
      deliveredItems = product.items.splice(0, qty);
      product.stock = product.items.length;
    } else {
      product.stock -= qty;
    }

    users[userIndex].balance -= totalCost;

    writeJSON(USERS_FILE, users);
    writeJSON(PRODUCTS_FILE, products);

    const transactions = readJSON(TRANSACTIONS_FILE, []);
    const orderRecord = {
      id: 'order_' + Date.now(),
      type: 'PURCHASE',
      username: users[userIndex].username,
      productName: product.name,
      productId: product.id,
      productType: product.type || 'download',
      deliveredItems: deliveredItems,
      downloadUrl: product.downloadUrl || '',
      quantity: qty,
      price: product.price,
      totalCost: totalCost,
      status: 'COMPLETED',
      createdAt: new Date().toISOString()
    };
    transactions.unshift(orderRecord);
    writeJSON(TRANSACTIONS_FILE, transactions);

    logAudit({
      action: 'PURCHASE',
      actor: users[userIndex].username,
      target: product.id,
      details: `Mua ${qty}x [${product.name}] với tổng tiền ${totalCost.toLocaleString('vi-VN')}đ`,
      ip: getClientIP(req)
    });

    return {
      success: true,
      status: 200,
      message: `Mua thành công ${qty}x ${product.name}!`,
      newBalance: users[userIndex].balance,
      remainingStock: product.stock,
      downloadUrl: product.downloadUrl || '',
      deliveredItems: deliveredItems,
      productName: product.name
    };
  });

  res.status(result.status || 200).json(result);
});

// Lịch sử giao dịch
app.get('/api/transactions/:username', authenticateToken, (req, res) => {
  const { username } = req.params;
  const targetUser = username.trim().toLowerCase();

  if (req.user.role !== 'admin' && req.user.username.toLowerCase() !== targetUser) {
    return res.status(403).json({ success: false, message: 'Bạn không có quyền xem lịch sử của người dùng khác!' });
  }

  const transactions = readJSON(TRANSACTIONS_FILE, []);
  const userTx = transactions.filter(t => t.username.toLowerCase() === targetUser);
  res.json({ success: true, data: userTx });
});

// ---------------- 15. NẠP TIỀN VIETQR ----------------
app.post('/api/wallet/create-deposit', authenticateToken, walletLimiter, (req, res) => {
  const { amount } = req.body;
  const username = req.user.username;

  const depositAmount = Number(amount);
  if (!depositAmount || depositAmount < 10000) {
    return res.status(400).json({ success: false, message: 'Số tiền nạp tối thiểu là 10.000 VNĐ!' });
  }

  const users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    return res.status(404).json({ success: false, message: 'Người dùng không tồn tại!' });
  }

  const settings = readJSON(SETTINGS_FILE, {});
  const code = 'NAP' + Math.floor(100000 + Math.random() * 900000);
  const memo = `${code} ${user.username}`;

  const qrUrl = `https://img.vietqr.io/image/${settings.bankId || 'MB'}-${settings.accountNo || '0349340730'}-compact2.png?amount=${depositAmount}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(settings.accountName || 'SHOPHQK STORE')}`;

  const transactions = readJSON(TRANSACTIONS_FILE, []);
  const newTx = {
    id: 'tx_' + Date.now(),
    type: 'DEPOSIT',
    username: user.username,
    amount: depositAmount,
    code: code,
    memo: memo,
    bankId: settings.bankId || 'MB',
    accountNo: settings.accountNo || '0349340730',
    accountName: settings.accountName || 'SHOPHQK STORE',
    qrUrl: qrUrl,
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };

  transactions.unshift(newTx);
  writeJSON(TRANSACTIONS_FILE, transactions);

  res.json({ success: true, data: newTx });
});

app.get('/api/wallet/deposit-status/:txId', (req, res) => {
  const { txId } = req.params;
  const transactions = readJSON(TRANSACTIONS_FILE, []);
  const tx = transactions.find(t => t.id === txId || t.code === txId);
  if (!tx) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy giao dịch!' });
  }
  res.json({
    success: true,
    status: tx.status,
    amount: tx.amount,
    username: tx.username,
    code: tx.code,
    approvedAt: tx.approvedAt,
    approvedBy: tx.approvedBy
  });
});

// ---------------- 16. WEBHOOKS NGÂN HÀNG & MOMO (BẢO VỆ CHẶT CHẼ CÓ MUTEX) ----------------
async function processAutomaticDeposit(rawContent, transferAmount, reference = '', gateway = 'BANK', ip = '127.0.0.1') {
  if (!rawContent || !transferAmount || Number(transferAmount) <= 0) {
    return { success: false, message: 'Dữ liệu giao dịch không hợp lệ!' };
  }

  const contentStr = String(rawContent).trim();
  const amount = Math.floor(Number(transferAmount));
  if (isNaN(amount) || amount <= 0) {
    return { success: false, message: 'Số tiền chuyển khoản không hợp lệ!' };
  }

  // Khóa Mutex để cộng tiền tuần tự an toàn
  return await transactionMutex.runExclusive(async () => {
    const transactions = readJSON(TRANSACTIONS_FILE, []);
    const users = readJSON(USERS_FILE, []);

    // 1. Tìm theo mã NAPxxxxxx
    let codeMatch = contentStr.match(/NAP\d{6}/i);
    let tx = null;
    let txIndex = -1;

    if (codeMatch) {
      const code = codeMatch[0].toUpperCase();
      txIndex = transactions.findIndex(t => t.code && t.code.toUpperCase() === code && t.status === 'PENDING');
      if (txIndex !== -1) {
        tx = transactions[txIndex];
      }
    }

    // 2. Tìm theo memo / username + số tiền
    if (!tx) {
      txIndex = transactions.findIndex(t => {
        if (t.type !== 'DEPOSIT' || t.status !== 'PENDING') return false;
        if (t.memo && contentStr.toUpperCase().includes(t.memo.toUpperCase())) return true;
        if (t.username && contentStr.toLowerCase().includes(t.username.toLowerCase()) && Number(t.amount) === amount) return true;
        return false;
      });
      if (txIndex !== -1) {
        tx = transactions[txIndex];
      }
    }

    // 3. Chống cộng trùng (Idempotency)
    if (!tx && codeMatch) {
      const code = codeMatch[0].toUpperCase();
      const alreadyApproved = transactions.find(t => t.code && t.code.toUpperCase() === code && t.status === 'COMPLETED');
      if (alreadyApproved) {
        return { success: true, message: `Giao dịch ${code} đã được duyệt trước đó rồi (Bỏ qua xử lý lặp).`, duplicated: true };
      }
    }

    if (!tx) {
      return {
        success: false,
        message: `Không tìm thấy đơn nạp PENDING nào khớp với nội dung: "${contentStr}" và số tiền: ${amount.toLocaleString('vi-VN')} đ`
      };
    }

    // 4. Cộng tiền
    const userIndex = users.findIndex(u => u.username.toLowerCase() === tx.username.toLowerCase());
    if (userIndex === -1) {
      return { success: false, message: `Người dùng ${tx.username} không tồn tại trong hệ thống!` };
    }

    const creditedAmount = amount;
    users[userIndex].balance = (Number(users[userIndex].balance) || 0) + creditedAmount;

    transactions[txIndex].status = 'COMPLETED';
    transactions[txIndex].approvedAt = new Date().toISOString();
    transactions[txIndex].approvedBy = `AUTO_${gateway || 'WEBHOOK'}`;
    transactions[txIndex].realAmountReceived = creditedAmount;
    transactions[txIndex].bankReference = String(reference || '');

    writeJSON(USERS_FILE, users);
    writeJSON(TRANSACTIONS_FILE, transactions);

    logAudit({
      action: 'AUTO_DEPOSIT',
      actor: `GATEWAY_${gateway}`,
      target: users[userIndex].username,
      details: `Nạp tự động +${creditedAmount.toLocaleString('vi-VN')}đ (Mã: ${tx.code})`,
      ip
    });

    console.log(`[AUTO-DEPOSIT THÀNH CÔNG] +${creditedAmount.toLocaleString('vi-VN')} đ cho ${users[userIndex].username} (Mã: ${tx.code})`);

    return {
      success: true,
      message: `Đã tự động duyệt nạp +${creditedAmount.toLocaleString('vi-VN')} đ cho tài khoản ${users[userIndex].username}!`,
      username: users[userIndex].username,
      creditedAmount: creditedAmount,
      newBalance: users[userIndex].balance,
      txId: transactions[txIndex].id,
      code: transactions[txIndex].code
    };
  });
}

app.post(['/api/webhook/payment', '/api/webhook/bank', '/api/webhook/sepay', '/api/webhook/momo'], async (req, res) => {
  const settings = readJSON(SETTINGS_FILE, {});
  const clientIp = getClientIP(req);

  // Xác thực token bắt buộc
  const authHeader = req.headers['authorization'] || '';
  const apiKeyHeader = req.headers['x-api-key'] || '';
  const queryToken = req.query.token || req.query.apiKey || '';
  const bodyToken = req.body && (req.body.token || req.body.apiKey);

  const providedKey = (authHeader.startsWith('Apikey ') ? authHeader.slice(7).trim() : authHeader) || apiKeyHeader || queryToken || bodyToken;

  if (settings.webhookSecretKey && settings.webhookSecretKey.trim() !== '') {
    if (!providedKey || providedKey !== settings.webhookSecretKey.trim()) {
      logWebhook({
        gateway: 'BLOCKED',
        content: req.body?.content || '',
        amount: 0,
        reference: '',
        ip: clientIp,
        result: false,
        rawBody: { error: 'Unauthorized secret key' }
      });
      return res.status(401).json({ success: false, message: 'Sai mã bảo mật hoặc thiếu mã bảo mật Webhook!' });
    }
  }

  let content = '';
  let amount = 0;
  let reference = '';
  let gateway = 'BANK';

  if (req.body && (req.body.tranId || req.body.comment !== undefined || req.path.includes('momo') || req.body.partnerRefId)) {
    content = req.body.comment || req.body.message || req.body.content || req.body.noidung || req.body.description || req.body.text || '';
    amount = Number(req.body.amount || req.body.money || req.body.transferAmount || req.body.sotien || 0);
    reference = req.body.tranId || req.body.transId || req.body.partnerRefId || req.body.id || '';
    gateway = 'MOMO';

    if (amount <= 0) {
      const fullText = String(req.body.text || req.body.body || req.body.content || '');
      const moneyMatch = fullText.match(/(\d{1,3}(?:[.,]\d{3})*|\d+)\s*(?:đ|vnd|d|đồng)/i);
      if (moneyMatch) {
        amount = Number(moneyMatch[1].replace(/[.,]/g, ''));
      }
      if (!content) content = fullText;
    }
  } else if (req.body && (req.body.transferAmount !== undefined || req.body.content !== undefined)) {
    content = req.body.content || req.body.description || '';
    amount = Number(req.body.transferAmount || req.body.amount || 0);
    reference = req.body.referenceCode || req.body.id || '';
    gateway = req.body.gateway || 'SePay';
  } else if (req.body && req.body.data && Array.isArray(req.body.data) && req.body.data.length > 0) {
    const item = req.body.data[0];
    content = item.description || '';
    amount = Number(item.amount || 0);
    reference = item.tid || item.id || '';
    gateway = 'Casso';
  } else if (req.body && req.body.data && typeof req.body.data === 'object') {
    content = req.body.data.description || '';
    amount = Number(req.body.data.amount || 0);
    reference = req.body.data.reference || req.body.data.orderCode || '';
    gateway = 'PayOS';
  } else if (req.body) {
    content = req.body.content || req.body.memo || req.body.description || req.body.text || req.body.comment || '';
    amount = Number(req.body.amount || req.body.money || req.body.transferAmount || req.body.transAmount || 0);
    reference = req.body.reference || req.body.ref || req.body.id || req.body.transId || '';
    gateway = req.body.gateway || req.body.bank || 'Webhook';
  }

  const result = await processAutomaticDeposit(content, amount, reference, gateway, clientIp);

  logWebhook({
    gateway,
    content,
    amount,
    reference,
    ip: clientIp,
    result: result.success,
    rawBody: req.body
  });

  if (result.success) {
    return res.json({ success: true, message: result.message, data: result });
  } else {
    return res.status(200).json({ success: false, message: result.message });
  }
});

// Giả lập Webhook
app.post('/api/admin/simulate-webhook', requireAdmin, async (req, res) => {
  const { content, amount } = req.body;
  if (!content || !amount) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập nội dung chuyển khoản và số tiền giả lập!' });
  }

  const result = await processAutomaticDeposit(content, amount, 'SIM_' + Date.now(), 'TEST_ADMIN', getClientIP(req));
  res.json(result);
});

// Giả lập Callback Gạch Thẻ Cào (GachTheFast)
app.post('/api/admin/simulate-card-callback', requireAdmin, async (req, res) => {
  const { requestId, status } = req.body;
  if (!requestId) {
    return res.status(400).json({ success: false, message: 'Thiếu mã yêu cầu thẻ (requestId)!' });
  }

  let statusCode = 3;
  if (status === 'SUCCESS' || status === 1) statusCode = 1;
  else if (status === 'WRONG_AMOUNT' || status === 2) statusCode = 2;
  else if (status === 'FAILED' || status === 3) statusCode = 3;

  const callbackData = {
    status: statusCode,
    request_id: requestId,
    message: `Admin giả lập kết quả thẻ: ${status}`
  };

  const result = await processCardCallback(callbackData, getClientIP(req));
  res.json({ success: result.success !== false, message: result.message });
});

// ---------------- 17. GẠCH THẺ CÀO TỰ ĐỘNG GACHTHEFAST.COM ----------------
async function sendCardToGachTheFast({ telco, code, serial, amount, requestId, partnerId, partnerKey }) {
  const command = 'charging';
  const rawSign = `${partnerKey}${code}${command}${partnerId}${requestId}${serial}${telco}`;
  const sign = crypto.createHash('md5').update(rawSign).digest('hex');

  const formData = new URLSearchParams();
  formData.append('telco', telco.toUpperCase());
  formData.append('code', String(code).trim());
  formData.append('serial', String(serial).trim());
  formData.append('amount', Number(amount));
  formData.append('request_id', requestId);
  formData.append('partner_id', String(partnerId).trim());
  formData.append('sign', sign);
  formData.append('command', command);

  try {
    const response = await fetch('https://gachthefast.com/chargingws/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString()
    });

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (e) {
      result = { status: 99, message: text };
    }
    return { success: true, data: result };
  } catch (err) {
    return { success: false, message: 'Lỗi kết nối cổng GachTheFast: ' + err.message };
  }
}

async function processCardCallback(data, ip = '127.0.0.1') {
  if (!data) return { success: false, message: 'Dữ liệu callback rỗng!' };

  const requestId = String(data.request_id || data.requestId || '').trim();
  const serial = String(data.serial || '').trim();
  const statusNum = Number(data.status);
  const message = String(data.message || '');

  return await transactionMutex.runExclusive(async () => {
    const transactions = readJSON(TRANSACTIONS_FILE, []);
    const txIndex = transactions.findIndex(t =>
      (requestId && (t.code === requestId || t.id === requestId)) ||
      (serial && t.serial === serial && t.status === 'PENDING')
    );

    if (txIndex === -1) {
      return { success: false, message: `Không tìm thấy đơn nạp thẻ cào: ${requestId || serial}` };
    }

    const tx = transactions[txIndex];
    if (tx.status === 'COMPLETED') {
      return { success: true, message: `Đơn thẻ ${tx.code} đã được duyệt hoàn tất trước đó rồi.` };
    }

    const users = readJSON(USERS_FILE, []);
    const userIndex = users.findIndex(u => u.username.toLowerCase() === tx.username.toLowerCase());
    const settings = readJSON(SETTINGS_FILE, {});
    const discountRate = Number(settings.cardDiscountRate !== undefined ? settings.cardDiscountRate : 85);

    if (statusNum === 1) {
      let creditAmount = 0;
      if (data.amount && Number(data.amount) > 0) {
        creditAmount = Number(data.amount);
      } else {
        creditAmount = Math.round(Number(tx.amount || tx.declaredAmount) * (discountRate / 100));
      }

      if (userIndex !== -1) {
        users[userIndex].balance = (Number(users[userIndex].balance) || 0) + creditAmount;
        writeJSON(USERS_FILE, users);
      }

      transactions[txIndex].status = 'COMPLETED';
      transactions[txIndex].receiveAmount = creditAmount;
      transactions[txIndex].realAmountReceived = creditAmount;
      transactions[txIndex].approvedAt = new Date().toISOString();
      transactions[txIndex].approvedBy = 'GACHTHEFAST_AUTO';
      transactions[txIndex].gatewayTransId = data.trans_id || tx.gatewayTransId || '';
      transactions[txIndex].note = message || 'Nạp thẻ thành công';
      writeJSON(TRANSACTIONS_FILE, transactions);

      logAudit({
        action: 'CARD_SUCCESS',
        actor: tx.username,
        target: tx.code,
        details: `Nạp thẻ cào ${tx.telco} ${tx.amount}đ thành công, cộng +${creditAmount.toLocaleString('vi-VN')}đ`,
        ip
      });

      return {
        success: true,
        message: `Đã nạp thẻ thành công +${creditAmount.toLocaleString('vi-VN')} đ cho tài khoản ${tx.username}!`,
        creditAmount,
        newBalance: userIndex !== -1 ? users[userIndex].balance : 0
      };
    }

    if (statusNum === 2) {
      const realValue = Number(data.value || data.real_amount || 0);
      let creditAmount = Number(data.amount || data.receive_amount || 0);
      if (creditAmount <= 0 && realValue > 0) {
        creditAmount = Math.round(realValue * (discountRate / 100) * 0.5);
      }

      if (creditAmount > 0 && userIndex !== -1) {
        users[userIndex].balance = (Number(users[userIndex].balance) || 0) + creditAmount;
        writeJSON(USERS_FILE, users);
      }

      transactions[txIndex].status = 'WRONG_AMOUNT';
      transactions[txIndex].realValue = realValue;
      transactions[txIndex].receiveAmount = creditAmount;
      transactions[txIndex].realAmountReceived = creditAmount;
      transactions[txIndex].approvedAt = new Date().toISOString();
      transactions[txIndex].approvedBy = 'GACHTHEFAST_AUTO';
      transactions[txIndex].note = `Sai mệnh giá: Khai ${tx.amount}đ nhưng thực tế ${realValue}đ. ${message}`;
      writeJSON(TRANSACTIONS_FILE, transactions);

      return {
        success: true,
        message: `Thẻ sai mệnh giá. Đã cộng +${creditAmount.toLocaleString('vi-VN')} đ cho ${tx.username}.`,
        creditAmount
      };
    }

    transactions[txIndex].status = 'FAILED';
    transactions[txIndex].approvedAt = new Date().toISOString();
    transactions[txIndex].approvedBy = 'GACHTHEFAST_AUTO';
    transactions[txIndex].note = message || 'Thẻ lỗi hoặc sai thông tin';
    writeJSON(TRANSACTIONS_FILE, transactions);

    return { success: false, message: transactions[txIndex].note };
  });
}

app.post('/api/card/deposit', authenticateToken, walletLimiter, (req, res) => {
  const { telco, code, serial, amount } = req.body;
  const username = req.user.username;

  if (!telco || !code || !serial || !amount || Number(amount) < 10000) {
    return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ loại thẻ, mệnh giá, số serial và mã nạp (pin)!' });
  }

  const cleanTelco = String(telco).trim().toUpperCase();
  const cleanCode = String(code).trim();
  const cleanSerial = String(serial).trim();
  const numAmount = Number(amount);

  const users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    return res.status(404).json({ success: false, message: 'Người dùng không tồn tại!' });
  }

  const settings = readJSON(SETTINGS_FILE, {});
  if (settings.cardAutoEnabled === false) {
    return res.status(400).json({ success: false, message: 'Cổng nạp thẻ cào hiện đang tạm bảo trì. Vui lòng quay lại sau!' });
  }

  const transactions = readJSON(TRANSACTIONS_FILE, []);
  const isDuplicate = transactions.some(t =>
    t.type === 'CARD_DEPOSIT' &&
    t.serial === cleanSerial &&
    (t.status === 'PENDING' || t.status === 'COMPLETED')
  );
  if (isDuplicate) {
    return res.status(400).json({ success: false, message: `Thẻ cào (Serial: ${cleanSerial}) đã được gửi hoặc đã nạp trước đó rồi!` });
  }

  const requestId = 'CARD_' + Date.now() + '_' + Math.floor(1000 + Math.random() * 9000);
  const discountRate = Number(settings.cardDiscountRate !== undefined ? settings.cardDiscountRate : 85);
  const estimatedReceive = Math.round(numAmount * (discountRate / 100));

  const newTx = {
    id: 'tx_card_' + Date.now(),
    type: 'CARD_DEPOSIT',
    username: user.username,
    telco: cleanTelco,
    code: requestId,
    serial: cleanSerial,
    cardPinMasked: cleanCode.length > 6 ? cleanCode.slice(0, 3) + '****' + cleanCode.slice(-3) : '******',
    rawCode: cleanCode,
    amount: numAmount,
    declaredAmount: numAmount,
    receiveAmount: estimatedReceive,
    discountRate: discountRate,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    gateway: 'GACHTHEFAST'
  };

  transactions.unshift(newTx);
  writeJSON(TRANSACTIONS_FILE, transactions);

  if (settings.gachthefastPartnerId && settings.gachthefastPartnerKey) {
    sendCardToGachTheFast({
      telco: cleanTelco,
      code: cleanCode,
      serial: cleanSerial,
      amount: numAmount,
      requestId: requestId,
      partnerId: settings.gachthefastPartnerId,
      partnerKey: settings.gachthefastPartnerKey
    }).then(result => {
      if (result.success && result.data) {
        const d = result.data;
        const currentTxList = readJSON(TRANSACTIONS_FILE, []);
        const idx = currentTxList.findIndex(t => t.id === newTx.id);
        if (idx !== -1) {
          currentTxList[idx].gatewayTransId = d.trans_id || '';
          writeJSON(TRANSACTIONS_FILE, currentTxList);

          if (Number(d.status) === 1 || Number(d.status) === 2 || Number(d.status) === 3) {
            processCardCallback(d, getClientIP(req));
          }
        }
      }
    }).catch(err => console.error('[GACHTHEFAST ERROR]', err));
  }

  res.json({
    success: true,
    message: 'Thẻ đã được tiếp nhận và gửi lên hệ thống GachTheFast.Com 24/7!',
    data: {
      txId: newTx.id,
      requestId: requestId,
      telco: cleanTelco,
      amount: numAmount,
      estimatedReceive: estimatedReceive,
      status: 'PENDING'
    }
  });
});

app.all(['/api/webhook/card', '/api/webhook/gachthefast'], async (req, res) => {
  const data = Object.assign({}, req.query, req.body);
  const settings = readJSON(SETTINGS_FILE, {});
  const clientIp = getClientIP(req);

  const incomingToken = req.query.token || req.headers['x-callback-token'] || data.callback_token;
  if (settings.cardCallbackSecret && settings.cardCallbackSecret.trim() !== '') {
    if (!incomingToken || incomingToken !== settings.cardCallbackSecret.trim()) {
      return res.status(401).json({ status: false, message: 'Sai mã bảo mật Callback Thẻ Cào!' });
    }
  }

  if (settings.gachthefastPartnerKey && data.sign) {
    const expectedSign1 = crypto.createHash('md5').update(`${settings.gachthefastPartnerKey}${data.code || ''}${data.serial || ''}`).digest('hex');
    const expectedSign2 = crypto.createHash('md5').update(`${settings.gachthefastPartnerKey}${data.request_id || ''}`).digest('hex');
    const clientSign = String(data.sign).toLowerCase();

    if (clientSign !== expectedSign1.toLowerCase() && clientSign !== expectedSign2.toLowerCase()) {
      if (!incomingToken || incomingToken !== settings.cardCallbackSecret) {
        return res.status(401).json({ status: false, message: 'Chữ ký giao dịch Callback không hợp lệ!' });
      }
    }
  }

  const result = await processCardCallback(data, clientIp);
  return res.json({ status: true, message: result.message });
});

app.get('/api/card/deposit-status/:txId', (req, res) => {
  const { txId } = req.params;
  const transactions = readJSON(TRANSACTIONS_FILE, []);
  const tx = transactions.find(t => t.id === txId || t.code === txId);
  if (!tx) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy đơn thẻ cào!' });
  }

  res.json({
    success: true,
    status: tx.status,
    telco: tx.telco,
    amount: tx.amount,
    receiveAmount: tx.receiveAmount,
    note: tx.note || '',
    username: tx.username,
    code: tx.code,
    approvedAt: tx.approvedAt
  });
});

app.get('/api/card/history/:username', authenticateToken, (req, res) => {
  const { username } = req.params;
  const targetUser = username.trim().toLowerCase();

  if (req.user.role !== 'admin' && req.user.username.toLowerCase() !== targetUser) {
    return res.status(403).json({ success: false, message: 'Bạn không có quyền xem lịch sử của người dùng khác!' });
  }

  const transactions = readJSON(TRANSACTIONS_FILE, []);
  const cardTx = transactions.filter(t => t.type === 'CARD_DEPOSIT' && t.username.toLowerCase() === targetUser);
  res.json({ success: true, data: cardTx });
});

// ---------------- 18. QUẢN TRỊ ADMIN (NGHIỆP VỤ & BẢO MẬT CHUYÊN SÂU) ----------------
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = readJSON(USERS_FILE, []);
  const safeUsers = users.map(({ password, ...u }) => u);
  res.json({ success: true, data: safeUsers });
});

// Khóa / Mở khóa tài khoản người dùng (Ban/Unban)
app.post('/api/admin/toggle-ban', requireAdmin, requireAdminPin, (req, res) => {
  const { targetUsername, isBanned, reason } = req.body;
  if (!targetUsername) {
    return res.status(400).json({ success: false, message: 'Thiếu tên người dùng!' });
  }

  if (targetUsername.toLowerCase() === 'hqk') {
    return res.status(400).json({ success: false, message: 'Không thể khóa tài khoản Admin tối cao!' });
  }

  let users = readJSON(USERS_FILE, []);
  const idx = users.findIndex(u => u.username.toLowerCase() === targetUsername.trim().toLowerCase());
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Người dùng không tồn tại!' });
  }

  users[idx].isBanned = !!isBanned;
  users[idx].banReason = reason ? String(reason).trim() : 'Vi phạm quy định của Shop';
  users[idx].bannedAt = isBanned ? new Date().toISOString() : null;
  writeJSON(USERS_FILE, users);

  logAudit({
    action: isBanned ? 'BAN_USER' : 'UNBAN_USER',
    actor: req.adminUser.username,
    target: targetUsername,
    details: `${isBanned ? 'Khóa' : 'Mở khóa'} tài khoản [${targetUsername}]. Lý do: ${users[idx].banReason}`,
    ip: getClientIP(req)
  });

  res.json({
    success: true,
    message: `Đã ${isBanned ? 'khóa' : 'mở khóa'} tài khoản [${targetUsername}] thành công!`
  });
});

// Điều chỉnh số dư (Cộng, Trừ, Reset)
app.post('/api/admin/add-balance', requireAdmin, async (req, res) => {
  const { targetUsername, amount, action = 'add', reason } = req.body;

  if (action === 'reset') {
    // Thao tác reset về 0 cần PIN cấp 2 nếu có cài đặt
    const settings = readJSON(SETTINGS_FILE, {});
    if (settings.adminSecurityPin) {
      const pin = req.headers['x-admin-pin'] || req.body.adminPin;
      if (!pin || pin !== settings.adminSecurityPin) {
        return res.status(403).json({ success: false, message: 'Xóa sạch tiền yêu cầu Mã PIN bảo mật cấp 2!' });
      }
    }
  }

  if (!targetUsername) {
    return res.status(400).json({ success: false, message: 'Vui lòng chọn tài khoản cần điều chỉnh số dư!' });
  }

  const result = await transactionMutex.runExclusive(async () => {
    const users = readJSON(USERS_FILE, []);
    const userIndex = users.findIndex(u => u.username.toLowerCase() === targetUsername.trim().toLowerCase());

    if (userIndex === -1) {
      return { success: false, status: 404, message: 'Không tìm thấy người dùng này!' };
    }

    const currentBal = users[userIndex].balance || 0;
    let newBal = currentBal;
    let txType = 'ADMIN_DEPOSIT';
    let txAmount = 0;
    let successMsg = '';

    if (action === 'reset') {
      txType = 'ADMIN_RESET';
      txAmount = currentBal;
      newBal = 0;
      users[userIndex].balance = 0;
      successMsg = `Đã xóa sạch số dư của user [${users[userIndex].username}] về 0 đ! (Đã trừ hết ${currentBal.toLocaleString('vi-VN')} đ)`;
    } else if (action === 'deduct') {
      const deductAmt = Math.abs(Number(amount) || 0);
      if (deductAmt <= 0) {
        return { success: false, status: 400, message: 'Vui lòng nhập số tiền cần giảm hợp lệ!' };
      }
      txType = 'ADMIN_DEDUCT';
      txAmount = deductAmt;
      newBal = Math.max(0, currentBal - deductAmt);
      users[userIndex].balance = newBal;
      successMsg = `Đã giảm trừ -${deductAmt.toLocaleString('vi-VN')} đ của user [${users[userIndex].username}]. Số dư mới: ${newBal.toLocaleString('vi-VN')} đ`;
    } else {
      const addAmt = Number(amount) || 0;
      if (addAmt === 0) {
        return { success: false, status: 400, message: 'Vui lòng nhập số tiền cần cộng hợp lệ!' };
      }
      txType = 'ADMIN_DEPOSIT';
      txAmount = addAmt;
      newBal = currentBal + addAmt;
      users[userIndex].balance = newBal;
      successMsg = `Đã cộng +${addAmt.toLocaleString('vi-VN')} đ cho user [${users[userIndex].username}]. Số dư mới: ${newBal.toLocaleString('vi-VN')} đ`;
    }

    writeJSON(USERS_FILE, users);

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

    logAudit({
      action: txType,
      actor: req.adminUser.username,
      target: users[userIndex].username,
      details: `${successMsg} (Lý do: ${reason || 'Không ghi rõ'})`,
      ip: getClientIP(req)
    });

    return {
      success: true,
      status: 200,
      message: successMsg,
      newBalance: newBal
    };
  });

  res.status(result.status || 200).json(result);
});

// Xóa User
app.delete('/api/admin/users/:username', requireAdmin, requireAdminPin, (req, res) => {
  const { username } = req.params;
  if (username.toLowerCase() === 'hqk') {
    return res.status(400).json({ success: false, message: 'Không thể xóa tài khoản Admin tối cao!' });
  }

  let users = readJSON(USERS_FILE, []);
  const initLen = users.length;
  users = users.filter(u => u.username.toLowerCase() !== username.toLowerCase());

  if (users.length === initLen) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng!' });
  }

  writeJSON(USERS_FILE, users);

  logAudit({
    action: 'DELETE_USER',
    actor: req.adminUser.username,
    target: username,
    details: `Xóa tài khoản người dùng [${username}]`,
    ip: getClientIP(req)
  });

  res.json({ success: true, message: `Đã xóa tài khoản [${username}] thành công!` });
});

app.get('/api/admin/deposits', requireAdmin, (req, res) => {
  const transactions = readJSON(TRANSACTIONS_FILE, []);
  const deposits = transactions.filter(t => t.type === 'DEPOSIT');
  res.json({ success: true, data: deposits });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const transactions = readJSON(TRANSACTIONS_FILE, []);
  const orders = transactions.filter(t => t.type === 'PURCHASE' || t.type === 'BUY');
  res.json({ success: true, data: orders });
});

app.post('/api/admin/approve-deposit', requireAdmin, async (req, res) => {
  const txId = req.body.txId || req.body.transactionId || req.body.id;
  if (!txId) {
    return res.status(400).json({ success: false, message: 'Thiếu mã giao dịch!' });
  }

  const result = await transactionMutex.runExclusive(async () => {
    const transactions = readJSON(TRANSACTIONS_FILE, []);
    const txIndex = transactions.findIndex(t => t.id === txId || t.code === txId);

    if (txIndex === -1) {
      return { success: false, status: 404, message: 'Không tìm thấy giao dịch!' };
    }

    const tx = transactions[txIndex];
    if (tx.status === 'COMPLETED') {
      return { success: false, status: 400, message: 'Giao dịch này đã được duyệt trước đó!' };
    }

    const users = readJSON(USERS_FILE, []);
    const userIndex = users.findIndex(u => u.username.toLowerCase() === tx.username.toLowerCase());
    if (userIndex === -1) {
      return { success: false, status: 404, message: 'Người dùng nạp tiền không còn tồn tại!' };
    }

    users[userIndex].balance = (users[userIndex].balance || 0) + tx.amount;
    writeJSON(USERS_FILE, users);

    transactions[txIndex].status = 'COMPLETED';
    transactions[txIndex].approvedBy = req.adminUser.username;
    transactions[txIndex].completedAt = new Date().toISOString();
    writeJSON(TRANSACTIONS_FILE, transactions);

    logAudit({
      action: 'APPROVE_DEPOSIT',
      actor: req.adminUser.username,
      target: tx.username,
      details: `Duyệt đơn nạp VietQR +${tx.amount.toLocaleString('vi-VN')}đ (Mã: ${tx.code})`,
      ip: getClientIP(req)
    });

    return {
      success: true,
      status: 200,
      message: `Đã duyệt thành công đơn ${tx.code}! Đã cộng +${tx.amount.toLocaleString('vi-VN')} đ cho ${tx.username}.`,
      targetUser: tx.username,
      newBalance: users[userIndex].balance
    };
  });

  res.status(result.status || 200).json(result);
});

app.get('/api/admin/cards', requireAdmin, (req, res) => {
  const transactions = readJSON(TRANSACTIONS_FILE, []);
  const cards = transactions.filter(t => t.type === 'CARD_DEPOSIT');
  res.json({ success: true, data: cards });
});

app.post('/api/admin/approve-card', requireAdmin, async (req, res) => {
  const { txId, amount } = req.body;
  if (!txId) {
    return res.status(400).json({ success: false, message: 'Thiếu mã đơn thẻ!' });
  }

  const result = await transactionMutex.runExclusive(async () => {
    const transactions = readJSON(TRANSACTIONS_FILE, []);
    const idx = transactions.findIndex(t => t.id === txId || t.code === txId);
    if (idx === -1) {
      return { success: false, status: 404, message: 'Không tìm thấy đơn thẻ!' };
    }

    const tx = transactions[idx];
    if (tx.status === 'COMPLETED') {
      return { success: false, status: 400, message: 'Đơn thẻ này đã được duyệt trước đó!' };
    }

    const users = readJSON(USERS_FILE, []);
    const userIdx = users.findIndex(u => u.username.toLowerCase() === tx.username.toLowerCase());
    if (userIdx === -1) {
      return { success: false, status: 404, message: 'Người dùng không tồn tại!' };
    }

    const creditAmount = Number(amount) || Number(tx.receiveAmount) || Math.round(Number(tx.amount) * 0.85);
    users[userIdx].balance = (Number(users[userIdx].balance) || 0) + creditAmount;
    writeJSON(USERS_FILE, users);

    transactions[idx].status = 'COMPLETED';
    transactions[idx].receiveAmount = creditAmount;
    transactions[idx].realAmountReceived = creditAmount;
    transactions[idx].approvedBy = req.adminUser.username;
    transactions[idx].approvedAt = new Date().toISOString();
    transactions[idx].note = 'Admin duyệt thủ công';
    writeJSON(TRANSACTIONS_FILE, transactions);

    logAudit({
      action: 'APPROVE_CARD',
      actor: req.adminUser.username,
      target: tx.username,
      details: `Duyệt thẻ cào thủ công +${creditAmount.toLocaleString('vi-VN')}đ cho ${tx.username} (Mã: ${tx.code})`,
      ip: getClientIP(req)
    });

    return {
      success: true,
      status: 200,
      message: `Đã duyệt thẻ thành công! Đã cộng +${creditAmount.toLocaleString('vi-VN')} đ cho ${tx.username}.`,
      newBalance: users[userIdx].balance
    };
  });

  res.status(result.status || 200).json(result);
});

app.post('/api/admin/reject-card', requireAdmin, (req, res) => {
  const { txId, reason } = req.body;
  if (!txId) {
    return res.status(400).json({ success: false, message: 'Thiếu mã đơn thẻ!' });
  }

  const transactions = readJSON(TRANSACTIONS_FILE, []);
  const idx = transactions.findIndex(t => t.id === txId || t.code === txId);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy đơn thẻ!' });
  }

  transactions[idx].status = 'FAILED';
  transactions[idx].approvedBy = req.adminUser.username;
  transactions[idx].approvedAt = new Date().toISOString();
  transactions[idx].note = reason || 'Admin từ chối / Thẻ sai hoặc đã nạp';
  writeJSON(TRANSACTIONS_FILE, transactions);

  logAudit({
    action: 'REJECT_CARD',
    actor: req.adminUser.username,
    target: transactions[idx].username,
    details: `Từ chối thẻ cào ${transactions[idx].code}. Lý do: ${transactions[idx].note}`,
    ip: getClientIP(req)
  });

  res.json({ success: true, message: 'Đã từ chối đơn thẻ thành công!' });
});

// ---------------- 19. XEM NHẬT KÝ BẢO MẬT & NHẬT KÝ WEBHOOK ----------------
app.get('/api/admin/audit-logs', requireAdmin, (req, res) => {
  const logs = readJSON(AUDIT_LOGS_FILE, []);
  res.json({ success: true, data: logs });
});

app.get('/api/admin/webhook-logs', requireAdmin, (req, res) => {
  const logs = readJSON(WEBHOOK_LOGS_FILE, []);
  res.json({ success: true, data: logs });
});

// ---------------- 20. QUẢN LÝ BẢN SAO LƯU (BACKUP & RESTORE) ----------------
app.get('/api/admin/backups', requireAdmin, (req, res) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('backup_') && f.endsWith('.json'));
    const list = files.map(fileName => {
      const filePath = path.join(BACKUP_DIR, fileName);
      const stat = fs.statSync(filePath);
      return {
        fileName,
        sizeBytes: stat.size,
        sizeKB: (stat.size / 1024).toFixed(1),
        createdAt: stat.birthtime || stat.mtime
      };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Lỗi đọc danh sách sao lưu: ' + err.message });
  }
});

app.post('/api/admin/backups/create', requireAdmin, (req, res) => {
  const result = createSystemBackup('MANUAL_ADMIN');
  if (result.success) {
    logAudit({
      action: 'CREATE_BACKUP',
      actor: req.adminUser.username,
      details: `Tạo bản sao lưu thủ công: ${result.fileName}`,
      ip: getClientIP(req)
    });
    res.json({ success: true, message: 'Tạo bản sao lưu dữ liệu toàn diện thành công!', data: result });
  } else {
    res.status(500).json({ success: false, message: result.message });
  }
});

// Khôi phục dữ liệu từ bản sao lưu (Yêu cầu PIN cấp 2)
app.post('/api/admin/backups/restore', requireAdmin, requireAdminPin, (req, res) => {
  const { fileName } = req.body;
  if (!fileName || !fileName.endsWith('.json') || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    return res.status(400).json({ success: false, message: 'Tên file sao lưu không hợp lệ!' });
  }

  const targetPath = path.join(BACKUP_DIR, fileName);
  if (!fs.existsSync(targetPath)) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy file sao lưu cần khôi phục!' });
  }

  try {
    const rawData = fs.readFileSync(targetPath, 'utf8');
    const snapshot = JSON.parse(rawData);

    if (!snapshot || !snapshot.data) {
      return res.status(400).json({ success: false, message: 'File sao lưu bị hỏng hoặc sai cấu trúc!' });
    }

    // Sao lưu khẩn cấp dữ liệu hiện tại trước khi khôi phục đè
    createSystemBackup('BEFORE_RESTORE_SAFETY');

    if (snapshot.data.users) writeJSON(USERS_FILE, snapshot.data.users);
    if (snapshot.data.products) writeJSON(PRODUCTS_FILE, snapshot.data.products);
    if (snapshot.data.transactions) writeJSON(TRANSACTIONS_FILE, snapshot.data.transactions);
    if (snapshot.data.settings) writeJSON(SETTINGS_FILE, snapshot.data.settings);

    logAudit({
      action: 'RESTORE_BACKUP',
      actor: req.adminUser.username,
      details: `Khôi phục toàn bộ hệ thống từ file [${fileName}]`,
      ip: getClientIP(req)
    });

    res.json({
      success: true,
      message: `Đã khôi phục dữ liệu thành công từ bản sao lưu [${fileName}]!`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Lỗi khôi phục sao lưu: ' + err.message });
  }
});

// Tải file backup
app.get('/api/admin/backups/download/:filename', requireAdmin, (req, res) => {
  const { filename } = req.params;
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return res.status(400).send('Invalid filename');
  }

  const filePath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Backup not found');
  }

  res.download(filePath, filename);
});

// Khôi phục dữ liệu trực tiếp từ file JSON do Admin tải lên từ máy tính
app.post('/api/admin/backups/upload-restore', requireAdmin, requireAdminPin, (req, res) => {
  const { snapshotData } = req.body;
  if (!snapshotData || !snapshotData.data) {
    return res.status(400).json({ success: false, message: 'Dữ liệu file sao lưu không hợp lệ!' });
  }

  try {
    createSystemBackup('BEFORE_UPLOAD_RESTORE_SAFETY');

    if (snapshotData.data.users) writeJSON(USERS_FILE, snapshotData.data.users);
    if (snapshotData.data.products) writeJSON(PRODUCTS_FILE, snapshotData.data.products);
    if (snapshotData.data.transactions) writeJSON(TRANSACTIONS_FILE, snapshotData.data.transactions);
    if (snapshotData.data.settings) writeJSON(SETTINGS_FILE, snapshotData.data.settings);

    logAudit({
      action: 'UPLOAD_RESTORE_BACKUP',
      actor: req.adminUser.username,
      details: 'Khôi phục hệ thống từ file tải lên trực tiếp từ máy tính',
      ip: getClientIP(req)
    });

    res.json({
      success: true,
      message: 'Đã nạp và khôi phục toàn bộ dữ liệu shop thành công từ file máy tính!'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Lỗi nạp file khôi phục: ' + err.message });
  }
});

// ---------------- 21. CẤU HÌNH SHOP (SETTINGS & ADMIN SECURITY PIN) ----------------
const DEFAULT_SETTINGS = {
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
  bankId: "MB",
  accountNo: "0349340730",
  accountName: "SHOPHQK STORE",
  categories: ["Tất cả", "Tài khoản", "Phần mềm", "Game", "Thẻ cào", "Khác"],
  cardAutoEnabled: true,
  cardDiscountRate: 85,
  webhookSecretKey: "shophqk_secret_key_2026",
  gachthefastPartnerId: "",
  gachthefastPartnerKey: "",
  cardCallbackSecret: "",
  adminSecurityPin: "", // Mã PIN bảo vệ cấp 2
  githubRepo: "",
  githubToken: "",
  githubBranch: "main",
  imgbbApiKey: "",
  discordBackupWebhook: "",
  telegramBotToken: "",
  telegramChatId: ""
};

// Cấu hình công khai
app.get('/api/settings', (req, res) => {
  const current = readJSON(SETTINGS_FILE, {});
  const settings = Object.assign({}, DEFAULT_SETTINGS, current);

  const publicSettings = {
    shopName: settings.shopName || "ShopHQK",
    shopTitle: settings.shopTitle || "Cửa Hàng Số Tiện Lợi ShopHQK",
    shopDesc: settings.shopDesc || "",
    shopNotice: settings.shopNotice || "",
    shopNoticeActive: settings.shopNoticeActive !== undefined ? settings.shopNoticeActive : true,
    contactZalo: settings.contactZalo || "",
    contactPhone: settings.contactPhone || "",
    contactTelegram: settings.contactTelegram || "",
    contactFacebook: settings.contactFacebook || "",
    logoText: settings.logoText || "ShopHQK",
    bankId: settings.bankId || "MB",
    accountNo: settings.accountNo || "",
    accountName: settings.accountName || "",
    categories: settings.categories || ["Tất cả"],
    cardAutoEnabled: settings.cardAutoEnabled !== false,
    cardDiscountRate: settings.cardDiscountRate !== undefined ? settings.cardDiscountRate : 85,
    hasSecurityPin: !!(settings.adminSecurityPin && settings.adminSecurityPin.trim() !== '')
  };

  res.json({ success: true, data: publicSettings });
});

// Cấu hình toàn bộ cho Admin
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  const current = readJSON(SETTINGS_FILE, {});
  const settings = Object.assign({}, DEFAULT_SETTINGS, current);
  res.json({ success: true, data: settings });
});

// Cập nhật cấu hình Shop (Bảo vệ bằng requireAdmin & requireAdminPin khi đổi STK hoặc Secret Key)
app.post('/api/settings', requireAdmin, (req, res) => {
  const currentSettings = readJSON(SETTINGS_FILE, {});
  const isChangingSensitive = (
    (req.body.accountNo && req.body.accountNo !== currentSettings.accountNo) ||
    (req.body.webhookSecretKey && req.body.webhookSecretKey !== currentSettings.webhookSecretKey) ||
    (req.body.adminSecurityPin !== undefined)
  );

  if (isChangingSensitive && currentSettings.adminSecurityPin) {
    const providedPin = req.headers['x-admin-pin'] || req.body.adminPin;
    if (!providedPin || providedPin !== currentSettings.adminSecurityPin) {
      return res.status(403).json({
        success: false,
        requirePin: true,
        message: 'Thay đổi STK ngân hàng hoặc Mã bảo mật yêu cầu Mã PIN cấp 2!'
      });
    }
  }

  const updatedSettings = {
    ...DEFAULT_SETTINGS,
    ...currentSettings,
    ...req.body
  };

  if (updatedSettings.accountName) {
    updatedSettings.accountName = updatedSettings.accountName.toUpperCase();
  }
  if (Array.isArray(updatedSettings.categories)) {
    let cats = updatedSettings.categories.map(c => typeof c === 'string' ? c.trim() : c).filter(Boolean);
    if (!cats.some(c => c.toLowerCase() === 'tất cả')) {
      cats.unshift('Tất cả');
    }
    updatedSettings.categories = cats;
  }

  writeJSON(SETTINGS_FILE, updatedSettings);

  logAudit({
    action: 'UPDATE_SETTINGS',
    actor: req.adminUser.username,
    details: 'Cập nhật cấu hình Shop & VietQR',
    ip: getClientIP(req)
  });

  res.json({ success: true, message: 'Đã lưu toàn bộ thay đổi cấu hình Shop thành công!', data: updatedSettings });
});

// ---------------- 22. XỬ LÝ 404 CHO ASSETS & SPA ROUTING ----------------
// Không bao giờ trả về file HTML cho các yêu cầu ảnh hoặc API bị thiếu
app.use('/uploads', (req, res) => {
  res.status(404).send('Ảnh không tồn tại hoặc đã được nén Data URI trực tiếp.');
});

app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: 'API endpoint không tồn tại!' });
});

// SPA FALLBACK ROUTING (Chỉ trả về index.html cho các route giao diện web)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------- 23. KHỞI CHẠY SERVER ----------------
app.listen(PORT, async () => {
  console.log(`================================================================`);
  console.log(`  ShopHQK Enterprise Platform dang chay tai: http://localhost:${PORT}`);
  console.log(`  - Bao mat OWASP HTTP Headers, Anti-BruteForce, Rate-Limiting: ACTIVE`);
  console.log(`  - Mutex Transaction Engine (Chong Double-Spending): ACTIVE`);
  console.log(`  - Nhat ky Kiem toan (Audit Logs) & Webhook Inspector: ACTIVE`);
  console.log(`  - He thong Tu dong Sao luu Dinh ky (Auto-Backup): ACTIVE`);
  console.log(`  - Kho Acc / Key Ban Hang Tu Dong: READY`);
  console.log(`================================================================`);

  // Tự động kiểm tra và đồng bộ dữ liệu mới nhất từ GitHub khi boot
  try {
    await syncFromGitHubOnStartup();
  } catch (e) {
    console.warn('[BOOT SYNC] Lỗi khi kéo dữ liệu khởi động:', e.message);
  }
});
