  // =======================================================================
  // === SELECTED TEXT CURRENCY/UNIT CONVERTER (Alt+Z)                 ===
  // =======================================================================
  (() => { // IIFE for Text Converter
    'use strict';

    // ... (Config, UI_STRINGS, REGEXES, AppState, Utils, NumberParser, TextExtractor, Formatter, ApiService remain the same) ...

    const Config = {
        API_TIMEOUT_MS: 7000,
        ONE_HOUR_MS: 3600 * 1000,
        POPUP_OFFSET_X: 10,
        POPUP_OFFSET_Y: 10,
        POPUP_SCREEN_MARGIN: 10,
        DEFAULT_TARGET_CURRENCY: 'KRW',
        KOREAN_NUMERALS_MAP: { '일': '1', '이': '2', '삼': '3', '사': '4', '오': '5', '육': '6', '칠': '7', '팔': '8', '구': '9' },
        KOREAN_MAJOR_UNITS: [
            { name: '조', value: 1000000000000 },
            { name: '억', value: 100000000 },
            { name: '만', value: 10000 }
        ],
        KOREAN_SUB_UNITS: [{ name: '천', value: 1000 }, { name: '백', value: 100 }],
        MAGNITUDE_WORDS_EN: { 'thousand': 1000, 'million': 1000000, 'billion': 1000000000, 'trillion': 1000000000000 },
        CURRENCY_FLAGS: {
            'USD': '🇺🇸', 'EUR': '🇪🇺', 'JPY': '🇯🇵', 'GBP': '🇬🇧', 'AUD': '🇦🇺', 'CAD': '🇨🇦', 'CHF': '🇨🇭', 'CNY': '🇨🇳', 'HKD': '🇭🇰', 'NZD': '🇳🇿', 'SEK': '🇸🇪', 'KRW': '🇰🇷', 'SGD': '🇸🇬', 'NOK': '🇳🇴', 'MXN': '🇲🇽', 'INR': '🇮🇳', 'ZAR': '🇿🇦', 'TRY': '🇹🇷', 'BRL': '🇧🇷', 'DKK': '🇩🇰', 'PLN': '🇵🇱', 'THB': '🇹🇭', 'IDR': '🇮🇩', 'HUF': '🇭🇺', 'CZK': '🇨🇿', 'ILS': '🇮🇱', 'PHP': '🇵🇭', 'MYR': '🇲🇾', 'RON': '🇷🇴', 'BGN': '🇧🇬', 'ISK': '🇮🇸',
        },
        UNIT_CATEGORY_ICONS: { length: '📏', mass: '⚖️', volume: '💧', temperature: '🌡️' },
        CATEGORY_BASE_UNITS: { length: 'm', mass: 'kg', volume: 'L' },
        CURRENCY_PATTERNS: [
            { code: 'CAD', regex: /캐나다\s*달러|캐나다달러|C\$|CAD/giu }, { code: 'AUD', regex: /호주\s*달러|호주달러|A\$|AUD/giu }, { code: 'CHF', regex: /스위스\s*프랑|스위스프랑|CHF|SFr\./giu }, { code: 'SGD', regex: /싱가포르\s*달러|싱가포르달러|S\$|SGD/giu }, { code: 'HKD', regex: /홍콩\s*달러|홍콩달러|HK\$|HKD/giu }, { code: 'NZD', regex: /뉴질랜드\s*달러|뉴질랜드달러|NZ\$|NZD/giu }, { code: 'MXN', regex: /멕시코\s*페소|멕시코페소|Mex\$|MXN/giu }, { code: 'BRL', regex: /브라질\s*헤알|헤알|R\$|BRL/giu }, { code: 'PHP', regex: /필리핀\s*페소|필리핀페소|₱|PHP/giu }, { code: 'MYR', regex: /말레이시아\s*링깃|링깃|RM|MYR/giu }, { code: 'GBP', regex: /파운드\s*스털링|영국\s*파운드|GBP\s*£|£\s*GBP/giu }, { code: 'JPY', regex: /엔|엔화|円|￥|¥|JPY|일본\s*엔|일본\s*엔화/giu }, { code: 'EUR', regex: /유로|€|EUR/giu }, { code: 'CNY', regex: /위안|위안화|元|CNY|중국\s*위안|인민폐|런민비/giu }, { code: 'KRW', regex: /원|₩|KRW|한국\s*원|대한민국\s*원/giu }, { code: 'INR', regex: /인도\s*루피|인도루피|₹|INR/giu }, { code: 'TRY', regex: /터키\s*리라|튀르키예\s*리라|리라|₺|TRY/giu }, { code: 'IDR', regex: /인도네시아\s*루피아|루피아|Rp|IDR/giu }, { code: 'PLN', regex: /폴란드\s*즐로티|즐로티|zł|PLN/giu }, { code: 'ILS', regex: /이스라엘\s*셰켈|셰켈|₪|ILS/giu }, { code: 'THB', regex: /태국\s*바트|바트|밧|฿|THB/giu }, { code: 'SEK', regex: /스웨덴\s*크로나|스웨덴크로나|SEK(?:kr)?|(?:krSEK)/giu }, { code: 'NOK', regex: /노르웨이\s*크로나|노르웨이크로나|NOK(?:kr)?|(?:krNOK)/giu }, { code: 'DKK', regex: /덴마크\s*크로나|덴마크크로나|DKK(?:kr)?|(?:krDKK)/giu }, { code: 'ISK', regex: /아이슬란드\s*크로나|아이슬란드크로나|ISK(?:kr)?|(?:krISK)/giu }, { code: 'ZAR', regex: /남아프리카\s*공화국\s*랜드|남아공\s*랜드|랜드|R|ZAR/giu }, { code: 'RON', regex: /루마니아\s*레우|레우|lei|RON/giu }, { code: 'CZK', regex: /체코\s*코루나|코루나|Kč|CZK/giu }, { code: 'HUF', regex: /헝가리\s*포린트|포린트|Ft|HUF/giu }, { code: 'BGN', regex: /불가리아\s*레프|레프|лв|BGN/giu }, { code: 'GBP', regex: /파운드|£|GBP/giu }, { code: 'USD', regex: /달러|\$|USD|불|미국\s*달러/giu },
        ],
        UNIT_CONVERSION_CONFIG: {
            length: [
                { names: ['inch', 'inches', 'in', '"', '인치'], target_unit_code: 'cm', factor: 2.54, to_base_unit_factor: 0.0254, regex: /([\d\.,]+)\s*(inch(?:es)?|in|"|인치)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, additional_outputs: [{ unit: 'ft', from_base_unit_factor: 1/0.3048, precision: 3 }, { unit: 'm', from_base_unit_factor: 1, precision: 3 }], category: 'length' },
                { names: ['foot', 'feet', 'ft', "'", '피트'], target_unit_code: 'm', factor: 0.3048, to_base_unit_factor: 0.3048, regex: /([\d\.,]+)\s*(foot|feet|ft|'|피트)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, additional_outputs: [{ unit: 'cm', from_base_unit_factor: 100, precision: 1 }, { unit: 'inch', from_base_unit_factor: 1/0.0254, precision: 2 }], category: 'length' },
                { names: ['yard', 'yards', 'yd', '야드'], target_unit_code: 'm', factor: 0.9144, to_base_unit_factor: 0.9144, regex: /([\d\.,]+)\s*(yard(?:s)?|yd|야드)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, category: 'length' },
                { names: ['mile', 'miles', 'mi', '마일'], target_unit_code: 'km', factor: 1.60934, to_base_unit_factor: 1609.34, regex: /([\d\.,]+)\s*(mile(?:s)?|mi|마일)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, category: 'length' },
                { names: ['cm', '센티미터', '센치'], target_unit_code: 'inch', factor: 1/2.54, to_base_unit_factor: 0.01, regex: /([\d\.,]+)\s*(cm|센티미터|센치)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, is_metric: true, target_unit_name: '인치', additional_outputs: [{unit: 'm', from_base_unit_factor: 1, precision: 3}], category: 'length' },
                { names: ['m', '미터'], target_unit_code: 'ft', factor: 1/0.3048, to_base_unit_factor: 1, regex: /([\d\.,]+)\s*(m|미터)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!i)(?!l)(?!o)(?!y)(?!a)(?!k)/giu, is_metric: true, target_unit_name: '피트', additional_outputs: [{unit: 'km', from_base_unit_factor: 0.001, precision:4}, {unit: 'inch', from_base_unit_factor: 1/0.0254, precision:1}], category: 'length' },
                { names: ['km', '킬로미터'], target_unit_code: 'mile', factor: 1/1.60934, to_base_unit_factor: 1000, regex: /([\d\.,]+)\s*(km|킬로미터)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, is_metric: true, target_unit_name: '마일', additional_outputs: [{unit: 'm', from_base_unit_factor: 1, precision:0}], category: 'length' },
            ],
            mass: [
                { names: ['ounce', 'ounces', 'oz', '온스'], target_unit_code: 'g', factor: 28.3495, to_base_unit_factor: 0.0283495, regex: /([\d\.,]+)\s*(ounce(?:s)?|oz|온스)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, category: 'mass', target_precision: 0 },
                { names: ['lb', 'lbs'], target_unit_code: 'kg', factor: 0.453592, to_base_unit_factor: 0.453592, regex: /([\d\.,]+)\s*(lb(?:s)?)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, id: 'lb', category: 'mass' },
                { names: ['pound', 'pounds', '파운드'], target_unit_code: 'kg', factor: 0.453592, to_base_unit_factor: 0.453592, regex: /([\d\.,]+)\s*(파운드|pound(?:s)?)(?!\s*스털링)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, id: 'pound_mass_word', category: 'mass' },
                { names: ['g', '그램'], target_unit_code: 'oz', factor: 1/28.3495, to_base_unit_factor: 0.001, regex: /([\d\.,]+)\s*(g|그램)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!a)(?!p)/giu, is_metric: true, target_unit_name: '온스', category: 'mass' },
                { names: ['kg', '킬로그램'], target_unit_code: 'lb', factor: 1/0.453592, to_base_unit_factor: 1, regex: /([\d\.,]+)\s*(kg|킬로그램)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, is_metric: true, target_unit_name: '파운드', category: 'mass' },
            ],
            volume: [
                { names: ['fluid ounce', '액량온스', 'fl oz'], target_unit_code: 'mL', factor: 29.5735, to_base_unit_factor: 0.0295735, regex: /([\d\.,]+)\s*(fl(?:uid)?\s*oz\.?|액량온스|플루이드온스)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, category: 'volume', target_precision: 0 },
                { names: ['pint', 'pints', 'pt', '파인트'], target_unit_code: 'L', factor: 0.473176, to_base_unit_factor: 0.473176, regex: /([\d\.,]+)\s*(pint(?:s)?|pt|파인트)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, category: 'volume' },
                { names: ['quart', 'quarts', 'qt', '쿼트'], target_unit_code: 'L', factor: 0.946353, to_base_unit_factor: 0.946353, regex: /([\d\.,]+)\s*(quart(?:s)?|qt|쿼트)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, category: 'volume' },
                { names: ['gallon', 'gallons', 'gal', '갤런'], target_unit_code: 'L', factor: 3.78541, to_base_unit_factor: 3.78541, regex: /([\d\.,]+)\s*(gallon(?:s)?|gal|갤런)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, category: 'volume' },
                { names: ['mL', '밀리리터'], target_unit_code: 'fl oz', factor: 1/29.5735, to_base_unit_factor: 0.001, regex: /([\d\.,]+)\s*(ml|밀리리터)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, is_metric: true, target_unit_name: '액량온스', category: 'volume' },
                { names: ['L', '리터'], target_unit_code: 'gallon', factor: 1/3.78541, to_base_unit_factor: 1, regex: /([\d\.,]+)\s*(L|l|리터)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!b)(?!k)(?!s)/giu, is_metric: true, target_unit_name: '갤런', category: 'volume' },
            ],
            temperature: [
                { names: ['Fahrenheit', 'F', '화씨'], target_unit_code: '°C', regex: /(-?[\d\.,]+)\s*(?:°F\b|F\b(?!t|l\b|r\b|o\b)|화씨(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣]))/giu, convert_func: (val) => (val - 32) * 5 / 9, target_unit_name: '섭씨', category: 'temperature' },
                { names: ['Celsius', 'C', '섭씨'], target_unit_code: '°F', regex: /(-?[\d\.,]+)\s*(?:°C\b|\bC\b(?![a-zA-Z])|섭씨(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣]))/giu, convert_func: (val) => (val * 9 / 5) + 32, target_unit_name: '화씨', category: 'temperature' }
            ],
        },
    };

    const UI_STRINGS = {
        POPUP_LAYER_ID: 'smart-converter-popup-layer-v42',
        POPUP_ERROR_CLASS: 'smart-converter-popup-error',
        POPUP_LOADING_CLASS: 'smart-converter-popup-loading',
        POPUP_DEFAULT_CLASS: 'smart-converter-popup-default',
        POPUP_VISIBLE_CLASS: 'visible',
        GENERAL_CURRENCY_ICON: '💵',
        CLOSE_BUTTON_TEXT: '×',
        CLOSE_BUTTON_TITLE: '닫기',
        COPY_BUTTON_TEXT: '복사',
        COPY_BUTTON_TITLE: '결과 복사',
        COPY_SUCCESS_TEXT: '복사됨!',
        COPY_FAIL_TEXT: '실패',
        CONVERTING_MESSAGE_PREFIX: "'",
        CONVERTING_MESSAGE_SUFFIX: "' 변환 중입니다...",
        PREVIEW_TEXT_ELLIPSIS: "...",
        PREVIEW_TEXT_MAX_LENGTH: 27,
        ERROR_ICON: '⚠️',
        ERROR_NO_VALID_CONVERSION: (text) => `⚠️ '${Utils.escapeHTML(text)}'에 대한 유효한 변환 결과를 찾지 못했습니다. 입력 형식을 확인해 주세요.`,
        ERROR_CANNOT_FIND_CONVERTIBLE: (text) => `⚠️ '${Utils.escapeHTML(text)}'에서 변환 가능한 내용을 찾지 못했습니다.`,
        ERROR_UNIT_CONVERSION: "⚠️ 단위 변환 오류",
        ERROR_FETCH_RATE_INVALID_CURRENCY: (currency) => `⚠️ '${Utils.escapeHTML(String(currency)) || '알 수 없는 통화'}'는 유효한 기준 통화 코드가 아닙니다.`,
        ERROR_FETCH_RATE_API_RESPONSE_CURRENCY: (currency) => `⚠️ 환율 API 응답에서 '${currency}' 통화 정보를 찾을 수 없거나 형식이 유효하지 않습니다.`,
        ERROR_FETCH_RATE_API_PROCESSING: (message) => `⚠️ 환율 API 응답 처리 중 오류가 발생했습니다: ${Utils.escapeHTML(message)}`,
        ERROR_FETCH_RATE_NETWORK: (status) => `⚠️ 환율 정보 요청 중 네트워크 오류가 발생했습니다. (상태: ${status || '알 수 없음'})`,
        ERROR_FETCH_RATE_TIMEOUT: '⚠️ 환율 정보 요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.',
        RESULT_UNIT_SUFFIX_MASS: "(단위, 질량)",
        RESULT_UNIT_SUFFIX_VOLUME: "(단위, 부피)",
        RESULT_UNIT_SUFFIX_DEFAULT: "(단위)",
        RESULT_CURRENCY_SUFFIX: "(환율)",
        RESULT_CURRENCY_ERROR_SUFFIX: "(환율 오류)",
        KOREAN_WON_UNIT: "원",
        KOREAN_APPROX_PREFIX: "약 ",
        ORIGINAL_TEXT_LABEL: "원본: ",
        ECB_TEXT: "유럽중앙은행", // Added for the new requirement
    };

    const REGEXES = { // Added 'u' flag and lookaheads where appropriate
        KOREAN_NUMERALS_REGEX_G: new RegExp(Object.keys(Config.KOREAN_NUMERALS_MAP).join('|'), 'gu'),
        KOREAN_NUMERIC_CLEANUP_REGEX_GI: /[^0-9\.\s천백십]/giu,
        NON_NUMERIC_RELATED_CHARS_REGEX_GI: /[0-9억만천백십조일이삼사오육칠팔구영BMKbmk\.,\s]/giu,
        AMOUNT_ABBREVIATION_REGEX_I: /^([\d\.,]+)\s*([BMK])(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/iu,
        ENGLISH_MAGNITUDE_REGEX_I: new RegExp(`^([\\d\.,]+)\\s*(${Object.keys(Config.MAGNITUDE_WORDS_EN).join('|')})(?:s)?(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])`, 'iu'),
        PLAIN_OZ_REGEX: /^([\d\.,]+)\s*(oz|온스)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])$/iu,
        PURE_NUMBER_REGEX: /^[\d\.]+$/u,
    };

    const AppState = {
        exchangeRateCache: {},
        lastMouseX: 0,
        lastMouseY: 0,
        currentPopupElement: null,
        popupContentContainer: null,
        lastSelectionRect: null,
        closePopupTimeout: null,
    };

    const Utils = {
        debounce: function(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const context = this;
                const later = () => {
                    timeout = null;
                    func.apply(context, args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        },
        escapeHTML: function(str) {
            if (typeof str !== 'string') return '';
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        },
        parseFloatLenient: function(inputStr) {
            if (inputStr === null || typeof inputStr === 'undefined') return null;
            const str = String(inputStr).replace(/,/g, '');
            if (str.trim() === "") return null;
            const val = parseFloat(str);
            return isNaN(val) ? null : val;
        },
        isInvalidString: function(str) {
            return typeof str !== 'string' || str.trim() === "";
        },
        getSafeNumber: function(value, defaultValue = null) {
            const num = Utils.parseFloatLenient(value);
            return num === null ? defaultValue : num;
        },
        getPreviewText: function(text, maxLength = UI_STRINGS.PREVIEW_TEXT_MAX_LENGTH, ellipsis = UI_STRINGS.PREVIEW_TEXT_ELLIPSIS) {
            if (Utils.isInvalidString(text)) return "";
            return text.length > maxLength ? text.substring(0, maxLength - ellipsis.length) + ellipsis : text;
        }
    };

    const NumberParser = {
        replaceKoreanNumerals: function(inputText) {
            if (Utils.isInvalidString(inputText)) return "";
            return inputText.replace(REGEXES.KOREAN_NUMERALS_REGEX_G, match => Config.KOREAN_NUMERALS_MAP[match]);
        },
        parseNumberWithTens: function(inputStr) {
            if (Utils.isInvalidString(inputStr)) return null;
            const str = inputStr.trim();
            const parts = str.split('십');
            if (parts.length > 2 || (parts.length === 2 && parts[1].includes('십'))) return null;

            if (parts.length === 1) return Utils.parseFloatLenient(str);

            let total = 0;
            let beforeTens = 1;
            if (parts[0] !== "") {
                const parsedBeforeTens = Utils.parseFloatLenient(parts[0]);
                if (parsedBeforeTens === null) return null;
                beforeTens = parsedBeforeTens;
            }
            total += beforeTens * 10;

            if (parts[1] !== "") {
                const afterTens = Utils.parseFloatLenient(parts[1]);
                if (afterTens === null) return null;
                total += afterTens;
            }
            return total;
        },
        parseSegmentWithSubUnitsAndTens: function(inputSegment) {
            if (Utils.isInvalidString(inputSegment)) return 0;
            const segment = inputSegment.trim();
            let textForUnitProcessing = segment.replace(REGEXES.KOREAN_NUMERIC_CLEANUP_REGEX_GI, '').replace(/\s+/g, '').trim();

            if (textForUnitProcessing === "" && segment !== "") return NumberParser.parseNumberWithTens(segment);

            let amount = 0;
            let segmentContainedMajorSubUnit = false;
            let remainingTextAfterUnits = textForUnitProcessing;

            for (const unit of Config.KOREAN_SUB_UNITS) {
                const parts = remainingTextAfterUnits.split(unit.name);
                if (parts.length > 1) {
                    segmentContainedMajorSubUnit = true;
                    let valuePartStr = parts[0].trim();
                    let valueForUnit = 1;

                    if (valuePartStr !== "") {
                        const parsedValuePart = NumberParser.parseNumberWithTens(valuePartStr);
                        if (parsedValuePart === null) return null;
                        valueForUnit = parsedValuePart;
                    }
                    amount += valueForUnit * unit.value;
                    remainingTextAfterUnits = parts.slice(1).join(unit.name).trim();
                }
            }

            if (remainingTextAfterUnits.length > 0) {
                const tailValue = NumberParser.parseNumberWithTens(remainingTextAfterUnits);
                if (tailValue === null) return segmentContainedMajorSubUnit ? amount : null;
                amount += tailValue;
            } else if (!segmentContainedMajorSubUnit && amount === 0 && segment.length > 0) {
                return NumberParser.parseNumberWithTens(segment);
            }
            return amount;
        },
        parseKoreanMajorUnitSegmentValue: function(segmentText) {
            if (segmentText === "") return 1;
            return NumberParser.parseSegmentWithSubUnitsAndTens(segmentText);
        },
        _parseMajorUnitSegments: function(text) {
            let totalAmount = 0;
            let remainingTextToParse = text;
            let parsedSomethingSignificant = false;

            for (const unit of Config.KOREAN_MAJOR_UNITS) {
                const parts = remainingTextToParse.split(unit.name);
                if (parts.length > 1) {
                    const valueForUnit = NumberParser.parseKoreanMajorUnitSegmentValue(parts[0].trim());
                    if (valueForUnit === null) return { error: true };
                    totalAmount += valueForUnit * unit.value;
                    remainingTextToParse = parts.slice(1).join(unit.name).trim();
                    parsedSomethingSignificant = true;
                }
            }
            return { totalAmount, remainingTextToParse, parsedSomethingSignificant };
        },
        parseKoreanNumericText: function(originalInputText) {
            if (Utils.isInvalidString(originalInputText)) return null;
            const text = originalInputText.replace(/,/g, '').trim();
            if (text === "영") return 0;

            if (REGEXES.PURE_NUMBER_REGEX.test(text)) {
                const val = Utils.parseFloatLenient(text);
                if (val !== null) return val;
            }

            const numeralReplacedText = NumberParser.replaceKoreanNumerals(text);

            const majorUnitResult = NumberParser._parseMajorUnitSegments(numeralReplacedText);
            if (majorUnitResult.error) return null;

            let { totalAmount, remainingTextToParse, parsedSomethingSignificant } = majorUnitResult;

            if (remainingTextToParse.length > 0) {
                const remainingValue = NumberParser.parseSegmentWithSubUnitsAndTens(remainingTextToParse);
                if (remainingValue === null) {
                    return parsedSomethingSignificant ? totalAmount : null;
                }
                totalAmount += remainingValue;
                parsedSomethingSignificant = true;
            }

            if (parsedSomethingSignificant) return totalAmount;

            return NumberParser.parseSegmentWithSubUnitsAndTens(numeralReplacedText);
        },
        parseAmountWithMagnitudeSuffixes: function(text) {
            if (Utils.isInvalidString(text)) return null;
            const cleanText = text.replace(/,/g, '').trim();

            const abbreviationMatch = cleanText.match(REGEXES.AMOUNT_ABBREVIATION_REGEX_I);
            if (abbreviationMatch) {
                const numVal = Utils.parseFloatLenient(abbreviationMatch[1]);
                const suffix = abbreviationMatch[2].toUpperCase();
                if (numVal !== null && cleanText.substring(abbreviationMatch[0].length).trim() === "") {
                    let multiplier = 1;
                    if (suffix === 'B') multiplier = 1e9;
                    else if (suffix === 'M') multiplier = 1e6;
                    else if (suffix === 'K') multiplier = 1e3;
                    return numVal * multiplier;
                }
            }

            const magnitudeMatch = cleanText.match(REGEXES.ENGLISH_MAGNITUDE_REGEX_I);
            if (magnitudeMatch) {
                const numVal = Utils.parseFloatLenient(magnitudeMatch[1]);
                const word = magnitudeMatch[2].toLowerCase();
                if (numVal !== null && Config.MAGNITUDE_WORDS_EN[word] && cleanText.substring(magnitudeMatch[0].length).trim() === "") {
                    return numVal * Config.MAGNITUDE_WORDS_EN[word];
                }
            }
            return null;
        },
        parseGenericNumericText: function(text) {
            if (Utils.isInvalidString(text)) return null;
            let amount = NumberParser.parseAmountWithMagnitudeSuffixes(text);
            if (amount !== null) return amount;
            return NumberParser.parseKoreanNumericText(text);
        }
    };

    const TextExtractor = {
        extractCurrencyDetails: function(inputText) {
            if (Utils.isInvalidString(inputText)) {
                return { amount: null, currencyCode: null, originalText: "", matchedCurrencyText: "" };
            }
            const originalText = inputText.trim();
            let amountTextToParse = originalText;
            let currencyCode = null;
            let matchedCurrencyText = "";

            for (const pattern of Config.CURRENCY_PATTERNS) {
                pattern.regex.lastIndex = 0;
                const match = pattern.regex.exec(originalText);
                if (match) {
                    currencyCode = pattern.code;
                    matchedCurrencyText = match[0];
                    const firstOccurrenceIndex = originalText.indexOf(matchedCurrencyText);
                    amountTextToParse = (originalText.substring(0, firstOccurrenceIndex) + originalText.substring(firstOccurrenceIndex + matchedCurrencyText.length)).trim();
                    break;
                }
            }

            let amount = null;
            if (currencyCode || amountTextToParse === originalText) {
                const textForNumericParse = (currencyCode && amountTextToParse === "") ?
                    originalText.replace(matchedCurrencyText, '').trim() :
                    amountTextToParse;
                if (textForNumericParse !== "") {
                    amount = NumberParser.parseGenericNumericText(textForNumericParse);
                }
            }
            return { amount, currencyCode, originalText, matchedCurrencyText };
        },
        extractPhysicalUnitDetails: function(inputText) {
            if (Utils.isInvalidString(inputText)) return [];
            const foundMatches = [];
            const trimmedText = inputText.trim();

            for (const categoryKey in Config.UNIT_CONVERSION_CONFIG) {
                for (const unit of Config.UNIT_CONVERSION_CONFIG[categoryKey]) {
                    unit.regex.lastIndex = 0;
                    let match;
                    while ((match = unit.regex.exec(trimmedText)) !== null) {
                        const valueStr = match[1];
                        const unitStr = match[2];
                        const value = Utils.parseFloatLenient(valueStr);
                        if (value !== null) {
                             foundMatches.push({ value, unitInfo: unit, originalText: match[0].trim(), originalUnit: unitStr.trim() });
                        }
                    }
                }
            }

            const plainOzInputMatch = REGEXES.PLAIN_OZ_REGEX.exec(trimmedText);
            if (plainOzInputMatch) {
                const valueFromPlainOz = Utils.parseFloatLenient(plainOzInputMatch[1]);
                const matchedMassOz = foundMatches.find(m =>
                    m.value === valueFromPlainOz && m.unitInfo.category === 'mass' &&
                    (m.unitInfo.names.includes('oz') || m.unitInfo.names.includes('온스')) &&
                    (m.originalUnit.toLowerCase() === 'oz' || m.originalUnit.toLowerCase() === '온스') &&
                    m.originalText.toLowerCase() === plainOzInputMatch[0].toLowerCase().trim()
                );
                if (matchedMassOz) {
                    const alreadyHasFluidOz = foundMatches.some(m =>
                        m.value === valueFromPlainOz && m.unitInfo.category === 'volume' &&
                        m.unitInfo.names.includes('fl oz') &&
                        m.originalText.toLowerCase() === plainOzInputMatch[0].toLowerCase().trim()
                    );
                    if (!alreadyHasFluidOz) {
                        const fluidOunceUnitInfo = Config.UNIT_CONVERSION_CONFIG.volume.find(u => u.names.includes('fl oz'));
                        if (fluidOunceUnitInfo && !foundMatches.some(fm => fm.unitInfo === fluidOunceUnitInfo && fm.value === valueFromPlainOz && fm.originalText.toLowerCase() === plainOzInputMatch[0].toLowerCase().trim())) {
                            foundMatches.push({ value: valueFromPlainOz, unitInfo: fluidOunceUnitInfo, originalText: plainOzInputMatch[0].trim(), originalUnit: plainOzInputMatch[2].trim() });
                        }
                    }
                }
            }

            const uniqueResults = [];
            const seen = new Set();
            foundMatches.forEach(res => {
                const key = `${res.value}-${res.unitInfo.category}-${res.unitInfo.target_unit_code}-${res.originalUnit}-${res.originalText}`;
                if (!seen.has(key)) {
                    uniqueResults.push(res);
                    seen.add(key);
                }
            });
            return uniqueResults;
        }
    };

    const Formatter = {
        prepareNumberForKoreanFormatting: function(number) {
            if (number === null || isNaN(number)) return null;
            const numAbs = Math.abs(number);
            if (numAbs >= 10000) return Math.round(numAbs);
            if (numAbs < 0.01 && numAbs !== 0) return 0;
            if (numAbs < 1) return Utils.parseFloatLenient(numAbs.toPrecision(2));
            return Math.round(numAbs * 100) / 100;
        },
        determineFormattingDetails: function(value) {
            let decimalPlaces = 0;
            if (value < 1) decimalPlaces = 2;
            else if (value < 10) decimalPlaces = 2;
            else if (value < 100) decimalPlaces = 1;
            const roundedValue = Utils.parseFloatLenient(value.toFixed(decimalPlaces));
            const minFractionDigits = (Number.isInteger(roundedValue) && roundedValue !== 0 && value === roundedValue) ? 0 : decimalPlaces;
            return { roundedValue, decimalPlaces, minFractionDigits };
        },
        formatNumberToKoreanUnits: function(number, forceWonSuffix = false) {
            if (number === null || isNaN(number)) return "";
            if (number === 0) return forceWonSuffix ? "0" + UI_STRINGS.KOREAN_WON_UNIT : "0";

            const preparedNum = Formatter.prepareNumberForKoreanFormatting(number);
            if (preparedNum === null) return "";
            if (preparedNum === 0 && number !== 0) {
                const prefix = number > 0 ? UI_STRINGS.KOREAN_APPROX_PREFIX : "-" + UI_STRINGS.KOREAN_APPROX_PREFIX;
                return prefix + (forceWonSuffix ? "0" + UI_STRINGS.KOREAN_WON_UNIT : "0");
            }

            const sign = number < 0 ? "-" : "";
            const numAbsForCalc = Math.abs(preparedNum);
            let parts = [];
            let remainingVal = numAbsForCalc;

            for (const unit of Config.KOREAN_MAJOR_UNITS) {
                if (remainingVal >= unit.value) {
                    const unitAmount = Math.floor(remainingVal / unit.value);
                    if (unitAmount > 0) {
                        parts.push(`${unitAmount.toLocaleString()}${unit.name}`);
                        remainingVal %= unit.value;
                    }
                }
            }

            if (remainingVal > 0 || (parts.length === 0 && numAbsForCalc > 0)) {
                const valToFormat = (parts.length === 0 && numAbsForCalc > 0) ? numAbsForCalc : remainingVal;
                const { roundedValue, decimalPlaces, minFractionDigits } = Formatter.determineFormattingDetails(valToFormat);
                const remainingStr = roundedValue.toLocaleString(undefined, { minimumFractionDigits: minFractionDigits, maximumFractionDigits: decimalPlaces });
                if (remainingStr !== "0" || parts.length === 0) parts.push(remainingStr);
            }

            if (parts.length === 0) return sign + (forceWonSuffix ? "0" + UI_STRINGS.KOREAN_WON_UNIT : "0");

            let resultStr = sign + parts.join(" ");
            const lastPart = parts.length > 0 ? parts[parts.length - 1] : "";
            const lastPartIsNumericOnly = REGEXES.PURE_NUMBER_REGEX.test(lastPart.replace(/,/g, ''));
            const endsWithMajorUnit = Config.KOREAN_MAJOR_UNITS.some(u => resultStr.trim().endsWith(u.name));
            const manUnitValue = Config.KOREAN_MAJOR_UNITS.find(u => u.name === '만').value;

            const shouldAddWonSuffix = forceWonSuffix || (lastPartIsNumericOnly && !endsWithMajorUnit) ||
                (parts.length === 1 && lastPartIsNumericOnly && numAbsForCalc < manUnitValue && numAbsForCalc > 0);

            if (shouldAddWonSuffix && !resultStr.endsWith(UI_STRINGS.KOREAN_WON_UNIT)) {
                resultStr += UI_STRINGS.KOREAN_WON_UNIT;
            }
            return resultStr;
        },
        formatPhysicalUnitResult: function(originalValue, originalUnitText, convertedValue, targetUnitCode, unitInfo, defaultPrecision = 2) {
            if (originalValue === null || convertedValue === null || !unitInfo) return { html: UI_STRINGS.ERROR_UNIT_CONVERSION, plainText: UI_STRINGS.ERROR_UNIT_CONVERSION };

            const categoryIcon = Config.UNIT_CATEGORY_ICONS[unitInfo.category] || '';
            let displayPrecisionTarget = typeof unitInfo.target_precision === 'number' ? unitInfo.target_precision :
                (targetUnitCode === '°C' || targetUnitCode === '°F' ? 1 : defaultPrecision);

            let displayOriginalUnit = originalUnitText;
            if (originalUnitText === '"') displayOriginalUnit = 'inch';
            else if (originalUnitText === "'") displayOriginalUnit = 'ft';
            if (originalUnitText.toUpperCase() === 'F' && !originalUnitText.startsWith('°') && targetUnitCode === '°C') displayOriginalUnit = '°F';
            if (originalUnitText.toUpperCase() === 'C' && !originalUnitText.startsWith('°') && targetUnitCode === '°F') displayOriginalUnit = '°C';

            const targetUnitDisplayName = unitInfo.target_unit_name || targetUnitCode;
            const valStr = originalValue.toLocaleString(undefined, { maximumFractionDigits: 2 });
            const convertedValStrTarget = convertedValue.toLocaleString(undefined, {
                minimumFractionDigits: (Number.isInteger(Utils.parseFloatLenient(convertedValue.toFixed(displayPrecisionTarget))) && displayPrecisionTarget > 0 && convertedValue !== 0) ? 0 : displayPrecisionTarget,
                maximumFractionDigits: displayPrecisionTarget
            });

            let primaryResultHtml = `<span class="converted-value">${convertedValStrTarget} ${Utils.escapeHTML(targetUnitDisplayName)}</span>`;
            let primaryResultPlain = `${convertedValStrTarget} ${targetUnitDisplayName}`;
            let additionalResultsHtmlParts = [];
            let additionalResultsPlainParts = [];

            if (unitInfo.additional_outputs && unitInfo.to_base_unit_factor && unitInfo.category !== 'temperature') {
                const baseValue = originalValue * unitInfo.to_base_unit_factor;
                unitInfo.additional_outputs.forEach(addOut => {
                    if (typeof addOut.from_base_unit_factor === 'number') {
                        const addVal = baseValue * addOut.from_base_unit_factor;
                        if (typeof addVal === 'number' && !isNaN(addVal)) {
                            const addPrecision = addOut.precision || defaultPrecision;
                            const formattedAddVal = addVal.toLocaleString(undefined, {
                                minimumFractionDigits: (Number.isInteger(Utils.parseFloatLenient(addVal.toFixed(addPrecision))) && addPrecision > 0 && addVal !== 0) ? 0 : addPrecision,
                                maximumFractionDigits: addPrecision
                            });
                            additionalResultsHtmlParts.push(`${formattedAddVal} ${Utils.escapeHTML(addOut.unit)}`);
                            additionalResultsPlainParts.push(`${formattedAddVal} ${addOut.unit}`);
                        }
                    }
                });
            }
            const fullResultHtml = primaryResultHtml + (additionalResultsHtmlParts.length > 0 ? ` (${additionalResultsHtmlParts.join(', ')})` : '');
            const fullResultPlain = primaryResultPlain + (additionalResultsPlainParts.length > 0 ? ` (${additionalResultsPlainParts.join(', ')})` : '');

            return {
                html: `<span class="original-value">${valStr} ${Utils.escapeHTML(displayOriginalUnit)}</span> <span class="category-icon">${categoryIcon}</span> ≈ ${fullResultHtml}`,
                plainText: `${valStr} ${displayOriginalUnit} ${categoryIcon} = ${fullResultPlain}`
            };
        }
    };

    const ApiService = {
        fetchExchangeRate: async function(fromCurrency, toCurrency = Config.DEFAULT_TARGET_CURRENCY) {
            if (Utils.isInvalidString(fromCurrency)) {
                return Promise.reject(new Error(UI_STRINGS.ERROR_FETCH_RATE_INVALID_CURRENCY(fromCurrency)));
            }
            if (fromCurrency === toCurrency) {
                return { rate: 1, date: new Date().toISOString().split('T')[0] };
            }

            const cacheKey = `${fromCurrency}_${toCurrency}`;
            const now = Date.now();
            if (AppState.exchangeRateCache[cacheKey] && (now - AppState.exchangeRateCache[cacheKey].timestamp < Config.ONE_HOUR_MS)) {
                return AppState.exchangeRateCache[cacheKey];
            }

            return new Promise((resolve, reject) => {
                try {
                    chrome.runtime.sendMessage(
                        {
                            action: "fetchLunaToolsExchangeRate", // Ensure this matches the action in your background script
                            from: fromCurrency,
                            to: toCurrency
                        },
                        (response) => {
                            if (chrome.runtime.lastError) {
                                reject(new Error(UI_STRINGS.ERROR_FETCH_RATE_NETWORK(chrome.runtime.lastError.message || 'extension_error')));
                                return;
                            }

                            if (response.error) {
                                if (response.error.includes('timed out')) {
                                    reject(new Error(UI_STRINGS.ERROR_FETCH_RATE_TIMEOUT));
                                } else if (response.error.includes('Network error')) {
                                     reject(new Error(UI_STRINGS.ERROR_FETCH_RATE_NETWORK(response.error.match(/\(status: (\w+)\)/)?.[1] || 'unknown')));
                                } else if (response.error.includes('API response error')) {
                                    reject(new Error(UI_STRINGS.ERROR_FETCH_RATE_API_RESPONSE_CURRENCY(toCurrency)));
                                } else {
                                    reject(new Error(UI_STRINGS.ERROR_FETCH_RATE_API_PROCESSING(response.error)));
                                }
                            } else if (response.data && typeof response.data.rate === 'number' && response.data.date) {
                                const result = { rate: response.data.rate, date: response.data.date };
                                AppState.exchangeRateCache[cacheKey] = { ...result, timestamp: Date.now() };
                                resolve(result);
                            } else {
                                reject(new Error(UI_STRINGS.ERROR_FETCH_RATE_API_PROCESSING('Invalid or incomplete data from background.')));
                            }
                        }
                    );
                } catch (e) {
                    reject(new Error(UI_STRINGS.ERROR_FETCH_RATE_NETWORK('sendMessage_failed')));
                }
            });
        }
    };

    const Converter = {
        convertPhysicalUnit: function(value, unitInfo) {
            if (value === null || !unitInfo) return null;
            if (unitInfo.convert_func) return unitInfo.convert_func(value);
            if (typeof unitInfo.factor === 'number') return value * unitInfo.factor;
            return null;
        },
        processUnitConversion: function(selectedText) {
            const unitDetailItems = TextExtractor.extractPhysicalUnitDetails(selectedText);
            if (!unitDetailItems || unitDetailItems.length === 0) return null;

            const conversionDataObjects = [];
            for (const unitDetails of unitDetailItems) {
                if (unitDetails.value !== null && unitDetails.unitInfo) {
                    const convertedUnitValue = Converter.convertPhysicalUnit(unitDetails.value, unitDetails.unitInfo);
                    if (convertedUnitValue !== null) {
                        const unitResult = Formatter.formatPhysicalUnitResult(unitDetails.value, unitDetails.originalUnit, convertedUnitValue, unitDetails.unitInfo.target_unit_code, unitDetails.unitInfo);
                        const categoryIcon = Config.UNIT_CATEGORY_ICONS[unitDetails.unitInfo.category] || '';

                        let processedOriginalTextForTitle = Utils.escapeHTML(unitDetails.originalText);
                        const originalUnitLower = unitDetails.originalUnit.toLowerCase();
                        const isOzUnit = originalUnitLower === 'oz' || originalUnitLower === '온스';

                        if (isOzUnit) {
                            if (unitDetails.unitInfo.category === 'mass') {
                                processedOriginalTextForTitle += ' (질량)';
                            } else if (unitDetails.unitInfo.category === 'volume') {
                                processedOriginalTextForTitle += ' (부피)';
                            }
                        }

                        let titleSuffix = UI_STRINGS.RESULT_UNIT_SUFFIX_DEFAULT;
                        if (unitDetailItems.length > 1 && isOzUnit) {
                            if (unitDetails.unitInfo.category === 'mass') titleSuffix = UI_STRINGS.RESULT_UNIT_SUFFIX_MASS;
                            else if (unitDetails.unitInfo.category === 'volume') titleSuffix = UI_STRINGS.RESULT_UNIT_SUFFIX_VOLUME;
                        }

                        conversionDataObjects.push({
                            titleHtml: `<span class="category-icon">${categoryIcon}</span> <b>${processedOriginalTextForTitle}</b> <span class="title-suffix">${titleSuffix}</span>`,
                            contentHtml: unitResult.html,
                            copyText: unitResult.plainText,
                            isError: false
                        });
                    }
                }
            }
            return conversionDataObjects.length > 0 ? { results: conversionDataObjects } : null;
        },
        processCurrencyConversion: async function(selectedText) {
            const currencyDetails = TextExtractor.extractCurrencyDetails(selectedText);
            if (currencyDetails.amount === null || currencyDetails.amount < 0 || !currencyDetails.currencyCode) return null;

            try {
                const { rate, date: rateDate } = await ApiService.fetchExchangeRate(currencyDetails.currencyCode, Config.DEFAULT_TARGET_CURRENCY);
                const convertedValue = currencyDetails.amount * rate;
                const formattedKrwText = Formatter.formatNumberToKoreanUnits(convertedValue, true);
                const formattedRateText = Formatter.formatNumberToKoreanUnits(rate, true);
                const formattedOriginalAmount = currencyDetails.amount.toLocaleString(undefined, { maximumFractionDigits: (currencyDetails.amount % 1 === 0 && currencyDetails.amount < 1e15 && currencyDetails.amount > -1e15) ? 0 : 2 });
                const currencyFlag = Config.CURRENCY_FLAGS[currencyDetails.currencyCode] || '';

                let displayOriginalTextForHTML, plainOriginalTextForCopy;
                if (currencyDetails.currencyCode === Config.DEFAULT_TARGET_CURRENCY) {
                    const krwFormatted = Formatter.formatNumberToKoreanUnits(currencyDetails.amount, true);
                    displayOriginalTextForHTML = krwFormatted.replace(/\s+/g, "") === currencyDetails.originalText.replace(/\s+/g, "") ?
                        `${krwFormatted} ${currencyFlag}` :
                        `${krwFormatted} ${currencyFlag} (${UI_STRINGS.ORIGINAL_TEXT_LABEL}${Utils.escapeHTML(currencyDetails.originalText)})`;
                    plainOriginalTextForCopy = `${Formatter.formatNumberToKoreanUnits(currencyDetails.amount, false)} ${currencyFlag}` +
                        (displayOriginalTextForHTML.includes(UI_STRINGS.ORIGINAL_TEXT_LABEL) ? ` (${UI_STRINGS.ORIGINAL_TEXT_LABEL}${currencyDetails.originalText})` : '');
                } else {
                    const canonicalForms = [
                        (formattedOriginalAmount + " " + currencyDetails.currencyCode).toLowerCase(), (formattedOriginalAmount + currencyDetails.currencyCode).toLowerCase(),
                        (currencyDetails.currencyCode + " " + formattedOriginalAmount).toLowerCase(), (currencyDetails.currencyCode + formattedOriginalAmount).toLowerCase()
                    ];
                    const currencyMatchContainedNumber = currencyDetails.matchedCurrencyText.includes(formattedOriginalAmount);
                    displayOriginalTextForHTML = (canonicalForms.includes(currencyDetails.originalText.toLowerCase().replace(/\s+/g, '')) || currencyMatchContainedNumber) ?
                        `${formattedOriginalAmount} ${currencyDetails.currencyCode} ${currencyFlag}` :
                        `${formattedOriginalAmount} ${currencyDetails.currencyCode} ${currencyFlag} (${UI_STRINGS.ORIGINAL_TEXT_LABEL}${Utils.escapeHTML(currencyDetails.originalText)})`;
                    plainOriginalTextForCopy = `${formattedOriginalAmount} ${currencyDetails.currencyCode} ${currencyFlag}` +
                        (displayOriginalTextForHTML.includes(UI_STRINGS.ORIGINAL_TEXT_LABEL) ? ` (${UI_STRINGS.ORIGINAL_TEXT_LABEL}${currencyDetails.originalText})` : '');
                }

                const safeRateDate = Utils.escapeHTML(rateDate);
                const titleHtml = `<span class="category-icon">${UI_STRINGS.GENERAL_CURRENCY_ICON}</span> <b>${displayOriginalTextForHTML}</b> <span class="title-suffix">${UI_STRINGS.RESULT_CURRENCY_SUFFIX}</span>`;
                // MODIFICATION START: Add ECB text
                const contentHtml = `≈ <b class="converted-value">${formattedKrwText}</b><br><small>(1 ${currencyDetails.currencyCode} ${currencyFlag} ≈ ${formattedRateText}, ${UI_STRINGS.ECB_TEXT}, 기준일: ${safeRateDate})</small>`;
                const copyText = `${plainOriginalTextForCopy} ${UI_STRINGS.RESULT_CURRENCY_SUFFIX}\n≈ ${Formatter.formatNumberToKoreanUnits(convertedValue, false)}\n(1 ${currencyDetails.currencyCode} ${currencyFlag} ≈ ${Formatter.formatNumberToKoreanUnits(rate, false)}, ${UI_STRINGS.ECB_TEXT}, 기준일: ${safeRateDate})`;
                // MODIFICATION END
                return { titleHtml, contentHtml, copyText, isError: false };
            } catch (error) {
                const errMsgBase = `${UI_STRINGS.ERROR_ICON} 환율 변환 실패 (${Utils.escapeHTML(currencyDetails.currencyCode || "?")} → ${Config.DEFAULT_TARGET_CURRENCY}).`;
                const errMsgDetail = (error && error.message) ? error.message : '알 수 없는 오류입니다.';
                return {
                    titleHtml: `<span class="category-icon">${UI_STRINGS.GENERAL_CURRENCY_ICON}</span> <b>${Utils.escapeHTML(currencyDetails.originalText)}</b> <span class="title-suffix">${UI_STRINGS.RESULT_CURRENCY_ERROR_SUFFIX}</span>`,
                    contentHtml: `${errMsgBase}<br><small style="color:#c0392b;">${UI_STRINGS.ERROR_ICON} ${Utils.escapeHTML(errMsgDetail)}</small>`,
                    copyText: `${currencyDetails.originalText} ${UI_STRINGS.RESULT_CURRENCY_ERROR_SUFFIX}\n${errMsgBase}\n${UI_STRINGS.ERROR_ICON} ${Utils.escapeHTML(errMsgDetail)}`,
                    isError: true
                };
            }
        },
        fetchAndProcessConversions: async function(selectedText) {
            let resultsArray = [];
            let conversionAttempted = false;

            // MODIFICATION START: Check for currency first to prioritize
            const preliminaryCurrencyDetails = TextExtractor.extractCurrencyDetails(selectedText);
            const isPrimarilyCurrencyQuery = preliminaryCurrencyDetails && preliminaryCurrencyDetails.currencyCode;

            if (!isPrimarilyCurrencyQuery) {
                const unitConversionOutcome = Converter.processUnitConversion(selectedText);
                if (unitConversionOutcome && unitConversionOutcome.results && unitConversionOutcome.results.length > 0) {
                    conversionAttempted = true;
                    resultsArray.push(...unitConversionOutcome.results);
                }
            }
            // MODIFICATION END

            // Currency conversion is attempted regardless, as it might still parse if no units were found,
            // or if it's a currency query, this is its main path.
            // `processCurrencyConversion` will use `TextExtractor.extractCurrencyDetails` internally.
            const currencyResultObject = await Converter.processCurrencyConversion(selectedText);
            if (currencyResultObject) {
                conversionAttempted = true; // A currency conversion was attempted (successfully or with error)
                resultsArray.push(currencyResultObject);
            }
            return { resultsArray, conversionAttempted };
        }
    };

    const _POPUP_STYLES = `
		#${UI_STRINGS.POPUP_LAYER_ID}{font-family:"Lato","나눔바른고딕","Malgun Gothic",sans-serif;font-size:18px;color:#1d1d1f;letter-spacing:-.022em;border-radius:14px;box-shadow:0 6px 20px rgba(0,0,0,.07),0 2px 8px rgba(0,0,0,.05);border:1px solid rgba(0,0,0,.06);max-width:580px;min-width:300px;overflow:hidden;position:fixed;z-index:2147483647!important;cursor:default;padding:0;transition:opacity .25s cubic-bezier(.4,0,.2,1),transform .25s cubic-bezier(.4,0,.2,1);transform:scale(.95) translateY(15px);opacity:0;max-height:80vh}
		#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_VISIBLE_CLASS}{transform:scale(1) translateY(0);opacity:1}
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-window-title-bar{position:absolute;top:0;left:0;width:100%;height:40px;cursor:grab;user-select:none;display:flex;align-items:center;padding:0 14px;box-sizing:border-box}
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-window-title-bar:active{cursor:grabbing}
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-close-btn{position:absolute;top:10px;right:12px;width:22px;height:22px;background-color:rgba(0,0,0,.08);border:none;color:rgba(0,0,0,.55);font-size:17px;font-weight:400;border-radius:50%;cursor:pointer;padding:0;user-select:none;transition:background-color .2s ease,color .2s ease,transform .15s ease,box-shadow .2s ease;display:flex;align-items:center;justify-content:center;line-height:1}
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-close-btn:hover{background-color:rgba(0,0,0,.13);color:rgba(0,0,0,.7);box-shadow:0 1px 3px rgba(0,0,0,.07)}
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-close-btn:active{background-color:rgba(0,0,0,.17);color:rgba(0,0,0,.8);transform:scale(.93);box-shadow:inset 0 1px 1px rgba(0,0,0,.1)}
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-content-container{padding:12px 18px 18px;margin-top:40px;line-height:1.65;text-align:left;overflow-y:auto;max-height:calc(80vh - 40px - 18px);word-break:break-word}
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-item{padding-bottom:14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:flex-start}
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-item:last-child{margin-bottom:0;padding-bottom:0}
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-item:not(:last-child){border-bottom:1px solid rgba(0,0,0,.08)}
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-item-text-content{flex-grow:1;padding-right:12px;line-height:1.5}
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-item-text-content div{margin-bottom:2px}
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-item-text-content div:last-child{margin-bottom:0}
		#${UI_STRINGS.POPUP_LAYER_ID} b{font-weight:600;color:#000}
		#${UI_STRINGS.POPUP_LAYER_ID} .converted-value{font-size:1.2em;font-weight:700;color:#0071e3}
		#${UI_STRINGS.POPUP_LAYER_ID} .original-value{font-weight:400;color:#333}
		#${UI_STRINGS.POPUP_LAYER_ID} small{font-size:.8em;font-weight:400;color:#585858;display:block;margin-top:4px;letter-spacing:-.01em}
		#${UI_STRINGS.POPUP_LAYER_ID} .category-icon{display:inline-block;margin-right:6px;font-size:.95em;opacity:.8}
		#${UI_STRINGS.POPUP_LAYER_ID} .title-suffix{font-size:.85em;font-weight:500;color:#6e6e73;margin-left:4px}
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-copy-btn{background-color:#007aff;border:none;color:#fff;padding:7px 15px;font-size:.75em;font-weight:500;letter-spacing:-.01em;border-radius:9px;cursor:pointer;margin-left:10px;margin-top:3px;transition:background-color .15s ease,transform .1s ease,box-shadow .15s ease;white-space:nowrap;flex-shrink:0;box-shadow:0 1px 2px rgba(0,122,255,.2)}
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-copy-btn:hover{background-color:#0071e3;box-shadow:0 2px 4px rgba(0,122,255,.25)}
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-copy-btn:active{background-color:#0066cc;transform:scale(.95);box-shadow:inset 0 1px 2px rgba(0,0,0,.15)}
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-copy-btn.success{background-color:#34c759;box-shadow:0 1px 2px rgba(52,199,89,.2)}
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-copy-btn.success:hover{background-color:#2fab4e;box-shadow:0 2px 4px rgba(52,199,89,.25)}
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-copy-btn.fail{background-color:#ff3b30;box-shadow:0 1px 2px rgba(255,59,48,.2)}
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-copy-btn.fail:hover{background-color:#fa2a1e;box-shadow:0 2px 4px rgba(255,59,48,.25)}
		#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_DEFAULT_CLASS}{background-color:rgba(252,252,254,.95);backdrop-filter:blur(16px) saturate(170%);-webkit-backdrop-filter:blur(16px) saturate(170%)}
		#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_DEFAULT_CLASS} .smart-converter-window-title-bar{border-bottom:1px solid rgba(0,0,0,.08)}
		#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_DEFAULT_CLASS} .smart-converter-content-container{background-color:transparent}
		#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_ERROR_CLASS}{background-color:rgba(255,238,238,.95);border-color:rgba(200,70,60,.6);backdrop-filter:blur(16px) saturate(170%);-webkit-backdrop-filter:blur(16px) saturate(170%)}
		#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_ERROR_CLASS} .smart-converter-window-title-bar{border-bottom:1px solid rgba(200,70,60,.3)}
		#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_ERROR_CLASS} .smart-converter-content-container{background-color:transparent}
		#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_ERROR_CLASS} .smart-converter-item-text-content,#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_ERROR_CLASS} .smart-converter-item-text-content b,#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_ERROR_CLASS} .smart-converter-item-text-content div{color:#a6160a}
		#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_ERROR_CLASS} small{color:#b32b1e!important}
		#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_LOADING_CLASS}{background-color:rgba(238,245,255,.95);border-color:rgba(110,170,240,.6);backdrop-filter:blur(16px) saturate(170%);-webkit-backdrop-filter:blur(16px) saturate(170%)}
		#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_LOADING_CLASS} .smart-converter-window-title-bar{border-bottom:1px solid rgba(110,170,240,.3)}
		#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_LOADING_CLASS} .smart-converter-content-container{background-color:transparent}
		#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_LOADING_CLASS} .smart-converter-item-text-content,#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_LOADING_CLASS} .smart-converter-item-text-content div{color:#0b3a85;position:relative}
		#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_LOADING_CLASS} .smart-converter-item-text-content div::after{content:"";display:inline-block;width:.9em;height:.9em;margin-left:10px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:smart-converter-spinner .8s linear infinite;vertical-align:middle;position:absolute;top:50%;transform:translateY(-50%)}
		@keyframes smart-converter-spinner{to{transform:translateY(-50%) rotate(360deg)}}
    `.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '').replace(/\n\s*\n/g, '\n').replace(/\s{2,}/g, ' ').replace(/:\s/g, ':').replace(/;\s/g, ';').replace(/,\s/g, ',');


    const PopupUI = {
        create: function() {
            if (document.getElementById(UI_STRINGS.POPUP_LAYER_ID)) return;

            const popup = document.createElement('div');
            popup.id = UI_STRINGS.POPUP_LAYER_ID;
            popup.style.display = 'none';
            popup.setAttribute('role', 'dialog');
            popup.setAttribute('aria-modal', 'true');


            const titleBarElement = document.createElement('div');
            titleBarElement.className = 'smart-converter-window-title-bar';
            popup.appendChild(titleBarElement);

            const closeButton = document.createElement('span');
            closeButton.textContent = UI_STRINGS.CLOSE_BUTTON_TEXT;
            closeButton.className = 'smart-converter-close-btn';
            closeButton.title = UI_STRINGS.CLOSE_BUTTON_TITLE;
            closeButton.onclick = (e) => { e.stopPropagation(); PopupUI.close(); };
            popup.appendChild(closeButton);

            AppState.popupContentContainer = document.createElement('div');
            AppState.popupContentContainer.className = 'smart-converter-content-container';
            popup.appendChild(AppState.popupContentContainer);

            document.body.appendChild(popup);
            AppState.currentPopupElement = popup;

            PopupUI.enableDrag(popup, titleBarElement, closeButton);
        },
        enableDrag: function(popupEl, dragHandleEl, closeButtonEl) {
            let isDragging = false;
            let dragOffsetX, dragOffsetY;

            dragHandleEl.onmousedown = function(e) {
                if (closeButtonEl && e.target === closeButtonEl) return;
                isDragging = true;
                const rect = popupEl.getBoundingClientRect();
                dragOffsetX = e.clientX - rect.left;
                dragOffsetY = e.clientY - rect.top;

                popupEl.style.willChange = 'transform';
                document.addEventListener('mousemove', onDrag);
                document.addEventListener('mouseup', onDragEnd);
                e.preventDefault();
            };
            function onDrag(e) {
                if (!isDragging) return;
                let newLeft = e.clientX - dragOffsetX;
                let newTop = e.clientY - dragOffsetY;

                const vpWidth = window.innerWidth;
                const vpHeight = window.innerHeight;

                newLeft = Math.max(Config.POPUP_SCREEN_MARGIN, Math.min(newLeft, vpWidth - popupEl.offsetWidth - Config.POPUP_SCREEN_MARGIN));
                newTop = Math.max(Config.POPUP_SCREEN_MARGIN, Math.min(newTop, vpHeight - popupEl.offsetHeight - Config.POPUP_SCREEN_MARGIN));

                popupEl.style.left = newLeft + 'px';
                popupEl.style.top = newTop + 'px';
            }
            function onDragEnd() {
                isDragging = false;
                popupEl.style.willChange = 'auto';
                document.removeEventListener('mousemove', onDrag);
                document.removeEventListener('mouseup', onDragEnd);
            }
        },
        close: function() {
            if (AppState.currentPopupElement) {
                AppState.currentPopupElement.classList.remove(UI_STRINGS.POPUP_VISIBLE_CLASS);
                clearTimeout(AppState.closePopupTimeout);
                AppState.closePopupTimeout = setTimeout(() => {
                    if (AppState.currentPopupElement && !AppState.currentPopupElement.classList.contains(UI_STRINGS.POPUP_VISIBLE_CLASS)) {
                        AppState.currentPopupElement.style.display = 'none';
                    }
                }, 250);
            }
        },
        calculatePosition: function(popupEl) {
            let top, left;
            const selection = window.getSelection();
            let currentSelRect = null;

            if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                currentSelRect = (range.collapsed && AppState.lastSelectionRect && (AppState.lastSelectionRect.width > 0 || AppState.lastSelectionRect.height > 0)) ?
                    AppState.lastSelectionRect : range.getBoundingClientRect();
                if ((currentSelRect.width === 0 && currentSelRect.height === 0) && AppState.lastSelectionRect && (AppState.lastSelectionRect.width > 0 || AppState.lastSelectionRect.height > 0)) {
                    currentSelRect = AppState.lastSelectionRect;
                }
            } else if (AppState.lastSelectionRect && (AppState.lastSelectionRect.width > 0 || AppState.lastSelectionRect.height > 0)) {
                currentSelRect = AppState.lastSelectionRect;
            }

            const popupWidth = popupEl.offsetWidth;
            const popupHeight = popupEl.offsetHeight;

            if (currentSelRect && (currentSelRect.width > 0 || currentSelRect.height > 0)) {
                top = currentSelRect.bottom + Config.POPUP_OFFSET_Y;
                left = currentSelRect.left + Config.POPUP_OFFSET_X;

                if (top + popupHeight > window.innerHeight - Config.POPUP_SCREEN_MARGIN) {
                    top = currentSelRect.top - popupHeight - Config.POPUP_OFFSET_Y;
                }
            } else {
                top = AppState.lastMouseY + Config.POPUP_OFFSET_Y;
                left = AppState.lastMouseX + Config.POPUP_OFFSET_X;
            }

            left = Math.max(Config.POPUP_SCREEN_MARGIN, Math.min(left, window.innerWidth - popupWidth - Config.POPUP_SCREEN_MARGIN));
            top = Math.max(Config.POPUP_SCREEN_MARGIN, Math.min(top, window.innerHeight - popupHeight - Config.POPUP_SCREEN_MARGIN));

            return { top, left };
        },
        display: function(messagesArray, isErrorState = false, isLoadingState = false) {
            if (!AppState.currentPopupElement) PopupUI.create();
            if (!AppState.currentPopupElement || !AppState.popupContentContainer) return;

            clearTimeout(AppState.closePopupTimeout);

            const fragment = document.createDocumentFragment();
            messagesArray.forEach((msgData) => {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'smart-converter-item';

                const textContentDiv = document.createElement('div');
                textContentDiv.className = 'smart-converter-item-text-content';

                if (typeof msgData === 'object' && msgData !== null) {
                    if (msgData.titleHtml) {
                        const titleEl = document.createElement('div');
                        titleEl.innerHTML = msgData.titleHtml;
                        textContentDiv.appendChild(titleEl);
                    }
                    if (msgData.contentHtml) {
                        const contentEl = document.createElement('div');
                        contentEl.innerHTML = msgData.contentHtml;
                        if (msgData.titleHtml && contentEl.childNodes.length > 0) contentEl.style.marginTop = '4px';
                        textContentDiv.appendChild(contentEl);
                    }
                    itemDiv.appendChild(textContentDiv);

                    if (!isLoadingState && !isErrorState && !Utils.isInvalidString(msgData.copyText) && !msgData.isError) {
                        const copyBtn = document.createElement('button');
                        copyBtn.textContent = UI_STRINGS.COPY_BUTTON_TEXT;
                        copyBtn.className = 'smart-converter-copy-btn';
                        copyBtn.title = UI_STRINGS.COPY_BUTTON_TITLE;
                        copyBtn.onclick = (e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(msgData.copyText)
                                .then(() => {
                                    copyBtn.textContent = UI_STRINGS.COPY_SUCCESS_TEXT;
                                    copyBtn.classList.add('success');
                                    setTimeout(() => {
                                        copyBtn.textContent = UI_STRINGS.COPY_BUTTON_TEXT;
                                        copyBtn.classList.remove('success');
                                    }, 1500);
                                })
                                .catch(() => {
                                    copyBtn.textContent = UI_STRINGS.COPY_FAIL_TEXT;
                                    copyBtn.classList.add('fail');
                                    setTimeout(() => {
                                        copyBtn.textContent = UI_STRINGS.COPY_BUTTON_TEXT;
                                        copyBtn.classList.remove('fail');
                                    }, 1500);
                                });
                        };
                        itemDiv.appendChild(copyBtn);
                    }
                } else {
                    const plainTextDiv = document.createElement('div');
                    plainTextDiv.textContent = String(msgData);
                    textContentDiv.appendChild(plainTextDiv);
                    itemDiv.appendChild(textContentDiv);
                }
                fragment.appendChild(itemDiv);
            });

            while (AppState.popupContentContainer.firstChild) AppState.popupContentContainer.removeChild(AppState.popupContentContainer.firstChild);
            AppState.popupContentContainer.appendChild(fragment);

            AppState.currentPopupElement.classList.remove(UI_STRINGS.POPUP_DEFAULT_CLASS, UI_STRINGS.POPUP_ERROR_CLASS, UI_STRINGS.POPUP_LOADING_CLASS);
            if (isErrorState) AppState.currentPopupElement.classList.add(UI_STRINGS.POPUP_ERROR_CLASS);
            else if (isLoadingState) AppState.currentPopupElement.classList.add(UI_STRINGS.POPUP_LOADING_CLASS);
            else AppState.currentPopupElement.classList.add(UI_STRINGS.POPUP_DEFAULT_CLASS);

            AppState.currentPopupElement.style.display = 'block';
            AppState.currentPopupElement.style.visibility = 'hidden';

            requestAnimationFrame(() => {
                const { top, left } = PopupUI.calculatePosition(AppState.currentPopupElement);
                AppState.currentPopupElement.style.top = `${top}px`;
                AppState.currentPopupElement.style.left = `${left}px`;
                AppState.currentPopupElement.style.visibility = 'visible';
                AppState.currentPopupElement.classList.add(UI_STRINGS.POPUP_VISIBLE_CLASS);
            });
        },
        addGlobalStyle: function(css) {
            const head = document.head || document.getElementsByTagName('head')[0];
            if (head) {
                const style = document.createElement('style');
                style.type = 'text/css';
                style.appendChild(document.createTextNode(css));
                head.appendChild(style);
            }
        },
        injectStyles: function() {
            PopupUI.addGlobalStyle(_POPUP_STYLES);
        }
    };

    const EventHandlers = {
        handleUnifiedConvertAction: async function() {
            const selection = window.getSelection();
            const selectedText = selection ? selection.toString().trim() : "";

            if (Utils.isInvalidString(selectedText)) {
                if (AppState.currentPopupElement && AppState.currentPopupElement.style.display !== 'none') {
                    PopupUI.close();
                }
                return;
            }

            const previewText = Utils.getPreviewText(selectedText);
            PopupUI.display([{ contentHtml: `<div>${UI_STRINGS.CONVERTING_MESSAGE_PREFIX}${Utils.escapeHTML(previewText)}${UI_STRINGS.CONVERTING_MESSAGE_SUFFIX}</div>` }], false, true);

            const { resultsArray, conversionAttempted } = await Converter.fetchAndProcessConversions(selectedText);

            if (resultsArray.length > 0) {
                const hasError = resultsArray.some(res => res.isError);
                PopupUI.display(resultsArray, hasError, false);
            } else if (conversionAttempted) {
                 PopupUI.display([{ contentHtml: `<div>${UI_STRINGS.ERROR_NO_VALID_CONVERSION(previewText)}</div>` }], true, false);
            } else {
                PopupUI.display([{ contentHtml: `<div>${UI_STRINGS.ERROR_CANNOT_FIND_CONVERTIBLE(previewText)}</div>` }], true, false);
            }
        },
        updateMousePositionAndSelectionRect: function(event) {
            AppState.lastMouseX = event.clientX;
            AppState.lastMouseY = event.clientY;
            const selection = window.getSelection();
            if (selection && selection.toString().trim() !== "" && selection.rangeCount > 0) {
                const rect = selection.getRangeAt(0).getBoundingClientRect();
                if (rect.width > 0 || rect.height > 0) {
                    AppState.lastSelectionRect = rect;
                }
            }
        },
        handleSelectionChange: function() {
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0 && selection.toString().trim() !== "") {
                const rect = selection.getRangeAt(0).getBoundingClientRect();
                if (rect.width > 0 || rect.height > 0) AppState.lastSelectionRect = rect;
            }
        },
        initEventListeners: function() {
            document.addEventListener('mouseup', EventHandlers.updateMousePositionAndSelectionRect);
            document.addEventListener('contextmenu', (e) => EventHandlers.updateMousePositionAndSelectionRect(e), true);
            document.addEventListener('selectionchange', Utils.debounce(EventHandlers.handleSelectionChange, 250));
            document.addEventListener('keydown', function(event) {
                if (event.altKey && (event.key === 'z' || event.key === 'Z' || event.code === 'KeyZ')) {
                    event.preventDefault();
                    event.stopPropagation();
                    EventHandlers.handleUnifiedConvertAction();
                }
                if (event.key === 'Escape' || event.code === 'Escape') {
                    if (AppState.currentPopupElement && AppState.currentPopupElement.style.display !== 'none') {
                        PopupUI.close();
                    }
                }
            });
            window.addEventListener('scroll', () => {
                 if (AppState.currentPopupElement && AppState.currentPopupElement.style.display !== 'none' && AppState.currentPopupElement.classList.contains(UI_STRINGS.POPUP_VISIBLE_CLASS)) {
                    PopupUI.close();
                 }
            }, true);
            window.addEventListener('resize', Utils.debounce(() => {
                if (AppState.currentPopupElement && AppState.currentPopupElement.style.display !== 'none' && AppState.currentPopupElement.classList.contains(UI_STRINGS.POPUP_VISIBLE_CLASS)) {
                    const { top, left } = PopupUI.calculatePosition(AppState.currentPopupElement);
                    AppState.currentPopupElement.style.top = `${top}px`;
                    AppState.currentPopupElement.style.left = `${left}px`;
                }
            }, 250));
        }
    };

    function textConverterMain() {
        PopupUI.injectStyles();
        EventHandlers.initEventListeners();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', textConverterMain);
    } else {
        textConverterMain();
    }

  })(); // End of IIFE for Text Converter
