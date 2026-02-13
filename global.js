/**
 * Fintree Payment Universal Script (Netlify Hosted)
 * - Imweb payment flow hijack (BANK order creation -> card pay on complete page)
 * - MARU.pay layer mode
 * - Production hardened: redirectUrl fixed, amount numeric, MARU load wait
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

  // --- Hosted domain auto-detect (IMPORTANT) ---
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
    const isLocal =
      location.pathname.endsWith(".html") || location.protocol === "file:";
    return targetPath + (isLocal ? ".html" : "");
  }

  function getURLParam(name) {
    const results = new RegExp("[\\?&]" + name + "=([^&#]*)").exec(location.search);
    return results === null
      ? ""
      : decodeURIComponent(results[1].replace(/\+/g, " "));
  }

  function createLoadingOverlay() {
    if (document.getElementById("fnt-loading-overlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "fnt-loading-overlay";
    overlay.style.cssText =
      "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(255,255,255,1); z-index:9998; display:flex; flex-direction:column; align-items:center; justify-content:center; font-family:sans-serif; transition: opacity 0.5s;";

    const style = document.createElement("style");
    style.innerHTML = `
      @keyframes fnt-spin { to { transform: rotate(360deg); } }
      .fnt-spinner { width:45px; height:45px; border:4px solid #f3f3f3; border-top-color:#000; border-radius:50%; animation:fnt-spin 1s linear infinite; margin-bottom:20px; }
    `;
    document.head.appendChild(style);

    overlay.innerHTML = `
      <div class="fnt-spinner"></div>
      <div style="font-weight:600; font-size:16px; color:#333;">결제 시스템을 불러오고 있습니다...</div>
    `;
    document.body.appendChild(overlay);
  }

  // ✅ 핵심 수정: MARU 로드 대기 + redirectUrl HOSTED_DOMAIN + amount 숫자 보장
  function executePay(params) {
    console.log(LOG_PREFIX + "Initiating MARU.pay (Layer)", params);

    const safeAmount = Number(params.amount || 0);

    let tries = 0;
    const timer = setInterval(() => {
      tries++;

      if (typeof MARU !== "undefined" && typeof MARU.pay === "function") {
        clearInterval(timer);

        const redirectUrl = CONFIG.HOSTED_DOMAIN + getRedirectUrl(CONFIG.PATHS.SUCCESS);
        console.log(LOG_PREFIX + "redirectUrl ->", redirectUrl);

        try {
          MARU.pay({
            payRoute: "3d",
            responseFunction: window.paymentResultByJS,
            publicKey: CONFIG.PUBLIC_KEY,
            trackId: params.trackId,
            amount: safeAmount,
            redirectUrl: redirectUrl,
            itemName: params.itemName,
            userEmail: params.userEmail,
            userName: params.userName,
            userTel: params.userTel,
            mode: "layer",
            // debugMode 제거(운영 안정)
          });
        } catch (e) {
          console.error(LOG_PREFIX + "MARU.pay threw error:", e);
          alert("결제 실행 중 오류가 발생했습니다. 다시 시도해 주세요.");
        }

      } else if (tries >= 12) {
        clearInterval(timer);
        console.error(LOG_PREFIX + "MARU SDK Not Found after waiting.");
        alert("결제 모듈 로딩이 지연되고 있습니다. 새로고침 후 다시 시도해 주세요.");
      }
    }, 500);
  }

  window.paymentResultByJS = function (data) {
    console.log(LOG_PREFIX + "SDK Callback Data Received:", data);
    if (!data || !data.result) return;

    const resultCd = data.result.resultCd;
    const resultMsg = data.result.resultMsg || "";
    const advanceMsg = data.result.advanceMsg || resultMsg;

    if (resultCd === "0000") {
      const trackId =
        data.pay && data.pay.trackId ? data.pay.trackId : getURLParam("order_no");

      console.log(LOG_PREFIX + "Payment Success! Redirecting to Success Page...");
      location.href =
        CONFIG.HOSTED_DOMAIN +
        getRedirectUrl(CONFIG.PATHS.SUCCESS) +
        "?status=success&trackId=" +
        encodeURIComponent(trackId || "");
    } else {
      console.warn(LOG_PREFIX + "Payment Failed/Cancelled:", resultCd, advanceMsg);
      location.href =
        CONFIG.HOSTED_DOMAIN +
        getRedirectUrl(CONFIG.PATHS.CANCEL) +
        "?msg=" +
        encodeURIComponent(advanceMsg || "결제가 취소/실패했습니다.");
    }
  };

  // --- Shop Payment Page (Order Info) ---
  function handleShopPayment() {
    console.log(LOG_PREFIX + "Routing: Order Info Page");

    function injectCustomPaymentUI() {
      const checkInterval = setInterval(() => {
        // 결제수단 섹션 헤더 탐색
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

        // 이미 주입되었으면 종료
        if (paymentSection.querySelector(".pay-method-custom")) {
          clearInterval(checkInterval);
          return;
        }

        // 무통장 라디오 찾기(OPM01)
        const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
        const bankRadio = radios.find((r) => r.value && r.value.includes("OPM01"));
        if (!bankRadio) return;

        // 무통장 라디오 강제 선택(주문 생성용)
        if (!bankRadio.checked) bankRadio.click();

        // 입금자명/은행 선택 블록 추출
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

        console.log(LOG_PREFIX + "Depositor Block found:", depositorBlock);

        const customUI = document.createElement("div");
        customUI.className = "pay-method-custom";
        customUI.innerHTML = `
          <style>
            .pay-method-custom{display:flex;flex-direction:column;gap:15px;margin:15px 0;}
            .pay-method-buttons{display:flex;gap:10px;}
            .pay-method-custom button{flex:1;padding:15px;border:1px solid #ddd;border-radius:8px;background:#fff;font-weight:bold;cursor:pointer;font-size:16px;}
            .pay-method-custom button.active{border-color:#333;background:#333;color:#fff;}
            .pay-guide-text{font-size:13px;color:#666;margin-bottom:5px;line-height:1.5;}
            .moved-depositor-block{margin-top:10px;padding:10px;border:1px solid #eee;border-radius:4px;background:#fafafa;}
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

        // 기존 fieldset 숨김(중복 UI 방지)
        const fieldset = bankRadio.closest("fieldset");
        if (fieldset) fieldset.style.display = "none";

        const buttons = customUI.querySelectorAll("button");
        const bankSelect = document.querySelector('select[name^="cash_idx"]');
        const depositorInput =
          customUI.querySelector('input[placeholder*="입금자명"]') ||
          customUI.querySelector('input[name="depositor"]');

        function updatePaymentState(method) {
          console.log(LOG_PREFIX + "updatePaymentState:", method);

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

          if (bankSelect && bankSelect.options.length > 1) {
            const index = method === "CREDIT" ? 0 : 1;
            if (bankSelect.options.length > index) {
              bankSelect.selectedIndex = index;
              bankSelect.dispatchEvent(new Event("change", { bubbles: true }));
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
          });
        });

        console.log(LOG_PREFIX + "Custom Payment UI Injected");
        clearInterval(checkInterval);

      }, 500);
    }

    function saveCurrentState(source = "Auto", overrideMethod = null) {
      let ordererName = document.querySelector('input[name="ordererName"]')?.value || "";
      let ordererTel  = document.querySelector('input[name="ordererCall"]')?.value || "";
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
      const qty = qtyEl ? Number(qtyEl.innerText.replace(/[^0-9]/g, "")) || 1 : 1;

      const totalAmountStr = totalAmountEl
        ? totalAmountEl.innerText.replace(/[^0-9]/g, "")
        : "0";

      const totalAmount = Number(totalAmountStr || 0);

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
        orderNo: urlOrderNo || "ORD-" + Date.now(),
        amount: totalAmount,            // ✅ 숫자로 저장
        userName: ordererName,
        userTel: ordererTel,
        userEmail: ordererEmail,
        itemName: itemName,
        qty: qty,
        method: method,
      };

      if (totalAmount > 0) {
        localStorage.setItem("fintree_pay_data", JSON.stringify(paymentData));
        console.log(LOG_PREFIX + `Save [${source}] [${method}]`, paymentData);
        return paymentData;
      }
      return null;
    }

    window.addEventListener("load", function () {
      const inputNames = ["ordererName", "ordererCall", "ordererEmail"];
      inputNames.forEach((name) => {
        const el = document.querySelector(`input[name="${name}"]`);
        if (el) el.addEventListener("input", () => saveCurrentState("Input"));
      });

      // 결제하기 클릭 시 의도만 저장 (주문 생성은 아임웹이 계속 진행)
      document.addEventListener(
        "click",
        function (e) {
          const btn = e.target.closest(
            'button[type="submit"], ._btn_payment, .css-1tf84sl, .css-clap0e'
          );
          if (btn && btn.innerText.includes("결제하기")) {
            saveCurrentState("Pay Button Click");
            console.log(LOG_PREFIX + "Pay button clicked. Let Imweb submit order.");
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

    // 주기 저장(안정)
    setInterval(() => {
      if (pathMatches(CONFIG.PATHS.INFO)) saveCurrentState("Timer");
    }, 1200);
  }

  // --- Shop Payment Complete (Auth/Confirm Page) ---
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

    window.addEventListener("load", function () {
      let params = {
        trackId: getURLParam("order_no"),
        amount: 0,
        userName: "",
        userTel: "",
        userEmail: "",
        itemName: "상품",
      };

      try {
        const stored = JSON.parse(localStorage.getItem("fintree_pay_data"));
        if (stored) {
          if (!params.trackId) params.trackId = stored.orderNo;
          if (stored.amount) params.amount = Number(stored.amount || 0);
          params.userName = stored.userName || "";
          params.userTel = stored.userTel || "";
          params.userEmail = stored.userEmail || "";

          let baseName = stored.itemName || "상품";
          if (baseName.length > 20) baseName = baseName.substring(0, 20) + "...";
          const qty = Number(stored.qty || 1);
          params.itemName = baseName + (qty > 1 ? " 외 " + (qty - 1) + "건" : "");

          // order_no 갱신
          if (params.trackId && params.trackId !== stored.orderNo) {
            stored.orderNo = params.trackId;
            localStorage.setItem("fintree_pay_data", JSON.stringify(stored));
          }

          // 항상 버튼은 만들어줌
          startButtonWatcher(params);

          // CREDIT 의도면 자동 실행
          if (stored.method === "CREDIT") {
            console.log(LOG_PREFIX + "Detected CREDIT intent. Launching Payment...");
            createLoadingOverlay();
            executePay(params);
          } else {
            console.log(LOG_PREFIX + "BANK intent. No auto pay.");
          }
        } else {
          // 저장이 없더라도 버튼은 제공(수동 실행)
          startButtonWatcher(params);
        }
      } catch (e) {
        console.error(LOG_PREFIX + "Storage Parse Error", e);
        startButtonWatcher(params);
      }
    });
  }

  // --- Payment Success Page ---
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
          console.log(LOG_PREFIX + "SDK Result parsed:", parsed);
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
      const sdkResult = parseSDKResult();

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
      if (sdkResult && sdkResult.result && sdkResult.result.resultCd === "0000") {
        isSuccess = true;
      } else if (status === "success" && trackId) {
        isSuccess = true;
      }

      if (isSuccess) {
        console.log(LOG_PREFIX + "Payment confirmed.");

        // (선택) 백그라운드 verify
        try {
          const verifyParams = new URLSearchParams();
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
            .then((data) => console.log(LOG_PREFIX + "Verify API:", data))
            .catch((err) => console.warn(LOG_PREFIX + "Verify API error:", err.message));
        } catch (e) {}
      } else {
        let failMsg = "결제가 완료되지 않았습니다.";
        if (sdkResult && sdkResult.result && sdkResult.result.advanceMsg) failMsg = sdkResult.result.advanceMsg;
        if (status === "fail") failMsg = getURLParam("msg") || failMsg;

        console.warn(LOG_PREFIX + "Payment not successful:", failMsg);
        location.href =
          CONFIG.HOSTED_DOMAIN +
          getRedirectUrl(CONFIG.PATHS.CANCEL) +
          "?msg=" +
          encodeURIComponent(failMsg);
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
