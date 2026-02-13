/**
 * Fintree Payment Universal Script (Netlify Hosted)
 * PATCH v2: amount extraction 강화 (DOM + dataLayer + 텍스트 스캔)
 */

(function () {
  const LOG_PREFIX = "[Fintree Netlify] ";

  // --- Domain Restriction ---
  const ALLOWED_HOSTNAMES = [
    "qorekdnsqor1.imweb.me",
    "bagdown.shop",
    "kmcompany01.shop",
    "whggkqtycld1.imweb.me",
    "localhost",
    "127.0.0.1",
    "bagdown-payment.netlify.app",
  ];

  if (
    !ALLOWED_HOSTNAMES.includes(location.hostname) &&
    !location.hostname.endsWith(".vercel.app")
  ) {
    console.warn(
      LOG_PREFIX +
        "Script execution blocked: Domain not allowed (" +
        location.hostname +
        ")"
    );
    return;
  }

  console.log(
    LOG_PREFIX + "Initialized. Protocol:",
    location.protocol,
    "Path:",
    location.pathname
  );

  // --- Hosted Domain Detect ---
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
    VERIFY_API: "/api/verify",
    HOSTED_DOMAIN: hostedDomain,
    PATHS: {
      INFO: "/shop_payment",
      CONFIRM: "/shop_payment_complete",
      SUCCESS: "/payment-success",
      CANCEL: "/payment-cancel",
      REFUND: "/payment-refund",
    },
  };

  // -------------------------
  // Helpers
  // -------------------------
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

  function parseMoney(text) {
    if (!text) return "0";
    const n = String(text).replace(/[^\d]/g, "");
    return n && n.length ? n : "0";
  }

  // ✅ 핵심: amount 추출을 "확실히" 해주는 함수
  function getAmountSmart() {
    // 1) 흔한 DOM 셀렉터들
    const selectors = [
      ".css-x99dng",
      ".css-z3pbio",
      ".css-1i1erzf",
      "._total_price",
      ".total_price",
      "[data-total-price]",
      "[data-price]",
      "[data-amount]",
      ".order_price",
      ".pay_price",
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText) {
        const v = parseMoney(el.innerText);
        if (v !== "0") {
          console.log(LOG_PREFIX + "Amount from selector:", sel, "=>", v);
          return v;
        }
      }
    }

    // 2) ✅ dataLayer에서 purchase/value/price 찾기 (네 콘솔의 1040000 JPY가 여기서 나올 가능성 큼)
    try {
      const dl = window.dataLayer;
      if (Array.isArray(dl)) {
        const keys = ["value", "price", "amount", "total", "revenue", "payment_total", "order_total"];
        for (let i = dl.length - 1; i >= 0; i--) {
          const obj = dl[i];
          if (!obj || typeof obj !== "object") continue;

          // event가 purchase 계열이면 우선
          const ev = String(obj.event || "").toLowerCase();
          const isPurchase =
            ev.includes("purchase") || ev.includes("payment") || ev.includes("order") || ev.includes("checkout");

          for (const k of keys) {
            if (obj[k] != null) {
              const candidate = parseMoney(obj[k]);
              if (candidate !== "0") {
                console.log(
                  LOG_PREFIX + "Amount from dataLayer:",
                  "event=" + obj.event,
                  "key=" + k,
                  "=>",
                  candidate
                );
                return candidate;
              }
            }
          }

          // ecommerce.value 같은 구조도 대응
          if (obj.ecommerce && typeof obj.ecommerce === "object") {
            const eco = obj.ecommerce;
            if (eco.value != null) {
              const v = parseMoney(eco.value);
              if (v !== "0") {
                console.log(LOG_PREFIX + "Amount from dataLayer.ecommerce.value =>", v);
                return v;
              }
            }
            if (eco.purchase && eco.purchase.actionField && eco.purchase.actionField.revenue != null) {
              const v = parseMoney(eco.purchase.actionField.revenue);
              if (v !== "0") {
                console.log(LOG_PREFIX + "Amount from dataLayer.ecommerce.purchase.actionField.revenue =>", v);
                return v;
              }
            }
          }

          // purchase 이벤트가 아니라도 마지막에 값이 있으면 사용
          if (!isPurchase) continue;
        }
      }
    } catch (e) {
      console.warn(LOG_PREFIX + "dataLayer parse failed:", e.message);
    }

    // 3) ✅ 전체 텍스트 스캔: "¥", "JPY", "원", "KRW" 주변 숫자 후보 중 "가장 큰 값"을 amount로 사용
    try {
      const bodyText = (document.body && document.body.innerText) ? document.body.innerText : "";
      if (bodyText) {
        const lines = bodyText.split("\n").map(s => s.trim()).filter(Boolean);

        const candidates = [];
        const moneyRegex = /(?:¥|\bJPY\b|\bKRW\b|원)\s*([0-9][0-9,.\s]{2,})/i;
        const moneyRegex2 = /([0-9][0-9,.\s]{2,})\s*(?:¥|\bJPY\b|\bKRW\b|원)/i;

        for (const line of lines) {
          let m = line.match(moneyRegex) || line.match(moneyRegex2);
          if (m && m[1]) {
            const v = parseMoney(m[1]);
            if (v !== "0") candidates.push(parseInt(v, 10));
          }
        }

        if (candidates.length) {
          const max = Math.max(...candidates);
          console.log(LOG_PREFIX + "Amount from text scan (max candidate) =>", String(max));
          return String(max);
        }
      }
    } catch (e) {
      console.warn(LOG_PREFIX + "Text scan failed:", e.message);
    }

    // 4) 실패
    console.log(LOG_PREFIX + "Amount not found => 0");
    return "0";
  }

  function createLoadingOverlay() {
    if (document.getElementById("fnt-loading-overlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "fnt-loading-overlay";
    overlay.style.cssText =
      "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(255,255,255,1); z-index:9998; display:flex; flex-direction:column; align-items:center; justify-content:center; font-family:sans-serif;";
    const style = document.createElement("style");
    style.innerHTML = `
      @keyframes fnt-spin { to { transform: rotate(360deg); } }
      .fnt-spinner { width: 45px; height: 45px; border: 4px solid #f3f3f3; border-top-color: #000; border-radius: 50%; animation: fnt-spin 1s linear infinite; margin-bottom: 20px; }
    `;
    document.head.appendChild(style);
    overlay.innerHTML = `
      <div class="fnt-spinner"></div>
      <div style="font-weight: 600; font-size: 16px; color: #333;">결제 시스템을 불러오고 있습니다...</div>
    `;
    document.body.appendChild(overlay);
  }

  function executePay(params) {
    console.log(LOG_PREFIX + "executePay params:", params);

    // ✅ amount 0이면 절대 실행 안 함
    if (!params || !params.amount || String(params.amount) === "0") {
      alert(
        "결제금액(amount)을 읽지 못해 결제를 진행할 수 없습니다. (amount=0)\n" +
          "콘솔에 찍힌 'Amount from ...' 로그와 함께 캡처 보내주세요."
      );
      console.error(LOG_PREFIX + "Blocked: amount=0", params);
      return;
    }

    setTimeout(function () {
      if (typeof MARU !== "undefined") {
        console.log(LOG_PREFIX + "Calling MARU.pay");
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
        console.error(LOG_PREFIX + "MARU SDK Not Found.");
        alert("결제 모듈을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        location.reload();
      }
    }, 200);
  }

  window.paymentResultByJS = function (data) {
    console.log(LOG_PREFIX + "SDK Callback Data:", data);
    if (!data || !data.result) return;

    var resultCd = data.result.resultCd;
    var msg = data.result.advanceMsg || data.result.resultMsg || "";

    if (resultCd === "0000") {
      var trackId =
        (data.pay && data.pay.trackId) ? data.pay.trackId : getURLParam("order_no");
      location.href =
        getRedirectUrl(CONFIG.PATHS.SUCCESS) + "?status=success&trackId=" + trackId;
    } else {
      location.href =
        getRedirectUrl(CONFIG.PATHS.CANCEL) + "?msg=" + encodeURIComponent(msg);
    }
  };

  // ----------------------------
  // /shop_payment
  // ----------------------------
  function handleShopPayment() {
    console.log(LOG_PREFIX + "Routing: Order Info Page");

    function saveState(source, overrideMethod) {
      const itemNameEl =
        document.querySelector(".css-a0a2v3") || document.querySelector("._product_name");
      const qtyEl =
        document.querySelector(".css-15fzge") || document.querySelector("._product_qty");

      const itemName = itemNameEl ? itemNameEl.innerText.trim() : "상품";
      const qty = qtyEl ? qtyEl.innerText.replace(/[^0-9]/g, "") : "1";
      const amount = getAmountSmart();

      const method = overrideMethod
        ? overrideMethod
        : (localStorage.getItem("payMethod") === "CreditCard" ? "CREDIT" : "BANK");

      const data = {
        orderNo: getURLParam("order_no") || ("ORD-" + Date.now()),
        amount,
        itemName,
        qty,
        method,
        savedAt: Date.now(),
        source,
      };

      localStorage.setItem("fintree_pay_data", JSON.stringify(data));
      console.log(LOG_PREFIX + "Saved fintree_pay_data:", data);
      return data;
    }

    // 버튼 UI 주입(기존 구조 유지)
    function injectUI() {
      const checkInterval = setInterval(() => {
        const headers = Array.from(
          document.querySelectorAll("header, h2, h3, .title, .css-17g8nhj")
        );
        const paymentHeader = headers.find((h) => h.innerText.includes("결제수단"));
        if (!paymentHeader) return;

        const paymentSection =
          paymentHeader.closest('div[class*="css-"]') ||
          paymentHeader.closest(".pay-method-section") ||
          paymentHeader.parentElement;
        if (!paymentSection) return;

        if (paymentSection.querySelector(".pay-method-custom")) {
          clearInterval(checkInterval);
          return;
        }

        const custom = document.createElement("div");
        custom.className = "pay-method-custom";
        custom.innerHTML = `
          <style>
            .pay-method-custom{display:flex; flex-direction:column; gap:12px; margin:12px 0;}
            .pay-method-buttons{display:flex; gap:10px;}
            .pay-method-custom button{flex:1; padding:14px; border:1px solid #ddd; border-radius:10px; background:#fff; font-weight:700;}
            .pay-method-custom button.active{background:#333; color:#fff; border-color:#333;}
            .pay-guide-text{font-size:13px; color:#666; line-height:1.5;}
          </style>
          <div class="pay-guide-text">
            * 아래 버튼을 눌러 결제수단을 선택해주세요.
          </div>
          <div class="pay-method-buttons">
            <button type="button" data-method="CREDIT" class="active">💳 카드결제</button>
            <button type="button" data-method="BANK">🏦 무통장입금</button>
          </div>
        `;
        paymentHeader.insertAdjacentElement("afterend", custom);

        const btns = custom.querySelectorAll("button");
        btns.forEach((b) => {
          b.addEventListener("click", (e) => {
            btns.forEach(x => x.classList.remove("active"));
            e.target.classList.add("active");

            const m = e.target.getAttribute("data-method");
            localStorage.setItem("payMethod", m === "CREDIT" ? "CreditCard" : "BankTransfer");
            saveState("PayMethod Click", m);
          });
        });

        clearInterval(checkInterval);
      }, 500);
    }

    window.addEventListener("load", function () {
      injectUI();

      // 결제하기 버튼 눌릴 때 저장
      document.addEventListener("click", function (e) {
        const btn = e.target.closest('button[type="submit"], ._btn_payment, .css-1tf84sl, .css-clap0e');
        if (btn && btn.innerText.includes("결제하기")) {
          saveState("Before Submit");
        }
      }, true);

      // 주기 저장
      setInterval(() => {
        if (pathMatches(CONFIG.PATHS.INFO)) saveState("Heartbeat");
      }, 1500);
    });
  }

  // ----------------------------
  // /shop_payment_complete
  // ----------------------------
  function handleShopPaymentComplete() {
    console.log(LOG_PREFIX + "Routing: Auth/Confirmation Page");

    window.addEventListener("load", function () {
      let stored = null;
      try {
        stored = JSON.parse(localStorage.getItem("fintree_pay_data"));
      } catch (e) {}

      const trackId = getURLParam("order_no") || (stored ? stored.orderNo : "");
      let amount = (stored && stored.amount) ? String(stored.amount) : "0";

      // ✅ 여기서 강제 재추출 (네 콘솔의 1040000 JPY를 잡는 핵심)
      if (!amount || amount === "0") {
        amount = getAmountSmart();
        console.log(LOG_PREFIX + "Amount recovered on complete page =>", amount);
      }

      // itemName
      let itemName = stored && stored.itemName ? stored.itemName : "상품";
      let qty = stored && stored.qty ? parseInt(stored.qty, 10) : 1;
      if (itemName.length > 20) itemName = itemName.slice(0, 20) + "...";
      itemName = itemName + (qty > 1 ? ` 외 ${qty - 1}건` : "");

      const params = {
        trackId,
        amount,
        userName: (stored && stored.userName) ? stored.userName : "",
        userTel: (stored && stored.userTel) ? stored.userTel : "",
        userEmail: (stored && stored.userEmail) ? stored.userEmail : "",
        itemName,
      };

      console.log(LOG_PREFIX + "Final params:", params);

      if (!params.amount || String(params.amount) === "0") {
        alert(
          "결제금액을 읽지 못해서 결제를 진행할 수 없습니다. (amount=0)\n" +
          "콘솔에 찍힌 'Amount from selector / dataLayer / text scan' 로그 캡처를 보내주세요."
        );
        console.error(LOG_PREFIX + "Blocked: amount=0", params);
        return;
      }

      // CREDIT 의도면 자동 실행
      const intent = stored && stored.method ? stored.method : "BANK";
      if (intent === "CREDIT") {
        createLoadingOverlay();
        executePay(params);
      } else {
        console.log(LOG_PREFIX + "Not CREDIT intent. (BANK flow)");
      }
    });
  }

  // ----------------------------
  // /payment-success
  // ----------------------------
  function handlePaymentSuccess() {
    console.log(LOG_PREFIX + "Routing: Result Page");
  }

  function handlePaymentCancel() {
    console.log(LOG_PREFIX + "Routing: Cancel Page");
  }

  function handlePaymentRefund() {
    console.log(LOG_PREFIX + "Routing: Refund Page");
  }

  // Router
  function initRouter() {
    if (pathMatches(CONFIG.PATHS.INFO)) handleShopPayment();
    else if (pathMatches(CONFIG.PATHS.CONFIRM)) handleShopPaymentComplete();
    else if (pathMatches(CONFIG.PATHS.SUCCESS)) handlePaymentSuccess();
    else if (pathMatches(CONFIG.PATHS.CANCEL)) handlePaymentCancel();
    else if (pathMatches(CONFIG.PATHS.REFUND)) handlePaymentRefund();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initRouter);
  } else {
    initRouter();
  }
})();
