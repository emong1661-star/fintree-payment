/**
 * Fintree Payment Universal Script (Netlify Hosted)
 * - Imweb shop_payment / shop_payment_complete 흐름에서
 *   "카드결제" 의도 저장 -> 주문 생성 후 complete 페이지에서 MARU.pay 실행
 * - 핵심: amount(총 주문금액) 추출을 0이 안 나오게 강력하게 보강
 * - 카드결제 선택 시 무통장 영역(계좌/입금자명) 완전 숨김
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

  // --- Hosted domain detect (Netlify/Vercel) ---
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
    const isLocal =
      location.pathname.endsWith(".html") || location.protocol === "file:";
    return targetPath + (isLocal ? ".html" : "");
  }

  function getURLParam(name) {
    const results = new RegExp("[\\?&]" + name + "=([^&#]*)").exec(
      location.search
    );
    return results === null
      ? ""
      : decodeURIComponent(results[1].replace(/\+/g, " "));
  }

  function parseAmountNumber(input) {
    if (!input) return 0;
    const s = String(input);
    // 1) 숫자/콤마/점/공백 외 제거
    const cleaned = s.replace(/[^\d.,\s]/g, "");
    // 2) 콤마 제거 후 숫자만
    const n = parseInt(cleaned.replace(/[,\s.]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }

  // "총 주문금액" 라벨 기반 추출(가장 강력)
  function extractAmountByLabel() {
    const labelCandidates = [
      "총 주문금액",
      "총주문금액",
      "결제금액",
      "총 결제금액",
      "총결제금액",
      "합계",
    ];

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      const t = (node.innerText || "").trim();
      if (!t) continue;

      // 라벨 텍스트가 "딱" 포함된 작은 요소를 찾음
      const matched = labelCandidates.find((k) =>
        t.replace(/\s/g, "").includes(k.replace(/\s/g, ""))
      );
      if (!matched) continue;

      // 1) 같은 컨테이너에서 숫자 찾기
      const container =
        node.closest("div, li, section, article") || node.parentElement;
      if (!container) continue;

      const texts = container.innerText || "";
      const nums = texts.match(/\d[\d,.\s]*\d/g);
      if (nums && nums.length) {
        // 가장 큰 숫자를 금액으로 가정 (배송비/수량보다 보통 큼)
        let best = 0;
        nums.forEach((x) => {
          const v = parseAmountNumber(x);
          if (v > best) best = v;
        });
        if (best > 0) return best;
      }

      // 2) 바로 다음 형제에서 숫자 찾기
      const sib = node.nextElementSibling;
      if (sib) {
        const v = parseAmountNumber(sib.innerText);
        if (v > 0) return v;
      }
    }

    return 0;
  }

  // dataLayer에서 구매 value 잡기
  function extractAmountFromDataLayer() {
    try {
      const dl = window.dataLayer;
      if (!Array.isArray(dl)) return 0;

      // 뒤에서부터 검색(최근 이벤트 우선)
      for (let i = dl.length - 1; i >= 0; i--) {
        const e = dl[i];
        if (!e || typeof e !== "object") continue;

        // GA4 purchase 형태들
        // 1) e.ecommerce.value
        if (e.ecommerce && typeof e.ecommerce === "object") {
          const v1 = parseAmountNumber(e.ecommerce.value);
          if (v1 > 0) return v1;

          // 2) e.ecommerce.purchase.actionField.revenue 같은 UA 변형
          const v2 =
            e.ecommerce.purchase &&
            e.ecommerce.purchase.actionField &&
            parseAmountNumber(e.ecommerce.purchase.actionField.revenue);
          if (v2 > 0) return v2;
        }

        // 3) value 직접
        const v3 = parseAmountNumber(e.value);
        if (v3 > 0) return v3;
      }
    } catch (err) {}
    return 0;
  }

  // selector 기반 + label/dataLayer fallback 통합
  function extractAmountStrong() {
    // 1) 기존 selector들(너 페이지 구조 대응)
    const selectors = [
      ".css-x99dng",
      ".css-z3pbio",
      ".css-1i1erzf",
      "._total_price",
      ".total_price",
      ".order_price",
      ".order-total",
      "[data-total-price]",
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;

      // data-attribute 우선
      const attrV = el.getAttribute && el.getAttribute("data-total-price");
      const fromAttr = parseAmountNumber(attrV);
      if (fromAttr > 0) return fromAttr;

      const v = parseAmountNumber(el.innerText);
      if (v > 0) return v;
    }

    // 2) label 기반
    const byLabel = extractAmountByLabel();
    if (byLabel > 0) return byLabel;

    // 3) dataLayer 기반
    const byDL = extractAmountFromDataLayer();
    if (byDL > 0) return byDL;

    return 0;
  }

  // ---------------- UI/Payment ----------------
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
    console.log(LOG_PREFIX + "Calling MARU.pay params:", params);

    setTimeout(function () {
      if (typeof MARU !== "undefined" && MARU && typeof MARU.pay === "function") {
        MARU.pay({
          payRoute: "3d",
          responseFunction: window.paymentResultByJS,
          publicKey: CONFIG.PUBLIC_KEY,
          trackId: params.trackId,
          amount: params.amount, // 반드시 숫자(문자열 OK)
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
      }
    }, 300);
  }

  window.paymentResultByJS = function (data) {
    console.log(LOG_PREFIX + "SDK Callback Data Received:", data);
    if (!data || !data.result) return;

    const resultCd = data.result.resultCd;
    const advanceMsg = data.result.advanceMsg || data.result.resultMsg || "";

    if (resultCd === "0000") {
      const trackId =
        data.pay && data.pay.trackId ? data.pay.trackId : getURLParam("order_no");
      console.log(LOG_PREFIX + "Payment Success! Redirecting...");
      location.href =
        getRedirectUrl(CONFIG.PATHS.SUCCESS) +
        "?status=success&trackId=" +
        encodeURIComponent(trackId || "");
    } else {
      console.warn(LOG_PREFIX + "Payment Failed/Cancelled:", resultCd, advanceMsg);
      location.href =
        getRedirectUrl(CONFIG.PATHS.CANCEL) +
        "?msg=" +
        encodeURIComponent(advanceMsg || "결제가 취소/실패했습니다.");
    }
  };

  // ---------------- shop_payment ----------------
  function handleShopPayment() {
    console.log(LOG_PREFIX + "Routing: Order Info Page");

    function updatePaymentState(method, depositorArea, depositorInput) {
      // method: CREDIT / BANK
      localStorage.setItem("payMethod", method === "CREDIT" ? "CreditCard" : "BankTransfer");

      // 카드결제면 무통장 영역 완전 숨김 + validation 통과용 입금자명 채움
      if (depositorArea) {
        if (method === "CREDIT") {
          depositorArea.style.display = "none";
          if (depositorInput) depositorInput.value = "카드결제";
        } else {
          depositorArea.style.display = "block";
          if (depositorInput && depositorInput.value === "카드결제") depositorInput.value = "";
        }
      } else if (depositorInput) {
        depositorInput.style.display = method === "CREDIT" ? "none" : "block";
        if (method === "CREDIT") depositorInput.value = "카드결제";
      }
    }

    function injectCustomPaymentUI() {
      const checkInterval = setInterval(() => {
        // "결제수단" 헤더 찾기
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

        // 무통장 라디오 (OPM01) 찾기
        const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
        const bankRadio = radios.find((r) => r.value && r.value.includes("OPM01"));
        if (!bankRadio) return;

        // 무통장 라디오 강제 선택(주문 생성 흐름 유지)
        if (!bankRadio.checked) bankRadio.click();

        // 무통장 입력/계좌 영역 블록 찾기
        let depositorBlock = document.querySelector(".css-1hw29i9");
        if (!depositorBlock) {
          const input = document.querySelector('input[placeholder*="입금자명"]') || document.querySelector('input[name="depositor"]');
          if (input) depositorBlock = input.closest("div");
        }

        console.log(LOG_PREFIX + "Depositor Block found:", depositorBlock);

        // 커스텀 UI
        const customUI = document.createElement("div");
        customUI.className = "pay-method-custom";
        customUI.innerHTML = `
          <style>
            .pay-method-custom { display: flex; flex-direction: column; gap: 15px; margin: 15px 0; }
            .pay-method-buttons { display: flex; gap: 10px; }
            .pay-method-custom button {
              flex: 1; padding: 15px; border: 1px solid #ddd; border-radius: 8px;
              background: #fff; font-weight: bold; cursor: pointer; font-size: 16px;
            }
            .pay-method-custom button.active {
              border-color: #333; background: #333; color: #fff;
            }
            .pay-guide-text { font-size: 13px; color: #666; margin-bottom: 5px; line-height: 1.5; }
            .moved-depositor-block { margin-top: 10px; padding: 10px; border: 1px solid #eee; border-radius: 6px; background: #fafafa; }
          </style>
          <div class="pay-guide-text">
            * 아래 버튼을 눌러 결제수단을 선택해주세요.<br>
            * 카드결제 오류 시 고객센터로 문의해주세요.
          </div>
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

        // 기존 fieldset 숨김
        const fieldset = bankRadio.closest("fieldset");
        if (fieldset) fieldset.style.display = "none";

        // moved 블록 안에서 입금자명 input 찾기
        const depositorInput =
          (customUI.querySelector('input[placeholder*="입금자명"]') ||
            customUI.querySelector('input[name="depositor"]') ||
            (depositorBlock ? depositorBlock.querySelector('input[placeholder*="입금자명"], input[name="depositor"]') : null));

        // 초기: 카드결제 -> 무통장 영역 숨김
        updatePaymentState("CREDIT", depositorArea, depositorInput);

        // 버튼 클릭
        const buttons = customUI.querySelectorAll("button[data-method]");
        buttons.forEach((btn) => {
          btn.addEventListener("click", (e) => {
            const method = btn.getAttribute("data-method");
            buttons.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            console.log(LOG_PREFIX + "Payment method selected:", method);
            updatePaymentState(method, depositorArea, depositorInput);

            // 선택 즉시 상태 저장(특히 amount)
            saveCurrentState("Method Click", method);
          });
        });

        console.log(LOG_PREFIX + "Custom Payment UI Injected");
        clearInterval(checkInterval);
      }, 400);
    }

    function saveCurrentState(source = "Manual", overrideMethod = null) {
      // 주문자 정보 (기존 input이 있으면 사용)
      let ordererName = document.querySelector('input[name="ordererName"]')?.value || "";
      let ordererTel = document.querySelector('input[name="ordererCall"]')?.value || "";
      let ordererEmail = document.querySelector('input[name="ordererEmail"]')?.value || "";

      // 상품명/수량
      const itemNameEl = document.querySelector(".css-a0a2v3") || document.querySelector("._product_name");
      const qtyEl = document.querySelector(".css-15fzge") || document.querySelector("._product_qty");

      const itemName = itemNameEl ? (itemNameEl.innerText || "").trim() : "상품";
      const qty = qtyEl ? (qtyEl.innerText || "").replace(/[^0-9]/g, "") : "1";

      // ★ 핵심: 금액 강력 추출
      const amountNum = extractAmountStrong();
      console.log(LOG_PREFIX + "Amount from selector/dataLayer/text scan:", amountNum);

      let method = overrideMethod;
      if (!method) {
        const uiState = localStorage.getItem("payMethod");
        if (uiState === "CreditCard") method = "CREDIT";
        else if (uiState === "BankTransfer") method = "BANK";
        else method = "BANK";
      }

      const urlOrderNo = getURLParam("order_no");
      const paymentData = {
        orderNo: urlOrderNo || "ORD-" + new Date().getTime(),
        amount: String(amountNum || 0),
        userName: ordererName,
        userTel: ordererTel,
        userEmail: ordererEmail,
        itemName: itemName,
        qty: qty || "1",
        method: method,
      };

      localStorage.setItem("fintree_pay_data", JSON.stringify(paymentData));
      console.log(LOG_PREFIX + `Saved fintree_pay_data [${source}]`, paymentData);

      return paymentData;
    }

    // 결제하기 버튼 클릭 전/후로 계속 저장 (금액이 늦게 렌더링되는 케이스 대응)
    window.addEventListener("load", function () {
      if (document.readyState !== "complete") return;

      // 초기에 한 번 저장
      saveCurrentState("Initial Load");

      // 주기 저장(금액 늦게 나오는 페이지 대응)
      const timer = setInterval(() => {
        if (!pathMatches(CONFIG.PATHS.INFO)) {
          clearInterval(timer);
          return;
        }
        saveCurrentState("Timer");
      }, 1200);

      // 결제하기 클릭 잡기
      document.addEventListener(
        "click",
        function (e) {
          const btn = e.target.closest(
            'button[type="submit"], ._btn_payment, .css-1tf84sl, .css-clap0e'
          );
          if (btn && (btn.innerText || "").includes("결제하기")) {
            // 클릭 시점에 최종 저장(중요)
            const uiState = localStorage.getItem("payMethod");
            const chosen = uiState === "CreditCard" ? "CREDIT" : "BANK";
            saveCurrentState("Pay Button Click", chosen);
            console.log(LOG_PREFIX + "결제하기 클릭 -> 주문 생성 진행(아임웹 흐름 유지)");
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
  }

  // ---------------- shop_payment_complete ----------------
  function handleShopPaymentComplete() {
    console.log(LOG_PREFIX + "Routing: Auth/Confirmation Page");

    window.addEventListener("load", function () {
      let stored = null;
      try {
        stored = JSON.parse(localStorage.getItem("fintree_pay_data"));
      } catch (e) {}

      const urlOrderNo = getURLParam("order_no");

      // amount 최종 확정: stored 우선, 0이면 이 페이지에서 다시 강력추출
      let amountNum = stored ? parseAmountNumber(stored.amount) : 0;
      if (!amountNum || amountNum <= 0) {
        const recovered = extractAmountStrong();
        console.log(LOG_PREFIX + "Amount recovered on complete page =>", recovered);
        amountNum = recovered;
      }

      const params = {
        trackId: urlOrderNo || (stored && stored.orderNo) || "",
        amount: String(amountNum || 0),
        userName: (stored && stored.userName) || "",
        userTel: (stored && stored.userTel) || "",
        userEmail: (stored && stored.userEmail) || "",
        itemName: (stored && stored.itemName) || "상품",
      };

      console.log(LOG_PREFIX + "Final params:", params);

      // amount=0이면 결제 막고 안내
      if (!amountNum || amountNum <= 0) {
        alert(
          `${location.hostname} 내용:\n\n결제금액을 읽지 못해서 결제를 진행할 수 없습니다. (amount=0)\n` +
            `이 페이지(/shop_payment_complete)에서도 금액을 못 잡았습니다.\n` +
            `콘솔 로그에서 "Amount recovered" 줄 캡처를 보내주세요.`
        );
        console.error(LOG_PREFIX + "Blocked: amount=0", params);
        return;
      }

      // 카드결제 의도면 자동 실행
      if (stored && stored.method === "CREDIT") {
        console.log(LOG_PREFIX + "CREDIT intent detected -> open payment layer now");
        createLoadingOverlay();
        executePay(params);
      } else {
        console.log(LOG_PREFIX + "BANK intent or no stored intent -> do nothing");
      }
    });
  }

  // ---------------- success / cancel / refund ----------------
  function handlePaymentSuccess() {
    console.log(LOG_PREFIX + "Routing: Result Page");
  }
  function handlePaymentCancel() {
    console.log(LOG_PREFIX + "Routing: Cancel Page");
  }
  function handlePaymentRefund() {
    console.log(LOG_PREFIX + "Routing: Refund Page");
  }

  // ---------------- Router ----------------
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
