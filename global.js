/**
 * Fintree Payment Universal Script (Netlify Hosted)
 * - Imweb shop_payment / shop_payment_complete 자동 라우팅
 * - MARU SDK( clientsidV2.js )가 없으면 자동 로드 후 결제 실행
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
        "Script blocked: Domain not allowed (" +
        location.hostname +
        ")"
    );
    return;
  }

  // --- Hosted domain detect ---
  let hostedDomain = "https://bagdown-payment.netlify.app";
  try {
    if (document.currentScript && document.currentScript.src) {
      hostedDomain = new URL(document.currentScript.src).origin;
    }
  } catch (e) {}

  const CONFIG = {
    PUBLIC_KEY: "pk_1fc0-d72bd2-31f-a22a1",
    TID: "TMN009875",
    HOSTED_DOMAIN: hostedDomain,
    VERIFY_API: "/api/verify",
    SDK_URL: "https://api.ghpayments.kr/js/clientsideV2.js",
    PATHS: {
      INFO: "/shop_payment",
      CONFIRM: "/shop_payment_complete",
      SUCCESS: "/payment-success",
      CANCEL: "/payment-cancel",
      REFUND: "/payment-refund",
    },
  };

  console.log(LOG_PREFIX + "Loaded. host:", location.hostname, "path:", location.pathname);

  // --- Utils ---
  function pathMatches(targetPath) {
    const p = location.pathname;
    return (
      p === targetPath ||
      p === targetPath + "/" ||
      p === targetPath + ".html" ||
      p.endsWith(targetPath + ".html")
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
      <div style="font-weight:600; font-size:16px; color:#333;">결제창을 준비 중입니다...</div>
    `;
    document.body.appendChild(overlay);
  }

  // ✅ 핵심: MARU SDK가 없으면 자동 로드
  function ensureMaruReady() {
    return new Promise((resolve, reject) => {
      try {
        if (window.MARU && typeof window.MARU.pay === "function") {
          console.log(LOG_PREFIX + "MARU already ready.");
          return resolve();
        }

        // 이미 로딩중인 경우
        if (window.__FNT_MARU_LOADING__) {
          console.log(LOG_PREFIX + "MARU loading in progress... wait.");
          const t0 = Date.now();
          const timer = setInterval(() => {
            if (window.MARU && typeof window.MARU.pay === "function") {
              clearInterval(timer);
              return resolve();
            }
            if (Date.now() - t0 > 15000) {
              clearInterval(timer);
              return reject(new Error("MARU load timeout"));
            }
          }, 200);
          return;
        }

        window.__FNT_MARU_LOADING__ = true;
        console.log(LOG_PREFIX + "Loading MARU SDK:", CONFIG.SDK_URL);

        const s = document.createElement("script");
        s.src = CONFIG.SDK_URL;
        s.async = true;
        s.onload = () => {
          window.__FNT_MARU_LOADING__ = false;
          if (window.MARU && typeof window.MARU.pay === "function") {
            console.log(LOG_PREFIX + "MARU SDK loaded OK.");
            resolve();
          } else {
            reject(new Error("SDK loaded but MARU.pay not found"));
          }
        };
        s.onerror = () => {
          window.__FNT_MARU_LOADING__ = false;
          reject(new Error("Failed to load MARU SDK"));
        };
        document.head.appendChild(s);
      } catch (e) {
        reject(e);
      }
    });
  }

  function executePay(params) {
    console.log(LOG_PREFIX + "executePay params:", params);

    createLoadingOverlay();

    ensureMaruReady()
      .then(() => {
        console.log(LOG_PREFIX + "Calling MARU.pay ...");
        window.MARU.pay({
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
      })
      .catch((err) => {
        console.error(LOG_PREFIX + "Payment failed before opening layer:", err);
        alert("결제 모듈 로드에 실패했습니다. (SDK 미로딩/차단)\nNetwork에서 clientsideV2.js가 200인지 확인해주세요.");
        // overlay 제거
        const ov = document.getElementById("fnt-loading-overlay");
        if (ov) ov.remove();
      });
  }

  window.paymentResultByJS = function (data) {
    console.log(LOG_PREFIX + "SDK Callback:", data);
    if (!data || !data.result) return;

    const resultCd = data.result.resultCd;
    const msg = data.result.advanceMsg || data.result.resultMsg || "";

    if (resultCd === "0000") {
      const trackId =
        (data.pay && data.pay.trackId) ? data.pay.trackId : (getURLParam("order_no") || "");
      location.href = getRedirectUrl(CONFIG.PATHS.SUCCESS) + "?status=success&trackId=" + encodeURIComponent(trackId);
    } else {
      location.href = getRedirectUrl(CONFIG.PATHS.CANCEL) + "?msg=" + encodeURIComponent(msg);
    }
  };

  // ---- Data Save (shop_payment 단계) ----
  function savePayData(methodOverride) {
    // amount / itemName 찾기 (너 코드 유지)
    const itemNameEl = document.querySelector(".css-a0a2v3") || document.querySelector("._product_name");
    const qtyEl = document.querySelector(".css-15fzge") || document.querySelector("._product_qty");
    const totalAmountEl =
      document.querySelector(".css-x99dng") ||
      document.querySelector(".css-z3pbio") ||
      document.querySelector(".css-1i1erzf") ||
      document.querySelector("._total_price") ||
      document.querySelector(".total_price");

    const itemName = itemNameEl ? itemNameEl.innerText.trim() : "상품";
    const qty = qtyEl ? qtyEl.innerText.replace(/[^0-9]/g, "") : "1";
    const totalAmount = totalAmountEl ? totalAmountEl.innerText.replace(/[^0-9]/g, "") : "0";

    // 주문자 정보 (입력 or 텍스트 fallback)
    let ordererName = document.querySelector('input[name="ordererName"]')?.value || "";
    let ordererTel = document.querySelector('input[name="ordererCall"]')?.value || "";
    let ordererEmail = document.querySelector('input[name="ordererEmail"]')?.value || "";

    const method = methodOverride || (localStorage.getItem("payMethod") === "CreditCard" ? "CREDIT" : "BANK");

    const orderNoFromUrl = getURLParam("order_no");
    const paymentData = {
      orderNo: orderNoFromUrl || ("ORD-" + Date.now()),
      amount: totalAmount,
      userName: ordererName,
      userTel: ordererTel,
      userEmail: ordererEmail,
      itemName: itemName,
      qty: qty,
      method: method,
    };

    localStorage.setItem("fintree_pay_data", JSON.stringify(paymentData));
    console.log(LOG_PREFIX + "Saved fintree_pay_data:", paymentData);
    return paymentData;
  }

  // ---- Page: /shop_payment ----
  function handleShopPayment() {
    console.log(LOG_PREFIX + "Routing: shop_payment");

    // ✅ 카드/무통장 버튼 클릭 시 의도 저장만 확실히
    function injectCustomPaymentUI() {
      const checkInterval = setInterval(() => {
        const headers = Array.from(document.querySelectorAll("header, h2, h3, .title, .css-17g8nhj"));
        const paymentHeader = headers.find((h) => (h.innerText || "").includes("결제수단"));
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

        const customUI = document.createElement("div");
        customUI.className = "pay-method-custom";
        customUI.innerHTML = `
          <style>
            .pay-method-custom { display:flex; flex-direction:column; gap:15px; margin:15px 0; }
            .pay-method-buttons { display:flex; gap:10px; }
            .pay-method-custom button {
              flex:1; padding:15px; border:1px solid #ddd; border-radius:8px; background:#fff;
              font-weight:bold; cursor:pointer; font-size:16px;
            }
            .pay-method-custom button.active { border-color:#333; background:#333; color:#fff; }
            .pay-guide-text { font-size:13px; color:#666; margin-bottom:5px; line-height:1.5; }
          </style>
          <div class="pay-guide-text">
            * 아래 버튼을 눌러 결제수단을 선택해주세요.<br>
            * 카드결제 오류 시 고객센터로 문의주세요.
          </div>
          <div class="pay-method-buttons">
            <button type="button" data-method="CREDIT" class="active">💳 카드결제</button>
            <button type="button" data-method="BANK">🏦 무통장입금</button>
          </div>
        `;

        paymentHeader.insertAdjacentElement("afterend", customUI);

        const buttons = customUI.querySelectorAll("button");
        buttons.forEach((btn) => {
          btn.addEventListener("click", () => {
            const m = btn.getAttribute("data-method");
            buttons.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");

            if (m === "CREDIT") localStorage.setItem("payMethod", "CreditCard");
            else localStorage.setItem("payMethod", "BankTransfer");

            // ✅ 선택 즉시 저장 (중요)
            savePayData(m);
            console.log(LOG_PREFIX + "payMethod selected:", m);
          });
        });

        // 초기 저장
        localStorage.setItem("payMethod", "CreditCard");
        savePayData("CREDIT");

        clearInterval(checkInterval);
        console.log(LOG_PREFIX + "Custom UI injected.");
      }, 400);
    }

    // 결제하기 클릭할 때 최신 저장
    document.addEventListener(
      "click",
      function (e) {
        const btn = e.target.closest('button[type="submit"], ._btn_payment, .css-1tf84sl, .css-clap0e');
        if (btn && (btn.innerText || "").includes("결제하기")) {
          const m = localStorage.getItem("payMethod") === "CreditCard" ? "CREDIT" : "BANK";
          savePayData(m);
          console.log(LOG_PREFIX + "결제하기 clicked. saved method:", m);
        }
      },
      true
    );

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", injectCustomPaymentUI);
    } else {
      injectCustomPaymentUI();
    }
  }

  // ---- Page: /shop_payment_complete ----
  function handleShopPaymentComplete() {
    console.log(LOG_PREFIX + "Routing: shop_payment_complete");

    window.addEventListener("load", function () {
      let stored = null;
      try {
        stored = JSON.parse(localStorage.getItem("fintree_pay_data"));
      } catch (e) {}

      console.log(LOG_PREFIX + "stored fintree_pay_data:", stored);

      // ✅ 여기서 stored.method가 CREDIT이면 바로 결제창 띄움
      if (stored && stored.method === "CREDIT") {
        const params = {
          trackId: getURLParam("order_no") || stored.orderNo || ("ORD-" + Date.now()),
          amount: stored.amount || "0",
          userName: stored.userName || "",
          userTel: stored.userTel || "",
          userEmail: stored.userEmail || "",
          itemName: (stored.itemName || "상품").substring(0, 30),
        };

        console.log(LOG_PREFIX + "CREDIT intent detected -> open payment layer now");
        executePay(params);
        return;
      }

      console.log(LOG_PREFIX + "Not CREDIT intent. (BANK flow)");
    });
  }

  // ---- Router ----
  function initRouter() {
    if (pathMatches(CONFIG.PATHS.INFO)) {
      handleShopPayment();
    } else if (pathMatches(CONFIG.PATHS.CONFIRM)) {
      handleShopPaymentComplete();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initRouter);
  } else {
    initRouter();
  }
})();
