/**
 * Fintree Payment Universal Script (GNUBoard5 전용)
 * 대상: 영카트5 / 그누보드5
 * 특징:
 * - 주문서(orderform.php) 구조 기준
 * - 총 주문금액 ONLY 사용
 * - 카드결제 / 무통장 UI 커스텀
 * - itemName 20자 + 55byte 제한
 * - orderformupdate.php 직전 실행
 */

(function () {
  const LOG_PREFIX = "[Fintree G5] ";

  // ---------------- CONFIG ----------------

  const CONFIG = {
    PUBLIC_KEY: "pk_1fc0-d72bd2-31f-a22a1",
    TID: "TMN009875",

    PATHS: {
      ORDER: "/shop/orderform.php",
      COMPLETE: "/shop/orderinquiryview.php",
      SUCCESS: "/payment-success.php",
      CANCEL: "/payment-cancel.php",
    },
  };

  // ---------------- UTIL ----------------

  function extractNumber(text) {
    if (!text) return "0";
    return String(text).replace(/[^\d]/g, "") || "0";
  }

  function utf8ByteLength(str) {
    try {
      return new TextEncoder().encode(str).length;
    } catch (e) {
      return unescape(encodeURIComponent(str)).length;
    }
  }

  function utf8Truncate(str, maxBytes) {
    let s = String(str || "");

    while (utf8ByteLength(s) > maxBytes) {
      s = s.slice(0, -1);
    }

    return s;
  }

  function limitItemName(str) {
    str = String(str || "")
      .replace(/\s+/g, " ")
      .trim();

    str = str.slice(0, 20);

    return utf8Truncate(str, 55);
  }

  function pathIncludes(path) {
    return location.pathname.indexOf(path) !== -1;
  }

  // ---------------- 금액 찾기 ----------------

  function getTotalAmount() {
    // 영카트5 총 주문금액 영역
    const selectors = [
      "#od_tot_price",
      ".tot_price .price",
      ".order_total_price",
      "#sc_price",
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);

      if (!el) continue;

      const amount = extractNumber(el.innerText);

      if (parseInt(amount, 10) > 0) {
        console.log(LOG_PREFIX + "Amount detected:", amount);
        return amount;
      }
    }

    console.warn(LOG_PREFIX + "Amount not found");
    return "0";
  }

  // ---------------- 상품명 ----------------

  function getItemName() {
    const selectors = [
      ".sod_name",
      ".goods_name",
      ".item_name",
      ".od_prd_name",
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);

      if (!el) continue;

      const txt = (el.innerText || "").trim();

      if (txt) {
        return limitItemName(txt);
      }
    }

    return "상품";
  }

  // ---------------- 저장 ----------------

  function savePaymentData(method) {
    const orderNo =
      document.querySelector('input[name="od_id"]')?.value ||
      "ORD-" + Date.now();

    const userName =
      document.querySelector('input[name="od_name"]')?.value || "";

    const userTel =
      document.querySelector('input[name="od_hp"]')?.value || "";

    const userEmail =
      document.querySelector('input[name="od_email"]')?.value || "";

    const amount = getTotalAmount();

    const itemName = getItemName();

    const data = {
      orderNo,
      userName,
      userTel,
      userEmail,
      amount,
      itemName,
      method,
    };

    localStorage.setItem("fintree_pay_data", JSON.stringify(data));

    console.log(LOG_PREFIX + "Saved:", data);

    return data;
  }

  // ---------------- SDK ----------------

  function executePay(params) {
    console.log(LOG_PREFIX + "executePay", params);

    if (typeof MARU === "undefined") {
      alert("결제모듈 로딩 실패");
      return;
    }

    MARU.pay({
      payRoute: "3d",
      responseFunction: paymentResultByJS,

      publicKey: CONFIG.PUBLIC_KEY,

      trackId: params.orderNo,
      amount: params.amount,

      itemName: params.itemName,

      userName: params.userName,
      userTel: params.userTel,
      userEmail: params.userEmail,

      redirectUrl:
        location.origin + CONFIG.PATHS.SUCCESS,

      mode: "layer",
      debugMode: "live",
    });
  }

  // ---------------- CALLBACK ----------------

  window.paymentResultByJS = function (data) {
    console.log(LOG_PREFIX + "callback:", data);

    if (!data || !data.result) {
      return;
    }

    const resultCd = data.result.resultCd;

    if (resultCd === "0000") {
      location.href =
        CONFIG.PATHS.SUCCESS +
        "?trackId=" +
        encodeURIComponent(data.pay.trackId);
    } else {
      location.href =
        CONFIG.PATHS.CANCEL +
        "?msg=" +
        encodeURIComponent(data.result.resultMsg || "결제실패");
    }
  };

  // ---------------- UI ----------------

  function injectPaymentButtons() {
    const target =
      document.querySelector("#sod_frm_paysel") ||
      document.querySelector(".order_pay_area");

    if (!target) {
      console.warn(LOG_PREFIX + "payment area not found");
      return;
    }

    if (document.querySelector(".fintree-pay-ui")) {
      return;
    }

    const wrap = document.createElement("div");

    wrap.className = "fintree-pay-ui";

    wrap.innerHTML = `
      <style>
        .fintree-pay-ui{
          margin:20px 0;
        }

        .fintree-pay-buttons{
          display:flex;
          gap:10px;
        }

        .fintree-pay-buttons button{
          flex:1;
          padding:15px;
          border:1px solid #ddd;
          background:#fff;
          border-radius:8px;
          font-size:16px;
          font-weight:700;
          cursor:pointer;
        }

        .fintree-pay-buttons button.active{
          background:#111;
          color:#fff;
          border-color:#111;
        }

        .fintree-guide{
          margin-bottom:15px;
          line-height:1.6;
          font-size:13px;
          color:#666;
        }
      </style>

      <div class="fintree-guide">
        카드결제 오류 시 카카오톡으로 문의해주세요.<br>
        법인카드 결제는 별도 문의 바랍니다.
      </div>

      <div class="fintree-pay-buttons">
        <button type="button" data-method="CREDIT" class="active">
          💳 카드결제
        </button>

        <button type="button" data-method="BANK">
          🏦 무통장입금
        </button>
      </div>
    `;

    target.prepend(wrap);

    let currentMethod = "CREDIT";

    const buttons = wrap.querySelectorAll("button");

    buttons.forEach((btn) => {
      btn.addEventListener("click", function () {
        buttons.forEach((b) => b.classList.remove("active"));

        this.classList.add("active");

        currentMethod = this.dataset.method;

        console.log(LOG_PREFIX + "Method:", currentMethod);
      });
    });

    // ---------------- 주문버튼 가로채기 ----------------

    const submitBtn =
      document.querySelector("#btn_submit") ||
      document.querySelector(".btn_submit");

    if (!submitBtn) {
      console.warn(LOG_PREFIX + "submit button not found");
      return;
    }

    submitBtn.addEventListener(
      "click",
      function (e) {
        if (currentMethod !== "CREDIT") {
          savePaymentData("BANK");
          return true;
        }

        e.preventDefault();
        e.stopPropagation();

        const params = savePaymentData("CREDIT");

        if (!params.amount || params.amount === "0") {
          alert("결제금액을 읽지 못했습니다.");
          return false;
        }

        executePay(params);

        return false;
      },
      true
    );

    console.log(LOG_PREFIX + "Custom UI injected");
  }

  // ---------------- INIT ----------------

  function init() {
    console.log(LOG_PREFIX + "init");

    if (pathIncludes(CONFIG.PATHS.ORDER)) {
      injectPaymentButtons();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
