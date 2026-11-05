// 付费墙：所有授权判定都走 Cloudflare Worker，页面不内置任何可用口令。
(function () {
  const API = 'https://sa-license-api.lhc023.workers.dev';
  const PRICE_TEXT = '¥99 / 年';
  const CODE_KEY = 'sa_license_code';
  const DEVICE_KEY = 'sa_device_id';
  const ORDER_KEY = 'sa_pay_order';
  const ORDER_TTL_MS = 24 * 3600 * 1000;
  const CODE_OK = /^[A-Z0-9][A-Z0-9-]{5,32}$/;
  const TOKEN_OK = /^[a-z0-9]{8,64}$/;

  const el = id => document.getElementById(id);
  const enc = encodeURIComponent;

  function deviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) ||
        ('d' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  const TIPS = {
    license_not_found: '没有这个授权码，请核对后重试（区分 O/0 与 I/1）。',
    license_revoked: '该授权码已被停用，请联系作者。',
    license_expired: '该授权码已到期，续费后即可继续使用。',
    seats_full: '授权席位已满，请先联系作者解绑旧设备。',
    device_not_activated: '此设备尚未激活，请在下方填入授权码后点「激活」。',
    invalid_code_format: '授权码格式不对，应形如 SA-AB12-CD34。',
    invalid_device_id: '本机标识异常，请清理浏览器站点数据后重试。',
    admin_not_configured: '发放服务未配置，请联系作者。',
    pay_not_configured: '在线收款暂未开通，请先使用人工方式购买。',
    pay_seller_unconfigured: '在线收款配置不完整，请先使用人工方式购买。',
    pay_form_missing: '没有取到支付页面，请稍后重试或改用人工方式。',
    too_many_orders: '发起付款过于频繁，请稍后再试。',
    network_error: '连不上授权服务，请检查网络后重试。',
    invalid_response: '授权服务返回了无法识别的结果，请稍后重试。',
  };
  const tip = code => TIPS[code] || '暂时无法完成验证，请稍后重试。';

  async function api(path, init) {
    let response;
    try {
      response = await fetch(API + path, Object.assign({ credentials: 'omit' }, init || {}));
    } catch (e) {
      throw Object.assign(new Error('network'), { code: 'network_error' });
    }
    let body;
    try { body = await response.json(); } catch (e) {
      throw Object.assign(new Error('bad json'), { code: 'invalid_response' });
    }
    if (!response.ok || body.ok !== true) {
      throw Object.assign(new Error(body.error || 'request_failed'), { code: body.error || 'http_' + response.status });
    }
    return body;
  }

  let unlocked = false;
  function showPay(message) {
    if (unlocked) return;
    el('paywall').style.display = 'flex';
    el('appShell').style.filter = 'blur(14px)';
    el('appShell').setAttribute('aria-hidden', 'true');
    el('pwMsg').textContent = message || '';
  }
  function hidePay() {
    unlocked = true;
    el('paywall').style.display = 'none';
    el('appShell').style.filter = '';
    el('appShell').removeAttribute('aria-hidden');
  }

  function runApp(config) {
    window.CFG = config;
    const script = document.createElement('script');
    script.src = 'app.js';
    document.body.appendChild(script);
  }

  async function loadApp(code) {
    const query = '?code=' + enc(code) + '&device=' + enc(deviceId());
    const catalog = await api('/api/catalog' + query);
    hidePay();
    runApp(catalog.config);
  }

  // 收款是否可用只取决于服务端密钥是否配齐。未配齐时不藏按钮——藏起来买家只会对着一屏
  // 授权码输入框发呆；改成明确写「暂未开通」并展开人工购买方式，外人照样能付费拿到码。
  async function gatePayButton() {
    let payReady = true;
    try {
      const health = await api('/api/health');
      payReady = health.pay === true;
    } catch (e) {
      payReady = true; // 探测本身失败时保留按钮，点击后仍会有明确提示
    }
    if (payReady) return;
    const btn = el('pwPay');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '在线收款暂未开通 · 用下方联系方式人工购买';
    }
    const alt = document.querySelector('.pw-alt');
    if (alt) alt.open = true;
  }

  // ---------- 付款后找回授权码 ----------
  // 买家在支付宝结果页直接关掉标签、或异步通知晚于页面轮询时，付款凭证（order_token）会丢。
  // 把它存在本机，回到工作台就能凭它重新领一次码；重新领取仍走服务端查询，不信任本地状态。
  function storedOrder() {
    const fromUrl = (new URLSearchParams(location.search).get('order') || '').trim();
    if (TOKEN_OK.test(fromUrl)) return { t: fromUrl, at: Date.now() };
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(ORDER_KEY) || 'null'); } catch (e) { raw = null; }
    if (raw && TOKEN_OK.test(raw.t || '') && Date.now() - (raw.at || 0) < ORDER_TTL_MS) return raw;
    return null;
  }
  function clearStoredOrder() { try { localStorage.removeItem(ORDER_KEY); } catch (e) {} }

  function showRecover(message, buttonLabel) {
    el('pwMsg').textContent = message;
    let btn = el('pwRecover');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'pwRecover';
      document.getElementById('pwMsg').insertAdjacentElement('afterend', btn);
    }
    btn.textContent = buttonLabel;
    btn.disabled = false;
    btn.style.cssText = 'width:100%;margin-top:10px;padding:11px;font-size:15px;font-weight:600;'
      + 'color:#0b2b23;background:#7fe3c1;border:0;border-radius:8px;cursor:pointer';
    btn.onclick = function () { showRecover('正在领取授权码…', '正在领取…'); btn.disabled = true; recoverOrder(true); };
  }

  async function recoverOrder(force) {
    const order = storedOrder();
    if (!order) return false;
    let status;
    try {
      status = await api('/api/pay/status?order_token=' + enc(order.t));
    } catch (e) {
      if (force) el('pwMsg').textContent = tip(e.code);
      return false;
    }
    if (status.state === 'PAID' && status.licenseCode) {
      clearStoredOrder();
      localStorage.setItem(CODE_KEY, status.licenseCode);
      el('pwCode').value = status.licenseCode;
      const btn = el('pwRecover');
      if (btn) btn.remove();
      showPay('支付成功，授权码 ' + status.licenseCode + '，正在进入工作台…');
      await loadApp(status.licenseCode);
      return true;
    }
    if (status.state === 'PAID') {
      showRecover('支付已完成，授权码正在发放，稍等几秒再点一次。', '重新领取授权码');
      return true;
    }
    if (status.state === 'CLOSED' || status.state === 'REFUNDED') {
      clearStoredOrder();
      return false;
    }
    if (force) showRecover('这笔订单还没查到付款完成。若已付款，点下面按钮重新领取。', '我已付款，领取授权码');
    return true;
  }

  function urlCode() {
    // 支付结果页会带 ?code= 回链到工作台：省掉「手抄授权码」这一步
    const c = (new URLSearchParams(location.search).get('code') || '').trim().toUpperCase();
    return CODE_OK.test(c) ? c : '';
  }

  async function boot() {
    el('pwPrice').textContent = PRICE_TEXT;
    await gatePayButton();
    const deep = urlCode();
    if (deep) localStorage.setItem(CODE_KEY, deep);
    const code = deep || (localStorage.getItem(CODE_KEY) || '').trim();
    el('pwCode').value = code || '';
    if (!code) {
      showPay('');
      await recoverOrder(true);
      return;
    }
    try {
      const access = await api('/api/access?code=' + enc(code) + '&device=' + enc(deviceId()));
      if (!access.activated) {
        showPay('授权码有效，但此设备还没有激活，请点「激活」。');
        return;
      }
      await loadApp(code);
    } catch (e) {
      if (['license_revoked', 'license_expired', 'license_not_found'].includes(e.code)) {
        localStorage.removeItem(CODE_KEY);
      }
      showPay(tip(e.code));
      await recoverOrder(true);
    }
  }

  async function activate() {
    const code = (el('pwCode').value || '').trim().toUpperCase();
    if (!code) { el('pwMsg').textContent = '请先填入授权码。'; return; }
    el('pwMsg').textContent = '正在验证…';
    try {
      await api('/api/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: code, device_id: deviceId() }),
      });
      localStorage.setItem(CODE_KEY, code);
      await loadApp(code);
    } catch (e) {
      el('pwMsg').textContent = tip(e.code);
    }
  }

  // 支付宝下单返回的是 HTML <form>，必须渲染后自动提交；直接当 URL 跳只会看到一堆参数。
  function submitAlipayForm(html) {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#fff';
    box.innerHTML = html;
    document.body.appendChild(box);
    const form = box.querySelector('form');
    if (!form) {
      box.remove();
      throw Object.assign(new Error('pay form missing'), { code: 'pay_form_missing' });
    }
    form.submit();
  }

  async function payNow() {
    const btn = el('pwPay');
    if (btn) btn.disabled = true;
    el('pwMsg').textContent = '正在发起支付宝付款…';
    try {
      const order = await api('/api/pay/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ item: 'standard' }),
      });
      // 先落地再跳转：付款页一关，order_token 就是唯一的取码凭证
      try { localStorage.setItem(ORDER_KEY, JSON.stringify({ t: order.order_token, at: Date.now() })); } catch (e) {}
      submitAlipayForm(order.payment_html);
    } catch (e) {
      el('pwMsg').textContent = tip(e.code);
      if (btn) btn.disabled = false;
    }
  }

  window.__paywall = { boot: boot, activate: activate, payNow: payNow };
  document.addEventListener('DOMContentLoaded', function () {
    el('pwBtn').addEventListener('click', activate);
    const payBtn = el('pwPay');
    if (payBtn) payBtn.addEventListener('click', payNow);
    el('pwCode').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') activate();
    });
    boot();
  });
})();
