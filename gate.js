// 静态门禁：GitHub Pages 没有函数后端，校验改在浏览器内完成。
// 只存 SHA-256(盐 + 授权码)，明文授权码不出现在源码里。
(function () {
  const PRICE_TEXT = '¥99 / 年';
  const CODE_KEY = 'sa_license_code';
  const HASHES = [
    "e22540dca9997e3df6ae4589448edbf521a4e6d9eea1b0b119b63c4e4702d5b2",
    "b08c99d2bb29839f657bd09fce4830991858c8bfa639dbe13e0ee6c8c56f4d05",
    "292dc86d249b8ee85a2b7b4e66b7a6a38b3904fe2b69b285514de09090b45a32",
    "80103459027fcf650195b270cf647ae207244cc97f5c72220c093655032ed021",
    "1520a60103844843c976eb7c88f4ab073c49a49846f183e3aa4512323adceda6",
    "8815281b508580c39a7d00bd09eb315a05f852c9e11ede01ba5d2bc29cd9f1e0",
    "c61aac28c1a0dee9a04d6f61da085654acad26bf43be9ea675e60f8e494e1e1f",
    "d94c5b249c95b4b8332535d24060b39bdf5c766f19852798503c6e566eb7c36f",
    "81847fd5df54448906044d8a47d8b8cd785290070a71bdbd93625a3fbc7e936a",
    "d5e48022950e53687b0e3e8743296cd9e056c76f5a396862a12071191ed32012",
    "3eb094ec2f97c05839b43575079fbb9097ef2a236945197cec2708468fcd0bf2",
    "5e4bc211577291fa141871b9d236dcb884176829d43053c63916ae840d86e488",
    "c5a97de5ec667416381296347648da35617cb19c177413e57a04b3bd0459b84d",
    "82b996637ea9db5880a4f910614c224cb579388cd427dbaff9ec5b81a1f3e1f8",
    "e6793a77578c172b09d2022c13eb063cf40c78e64f6bd3460c4498aeae6a7274",
    "dfd453ff5b0a628acb2a6c61b01901fb3483c48fd6d1b1786b07e0c5ee333279",
    "9f944703e78db06a8dffecd5549169a8fb49095cd95502e44582783f500b9bcb",
    "15b7afe032f59ed5942a3335bc767b5acbdf6f267bf1e3d984efd87bf5091e06",
    "1c0bf2922bccdba5a853b83ddc1227a2ed8743b0da312a98a77d3452d4a7c86e",
    "9058fd76dccb6750e971ab092ac2ec86892f92ee7df513b6f9ceb3d44f6a05de"
  ];

  const el = id => document.getElementById(id);

  async function digest(code) {
    const bytes = new TextEncoder().encode('sa-gate-2026' + code);
    const sum = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(sum), b => b.toString(16).padStart(2, '0')).join('');
  }

  const TIPS = {
    empty: '请先填入授权码。',
    invalid: '授权码无效或已作废，请核对后重试（区分 O/0 与 I/1）。',
    config: '配置文件读取失败，请刷新页面重试。',
  };

  function showPay(message) {
    el('paywall').style.display = 'flex';
    el('appShell').style.filter = 'blur(14px)';
    el('appShell').setAttribute('aria-hidden', 'true');
    el('pwMsg').textContent = message || '';
  }

  function hidePay() {
    el('paywall').style.display = 'none';
    el('appShell').style.filter = '';
    el('appShell').removeAttribute('aria-hidden');
  }

  async function unlock(code) {
    const catalog = await fetch('catalog.json').then(r => {
      if (!r.ok) throw Object.assign(new Error('config'), { tip: 'config' });
      return r.json();
    });
    hidePay();
    window.CFG = catalog;
    const script = document.createElement('script');
    script.src = 'app.js';
    document.body.appendChild(script);
  }

  async function tryCode(raw) {
    const code = (raw || '').trim().toUpperCase();
    if (!code) return showPay(TIPS.empty);
    if (!/^SA-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return showPay(TIPS.invalid);
    el('pwMsg').textContent = '正在验证…';
    const sum = await digest(code);
    if (!HASHES.includes(sum)) {
      localStorage.removeItem(CODE_KEY);
      return showPay(TIPS.invalid);
    }
    localStorage.setItem(CODE_KEY, code);
    try {
      await unlock(code);
    } catch (error) {
      showPay(TIPS[error.tip] || TIPS.config);
    }
  }

  function boot() {
    el('pwPrice').textContent = PRICE_TEXT;
    const saved = localStorage.getItem(CODE_KEY);
    if (saved) tryCode(saved); else showPay('');
  }

  window.__paywall = { boot, activate: () => tryCode(el('pwCode').value) };
  document.addEventListener('DOMContentLoaded', () => {
    el('pwBtn').addEventListener('click', window.__paywall.activate);
    el('pwCode').addEventListener('keydown', e => { if (e.key === 'Enter') window.__paywall.activate(); });
    boot();
  });
})();
