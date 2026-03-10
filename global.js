/**
 * Fintree Payment Universal Script (Hosted) - FULL VERSION (Copy/Paste)
 * Goal (consistent across sites):
 *  - BANK 탭: 무통장입금 계좌/입금자(은행 UI) 항상 표시
 *  - CREDIT 탭: 무통장입금 계좌/입금자(은행 UI) 항상 숨김
 *
 * Notes:
 *  - Imweb/스킨마다 DOM 구조/렌더 타이밍이 달라서,
 *    1) "무통장 fieldset"을 키워드로 탐색
 *    2) 있으면 custom UI의 #fnt-depositor-area로 통째 이동
 *    3) applyMethodUI()에서 BANK=show / CREDIT=hide를 '항상' 명시
 *    4) 늦게 생성되는 경우 MutationObserver로 재시도
 */

(function () {
  "use strict";

  const LOG_PREFIX = "[Fintree Netlify] ";

  // =========================
  // 1) CONFIG (필요시 수정)
  // =========================
  const CONFIG = {
    PUBLIC_KEY: "pk_1fc0-d72bd2-31f-a22a1",
    TID: "TMN009875",

    // hosted domain (스크립트/결제 성공/실패 페이지를 같이 운영하는 도메인)
    HOSTED_DOMAIN: "https://bagdown-payment.netlify.app",

    // (선택) 검증 API 경로가 hosted domain에 있는 경우
    VERIFY_API_PATH: "/api/verify",

    // 라우팅(프로젝트에 맞게 조정)
    ROUTES: {
      PAYMENT: ["/shop_payment", "/shop_payment/"], // 결제 화면
      COMPLETE: ["/shop_payment_complete", "/shop_payment_complete/"], // 결제 완료/콜백
    },

    // 로컬스토리지 키
    STORAGE: {
      METHOD: "fnt_pay_method",         // "BANK" | "CREDIT"
      PAYDATA: "fnt_pay_data",          // 결제 파라미터 저장
    },

    // itemName 제한(UTF-8 byte)
    ITEM_NAME_MAX_BYTES: 30,

    // 탭 기본값
    DEFAULT_METHOD: "BANK",

    // 무통장 UI(계좌/입금자) 탐색 키워드
    BANK_KEYWORDS: /무통장|계좌|입금자|예금주|입금\s*은행|입금\s*안내/i,

    // 디버그 로그
    DEBUG: true,
  };

  // --- Domain Restriction ---
  // 필요 도메인만 허용(원하시는대로 추가/수정)
  const ALLOWED_HOSTNAMES = [
    "qorekdnsqor1.imweb.me",
    "bagdown.shop",
    "kmcompany01.shop",
    "whggkqtycld1.imweb.me",
    "vpvpex",
    "localhost",
    "127.0.0.1",
  ];

  // =========================
  // 2) Utilities
  // =========================
  function log(...args) {
    if (!CONFIG.DEBUG) return;
    try { console.log(LOG_PREFIX, ...args); } catch (e) {}
  }

  function warn(...args) {
    try { console.warn(LOG_PREFIX, ...args); } catch (e) {}
  }

  function errorLog(...args) {
    try { console.error(LOG_PREFIX, ...args); } catch (e) {}
  }

  function normalizeHostname(hostname) {
    return (hostname || "").toLowerCase().replace(/^www\./, "");
  }

  function isAllowedDomain() {
    const host = normalizeHostname(location.hostname);
    // netlify/vercel 서브도메인 허용(원하면 제거)
    if (host.endsWith(".netlify.app") || host.endsWith(".vercel.app")) return true;
    return ALLOWED_HOSTNAMES.map(normalizeHostname).includes(host);
  }

  function onReady(fn) {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      setTimeout(fn, 0);
    } else {
      document.addEventListener("DOMContentLoaded", fn);
    }
  }

  function safeText(el) {
    return (el && (el.innerText || el.textContent) ? (el.innerText || el.textContent) : "") + "";
  }

  // =========================
  // 3) Amount extraction (총 주문금액 row only)
  // =========================
  function findTotalOrderAmountStrict() {
    // "총 주문금액" 라벨을 포함한 행을 찾고 옆의 span 숫자를 읽는 방식 (DOM 편차 대응)
    const labels = Array.from(document.querySelectorAll("label, dt, th, td, div, span, p"));
    const target = labels.find((el) => /총\s*주문금액/.test(safeText(el).replace(/\s+/g, "")));
    if (!target) return null;

    // 같은 줄/근처에서 금액 후보 찾기
    const container =
      target.closest("tr") ||
      target.closest("li") ||
      target.closest("dl") ||
      target.parentElement;

    if (!container) return null;

    const candidates = Array.from(container.querySelectorAll("span, strong, b, em, div"))
      .map((el) => safeText(el))
      .filter(Boolean);

    // 금액 패턴 추출
    for (const t of candidates) {
      const m = t.replace(/,/g, "").match(/(\d{1,3}(?:,\d{3})*|\d+)\s*원/);
      if (m) {
        const n = parseInt(m[1].replace(/,/g, ""), 10);
        if (!isNaN(n) && n > 0) return n;
      }
      // "123,456" 형태만 있는 경우
      const m2 = t.replace(/,/g, "").match(/\b(\d{4,})\b/);
      if (m2) {
        const n2 = parseInt(m2[1], 10);
        if (!isNaN(n2) && n2 > 0) return n2;
      }
    }

    return null;
  }

  // =========================
  // 4) UTF-8 byte truncate for itemName
  // =========================
  function utf8Truncate(str, maxBytes) {
    str = (str || "") + "";
    if (!str) return "";

    try {
      const enc = new TextEncoder();
      let bytes = 0;
      let out = "";
      for (const ch of str) {
        const b = enc.encode(ch).length;
        if (bytes + b > maxBytes) break;
        bytes += b;
        out += ch;
      }
      return out;
    } catch (e) {
      // fallback (older browsers)
      let bytes = 0;
      let out = "";
      for (let i = 0; i < str.length; i++) {
        const ch = str.charAt(i);
        const b = unescape(encodeURIComponent(ch)).length;
        if (bytes + b > maxBytes) break;
        bytes += b;
        out += ch;
      }
      return out;
    }
  }

  // =========================
  // 5) Overlay (optional)
  // =========================
  function createLoadingOverlay() {
    const id = "fnt-loading-overlay";
    if (document.getElementById(id)) return;

    const div = document.createElement("div");
    div.id = id;
    div.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:999999",
      "background:rgba(255,255,255,0.75)",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "font-family:system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      "color:#111",
    ].join(";");

    div.innerHTML = `
      <div style="text-align:center;">
        <div style="width:40px;height:40px;border:4px solid #ddd;border-top-color:#111;border-radius:50%;margin:0 auto 12px;animation:fntspin 1s linear infinite;"></div>
        <div style="font-size:14px;">결제 진행중...</div>
      </div>
      <style>@keyframes fntspin{to{transform:rotate(360deg);}}</style>
    `;
    document.body.appendChild(div);
  }

  function removeLoadingOverlay() {
    const el = document.getElementById("fnt-loading-overlay");
    if (el) el.remove();
  }

  // =========================
  // 6) Payment Execute (MARU SDK)
  // =========================
  function executePay(params) {
    // params 예시(프로젝트에 맞게 조정):
    // { amount, itemName, orderId, buyerName, buyerTel, buyerEmail, ... }

    if (!window.MARU || typeof window.MARU.pay !== "function") {
      errorLog("MARU SDK not ready. window.MARU.pay is undefined");
      alert("결제 모듈 로딩에 실패했습니다. 잠시 후 다시 시도해주세요.");
      return;
    }

    const safeItemName = utf8Truncate(params.itemName || "주문상품", CONFIG.ITEM_NAME_MAX_BYTES);

    const payload = Object.assign({}, params, {
      publicKey: CONFIG.PUBLIC_KEY,
      tid: CONFIG.TID,
      itemName: safeItemName,
    });

    log("executePay payload:", payload);

    createLoadingOverlay();
    try {
      window.MARU.pay(payload);
    } catch (e) {
      removeLoadingOverlay();
      errorLog("MARU.pay error:", e);
      alert("결제 실행 중 오류가 발생했습니다. 콘솔을 확인해주세요.");
    }
  }

  // SDK callback handler (필요시 프로젝트 규격에 맞게 수정)
  window.paymentResultByJS = function paymentResultByJS(data) {
    // 결제 완료/실패 콜백이 여기로 들어오는 케이스가 있음
    log("paymentResultByJS:", data);
    removeLoadingOverlay();
  };

  // =========================
  // 7) BANK UI (계좌/입금자) 찾기/이동/토글 - 핵심
  // =========================

  function findBankFieldset() {
    // 이미 이동된 bank fieldset 우선
    const moved = document.querySelector('fieldset[data-fnt-bank="1"]');
    if (moved) return moved;

    // 전체 fieldset 중 키워드 포함 탐색
    const fieldsets = Array.from(document.querySelectorAll("fieldset"));
    const hit = fieldsets.find((fs) => CONFIG.BANK_KEYWORDS.test(safeText(fs)));
    return hit || null;
  }

  function moveBankFieldsetIntoCustomUI(customRoot) {
    if (!customRoot) return false;

    const bankFieldset = findBankFieldset();
    const bankArea = customRoot.querySelector("#fnt-depositor-area");
    if (!bankFieldset || !bankArea) return false;

    // 이미 이동 완료면 skip
    if (!bankFieldset.hasAttribute("data-fnt-bank")) {
      bankArea.appendChild(bankFieldset);
      bankFieldset.setAttribute("data-fnt-bank", "1");
      // 이동 후 기본 display는 applyMethodUI가 결정
      log("Moved bank fieldset into custom UI");
    }
    return true;
  }

  function applyMethodUI(method, customRoot) {
    method = method === "CREDIT" ? "CREDIT" : "BANK";

    // 1) 커스텀 탭 UI 표시
    if (customRoot) {
      const tBank = customRoot.querySelector('[data-fnt-tab="BANK"]');
      const tCredit = customRoot.querySelector('[data-fnt-tab="CREDIT"]');
      if (tBank && tCredit) {
        tBank.classList.toggle("is-active", method === "BANK");
        tCredit.classList.toggle("is-active", method === "CREDIT");
      }
    }

    // 2) bank fieldset show/hide (명시적으로!)
    const bankFieldset = findBankFieldset();
    if (method === "CREDIT") {
      if (bankFieldset) bankFieldset.style.display = "none";
    } else {
      if (bankFieldset) bankFieldset.style.display = "";
    }

    // 3) (선택) BANK/카드 전환 시 페이지 내 다른 bank 관련 영역도 같이 정리하고 싶다면 여기서 처리
    //    단, DOM 편차가 크면 과하게 건드리면 역효과가 날 수 있어 최소만 유지
    log("applyMethodUI:", method, "bankFieldset:", !!bankFieldset);
  }

  function waitAndSetupBankUI(customRoot) {
    // 즉시 1회 시도
    moveBankFieldsetIntoCustomUI(customRoot);

    // bank DOM이 늦게 생성되는 사이트 대응
    const mo = new MutationObserver(() => {
      const moved = moveBankFieldsetIntoCustomUI(customRoot);
      if (moved) {
        // 이동 성공 시 observer 종료 가능
        // (하지만 테마에 따라 내용이 다시 렌더될 수 있어 완전 종료가 불안하면 주석 처리)
        mo.disconnect();

        const saved = localStorage.getItem(CONFIG.STORAGE.METHOD) || CONFIG.DEFAULT_METHOD;
        applyMethodUI(saved, customRoot);
      }
    });

    mo.observe(document.body, { childList: true, subtree: true });
  }

  // =========================
  // 8) Custom Payment UI Injection
  // =========================
  function buildCustomUI() {
    const wrap = document.createElement("div");
    wrap.id = "fnt-pay-custom";
    wrap.style.cssText = "margin:12px 0;";

    wrap.innerHTML = `
      <style>
        #fnt-pay-custom .fnt-tabs{
          display:flex; gap:8px; margin:8px 0 10px;
        }
        #fnt-pay-custom .fnt-tab{
          flex:1;
          padding:10px 12px;
          border:1px solid #ddd;
          border-radius:10px;
          background:#fff;
          font-size:14px;
          cursor:pointer;
          user-select:none;
          text-align:center;
        }
        #fnt-pay-custom .fnt-tab.is-active{
          border-color:#111;
          box-shadow:0 0 0 1px #111 inset;
          font-weight:700;
        }
        #fnt-pay-custom .pay-guide-text{
          margin:10px 0 6px;
          font-size:12px;
          line-height:1.45;
          color:#444;
        }
        #fnt-pay-custom .pay-guide-text .pay-guide-red{ color:#e60000; font-weight:700; margin:0; }
        #fnt-pay-custom .pay-guide-text .pay-guide-blue{ color:#0066ff; font-weight:700; margin:0; }
        #fnt-pay-custom #fnt-depositor-area{
          margin-top:10px;
        }
      </style>

      <div class="fnt-tabs">
        <div class="fnt-tab" data-fnt-tab="BANK">무통장입금</div>
        <div class="fnt-tab" data-fnt-tab="CREDIT">카드결제</div>
      </div>

      <div class="pay-guide-text">
        <div class="pay-guide-red">* 카드결제시에도 계좌안내문자가 자동 발송됩니다.</div>
        <div class="pay-guide-blue">카드결제와는 무관한 자동문자입니다.</div>
      </div>

      <div id="fnt-depositor-area"></div>
    `;

    return wrap;
  }

  function injectCustomPaymentUI() {
    // 결제 페이지에서 적당한 삽입 위치 찾기(테마별 편차 대응)
    // 1) "결제수단" 텍스트가 있는 헤더 근처
    // 2) 없으면 body 상단 근처로라도 넣기
    const headers = Array.from(document.querySelectorAll("h1,h2,h3,div,span,p"));
    const paymentHeader = headers.find((el) => /결제수단/.test(safeText(el)));

    const customUI = buildCustomUI();

    if (paymentHeader && paymentHeader.parentElement) {
      paymentHeader.parentElement.insertAdjacentElement("afterend", customUI);
      // 간격 과하면 여기서 조절
      paymentHeader.style.marginBottom = "6px";
    } else {
      // fallback
      document.body.insertAdjacentElement("afterbegin", customUI);
    }

    // 탭 이벤트
    const tabBank = customUI.querySelector('[data-fnt-tab="BANK"]');
    const tabCredit = customUI.querySelector('[data-fnt-tab="CREDIT"]');

    function setMethod(method) {
      localStorage.setItem(CONFIG.STORAGE.METHOD, method);
      applyMethodUI(method, customUI);
    }

    if (tabBank) tabBank.addEventListener("click", () => setMethod("BANK"));
    if (tabCredit) tabCredit.addEventListener("click", () => setMethod("CREDIT"));

    // bank UI 이동/감시 시작
    waitAndSetupBankUI(customUI);

    // 초기 적용
    const initMethod = localStorage.getItem(CONFIG.STORAGE.METHOD) || CONFIG.DEFAULT_METHOD;
    applyMethodUI(initMethod, customUI);

    log("Custom UI injected. initMethod =", initMethod);
  }

  // =========================
  // 9) Page Handlers
  // =========================
  function handleShopPayment() {
    // amount 추출 (필요시 pay_data 저장)
    const amount = findTotalOrderAmountStrict();
    if (!amount) warn("총 주문금액을 찾지 못했습니다. DOM을 확인하세요.");

    // 여기서 프로젝트별 pay_data를 구성해 저장해둘 수 있음(complete 페이지에서 카드 자동 실행 등)
    const payData = {
      amount: amount || 0,
      itemName: "주문상품",
      // orderId, buyerName, buyerTel 등은 프로젝트에서 채우세요
    };
    localStorage.setItem(CONFIG.STORAGE.PAYDATA, JSON.stringify(payData));

    injectCustomPaymentUI();
  }

  function handleShopPaymentComplete() {
    // 카드 결제일 때만 자동 executePay 하려면 사용
    const method = localStorage.getItem(CONFIG.STORAGE.METHOD) || CONFIG.DEFAULT_METHOD;
    const raw = localStorage.getItem(CONFIG.STORAGE.PAYDATA);
    let payData = null;

    try { payData = raw ? JSON.parse(raw) : null; } catch (e) {}

    log("complete page method:", method, "payData:", payData);

    if (method === "CREDIT" && payData && payData.amount > 0) {
      executePay(payData);
    } else {
      // BANK면 계좌 안내를 보여주는 흐름이 일반적이라 여기서 자동 결제 실행 없음
      removeLoadingOverlay();
    }
  }

  // =========================
  // 10) Router
  // =========================
  function pathStartsWithAny(list) {
    const p = location.pathname || "/";
    return (list || []).some((x) => p === x || p.startsWith(x));
  }

  function main() {
    if (!isAllowedDomain()) {
      warn("Script execution blocked: Domain not allowed (" + normalizeHostname(location.hostname) + ")");
      return;
    }

    const isPay = pathStartsWithAny(CONFIG.ROUTES.PAYMENT);
    const isComplete = pathStartsWithAny(CONFIG.ROUTES.COMPLETE);

    log("route:", location.pathname, { isPay, isComplete });

    if (isPay) handleShopPayment();
    if (isComplete) handleShopPaymentComplete();
  }

  onReady(main);
})();
