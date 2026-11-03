// Đảm bảo lucide không gây lỗi nếu CDN bị chặn hoặc tải chậm
if (typeof window !== 'undefined' && !window.lucide) {
  window.lucide = { createIcons: function() {} };
}

// Tự động định tuyến API: Hỗ trợ Netlify, Render, Localhost và file://
let API_BASE = '';
if (typeof window !== 'undefined') {
  if (window.location.protocol === 'file:') {
    API_BASE = 'http://localhost:3000';
  } else if (window.location.hostname.includes('netlify.app')) {
    API_BASE = 'https://shophqk.onrender.com';
  }
}

const _rawFetch = window.fetch;
window.fetch = function(url, options = {}) {
  options = options || {};
  let targetUrl = url;
  if (typeof targetUrl === 'string' && targetUrl.startsWith('/api/')) {
    targetUrl = API_BASE + targetUrl;
  }

  // Tự động đính kèm token xác thực JWT Bearer & Admin Header
  const token = localStorage.getItem('shophqk_token');
  if (token) {
    if (!options.headers) {
      options.headers = {};
    }
    if (options.headers instanceof Headers) {
      if (!options.headers.has('Authorization')) {
        options.headers.set('Authorization', `Bearer ${token}`);
      }
    } else if (Array.isArray(options.headers)) {
      const hasAuth = options.headers.some(([k]) => k.toLowerCase() === 'authorization');
      if (!hasAuth) {
        options.headers.push(['Authorization', `Bearer ${token}`]);
      }
    } else {
      if (!options.headers['Authorization'] && !options.headers['authorization']) {
        options.headers['Authorization'] = `Bearer ${token}`;
      }
    }
  }

  // Tự động đính kèm thông tin Admin hqk nếu đang đăng nhập admin hoặc gọi API admin/settings
  const admName = (currentUser && currentUser.username) ? currentUser.username : 'hqk';
  const isAdminPath = typeof targetUrl === 'string' && (
    targetUrl.includes('/api/admin') || 
    targetUrl.includes('/api/settings') || 
    (options.method && options.method !== 'GET' && targetUrl.includes('/api/products'))
  );
  if (admName && (isAdminPath || (currentUser && (currentUser.username === 'hqk' || currentUser.role === 'admin')))) {
    if (!options.headers) {
      options.headers = {};
    }
    if (options.headers instanceof Headers) {
      if (!options.headers.has('X-Admin-Username')) options.headers.set('X-Admin-Username', admName);
    } else if (Array.isArray(options.headers)) {
      if (!options.headers.some(([k]) => k.toLowerCase() === 'x-admin-username')) {
        options.headers.push(['X-Admin-Username', admName]);
      }
    } else {
      if (!options.headers['X-Admin-Username']) options.headers['X-Admin-Username'] = admName;
    }
  }

  return _rawFetch(targetUrl, options).then(response => {
    // Tự động xử lý khi phiên đăng nhập hết hạn (401)
    if (response.status === 401 && typeof url === 'string' && !url.includes('/api/auth/login') && !url.includes('/api/auth/register') && !url.includes('/api/settings')) {
      if (currentUser && (currentUser.username === 'hqk' || currentUser.role === 'admin')) {
        console.warn('[AUTH] Admin hqk request returned 401, preserving admin session');
        return response;
      }
      if (currentUser) {
        console.warn('[AUTH] Phiên đăng nhập hết hạn hoặc không hợp lệ (401)');
        localStorage.removeItem('shophqk_token');
        localStorage.removeItem('shophqk_user');
        currentUser = null;
        updateAuthUI();
        showToast('Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại!', 'warning');
      }
    }
    return response;
  });
};

function getAdminUsername() {
  if (currentUser && currentUser.username) return currentUser.username;
  return 'hqk';
}

// Chuẩn hóa đường dẫn ảnh: Tự động trỏ về domain máy chủ và xử lý Google Drive / Dropbox / Base64
function formatImageUrl(url) {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=500&auto=format&fit=crop&q=60';
  }
  url = url.trim();

  // 1. Ảnh Base64 hiển thị trực tiếp
  if (url.startsWith('data:image/')) {
    return url;
  }

  // 2. Tự động chuyển link xem Google Drive sang CDN ảnh trực tiếp tốc độ cao của Google
  const gDriveMatch = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([a-zA-Z0-9_-]+)/);
  if (gDriveMatch && gDriveMatch[1]) {
    return `https://lh3.googleusercontent.com/d/${gDriveMatch[1]}`;
  }

  // 3. Tự động chuyển link Dropbox sang direct link
  if (url.includes('dropbox.com') && url.includes('dl=0')) {
    return url.replace('dl=0', 'raw=1');
  }

  // 4. Tự động chuyển link Imgur trang xem sang direct image
  const imgurMatch = url.match(/imgur\.com\/([a-zA-Z0-9]+)$/);
  if (imgurMatch && imgurMatch[1]) {
    return `https://i.imgur.com/${imgurMatch[1]}.png`;
  }

  // 5. Đường dẫn upload nội bộ server
  if (url.startsWith('/uploads/')) {
    return API_BASE ? API_BASE + url : url;
  }

  return url;
}

let currentDownloadLink = '';
function copyDownloadLink() {
  if (currentDownloadLink) {
    navigator.clipboard.writeText(currentDownloadLink);
    showToast('Đã sao chép link tải sản phẩm!', 'success');
  }
}

// State management
let currentUser = JSON.parse(localStorage.getItem('shophqk_user') || 'null');
let allProducts = [];
let currentCategory = 'all';
let currentTxId = null;
let currentMemo = '';
let targetAdjustUser = null;
let currentBalanceMode = 'add';
let currentAuthTab = 'login';
let currentUploadedBase64 = null;
let currentSelectedFile = null;
let editingProductId = null;

let currentSettings = {
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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  updateAuthUI();
  loadShopSettings();
  loadProducts();

  if (currentUser) {
    refreshUserBalance();
  }

  // Khởi động đồng bộ thời gian thực (Real-time Auto-sync cho mọi thiết bị mỗi 3.5s)
  startRealtimeSync();
});

// Đồng bộ dữ liệu đa thiết bị tự động
function startRealtimeSync() {
  setInterval(async () => {
    try {
      // 1. Tự động đồng bộ sản phẩm nếu Admin thêm/sửa/xóa
      const pRes = await fetch('/api/products');
      const pData = await pRes.json();
      if (pData.success) {
        if (JSON.stringify(pData.data) !== JSON.stringify(allProducts)) {
          allProducts = pData.data;
          renderProducts();
          if (!document.getElementById('admSectionProduct').classList.contains('hidden')) {
            renderAdminProductsList();
          }
        }
      }

      // 2. Tự động cập nhật số dư của User khi Admin duyệt/cộng tiền
      if (currentUser) {
        const uRes = await fetch(`/api/auth/me/${currentUser.username}`);
        const uData = await uRes.json();
        if (uData.success) {
          if (currentUser.balance !== uData.data.balance || currentUser.role !== uData.data.role) {
            currentUser.balance = uData.data.balance;
            currentUser.role = uData.data.role;
            localStorage.setItem('shophqk_user', JSON.stringify(currentUser));
            updateAuthUI();
          }
        }
      }
    } catch (err) {
      // Bỏ qua lỗi kết nối tạm thời
    }
  }, 3500);
}

// ---------------- TOAST NOTIFICATIONS ----------------
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  const bgColors = {
    success: 'bg-emerald-950/95 border-emerald-500 text-emerald-200',
    error: 'bg-rose-950/95 border-rose-500 text-rose-200',
    warning: 'bg-amber-950/95 border-amber-500 text-amber-200',
    info: 'bg-slate-900/95 border-indigo-500 text-slate-200'
  };

  const icons = {
    success: 'check-circle',
    error: 'alert-circle',
    warning: 'alert-triangle',
    info: 'info'
  };

  toast.className = `toast max-w-sm w-full p-3.5 rounded-xl border shadow-xl flex items-center gap-2.5 text-xs font-semibold backdrop-blur-md ${bgColors[type] || bgColors.info}`;
  toast.innerHTML = `
    <i data-lucide="${icons[type] || 'info'}" class="w-4 h-4 shrink-0"></i>
    <span class="flex-1 leading-snug">${message}</span>
    <button onclick="this.parentElement.remove()" class="text-slate-400 hover:text-white p-0.5"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>
  `;

  container.appendChild(toast);
  lucide.createIcons();

  setTimeout(() => {
    if (toast.parentElement) {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'all 0.2s ease-out';
      setTimeout(() => toast.remove(), 200);
    }
  }, 3500);
}

// ---------------- MODAL HELPERS ----------------
function openModal(id) {
  const m = document.getElementById(id);
  if (m) {
    m.classList.remove('hidden');
    const inner = m.firstElementChild;
    if (inner) inner.classList.add('modal-animate');
    lucide.createIcons();
  }
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('hidden');
  if (id === 'depositModal') {
    stopDepositPolling();
  }
}

// ---------------- CẤU HÌNH SHOP DYNAMIC ----------------
async function loadShopSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (data.success && data.data) {
      currentSettings = { ...currentSettings, ...data.data };
      applyShopSettingsToUI();
    }
  } catch (err) {
    console.error('Failed to load shop settings');
  }
}

function applyShopSettingsToUI() {
  const s = currentSettings;

  // 1. Tên Shop & Thương hiệu
  const navShopName = document.getElementById('navShopName');
  if (navShopName) navShopName.innerText = s.shopName || 'ShopHQK';
  const footerShopName = document.getElementById('footerShopName');
  if (footerShopName) footerShopName.innerText = s.shopName || 'ShopHQK';
  const heroHighlight = document.getElementById('heroShopHighlight');
  if (heroHighlight) heroHighlight.innerText = s.shopName || 'ShopHQK';

  // 2. Tiêu đề & Mô tả
  const heroTitle = document.getElementById('heroShopTitle');
  if (heroTitle && s.shopTitle) {
    const sName = s.shopName || 'Shophqk';
    if (s.shopTitle.toLowerCase().includes(sName.toLowerCase())) {
      heroTitle.innerHTML = s.shopTitle.replace(new RegExp(sName, 'i'), `<span class="bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">${sName}</span>`);
    } else {
      heroTitle.innerHTML = `${s.shopTitle} <span class="bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">${sName}</span>`;
    }
  }
  const heroDesc = document.getElementById('heroShopDesc');
  if (heroDesc) heroDesc.innerText = s.shopDesc || '';

  // 3. Thông báo đầu trang
  const noticeBanner = document.getElementById('shopNoticeBanner');
  const noticeText = document.getElementById('shopNoticeText');
  if (noticeBanner) {
    if (s.shopNoticeActive && s.shopNotice && s.shopNotice.trim() !== '') {
      noticeBanner.classList.remove('hidden');
      if (noticeText) noticeText.innerText = s.shopNotice;
    } else {
      noticeBanner.classList.add('hidden');
    }
  }

  // 4. Liên hệ CSKH
  const heroContact = document.getElementById('heroContactBtn');
  if (heroContact) {
    if (s.contactZalo) heroContact.href = `https://zalo.me/${s.contactZalo.replace(/[^0-9]/g, '')}`;
    else if (s.contactTelegram) heroContact.href = `https://t.me/${s.contactTelegram.replace('@', '')}`;
  }
  const footerZalo = document.getElementById('footerZalo');
  if (footerZalo) footerZalo.innerText = `Zalo: ${s.contactZalo || 'Đang cập nhật'}`;
  const footerTele = document.getElementById('footerTelegram');
  if (footerTele) footerTele.innerText = `Telegram: ${s.contactTelegram || 'Đang cập nhật'}`;

  // Floating Quick Contacts
  const flZalo = document.getElementById('floatingZalo');
  if (flZalo && s.contactZalo) flZalo.href = `https://zalo.me/${s.contactZalo.replace(/[^0-9]/g, '')}`;
  const flTele = document.getElementById('floatingTelegram');
  if (flTele && s.contactTelegram) flTele.href = `https://t.me/${s.contactTelegram.replace('@', '')}`;
  const flFb = document.getElementById('floatingFacebook');
  if (flFb && s.contactFacebook) flFb.href = s.contactFacebook;

  // 5. Cập nhật các danh mục
  renderCategoryPills();
  renderAdminCategoriesList();

  // 6. Điền dữ liệu vào form Admin nếu đang mở
  fillAdminSettingsForms();
  lucide.createIcons();
}

function dismissNotice() {
  const b = document.getElementById('shopNoticeBanner');
  if (b) b.classList.add('hidden');
}

function toggleQuickContact() {
  const menu = document.getElementById('quickContactMenu');
  if (menu) {
    menu.classList.toggle('hidden');
    if (window.lucide) lucide.createIcons();
  }
}

function renderCategoryPills() {
  const container = document.getElementById('categoryFilters');
  const admCatSelect = document.getElementById('admProdCategory');
  if (!container) return;

  const cats = Array.isArray(currentSettings.categories) ? currentSettings.categories : ["Tất cả", "Tài khoản", "Phần mềm", "Game", "Thẻ cào", "Khác"];

  // Render pills
  container.innerHTML = cats.map(c => {
    const isAll = c.toLowerCase() === 'tất cả';
    const catVal = isAll ? 'all' : c;
    const isActive = currentCategory === catVal;
    return `
      <button onclick="filterCategory('${catVal}')" class="cat-pill shrink-0 px-3.5 py-2 sm:py-1.5 text-xs font-bold rounded-xl transition duration-150 active:scale-95 ${isActive ? 'active bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-500/25 ring-2 ring-indigo-400/30' : 'bg-slate-900/90 hover:bg-slate-800 text-slate-300 border border-slate-800 hover:border-slate-700'}">
        ${c}
      </button>
    `;
  }).join('');

  // Render dropdown options in Product Add Form
  if (admCatSelect) {
    admCatSelect.innerHTML = cats.filter(c => c.toLowerCase() !== 'tất cả').map(c => `
      <option value="${c}">${c}</option>
    `).join('');
  }
}

async function loadAdminFullSettings() {
  if ((!currentUser || currentUser.role !== 'admin') && getAdminUsername() !== 'hqk') return;
  try {
    const res = await fetch('/api/admin/settings');
    const data = await res.json();
    if (data.success && data.data) {
      currentSettings = { ...currentSettings, ...data.data };
      fillAdminSettingsForms();
    }
  } catch (err) {
    console.warn('Error fetching full admin settings:', err);
  }
}

