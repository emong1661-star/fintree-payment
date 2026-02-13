/**
 * Fintree Payment Universal Script (Netlify Hosted)
 * FIX v2:
 * - amount가 배송비(4,000)로 잡히는 문제 차단
 * - "주문 요약" 섹션의 "총 주문금액"을 1순위로 추출
 * - 못 찾으면 (상품가격 + 배송비 - 할인금액) 계산으로 총액 산출
 * - 카드결제 선택 시 무통장 영역 숨김
 */

(function () {
  const LOG_PREFIX = "[Fintree Netlify] ";

  // --- Domain Restriction ---
  const ALLOWED_HOSTNAMES = [
    "qorekdnsqor1.imweb.me",
    "bagdown.shop",
    "kmcompany01.shop",
    "whggkqtycld1.imweb.me",
    "vpvpexmxkqtb.imweb.me",
    "ptsrep.shop",
    "vjvprxmxkqsnjdl1.imweb.me",
    "ptwrep.shop",
    "localhost",
    "127.0.0.1",
    "bagdown-payment.netlify.app",
  ];

  if (!ALLOWED_HOSTNAMES.includes(location.hostname) && !location.hostname.endsWith(".vercel.app")) {
    console.warn(LOG_PREFIX + "Script execution blocked: Domain not allowed (" + location.hostname + ")");
    return;
  }

  console.log(LOG_PREFIX + "Initialized. Protocol:", location.protocol, "Path:", location.pathname);

  // --- Hosted domain detect ---
  let hostedDomain = "https://bagdown-payment.netlify.app";
  try {
    if (document.currentScript && document.currentScript.src) {
      const scriptUrl = new URL(document.currentScript.src);
      hostedDomain = scriptUrl.origin;
    }
  } catch (e) {
    console.warn(LOG_PREFIX + "Failed to detect hosted domain, using default:", hostedDomain);
  }

  const CONFIG = {
    PUBLIC_KEY: "pk_1fc0-d72bd2-31f-a22a1",
    TID: "TMN009875",
    HOSTED_DOMAIN: hostedDomain,
    PATHS: {
      INFO: "/shop_payment",
      CONFIRM: "/shop_payment_complete",
      SUCCESS: "/payment-success",
      CANCEL: "/payment-cancel",
    },
    ITEM_NAME_MAX_BYTES: 80,
  };

  // ---------------- Helper ----------------
  function pathMatches(targetPath) {
    const currentPath = location.pathname;
    return (
      currentPath === targetPath ||
      currentPath === targetPath + ".html" ||
      currentPath === targetPath + "/" ||
      currentPath.endsWith(targetPath + ".html")
    );
  }

  function getRedirectUrl(targetPath) {
    const isLocal = location.pathname.endsWith(".html") || location.protocol === "file:";
    return targetPath + (isLocal ? ".html" : "");
  }

  function getURLParam(name) {
    const results = new RegExp("[\\?&]" + name + "=([^&#]*)").exec(location.search);
    return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
  }

  function parseAmountNumber(input) {
    if (input == null) return 0;
    const s = String(input);
    // 숫자 토큰 후보들
    const matches = s.match(/\d[\d,.\s]*\d/g);
    if (!matches || matches.length === 0) return 0;

    // 여러개면 "이어붙이지 말고" 가장 마지막 토큰 사용(줄 내부에서 값은 보통 마지막)
    const pick = matches[matches.length - 1];
    const n = parseInt(String(pick).replace(/[,\s.]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }

  function utf8ByteLength(str) {
    try {
      return new TextEncoder().encode(String(str || "")).length;
    } catch (e) {
      return unescape(encodeURIComponent(String(str || ""))).length;
    }
  }

  function truncateUtf8ByBytes(str, maxBytes) {
    str = String(str || "");
    if (utf8ByteLength(str) <= maxBytes) return str;
    let out = "";
    for (const ch of str) {
      const next = out + ch;
      if (utf8ByteLength(next) > maxBytes) break;
      out = next;
    }
    return out;
  }

  function sanitizeItemName(name) {
    let s = String(name || "상품").trim();
    s = s
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[💳🏦✅❌🔥⭐️✨]/g, "")
      .replace(/[\/\\|]/g, " ")
      .trim();

    return truncateUtf8ByBytes(s || "상품", CONFIG.ITEM_NAME_MAX_BYTES);
  }

  // ✅ "주문 요약" 섹션 찾기
  function findOrderSummaryRoot() {
    const candidates = Array.from(document.querySelectorAll("section, div"));
    for (const el of candidates) {
      const t = (el.innerText || "").replace(/\s/g, "");
      if (t.includes("주문요약") && t.includes("총주문금액")) return el;
    }
    // 주문요약 텍스트만 있는 경우도 대비
    for (const el of candidates) {
      const t = (el.innerText || "").replace(/\s/g, "");
      if (t.includes("주문요약")) return el;
    }
    return null;
  }

  // ✅ "총 주문금액" 줄에서만 값 뽑기 (배송비 줄 절대 안봄)
  function extractTotalOrderAmountStrict() {
    const root = findOrderSummaryRoot();
    if (!root) return 0;

    const nodes = Array.from(root.querySelectorAll("div, li, p, span, strong, b"));
    for (const el of nodes) {
      const text = (el.innerText || "").replace(/\s/g, "");
      if (!text) continue;

      // "총주문금액" 정확히 있는 라벨만
      if (text.includes("총주문금액")) {
        const row = el.closest("div, li, p") || el.parentElement;
        if (!row) continue;

        // row 안에서 값 후보 우선
        const prefer = row.querySelector("strong, b, [class*='price'], [class*='amount'], .value, .price, .amount");
        if (prefer) {
          const v = parseAmountNumber(prefer.innerText);
          if (v > 0) return v;
        }

        const v2 = parseAmountNumber(row.innerText);
        if (v2 > 0) return v2;
      }
    }
    return 0;
  }

  // ✅ 못 찾으면 계산으로 총액 만들기: 상품가격 + 배송비 - 할인금액
  function extractTotalByCalc() {
    const root = findOrderSummaryRoot();
    if (!root) return 0;

    const textAll = (root.innerText || "");

    // 각 라벨 줄을 찾아서 숫자 추출
    function findLineValue(labelRegex) {
      const lines = textAll.split("\n").map((s) => s.trim()).filter(Boolean);
      for (const line of lines) {
        if (labelRegex.test(line.replace(/\s/g, ""))) {
          return parseAmountNumber(line);
        }
      }
      // 라인 파싱 실패하면 DOM row 방식
      const nodes = Array.from(root.querySelectorAll("div, li, p, span"));
      for (const el of nodes) {
        const t = (el.innerText || "").replace(/\s/g, "");
        if (labelRegex.test(t)) {
          const row = el.closest("div, li, p") || el.parentElement;
          if (!row) continue;
          return parseAmountNumber(row.innerText);
        }
      }
      return 0;
    }

    const product = findLineValue(/상품가격/);
    const ship = findLineValue(/배송비/);
    const discount = findLineValue(/상품할인금액|할인금액/);

    // discount 줄은 보통 "- 82,200"처럼 나오는데 parseAmountNumber는 82200으로만 뽑힘
    const total = (product || 0) + (ship || 0) - (discount || 0);

    // 계산값이 말이 되면(0보다 큼) 사용
    if (total > 0) return total;
    return 0;
  }

  function extractAmountFromDataLayer() {
    try {
      const dl = window.dataLayer;
      if (!Array.isArray(dl)) return 0;

      for (let i = dl.length - 1; i >= 0; i--) {
        const e = dl[i];
        if (!e || typeof e !== "object") continue;

        if (e.ecommerce && typeof e.ecommerce === "object") {
          const v1 = parseAmountNumber(e.ecommerce.value);
          if (v1 > 0) return v1;

          const v2 =
            e.ecommerce.purchase &&
            e.ecommerce.purchase.actionField &&
            parseAmountNumber(e.ecommerce.purchase.actionField.revenue);
          if (v2 > 0) return v2;
        }

        const v3 = parseAmountNumber(e.value);
        if (v3 > 0) return v3;
      }
    } catch (err) {}
    return 0;
  }

  /**
   * ✅ amount 최종 결정:
   * 1) 총주문금액 라벨 줄
   * 2) (상품가격+배송비-할인) 계산
   * 3) dataLayer
   * 4) 못찾으면 0 (배송비 같은 값으로 절대 타협 안함)
   */
  function extractAmountStrong() {
    const a1 = extractTotalOrderAmountStrict();
    if (a1 > 0) {
      console.log(LOG_PREFIX + "Amount from TOTAL row =>", a1);
      return a1;
    }

    const a2 = extractTotalByCalc();
    if (a2 > 0) {
      console.log(LOG_PREFIX + "Amount from CALC =>", a2);
      return a2;
    }

    const a3 = extractAmountFromDataLayer();
    if (a3 > 0) {
      console.log(LOG_PREFIX + "Amount from dataLayer =>", a3);
      return a3;
    }

    console.warn(LOG_PREFIX + "Amount not found => 0 (blocked)");
    return 0;
  }

  // ---------------- Payment ----------------
  function createLoadingOverlay() {
    if (document.getElementById("fnt-loading-overlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "fnt-loading-overlay";
    overlay.style.cssText =
      "position:fixed; top:0; left:0; width:100%; height:100%; background:#fff; z-index:9998; display:flex; flex-direction:column; align-items:center; justify-content:center; font-family:sans-serif;";
    const style = document.createElement("style");
    style.innerHTML = `
      @keyframes fnt-spin { to { transform: rotate(360deg); } }
      .fnt-spinner { width: 45px; height: 45px; border: 4px solid #f3f3f3; border-top-color: #000; border-radius: 50%; animation: fnt-spin 1s linear infinite; margin-bottom: 20px; }
    `;
    document.head.appendChild(style);
    overlay.innerHTML = `
      <div class="fnt-spinner"></div>
      <div style="font-weight:600;font-size:16px;color:#333;">결제 시스템을 불러오고 있습니다...</div>
    `;
    document.body.appendChild(overlay);
  }

  function executePay(params) {
    params.itemName = sanitizeItemName(params.itemName);

    console.log(LOG_PREFIX + "Calling MARU.pay params:", params);

    setTimeout(function () {
      if (typeof MARU !== "undefined" && MARU && typeof MARU.pay === "function") {
        MARU.pay({
          payRoute: "3d",
          responseFunction: window.paymentResultByJS,
          publicKey: CONFIG.PUBLIC_KEY,
          trackId: params.trackId,
          amount: params.amount,
          redirectUrl: window.location.origin + getRedirectUrl(CONFIG.PATHS.SUCCESS),
          itemName: params.itemName,
          userEmail: params.userEmail,
          userName: params.userName,
          userTel: params.userTel,
          mode: "layer",
          debugMode: "live",
        });
      } else {
        alert("결제 모듈(MARU)을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    }, 200);
  }

  window.paymentResultByJS = function (data) {
    console.log(LOG_PREFIX + "SDK Callback:", data);
    if (!data || !data.result) return;

    const cd = data.result.resultCd;
    const msg = data.result.advanceMsg || data.result.resultMsg || "";

    if (cd === "0000") {
      const trackId = (data.pay && data.pay.trackId) ? data.pay.trackId : getURLParam("order_no");
      location.href = getRedirectUrl(CONFIG.PATHS.SUCCESS) + "?status=success&trackId=" + encodeURIComponent(trackId || "");
    } else {
      location.href = getRedirectUrl(CONFIG.PATHS.CANCEL) + "?msg=" + encodeURIComponent(msg || "결제 실패/취소");
    }
  };

  // ---------------- shop_payment ----------------
  function handleShopPayment() {
    console.log(LOG_PREFIX + "Routing: /shop_payment");

    function updatePaymentState(method, depositorArea, depositorInput) {
      localStorage.setItem("payMethod", method === "CREDIT" ? "CreditCard" : "BankTransfer");

      // ✅ 카드결제면 무통장 영역 완전 숨김
      if (depositorArea) {
        if (method === "CREDIT") {
          depositorArea.style.display = "none";
          if (depositorInput) depositorInput.value = "카드결제";
        } else {
          depositorArea.style.display = "block";
          if (depositorInput && depositorInput.value === "카드결제") depositorInput.value = "";
        }
      }
    }

    function injectCustomPaymentUI() {
      const itv = setInterval(() => {
        const headers = Array.from(document.querySelectorAll("header, h2, h3, .title, .css-17g8nhj"));
        const paymentHeader = headers.find((h) => (h.innerText || "").includes("결제수단"));
        if (!paymentHeader) return;

        const paymentSection =
          paymentHeader.closest('div[class*="css-"]') ||
          paymentHeader.closest(".pay-method-section") ||
          paymentHeader.parentElement;
        if (!paymentSection) return;

        if (paymentSection.querySelector(".pay-method-custom")) {
          clearInterval(itv);
          return;
        }

        const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
        const bankRadio = radios.find((r) => r.value && r.value.includes("OPM01"));
        if (!bankRadio) return;
        if (!bankRadio.checked) bankRadio.click();

        let depositorBlock = document.querySelector(".css-1hw29i9");
        if (!depositorBlock) {
          const input = document.querySelector('input[placeholder*="입금자명"]') || document.querySelector('input[name="depositor"]');
          if (input) depositorBlock = input.closest("div");
        }

        const customUI = document.createElement("div");
        customUI.className = "pay-method-custom";
        customUI.innerHTML = `
          <style>
            .pay-method-custom { display:flex; flex-direction:column; gap:15px; margin:15px 0; }
            .pay-method-buttons { display:flex; gap:10px; }
            .pay-method-custom button { flex:1; padding:15px; border:1px solid #ddd; border-radius:8px; background:#fff; font-weight:700; font-size:16px; }
            .pay-method-custom button.active { background:#333; color:#fff; border-color:#333; }
            .moved-depositor-block { margin-top:10px; padding:10px; border:1px solid #eee; border-radius:6px; background:#fafafa; }
          </style>
          <div class="pay-method-buttons">
            <button type="button" data-method="CREDIT" class="active">💳 카드결제</button>
            <button type="button" data-method="BANK">🏦 무통장입금</button>
          </div>
          <div id="fnt-depositor-area"></div>
        `;

        paymentHeader.insertAdjacentElement("afterend", customUI);

        const depositorArea = customUI.querySelector("#fnt-depositor-area");
        if (depositorBlock && depositorArea) {
          depositorBlock.classList.add("moved-depositor-block");
          depositorArea.appendChild(depositorBlock);
        }

        const fieldset = bankRadio.closest("fieldset");
        if (fieldset) fieldset.style.display = "none";

        const depositorInput =
          customUI.querySelector('input[placeholder*="입금자명"]') ||
          customUI.querySelector('input[name="depositor"]') ||
          (depositorBlock ? depositorBlock.querySelector('input[placeholder*="입금자명"], input[name="depositor"]') : null);

        // 기본 카드결제 상태
        updatePaymentState("CREDIT", depositorArea, depositorInput);

        const buttons = customUI.querySelectorAll("button[data-method]");
        buttons.forEach((btn) => {
          btn.addEventListener("click", () => {
            buttons.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            const method = btn.getAttribute("data-method");
            updatePaymentState(method, depositorArea, depositorInput);
            saveCurrentState("Method Click", method);
          });
        });

        console.log(LOG_PREFIX + "Custom UI injected");
        clearInterval(itv);
      }, 300);
    }

    function saveCurrentState(source = "Manual", overrideMethod = null) {
      const itemNameEl = document.querySelector(".css-a0a2v3") || document.querySelector("._product_name");
      const qtyEl = document.querySelector(".css-15fzge") || document.querySelector("._product_qty");

      const rawName = itemNameEl ? (itemNameEl.innerText || "").trim() : "상품";
      const qty = qtyEl ? (qtyEl.innerText || "").replace(/[^0-9]/g, "") : "1";

      const amountNum = extractAmountStrong(); // ✅ 총주문금액만
      console.log(LOG_PREFIX + "Saved amount =>", amountNum);

      let method = overrideMethod;
      if (!method) {
        const uiState = localStorage.getItem("payMethod");
        method = uiState === "CreditCard" ? "CREDIT" : "BANK";
      }

      const paymentData = {
        orderNo: getURLParam("order_no") || "ORD-" + Date.now(),
        amount: String(amountNum || 0),
        itemName: sanitizeItemName(rawName),
        qty: qty || "1",
        method,
      };

      localStorage.setItem("fintree_pay_data", JSON.stringify(paymentData));
      console.log(LOG_PREFIX + `Saved fintree_pay_data [${source}]`, paymentData);

      return paymentData;
    }

    window.addEventListener("load", function () {
      saveCurrentState("Initial Load");

      setInterval(() => {
        if (pathMatches(CONFIG.PATHS.INFO)) saveCurrentState("Timer");
      }, 1200);

      document.addEventListener(
        "click",
        function (e) {
          const btn = e.target.closest('button[type="submit"], ._btn_payment, .css-1tf84sl, .css-clap0e');
          if (btn && (btn.innerText || "").includes("결제하기")) {
            const uiState = localStorage.getItem("payMethod");
            const chosen = uiState === "CreditCard" ? "CREDIT" : "BANK";
            saveCurrentState("Pay Button Click", chosen);
            return true;
          }
        },
        true
      );
    });

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", injectCustomPaymentUI);
    else injectCustomPaymentUI();
  }

  // ---------------- shop_payment_complete ----------------
  function handleShopPaymentComplete() {
    console.log(LOG_PREFIX + "Routing: /shop_payment_complete");

    window.addEventListener("load", function () {
      let stored = null;
      try {
        stored = JSON.parse(localStorage.getItem("fintree_pay_data"));
      } catch (e) {}

      const urlOrderNo = getURLParam("order_no");

      // ✅ complete 페이지에서는 stored.amount가 정답이어야 함
      let amountNum = stored ? parseInt(String(stored.amount || "0"), 10) : 0;

      // 그래도 0이면 여기서도 총액 재추출(엄격/계산)
      if (!amountNum || amountNum <= 0) {
        amountNum = extractAmountStrong();
        console.log(LOG_PREFIX + "Recovered amount on complete =>", amountNum);
      }

      const params = {
        trackId: urlOrderNo || (stored && stored.orderNo) || "",
        amount: String(amountNum || 0),
        userName: (stored && stored.userName) || "",
        userTel: (stored && stored.userTel) || "",
        userEmail: (stored && stored.userEmail) || "",
        itemName: sanitizeItemName(stored && stored.itemName ? stored.itemName : "상품"),
      };

      console.log(LOG_PREFIX + "Final pay params:", params);

      if (!amountNum || amountNum <= 0) {
        alert("총 주문금액을 읽지 못해 결제를 막았습니다. 콘솔 Amount 로그 캡처를 보내주세요.");
        console.error(LOG_PREFIX + "Blocked: amount=0");
        return;
      }

      if (stored && stored.method === "CREDIT") {
        createLoadingOverlay();
        executePay(params);
      }
    });
  }

  // ---------------- Router ----------------
  function initRouter() {
    if (pathMatches(CONFIG.PATHS.INFO)) handleShopPayment();
    else if (pathMatches(CONFIG.PATHS.CONFIRM)) handleShopPaymentComplete();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initRouter);
  else initRouter();
})();
