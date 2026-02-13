/**
 * Fintree Payment Universal Script (Netlify Hosted)
 * Combined with Payment Induction & Server-side Verification
 * PATCH: robust money parsing + amount fallback on complete page + block if amount=0
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
  // ---------------------------

  console.log(
    LOG_PREFIX + "Initialized. Protocol:",
    location.protocol,
    "Path:",
    location.pathname
  );

  // --- Configurations ---
  let hostedDomain = "https://bagdown-payment.netlify.app"; // default
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

  // --- Helper Functions ---
  function waitForData(selectors, callback, maxRetries = 10) {
    let retries = 0;
    const interval = setInterval(() => {
      let found = null;
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim().length > 0) {
          found = el;
          break;
        }
      }
      if (found || retries >= maxRetries) {
        clearInterval(interval);
        callback(found);
      }
      retries++;
    }, 500);
  }

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

  // ✅ PATCH: robust money parsing (JPY/KRW etc.)
  function parseMoney(text) {
    if (!text) return "0";
    const n = String(text).replace(/[^\d]/g, "");
    return n && n.length ? n : "0";
  }

  // --- Shared Payment Logic ---
  function createLoadingOverlay() {
    if (document.getElementById("fnt-loading-overlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "fnt-loading-overlay";
    overlay.style.cssText =
      "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(255,255,255,1); z-index:9998; display:flex; flex-direction:column; align-items:center; justify-content:center; font-family:sans-serif; transition: opacity 0.5s;";
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
    console.log(LOG_PREFIX + "Initiating MARU.pay (Direct)", params);

    // ✅ BLOCK if amount invalid
    if (!params || !params.amount || String(params.amount) === "0") {
      alert("결제금액(amount)을 읽지 못해 결제를 진행할 수 없습니다. (amount=0)\n결제금액 표시 영역 캡처를 보내주세요.");
      console.error(LOG_PREFIX + "Blocked: amount is 0", params);
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
    }, 300);
  }

  window.paymentResultByJS = function (data) {
    console.log(LOG_PREFIX + "SDK Callback Data Received:", data);
    if (!data || !data.result) return;

    var resultCd = data.result.resultCd;
    var resultMsg = data.result.resultMsg || "";
    var advanceMsg = data.result.advanceMsg || resultMsg;

    if (resultCd === "0000") {
      var trackId =
        data.pay && data.pay.trackId ? data.pay.trackId : getURLParam("order_no");
      console.log(LOG_PREFIX + "Payment Success! Redirecting to Result Page...");
      location.href =
        getRedirectUrl(CONFIG.PATHS.SUCCESS) + "?status=success&trackId=" + trackId;
    } else {
      console.warn(
        LOG_PREFIX + "Payment Failed/Cancelled. Code:",
        resultCd,
        "Msg:",
        advanceMsg
      );
      location.href =
        getRedirectUrl(CONFIG.PATHS.CANCEL) + "?msg=" + encodeURIComponent(advanceMsg);
    }
  };

  // ----------------------------
  // 1) /shop_payment (Order Info)
  // ----------------------------
  function handleShopPayment() {
    console.log(LOG_PREFIX + "Routing: Order Info Page");

    function injectCustomPaymentUI() {
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

        const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
        const bankRadio = radios.find((r) => r.value && r.value.includes("OPM01"));
        if (!bankRadio) return;

        if (!bankRadio.checked) bankRadio.click();

        let depositorBlock = document.querySelector(".css-1hw29i9");
        if (!depositorBlock) {
          const input =
            document.querySelector('input[placeholder*="입금자명"]') ||
            document.querySelector('input[name="depositor"]');
          if (input) {
            depositorBlock = input.closest("div") || input.parentElement;
            if (depositorBlock && depositorBlock.tagName === "LABEL")
              depositorBlock = depositorBlock.parentElement;
          }
        }

        console.log(LOG_PREFIX + "Depositor Block found for extraction:", depositorBlock);

        const customUI = document.createElement("div");
        customUI.className = "pay-method-custom";
        customUI.innerHTML = `
          <style>
            .pay-method-custom { display:flex; flex-direction:column; gap:15px; margin:15px 0; }
            .pay-method-buttons { display:flex; gap:10px; }
            .pay-method-custom button{
              flex:1; padding:15px; border:1px solid #ddd; border-radius:8px;
              background:#fff; font-weight:bold; cursor:pointer; font-size:16px;
            }
            .pay-method-custom button.active{ border-color:#333; background:#333; color:#fff; }
            .pay-guide-text{ font-size:13px; color:#666; margin-bottom:5px; line-height:1.5; }
            .moved-depositor-block{ margin-top:10px; padding:10px; border:1px solid #eee; border-radius:4px; background:#fafafa; }
          </style>
          <div class="pay-guide-text">
            * 아래 버튼을 눌러 결제수단을 선택해주세요.<br>
            * 카드결제 오류 시 고객센터로 문의주세요.
          </div>
          <div class="pay-method-buttons">
            <button type="button" data-method="CREDIT" class="active">💳 카드결제</button>
            <button type="button" data-method="BANK">🏦 무통장입금</button>
          </div>
          <div id="fnt-depositor-area"></div>
        `;

        paymentHeader.insertAdjacentElement("afterend", customUI);

        if (depositorBlock) {
          depositorBlock.classList.add("moved-depositor-block");
          customUI.querySelector("#fnt-depositor-area").appendChild(depositorBlock);
        }

        const fieldset = bankRadio.closest("fieldset");
        if (fieldset) fieldset.style.display = "none";

        const buttons = customUI.querySelectorAll("button");
        const bankSelect = document.querySelector('select[name^="cash_idx"]');
        const depositorInput =
          customUI.querySelector('input[placeholder*="입금자명"]') ||
          customUI.querySelector('input[name="depositor"]');

        function updatePaymentState(method) {
          console.log(LOG_PREFIX + "updatePaymentState:", method, depositorBlock);

          const stateMethod = method === "CREDIT" ? "CreditCard" : "BankTransfer";
          localStorage.setItem("payMethod", stateMethod);

          if (depositorBlock) {
            if (method === "CREDIT") {
              depositorBlock.style.display = "none";
              if (depositorInput) depositorInput.value = "카드결제";
            } else {
              depositorBlock.style.display = "flex";
              depositorBlock.style.flexDirection = "column";
              depositorBlock.style.gap = "8px";
              if (depositorInput && depositorInput.value === "카드결제") depositorInput.value = "";
            }
          } else if (depositorInput) {
            depositorInput.style.display = method === "CREDIT" ? "none" : "block";
          }

          if (bankSelect) {
            if (bankSelect.options.length > 1) {
              const index = method === "CREDIT" ? 0 : 1;
              if (bankSelect.options.length > index) {
                bankSelect.selectedIndex = index;
                bankSelect.dispatchEvent(new Event("change", { bubbles: true }));
              }
            }
          }
        }

        updatePaymentState("CREDIT");

        buttons.forEach((btn) => {
          btn.addEventListener("click", (e) => {
            const method = e.target.getAttribute("data-method");
            buttons.forEach((b) => b.classList.remove("active"));
            e.target.classList.add("active");
            updatePaymentState(method);

            // ✅ when user selects CREDIT/BANK, save immediately
            saveCurrentState("PayMethod Click", method);
          });
        });

        console.log(LOG_PREFIX + "Custom Payment UI Injected & Block Extracted");
        clearInterval(checkInterval);
      }, 500);
    }

    function saveCurrentState(source = "Manual", overrideMethod = null) {
      let ordererName = document.querySelector('input[name="ordererName"]')?.value || "";
      let ordererTel = document.querySelector('input[name="ordererCall"]')?.value || "";
      let ordererEmail = document.querySelector('input[name="ordererEmail"]')?.value || "";

      const itemNameEl =
        document.querySelector(".css-a0a2v3") || document.querySelector("._product_name");
      const qtyEl =
        document.querySelector(".css-15fzge") || document.querySelector("._product_qty");
      const totalAmountEl =
        document.querySelector(".css-x99dng") ||
        document.querySelector(".css-z3pbio") ||
        document.querySelector(".css-1i1erzf") ||
        document.querySelector("._total_price") ||
        document.querySelector(".total_price");

      const itemName = itemNameEl ? itemNameEl.innerText.trim() : "상품";
      const qty = qtyEl ? qtyEl.innerText.replace(/[^0-9]/g, "") : "1";
      const totalAmount = totalAmountEl ? parseMoney(totalAmountEl.innerText) : "0";

      let method = overrideMethod;
      if (!method) {
        const uiState = localStorage.getItem("payMethod");
        if (uiState === "CreditCard") method = "CREDIT";
        else if (uiState === "BankTransfer") method = "BANK";
        else {
          const activeBtn = document.querySelector(".pay-method-custom button.active");
          method = activeBtn ? activeBtn.getAttribute("data-method") : "BANK";
        }
      }

      const urlOrderNo = getURLParam("order_no");
      const paymentData = {
        orderNo: urlOrderNo || "ORD-" + new Date().getTime(),
        amount: totalAmount, // ✅ key
        userName: ordererName,
        userTel: ordererTel,
        userEmail: ordererEmail,
        itemName: itemName,
        qty: qty,
        method: method,
        savedAt: Date.now(),
        source: source,
      };

      // ✅ store even if amount is 0, so we can debug
      localStorage.setItem("fintree_pay_data", JSON.stringify(paymentData));
      console.log(LOG_PREFIX + `Saved fintree_pay_data [${source}] [${method}]:`, paymentData);

      return paymentData;
    }

    window.addEventListener("load", function () {
      const inputNames = ["ordererName", "ordererCall", "ordererEmail"];
      inputNames.forEach((name) => {
        const el = document.querySelector(`input[name="${name}"]`);
        if (el) el.addEventListener("input", () => saveCurrentState("Input Event"));
      });

      // ✅ periodic save on order page
      setInterval(() => {
        if (pathMatches(CONFIG.PATHS.INFO)) saveCurrentState("Background Timer");
      }, 1500);

      // ✅ capture click "결제하기" and save right before submit
      document.addEventListener(
        "click",
        function (e) {
          const btn = e.target.closest(
            'button[type="submit"], ._btn_payment, .css-1tf84sl, .css-clap0e'
          );
          if (btn && btn.innerText.includes("결제하기")) {
            console.log(LOG_PREFIX + "Payment button clicked. Saving state before submit.");
            saveCurrentState("Before Submit");

            try {
              const stored = JSON.parse(localStorage.getItem("fintree_pay_data"));
              if (stored && stored.method === "CREDIT") {
                console.log(LOG_PREFIX + "Stored intent: CREDIT");
              } else {
                console.log(LOG_PREFIX + "Stored intent: BANK or undefined");
              }
            } catch (e) {}
            return true;
          }
        },
        true
      );
    });

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", injectCustomPaymentUI);
    } else {
      injectCustomPaymentUI();
    }

    // extra periodic save (safe)
    setInterval(() => {
      if (pathMatches(CONFIG.PATHS.INFO)) saveCurrentState("Heartbeat");
    }, 2000);
  }

  // ---------------------------------
  // 2) /shop_payment_complete (Confirm)
  // ---------------------------------
  function handleShopPaymentComplete() {
    console.log(LOG_PREFIX + "Routing: Auth/Confirmation Page");

    function startButtonWatcher(p) {
      const observer = new MutationObserver((mutations, obs) => {
        const container = document.querySelector(".css-k008qs");
        if (container && !document.querySelector(".pay-button-fintree")) {
          const btn = document.createElement("a");
          btn.href = "javascript:void(0)";
          btn.className = "pay-button css-fi2s5q pay-button-fintree";
          btn.innerText = "신용카드";
          btn.onclick = function (e) {
            e.preventDefault();
            createLoadingOverlay();
            executePay(p);
          };
          container.appendChild(btn);
          obs.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    // ✅ PATCH: fallback amount detection on complete page
    function findAmountOnPageFallback() {
      const candidates = [
        ".css-x99dng",
        ".css-z3pbio",
        ".css-1i1erzf",
        "._total_price",
        ".total_price",
        "[data-total-price]",
      ];
      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el && el.innerText) {
          const v = parseMoney(el.innerText);
          if (v && v !== "0") return v;
        }
      }
      return "0";
    }

    window.addEventListener("load", function () {
      let params = {
        trackId: getURLParam("order_no"),
        amount: "0",
        userName: "",
        userTel: "",
        userEmail: "",
        itemName: "상품",
      };

      try {
        var stored = JSON.parse(localStorage.getItem("fintree_pay_data"));
        if (stored) {
          if (!params.trackId) params.trackId = stored.orderNo;
          params.amount = stored.amount || "0";
          params.userName = stored.userName || "";
          params.userTel = stored.userTel || "";
          params.userEmail = stored.userEmail || "";

          var baseName = stored.itemName || "상품";
          if (baseName.length > 20) baseName = baseName.substring(0, 20) + "...";
          const qtyNum = parseInt(stored.qty || "1", 10);
          params.itemName = baseName + (qtyNum > 1 ? " 외 " + (qtyNum - 1) + "건" : "");

          if (params.trackId && params.trackId !== stored.orderNo) {
            console.log(LOG_PREFIX + "Updating localStorage orderNo:", stored.orderNo, "->", params.trackId);
            stored.orderNo = params.trackId;
            localStorage.setItem("fintree_pay_data", JSON.stringify(stored));
          }
        }
      } catch (e) {
        console.error(LOG_PREFIX + "Storage Parse Error", e);
      }

      // ✅ amount fallback
      if (!params.amount || String(params.amount) === "0") {
        const fallback = findAmountOnPageFallback();
        console.log(LOG_PREFIX + "Fallback amount from page:", fallback);
        params.amount = fallback;
      }

      // ✅ hard block if still 0
      if (!params.amount || String(params.amount) === "0") {
        alert(
          "결제금액을 읽지 못해서 결제를 진행할 수 없습니다. (amount=0)\n" +
            "1) /shop_payment 페이지에서 결제금액 표시 부분 캡처를 보내주세요.\n" +
            "2) 콘솔에서 Saved fintree_pay_data 로그의 amount 값도 함께 보내주세요."
        );
        console.error(LOG_PREFIX + "Blocked on complete page: amount=0", params);
        return;
      }

      console.log(LOG_PREFIX + "Params for executePay:", params);

      // create button always (safe)
      startButtonWatcher(params);

      // auto-launch only if CREDIT intent
      try {
        const stored2 = JSON.parse(localStorage.getItem("fintree_pay_data"));
        if (stored2 && stored2.method === "CREDIT") {
          console.log(LOG_PREFIX + "Detected CREDIT intent. Launching payment...");
          createLoadingOverlay();
          executePay(params);
        } else {
          console.log(LOG_PREFIX + "Not CREDIT intent. Waiting for user click.");
        }
      } catch (e) {}
    });
  }

  // ---------------------------
  // 3) /payment-success (Result)
  // ---------------------------
  function handlePaymentSuccess() {
    console.log(LOG_PREFIX + "Routing: Result Page");

    function parseSDKResult() {
      try {
        const resultParam = getURLParam("result");
        if (resultParam) {
          let cleaned = resultParam;
          if (cleaned.startsWith('"') && cleaned.endsWith('"')) cleaned = cleaned.slice(1, -1);
          cleaned = cleaned.replace(/\\"/g, '"');
          const parsed = JSON.parse(cleaned);
          console.log(LOG_PREFIX + "SDK Result parsed from URL:", parsed);
          return parsed;
        }
      } catch (e) {
        console.warn(LOG_PREFIX + "Failed to parse SDK result param:", e);
      }
      return null;
    }

    async function verifyPayment() {
      const status = getURLParam("status");
      let trackId = getURLParam("trackId");
      let trxId = null;
      let sdkResult = null;

      sdkResult = parseSDKResult();
      if (sdkResult && sdkResult.pay) {
        if (!trackId && sdkResult.pay.trackId) trackId = sdkResult.pay.trackId;
        if (sdkResult.pay.trxId) trxId = sdkResult.pay.trxId;
      }

      if (!trackId) {
        try {
          const stored = JSON.parse(localStorage.getItem("fintree_pay_data"));
          if (stored && stored.orderNo) trackId = stored.orderNo;
        } catch (e) {}
      }

      let isSuccess = false;
      if (sdkResult && sdkResult.result && sdkResult.result.resultCd === "0000") isSuccess = true;
      else if (status === "success" && trackId) isSuccess = true;

      if (isSuccess) {
        console.log(LOG_PREFIX + "Payment confirmed. Background verify call...");

        try {
          let verifyParams = new URLSearchParams();
          if (trackId) verifyParams.append("trackId", trackId);
          if (trxId) verifyParams.append("trxId", trxId);

          try {
            const stored = JSON.parse(localStorage.getItem("fintree_pay_data"));
            if (stored) {
              if (stored.userName) verifyParams.append("userName", stored.userName);
              if (stored.userTel) verifyParams.append("userTel", stored.userTel);
              if (stored.userEmail) verifyParams.append("userEmail", stored.userEmail);
            }
          } catch (e) {}

          fetch(`${CONFIG.HOSTED_DOMAIN}${CONFIG.VERIFY_API}?${verifyParams.toString()}`)
            .then((r) => r.json())
            .then((data) => console.log(LOG_PREFIX + "Verify API (background):", data.result))
            .catch((err) => console.warn(LOG_PREFIX + "Verify API background error (ignored):", err.message));
        } catch (e) {
          console.warn(LOG_PREFIX + "Background verify call failed (ignored):", e.message);
        }
      } else {
        let failMsg = "결제가 완료되지 않았습니다.";
        if (sdkResult && sdkResult.result && sdkResult.result.advanceMsg) failMsg = sdkResult.result.advanceMsg;
        else if (status === "fail") failMsg = getURLParam("msg") || failMsg;

        console.warn(LOG_PREFIX + "Payment not successful:", failMsg);
        location.href = getRedirectUrl(CONFIG.PATHS.CANCEL) + "?msg=" + encodeURIComponent(failMsg);
      }
    }

    window.addEventListener("load", verifyPayment);
  }

  function handlePaymentCancel() {
    console.log(LOG_PREFIX + "Routing: Cancel Page");
  }

  function handlePaymentRefund() {
    console.log(LOG_PREFIX + "Routing: Refund Page");
  }

  // --- Boot (Routing) ---
  function initRouter() {
    if (pathMatches(CONFIG.PATHS.INFO)) {
      handleShopPayment();
    } else if (pathMatches(CONFIG.PATHS.CONFIRM)) {
      handleShopPaymentComplete();
    } else if (pathMatches(CONFIG.PATHS.SUCCESS)) {
      handlePaymentSuccess();
    } else if (pathMatches(CONFIG.PATHS.CANCEL)) {
      handlePaymentCancel();
    } else if (pathMatches(CONFIG.PATHS.REFUND)) {
      handlePaymentRefund();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initRouter);
  } else {
    initRouter();
  }
})();
