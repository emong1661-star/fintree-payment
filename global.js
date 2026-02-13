/**
 * Fintree Payment Universal Script (Vercel Hosted)
 * Combined with Payment Induction & Server-side Verification
 */

(function () {
    const LOG_PREFIX = "[Fintree Vercel] ";


    // --- Domain Restriction ---
    // 허용된 도메인 리스트
    const ALLOWED_HOSTNAMES = [
        'qorekdnsqor1.imweb.me',
        'bagdown.shop',
        'kmcompany01.shop',
        'whggkqtycld1.imweb.me',
        'localhost',
        '127.0.0.1',
        'bagdown-payment.netlify.app'
    ];

    if (!ALLOWED_HOSTNAMES.includes(location.hostname) && !location.hostname.endsWith('.vercel.app')) {
        console.warn(LOG_PREFIX + "Script execution blocked: Domain not allowed (" + location.hostname + ")");
        return;
    }
    // ---------------------------




    console.log(LOG_PREFIX + "Initialized. Protocol:", location.protocol, "Path:", location.pathname);

    // --- Configurations ---

    // 스크립트가 로드된 호스트 도메인을 동적으로 감지 (API 호출 경로 자동 설정)
    let hostedDomain = 'https://bagdown-payment.netlify.app'; // 기본값 (새 프로젝트)
    try {
        if (document.currentScript && document.currentScript.src) {
            const scriptUrl = new URL(document.currentScript.src);
            hostedDomain = scriptUrl.origin;
        }
    } catch (e) {
        console.warn(LOG_PREFIX + "Failed to detect hosted domain, using default:", hostedDomain);
    }

    const CONFIG = {
        PUBLIC_KEY: 'pk_1fc0-d72bd2-31f-a22a1',
        TID: 'TMN009875',
        VERIFY_API: '/api/verify',
        HOSTED_DOMAIN: hostedDomain,
        PATHS: {
            INFO: '/shop_payment',
            CONFIRM: '/shop_payment_complete',
            SUCCESS: '/payment-success',
            CANCEL: '/payment-cancel',
            REFUND: '/payment-refund'
        }
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
        return currentPath === targetPath ||
            currentPath === targetPath + '.html' ||
            currentPath === targetPath + '/' ||
            currentPath.endsWith(targetPath + '.html');
    }

    function getRedirectUrl(targetPath) {
        const isLocal = location.pathname.endsWith('.html') || location.protocol === 'file:';
        return targetPath + (isLocal ? '.html' : '');
    }

    function getURLParam(name) {
        const results = new RegExp("[\\?&]" + name + "=([^&#]*)").exec(location.search);
        return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
    }

    // --- Page Handlers ---

    // --- Shared Payment Logic ---

    function createLoadingOverlay() {
        if (document.getElementById('fnt-loading-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'fnt-loading-overlay';
        overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(255,255,255,1); z-index:9998; display:flex; flex-direction:column; align-items:center; justify-content:center; font-family:sans-serif; transition: opacity 0.5s;';
        const style = document.createElement('style');
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
        setTimeout(function () {
            if (typeof MARU !== 'undefined') {
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
                    mode: 'layer',
                    debugMode: 'live'
                });
            } else {
                console.error(LOG_PREFIX + "MARU SDK Not Found.");
                alert("결제 모듈을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
                location.reload();
            }
        }, 500);
    }

    window.paymentResultByJS = function (data) {
        console.log(LOG_PREFIX + "SDK Callback Data Received:", data);
        if (!data || !data.result) return;

        var resultCd = data.result.resultCd;
        var resultMsg = data.result.resultMsg || '';
        var advanceMsg = data.result.advanceMsg || resultMsg;

        if (resultCd === '0000') {
            // 결제 성공
            var trackId = (data.pay && data.pay.trackId) ? data.pay.trackId : getURLParam('order_no');
            console.log(LOG_PREFIX + "Payment Success! Redirecting to Result Page...");
            location.href = getRedirectUrl(CONFIG.PATHS.SUCCESS) + '?status=success&trackId=' + trackId;
        } else {
            // 결제 실패 또는 취소
            console.warn(LOG_PREFIX + "Payment Failed/Cancelled. Code:", resultCd, "Msg:", advanceMsg);
            location.href = getRedirectUrl(CONFIG.PATHS.CANCEL) + '?msg=' + encodeURIComponent(advanceMsg);
        }
    };

    function handleShopPayment() {
        console.log(LOG_PREFIX + "Routing: Order Info Page");

        function injectCustomPaymentUI() {
            const checkInterval = setInterval(() => {
                // 결제수단 섹션 찾기 (헤더 텍스트로 찾음)
                const headers = Array.from(document.querySelectorAll('header, h2, h3, .title, .css-17g8nhj')); // .css-17g8nhj 추가
                const paymentHeader = headers.find(h => h.innerText.includes('결제수단'));

                if (!paymentHeader) return;

                const paymentSection = paymentHeader.closest('div[class*="css-"]') || paymentHeader.closest('.pay-method-section') || paymentHeader.parentElement;
                if (!paymentSection) return;

                // 이미 주입되었는지 확인, 혹은 이미 커스텀 UI가 있는지
                if (paymentSection.querySelector('.pay-method-custom')) {
                    clearInterval(checkInterval);
                    return;
                }

                // 무통장입금 라디오 버튼 찾기 (필수)
                const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
                const bankRadio = radios.find(r => r.value && r.value.includes('OPM01'));

                if (!bankRadio) return;

                // 무통장입금 라디오 강제 선택
                if (!bankRadio.checked) {
                    bankRadio.click();
                }

                // [중요] 입금자명/은행선택 컨테이너(.css-1hw29i9)를 찾아서 추출 (fieldset 숨기기 전에 대피)
                // shop_payment.html 구조상: fieldset -> div -> div.css-1hw29i9
                // 이 요소를 커스텀 UI 쪽으로 이동시켜야 함.
                let depositorBlock = document.querySelector('.css-1hw29i9');
                if (!depositorBlock) {
                    // 클래스가 없을 경우 input의 부모를 찾음
                    const input = document.querySelector('input[placeholder*="입금자명"]') || document.querySelector('input[name="depositor"]');
                    if (input) {
                        depositorBlock = input.closest('div') === input.parentElement ? input.parentElement : input.closest('div');
                        // 만약 부모가 label이면 그 위
                        if (depositorBlock && depositorBlock.tagName === 'LABEL') depositorBlock = depositorBlock.parentElement;
                    }
                }

                console.log(LOG_PREFIX + "Depositor Block found for extraction:", depositorBlock);

                // 커스텀 UI HTML 생성
                const customUI = document.createElement('div');
                customUI.className = 'pay-method-custom';
                customUI.innerHTML = `
                <style>
                    .pay-method-custom { display: flex; flex-direction: column; gap: 15px; margin: 15px 0; }
                    .pay-method-buttons { display: flex; gap: 10px; }
                    .pay-method-custom button {
                        flex: 1;
                        padding: 15px;
                        border: 1px solid #ddd;
                        border-radius: 8px;
                        background: #fff;
                        font-weight: bold;
                        cursor: pointer;
                        font-size: 16px;
                    }
                    .pay-method-custom button.active {
                        border-color: #333;
                        background: #333;
                        color: #fff;
                    }
                    .pay-guide-text { font-size: 13px; color: #666; margin-bottom: 5px; line-height: 1.5; }
                    /* 이식된 입금자명 컨테이너 스타일 보정 */
                    .moved-depositor-block { margin-top: 10px; padding: 10px; border: 1px solid #eee; border-radius: 4px; background: #fafafa; }
                </style>
                <div class="pay-guide-text">
                    * 아래 버튼을 눌러 결제수단을 선택해주세요.<br>
                    * 카드결제 오류 시 <a href="#" onclick="alert('카드사 정책에 따라 할부가 제한될 수 있습니다.'); return false;">고객센터</a>로 문의주세요.
                </div>
                <div class="pay-method-buttons">
                    <button type="button" data-method="CREDIT" class="active">💳 카드결제</button>
                    <button type="button" data-method="BANK">🏦 무통장입금</button>
                </div>
                <div id="fnt-depositor-area"></div>
            `;

                // 헤더 바로 다음에 주입
                paymentHeader.insertAdjacentElement('afterend', customUI);

                // 입금자명 입력란 커스텀 UI로 이동
                if (depositorBlock) {
                    depositorBlock.classList.add('moved-depositor-block');
                    customUI.querySelector('#fnt-depositor-area').appendChild(depositorBlock);
                }

                // [중요] 이제 기존 fieldset 숨기기
                const fieldset = bankRadio.closest('fieldset');
                if (fieldset) {
                    fieldset.style.display = 'none';
                }

                // 이벤트 리스너
                const buttons = customUI.querySelectorAll('button');
                const bankSelect = document.querySelector('select[name^="cash_idx"]');
                const depositorInput = customUI.querySelector('input[placeholder*="입금자명"]') || customUI.querySelector('input[name="depositor"]');

                // 초기 상태 설정
                updatePaymentState('CREDIT', bankSelect, depositorInput, depositorBlock);

                buttons.forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const method = e.target.getAttribute('data-method');
                        console.log(LOG_PREFIX + "Button Clicked:", method);

                        buttons.forEach(b => b.classList.remove('active'));
                        e.target.classList.add('active');

                        updatePaymentState(method, bankSelect, depositorInput, depositorBlock);
                    });
                });

                console.log(LOG_PREFIX + "Custom Payment UI Injected & Block Extracted");
                clearInterval(checkInterval);

            }, 500);
        }

        function updatePaymentState(method, bankSelect, depositorInput, depositorBlock) {
            console.log(LOG_PREFIX + "updatePaymentState:", method, depositorBlock);

            // 1. localStorage 저장
            const stateMethod = method === 'CREDIT' ? 'CreditCard' : 'BankTransfer';
            localStorage.setItem('payMethod', stateMethod);

            // 2. 입력란/블록 표시/숨김
            // 유저 제안: "display: flex" 사용
            if (depositorBlock) {
                if (method === 'CREDIT') {
                    depositorBlock.style.display = 'none';
                    if (depositorInput) depositorInput.value = '카드결제';
                } else {
                    depositorBlock.style.display = 'flex'; // 혹은 block. 유저 요청대로 flex 시도
                    depositorBlock.style.flexDirection = 'column'; // 보통 세로 정렬이 안전함
                    depositorBlock.style.gap = '8px';
                    if (depositorInput && depositorInput.value === '카드결제') depositorInput.value = '';
                }
            } else if (depositorInput) {
                // 블록을 못 찾았을 경우 input이라도 제어
                depositorInput.style.display = (method === 'CREDIT') ? 'none' : 'block';
            }

            // 3. 계좌 선택
            if (bankSelect) {
                if (bankSelect.options.length > 1) {
                    const index = (method === 'CREDIT') ? 0 : 1;
                    if (bankSelect.options.length > index) {
                        bankSelect.selectedIndex = index;
                        bankSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
            }
        }

        function saveCurrentState(source = "Manual", overrideMethod = null) {
            let ordererName = document.querySelector('input[name="ordererName"]')?.value || '';
            let ordererTel = document.querySelector('input[name="ordererCall"]')?.value || '';
            let ordererEmail = document.querySelector('input[name="ordererEmail"]')?.value || '';

            if (!ordererName || !ordererTel) {
                // 1. "주문자 정보" 헤더 찾기 (다양한 선택자 시도)
                const headers = Array.from(document.querySelectorAll('header, h2, h3, .title, .css-17g8nhj'));
                const orderHeader = headers.find(h => {
                    const text = h.innerText.replace(/\s/g, '');
                    return text.includes('주문자정보') || text.includes('주문자');
                });

                if (orderHeader) {
                    // 헤더의 부모 컨테이너 범위 내에서 정보를 찾음
                    // 1차 시도: 바로 다음 형제 요소 (div.content 등)
                    // 2차 시도: 부모의 자식들 중 header가 아닌 것들
                    let container = orderHeader.nextElementSibling;
                    if (!container || container.tagName === 'HR') container = orderHeader.parentElement;

                    if (container) {
                        // 2. 텍스트 노드 추출 (p, span, div)
                        // 입력 필드가 아닌 텍스트로 된 정보 추출 시도
                        const candidates = Array.from(container.querySelectorAll('p, span, div'))
                            .filter(el => {
                                // 자식이 없는 '말단' 요소이거나, 텍스트만 포함한 요소
                                if (el.children.length > 0 && el.innerText.length > 50) return false;
                                const text = el.innerText.trim();
                                if (text.length < 2) return false;
                                if (text.includes('가상계좌') || text.includes('무통장') || text.includes('입금')) return false;
                                if (['수정', '관리자'].includes(text)) return false;
                                return true;
                            });

                        // 전화번호 패턴 (010-XXXX-XXXX) 찾기
                        const telRegex = /01[016789]-?\d{3,4}-?\d{4}/;
                        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

                        candidates.forEach(el => {
                            const text = el.innerText.trim();
                            if (!ordererTel && telRegex.test(text)) ordererTel = text.match(telRegex)[0];
                            if (!ordererEmail && emailRegex.test(text)) ordererEmail = text;
                            // 이름: 전화번호나 이메일이 아니고, 길이가 적당하며, 한글인 경우 (대략적 추측)
                            if (!ordererName && !telRegex.test(text) && !emailRegex.test(text) && /^[가-힣]{2,5}$/.test(text)) {
                                ordererName = text;
                            }
                        });

                        // 3. Fallback: 순서 기반 (이름 -> 전화번호)
                        if (!ordererName && candidates.length >= 2) {
                            ordererName = candidates[0].innerText.trim();
                            if (!ordererTel) ordererTel = candidates[1].innerText.trim();
                        }
                    }
                }
            }

            const itemNameEl = document.querySelector('.css-a0a2v3') || document.querySelector('._product_name');
            const qtyEl = document.querySelector('.css-15fzge') || document.querySelector('._product_qty');
            const totalAmountEl = document.querySelector('.css-x99dng') || document.querySelector('.css-z3pbio') || document.querySelector('.css-1i1erzf') || document.querySelector('._total_price') || document.querySelector('.total_price');

            const itemName = itemNameEl ? itemNameEl.innerText.trim() : '상품';
            const qty = qtyEl ? qtyEl.innerText.replace(/[^0-9]/g, '') : '1';
            const totalAmount = totalAmountEl ? totalAmountEl.innerText.replace(/[^0-9]/g, '') : '0';

            let method = overrideMethod;
            if (!method) {
                // [Fix] 커스텀 UI 상태(payMethod)를 우선 확인
                const uiState = localStorage.getItem('payMethod');
                if (uiState === 'CreditCard') {
                    method = 'CREDIT';
                } else if (uiState === 'BankTransfer') {
                    method = 'BANK';
                } else {
                    // Fallback: DOM에서 활성화된 버튼 찾기
                    const activeBtn = document.querySelector('.pay-method-custom button.active');
                    method = activeBtn ? activeBtn.getAttribute('data-method') : 'BANK';
                }
            }

            let urlOrderNo = getURLParam('order_no');
            const paymentData = {
                orderNo: urlOrderNo || ('ORD-' + new Date().getTime()),
                amount: totalAmount,
                userName: ordererName,
                userTel: ordererTel,
                userEmail: ordererEmail,
                itemName: itemName,
                qty: qty,
                method: method
            };

            if (totalAmount !== '0') {
                localStorage.setItem('fintree_pay_data', JSON.stringify(paymentData));
                console.log(LOG_PREFIX + `Auto-Save [${source}] [${method}]:`, paymentData);
                return paymentData; // Return data for direct use
            }
            return null;
        }

        window.addEventListener('load', function () {
            // injectCreditCardOption 함수는 더 이상 사용하지 않음
            // injectCreditCardOption(); 

            const inputNames = ["ordererName", "ordererCall", "ordererEmail"];
            inputNames.forEach(name => {
                const el = document.querySelector(`input[name="${name}"]`);
                if (el) el.addEventListener('input', () => saveCurrentState("Input Event"));
            });

            setInterval(() => {
                if (pathMatches(CONFIG.PATHS.INFO)) saveCurrentState("Background Timer");
            }, 2000);

            document.addEventListener('click', function (e) {
                // 버튼 식별 (기존 클래스 + case2 클래스 css-clap0e 추가)
                const btn = e.target.closest('button[type="submit"], ._btn_payment, .css-1tf84sl, .css-clap0e');
                if (btn && btn.innerText.includes('결제하기')) {
                    console.log(LOG_PREFIX + "Payment button clicked. Allowing form submission.");

                    // localStorage에서 저장된 의도 확인 (라디오 버튼 상태와 무관)
                    try {
                        const stored = JSON.parse(localStorage.getItem('fintree_pay_data'));
                        if (stored && stored.method === 'CREDIT') {
                            console.log(LOG_PREFIX + "Stored intent: CREDIT -> Will process on next page");
                        } else {
                            console.log(LOG_PREFIX + "Stored intent: BANK or undefined -> Normal Imweb flow");
                        }
                    } catch (e) {
                        console.log(LOG_PREFIX + "No stored data");
                    }

                    // 무조건 폼 제출 허용 (아임웹이 무통장입금으로 주문 생성 후 리다이렉트)
                    return true;
                }
            }, true);
        });

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', injectCustomPaymentUI);
        } else {
            injectCustomPaymentUI();
        }

        // 주기적으로 상태 저장
        setInterval(() => {
            saveCurrentState();
        }, 1000);
    }

    function handleShopPaymentComplete() {
        console.log(LOG_PREFIX + "Routing: Auth/Confirmation Page");

        // 버튼 생성 감시 함수
        function startButtonWatcher(p) {
            const observer = new MutationObserver((mutations, obs) => {
                const container = document.querySelector('.css-k008qs');
                if (container && !document.querySelector('.pay-button-fintree')) {
                    const btn = document.createElement('a');
                    btn.href = 'javascript:void(0)';
                    btn.className = 'pay-button css-fi2s5q pay-button-fintree';
                    btn.innerText = '신용카드';
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

        window.addEventListener('load', function () {
            // URL 파라미터에서 주문 정보 수집 시도 (아임웹이 넘겨주는 order_no 등)
            let params = {
                trackId: getURLParam('order_no'),
                amount: '0',
                userName: '',
                userTel: '',
                userEmail: '',
                itemName: '상품'
            };

            // localStorage에서 보완 정보 가져오기
            try {
                var stored = JSON.parse(localStorage.getItem('fintree_pay_data'));
                if (stored) {
                    // 주문번호(trackId)는 URL의 것이 가장 정확하므로 우선순위
                    if (!params.trackId) params.trackId = stored.orderNo;
                    if (stored.amount) params.amount = stored.amount;
                    params.userName = stored.userName;
                    params.userTel = stored.userTel;
                    params.userEmail = stored.userEmail;

                    var baseName = stored.itemName || "상품";
                    if (baseName.length > 20) baseName = baseName.substring(0, 20) + "...";
                    params.itemName = baseName + (stored.qty > 1 ? " 외 " + (stored.qty - 1) + "건" : "");

                    // [핵심 수정] URL의 order_no가 localStorage와 다르면 localStorage 갱신
                    // shop_payment_complete 페이지의 order_no가 실제 결제에 사용되는 trackId이므로
                    if (params.trackId && params.trackId !== stored.orderNo) {
                        console.log(LOG_PREFIX + "Updating localStorage orderNo:", stored.orderNo, "->", params.trackId);
                        stored.orderNo = params.trackId;
                        localStorage.setItem('fintree_pay_data', JSON.stringify(stored));
                    }

                    // 무통장입금일 경우 -> 버튼 생성만 (자동 실행 X)
                    startButtonWatcher(params);

                    // 신용카드 결제 의도였는지 확인
                    if (stored.method === 'CREDIT') {
                        console.log(LOG_PREFIX + "Detected CREDIT intent from previous step. Launching Payment...");

                        // 이미 결제 완료된 건인지 체크 (중복 실행 방지)
                        if (stored.status === 'DONE') {
                            console.log("Payment already completed for this session.");
                            return;
                        }

                        // 결제 실행
                        createLoadingOverlay();

                        executePay(params);
                    }
                }
            } catch (e) {
                console.error(LOG_PREFIX + "Storage Parse Error", e);
            }
        });
    }

    function handlePaymentSuccess() {
        console.log(LOG_PREFIX + "Routing: Result Page");

        // SDK redirect 방식의 result JSON 파라미터 파싱
        function parseSDKResult() {
            try {
                const resultParam = getURLParam('result');
                if (resultParam) {
                    let cleaned = resultParam;
                    // 1단계: 앞뒤 따옴표 제거 (SDK가 "{ ... }" 형태로 감싸서 보냄)
                    if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
                        cleaned = cleaned.slice(1, -1);
                    }
                    // 2단계: 이스케이프된 따옴표 복원
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
            const status = getURLParam('status');
            let trackId = getURLParam('trackId');
            let trxId = null;
            let sdkResult = null;

            // --- 1단계: SDK 결과에서 정보 추출 ---
            sdkResult = parseSDKResult();
            if (sdkResult && sdkResult.pay) {
                if (!trackId && sdkResult.pay.trackId) {
                    trackId = sdkResult.pay.trackId;
                    console.log(LOG_PREFIX + "TrackId from SDK result:", trackId);
                }
                if (sdkResult.pay.trxId) {
                    trxId = sdkResult.pay.trxId;
                    console.log(LOG_PREFIX + "TrxId from SDK result:", trxId);
                }
            }

            // Fallback: localStorage에서 trackId
            if (!trackId) {
                try {
                    const stored = JSON.parse(localStorage.getItem('fintree_pay_data'));
                    if (stored && stored.orderNo) {
                        trackId = stored.orderNo;
                        console.log(LOG_PREFIX + "TrackId from localStorage:", trackId);
                    }
                } catch (e) { }
            }

            // --- 2단계: 필수값 기반 성공 판정 (SDK 결과 신뢰) ---
            let isSuccess = false;

            // 판정 조건 1: SDK result에서 resultCd가 0000
            if (sdkResult && sdkResult.result && sdkResult.result.resultCd === '0000') {
                isSuccess = true;
                console.log(LOG_PREFIX + "SUCCESS: SDK resultCd is 0000");
            }
            // 판정 조건 2: URL에 status=success + trackId 존재
            else if (status === 'success' && trackId) {
                isSuccess = true;
                console.log(LOG_PREFIX + "SUCCESS: URL status=success with trackId");
            }

            // --- 3단계: 결과 처리 ---
            if (isSuccess) {
                // 주문번호 표시
                if (trackId) {
                    const orderInfo = document.getElementById('order-info');
                    const orderNoDisplay = document.getElementById('order-no-display');
                    if (orderInfo && orderNoDisplay) {
                        orderNoDisplay.innerText = trackId;
                        orderInfo.style.display = 'block';
                    }
                }

                console.log(LOG_PREFIX + "Payment confirmed. Sending email in background...");

                // 백그라운드: 이메일 발송용 Verify API 호출 (결과는 무시)
                try {
                    let verifyParams = new URLSearchParams();
                    if (trackId) verifyParams.append('trackId', trackId);
                    if (trxId) verifyParams.append('trxId', trxId);

                    // localStorage에서 고객 정보 추가
                    try {
                        const stored = JSON.parse(localStorage.getItem('fintree_pay_data'));
                        if (stored) {
                            if (stored.userName) verifyParams.append('userName', stored.userName);
                            if (stored.userTel) verifyParams.append('userTel', stored.userTel);
                            if (stored.userEmail) verifyParams.append('userEmail', stored.userEmail);
                        }
                    } catch (e) { }

                    fetch(`${CONFIG.HOSTED_DOMAIN}${CONFIG.VERIFY_API}?${verifyParams.toString()}`)
                        .then(r => r.json())
                        .then(data => console.log(LOG_PREFIX + "Verify API (background):", data.result))
                        .catch(err => console.warn(LOG_PREFIX + "Verify API background error (ignored):", err.message));
                } catch (e) {
                    console.warn(LOG_PREFIX + "Background verify call failed (ignored):", e.message);
                }

            } else {
                // 실패: 취소 페이지로 리다이렉트
                let failMsg = "결제가 완료되지 않았습니다.";
                if (sdkResult && sdkResult.result && sdkResult.result.advanceMsg) {
                    failMsg = sdkResult.result.advanceMsg;
                } else if (status === 'fail') {
                    failMsg = getURLParam('msg') || failMsg;
                }
                console.warn(LOG_PREFIX + "Payment not successful:", failMsg);
                location.href = getRedirectUrl(CONFIG.PATHS.CANCEL) + '?msg=' + encodeURIComponent(failMsg);
            }
        }

        window.addEventListener('load', verifyPayment);
    }

    function handlePaymentCancel() {
        console.log(LOG_PREFIX + "Routing: Cancel Page");
    }

    function handlePaymentRefund() {
        console.log(LOG_PREFIX + "Routing: Refund Page");

        function setupRefundButton(btn) {
            btn.onclick = async function () {
                const rootTrackId = document.getElementById('rootTrackId').value;
                const rootTrxDay = document.getElementById('rootTrxDay').value;
                const amount = document.getElementById('amount').value;
                const display = document.getElementById('result-display');

                if (!rootTrackId || !rootTrxDay) {
                    alert('주문번호와 거래일자를 입력해 주세요.');
                    return;
                }

                if (!confirm('정말로 해당 결제를 취소하시겠습니까?')) return;

                btn.disabled = true;
                btn.innerText = '취소 처리 중...';
                display.style.display = 'none';

                const refundData = {
                    refund: {
                        rootTrackId: rootTrackId,
                        rootTrxDay: rootTrxDay,
                        amount: amount ? parseInt(amount) : null,
                        trackId: 'REF-' + new Date().getTime(),
                        trxType: "ONTR"
                    }
                };

                console.log(LOG_PREFIX + "Requesting Refund...", refundData);

                try {
                    const response = await fetch(CONFIG.HOSTED_DOMAIN + '/api/refund', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(refundData)
                    });
                    const data = await response.json();

                    display.style.display = 'block';
                    if (data.result && data.result.resultCd === '0000') {
                        display.innerText = '✅ 결제 취소가 완료되었습니다. (' + data.result.advanceMsg + ')';
                        display.className = 'success';
                    } else {
                        display.innerText = '❌ 취소 실패: ' + (data.result ? data.result.advanceMsg : '알 수 없는 오류');
                        display.className = 'error';
                    }
                } catch (e) {
                    console.error(LOG_PREFIX + "Refund API Error:", e);
                    display.innerText = '❌ 통신 중 오류가 발생했습니다.';
                    display.className = 'error';
                    display.style.display = 'block';
                } finally {
                    btn.disabled = false;
                    btn.innerText = '즉시 취소하기';
                }
            };
        }

        const btn = document.getElementById('refund-btn');
        if (btn) {
            setupRefundButton(btn);
        } else {
            // Retry once for safety
            setTimeout(() => {
                const retryBtn = document.getElementById('refund-btn');
                if (retryBtn) setupRefundButton(retryBtn);
                else console.warn(LOG_PREFIX + "Refund Button Not Found");
            }, 500);
        }
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

    // --- 최종 실행 ---
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initRouter);
    } else {
        initRouter();
    }

})();