function fillAdminSettingsForms() {
  const s = currentSettings;
  // Form Thông Tin Shop
  const nameInp = document.getElementById('cfgShopName');
  if (nameInp) nameInp.value = s.shopName || '';
  const titleInp = document.getElementById('cfgShopTitle');
  if (titleInp) titleInp.value = s.shopTitle || '';
  const descInp = document.getElementById('cfgShopDesc');
  if (descInp) descInp.value = s.shopDesc || '';
  const noticeInp = document.getElementById('cfgShopNotice');
  if (noticeInp) noticeInp.value = s.shopNotice || '';
  const noticeChk = document.getElementById('cfgShopNoticeActive');
  if (noticeChk) noticeChk.checked = s.shopNoticeActive !== false;
  const zaloInp = document.getElementById('cfgContactZalo');
  if (zaloInp) zaloInp.value = s.contactZalo || '';
  const teleInp = document.getElementById('cfgContactTelegram');
  if (teleInp) teleInp.value = s.contactTelegram || '';
  const fbInp = document.getElementById('cfgContactFacebook');
  if (fbInp) fbInp.value = s.contactFacebook || '';

  // Form VietQR
  const bankInp = document.getElementById('admCfgBankId');
  if (bankInp) bankInp.value = s.bankId || 'MB';
  const accNoInp = document.getElementById('admCfgAccountNo');
  if (accNoInp) accNoInp.value = s.accountNo || '';
  const accNameInp = document.getElementById('admCfgAccountName');
  if (accNameInp) accNameInp.value = s.accountName || '';
  const whKeyInp = document.getElementById('admCfgWebhookSecretKey');
  if (whKeyInp) whKeyInp.value = s.webhookSecretKey || '';

  // Form Thẻ Cào & GachTheFast
  const cardAutoChk = document.getElementById('admCfgCardAutoEnabled');
  if (cardAutoChk) cardAutoChk.checked = s.cardAutoEnabled !== false;
  const gtfPidInp = document.getElementById('admCfgGtfPartnerId');
  if (gtfPidInp) gtfPidInp.value = s.gachthefastPartnerId || '';
  const gtfKeyInp = document.getElementById('admCfgGtfPartnerKey');
  if (gtfKeyInp) gtfKeyInp.value = s.gachthefastPartnerKey || '';
  const cardRateInp = document.getElementById('admCfgCardDiscountRate');
  if (cardRateInp) cardRateInp.value = s.cardDiscountRate !== undefined ? s.cardDiscountRate : 85;
  const cardCbSecInp = document.getElementById('admCfgCardCallbackSecret');
  if (cardCbSecInp) cardCbSecInp.value = s.cardCallbackSecret || '';

  // Form Cloud Sync & Mã PIN Cấp 2
  const pinInp = document.getElementById('admCfgSecurityPin');
  if (pinInp) pinInp.value = s.adminSecurityPin || '';
  const ghRepoInp = document.getElementById('admCfgGithubRepo');
  if (ghRepoInp) ghRepoInp.value = s.githubRepo || '';
  const ghTokenInp = document.getElementById('admCfgGithubToken');
  if (ghTokenInp) ghTokenInp.value = s.githubToken || '';
  const imgbbInp = document.getElementById('admCfgImgbbKey');
  if (imgbbInp) imgbbInp.value = s.imgbbApiKey || '';
}

// ---------------- PRODUCTS LOGIC ----------------
async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    const data = await res.json();
    if (data.success && Array.isArray(data.data)) {
      allProducts = data.data;
      localStorage.setItem('shophqk_cached_products', JSON.stringify(allProducts));
      renderProducts();
      renderAdminProductsList();
    } else if (Array.isArray(data)) {
      allProducts = data;
      localStorage.setItem('shophqk_cached_products', JSON.stringify(allProducts));
      renderProducts();
      renderAdminProductsList();
    }
  } catch (err) {
    console.error('Error loading products:', err);
    const cached = localStorage.getItem('shophqk_cached_products');
    if (cached) {
      allProducts = JSON.parse(cached);
      renderProducts();
      renderAdminProductsList();
    }
  }
}

