/**
 * Fintree Payment Universal Script (Hosted)
 * Fix:
 *  - amount: ONLY from "총 주문금액" row (span next to label)
 *  - hide bank account/depositor blocks when CREDIT selected
 *  - itemName 제한: 20자 + UTF-8 55byte (avoid ITEM_NAME length error)
 *  - ✅ 배송정보 "수령인" → 영수증 구매자명(PURCHASER) 매핑
 *      · 수령인이 비어있으면 주문자명 fallback
 *      · 어떤 오류가 나도 결제는 정상 진행 (try-catch 완전 보호)
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
    "xn--oi2b94xh5a.shop",
    "royalwatchhouse.imweb.me",
    "lowkeyedit.shop",
    
    "emahdzmf.imweb.me",
    "demonk.shop",

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
    PUBLIC_KEY: "pk_acde-acde13-acd-acde1",
    TID: "TMN025716",
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

  // ---------------- ✅ 배송정보 "수령인" 안전 추출기 ----------------
  /**
   * 배송 정보 섹션의 "수령인" input에서 이름을 읽어옴.
   * - 어떤 오류가 나도 결제 흐름은 절대 막지 않음 (try-catch 완전 보호)
   * - 수령인이 비어있으면 빈 문자열 반환 (호출부에서 주문자명 fallback)
   */
  function readReceiverName() {
    try {
      // 1순위: 아임웹 표준 셀렉터들
      const candidates = [
        'input[name="receiverName"]',
        'input[name="deliveryReceiver"]',
        'input[name="receiver"]',
        'input[id="receiverName"]',
        'input[data-field="receiverName"]',
      ];

      for (const sel of candidates) {
        try {
          const el = document.querySelector(sel);
          if (el && el.value && String(el.value).trim()) {
            return String(el.value).trim();
          }
        } catch (e) {}
      }

      // 2순위: placeholder에 "수령인" 있는 input
      try {
        const all = document.querySelectorAll(
          'input[placeholder*="수령인"], input[placeholder*="받는분"], input[placeholder*="받으실"]'
        );
        for (const el of all) {
          if (el && el.value && String(el.value).trim()) {
            return String(el.value).trim();
          }
        }
      } catch (e) {}

      // 3순위: "배송 정보" 섹션 안에서 첫 번째 텍스트 input
      try {
        const allHeaders = document.querySelectorAll("*");
        for (const h of allHeaders) {
          const text = ((h.innerText || "") + "").replace(/\s/g, "");
          if (
            text === "배송정보" ||
            text === "배송지정보" ||
            text === "배송지"
          ) {
            // 이 헤더의 부모 컨테이너 안의 input들 스캔
            const container =
              h.closest("section") ||
              h.closest('div[class*="css-"]') ||
              h.parentElement;
            if (container) {
              const inputs = container.querySelectorAll(
                'input[type="text"], input:not([type])'
              );
              for (const inp of inputs) {
                const ph = (inp.getAttribute("placeholder") || "").toLowerCase();
                // 전화번호/우편번호/주소 input은 건너뜀
                if (
                  ph.includes("전화") ||
                  ph.includes("연락처") ||
                  ph.includes("우편") ||
                  ph.includes("주소") ||
                  ph.includes("상세")
                ) {
                  continue;
                }
                if (inp.value && String(inp.value).trim()) {
                  return String(inp.value).trim();
                }
              }
            }
            break;
          }
        }
      } catch (e) {}

      return "";
    } catch (e) {
      console.warn(LOG_PREFIX + "readReceiverName error (ignored):", e);
      return "";
    }
  }

  /**
   * ✅ "총 주문금액" 옆 span 값만 읽는다.
   */
  function findTotalOrderAmountStrict() {
    try {
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
    } catch (e) {
      console.warn(LOG_PREFIX + "findTotalOrderAmountStrict error:", e);
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

      // ✅ ITEM_NAME: 20자 + 55byte 제한 적용
      const safeItemName = limitItemName(params.itemName || "상품") || "상품";

      // ✅ 구매자명 결정 로직:
      //    1순위: params.receiverName (배송지 수령인) — 새 저장값
      //    2순위: params.userName (주문자명) — 기존 fallback
      //    → 어느 것도 없으면 빈 문자열로 SDK에 전달 (결제 자체는 진행)
      let safeReceiverName = "";
      try {
        safeReceiverName = String(params.receiverName || "").trim();
      } catch (e) {}

      let safeUserName = "";
      try {
        safeUserName = String(params.userName || "").trim();
      } catch (e) {}

      // 구매자명 최종 (수령인 우선, 없으면 주문자명)
      const finalPayerName = safeReceiverName || safeUserName || "";

      let safeUserTel = "";
      let safeUserEmail = "";
      try {
        safeUserTel = String(params.userTel || "").trim();
      } catch (e) {}
      try {
        safeUserEmail = String(params.userEmail || "").trim();
      } catch (e) {}

      console.log(
        LOG_PREFIX + "Final payerName for receipt:",
        finalPayerName,
        "(receiver:",
        safeReceiverName,
        "/ orderer:",
        safeUserName,
        ")"
      );

      // ✅ SDK 호출 자체를 try-catch로 감싸서 절대 결제가 안 막히도록
      try {
        MARU.pay({
          payRoute: "3d",
          responseFunction: window.paymentResultByJS,
          publicKey: CONFIG.PUBLIC_KEY,
          trackId: params.trackId,
          amount: params.amount,
          redirectUrl:
            window.location.origin + getRedirectUrl(CONFIG.PATHS.SUCCESS),
          itemName: safeItemName,

          // 기존 키 (호환성 유지)
          userEmail: safeUserEmail,
          userName: finalPayerName,
          userTel: safeUserTel,

          // ✅ SDK clientsideV2.js 표준 키 (영수증 PURCHASER 매핑)
          payerName: finalPayerName,
          payerTel: safeUserTel,

          mode: "layer",
          debugMode: "live",
        });
      } catch (err) {
        console.error(LOG_PREFIX + "MARU.pay call failed:", err);
        alert("결제창을 여는 중 오류가 발생했습니다. 다시 시도해 주세요.");
      }
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
        const paymentHeader = headers.find((h) => {
          const text = (h.innerText || "").replace(/\s/g, "");
          return text.includes("결제수단");
        });
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
      // ✅ 모든 추출은 try-catch로 보호 (오류 나도 결제 진행)
      let ordererName = "";
      let ordererTel = "";
      let ordererEmail = "";
      let receiverName = "";

      try {
        ordererName =
          document.querySelector('input[name="ordererName"]')?.value || "";
      } catch (e) {}
      try {
        ordererTel =
          document.querySelector('input[name="ordererCall"]')?.value || "";
      } catch (e) {}
      try {
        ordererEmail =
          document.querySelector('input[name="ordererEmail"]')?.value || "";
      } catch (e) {}

      // ✅ 배송지 수령인 (오류 나도 결제 진행)
      try {
        receiverName = readReceiverName();
      } catch (e) {
        console.warn(LOG_PREFIX + "readReceiverName failed (ignored):", e);
      }

      // Item name (best effort)
      let itemName = "상품";
      try {
        const itemNameEl =
          document.querySelector(".css-a0a2v3") ||
          document.querySelector("._product_name") ||
          document.querySelector('[class*="product"] [class*="name"]');
        itemName = itemNameEl ? (itemNameEl.innerText || "").trim() : "상품";
        itemName = limitItemName(itemName) || "상품";
      } catch (e) {
        itemName = "상품";
      }

      // Qty
      let qty = "1";
      try {
        const qtyEl =
          document.querySelector(".css-15fzge") ||
          document.querySelector("._product_qty");
        qty = qtyEl ? extractNumber(qtyEl.innerText) || "1" : "1";
      } catch (e) {}

      const totalAmount = findTotalOrderAmountStrict();

      let method = overrideMethod;
      if (!method) {
        try {
          const uiState = localStorage.getItem("payMethod");
          if (uiState === "CreditCard") method = "CREDIT";
          else if (uiState === "BankTransfer") method = "BANK";
          else method = "BANK";
        } catch (e) {
          method = "BANK";
        }
      }

      const urlOrderNo = getURLParam("order_no");
      const paymentData = {
        orderNo: urlOrderNo || "ORD-" + Date.now(),
        amount: totalAmount,
        userName: ordererName,       // 주문자명 (기존)
        userTel: ordererTel,
        userEmail: ordererEmail,
        receiverName: receiverName,  // ✅ 배송지 수령인 (신규 추가)
        itemName: itemName,
        qty: qty,
        method: method,
      };

      try {
        localStorage.setItem("fintree_pay_data", JSON.stringify(paymentData));
      } catch (e) {
        console.warn(LOG_PREFIX + "localStorage.setItem failed:", e);
      }

      console.log(
        LOG_PREFIX + `Saved fintree_pay_data [${source}] =>`,
        paymentData
      );

      if (!totalAmount || totalAmount === "0") {
        console.warn(LOG_PREFIX + "Amount not found => 0 (blocked)");
      }
      return paymentData;
    }

    window.addEventListener("load", function () {
      // ✅ 주문자 정보 input 이벤트
      try {
        ["ordererName", "ordererCall", "ordererEmail"].forEach((name) => {
          const el = document.querySelector(`input[name="${name}"]`);
          if (el) el.addEventListener("input", () => saveCurrentState("Input"));
        });
      } catch (e) {}

      // ✅ 배송지 수령인 input 이벤트 (여러 이름 후보)
      try {
        [
          "receiverName",
          "deliveryReceiver",
          "receiver",
        ].forEach((name) => {
          const el = document.querySelector(`input[name="${name}"]`);
          if (el)
            el.addEventListener("input", () =>
              saveCurrentState("Receiver Input")
            );
        });

        // placeholder 기반 수령인 input에도 리스너 추가
        const receiverInputs = document.querySelectorAll(
          'input[placeholder*="수령인"], input[placeholder*="받는분"]'
        );
        receiverInputs.forEach((el) => {
          el.addEventListener("input", () =>
            saveCurrentState("Receiver Input(placeholder)")
          );
        });
      } catch (e) {}

      // Keep amount fresh (DOM changes)
      setInterval(() => {
        if (pathMatches(CONFIG.PATHS.INFO)) {
          try {
            saveCurrentState("Timer");
          } catch (e) {}
        }
      }, 1000);

      // On "결제하기" click: save then allow Imweb submit
      document.addEventListener(
        "click",
        function (e) {
          try {
            const btn = e.target.closest(
              'button[type="submit"], ._btn_payment, .css-1tf84sl, .css-clap0e'
            );
            if (btn && (btn.innerText || "").includes("결제하기")) {
              console.log(
                LOG_PREFIX +
                  "결제하기 clicked -> save state then allow submit"
              );
              saveCurrentState("Submit Click");
              return true;
            }
          } catch (err) {
            console.warn(LOG_PREFIX + "click handler error (ignored):", err);
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

      // ✅ complete 페이지에서도 수령인 한 번 더 시도 (DOM에 있으면)
      let liveReceiverName = "";
      try {
        liveReceiverName = readReceiverName();
      } catch (e) {}

      const params = {
        trackId:
          urlOrderNo ||
          (stored && stored.orderNo) ||
          "ORD-" + Date.now(),
        amount: stored && stored.amount ? String(stored.amount) : "0",
        userName: (stored && stored.userName) || "",
        userTel: (stored && stored.userTel) || "",
        userEmail: (stored && stored.userEmail) || "",
        receiverName:
          (stored && stored.receiverName) || liveReceiverName || "",
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

      if (stored && stored.method === "CREDIT") {
        console.log(
          LOG_PREFIX + "CREDIT intent detected -> open payment layer now"
        );
        try {
          createLoadingOverlay();
        } catch (e) {}
        executePay(params);
      } else {
        console.log(LOG_PREFIX + "BANK intent or unknown -> no auto payment");
      }
    });
  }

  // ---------------- Router ----------------

  function initRouter() {
    try {
      if (pathMatches(CONFIG.PATHS.INFO)) handleShopPayment();
      else if (pathMatches(CONFIG.PATHS.CONFIRM)) handleShopPaymentComplete();
    } catch (e) {
      console.error(LOG_PREFIX + "Router error (script continues):", e);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initRouter);
  } else {
    initRouter();
  }
})();
