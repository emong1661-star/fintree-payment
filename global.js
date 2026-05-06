/**
 * Fintree Payment Universal Script (Hosted)
 * Fix:
 *  - amount: ONLY from "총 주문금액" row (span next to label)
 *  - hide bank account/depositor blocks when CREDIT selected
 *  - itemName 제한: 20자 + UTF-8 55byte (avoid ITEM_NAME length error)
 *  - ✅ 구매자명(userName) 항상 영수증에 표시되도록 강화
 *      · 다중 셀렉터 fallback
 *      · MARU.pay 다중 필드 매핑 (userName/buyerName/purchaserName/ordererName)
 *      · 비어있으면 결제 차단 + 안내
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
    "shoes2024box9244.imweb.me",
    "tripleshopping.shop",
    "ahsxpffjrtm.imweb.me",
    "xn--wl2b73c5ykxyp.shop",
    "xn--2j1b308a8jaw4x.shop",
    "royalwatchhouse.imweb.me",
    "lowkeyedit.shop",
    "localhost",
    "127.0.0.1",
    "bagdown-payment.netlify.app",
  ];

  if (
    !ALLOWED_HOSTNAMES.includes(location.hostname) &&
    !location.hostname.endsWith(".vercel.app") &&
    !location.hostname.endsWith(".netlify.app")
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
    console.warn(
      LOG_PREFIX + "Failed to detect hosted domain, using default:",
      hostedDomain
    );
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

  // ---------------- Utilities ----------------

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

  function extractNumber(text) {
    if (!text) return "";
    const n = String(text).replace(/[^\d]/g, "");
    return n || "";
  }

  // ---------------- ITEM_NAME limit (20 chars + 55 bytes) ----------------
  const ITEM_NAME_MAX_CHARS = 20;
  const ITEM_NAME_MAX_BYTES = 55;

  function utf8ByteLength(str) {
    try {
      return new TextEncoder().encode(str).length;
    } catch (e) {
      return unescape(encodeURIComponent(String(str || ""))).length;
    }
  }

  function utf8Truncate(str, maxBytes) {
    if (!str) return "";
    let s = String(str);
    if (utf8ByteLength(s) <= maxBytes) return s;

    let end = s.length;
    while (end > 0) {
      const candidate = s.slice(0, end);
      if (utf8ByteLength(candidate) <= maxBytes) return candidate;
      end--;
    }
    return "";
  }

  function normalizeItemName(str) {
    return String(str || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function limitItemName(str) {
    const s = normalizeItemName(str);
    const byChars = s.slice(0, ITEM_NAME_MAX_CHARS);
    return utf8Truncate(byChars, ITEM_NAME_MAX_BYTES);
  }

  // ---------------- ✅ User Name Extractor (강화) ----------------
  /**
   * 다양한 셀렉터/위치에서 구매자명을 추출.
   * 우선순위:
   *  1) input[name="ordererName"]
   *  2) input[id="ordererName"], data-field 등
   *  3) placeholder에 "이름"/"성함" 포함된 input
   *  4) 입금자명 input (depositor)
   *  5) localStorage에 마지막으로 저장된 값
   */
  function extractUserName() {
    const tryRead = (sel) => {
      try {
        const el = document.querySelector(sel);
        if (el && el.value && String(el.value).trim()) {
          return String(el.value).trim();
        }
      } catch (e) {}
      return "";
    };

    // 1) 명시적 ordererName
    let v =
      tryRead('input[name="ordererName"]') ||
      tryRead('input[id="ordererName"]') ||
      tryRead('input[data-field="ordererName"]');
    if (v) return v;

    // 2) name 속성 부분일치
    try {
      const all = document.querySelectorAll('input[name*="orderer" i]');
      for (const el of all) {
        const nm = (el.getAttribute("name") || "").toLowerCase();
        if (
          (nm.includes("name") || nm.includes("이름") || nm.includes("성함")) &&
          el.value &&
          el.value.trim()
        ) {
          return el.value.trim();
        }
      }
    } catch (e) {}

    // 3) placeholder 기반
    v =
      tryRead('input[placeholder*="이름"]') ||
      tryRead('input[placeholder*="성함"]') ||
      tryRead('input[placeholder*="주문자"]');
    if (v) return v;

    // 4) 입금자명 fallback (무통장 입금자명을 구매자명으로 사용)
    v =
      tryRead('input[name="depositor"]') ||
      tryRead('input[placeholder*="입금자"]');
    if (v) return v;

    // 5) localStorage 마지막값
    try {
      const stored = JSON.parse(localStorage.getItem("fintree_pay_data") || "{}");
      if (stored && stored.userName && String(stored.userName).trim()) {
        return String(stored.userName).trim();
      }
    } catch (e) {}

    return "";
  }

  function extractUserTel() {
    const tryRead = (sel) => {
      try {
        const el = document.querySelector(sel);
        if (el && el.value && String(el.value).trim()) {
          return String(el.value).trim();
        }
      } catch (e) {}
      return "";
    };

    return (
      tryRead('input[name="ordererCall"]') ||
      tryRead('input[name="ordererTel"]') ||
      tryRead('input[name*="orderer" i][name*="tel" i]') ||
      tryRead('input[name*="orderer" i][name*="phone" i]') ||
      tryRead('input[placeholder*="연락처"]') ||
      tryRead('input[placeholder*="전화"]') ||
      ""
    );
  }

  function extractUserEmail() {
    const tryRead = (sel) => {
      try {
        const el = document.querySelector(sel);
        if (el && el.value && String(el.value).trim()) {
          return String(el.value).trim();
        }
      } catch (e) {}
      return "";
    };

    return (
      tryRead('input[name="ordererEmail"]') ||
      tryRead('input[type="email"]') ||
      tryRead('input[placeholder*="이메일"]') ||
      ""
    );
  }

  /**
   * ✅ "총 주문금액" 옆 span 값만 읽는다.
   */
  function findTotalOrderAmountStrict() {
    const labelSpans = Array.from(document.querySelectorAll("span")).filter(
      (s) => (s.innerText || "").trim() === "총 주문금액"
    );

    for (const label of labelSpans) {
      const next = label.nextElementSibling;
      if (next && next.tagName === "SPAN") {
        const num = extractNumber(next.innerText);
        if (num && parseInt(num, 10) > 0) {
          console.log(
            LOG_PREFIX + "Amount from TOTAL row (next span) =>",
            num
          );
          return num;
        }
      }

      const parent = label.parentElement;
      if (parent) {
        const amountSpan =
          parent.querySelector("span.css-nxbuqh") ||
          parent.querySelector('span[class*="nxbuqh"]') ||
          parent.querySelector("span:last-child");

        if (amountSpan) {
          const num = extractNumber(amountSpan.innerText);
          if (num && parseInt(num, 10) > 0) {
            console.log(
              LOG_PREFIX + "Amount from TOTAL row (parent query) =>",
              num
            );
            return num;
          }
        }
      }
    }

    console.warn(LOG_PREFIX + "TOTAL amount not found (strict) => 0");
    return "0";
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
    console.log(LOG_PREFIX + "Calling MARU.pay", params);

    setTimeout(function () {
      if (typeof MARU === "undefined") {
        console.error(LOG_PREFIX + "MARU SDK Not Found.");
        alert("결제 모듈을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        location.reload();
        return;
      }

      const safeItemName = limitItemName(params.itemName || "상품") || "상품";

      // ✅ 구매자명 안전 처리 (공백 trim, 마지막 fallback "구매자")
      const safeUserName =
        String(params.userName || "").trim() ||
        extractUserName() ||
        "구매자";

      const safeUserTel = String(params.userTel || "").trim();
      const safeUserEmail = String(params.userEmail || "").trim();

      console.log(LOG_PREFIX + "✅ Final userName for receipt:", safeUserName);

      MARU.pay({
        payRoute: "3d",
        responseFunction: window.paymentResultByJS,
        publicKey: CONFIG.PUBLIC_KEY,
        trackId: params.trackId,
        amount: params.amount,
        redirectUrl:
          window.location.origin + getRedirectUrl(CONFIG.PATHS.SUCCESS),
        itemName: safeItemName,

        // ✅ 구매자명 다중 필드 매핑 (PG/SDK 버전별 호환 — 영수증 PURCHASER 표시 보장)
        userName: safeUserName,
        buyerName: safeUserName,
        purchaserName: safeUserName,
        ordererName: safeUserName,
        customerName: safeUserName,

        // ✅ 연락처/이메일도 별칭 포함
        userTel: safeUserTel,
        buyerTel: safeUserTel,
        ordererTel: safeUserTel,

        userEmail: safeUserEmail,
        buyerEmail: safeUserEmail,
        ordererEmail: safeUserEmail,

        mode: "layer",
        debugMode: "live",
      });
    }, 250);
  }

  window.paymentResultByJS = function (data) {
    console.log(LOG_PREFIX + "SDK Callback Data Received:", data);
    if (!data || !data.result) return;

    const resultCd = data.result.resultCd;
    const resultMsg = data.result.resultMsg || "";
    const advanceMsg = data.result.advanceMsg || resultMsg;

    if (resultCd === "0000") {
      const trackId =
        data.pay && data.pay.trackId
          ? data.pay.trackId
          : getURLParam("order_no");
      console.log(LOG_PREFIX + "Payment Success. Redirecting...");
      location.href =
        getRedirectUrl(CONFIG.PATHS.SUCCESS) +
        "?status=success&trackId=" +
        trackId;
    } else {
      console.warn(
        LOG_PREFIX + "Payment Failed/Cancelled:",
        resultCd,
        advanceMsg
      );
      location.href =
        getRedirectUrl(CONFIG.PATHS.CANCEL) +
        "?msg=" +
        encodeURIComponent(advanceMsg);
    }
  };

  // ---------------- /shop_payment ----------------

  function handleShopPayment() {
    console.log(LOG_PREFIX + "Routing: /shop_payment");

    function injectCustomPaymentUI() {
      const timer = setInterval(() => {
        const headers = Array.from(
          document.querySelectorAll("header, h2, h3, .title, .css-17g8nhj")
        );
        const paymentHeader = headers.find((h) =>
          (h.innerText || "").includes("결제수단")
        );
        if (!paymentHeader) return;

        const paymentSection =
          paymentHeader.closest('div[class*="css-"]') ||
          paymentHeader.closest(".pay-method-section") ||
          paymentHeader.parentElement;
        if (!paymentSection) return;

        if (paymentSection.querySelector(".pay-method-custom")) {
          clearInterval(timer);
          return;
        }

        const radios = Array.from(
          document.querySelectorAll('input[type="radio"]')
        );
        const bankRadio = radios.find(
          (r) => r.value && String(r.value).includes("OPM01")
        );
        if (!bankRadio) return;

        if (!bankRadio.checked) bankRadio.click();

        let depositorBlock = document.querySelector(".css-1hw29i9");
        if (!depositorBlock) {
          const input =
            document.querySelector('input[placeholder*="입금자명"]') ||
            document.querySelector('input[name="depositor"]');
          if (input) {
            depositorBlock = input.closest("div");
            if (depositorBlock && depositorBlock.tagName === "LABEL")
              depositorBlock = depositorBlock.parentElement;
          }
        }

        const fieldset = bankRadio.closest("fieldset");

        const customUI = document.createElement("div");
        customUI.className = "pay-method-custom";
        customUI.innerHTML = `
          <style>
            .pay-method-custom { display:flex; flex-direction:column; gap:12px; margin: 12px 0; }
            .pay-method-buttons { display:flex; gap:10px; }
            .pay-method-custom button{
              flex:1; padding:15px; border:1px solid #ddd; border-radius:8px;
              background:#fff; font-weight:700; cursor:pointer; font-size:16px;
            }
            .pay-method-custom button.active{ border-color:#333; background:#333; color:#fff; }
            .pay-guide-text{ font-size:13px; color:#666; line-height:1.5; }
            .pay-guide-text .pay-guide-red{ color:#e60000; font-weight:700; }
            .pay-guide-text .pay-guide-blue{ color:#0066ff; font-weight:700; }
            .moved-depositor-block{ margin-top:10px; padding:10px; border:1px solid #eee; border-radius:6px; background:#fafafa; }
          </style>
          <div class="pay-guide-text">
            * 아래 버튼을 눌러 결제수단을 선택해주세요.<br>
            <span class="pay-guide-red">* 카드결제시에도 계좌안내문자가 자동 발송됩니다.</span><br>
            카드결제와는 무관한 자동문자입니다.<br>
            * 카드결제 오류 시 카카오톡으로 문의해주세요.<br>
            <span class="pay-guide-blue">* 법인카드 결제시 카카오톡으로 문의주세요.</span><br> 
            * 결제오류로 재결제가 필요하실 경우<br>
            다시 주문하지 마시고 카카오톡으로 문의주세요.
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
          const area = customUI.querySelector("#fnt-depositor-area");
          if (area) area.appendChild(depositorBlock);
        }

        const area = customUI.querySelector("#fnt-depositor-area");
        const moved = area && depositorBlock;
        if (fieldset && moved) fieldset.style.display = "none";

        function applyMethodUI(method) {
          const stateMethod =
            method === "CREDIT" ? "CreditCard" : "BankTransfer";
          localStorage.setItem("payMethod", stateMethod);

          if (method === "CREDIT") {
            if (depositorBlock) depositorBlock.style.display = "none";
          } else {
            if (depositorBlock) {
              depositorBlock.style.display = "flex";
              depositorBlock.style.flexDirection = "column";
              depositorBlock.style.gap = "8px";
            }
          }
        }

        const buttons = customUI.querySelectorAll("button[data-method]");
        function setActive(method) {
          buttons.forEach((b) => b.classList.remove("active"));
          const btn = customUI.querySelector(`button[data-method="${method}"]`);
          if (btn) btn.classList.add("active");
          applyMethodUI(method);
          saveCurrentState("Method Switch", method);
        }

        buttons.forEach((btn) => {
          btn.addEventListener("click", (e) => {
            const method = e.currentTarget.getAttribute("data-method");
            console.log(LOG_PREFIX + "Method clicked:", method);
            setActive(method);
          });
        });

        localStorage.setItem("payMethod", "BankTransfer");
        setActive("BANK");

        console.log(LOG_PREFIX + "Custom Payment UI injected");
        clearInterval(timer);
      }, 400);
    }

    function saveCurrentState(source = "Manual", overrideMethod = null) {
      // ✅ 강화된 추출기 사용
      const ordererName = extractUserName();
      const ordererTel = extractUserTel();
      const ordererEmail = extractUserEmail();

      // Item name (best effort)
      const itemNameEl =
        document.querySelector(".css-a0a2v3") ||
        document.querySelector("._product_name") ||
        document.querySelector('[class*="product"] [class*="name"]');

      let itemName = itemNameEl ? (itemNameEl.innerText || "").trim() : "상품";
      itemName = limitItemName(itemName) || "상품";

      // Qty
      const qtyEl =
        document.querySelector(".css-15fzge") ||
        document.querySelector("._product_qty");
      const qty = qtyEl ? extractNumber(qtyEl.innerText) || "1" : "1";

      // Total amount
      const totalAmount = findTotalOrderAmountStrict();

      // Method
      let method = overrideMethod;
      if (!method) {
        const uiState = localStorage.getItem("payMethod");
        if (uiState === "CreditCard") method = "CREDIT";
        else if (uiState === "BankTransfer") method = "BANK";
        else method = "BANK";
      }

      const urlOrderNo = getURLParam("order_no");
      const paymentData = {
        orderNo: urlOrderNo || "ORD-" + Date.now(),
        amount: totalAmount,
        userName: ordererName, // ✅ 강화된 값
        userTel: ordererTel,
        userEmail: ordererEmail,
        itemName: itemName,
        qty: qty,
        method: method,
      };

      localStorage.setItem("fintree_pay_data", JSON.stringify(paymentData));
      console.log(
        LOG_PREFIX + `Saved fintree_pay_data [${source}] =>`,
        paymentData
      );

      if (!ordererName) {
        console.warn(
          LOG_PREFIX +
            "⚠️ userName이 비어있습니다. ordererName/depositor input을 찾지 못함"
        );
      } else {
        console.log(LOG_PREFIX + "✅ userName 추출 성공:", ordererName);
      }

      if (!totalAmount || totalAmount === "0") {
        console.warn(LOG_PREFIX + "Amount not found => 0 (blocked)");
      }
      return paymentData;
    }

    window.addEventListener("load", function () {
      // 입력 변경 즉시 저장
      const inputNames = [
        "ordererName",
        "ordererCall",
        "ordererTel",
        "ordererEmail",
        "depositor",
      ];
      inputNames.forEach((name) => {
        const el = document.querySelector(`input[name="${name}"]`);
        if (el) el.addEventListener("input", () => saveCurrentState("Input"));
      });

      // placeholder 기반 input도 감지 (이름/입금자명 등 동적 input)
      document.addEventListener("input", function (e) {
        const t = e.target;
        if (!t || t.tagName !== "INPUT") return;
        const ph = (t.getAttribute("placeholder") || "").toLowerCase();
        if (
          ph.includes("이름") ||
          ph.includes("성함") ||
          ph.includes("입금자") ||
          ph.includes("연락처") ||
          ph.includes("전화") ||
          ph.includes("이메일") ||
          ph.includes("주문자")
        ) {
          saveCurrentState("Input(placeholder)");
        }
      });

      // Keep amount/userName fresh (DOM changes)
      setInterval(() => {
        if (pathMatches(CONFIG.PATHS.INFO)) saveCurrentState("Timer");
      }, 1000);

      // On "결제하기" click: save then allow Imweb submit
      document.addEventListener(
        "click",
        function (e) {
          const btn = e.target.closest(
            'button[type="submit"], ._btn_payment, .css-1tf84sl, .css-clap0e'
          );
          if (btn && (btn.innerText || "").includes("결제하기")) {
            console.log(
              LOG_PREFIX + "결제하기 clicked -> save state then allow submit"
            );
            const state = saveCurrentState("Submit Click");

            // ✅ 구매자명이 비어있으면 결제 차단
            if (!state.userName) {
              e.preventDefault();
              e.stopPropagation();
              alert("구매자명(주문자 이름)을 입력해 주세요.");
              const focusEl =
                document.querySelector('input[name="ordererName"]') ||
                document.querySelector('input[placeholder*="이름"]') ||
                document.querySelector('input[placeholder*="성함"]');
              if (focusEl) focusEl.focus();
              return false;
            }
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

  // ---------------- /shop_payment_complete ----------------

  function handleShopPaymentComplete() {
    console.log(LOG_PREFIX + "Routing: /shop_payment_complete");

    window.addEventListener("load", function () {
      const urlOrderNo = getURLParam("order_no");

      let stored = null;
      try {
        stored = JSON.parse(localStorage.getItem("fintree_pay_data"));
      } catch (e) {}

      // ✅ complete 페이지에서도 한 번 더 추출 시도 (DOM에 주문자 정보 표시되는 경우 대응)
      const liveUserName = extractUserName();
      const liveUserTel = extractUserTel();
      const liveUserEmail = extractUserEmail();

      const finalUserName =
        (stored && stored.userName && String(stored.userName).trim()) ||
        liveUserName ||
        "";

      const params = {
        trackId:
          urlOrderNo || (stored && stored.orderNo) || "ORD-" + Date.now(),
        amount: stored && stored.amount ? String(stored.amount) : "0",
        userName: finalUserName,
        userTel:
          (stored && stored.userTel) || liveUserTel || "",
        userEmail:
          (stored && stored.userEmail) || liveUserEmail || "",
        itemName:
          limitItemName((stored && stored.itemName) || "상품") || "상품",
      };

      console.log(LOG_PREFIX + "Final params:", params);

      if (!params.amount || params.amount === "0") {
        alert(
          location.hostname +
            " 내용:\n\n결제금액을 읽지 못해서 결제를 진행할 수 없습니다. (amount=0)\n" +
            "현재 페이지가 아니라 /shop_payment에서 '총 주문금액'을 못 읽은 상태입니다.\n" +
            "F12 콘솔에서 'Amount from TOTAL row' 로그 캡처를 보내주세요."
        );
        console.error(LOG_PREFIX + "Blocked: amount=0", params);
        return;
      }

      // ✅ 구매자명이 비어있으면 결제 차단 + 정보 입력 페이지로 복귀 안내
      if (!params.userName) {
        alert(
          "구매자명(주문자 이름)이 비어 있어 결제를 진행할 수 없습니다.\n" +
            "주문자 정보 입력 페이지에서 이름을 다시 확인해 주세요."
        );
        console.error(LOG_PREFIX + "Blocked: userName empty", params);
        // 이전 페이지로 자동 복귀
        try {
          history.back();
        } catch (e) {}
        return;
      }

      if (stored && stored.method === "CREDIT") {
        console.log(
          LOG_PREFIX + "CREDIT intent detected -> open payment layer now"
        );
        createLoadingOverlay();
        executePay(params);
      } else {
        console.log(LOG_PREFIX + "BANK intent or unknown -> no auto payment");
      }
    });
  }

  // ---------------- Router ----------------

  function initRouter() {
    if (pathMatches(CONFIG.PATHS.INFO)) handleShopPayment();
    else if (pathMatches(CONFIG.PATHS.CONFIRM)) handleShopPaymentComplete();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initRouter);
  } else {
    initRouter();
  }
})();