function renderProducts() {
  const grid = document.getElementById('productsGrid');
  const emptyState = document.getElementById('emptyState');
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const isAdmin = currentUser && currentUser.role === 'admin';

  const filtered = allProducts.filter(p => {
    const matchCat = currentCategory === 'all' || p.category === currentCategory;
    const matchSearch = p.name.toLowerCase().includes(search) || (p.description && p.description.toLowerCase().includes(search));
    return matchCat && matchSearch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  grid.innerHTML = filtered.map(p => {
    const isOutOfStock = p.stock <= 0;
    const priceFormatted = Number(p.price).toLocaleString('vi-VN') + ' đ';

    return `
      <div onclick="openProductDetail('${p.id}')" class="product-card cursor-pointer bg-slate-900/90 border border-slate-800/80 hover:border-indigo-500/50 rounded-2xl overflow-hidden flex flex-col justify-between relative group shadow-sm transition-all duration-200">
        <!-- Image & Badges (Tỉ lệ chuẩn 4:3 trên điện thoại & 16:10 trên máy tính) -->
        <div class="relative aspect-[4/3] sm:aspect-[16/10] bg-slate-950 overflow-hidden">
          <img src="${formatImageUrl(p.image)}" alt="${p.name}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=500&auto=format&fit=crop&q=60'" class="w-full h-full object-cover group-hover:scale-105 transition duration-300">
          <div class="absolute top-2 left-2 bg-slate-900/90 backdrop-blur-md px-2 py-0.5 rounded-lg border border-slate-700/60 text-[10px] sm:text-xs font-semibold text-indigo-300 shadow">
            ${p.category || 'Sản phẩm'}
          </div>
          <div class="absolute top-2 right-2 ${isOutOfStock ? 'bg-rose-500/95' : 'bg-emerald-500/95'} backdrop-blur-md px-2 py-0.5 rounded-lg text-[10px] sm:text-xs font-bold text-white shadow">
            ${isOutOfStock ? 'Hết hàng' : `Còn: ${p.stock}`}
          </div>
          ${p.downloadUrl ? `
            <div class="absolute bottom-2 left-2 bg-cyan-950/90 backdrop-blur-md px-2 py-0.5 rounded-lg border border-cyan-500/40 text-[9px] sm:text-[10px] font-bold text-cyan-300 flex items-center gap-1 shadow">
              <i data-lucide="download" class="w-3 h-3 text-cyan-400"></i> Link tải
            </div>
          ` : (p.type === 'account_keys' ? `
            <div class="absolute bottom-2 left-2 bg-emerald-950/90 backdrop-blur-md px-2 py-0.5 rounded-lg border border-emerald-500/40 text-[9px] sm:text-[10px] font-bold text-emerald-300 flex items-center gap-1 shadow">
              <i data-lucide="key" class="w-3 h-3 text-emerald-400"></i> Trả Key Tự Động
            </div>
          ` : '')}

          <!-- Nút Sửa & Xóa nhanh cho Admin -->
          ${isAdmin ? `
            <div class="absolute bottom-2 right-2 flex items-center gap-1 z-10">
              <button onclick="event.stopPropagation(); openEditProductModal('${p.id}')" title="Chỉnh sửa sản phẩm" class="p-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg shadow-lg transition active:scale-95">
                <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
              </button>
              <button onclick="event.stopPropagation(); deleteProduct('${p.id}')" title="Xóa sản phẩm" class="p-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg shadow-lg transition active:scale-95">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          ` : ''}
        </div>

        <!-- Product Details -->
        <div class="p-3 sm:p-4 flex-1 flex flex-col justify-between gap-2.5">
          <div>
            <h3 class="text-xs sm:text-sm font-bold text-white line-clamp-2 min-h-[32px] sm:min-h-[40px] leading-tight mb-1" title="${p.name}">${p.name}</h3>
            <p class="text-[11px] text-slate-400 line-clamp-1">${p.description || 'Chất lượng cao, kích hoạt tự động 24/7.'}</p>
          </div>

          <div class="pt-2.5 border-t border-slate-800/80 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 mt-auto">
            <div>
              <span class="text-[10px] text-slate-500 block font-medium">Giá bán:</span>
              <span class="text-sm sm:text-base font-extrabold text-emerald-400">${priceFormatted}</span>
            </div>

            <button onclick="event.stopPropagation(); openProductDetail('${p.id}')" ${isOutOfStock ? 'disabled' : ''} class="${isOutOfStock ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 text-white shadow-md shadow-indigo-500/20 active:scale-95'} w-full sm:w-auto px-3.5 py-2 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5">
              <i data-lucide="shopping-bag" class="w-3.5 h-3.5"></i>
              <span>${isOutOfStock ? 'Hết hàng' : 'Mua ngay'}</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

function filterCategory(cat) {
  currentCategory = cat;
  renderCategoryPills();
  renderProducts();
}

function handleSearch() {
  renderProducts();
}

// ---------------- KÉO THẢ ẢNH & CHỌN TỪ THƯ MỤC ----------------
function triggerFileInput() {
  const inp = document.getElementById('admProductFileInput');
  if (inp) inp.click();
}

function handleFileSelect(e) {
  const file = e.target.files && e.target.files[0];
  if (file) processSelectedImage(file);
}

function handleDragOver(e) {
  e.preventDefault();
  const dz = document.getElementById('dropzoneContainer');
  if (dz) dz.classList.add('dropzone-active');
}

function handleDragLeave(e) {
  e.preventDefault();
  const dz = document.getElementById('dropzoneContainer');
  if (dz) dz.classList.remove('dropzone-active');
}

function handleDrop(e) {
  e.preventDefault();
  const dz = document.getElementById('dropzoneContainer');
  if (dz) dz.classList.remove('dropzone-active');
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
    processSelectedImage(e.dataTransfer.files[0]);
  }
}

function processSelectedImage(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('Vui lòng chọn file hình ảnh (JPG, PNG, WEBP, GIF, SVG)!', 'error');
    return;
  }
  currentSelectedFile = file;

  const reader = new FileReader();
  reader.onload = (event) => {
    const rawDataUrl = event.target.result;

    // Ảnh vector SVG hoặc GIF động giữ nguyên
    if (file.type === 'image/svg+xml' || file.type === 'image/gif') {
      applyProcessedImage(rawDataUrl, file.name, file.size);
      return;
    }

    // Tự động tối ưu dung lượng và kích thước ảnh cho mobile & web bằng Canvas
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 1000;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Xuất ảnh WebP chuẩn nét nhẹ (~40KB - 90KB)
        const compressedDataUrl = canvas.toDataURL('image/webp', 0.85);
        const estBytes = Math.round((compressedDataUrl.length - 22) * 3 / 4);
        applyProcessedImage(compressedDataUrl, file.name, estBytes);
      } catch (err) {
        console.warn('Canvas resize fallback', err);
        applyProcessedImage(rawDataUrl, file.name, file.size);
      }
    };
    img.onerror = () => {
      applyProcessedImage(rawDataUrl, file.name, file.size);
    };
    img.src = rawDataUrl;
  };
  reader.readAsDataURL(file);
}

function applyProcessedImage(dataUrl, fileName, byteSize) {
  currentUploadedBase64 = dataUrl;
  const previewCont = document.getElementById('imagePreviewContainer');
  const previewImg = document.getElementById('imagePreviewImg');
  const previewName = document.getElementById('imagePreviewName');
  const previewStatus = document.getElementById('imagePreviewStatus');

  if (previewCont) previewCont.classList.remove('hidden');
  if (previewImg) previewImg.src = dataUrl;
  if (previewName) previewName.innerText = fileName;
  const kb = (byteSize / 1024).toFixed(1);
  if (previewStatus) previewStatus.innerText = `${kb} KB - Tối ưu siêu nhẹ`;
  showToast(`Đã nhận diện và tối ưu ảnh (${kb} KB)!`, 'success');
}

// Live preview khi dán URL ảnh trực tiếp
function previewDirectImageUrl() {
  const urlInp = document.getElementById('admProdImage');
  const livePreview = document.getElementById('admLiveUrlPreview');
  const liveImg = document.getElementById('admLiveUrlImg');
  const liveStatus = document.getElementById('admLiveUrlStatus');
  if (!urlInp || !livePreview) return;

  const rawUrl = urlInp.value.trim();
  if (!rawUrl) {
    livePreview.classList.add('hidden');
    return;
  }

  const formatted = formatImageUrl(rawUrl);
  livePreview.classList.remove('hidden');
  if (liveImg) {
    liveImg.src = formatted;
    liveImg.onload = () => {
      if (liveStatus) {
        liveStatus.innerHTML = `<span class="text-emerald-400 font-bold">✓ Ảnh hợp lệ & tương thích 100%</span>`;
      }
    };
    liveImg.onerror = () => {
      if (liveStatus) {
        liveStatus.innerHTML = `<span class="text-amber-400">⚠️ Link ảnh có thể bị chặn hoặc sai quyền chia sẻ!</span>`;
      }
    };
  }
}

function clearSelectedImage(e) {
  if (e) e.stopPropagation();
  currentSelectedFile = null;
  currentUploadedBase64 = null;
  const inp = document.getElementById('admProductFileInput');
  if (inp) inp.value = '';
  const previewCont = document.getElementById('imagePreviewContainer');
  if (previewCont) previewCont.classList.add('hidden');
}

// ---------------- THÊM / SỬA / XÓA SẢN PHẨM ----------------
function toggleProductTypeFields() {
  const pType = document.getElementById('admProdType')?.value;
  const grp = document.getElementById('admAccountKeysGroup');
  if (pType === 'account_keys') {
    if (grp) grp.classList.remove('hidden');
    updateKeyCountBadge();
  } else {
    if (grp) grp.classList.add('hidden');
  }
}

function updateKeyCountBadge() {
  const text = document.getElementById('admProdItemsText')?.value || '';
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const badge = document.getElementById('admKeyCountBadge');
  const stockInp = document.getElementById('admProdStock');

  if (badge) badge.innerText = `${lines.length} acc/key`;
  if (stockInp && document.getElementById('admProdType')?.value === 'account_keys') {
    stockInp.value = lines.length;
  }
}

function openEditProductModal(id) {
  const prod = allProducts.find(p => p.id === id);
  if (!prod) return;

  editingProductId = id;
  currentUploadedBase64 = null;
  currentSelectedFile = null;
  const urlPrev = document.getElementById('admLiveUrlPreview');
  if (urlPrev) urlPrev.classList.add('hidden');

  document.getElementById('admEditingProdId').value = id;
  document.getElementById('admProdName').value = prod.name;
  document.getElementById('admProdPrice').value = prod.price;
  document.getElementById('admProdStock').value = prod.stock;
  document.getElementById('admProdCategory').value = prod.category;
  document.getElementById('admProdDesc').value = prod.description || '';
  document.getElementById('admProdImage').value = prod.image || '';
  const dlInput = document.getElementById('admProdDownloadUrl');
  if (dlInput) dlInput.value = prod.downloadUrl || '';

  const pTypeSelect = document.getElementById('admProdType');
  if (pTypeSelect) {
    pTypeSelect.value = prod.type || 'download';
    toggleProductTypeFields();
  }

  // Hiển thị ảnh hiện tại
  const previewCont = document.getElementById('imagePreviewContainer');
  const previewImg = document.getElementById('imagePreviewImg');
  const previewName = document.getElementById('imagePreviewName');
  const previewStatus = document.getElementById('imagePreviewStatus');
  if (previewCont && prod.image) {
    previewCont.classList.remove('hidden');
    previewImg.src = formatImageUrl(prod.image);
    previewName.innerText = 'Ảnh hiện tại của sản phẩm';
    previewStatus.innerText = 'Kéo thả hoặc chọn ảnh mới nếu muốn thay';
  }

  document.getElementById('admProdSubmitBtn').innerHTML = '<i data-lucide="check" class="w-4 h-4"></i> Cập Nhật Sản Phẩm';
  document.getElementById('admCancelEditBtn').classList.remove('hidden');

  openModal('adminModal');
  switchAdminTab('product');
  lucide.createIcons();
}

function cancelEditingProduct() {
  editingProductId = null;
  document.getElementById('admEditingProdId').value = '';
  document.getElementById('adminAddProductForm').reset();
  const dlInput = document.getElementById('admProdDownloadUrl');
  if (dlInput) dlInput.value = '';
  const pTypeSelect = document.getElementById('admProdType');
  if (pTypeSelect) {
    pTypeSelect.value = 'download';
    toggleProductTypeFields();
  }
  const itemsText = document.getElementById('admProdItemsText');
  if (itemsText) itemsText.value = '';
  clearSelectedImage();
  document.getElementById('admProdSubmitBtn').innerHTML = '<i data-lucide="check" class="w-4 h-4"></i> Đăng Sản Phẩm';
  document.getElementById('admCancelEditBtn').classList.add('hidden');
  lucide.createIcons();
}

async function handleAdminAddProductSubmit(e) {
  e.preventDefault();

  const name = document.getElementById('admProdName').value.trim();
  const price = document.getElementById('admProdPrice').value;
  const stock = document.getElementById('admProdStock').value;
  const category = document.getElementById('admProdCategory').value;
  let image = document.getElementById('admProdImage').value.trim();
  const description = document.getElementById('admProdDesc').value.trim();
  const downloadUrl = (document.getElementById('admProdDownloadUrl') ? document.getElementById('admProdDownloadUrl').value.trim() : '');
  const type = document.getElementById('admProdType')?.value || 'download';
  const itemsText = document.getElementById('admProdItemsText')?.value || '';

  // 1. Nếu có ảnh kéo thả / chọn từ máy tính, tiến hành upload ảnh lên server
  if (currentUploadedBase64) {
    try {
      showToast('Đang tải hình ảnh lên máy chủ...', 'info');
      const upRes = await fetch('/api/admin/upload-image', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Admin-Username': 'hqk'
        },
        body: JSON.stringify({
          imageBase64: currentUploadedBase64,
          filename: currentSelectedFile ? currentSelectedFile.name : 'product.png',
          adminUsername: 'hqk'
        })
      });
      const upData = await upRes.json();
      if (upData.success && upData.imageUrl) {
        image = upData.imageUrl;
      }
    } catch (err) {
      console.warn('Upload image API error, fallback to base64/url');
      image = currentUploadedBase64;
    }
  }

  if (!image) {
    image = 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=500&auto=format&fit=crop&q=60';
  }

  try {
    const isEdit = !!editingProductId;
    const endpoint = isEdit ? `/api/products/${editingProductId}` : '/api/products';
    const method = isEdit ? 'PUT' : 'POST';

    const submitBtn = document.getElementById('admProdSubmitBtn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="animate-spin inline-block mr-1">⌛</span> Đang lưu sản phẩm...';
    }

    const res = await fetch(endpoint, {
      method: method,
      headers: { 
        'Content-Type': 'application/json',
        'X-Admin-Username': 'hqk'
      },
      body: JSON.stringify({
        name, price, stock, category, image, description, downloadUrl, type, itemsText,
        adminUsername: 'hqk'
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(isEdit ? 'Đã cập nhật sản phẩm thành công!' : 'Đã đăng sản phẩm mới thành công!', 'success');
      cancelEditingProduct();
      loadProducts();
    } else {
      showToast(data.message || 'Lỗi khi xử lý sản phẩm', 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối máy chủ khi lưu sản phẩm', 'error');
  } finally {
    const submitBtn = document.getElementById('admProdSubmitBtn');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = editingProductId 
        ? '<i data-lucide="check" class="w-4 h-4"></i> Cập Nhật Sản Phẩm' 
        : '<i data-lucide="check" class="w-4 h-4"></i> Đăng Sản Phẩm';
      lucide.createIcons();
    }
  }
}

async function deleteProduct(productId) {
  if ((!currentUser || currentUser.role !== 'admin') && getAdminUsername() !== 'hqk') return;
  if (!confirm('Bạn có chắc chắn muốn xóa sản phẩm này khỏi Shop?')) return;

  try {
    const res = await fetch(`/api/products/${productId}?adminUsername=hqk`, {
      method: 'DELETE',
      headers: {
        'X-Admin-Username': 'hqk'
      }
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Đã xóa sản phẩm thành công', 'success');
      loadProducts();
    } else {
      showToast(data.message || 'Lỗi khi xóa sản phẩm', 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối khi xóa sản phẩm', 'error');
  }
}

function renderAdminProductsList() {
  const container = document.getElementById('adminProductsList');
  if (!container) return;

  if (allProducts.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-500 py-2">Chưa có sản phẩm nào trong shop.</p>`;
    return;
  }

  container.innerHTML = allProducts.map(p => `
    <div class="bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between gap-3 text-xs">
      <div class="flex items-center gap-2.5 min-w-0">
        <img src="${formatImageUrl(p.image)}" onerror="this.src='https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=500&auto=format&fit=crop&q=60'" class="w-10 h-10 object-cover rounded-lg border border-slate-800 shrink-0">
        <div class="min-w-0">
          <p class="font-bold text-slate-200 truncate">${p.name}</p>
          <p class="text-[11px] text-slate-400">
            <span class="text-emerald-400 font-bold">${Number(p.price).toLocaleString('vi-VN')} đ</span> • Còn: ${p.stock} • ${p.category || 'Mặc định'}
            ${p.downloadUrl ? '<span class="ml-1 text-cyan-400 font-semibold">[Có link tải]</span>' : ''}
          </p>
        </div>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <button onclick="openEditProductModal('${p.id}')" title="Sửa sản phẩm" class="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-slate-950 font-bold rounded-lg transition flex items-center gap-1">
          <i data-lucide="edit-3" class="w-3 h-3"></i> Sửa
        </button>
        <button onclick="deleteProduct('${p.id}')" title="Xóa sản phẩm" class="p-1 bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white rounded-lg transition">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    </div>
  `).join('');

  lucide.createIcons();
}

// ---------------- QUẢN LÝ CÁC MỤC SẢN PHẨM (DANH MỤC) ----------------
function renderAdminCategoriesList() {
  const container = document.getElementById('adminCategoriesList');
  if (!container) return;

  const cats = Array.isArray(currentSettings.categories) ? currentSettings.categories : [];
  container.innerHTML = cats.map(c => {
    const isAll = c.toLowerCase() === 'tất cả';
    return `
      <div class="bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between text-xs">
        <span class="font-bold text-slate-200 flex items-center gap-2">
          <i data-lucide="tag" class="w-3.5 h-3.5 text-indigo-400"></i> ${c}
        </span>
        ${!isAll ? `
          <button onclick="handleDeleteCategory('${c}')" title="Xóa danh mục" class="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        ` : `
          <span class="text-[10px] text-slate-500 font-semibold px-2 py-0.5 rounded bg-slate-900 border border-slate-800">Mặc định</span>
        `}
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

async function handleAddCategory() {
  const input = document.getElementById('newCategoryInput');
  const cat = input.value.trim();
  if (!cat) {
    showToast('Vui lòng nhập tên mục sản phẩm!', 'warning');
    return;
  }

  const existing = currentSettings.categories || [];
  if (existing.some(c => c.toLowerCase() === cat.toLowerCase())) {
    showToast('Mục sản phẩm này đã tồn tại!', 'warning');
    return;
  }

  const newCats = [...existing, cat];
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Admin-Username': getAdminUsername()
      },
      body: JSON.stringify({
        adminUsername: getAdminUsername(),
        categories: newCats
      })
    });
    const data = await res.json();
    if (data.success) {
      currentSettings.categories = newCats;
      input.value = '';
      applyShopSettingsToUI();
      renderAdminCategoriesList();
      showToast(`Đã thêm mục [${cat}] vào Shop!`, 'success');
    }
  } catch (err) {
    showToast('Lỗi khi thêm mục sản phẩm', 'error');
  }
}

async function handleDeleteCategory(catName) {
  if (catName.toLowerCase() === 'tất cả') return;
  if (!confirm(`Bạn có chắc muốn xóa mục sản phẩm [${catName}]?`)) return;

  const newCats = (currentSettings.categories || []).filter(c => c !== catName);
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Admin-Username': getAdminUsername()
      },
      body: JSON.stringify({
        adminUsername: getAdminUsername(),
        categories: newCats
      })
    });
    const data = await res.json();
    if (data.success) {
      currentSettings.categories = newCats;
      applyShopSettingsToUI();
      renderAdminCategoriesList();
      showToast(`Đã xóa mục [${catName}]`, 'success');
    }
  } catch (err) {
    showToast('Lỗi khi xóa mục sản phẩm', 'error');
  }
}

// ---------------- LƯU THÔNG TIN SHOP & MÔ TẢ (THAY ĐỔI MỌI THỨ) ----------------
async function handleAdminSaveShopInfo(e) {
  e.preventDefault();

  const shopName = document.getElementById('cfgShopName').value.trim();
  const shopTitle = document.getElementById('cfgShopTitle').value.trim();
  const shopDesc = document.getElementById('cfgShopDesc').value.trim();
  const shopNotice = document.getElementById('cfgShopNotice').value.trim();
  const shopNoticeActive = document.getElementById('cfgShopNoticeActive').checked;
  const contactZalo = document.getElementById('cfgContactZalo').value.trim();
  const contactTelegram = document.getElementById('cfgContactTelegram').value.trim();
  const contactFacebook = document.getElementById('cfgContactFacebook').value.trim();

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Admin-Username': getAdminUsername()
      },
      body: JSON.stringify({
        adminUsername: getAdminUsername(),
        shopName,
        shopTitle,
        shopDesc,
        shopNotice,
        shopNoticeActive,
        contactZalo,
        contactTelegram,
        contactFacebook
      })
    });

    const data = await res.json();
    if (data.success) {
      currentSettings = { ...currentSettings, ...data.data };
      applyShopSettingsToUI();
      showToast('Đã lưu toàn bộ thay đổi tên shop, mô tả và giao diện!', 'success');
    } else {
      showToast(data.message || 'Lỗi khi lưu cấu hình', 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối máy chủ', 'error');
  }
}

// ---------------- LƯU CẤU HÌNH VIETQR & WEBHOOK ----------------
async function handleAdminSaveSettings(e) {
  e.preventDefault();
  const bankId = document.getElementById('admCfgBankId').value;
  const accountNo = document.getElementById('admCfgAccountNo').value.trim();
  const accountName = document.getElementById('admCfgAccountName').value.trim().toUpperCase();
  const webhookSecretKey = (document.getElementById('admCfgWebhookSecretKey')?.value || '').trim();
  const adminSecurityPin = (document.getElementById('admCfgSecurityPin')?.value || '').trim();
  const githubRepo = (document.getElementById('admCfgGithubRepo')?.value || '').trim();
  const githubToken = (document.getElementById('admCfgGithubToken')?.value || '').trim();
  const imgbbApiKey = (document.getElementById('admCfgImgbbKey')?.value || '').trim();

  let adminPin = '';
  if (currentSettings.hasSecurityPin) {
    adminPin = prompt('Nhập Mã PIN Quản Trị Cấp 2 Hiện Tại để xác nhận thay đổi cấu hình:');
    if (adminPin === null) return;
  }

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Username': getAdminUsername(),
        'x-admin-pin': adminPin
      },
      body: JSON.stringify({
        adminUsername: getAdminUsername(),
        bankId,
        accountNo,
        accountName,
        webhookSecretKey,
        adminSecurityPin,
        githubRepo,
        githubToken,
        imgbbApiKey,
        adminPin
      })
    });

    const data = await res.json();
    if (data.success) {
      currentSettings = { ...currentSettings, ...data.data };
      showToast('Đã lưu cấu hình tài khoản VietQR, Cloud Sync & Bảo mật thành công!', 'success');
    } else {
      showToast(data.message, 'error');
    }
  } catch (err) {
    showToast('Lỗi khi lưu cấu hình: ' + err.message, 'error');
  }
}

let currentDeliveredKeys = '';
function copyDeliveredKeys() {
  if (currentDeliveredKeys) {
    navigator.clipboard.writeText(currentDeliveredKeys);
    showToast('Đã sao chép danh sách Acc / Key thành công!', 'success');
  }
}

// ---------------- MUA HÀNG (BUY PRODUCT & PRODUCT DETAIL MODAL) ----------------
let currentSelectedProduct = null;
let currentBuyQty = 1;

function handleBuyProduct(productId) {
  openProductDetail(productId);
}

function openProductDetail(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  currentSelectedProduct = product;
  currentBuyQty = 1;

  const imgElem = document.getElementById('detailProdImage');
  if (imgElem) imgElem.src = formatImageUrl(product.image);

  const catElem = document.getElementById('detailProdCategory');
  if (catElem) catElem.innerText = product.category || 'Sản phẩm';

  const stockElem = document.getElementById('detailProdStock');
  const isOutOfStock = product.stock <= 0;
  if (stockElem) {
    stockElem.innerText = isOutOfStock ? 'Hết hàng' : `Còn lại: ${product.stock}`;
    stockElem.className = isOutOfStock 
      ? 'px-2 py-0.5 rounded-lg text-xs font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30'
      : 'px-2 py-0.5 rounded-lg text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
  }

  const titleElem = document.getElementById('detailProdName');
  if (titleElem) titleElem.innerText = product.name;

  const descElem = document.getElementById('detailProdDesc');
  if (descElem) descElem.innerText = product.description || 'Sản phẩm chất lượng cao, bảo hành uy tín, hỗ trợ 24/7.';

  const typeBadge = document.getElementById('detailProdTypeBadge');
  if (typeBadge) {
    if (product.type === 'account_keys') {
      typeBadge.innerHTML = `<i data-lucide="key" class="w-3.5 h-3.5 text-emerald-400"></i> Bàn giao Acc/Key Tự Động`;
      typeBadge.className = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-500/30';
    } else if (product.downloadUrl) {
      typeBadge.innerHTML = `<i data-lucide="download" class="w-3.5 h-3.5 text-cyan-400"></i> Link Tải File Tự Động`;
      typeBadge.className = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-500/30';
    } else {
      typeBadge.innerHTML = `<i data-lucide="shield-check" class="w-3.5 h-3.5 text-indigo-400"></i> Kích hoạt trực tiếp`;
      typeBadge.className = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs font-bold bg-indigo-950/80 text-indigo-300 border border-indigo-500/30';
    }
  }

  const unitPriceElem = document.getElementById('detailProdPrice');
  if (unitPriceElem) unitPriceElem.innerText = Number(product.price).toLocaleString('vi-VN') + ' đ';

  updateDetailBuyCalculation();
  openModal('productDetailModal');
  lucide.createIcons();
}

function changeDetailQty(delta) {
  if (!currentSelectedProduct) return;
  const maxStock = currentSelectedProduct.stock > 0 ? currentSelectedProduct.stock : 1;
  let newQty = currentBuyQty + delta;
  if (newQty < 1) newQty = 1;
  if (newQty > maxStock) newQty = maxStock;
  currentBuyQty = newQty;
  updateDetailBuyCalculation();
}

function updateDetailBuyCalculation() {
  if (!currentSelectedProduct) return;
  const qtyInput = document.getElementById('detailBuyQtyInput');
  if (qtyInput) qtyInput.value = currentBuyQty;

  const totalCost = currentSelectedProduct.price * currentBuyQty;
  const totalElem = document.getElementById('detailTotalCost');
  if (totalElem) totalElem.innerText = totalCost.toLocaleString('vi-VN') + ' đ';

  const userBal = currentUser ? Number(currentUser.balance || 0) : 0;
  const userBalElem = document.getElementById('detailUserBalance');
  if (userBalElem) userBalElem.innerText = userBal.toLocaleString('vi-VN') + ' đ';

  const remaining = userBal - totalCost;
  const remainBox = document.getElementById('detailRemainingBox');
  const remainElem = document.getElementById('detailRemainingBalance');
  const buyBtn = document.getElementById('detailConfirmBuyBtn');
  const depositPromptBtn = document.getElementById('detailNeedDepositBtn');

  if (!currentUser) {
    if (remainBox) remainBox.classList.add('hidden');
    if (buyBtn) {
      buyBtn.classList.remove('hidden');
      buyBtn.disabled = false;
      buyBtn.innerHTML = `<i data-lucide="log-in" class="w-4 h-4"></i> Đăng nhập để mua hàng`;
      buyBtn.onclick = () => { closeModal('productDetailModal'); openAuthModal('login'); };
    }
    if (depositPromptBtn) depositPromptBtn.classList.add('hidden');
  } else if (remaining < 0) {
    if (remainBox) {
      remainBox.classList.remove('hidden');
      remainElem.className = 'text-xs font-bold text-rose-400';
      remainElem.innerText = `Thiếu ${Math.abs(remaining).toLocaleString('vi-VN')} đ`;
    }
    if (buyBtn) buyBtn.classList.add('hidden');
    if (depositPromptBtn) {
      depositPromptBtn.classList.remove('hidden');
      depositPromptBtn.innerHTML = `<i data-lucide="wallet-cards" class="w-4 h-4"></i> Nạp thêm ${Math.abs(remaining).toLocaleString('vi-VN')} đ qua VietQR`;
    }
  } else {
    if (remainBox) {
      remainBox.classList.remove('hidden');
      remainElem.className = 'text-xs font-bold text-emerald-400';
      remainElem.innerText = `${remaining.toLocaleString('vi-VN')} đ`;
    }
    if (depositPromptBtn) depositPromptBtn.classList.add('hidden');
    if (buyBtn) {
      buyBtn.classList.remove('hidden');
      buyBtn.disabled = currentSelectedProduct.stock <= 0;
      buyBtn.innerHTML = currentSelectedProduct.stock <= 0
        ? 'Sản phẩm tạm thời hết hàng'
        : `<i data-lucide="shopping-bag" class="w-4 h-4"></i> Xác Nhận Mua Hàng (${totalCost.toLocaleString('vi-VN')} đ)`;
      buyBtn.onclick = confirmExecuteBuy;
    }
  }
}

async function confirmExecuteBuy() {
  if (!currentSelectedProduct) return;
  if (!currentUser) {
    showToast('Vui lòng đăng nhập để mua sản phẩm!', 'warning');
    closeModal('productDetailModal');
    openAuthModal('login');
    return;
  }

  const buyBtn = document.getElementById('detailConfirmBuyBtn');
  if (buyBtn) {
    buyBtn.disabled = true;
    buyBtn.innerHTML = `<span class="animate-spin inline-block mr-1">⌛</span> Đang xử lý giao dịch...`;
  }

  try {
    const res = await fetch('/api/orders/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: currentSelectedProduct.id,
        quantity: currentBuyQty
      })
    });

    const data = await res.json();
    if (data.success) {
      currentUser.balance = data.newBalance;
      localStorage.setItem('shophqk_user', JSON.stringify(currentUser));
      updateAuthUI();
      loadProducts();
      closeModal('productDetailModal');

      const pNameElem = document.getElementById('buySuccessProductName');
      if (pNameElem) pNameElem.innerText = `Sản phẩm: ${data.productName || currentSelectedProduct.name} (SL: ${currentBuyQty})`;

      const keysBox = document.getElementById('buySuccessKeysBox');
      const dlBox = document.getElementById('buySuccessDownloadBox');

      if (Array.isArray(data.deliveredItems) && data.deliveredItems.length > 0) {
        currentDeliveredKeys = data.deliveredItems.join('\n');
        const keysText = document.getElementById('buySuccessKeysText');
        if (keysText) keysText.innerText = currentDeliveredKeys;
        if (keysBox) keysBox.classList.remove('hidden');
      } else {
        if (keysBox) keysBox.classList.add('hidden');
      }

      if (data.downloadUrl && data.downloadUrl.trim() !== '') {
        currentDownloadLink = data.downloadUrl.trim();
        const pLinkElem = document.getElementById('buySuccessDownloadLinkText');
        if (pLinkElem) pLinkElem.innerText = currentDownloadLink;
        const pBtnElem = document.getElementById('buySuccessDownloadBtn');
        if (pBtnElem) pBtnElem.href = currentDownloadLink;
        if (dlBox) dlBox.classList.remove('hidden');
      } else {
        if (dlBox) dlBox.classList.add('hidden');
      }

      openModal('buySuccessModal');
      showToast('Mua hàng thành công! Đã trừ tiền trong ví.', 'success');
      lucide.createIcons();
    } else {
      showToast(data.message || 'Thanh toán thất bại!', 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối máy chủ khi mua hàng!', 'error');
  } finally {
    if (buyBtn) buyBtn.disabled = false;
  }
}

// ---------------- AUTH LOGIC ----------------
function openAuthModal(tab = 'login') {
  switchAuthTab(tab);
  openModal('authModal');
}

function switchAuthTab(tab) {
  currentAuthTab = tab;
  const isLogin = tab === 'login';

  document.getElementById('tabLogin').className = isLogin
    ? 'flex-1 py-2.5 text-xs sm:text-sm font-bold text-indigo-400 border-b-2 border-indigo-500'
    : 'flex-1 py-2.5 text-xs sm:text-sm font-medium text-slate-400 hover:text-slate-200';

  document.getElementById('tabRegister').className = !isLogin
    ? 'flex-1 py-2.5 text-xs sm:text-sm font-bold text-indigo-400 border-b-2 border-indigo-500'
    : 'flex-1 py-2.5 text-xs sm:text-sm font-medium text-slate-400 hover:text-slate-200';

  const fullnameGroup = document.getElementById('fullnameGroup');
  const authSubmitBtn = document.getElementById('authSubmitBtn');

  if (isLogin) {
    fullnameGroup.classList.add('hidden');
    authSubmitBtn.innerText = 'Đăng Nhập';
  } else {
    fullnameGroup.classList.remove('hidden');
    authSubmitBtn.innerText = 'Đăng Ký Tài Khoản Mới';
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const username = document.getElementById('authUsername').value.trim();
  const password = document.getElementById('authPassword').value;
  const fullname = document.getElementById('authFullname').value.trim();

  const endpoint = currentAuthTab === 'login' ? '/api/auth/login' : '/api/auth/register';
  const body = currentAuthTab === 'login' 
    ? { username, password } 
    : { username, password, fullname };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      currentUser = data.data;
      localStorage.setItem('shophqk_user', JSON.stringify(currentUser));
      if (data.token) {
        localStorage.setItem('shophqk_token', data.token);
      }
      updateAuthUI();
      closeModal('authModal');
      document.getElementById('authForm').reset();
      renderProducts();
    } else {
      showToast(data.message || 'Thao tác không thành công', 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối máy chủ', 'error');
  }
}

function logout() {
  currentUser = null;
  localStorage.removeItem('shophqk_user');
  localStorage.removeItem('shophqk_token');
  updateAuthUI();
  renderProducts();
  showToast('Đã đăng xuất tài khoản!', 'info');
}

// ---------------- ĐỔI MẬT KHẨU TÀI KHOẢN ----------------
function openChangePasswordModal() {
  if (!currentUser) {
    showToast('Vui lòng đăng nhập để đổi mật khẩu!', 'warning');
    openAuthModal('login');
    return;
  }
  openModal('changePasswordModal');
}

async function handleChangePasswordSubmit(e) {
  e.preventDefault();
  const oldPassword = document.getElementById('cpOldPassword').value;
  const newPassword = document.getElementById('cpNewPassword').value;
  const confirmPassword = document.getElementById('cpConfirmPassword').value;

  if (newPassword !== confirmPassword) {
    showToast('Mật khẩu xác nhận không trùng khớp!', 'warning');
    return;
  }

  if (newPassword.length < 6) {
    showToast('Mật khẩu mới phải có ít nhất 6 ký tự!', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword, newPassword })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      closeModal('changePasswordModal');
      document.getElementById('changePasswordForm').reset();
    } else {
      showToast(data.message || 'Lỗi khi đổi mật khẩu', 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối máy chủ: ' + err.message, 'error');
  }
}

function updateAuthUI() {
  const loggedInBlock = document.getElementById('userLoggedInBlock');
  const loggedOutBlock = document.getElementById('userLoggedOutBlock');
  const navAdminBtn = document.getElementById('navAdminBtn');
  const mobileNavAdminBtn = document.getElementById('mobileNavAdminBtn');
  const adminBadge = document.getElementById('adminBadge');
  const mobileAccountLabel = document.getElementById('mobileAccountLabel');

  if (currentUser) {
    loggedInBlock.classList.remove('hidden');
    loggedOutBlock.classList.add('hidden');
    document.getElementById('usernameText').innerText = currentUser.fullname || currentUser.username;
    document.getElementById('userBalanceText').innerText = Number(currentUser.balance || 0).toLocaleString('vi-VN') + ' đ';
    if (mobileAccountLabel) mobileAccountLabel.innerText = currentUser.username;

    const isAdmin = currentUser.role === 'admin';
    if (isAdmin) {
      if (navAdminBtn) navAdminBtn.classList.remove('hidden');
      if (mobileNavAdminBtn) mobileNavAdminBtn.classList.remove('hidden');
      if (adminBadge) adminBadge.classList.remove('hidden');
    } else {
      if (navAdminBtn) navAdminBtn.classList.add('hidden');
      if (mobileNavAdminBtn) mobileNavAdminBtn.classList.add('hidden');
      if (adminBadge) adminBadge.classList.add('hidden');
    }
  } else {
    loggedInBlock.classList.add('hidden');
    loggedOutBlock.classList.remove('hidden');
    if (navAdminBtn) navAdminBtn.classList.add('hidden');
    if (mobileNavAdminBtn) mobileNavAdminBtn.classList.add('hidden');
    if (adminBadge) adminBadge.classList.add('hidden');
    if (mobileAccountLabel) mobileAccountLabel.innerText = 'Tài Khoản';
  }
  lucide.createIcons();
}

function handleMobileAccountClick() {
  if (!currentUser) {
    openAuthModal('login');
    return;
  }

  const nameElem = document.getElementById('mobDrawerUsername');
  if (nameElem) nameElem.innerText = currentUser.fullname || currentUser.username;

  const initElem = document.getElementById('mobDrawerAvatarInitial');
  if (initElem) initElem.innerText = (currentUser.username || 'U')[0].toUpperCase();

  const roleElem = document.getElementById('mobDrawerRoleBadge');
  if (roleElem) {
    if (currentUser.role === 'admin') {
      roleElem.innerText = 'ADMIN';
      roleElem.className = 'text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40';
    } else {
      roleElem.innerText = 'THÀNH VIÊN';
      roleElem.className = 'text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40';
    }
  }

  const balElem = document.getElementById('mobDrawerBalance');
  if (balElem) balElem.innerText = Number(currentUser.balance || 0).toLocaleString('vi-VN') + ' đ';

  const admBtn = document.getElementById('mobDrawerAdminBtn');
  if (admBtn) {
    if (currentUser.role === 'admin') {
      admBtn.classList.remove('hidden');
    } else {
      admBtn.classList.add('hidden');
    }
  }

  openModal('mobileUserModal');
  lucide.createIcons();
}

async function refreshUserBalance() {
  if (!currentUser) return;
  try {
    const res = await fetch(`/api/auth/me/${currentUser.username}`);
    const data = await res.json();
    if (data.success) {
      currentUser.balance = data.data.balance;
      currentUser.role = data.data.role;
      localStorage.setItem('shophqk_user', JSON.stringify(currentUser));
      updateAuthUI();
    }
  } catch (err) {
    //
  }
}

// ---------------- ADMIN PANEL LOGIC ----------------
function openAdminPanel() {
  if (!currentUser || currentUser.role !== 'admin') {
    showToast('Vui lòng đăng nhập tài khoản Admin hqk để vào trang quản trị!', 'error');
    openAuthModal('login');
    return;
  }
  openModal('adminModal');
  loadAdminFullSettings();
  switchAdminTab('product');
}

const adminTabConfig = {
  product: { btnId: 'admTabProduct', secId: 'admSectionProduct' },
  categories: { btnId: 'admTabCategories', secId: 'admSectionCategories' },
  shopInfo: { btnId: 'admTabShopInfo', secId: 'admSectionShopInfo' },
  shop_info: { btnId: 'admTabShopInfo', secId: 'admSectionShopInfo' },
  users: { btnId: 'admTabUsers', secId: 'admSectionUsers' },
  deposits: { btnId: 'admTabDeposits', secId: 'admSectionDeposits' },
  orders: { btnId: 'admTabOrders', secId: 'admSectionOrders' },
  settings: { btnId: 'admTabSettings', secId: 'admSectionSettings' },
  cards: { btnId: 'admTabCards', secId: 'admSectionCards' },
  audit: { btnId: 'admTabAudit', secId: 'admSectionAudit' },
  backups: { btnId: 'admTabBackups', secId: 'admSectionBackups' },
  webhookLogs: { btnId: 'admTabWebhookLogs', secId: 'admSectionWebhookLogs' }
};

function switchAdminTab(rawTab) {
  let tab = rawTab;
  if (tab === 'shop_info') tab = 'shopInfo';
  if (!adminTabConfig[tab]) tab = 'product';

  const tabKeys = ['product', 'categories', 'shopInfo', 'users', 'deposits', 'orders', 'settings', 'cards', 'audit', 'backups', 'webhookLogs'];

  tabKeys.forEach(key => {
    const cfg = adminTabConfig[key];
    if (!cfg) return;
    const btn = document.getElementById(cfg.btnId);
    const sec = document.getElementById(cfg.secId);
    const isCurrent = (key === tab);

    if (btn) {
      if (isCurrent) {
        btn.className = 'admin-tab active shrink-0 px-3 py-2 rounded-xl text-xs font-bold bg-amber-500 text-slate-950 transition flex items-center gap-2 w-auto md:w-full text-left shadow-sm';
      } else {
        btn.className = 'admin-tab shrink-0 px-3 py-2 rounded-xl text-xs font-medium bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-800 transition flex items-center gap-2 w-auto md:w-full text-left';
      }
    }
    if (sec) {
      if (isCurrent) {
        sec.classList.remove('hidden');
      } else {
        sec.classList.add('hidden');
      }
    }
  });

  try {
    if (tab === 'product') {
      renderAdminProductsList();
    } else if (tab === 'categories') {
      renderAdminCategoriesList();
    } else if (tab === 'shopInfo' || tab === 'settings') {
      loadAdminFullSettings();
    } else if (tab === 'users') {
      loadAdminUsers();
    } else if (tab === 'deposits') {
      loadAdminDeposits();
    } else if (tab === 'orders') {
      loadAdminOrders();
    } else if (tab === 'cards') {
      loadAdminCards();
      loadAdminFullSettings();
    } else if (tab === 'audit') {
      loadAdminAuditLogs();
    } else if (tab === 'backups') {
      loadAdminBackups();
    } else if (tab === 'webhookLogs') {
      loadAdminWebhookLogs();
    }
  } catch (err) {
    console.error('Lỗi khi tải tab admin:', err);
  }

  // Cuộn tab đang chọn vào giữa tầm nhìn trên màn hình điện thoại
  const activeCfg = adminTabConfig[tab];
  if (activeCfg) {
    const activeBtn = document.getElementById(activeCfg.btnId);
    if (activeBtn && typeof window !== 'undefined' && window.innerWidth < 768) {
      activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
}

// ---------------- QUẢN LÝ THÀNH VIÊN & SỐ DƯ (ADMIN) ----------------
async function loadAdminUsers() {
  const table = document.getElementById('adminUsersTable');
  table.innerHTML = `<tr><td colspan="5" class="p-3 text-center text-slate-500">Đang tải danh sách người dùng...</td></tr>`;

  try {
    const res = await fetch(`/api/admin/users?adminUsername=${getAdminUsername()}`);
    const data = await res.json();

    if (!data.success || data.data.length === 0) {
      table.innerHTML = `<tr><td colspan="5" class="p-3 text-center text-slate-500">Chưa có người dùng nào.</td></tr>`;
      return;
    }

    table.innerHTML = data.data.map(u => {
      const isSelf = currentUser && u.username && u.username.toLowerCase() === currentUser.username.toLowerCase();
      const isAdmin = u.role === 'admin';

      return `
        <tr class="hover:bg-slate-800/40 transition">
          <td class="p-2.5 font-mono font-bold text-indigo-300 flex items-center gap-1 flex-wrap">
            ${isAdmin ? '👑' : '👤'} ${u.username}
            ${u.isBanned ? '<span class="ml-1 text-[10px] bg-rose-500/20 text-rose-400 border border-rose-500/30 px-1 py-0.5 rounded font-sans">BỊ KHÓA</span>' : ''}
          </td>
          <td class="p-2.5 text-slate-300">${u.fullname || '-'}</td>
          <td class="p-2.5 font-extrabold text-emerald-400">
            ${Number(u.balance || 0).toLocaleString('vi-VN')} đ
          </td>
          <td class="p-2.5">
            <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${isAdmin ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-slate-800 text-slate-400'}">
              ${u.role.toUpperCase()}
            </span>
          </td>
          <td class="p-2.5 text-right space-x-1">
            <button onclick="openAdjustBalanceModal('${u.username}', ${u.balance || 0})" title="Cộng / Giảm / Xóa tiền" class="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[11px] font-bold transition shadow-sm">
              💰 Quản lý tiền
            </button>
            ${!isSelf ? `
              <button onclick="adminToggleBan('${u.username}', ${!u.isBanned})" title="${u.isBanned ? 'Mở khóa tài khoản' : 'Khóa tài khoản'}" class="px-2 py-1 ${u.isBanned ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-amber-600 hover:bg-amber-500'} text-white rounded-lg text-[11px] font-bold transition">
                ${u.isBanned ? '🔓 Mở' : '🔒 Khóa'}
              </button>
              <button onclick="adminDeleteUser('${u.username}')" title="Xóa tài khoản" class="px-2 py-1 bg-rose-600/80 hover:bg-rose-600 text-white rounded-lg text-[11px] font-bold transition">
                🗑️
              </button>
            ` : ''}
          </td>
        </tr>
      `;
    }).join('');
    lucide.createIcons();
  } catch (err) {
    table.innerHTML = `<tr><td colspan="5" class="p-3 text-center text-rose-400">Lỗi khi tải danh sách người dùng.</td></tr>`;
  }
}

function setBalanceMode(mode) {
  currentBalanceMode = mode;
  const btnAdd = document.getElementById('btnModeAdd');
  const btnDeduct = document.getElementById('btnModeDeduct');
  const btnReset = document.getElementById('btnModeReset');
  const amountGroup = document.getElementById('balanceAmountGroup');
  const resetWarning = document.getElementById('balanceResetWarning');
  const submitBtn = document.getElementById('balanceSubmitBtn');
  const amountLabel = document.getElementById('balanceAmountLabel');
  const amountInput = document.getElementById('balanceAmountInput');

  if (btnAdd) {
    btnAdd.className = mode === 'add'
      ? 'py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white transition flex items-center justify-center gap-1 shadow-sm'
      : 'py-1.5 text-xs font-medium rounded-lg text-slate-400 hover:text-white transition flex items-center justify-center gap-1';
  }
  if (btnDeduct) {
    btnDeduct.className = mode === 'deduct'
      ? 'py-1.5 text-xs font-bold rounded-lg bg-amber-600 text-white transition flex items-center justify-center gap-1 shadow-sm'
      : 'py-1.5 text-xs font-medium rounded-lg text-slate-400 hover:text-white transition flex items-center justify-center gap-1';
  }
  if (btnReset) {
    btnReset.className = mode === 'reset'
      ? 'py-1.5 text-xs font-bold rounded-lg bg-rose-600 text-white transition flex items-center justify-center gap-1 shadow-sm'
      : 'py-1.5 text-xs font-medium rounded-lg text-rose-400 hover:bg-rose-500/10 transition flex items-center justify-center gap-1';
  }

  if (mode === 'reset') {
    if (amountGroup) amountGroup.classList.add('hidden');
    if (resetWarning) resetWarning.classList.remove('hidden');
    if (amountInput) amountInput.removeAttribute('required');
    if (submitBtn) {
      submitBtn.className = 'w-full py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-1.5 text-xs';
      submitBtn.innerHTML = '<i data-lucide="alert-triangle" class="w-4 h-4"></i> Xác Nhận XÓA VỀ 0 VNĐ';
    }
  } else if (mode === 'deduct') {
    if (amountGroup) amountGroup.classList.remove('hidden');
    if (resetWarning) resetWarning.classList.add('hidden');
    if (amountLabel) {
      amountLabel.className = 'block text-xs font-semibold text-amber-400 mb-1';
      amountLabel.innerText = 'Số tiền muốn GIẢM BỚT (VNĐ):';
    }
    if (amountInput) amountInput.setAttribute('required', 'true');
    if (submitBtn) {
      submitBtn.className = 'w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-1.5 text-xs';
      submitBtn.innerHTML = '<i data-lucide="minus-circle" class="w-4 h-4"></i> Xác Nhận Giảm Tiền';
    }
  } else {
    // add
    if (amountGroup) amountGroup.classList.remove('hidden');
    if (resetWarning) resetWarning.classList.add('hidden');
    if (amountLabel) {
      amountLabel.className = 'block text-xs font-semibold text-emerald-400 mb-1';
      amountLabel.innerText = 'Số tiền muốn CỘNG THÊM (VNĐ):';
    }
    if (amountInput) amountInput.setAttribute('required', 'true');
    if (submitBtn) {
      submitBtn.className = 'w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-1.5 text-xs';
      submitBtn.innerHTML = '<i data-lucide="check" class="w-4 h-4"></i> Xác Nhận Cộng Tiền';
    }
  }
  lucide.createIcons();
}

function setQuickAmount(val) {
  const input = document.getElementById('balanceAmountInput');
  if (input) {
    input.value = val;
    input.focus();
  }
}

function openAdjustBalanceModal(username, currentBalance) {
  targetAdjustUser = username;
  document.getElementById('balanceTargetUser').innerText = username;
  document.getElementById('balanceCurrentVal').innerText = Number(currentBalance).toLocaleString('vi-VN') + ' đ';
  document.getElementById('balanceAmountInput').value = '';
  document.getElementById('balanceReasonInput').value = '';
  setBalanceMode('add');
  openModal('addBalanceModal');
}

async function submitAddBalance(e) {
  e.preventDefault();
  if (!targetAdjustUser) return;

  const amountVal = Number(document.getElementById('balanceAmountInput').value || 0);
  const reason = document.getElementById('balanceReasonInput').value.trim();

  if (currentBalanceMode !== 'reset' && (!amountVal || amountVal <= 0)) {
    showToast('Vui lòng nhập số tiền lớn hơn 0 VNĐ!', 'error');
    return;
  }

  if (currentBalanceMode === 'reset') {
    const ok = confirm(`CẢNH BÁO NGUY HIỂM:\nBạn có chắc chắn muốn XÓA SẠCH toàn bộ số dư của user [${targetAdjustUser}] về 0 VNĐ không?`);
    if (!ok) return;
  }

  try {
    const res = await fetch('/api/admin/add-balance', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Admin-Username': getAdminUsername()
      },
      body: JSON.stringify({
        adminUsername: getAdminUsername(),
        targetUsername: targetAdjustUser,
        amount: amountVal,
        action: currentBalanceMode,
        reason: reason
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      closeModal('addBalanceModal');
      loadAdminUsers();
      if (currentUser && targetAdjustUser.toLowerCase() === currentUser.username.toLowerCase()) {
        currentUser.balance = data.newBalance;
        localStorage.setItem('shophqk_user', JSON.stringify(currentUser));
        updateAuthUI();
      }
    } else {
      showToast(data.message || 'Thao tác không thành công', 'error');
    }
  } catch (err) {
    showToast('Lỗi khi điều chỉnh số dư', 'error');
  }
}

async function adminDeleteUser(username) {
  if (!confirm(`Bạn có chắc muốn xóa vĩnh viễn tài khoản [${username}]?`)) return;

  try {
    const res = await fetch(`/api/admin/users/${username}`, {
      method: 'DELETE',
      headers: { 
        'Content-Type': 'application/json',
        'X-Admin-Username': getAdminUsername()
      },
      body: JSON.stringify({ adminUsername: getAdminUsername() })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      loadAdminUsers();
    } else {
      showToast(data.message, 'error');
    }
  } catch (err) {
    showToast('Lỗi khi xóa tài khoản', 'error');
  }
}

// ---------------- DUYỆT NẠP TIỀN VIETQR (ADMIN) ----------------
async function loadAdminDeposits() {
  const table = document.getElementById('adminDepositsTable');
  table.innerHTML = `<tr><td colspan="6" class="p-3 text-center text-slate-500">Đang tải danh sách đơn nạp...</td></tr>`;

  try {
    const res = await fetch(`/api/admin/deposits?adminUsername=${getAdminUsername()}`);
    const data = await res.json();

    if (!data.success || data.data.length === 0) {
      table.innerHTML = `<tr><td colspan="6" class="p-3 text-center text-slate-500">Chưa có giao dịch nạp tiền nào.</td></tr>`;
      return;
    }

    const pending = data.data.filter(d => d.status === 'PENDING').length;
    const badge = document.getElementById('pendingBadge');
    if (badge) {
      if (pending > 0) {
        badge.innerText = pending;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    table.innerHTML = data.data.map(tx => {
      const isPending = tx.status === 'PENDING';
      const time = new Date(tx.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' ' + new Date(tx.createdAt).toLocaleDateString('vi-VN');

      return `
        <tr class="hover:bg-slate-800/40 transition">
          <td class="p-2.5 font-mono font-bold text-amber-400">${tx.code || tx.id.slice(-6)}</td>
          <td class="p-2.5 font-bold text-indigo-300">${tx.username}</td>
          <td class="p-2.5 font-extrabold text-emerald-400">
            +${Number(tx.amount).toLocaleString('vi-VN')} đ
          </td>
          <td class="p-2.5 font-mono text-slate-300 text-[11px]">${tx.memo || '-'}</td>
          <td class="p-2.5">
            <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${isPending ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}">
              ${isPending ? '⏳ Chờ duyệt' : '✅ Đã duyệt'}
            </span>
          </td>
          <td class="p-2.5 text-right">
            ${isPending ? `
              <button onclick="adminApproveDeposit('${tx.id}')" class="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-bold transition flex items-center gap-1 ml-auto">
                <i data-lucide="check" class="w-3 h-3"></i> Duyệt
              </button>
            ` : `
              <span class="text-[11px] text-slate-500">Hoàn tất</span>
            `}
          </td>
        </tr>
      `;
    }).join('');
    lucide.createIcons();
  } catch (err) {
    table.innerHTML = `<tr><td colspan="6" class="p-3 text-center text-rose-400">Lỗi khi tải danh sách nạp tiền.</td></tr>`;
  }
}

let allAdminOrders = [];

async function loadAdminOrders() {
  const table = document.getElementById('adminOrdersTable');
  if (!table) return;
  table.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">Đang tải lịch sử đơn mua của các user...</td></tr>`;

  try {
    const res = await fetch(`/api/admin/orders?adminUsername=${encodeURIComponent(getAdminUsername())}`);
    const data = await res.json();
    if (!data.success || !Array.isArray(data.data) || data.data.length === 0) {
      table.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">Chưa có user nào mua hàng.</td></tr>`;
      updateOrderStats([]);
      return;
    }

    allAdminOrders = data.data;
    updateOrderStats(allAdminOrders);
    renderAdminOrdersList(allAdminOrders);
  } catch (err) {
    console.error('Lỗi khi tải lịch sử đơn hàng cho admin:', err);
    table.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-rose-400">Không thể tải dữ liệu: ${err.message}</td></tr>`;
  }
}

function updateOrderStats(orders) {
  const totalOrdersEl = document.getElementById('statTotalOrders');
  const totalRevEl = document.getElementById('statTotalRevenue');
  const uniqueBuyersEl = document.getElementById('statUniqueBuyers');

  if (totalOrdersEl) totalOrdersEl.innerText = orders.length;
  if (totalRevEl) {
    const total = orders.reduce((sum, o) => sum + (Number(o.totalCost) || Number(o.price) || 0), 0);
    totalRevEl.innerText = total.toLocaleString('vi-VN') + ' đ';
  }
  if (uniqueBuyersEl) {
    const buyers = new Set(orders.map(o => (o.username || '').toLowerCase()).filter(Boolean));
    uniqueBuyersEl.innerText = buyers.size;
  }
}

function renderAdminOrdersList(orders) {
  const table = document.getElementById('adminOrdersTable');
  if (!table) return;

  if (orders.length === 0) {
    table.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">Không tìm thấy đơn hàng nào phù hợp.</td></tr>`;
    return;
  }

  table.innerHTML = orders.map(ord => {
    const time = new Date(ord.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' ' + new Date(ord.createdAt).toLocaleDateString('vi-VN');
    const total = Number(ord.totalCost) || (Number(ord.price) * (Number(ord.quantity) || 1)) || 0;
    const download = ord.downloadUrl ? ord.downloadUrl : '';

    return `
      <tr class="hover:bg-slate-800/40 transition">
        <td class="p-2.5">
          <div class="font-mono font-bold text-amber-400 text-[11px]">${ord.id || '-'}</div>
          <div class="text-[10px] text-slate-400">${time}</div>
        </td>
        <td class="p-2.5 font-bold text-indigo-300">
          <div class="flex items-center gap-1.5">
            <span class="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[10px] font-bold">
              ${(ord.username || 'U')[0].toUpperCase()}
            </span>
            <span>${ord.username || 'Khách'}</span>
          </div>
        </td>
        <td class="p-2.5">
          <div class="font-semibold text-white max-w-[200px] truncate" title="${ord.productName || ''}">${ord.productName || 'Sản phẩm'}</div>
          <div class="text-[10px] text-slate-500 font-mono">ID: ${(ord.productId || '').slice(-6)}</div>
        </td>
        <td class="p-2.5 text-right font-medium text-slate-300">
          <div>SL: <strong class="text-white">${ord.quantity || 1}</strong></div>
          <div class="text-[10px] text-slate-400">${(Number(ord.price) || 0).toLocaleString('vi-VN')} đ</div>
        </td>
        <td class="p-2.5 text-right font-extrabold text-emerald-400">
          ${total.toLocaleString('vi-VN')} đ
        </td>
        <td class="p-2.5 text-center">
          ${download ? `
            <a href="${download}" target="_blank" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 text-[11px] font-semibold transition" title="${download}">
              <i data-lucide="external-link" class="w-3 h-3"></i> Mở Link
            </a>
          ` : `<span class="text-slate-500 text-[11px] italic">Không có link</span>`}
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
}

function filterAdminOrders() {
  const query = (document.getElementById('adminOrderSearch')?.value || '').trim().toLowerCase();
  if (!query) {
    renderAdminOrdersList(allAdminOrders);
    return;
  }
  const filtered = allAdminOrders.filter(o => 
    (o.username && o.username.toLowerCase().includes(query)) ||
    (o.productName && o.productName.toLowerCase().includes(query)) ||
    (o.id && o.id.toLowerCase().includes(query))
  );
  renderAdminOrdersList(filtered);
}

async function adminApproveDeposit(txId) {
  try {
    const res = await fetch('/api/admin/approve-deposit', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Admin-Username': getAdminUsername()
      },
      body: JSON.stringify({
        adminUsername: getAdminUsername(),
        txId: txId
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      loadAdminDeposits();
      if (currentUser && data.targetUser.toLowerCase() === currentUser.username.toLowerCase()) {
        currentUser.balance = data.newBalance;
        localStorage.setItem('shophqk_user', JSON.stringify(currentUser));
        updateAuthUI();
      }
    } else {
      showToast(data.message, 'error');
    }
  } catch (err) {
    showToast('Lỗi khi duyệt nạp tiền', 'error');
  }
}

// ---------------- NẠP TIỀN QUA VIETQR & THẺ CÀO (USER) ----------------
function openDepositModal(mode = 'vietqr') {
  if (!currentUser) {
    showToast('Vui lòng đăng nhập để nạp tiền vào tài khoản!', 'warning');
    openAuthModal('login');
    return;
  }
  backToStep1();
  switchDepositMode(mode);
  openModal('depositModal');
}

function selectAmount(val) {
  document.getElementById('customAmount').value = val;
  document.querySelectorAll('.amt-btn').forEach(b => {
    b.classList.remove('border-cyan-500', 'bg-cyan-950/30', 'text-cyan-300');
    if (b.innerText.replace(/[^0-9]/g, '') === String(val)) {
      b.classList.add('border-cyan-500', 'bg-cyan-950/30', 'text-cyan-300');
    }
  });
}

function backToStep1() {
  stopDepositPolling();
  document.getElementById('depositStep1').classList.remove('hidden');
  document.getElementById('depositStep2').classList.add('hidden');
}

let depositPollingInterval = null;

function stopDepositPolling() {
  if (depositPollingInterval) {
    clearInterval(depositPollingInterval);
    depositPollingInterval = null;
  }
}

function startDepositStatusPolling(txId, amount) {
  stopDepositPolling();
  
  const box = document.getElementById('depositLiveStatusBox');
  const title = document.getElementById('depositStatusTitle');
  const desc = document.getElementById('depositStatusDesc');
  const actionBtns = document.getElementById('depositActionBtns');
  
  if (box) {
    box.className = 'bg-indigo-950/70 border border-cyan-500/30 rounded-xl p-3 text-xs text-indigo-200 flex items-start gap-2.5 text-left transition-all';
  }
  if (title) {
    title.innerHTML = `<span>Đang chờ chuyển tiền...</span> <span class="text-[10px] text-cyan-400 bg-cyan-500/10 px-1.5 py-0.2 rounded-full font-normal">Tự duyệt 24/7</span>`;
  }
  if (desc) {
    desc.innerText = 'Sau khi bạn quét mã VietQR và xác nhận chuyển khoản trên App Ngân Hàng/Ví, hệ thống sẽ tự động duyệt cộng tiền trong vài giây!';
  }
  if (actionBtns) {
    actionBtns.innerHTML = `
      <button type="button" onclick="checkManualDepositStatus()" class="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 text-white font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-1.5 text-xs">
        <i data-lucide="refresh-cw" class="w-4 h-4"></i> Kiểm Tra Trạng Thái Ngay
      </button>
      <button type="button" onclick="backToStep1()" class="text-xs text-slate-400 hover:text-white transition">
        ← Chọn lại số tiền khác
      </button>
    `;
    if (window.lucide) lucide.createIcons();
  }

  // Polling mỗi 2.5 giây
  depositPollingInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/wallet/deposit-status/${txId}`);
      if (!res.ok) return;
      const data = await res.json();
      
      if (data.success && data.status === 'COMPLETED') {
        stopDepositPolling();
        onDepositSuccessApproved(data.amount || amount);
      }
    } catch (e) {
      // Tiếp tục lắng nghe
    }
  }, 2500);
}

function onDepositSuccessApproved(amount) {
  const box = document.getElementById('depositLiveStatusBox');
  const title = document.getElementById('depositStatusTitle');
  const desc = document.getElementById('depositStatusDesc');
  const actionBtns = document.getElementById('depositActionBtns');

  if (box) {
    box.className = 'bg-emerald-950/80 border border-emerald-500/60 rounded-xl p-3 text-xs text-emerald-200 flex items-start gap-2.5 text-left shadow-lg shadow-emerald-500/15 animate-pulse';
  }
  if (title) {
    title.innerHTML = `🎉 <span class="text-emerald-400 font-extrabold text-sm">Nạp Tiền Thành Công!</span>`;
  }
  if (desc) {
    desc.innerHTML = `Hệ thống đã tự động duyệt nạp <strong class="text-white">+${Number(amount).toLocaleString('vi-VN')} VNĐ</strong> vào tài khoản <strong>${currentUser.username}</strong>!`;
  }
  if (actionBtns) {
    actionBtns.innerHTML = `
      <button type="button" onclick="closeModal('depositModal')" class="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 text-slate-950 font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-1.5 text-xs">
        <i data-lucide="check-circle" class="w-4 h-4"></i> Hoàn Tất & Tiếp Tục Mua Sắm
      </button>
    `;
    if (window.lucide) lucide.createIcons();
  }

  // Cập nhật số dư người dùng
  if (currentUser) {
    currentUser.balance = (Number(currentUser.balance) || 0) + Number(amount);
    localStorage.setItem('shophqk_user', JSON.stringify(currentUser));
    updateAuthUI();
  }

  showToast(`🎉 Nạp tiền thành công +${Number(amount).toLocaleString('vi-VN')} đ!`, 'success');
}

async function checkManualDepositStatus() {
  if (!currentTxId) return;
  showToast('Đang kiểm tra giao dịch với ngân hàng...', 'info');
  try {
    const res = await fetch(`/api/wallet/deposit-status/${currentTxId}`);
    const data = await res.json();
    if (data.success && data.status === 'COMPLETED') {
      stopDepositPolling();
      onDepositSuccessApproved(data.amount);
    } else {
      showToast('Hệ thống chưa nhận được tiền. Nếu vừa chuyển khoản, vui lòng đợi 5 - 10 giây để ngân hàng gửi thông báo!', 'warning');
    }
  } catch (err) {
    showToast('Lỗi khi kiểm tra trạng thái.', 'error');
  }
}

async function createVietQR() {
  const amtInput = document.getElementById('customAmount');
  const amount = Number(amtInput.value);

  if (!amount || amount < 10000) {
    showToast('Số tiền nạp tối thiểu là 10.000 VNĐ!', 'error');
    amtInput.focus();
    return;
  }

  try {
    const res = await fetch('/api/wallet/create-deposit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        amount: amount
      })
    });

    const data = await res.json();
    if (data.success) {
      currentTxId = data.data.id || data.data.txId || data.data.code;
      currentMemo = data.data.memo;

      document.getElementById('vietqrImage').src = data.data.qrUrl;
      document.getElementById('qrBankName').innerText = data.data.bankId;
      document.getElementById('qrAccountNo').innerText = data.data.accountNo;
      document.getElementById('qrAccountName').innerText = data.data.accountName;
      document.getElementById('qrAmountText').innerText = amount.toLocaleString('vi-VN') + ' VNĐ';
      document.getElementById('qrMemo').innerText = data.data.memo;

      document.getElementById('depositStep1').classList.add('hidden');
      document.getElementById('depositStep2').classList.remove('hidden');
      lucide.createIcons();

      // Bắt đầu lắng nghe tự động duyệt qua Webhook
      startDepositStatusPolling(currentTxId, amount);
    } else {
      showToast(data.message || 'Không thể tạo mã VietQR', 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối khi tạo mã VietQR', 'error');
  }
}

function copyMemo() {
  if (currentMemo) {
    navigator.clipboard.writeText(currentMemo);
    showToast('Đã sao chép nội dung chuyển khoản: ' + currentMemo, 'success');
  }
}

function copyAccountNo() {
  const accNo = document.getElementById('qrAccountNo')?.innerText?.trim() || '';
  if (accNo) {
    navigator.clipboard.writeText(accNo);
    showToast('Đã sao chép Số tài khoản: ' + accNo, 'success');
  }
}

function copyBankName() {
  const bankName = document.getElementById('qrBankName')?.innerText?.trim() || '';
  if (bankName) {
    navigator.clipboard.writeText(bankName);
    showToast('Đã sao chép Ngân hàng: ' + bankName, 'success');
  }
}

function copyAllTransferInfo() {
  const bank = document.getElementById('qrBankName')?.innerText?.trim() || '';
  const acc = document.getElementById('qrAccountNo')?.innerText?.trim() || '';
  const name = document.getElementById('qrAccountName')?.innerText?.trim() || '';
  const amount = document.getElementById('qrAmountText')?.innerText?.trim() || '';
  const memo = document.getElementById('qrMemo')?.innerText?.trim() || currentMemo || '';

  const fullText = `Ngân hàng: ${bank}\nSố tài khoản: ${acc}\nChủ tài khoản: ${name}\nSố tiền: ${amount}\nNội dung chuyển khoản: ${memo}`;
  navigator.clipboard.writeText(fullText);
  showToast('Đã sao chép toàn bộ thông tin chuyển khoản!', 'success');
}

function downloadQRCode() {
  const img = document.getElementById('vietqrImage');
  if (!img || !img.src) {
    showToast('Chưa có mã VietQR để tải về!', 'warning');
    return;
  }
  const a = document.createElement('a');
  a.href = img.src;
  a.download = `VietQR_ShopHQK_${currentMemo || 'NAP'}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('Đang tải mã VietQR về thiết bị...', 'success');
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPass = input.type === 'password';
  input.type = isPass ? 'text' : 'password';
  if (btn) {
    btn.innerHTML = isPass ? '<i data-lucide="eye-off" class="w-4 h-4"></i>' : '<i data-lucide="eye" class="w-4 h-4"></i>';
    lucide.createIcons();
  }
}

function copyWebhookUrl() {
  const input = document.getElementById('webhookUrlInput');
  if (input) {
    navigator.clipboard.writeText(input.value);
    showToast('Đã sao chép link Webhook: ' + input.value, 'success');
  }
}

async function testSimulateWebhook() {
  const content = (document.getElementById('simContent')?.value || '').trim();
  const amount = Number(document.getElementById('simAmount')?.value || 50000);

  if (!content) {
    showToast('Vui lòng nhập mã nạp hoặc nội dung chuyển khoản cần test!', 'warning');
    return;
  }

  showToast('Đang gửi dữ liệu giả lập tới Webhook...', 'info');
  try {
    const res = await fetch('/api/admin/simulate-webhook', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Admin-Username': getAdminUsername()
      },
      body: JSON.stringify({
        adminUsername: getAdminUsername(),
        content: content,
        amount: amount
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      loadAdminDeposits();
    } else {
      showToast(data.message, 'error');
    }
  } catch (err) {
    showToast('Lỗi khi test Webhook: ' + err.message, 'error');
  }
}

function handleFinishDeposit() {
  stopDepositPolling();
  stopCardPolling();
  closeModal('depositModal');
  showToast('Đã ghi nhận yêu cầu nạp tiền! Hệ thống đang tự động duyệt tiền.', 'info');
}

// ========================================================
// HỆ THỐNG GẠCH THẺ CÀO (GACHTHEFAST.COM) CLIENT LOGIC
// ========================================================

let currentDepositMode = 'vietqr'; // 'vietqr' or 'card'
let selectedCardTelco = 'VIETTEL';
let cardPollingInterval = null;
let currentCardTxId = null;

function switchDepositMode(mode) {
  currentDepositMode = mode;
  const tabVqr = document.getElementById('depTabVietQR');
  const tabCard = document.getElementById('depTabCard');
  const boxVqr = document.getElementById('vietqrDepositBox');
  const boxCard = document.getElementById('cardDepositBox');

  if (mode === 'vietqr') {
    if (tabVqr) {
      tabVqr.className = 'flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 bg-gradient-to-r from-cyan-600 to-indigo-600 text-white shadow';
    }
    if (tabCard) {
      tabCard.className = 'flex-1 py-1.5 px-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800/60 transition flex items-center justify-center gap-1.5';
    }
    if (boxVqr) boxVqr.classList.remove('hidden');
    if (boxCard) boxCard.classList.add('hidden');
  } else {
    if (tabVqr) {
      tabVqr.className = 'flex-1 py-1.5 px-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800/60 transition flex items-center justify-center gap-1.5';
    }
    if (tabCard) {
      tabCard.className = 'flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow';
    }
    if (boxVqr) boxVqr.classList.add('hidden');
    if (boxCard) boxCard.classList.remove('hidden');
    updateCardReceiveAmount();
    loadUserCardHistory();
  }

  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
}

function selectCardTelco(telco) {
  selectedCardTelco = telco;
  const inp = document.getElementById('cardTelcoInput');
  if (inp) inp.value = telco;

  const buttons = document.querySelectorAll('.card-telco-btn');
  buttons.forEach(btn => {
    const text = btn.innerText.trim().toUpperCase();
    if (text === telco || 
        (telco === 'VINAPHONE' && text.includes('VINA')) ||
        (telco === 'MOBIFONE' && text.includes('MOBI')) ||
        (telco === 'VIETNAMOBILE' && text.includes('VNM'))) {
      btn.className = 'card-telco-btn active px-2 py-1.5 rounded-xl bg-slate-950 border border-amber-500 text-amber-400 text-xs font-bold transition text-center shadow-sm';
    } else {
      btn.className = 'card-telco-btn px-2 py-1.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-amber-500 text-slate-300 text-xs font-semibold transition text-center';
    }
  });
}

function updateCardReceiveAmount() {
  const amtSelect = document.getElementById('cardAmountSelect');
  const amount = Number(amtSelect?.value || 100000);
  const rate = Number(currentSettings.cardDiscountRate !== undefined ? currentSettings.cardDiscountRate : 85);
  const receive = Math.round(amount * (rate / 100));

  const disp = document.getElementById('cardReceiveAmountDisplay');
  if (disp) {
    disp.innerText = `${receive.toLocaleString('vi-VN')} VNĐ`;
  }
}

function stopCardPolling() {
  if (cardPollingInterval) {
    clearInterval(cardPollingInterval);
    cardPollingInterval = null;
  }
}

async function handleCardDepositSubmit(e) {
  e.preventDefault();
  if (!currentUser) {
    showToast('Vui lòng đăng nhập để nạp thẻ cào!', 'warning');
    openAuthModal('login');
    return;
  }

  const telco = selectedCardTelco || document.getElementById('cardTelcoInput')?.value || 'VIETTEL';
  const amount = Number(document.getElementById('cardAmountSelect')?.value || 0);
  const serial = (document.getElementById('cardSerialInput')?.value || '').trim();
  const code = (document.getElementById('cardCodeInput')?.value || '').trim();

  if (!serial || !code) {
    showToast('Vui lòng nhập đầy đủ Số Serial và Mã Thẻ!', 'warning');
    return;
  }

  const btn = document.getElementById('submitCardBtn');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Đang gửi thẻ lên GachTheFast...';
  if (window.lucide) lucide.createIcons();

  try {
    const res = await fetch('/api/card/deposit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        telco: telco,
        amount: amount,
        serial: serial,
        code: code
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      document.getElementById('cardCodeInput').value = '';
      currentCardTxId = data.data.txId;
      startCardStatusPolling(currentCardTxId, data.data.estimatedReceive);
      loadUserCardHistory();
    } else {
      showToast(data.message || 'Lỗi gửi thẻ cào', 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối khi nạp thẻ cào: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
    if (window.lucide) lucide.createIcons();
  }
}

function startCardStatusPolling(txId, expectedAmount) {
  stopCardPolling();
  const box = document.getElementById('cardLiveStatusBox');
  const title = document.getElementById('cardStatusTitle');
  const desc = document.getElementById('cardStatusDesc');
  const ping = document.getElementById('cardStatusPing');
  const dot = document.getElementById('cardStatusDot');

  if (box) box.classList.remove('hidden');
  if (title) title.innerText = 'Đang kiểm tra thẻ trên GachTheFast.Com...';
  if (desc) desc.innerText = 'Hệ thống đang kết nối nhà mạng để gạch thẻ tự động. Vui lòng chờ 5 - 30 giây.';
  if (ping) ping.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75';
  if (dot) dot.className = 'relative inline-flex rounded-full h-3 w-3 bg-amber-500';

  let pollCount = 0;
  cardPollingInterval = setInterval(async () => {
    pollCount++;
    try {
      const res = await fetch(`/api/card/deposit-status/${txId}`);
      if (!res.ok) return;
      const data = await res.json();

      if (data.success && data.status === 'COMPLETED') {
        stopCardPolling();
        const credited = data.receiveAmount || expectedAmount;
        if (title) title.innerHTML = `<span class="text-emerald-400 flex items-center gap-1.5"><i data-lucide="check-circle" class="w-4 h-4"></i> Nạp thẻ thành công!</span>`;
        if (desc) desc.innerHTML = `<span class="text-emerald-300 font-bold">+${credited.toLocaleString('vi-VN')} đ</span> đã được cộng tự động vào ví của bạn!`;
        if (ping) ping.className = 'hidden';
        if (dot) dot.className = 'relative inline-flex rounded-full h-3 w-3 bg-emerald-500';

        if (currentUser) {
          currentUser.balance = (Number(currentUser.balance) || 0) + credited;
          localStorage.setItem('shophqk_user', JSON.stringify(currentUser));
          updateAuthUI();
        }

        showToast(`🎉 Nạp thẻ thành công! Bạn vừa được cộng +${credited.toLocaleString('vi-VN')} VNĐ vào ví!`, 'success');
        loadUserCardHistory();
        if (window.lucide) lucide.createIcons();
      } else if (data.success && data.status === 'FAILED') {
        stopCardPolling();
        if (title) title.innerHTML = `<span class="text-rose-400 flex items-center gap-1.5"><i data-lucide="alert-triangle" class="w-4 h-4"></i> Nạp thẻ thất bại</span>`;
        if (desc) desc.innerText = data.note || 'Thẻ không hợp lệ, sai seri/mã thẻ hoặc đã được nạp trước đó.';
        if (ping) ping.className = 'hidden';
        if (dot) dot.className = 'relative inline-flex rounded-full h-3 w-3 bg-rose-500';
        showToast('Nạp thẻ không thành công: ' + (data.note || 'Thẻ sai hoặc đã nạp'), 'error');
        loadUserCardHistory();
        if (window.lucide) lucide.createIcons();
      } else if (data.success && data.status === 'WRONG_AMOUNT') {
        stopCardPolling();
        if (title) title.innerHTML = `<span class="text-amber-400 flex items-center gap-1.5"><i data-lucide="alert-circle" class="w-4 h-4"></i> Thẻ sai mệnh giá</span>`;
        if (desc) desc.innerText = data.note || 'Thẻ đã được duyệt với mệnh giá thực tế từ nhà mạng.';
        if (ping) ping.className = 'hidden';
        if (dot) dot.className = 'relative inline-flex rounded-full h-3 w-3 bg-amber-500';
        showToast('Thẻ sai mệnh giá! ' + (data.note || ''), 'warning');
        loadUserCardHistory();
        if (window.lucide) lucide.createIcons();
      }

      if (pollCount > 60) {
        stopCardPolling();
        if (title) title.innerText = 'Thẻ đang được nhà mạng xử lý';
        if (desc) desc.innerText = 'Giao dịch mất nhiều thời gian hơn bình thường. Khi nhà mạng gạch xong, tiền sẽ tự động cộng vào ví.';
      }
    } catch (err) {
      console.warn('Lỗi kiểm tra thẻ:', err);
    }
  }, 2500);
}

function refreshCardStatus() {
  if (currentCardTxId) {
    showToast('Đang kiểm tra lại trạng thái thẻ...', 'info');
    fetch(`/api/card/deposit-status/${currentCardTxId}`)
      .then(res => res.json())
      .then(data => {
        if (data.status === 'COMPLETED') {
          showToast('Thẻ đã duyệt thành công!', 'success');
        } else if (data.status === 'PENDING') {
          showToast('Thẻ vẫn đang chờ nhà mạng duyệt tự động...', 'info');
        } else {
          showToast(`Trạng thái thẻ: ${data.status} - ${data.note || ''}`, 'warning');
        }
      });
  }
}

async function loadUserCardHistory() {
  if (!currentUser) return;
  const list = document.getElementById('userCardHistoryList');
  if (!list) return;

  try {
    const res = await fetch(`/api/card/history/${currentUser.username}`);
    const data = await res.json();
    if (!data.success || !Array.isArray(data.data) || data.data.length === 0) {
      list.innerHTML = `<div class="text-center py-2 text-slate-500 text-[11px]">Chưa có yêu cầu nạp thẻ nào.</div>`;
      return;
    }

    list.innerHTML = data.data.slice(0, 5).map(tx => {
      let statusBadge = '<span class="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded font-bold">Chờ duyệt</span>';
      if (tx.status === 'COMPLETED') {
        statusBadge = '<span class="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded font-bold">Thành công</span>';
      } else if (tx.status === 'FAILED') {
        statusBadge = '<span class="text-[10px] text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded font-bold">Thất bại</span>';
      } else if (tx.status === 'WRONG_AMOUNT') {
        statusBadge = '<span class="text-[10px] text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded font-bold">Sai MG</span>';
      }

      const time = new Date(tx.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

      return `
        <div class="bg-slate-900 border border-slate-800 rounded-lg p-2 flex items-center justify-between text-xs">
          <div>
            <div class="font-bold text-slate-200 flex items-center gap-1.5">
              <span>${tx.telco}</span>
              <span class="text-amber-400">${Number(tx.amount).toLocaleString('vi-VN')} đ</span>
            </div>
            <div class="text-[10px] text-slate-500 font-mono">Seri: ${tx.serial} | ${time}</div>
          </div>
          <div class="text-right">
            ${statusBadge}
            <div class="text-[10px] text-emerald-400 font-bold mt-0.5">+${Number(tx.receiveAmount || 0).toLocaleString('vi-VN')} đ</div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Lỗi tải lịch sử thẻ:', err);
  }
}

// ---------------- ADMIN: QUẢN LÝ THẺ CÀO & CẤU HÌNH GACHTHEFAST ----------------
let adminCardsCache = [];

async function loadAdminCards() {
  const table = document.getElementById('adminCardsTable');
  const badge = document.getElementById('cardPendingBadge');
  if (!table) return;

  table.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-slate-500 text-xs">Đang tải danh sách thẻ cào...</td></tr>`;

  try {
    const res = await fetch('/api/admin/cards');
    const data = await res.json();
    if (!data.success) {
      table.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-rose-400 text-xs">${data.message || 'Lỗi tải danh sách thẻ'}</td></tr>`;
      return;
    }

    adminCardsCache = data.data || [];
    const pendingCount = adminCardsCache.filter(c => c.status === 'PENDING').length;
    if (badge) {
      if (pendingCount > 0) {
        badge.innerText = pendingCount;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    renderAdminCardsTable(adminCardsCache);
  } catch (err) {
    table.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-rose-400 text-xs">Lỗi kết nối khi tải danh sách thẻ!</td></tr>`;
  }
}

function renderAdminCardsTable(cards) {
  const table = document.getElementById('adminCardsTable');
  if (!table) return;

  if (cards.length === 0) {
    table.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-500 text-xs">Chưa có thẻ cào nào được gửi lên hệ thống.</td></tr>`;
    return;
  }

  table.innerHTML = cards.map(tx => {
    let statusBadge = `<span class="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">Chờ duyệt</span>`;
    if (tx.status === 'COMPLETED') {
      statusBadge = `<span class="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">Thành công</span>`;
    } else if (tx.status === 'FAILED') {
      statusBadge = `<span class="text-[10px] font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20" title="${tx.note || ''}">Thất bại</span>`;
    } else if (tx.status === 'WRONG_AMOUNT') {
      statusBadge = `<span class="text-[10px] font-bold text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20" title="${tx.note || ''}">Sai mệnh giá</span>`;
    }

    const time = new Date(tx.createdAt).toLocaleString('vi-VN');
    const isPending = tx.status === 'PENDING';

    return `
      <tr class="hover:bg-slate-900/40 transition">
        <td class="p-2.5">
          <div class="font-bold text-slate-200 text-xs">${time}</div>
          <div class="text-[10px] text-cyan-400 font-mono">${tx.code || tx.id}</div>
        </td>
        <td class="p-2.5 font-bold text-indigo-400 text-xs">${tx.username}</td>
        <td class="p-2.5">
          <span class="font-bold text-white text-xs">${tx.telco}</span>
          <div class="text-[11px] text-amber-400 font-semibold">${Number(tx.amount).toLocaleString('vi-VN')} đ</div>
        </td>
        <td class="p-2.5 font-mono text-[11px]">
          <div class="text-slate-300">S: ${tx.serial}</div>
          <div class="text-slate-500 text-[10px]">P: ${tx.rawCode || tx.cardPinMasked || '***'}</div>
        </td>
        <td class="p-2.5 text-right font-bold text-emerald-400 text-xs">
          +${Number(tx.receiveAmount || Math.round(Number(tx.amount) * 0.85)).toLocaleString('vi-VN')} đ
        </td>
        <td class="p-2.5 text-center">${statusBadge}</td>
        <td class="p-2.5 text-center">
          ${isPending ? `
            <div class="flex items-center justify-center gap-1">
              <button onclick="adminApproveCard('${tx.id}')" title="Duyệt tay" class="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-bold transition flex items-center gap-1">
                <i data-lucide="check" class="w-3 h-3"></i> Duyệt
              </button>
              <button onclick="adminRejectCard('${tx.id}')" title="Từ chối" class="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold transition flex items-center gap-1">
                <i data-lucide="x" class="w-3 h-3"></i> Hủy
              </button>
            </div>
          ` : `
            <span class="text-[10px] text-slate-500">${tx.approvedBy || 'Đã xử lý'}</span>
          `}
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function filterAdminCards() {
  const query = (document.getElementById('adminCardSearch')?.value || '').trim().toLowerCase();
  if (!query) {
    renderAdminCardsTable(adminCardsCache);
    return;
  }
  const filtered = adminCardsCache.filter(tx => 
    (tx.username && tx.username.toLowerCase().includes(query)) ||
    (tx.serial && tx.serial.toLowerCase().includes(query)) ||
    (tx.telco && tx.telco.toLowerCase().includes(query)) ||
    (tx.code && tx.code.toLowerCase().includes(query))
  );
  renderAdminCardsTable(filtered);
}

async function adminApproveCard(txId) {
  const card = adminCardsCache.find(c => c.id === txId || c.code === txId);
  const defaultAmt = card ? (card.receiveAmount || Math.round(card.amount * 0.85)) : 0;
  const input = prompt(`Xác nhận duyệt thẻ cho ${card?.username}?\nNhập số tiền muốn cộng vào ví (VNĐ):`, defaultAmt);
  if (input === null) return;
  const numAmt = Number(input);
  if (!numAmt || numAmt <= 0) {
    showToast('Số tiền không hợp lệ!', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/admin/approve-card', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Admin-Username': getAdminUsername()
      },
      body: JSON.stringify({
        adminUsername: getAdminUsername(),
        txId: txId,
        amount: numAmt
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      loadAdminCards();
    } else {
      showToast(data.message || 'Lỗi khi duyệt thẻ', 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối khi duyệt thẻ: ' + err.message, 'error');
  }
}

async function adminRejectCard(txId) {
  const reason = prompt('Nhập lý do từ chối đơn thẻ này:', 'Thẻ sai mã, sai serial hoặc đã nạp trước đó');
  if (reason === null) return;

  try {
    const res = await fetch('/api/admin/reject-card', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Admin-Username': getAdminUsername()
      },
      body: JSON.stringify({
        adminUsername: getAdminUsername(),
        txId: txId,
        reason: reason
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      loadAdminCards();
    } else {
      showToast(data.message || 'Lỗi khi từ chối thẻ', 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối: ' + err.message, 'error');
  }
}

async function handleSaveCardSettings(e) {
  e.preventDefault();
  const cardAuto = document.getElementById('admCfgCardAutoEnabled')?.checked;
  const partnerId = (document.getElementById('admCfgGtfPartnerId')?.value || '').trim();
  const partnerKey = (document.getElementById('admCfgGtfPartnerKey')?.value || '').trim();
  const discountRate = Number(document.getElementById('admCfgCardDiscountRate')?.value || 85);
  const cardCallbackSecret = (document.getElementById('admCfgCardCallbackSecret')?.value || '').trim();

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Admin-Username': getAdminUsername()
      },
      body: JSON.stringify({
        adminUsername: getAdminUsername(),
        cardAutoEnabled: cardAuto,
        gachthefastPartnerId: partnerId,
        gachthefastPartnerKey: partnerKey,
        cardDiscountRate: discountRate,
        cardCallbackSecret: cardCallbackSecret
      })
    });

    const data = await res.json();
    if (data.success) {
      currentSettings = { ...currentSettings, ...data.data };
      showToast('Đã lưu cấu hình cổng GachTheFast.Com thành công!', 'success');
    } else {
      showToast(data.message || 'Lỗi lưu cấu hình', 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối: ' + err.message, 'error');
  }
}

function copyCardWebhookUrl() {
  const input = document.getElementById('cardWebhookUrlInput');
  if (input) {
    navigator.clipboard.writeText(input.value);
    showToast('Đã sao chép link Callback URL: ' + input.value, 'success');
  }
}

async function testSimulateCardCallback() {
  const requestId = (document.getElementById('simCardRequestId')?.value || '').trim();
  const status = Number(document.getElementById('simCardStatus')?.value || 1);

  if (!requestId) {
    showToast('Vui lòng nhập mã đơn thẻ cần test (VD: CARD_...)!', 'warning');
    return;
  }

  showToast('Đang gửi dữ liệu giả lập callback gạch thẻ...', 'info');
  try {
    const res = await fetch('/api/admin/simulate-card-callback', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Admin-Username': getAdminUsername()
      },
      body: JSON.stringify({
        adminUsername: getAdminUsername(),
        requestId: requestId,
        status: status
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      loadAdminCards();
    } else {
      showToast(data.message, 'error');
    }
  } catch (err) {
    showToast('Lỗi test giả lập: ' + err.message, 'error');
  }
}

// ---------------- LỊCH SỬ GIAO DỊCH ----------------
let userTransactionsCache = [];
let currentHistoryFilter = 'all';

async function openHistoryModal() {
  if (!currentUser) {
    showToast('Vui lòng đăng nhập để xem lịch sử giao dịch!', 'warning');
    openAuthModal('login');
    return;
  }

  const list = document.getElementById('historyList');
  list.innerHTML = `<div class="text-center py-6 text-slate-500 text-xs">Đang tải lịch sử...</div>`;
  currentHistoryFilter = 'all';
  updateHistoryTabButtons();
  openModal('historyModal');

  try {
    const res = await fetch(`/api/transactions/${currentUser.username}`);
    const data = await res.json();

    if (!data.success || !Array.isArray(data.data) || data.data.length === 0) {
      userTransactionsCache = [];
      list.innerHTML = `<div class="text-center py-8 text-slate-500 text-xs">Bạn chưa có giao dịch nào trên hệ thống.</div>`;
      return;
    }

    userTransactionsCache = data.data;
    renderFilteredHistory();
  } catch (err) {
    list.innerHTML = `<div class="text-center py-6 text-rose-400 text-xs">Lỗi kết nối khi tải lịch sử giao dịch!</div>`;
  }
}

function filterHistoryTab(filter) {
  currentHistoryFilter = filter;
  updateHistoryTabButtons();
  renderFilteredHistory();
}

function updateHistoryTabButtons() {
  const tabs = [
    { id: 'histFilterAll', val: 'all' },
    { id: 'histFilterDeposit', val: 'deposit' },
    { id: 'histFilterOrder', val: 'order' }
  ];

  tabs.forEach(t => {
    const btn = document.getElementById(t.id);
    if (!btn) return;
    if (t.val === currentHistoryFilter) {
      btn.className = 'px-3 py-1 rounded-lg text-xs font-bold bg-amber-500 text-slate-950 transition active:scale-95 shadow-sm';
    } else {
      btn.className = 'px-3 py-1 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:text-white transition active:scale-95';
    }
  });
}

function renderFilteredHistory() {
  const list = document.getElementById('historyList');
  if (!list) return;

  const filtered = userTransactionsCache.filter(tx => {
    const isDeposit = tx.type.includes('DEPOSIT') || tx.type === 'ADMIN_DEPOSIT' || tx.type === 'CARD_DEPOSIT';
    if (currentHistoryFilter === 'deposit') return isDeposit;
    if (currentHistoryFilter === 'order') return !isDeposit;
    return true;
  });

  if (filtered.length === 0) {
    list.innerHTML = `<div class="text-center py-8 text-slate-500 text-xs">Không có giao dịch nào trong mục này.</div>`;
    return;
  }

  list.innerHTML = filtered.map(tx => {
    const isDeposit = tx.type.includes('DEPOSIT') || tx.type === 'ADMIN_DEPOSIT' || tx.type === 'CARD_DEPOSIT';
    const time = new Date(tx.createdAt).toLocaleString('vi-VN');

    return `
      <div class="bg-slate-950 border border-slate-800 hover:border-slate-700/80 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs transition">
        <div class="flex items-start gap-2.5 flex-1">
          <div class="w-8 h-8 rounded-lg ${isDeposit ? 'bg-cyan-500/10 text-cyan-400' : 'bg-indigo-500/10 text-indigo-400'} flex items-center justify-center shrink-0 mt-0.5">
            <i data-lucide="${isDeposit ? 'arrow-down-left' : 'shopping-bag'}" class="w-4 h-4"></i>
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-bold text-white text-xs leading-snug">${isDeposit ? `Nạp tiền ${tx.code ? `(${tx.code})` : ''}` : `Mua hàng: ${tx.productName || 'Sản phẩm'}`}</p>
            <p class="text-[10px] text-slate-500 mt-0.5">${time} ${tx.memo ? `• ${tx.memo}` : ''}</p>
            ${tx.deliveredItems && Array.isArray(tx.deliveredItems) && tx.deliveredItems.length > 0 ? `
              <div class="mt-2 p-2 bg-slate-900 border border-cyan-500/40 rounded-lg text-[11px] font-mono text-cyan-300">
                <div class="text-[10px] text-slate-400 font-sans font-bold flex items-center justify-between mb-1">
                  <span>🔑 Acc / Key đã cấp:</span>
                  <button type="button" onclick="navigator.clipboard.writeText('${tx.deliveredItems.join('\\n').replace(/'/g, "\\'")}'); showToast('Đã sao chép acc/key!', 'success')" class="text-[9px] bg-slate-800 hover:bg-slate-700 px-2 py-0.5 rounded text-slate-200 active:scale-95">
                    Sao chép
                  </button>
                </div>
                <div class="select-all whitespace-pre-wrap">${tx.deliveredItems.join('\n')}</div>
              </div>
            ` : ''}
            ${tx.downloadUrl ? `
              <div class="mt-2 flex items-center gap-1.5 flex-wrap">
                <a href="${tx.downloadUrl}" target="_blank" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-600/80 hover:bg-cyan-500 text-white text-[10px] font-bold shadow-sm transition active:scale-95">
                  <i data-lucide="download" class="w-3 h-3"></i> Tải Sản Phẩm Ngay
                </a>
                <button type="button" onclick="navigator.clipboard.writeText('${tx.downloadUrl}'); showToast('Đã sao chép link tải!', 'success')" class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold transition active:scale-95">
                  <i data-lucide="copy" class="w-3 h-3"></i> Chép Link
                </button>
              </div>
            ` : ''}
          </div>
        </div>
        <div class="flex items-center sm:flex-col justify-between sm:items-end shrink-0 pt-2 sm:pt-0 border-t border-slate-900 sm:border-0">
          <span class="font-extrabold text-sm ${isDeposit ? 'text-emerald-400' : 'text-slate-300'} block">
            ${isDeposit ? '+' : '-'}${Number(isDeposit ? tx.amount : tx.totalCost).toLocaleString('vi-VN')} đ
          </span>
          <span class="text-[10px] px-2 py-0.5 rounded-full font-bold ${tx.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}">
            ${tx.status === 'COMPLETED' ? 'Thành công' : 'Chờ duyệt'}
          </span>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

// ---------------- 1. NHẬT KÝ BẢO MẬT (AUDIT LOGS) ----------------
async function loadAdminAuditLogs() {
  const table = document.getElementById('adminAuditTable');
  if (!table) return;
  table.innerHTML = `<tr><td colspan="6" class="p-3 text-center text-slate-500">Đang tải nhật ký bảo mật...</td></tr>`;

  try {
    const res = await fetch('/api/admin/audit-logs');
    const data = await res.json();
    if (!data.success || !Array.isArray(data.data) || data.data.length === 0) {
      table.innerHTML = `<tr><td colspan="6" class="p-3 text-center text-slate-500">Chưa có nhật ký bảo mật nào được ghi nhận.</td></tr>`;
      return;
    }

    const actionColors = {
      LOGIN_SUCCESS: 'bg-emerald-500/20 text-emerald-300',
      LOGIN_FAILED: 'bg-rose-500/20 text-rose-300',
      PURCHASE: 'bg-indigo-500/20 text-indigo-300',
      AUTO_DEPOSIT: 'bg-cyan-500/20 text-cyan-300',
      ADMIN_DEPOSIT: 'bg-emerald-500/20 text-emerald-300',
      ADMIN_DEDUCT: 'bg-amber-500/20 text-amber-300',
      ADMIN_RESET: 'bg-rose-500/20 text-rose-300',
      BAN_USER: 'bg-rose-500/20 text-rose-300',
      UNBAN_USER: 'bg-emerald-500/20 text-emerald-300',
      CREATE_BACKUP: 'bg-cyan-500/20 text-cyan-300',
      RESTORE_BACKUP: 'bg-rose-500/20 text-rose-300'
    };

    table.innerHTML = data.data.map(log => {
      const time = new Date(log.timestamp).toLocaleString('vi-VN');
      const badgeClass = actionColors[log.action] || 'bg-slate-800 text-slate-300';

      return `
        <tr class="hover:bg-slate-800/40 transition">
          <td class="p-2 text-[11px] text-slate-400 font-mono whitespace-nowrap">${time}</td>
          <td class="p-2">
            <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${badgeClass}">${log.action}</span>
          </td>
          <td class="p-2 font-bold text-white text-[11px] font-mono">${log.actor || '-'}</td>
          <td class="p-2 text-indigo-300 text-[11px] font-mono">${log.target || '-'}</td>
          <td class="p-2 text-slate-400 text-[10px] font-mono">${log.ip || '-'}</td>
          <td class="p-2 text-slate-300 text-xs">${log.details || '-'}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    table.innerHTML = `<tr><td colspan="6" class="p-3 text-center text-rose-400">Lỗi khi tải nhật ký bảo mật</td></tr>`;
  }
}

// ---------------- 2. SAO LƯU SERVER (BACKUP & RESTORE) ----------------
async function loadAdminBackups() {
  const table = document.getElementById('adminBackupsTable');
  if (!table) return;
  table.innerHTML = `<tr><td colspan="4" class="p-3 text-center text-slate-500">Đang tải danh sách bản sao lưu...</td></tr>`;

  try {
    const res = await fetch('/api/admin/backups');
    const data = await res.json();
    if (!data.success || !Array.isArray(data.data) || data.data.length === 0) {
      table.innerHTML = `<tr><td colspan="4" class="p-3 text-center text-slate-500">Chưa có bản sao lưu nào. Hãy bấm "Tạo Bản Sao Lưu Ngay"!</td></tr>`;
      return;
    }

    table.innerHTML = data.data.map(b => {
      const time = new Date(b.createdAt).toLocaleString('vi-VN');
      return `
        <tr class="hover:bg-slate-800/40 transition">
          <td class="p-2.5 font-mono text-cyan-300 font-bold text-xs flex items-center gap-1.5">
            <i data-lucide="file-json" class="w-4 h-4 text-amber-400 shrink-0"></i>
            <span>${b.fileName}</span>
          </td>
          <td class="p-2.5 text-slate-400 text-xs">${b.sizeKB} KB</td>
          <td class="p-2.5 text-slate-400 text-[11px] font-mono whitespace-nowrap">${time}</td>
          <td class="p-2.5 text-right space-x-1.5 whitespace-nowrap">
            <a href="/api/admin/backups/download/${encodeURIComponent(b.fileName)}" target="_blank" class="inline-flex items-center gap-1 px-2.5 py-1 bg-cyan-600/80 hover:bg-cyan-500 text-white rounded-lg text-[11px] font-bold shadow-sm transition">
              <i data-lucide="download" class="w-3 h-3"></i> Tải về máy
            </a>
            <button type="button" onclick="triggerRestoreBackup('${b.fileName}')" class="px-2.5 py-1 bg-rose-600/80 hover:bg-rose-600 text-white rounded-lg text-[11px] font-bold transition">
              <i data-lucide="rotate-ccw" class="w-3 h-3 inline"></i> Khôi phục
            </button>
          </td>
        </tr>
      `;
    }).join('');
    lucide.createIcons();
  } catch (err) {
    table.innerHTML = `<tr><td colspan="4" class="p-3 text-center text-rose-400">Lỗi khi tải danh sách sao lưu</td></tr>`;
  }
}

async function triggerCreateBackup() {
  showToast('Đang tạo bản sao lưu toàn bộ dữ liệu server...', 'info');
  try {
    const res = await fetch('/api/admin/backups/create', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      loadAdminBackups();
    } else {
      showToast(data.message || 'Lỗi khi tạo sao lưu', 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối máy chủ: ' + err.message, 'error');
  }
}

async function triggerRestoreBackup(fileName) {
  const ok = confirm(`CẢNH BÁO NGUY HIỂM:\nBạn có chắc chắn muốn khôi phục toàn bộ hệ thống từ file [${fileName}]?\nDữ liệu hiện tại sẽ được ghi đè về trạng thái lúc sao lưu!`);
  if (!ok) return;

  let adminPin = '';
  if (currentSettings.hasSecurityPin) {
    adminPin = prompt('Nhập Mã PIN Bảo Vệ Quản Trị Cấp 2:');
    if (adminPin === null) return;
  }

  showToast('Đang khôi phục dữ liệu từ bản sao lưu...', 'info');
  try {
    const res = await fetch('/api/admin/backups/restore', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-pin': adminPin
      },
      body: JSON.stringify({ fileName, adminPin })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      loadProducts();
      loadShopSettings();
      loadAdminUsers();
      loadAdminBackups();
    } else {
      showToast(data.message || 'Lỗi khôi phục sao lưu', 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối: ' + err.message, 'error');
  }
}

// ---------------- 3. LOGS WEBHOOK NHẬN TIỀN (WEBHOOK INSPECTOR) ----------------
async function loadAdminWebhookLogs() {
  const table = document.getElementById('adminWebhookTable');
  if (!table) return;
  table.innerHTML = `<tr><td colspan="6" class="p-3 text-center text-slate-500">Đang tải lịch sử webhook...</td></tr>`;

  try {
    const res = await fetch('/api/admin/webhook-logs');
    const data = await res.json();
    if (!data.success || !Array.isArray(data.data) || data.data.length === 0) {
      table.innerHTML = `<tr><td colspan="6" class="p-3 text-center text-slate-500">Chưa có request webhook nào đến.</td></tr>`;
      return;
    }

    table.innerHTML = data.data.map(w => {
      const time = new Date(w.timestamp).toLocaleString('vi-VN');
      const isSuccess = w.result === 'SUCCESS';

      return `
        <tr class="hover:bg-slate-800/40 transition">
          <td class="p-2 text-[11px] text-slate-400 font-mono whitespace-nowrap">${time}</td>
          <td class="p-2 font-bold text-amber-400 text-xs font-mono">${w.gateway}</td>
          <td class="p-2 text-right font-extrabold text-emerald-400 text-xs whitespace-nowrap">${Number(w.amount || 0).toLocaleString('vi-VN')} đ</td>
          <td class="p-2 text-slate-300 text-xs max-w-xs truncate" title="${w.content}">${w.content || '-'}</td>
          <td class="p-2">
            <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${isSuccess ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}">
              ${w.result}
            </span>
          </td>
          <td class="p-2 text-slate-400 text-[10px] font-mono">${w.ip}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    table.innerHTML = `<tr><td colspan="6" class="p-3 text-center text-rose-400">Lỗi khi tải logs webhook</td></tr>`;
  }
}

// Khóa / Mở khóa tài khoản (Admin)
async function adminToggleBan(username, isBanned) {
  let reason = '';
  if (isBanned) {
    reason = prompt(`Xác nhận KHÓA tài khoản [${username}]?\nNhập lý do khóa:`, 'Vi phạm quy định của Shop');
    if (reason === null) return;
  } else {
    if (!confirm(`Xác nhận MỞ KHÓA tài khoản [${username}]?`)) return;
  }

  let adminPin = '';
  if (currentSettings.hasSecurityPin) {
    adminPin = prompt('Nhập Mã PIN Bảo Vệ Quản Trị Cấp 2:');
    if (adminPin === null) return;
  }

  try {
    const res = await fetch('/api/admin/toggle-ban', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-pin': adminPin
      },
      body: JSON.stringify({ targetUsername: username, isBanned, reason, adminPin })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      loadAdminUsers();
    } else {
      showToast(data.message || 'Lỗi khi cập nhật trạng thái', 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối máy chủ', 'error');
  }
}

// ---------------- 5. KHÔI PHỤC DỮ LIỆU TỪ FILE MÁY TÍNH (.JSON) ----------------
async function handleUploadRestoreBackup() {
  const fileInput = document.getElementById('admBackupFileInput');
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    showToast('Vui lòng chọn một file sao lưu (.json) từ máy tính!', 'error');
    return;
  }

  const file = fileInput.files[0];
  if (!file.name.endsWith('.json')) {
    showToast('Chỉ chấp nhận file định dạng .json!', 'error');
    return;
  }

  const ok = confirm(`CẢNH BÁO NGUY HIỂM:\nBạn có chắc chắn muốn khôi phục toàn bộ hệ thống từ file [${file.name}]?\nToàn bộ dữ liệu hiện tại trên web sẽ được khôi phục về trạng thái của bản sao lưu này!`);
  if (!ok) return;

  let adminPin = '';
  if (currentSettings.hasSecurityPin) {
    adminPin = prompt('Nhập Mã PIN Bảo Vệ Quản Trị Cấp 2:');
    if (adminPin === null) return;
  }

  try {
    const text = await file.text();
    const snapshotData = JSON.parse(text);

    if (!snapshotData || !snapshotData.data) {
      showToast('Nội dung file sao lưu không hợp lệ hoặc bị lỗi!', 'error');
      return;
    }

    showToast('Đang nạp và khôi phục toàn bộ dữ liệu shop lên máy chủ...', 'info');

    const res = await fetch('/api/admin/backups/upload-restore', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-pin': adminPin
      },
      body: JSON.stringify({ snapshotData, adminPin })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      loadProducts();
      loadShopSettings();
      loadAdminUsers();
      loadAdminBackups();
      fileInput.value = '';
    } else {
      showToast(data.message || 'Lỗi khôi phục từ file tải lên', 'error');
    }
  } catch (err) {
    showToast('Lỗi đọc hoặc gửi file: ' + err.message, 'error');
  }
}
