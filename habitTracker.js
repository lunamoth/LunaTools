document.addEventListener('DOMContentLoaded', () => {
    // --- MODIFIED: 신규 업적 대량 추가 ---
    const achievementList = {
        'first_habit': { title: '첫걸음', description: '첫 습관을 추가했습니다.', icon: '🌱' },
        'perfect_day': { title: '완벽한 하루', description: '하루의 모든 습관을 완료했습니다.', icon: '💯' },
        '7_day_streak': { title: '불타는 일주일', description: '한 습관을 7일 연속으로 달성했습니다.', icon: '🔥' },
        'perfect_week': { title: '완벽한 한 주', description: '7일 연속으로 모든 습관을 완료했습니다.', icon: '📅' },
        '30_day_streak': { title: '한 달의 위업', description: '한 습관을 30일 연속으로 달성했습니다.', icon: '🗓️' },
        '100_completions': { title: '성실함의 증표', description: '한 습관을 100회 완료했습니다.', icon: '👑' },
        '5_habits': { title: '습관 부자', description: '5개 이상의 활성 습관을 만들었습니다.', icon: '🏦' },
        '10_habits': { title: '습관 콜렉터', description: '10개 이상의 활성 습관을 만들었습니다.', icon: '📚' },
        'archivist': { title: '정리정돈', description: '첫 습관을 보관했습니다.', icon: '📦' },
        'perfect_month': { title: '완벽한 한 달', description: '한 달 내내 모든 습관을 100% 달성했습니다.', icon: '🏅' },
        '180_day_streak': { title: '반년의 끈기', description: '한 습관을 180일 연속으로 달성했습니다.', icon: '🦾' },
        '365_day_streak': { title: '1년의 위업', description: '한 습관을 365일 연속으로 달성했습니다.', icon: '🎉' },
        '500_completions': { title: '장인정신', description: '한 습관을 500회 완료했습니다.', icon: '💎' },
        '1000_completions': { title: '습관의 대가', description: '한 습관을 1000회 완료했습니다.', icon: '🌌' },
        'explorer': { title: '탐험가', description: '모든 주요 메뉴를 한 번씩 사용했습니다.', icon: '🧭' },
        'data_guardian': { title: '데이터 지킴이', description: '데이터를 처음으로 백업했습니다.', icon: '🛡️' },
        'comeback_king': { title: '돌아온 탕자', description: '7일 이상 쉬고 다시 습관을 시작했습니다.', icon: '💪' },
    };
    
    let draggedItem = null;
    let dropPlaceholder = null;

    const getClosestElement = (target, selector) => {
        const isTextNode = typeof Node !== 'undefined' && target?.nodeType === Node.TEXT_NODE;
        const element = isTextNode ? target.parentElement : target;
        return element && typeof element.closest === 'function' ? element.closest(selector) : null;
    };

    const getPreviousCalendarYearRangeStart = (endDate) => {
        const sourceDate = endDate instanceof Date ? new Date(endDate.getTime()) : new Date(endDate);
        if (Number.isNaN(sourceDate.getTime())) return null;

        // 2월 29일에 setFullYear()를 직접 호출하면 3월로 넘친 뒤 일자를 한 번 더
        // 더하는 과정에서 연간 통계 시작일이 최대 한 달 가까이 밀릴 수 있습니다.
        const sourceMonth = sourceDate.getMonth();
        const sourceDay = sourceDate.getDate();
        sourceDate.setDate(1);
        sourceDate.setFullYear(sourceDate.getFullYear() - 1);
        sourceDate.setMonth(sourceMonth);
        const lastDayOfTargetMonth = new Date(
            sourceDate.getFullYear(),
            sourceMonth + 1,
            0
        ).getDate();
        sourceDate.setDate(Math.min(sourceDay, lastDayOfTargetMonth));
        sourceDate.setDate(sourceDate.getDate() + 1);
        return sourceDate;
    };

    const app = {
        state: {
            // --- MODIFIED: 데이터 버전 관리 기능 추가 ---
            version: '3.6.1',
            habits: [],
            currentView: 'calendar',
            currentDate: new Date(),
            settings: {
                theme: 'light',
            },
            achievements: {},
            // --- NEW: 리뷰 기능 상태 추가 ---
            reviewPeriod: 'weekly',
            // --- NEW: 탐험가 업적 달성을 위한 상태 추가 ---
            visitedViews: {},
            filters: {
                search: '',
                showArchived: false,
                sortBy: 'order',
            },
            reportPeriod: 'weekly',
            chartInstances: {},
        },

        elements: {},
        _hadDataLoadError: false,
        _hasPersistedIntegratedData: false,
        _activeConfirmCleanup: null,

        init() {
            this.cacheElements();
            this.loadData();
            this.state.currentView = 'calendar';
            
            // --- MODIFIED: 사용자가 데이터를 초기화한 후 새로고침 시 기본 습관이 추가되는 것을 방지 ---
            let hasBeenInitialized = false;
            if (!this._hadDataLoadError) {
                try {
                    hasBeenInitialized = localStorage.getItem('habitTrackerInitialized') === 'true';
                } catch (error) {
                    // 초기화 플래그를 읽지 못한 상태에서 샘플 데이터를 저장하면 접근할 수 없는
                    // 기존 사용자 데이터를 덮어쓸 수 있으므로, 보수적으로 오류 상태로 전환합니다.
                    this._hadDataLoadError = true;
                    this._hasPersistedIntegratedData = true;
                    console.error('Failed to read the habit tracker initialization flag. Default data creation was blocked.', error);
                }
            }
            // 통합 키에 정상적인 빈 상태가 있다면 '초기화하지 않음'이 아니라
            // 사용자가 의도적으로 모두 지운 저장된 상태일 수 있습니다.
            if (this.state.habits.length === 0
                && !hasBeenInitialized
                && !this._hasPersistedIntegratedData
                && !this._hadDataLoadError) {
                if (this.setupDefaultHabits()) {
                    this._hasPersistedIntegratedData = true;
                    try {
                        localStorage.setItem('habitTrackerInitialized', 'true');
                    } catch (error) {
                        console.error('Failed to persist habit tracker initialization flag.', error);
                    }
                }
            }
            
            this.applySettings();
            this.addEventListeners();
            this.render();
            this.showRandomQuote();
            if (this._hadDataLoadError) {
                this.showToast('습관 데이터를 안전하게 불러오지 못했습니다. 원본 보호를 위해 자동 저장과 기본 데이터 생성을 중단했습니다.', 'error', 6000);
            }
        },
        
            setupDefaultHabits(saveOptions = {}) {
            const now = Date.now();
            const defaultHabits = [
                { id: now + 0, name: '⚖️ 매일 아침 체중 측정', type: 'check', goal: 1, frequency: { type: 'daily', days: [0,1,2,3,4,5,6] }, isArchived: false, order: 0, logs: {}, createdAt: now + 0 },
                { id: now + 1, name: '🥗 샐러드 먹기', type: 'check', goal: 1, frequency: { type: 'daily', days: [0,1,2,3,4,5,6] }, isArchived: false, order: 1, logs: {}, createdAt: now + 1 },
                { id: now + 2, name: '💧 물 1리터 마시기', type: 'check', goal: 1, frequency: { type: 'daily', days: [0,1,2,3,4,5,6] }, isArchived: false, order: 2, logs: {}, createdAt: now + 2 },
                { id: now + 3, name: '🕒 4시 이후 금식', type: 'check', goal: 1, frequency: { type: 'daily', days: [0,1,2,3,4,5,6] }, isArchived: false, order: 3, logs: {}, createdAt: now + 3 },
                { id: now + 4, name: '💊 영양제 먹기', type: 'check', goal: 1, frequency: { type: 'daily', days: [0,1,2,3,4,5,6] }, isArchived: false, order: 4, logs: {}, createdAt: now + 4 },
                { id: now + 5, name: '😴 7~8시간 자기', type: 'check', goal: 1, frequency: { type: 'daily', days: [0,1,2,3,4,5,6] }, isArchived: false, order: 5, logs: {}, createdAt: now + 5 },
                { id: now + 6, name: '🚫 쌀/빵/면/과자/과당음료 먹지 않기', type: 'check', goal: 1, frequency: { type: 'daily', days: [0,1,2,3,4,5,6] }, isArchived: false, order: 6, logs: {}, createdAt: now + 6 },
                { id: now + 7, name: '🏋️ 운동', type: 'check', goal: 1, frequency: { type: 'daily', days: [0,1,2,3,4,5,6] }, isArchived: false, order: 7, logs: {}, createdAt: now + 7 }
            ];
            const previousHabits = this.state.habits;
            this.state.habits = defaultHabits;
            if (this.saveData(saveOptions)) return true;

            // 저장에 실패한 샘플을 화면에 남기면 사용자는 영구 저장된 것으로 오인하고
            // 기록을 시작할 수 있습니다. 재시작 시 그 기록이 사라지지 않도록 메모리도
            // 저장 전 상태로 되돌립니다.
            this.state.habits = previousHabits;
            return false;
        },

        cacheElements() {
            this.elements = {
                appContent: document.getElementById('app-content'),
                appFiltersContainer: document.getElementById('app-filters-container'),
                addHabitBtn: document.getElementById('add-habit-btn'),
                // settingsBtn 제거
                achievementsBtn: document.getElementById('achievements-btn'),
                viewButtons: document.querySelectorAll('.view-switcher button'),
                habitModal: document.getElementById('habit-modal'),
                // settingsModal 제거
                confirmModal: document.getElementById('confirm-modal'),
                achievementsModal: document.getElementById('achievements-modal'),
                habitForm: document.getElementById('habit-form'),
                modalTitle: document.getElementById('modal-title'),
                habitIdInput: document.getElementById('habit-id'),
                habitNameInput: document.getElementById('habit-name'),
                habitFrequencySelect: document.getElementById('habit-frequency'),
                specificDaysGroup: document.getElementById('specific-days-group'),
                deleteHabitBtn: document.getElementById('delete-habit-btn'),
                archiveHabitBtn: document.getElementById('archive-habit-btn'),
                cancelHabitBtn: document.getElementById('cancel-habit-btn'),
                // themeToggleBtn, exportDataBtn 등 제거
                confirmTitle: document.getElementById('confirm-title'),
                confirmMessage: document.getElementById('confirm-message'),
                confirmOkBtn: document.getElementById('confirm-ok-btn'),
                confirmCancelBtn: document.getElementById('confirm-cancel-btn'),
                achievementsGrid: document.getElementById('achievements-grid'),
                motivationalQuote: document.getElementById('motivational-quote'),
                datePickerInput: document.getElementById('date-picker-input'),
                toastContainer: document.getElementById('toast-container'),
            };
        },

        addEventListeners() {
            // [기능 추가] 부모 창(MothNote)로부터 테마 변경 메시지 수신
            window.addEventListener('message', (event) => {
                // 보안을 위해 메시지 출처 확인
                if (event.origin !== window.location.origin || event.source !== window.parent) {
                    return;
                }
                if (event.data && event.data.type === 'setTheme') {
                    this.state.settings.theme = event.data.theme;
                    this.applySettings();
                    this.saveData();
                }
            });

            this.elements.viewButtons.forEach(btn => {
                btn.addEventListener('click', () => {
                    const viewName = btn.id.split('-')[1];
                    this.state.currentView = viewName;

                    // 메뉴 방문 기록은 업적이 해제되기 전에도 영구 저장해야 합니다.
                    // 이전에는 여섯 번째 메뉴를 같은 세션에서 누른 경우에만 저장되어,
                    // 중간에 새로고침하면 탐험가 진행도가 매번 사라졌습니다.
                    if (this.markViewVisited(viewName)) {
                        this.checkAchievement('explorer');
                    }

                    if (this.state.currentView === 'today') {
                        this.state.currentDate = new Date();
                        this.state.currentDate.setHours(0,0,0,0);
                    }
                    this.render();
                });
            });

            this.elements.addHabitBtn.addEventListener('click', () => this.openHabitModal());
            this.elements.achievementsBtn.addEventListener('click', () => this.openAchievementsModal());

            document.querySelectorAll('.modal').forEach(modal => {
                modal.addEventListener('click', (e) => {
                    if (e.target === modal || e.target.classList.contains('close-button') || e.target.id === 'cancel-habit-btn') {
                        this.closeModal(modal);
                    }
                });
            });
            
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    const visibleModal = document.querySelector('.modal.visible');
                    if (visibleModal) {
                        this.closeModal(visibleModal);
                    }
                }
            });

            this.elements.habitForm.addEventListener('submit', (e) => this.handleHabitFormSubmit(e));
            this.elements.habitFrequencySelect.addEventListener('change', (e) => {
                this.elements.specificDaysGroup.style.display = e.target.value === 'specific_days' ? 'block' : 'none';
            });
            this.elements.deleteHabitBtn.addEventListener('click', () => this.handleDeleteHabit());
            this.elements.archiveHabitBtn.addEventListener('click', () => this.handleArchiveHabit());
            
            this.elements.datePickerInput.addEventListener('change', (e) => this.handleDateJump(e));

            this.addDelegatedEventListeners();
        },

        // ----- DATA & STATE MANAGEMENT -----
        saveData({ allowCorruptDataReplacement = false } = {}) {
            // 파싱 또는 구조 검증에 실패한 통합 데이터는 사용자가 명시적으로 초기화하기 전까지 보존합니다.
            // 테마 메시지나 일반 UI 작업이 빈 안전 상태를 자동 저장해 원본과 복구본을
            // 덮어쓰는 일을 막습니다.
            if (this._hadDataLoadError && !allowCorruptDataReplacement) {
                console.warn('Habit tracker save was blocked to preserve malformed integrated data.');
                if (typeof this.showToast === 'function') {
                    this.showToast('저장된 습관 데이터가 손상되어 원본 보호를 위해 변경사항을 저장하지 않았습니다. 초기화하거나 정상 백업을 가져와 주세요.', 'error');
                }
                return false;
            }

            // [수정] 데이터 저장 키를 MothNote와 통합될 키로 변경
            try {
                localStorage.setItem('habitTrackerDataV2_integrated', JSON.stringify(this.state, (key, value) => key === 'chartInstances' ? undefined : value));
                if (allowCorruptDataReplacement) {
                    this._hadDataLoadError = false;
                    this._hasPersistedIntegratedData = true;
                }
                return true;
            } catch (error) {
                console.error('Habit tracker data save failed.', error);
                if (typeof this.showToast === 'function') {
                    this.showToast('습관 트래커 데이터를 저장하지 못했습니다. 저장 공간 또는 브라우저 권한을 확인해주세요.', 'error');
                }
                return false;
            }
        },

        createPersistableStateSnapshot() {
            return JSON.parse(JSON.stringify({
                habits: this.state.habits,
                settings: this.state.settings,
                achievements: this.state.achievements,
                reviewPeriod: this.state.reviewPeriod,
                visitedViews: this.state.visitedViews,
                filters: this.state.filters,
                reportPeriod: this.state.reportPeriod
            }));
        },

        restorePersistableStateSnapshot(snapshot) {
            if (!snapshot || typeof snapshot !== 'object') return;
            Object.assign(this.state, JSON.parse(JSON.stringify(snapshot)));
        },

        saveDataOrRollback(snapshot, saveOptions = {}) {
            if (this.saveData(saveOptions)) return true;
            this.restorePersistableStateSnapshot(snapshot);
            return false;
        },

        markViewVisited(viewName) {
            const normalizedViewName = String(viewName ?? '');
            if (!normalizedViewName) return false;

            if (!this.state.visitedViews || typeof this.state.visitedViews !== 'object' || Array.isArray(this.state.visitedViews)) {
                this.state.visitedViews = {};
            }
            if (this.state.visitedViews[normalizedViewName] === true) return true;

            const previousState = this.createPersistableStateSnapshot();
            this.state.visitedViews[normalizedViewName] = true;
            return this.saveDataOrRollback(previousState);
        },

        updateFilterPreference(key, value) {
            if (!['search', 'showArchived', 'sortBy'].includes(key)) return false;
            if (Object.is(this.state.filters[key], value)) return false;

            this.state.filters = { ...this.state.filters, [key]: value };
            // 필터는 핵심 습관 데이터가 아니므로 저장 실패 시 현재 화면 선택까지
            // 되돌리지는 않습니다. saveData()가 실패 원인을 알리고, 원본 저장값은 보존합니다.
            this.saveData();
            return true;
        },

        sanitizeLoadedState(rawState = {}, options = {}) {
            if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
                rawState = {};
            }
            const reportStructuralCorruption = () => {
                if (typeof options?.onStructuralCorruption === 'function') {
                    options.onStructuralCorruption();
                }
            };
            const now = Date.now();
            const usedIds = new Set();
            const safeDatePattern = /^\d{4}-\d{2}-\d{2}$/;
            const validViews = new Set(['calendar', 'today', 'stats', 'timeline', 'review', 'archive']);
            const validSorts = new Set(['order', 'name_asc', 'name_desc', 'created_at', 'streak', 'completion_rate']);

            const safeInteger = (value, fallback) => {
                const num = Number(value);
                return Number.isSafeInteger(num) && num > 0 ? num : fallback;
            };
            const parseFiniteNumericScalar = value => {
                if (typeof value !== 'number' && typeof value !== 'string') return null;
                if (typeof value === 'string' && value.trim() === '') return null;
                const number = Number(value);
                return Number.isFinite(number) ? number : null;
            };
            const makeId = (value, index) => {
                let id = safeInteger(value, now + index + 1);
                while (usedIds.has(String(id))) id += 1;
                usedIds.add(String(id));
                return id;
            };
            const normalizeFrequency = (frequency) => {
                const validTypes = new Set(['daily', 'weekdays', 'weekends', 'specific_days']);
                const isFrequencyObject = Boolean(frequency) && typeof frequency === 'object' && !Array.isArray(frequency);
                if (frequency !== undefined && !isFrequencyObject) reportStructuralCorruption();
                if (isFrequencyObject
                    && Object.prototype.hasOwnProperty.call(frequency, 'type')
                    && !validTypes.has(frequency.type)) {
                    reportStructuralCorruption();
                }
                if (isFrequencyObject
                    && Object.prototype.hasOwnProperty.call(frequency, 'days')
                    && !Array.isArray(frequency.days)) {
                    reportStructuralCorruption();
                }
                const type = validTypes.has(frequency?.type) ? frequency.type : 'daily';
                const defaultDays = {
                    daily: [0,1,2,3,4,5,6],
                    weekdays: [1,2,3,4,5],
                    weekends: [0,6],
                    specific_days: [0,1,2,3,4,5,6]
                }[type];
                const rawDays = Array.isArray(frequency?.days) ? frequency.days : defaultDays;
                const hasInvalidDay = rawDays.some(day => {
                    const numericDay = parseFiniteNumericScalar(day);
                    return numericDay === null
                        || !Number.isInteger(numericDay)
                        || numericDay < 0
                        || numericDay > 6;
                });
                if (Array.isArray(frequency?.days) && (rawDays.length === 0 || hasInvalidDay)) {
                    reportStructuralCorruption();
                }
                const days = Array.from(new Set(rawDays
                    .map(parseFiniteNumericScalar)
                    .filter(day => Number.isInteger(day) && day >= 0 && day <= 6)));
                return { type, days: days.length ? days : defaultDays };
            };
            const getValidLocalDateTimestamp = (dateStr) => {
                if (!safeDatePattern.test(dateStr)) return null;
                const [year, month, day] = dateStr.split('-').map(Number);
                const localDate = new Date(year, month - 1, day);
                if (localDate.getFullYear() !== year || localDate.getMonth() !== month - 1 || localDate.getDate() !== day) {
                    return null;
                }
                localDate.setHours(0, 0, 0, 0);
                return localDate.getTime();
            };
            const normalizeLogs = (logs) => {
                const safeLogs = {};
                if (logs === undefined) return safeLogs;
                if (!logs || typeof logs !== 'object' || Array.isArray(logs)) {
                    reportStructuralCorruption();
                    return safeLogs;
                }
                for (const [date, entry] of Object.entries(logs)) {
                    // 형식만 맞는 존재하지 않는 날짜(예: 2026-02-31)가 Date에서 다음 달로
                    // 자동 보정되어 통계·업적 계산에 섞이지 않도록 달력 유효성까지 확인합니다.
                    if (getValidLocalDateTimestamp(date) === null) {
                        reportStructuralCorruption();
                        continue;
                    }
                    const valueToCheck = entry && typeof entry === 'object' && !Array.isArray(entry)
                        ? entry.value
                        : entry;
                    const value = parseFiniteNumericScalar(valueToCheck);
                    if (value === null) {
                        reportStructuralCorruption();
                        continue;
                    }
                    safeLogs[date] = { value: value > 0 ? 1 : 0 };
                }
                return safeLogs;
            };
            const habits = Array.isArray(rawState.habits) ? rawState.habits : [];
            const sanitizedHabits = habits
                .map((habit, index) => {
                    if (!habit || typeof habit !== 'object' || Array.isArray(habit)) {
                        reportStructuralCorruption();
                        return null;
                    }
                    const normalizedLogs = normalizeLogs(habit.logs);
                    const rawCreatedAt = Number(habit.createdAt);
                    const hasValidCreatedAt = Number.isFinite(rawCreatedAt)
                        && rawCreatedAt > 0
                        && !Number.isNaN(new Date(rawCreatedAt).getTime());
                    if (Object.prototype.hasOwnProperty.call(habit, 'name')
                        && (habit.name === null || typeof habit.name === 'object')) {
                        // 객체/배열/null 습관명을 문자열로 강제 변환해 원본을 조용히
                        // 훼손하지 않고, 손상 데이터 보호 모드로 전환합니다.
                        reportStructuralCorruption();
                    }
                    const earliestLogTimestamp = Object.keys(normalizedLogs)
                        .sort()
                        .map(getValidLocalDateTimestamp)
                        .find(timestamp => timestamp !== null);
                    return {
                        id: makeId(habit.id, index),
                        // 입력 단계에 없는 길이 제한을 로드 단계에서만 적용하면
                        // 재시작 후 사용자가 작성한 접미부가 조용히 손실됩니다.
                        name: String(habit.name ?? 'Untitled').trim() || 'Untitled',
                        type: 'check',
                        goal: 1,
                        frequency: normalizeFrequency(habit.frequency),
                        isArchived: Boolean(habit.isArchived),
                        order: Number.isFinite(Number(habit.order)) ? Number(habit.order) : index,
                        logs: normalizedLogs,
                        createdAt: hasValidCreatedAt ? rawCreatedAt : (earliestLogTimestamp ?? now + index)
                    };
                })
                .filter(Boolean)
                .sort((a, b) => a.order - b.order);

            const rawFilters = rawState.filters && typeof rawState.filters === 'object' ? rawState.filters : {};
            const rawSettings = rawState.settings && typeof rawState.settings === 'object' ? rawState.settings : {};
            const rawAchievements = rawState.achievements && typeof rawState.achievements === 'object' ? rawState.achievements : {};
            const rawVisited = rawState.visitedViews && typeof rawState.visitedViews === 'object' ? rawState.visitedViews : {};
            const currentDate = rawState.currentDate instanceof Date ? rawState.currentDate : new Date();
            currentDate.setHours(0, 0, 0, 0);

            return {
                habits: sanitizedHabits,
                currentView: validViews.has(rawState.currentView) ? rawState.currentView : 'calendar',
                currentDate,
                settings: { theme: rawSettings.theme === 'dark' ? 'dark' : 'light' },
                achievements: Object.fromEntries(Object.entries(rawAchievements)
                    .filter(([key, value]) => achievementList[key] && value && typeof value === 'object')
                    .map(([key, value]) => [key, { unlockedAt: String(value.unlockedAt ?? '') }])),
                reviewPeriod: rawState.reviewPeriod === 'monthly' ? 'monthly' : 'weekly',
                visitedViews: Object.fromEntries(Object.entries(rawVisited)
                    .filter(([key, value]) => validViews.has(key) && Boolean(value))
                    .map(([key]) => [key, true])),
                filters: {
                    search: String(rawFilters.search ?? '').slice(0, 120),
                    showArchived: Boolean(rawFilters.showArchived),
                    sortBy: validSorts.has(rawFilters.sortBy) ? rawFilters.sortBy : 'order'
                },
                reportPeriod: ['weekly', 'monthly', 'yearly', 'this_week', 'this_month'].includes(rawState.reportPeriod) ? rawState.reportPeriod : 'weekly',
                chartInstances: {}
            };
        },

        loadData() {
            this._hadDataLoadError = false;

            // [수정] MothNote와 통합된 키에서 데이터를 로드
            let data = null;
            let oldData = null;
            let veryOldData = null;
            try {
                data = localStorage.getItem('habitTrackerDataV2_integrated');
                oldData = localStorage.getItem('habitTrackerDataV2'); // 이전 버전 키
                veryOldData = localStorage.getItem('habitTrackerData'); // 아주 오래된 버전 키
            } catch (error) {
                // 저장소 접근 자체가 실패한 경우 데이터의 존재 여부를 알 수 없습니다.
                // 빈 상태를 표시하되 저장 및 기본 데이터 생성을 막아, 보이지 않는 원본을 보호합니다.
                this._hadDataLoadError = true;
                this._hasPersistedIntegratedData = true;
                console.error('Habit tracker storage could not be read. Starting in a protected safe state.', error);
                const safeState = this.sanitizeLoadedState({});
                const initialTheme = new URLSearchParams(window.location.search).get('theme') || 'light';
                safeState.settings.theme = initialTheme;
                this.state = { ...this.state, ...safeState, chartInstances: {} };
                return;
            }
            this._hasPersistedIntegratedData = data !== null;

			if (data !== null) {
                try {
                    if (typeof data !== 'string' || data.trim() === '') {
                        throw new Error('Integrated habit data is empty.');
                    }
                    const parsedData = JSON.parse(data);
                    if (!parsedData || typeof parsedData !== 'object' || Array.isArray(parsedData) || !Array.isArray(parsedData.habits)) {
                        throw new Error('Integrated habit data has an invalid top-level structure.');
                    }
                    
                    // [수정] 저장된 날짜(과거)를 무시하고 항상 '오늘' 날짜로 초기화합니다.
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    parsedData.currentDate = today;

                    // 기존 state에 덮어씌우되, 손상/조작된 로컬 데이터는 먼저 정규화합니다.
                    // 사용자 습관/로그 레코드가 유실되는 정규화는 실패로 처리해 원본 키를 보존합니다.
                    let hasStructuralCorruption = false;
                    const sanitizedState = this.sanitizeLoadedState(parsedData, {
                        onStructuralCorruption: () => { hasStructuralCorruption = true; }
                    });
                    if (hasStructuralCorruption) {
                        throw new Error('Integrated habit data contains malformed habit, frequency, or log records.');
                    }
                    this.state = { ...this.state, ...sanitizedState, chartInstances: {} };
                } catch (error) {
                    this._hadDataLoadError = true;
                    console.error('Habit tracker data load failed. Starting with a safe empty state without deleting the original data.', error);
                    try {
                        localStorage.setItem('habitTrackerDataV2_integrated_corrupt_backup', JSON.stringify({
                            timestamp: Date.now(),
                            data
                        }));
                    } catch (backupError) {
                        console.warn('Failed to preserve corrupt habit tracker data backup.', backupError);
                    }
                    // 원본 키를 삭제하지 않습니다. 기본 습관 자동 생성도 막아 손상 원본을 샘플 데이터로 덮어쓰지 않습니다.
                    this.state = { ...this.state, ...this.sanitizeLoadedState({}), chartInstances: {} };
                }
                
                // [수정] URL 파라미터에서 초기 테마를 가져옵니다.
                const urlParams = new URLSearchParams(window.location.search);
                const initialTheme = urlParams.get('theme') || 'light';
                this.state.settings.theme = initialTheme;
            } else {
                 const urlParams = new URLSearchParams(window.location.search);
                 const initialTheme = urlParams.get('theme') || 'light';
                 this.state.settings = { theme: initialTheme };

                const today = new Date();
                today.setHours(0,0,0,0);
                this.state.currentDate = today;
            }
            
            // 레거시 마이그레이션은 현재 통합 데이터가 '없을 때'만 합니다.
            // 통합 키의 habits: []는 유효한 사용자 상태이며, 오래된 키로 덮어쓰면 안 됩니다.
            if (!this._hadDataLoadError && !this._hasPersistedIntegratedData && (oldData || veryOldData)) {
                console.log("Old data found and no new data exists. Migrating...");
                this.migrateData(oldData || veryOldData, oldData ? 'habitTrackerDataV2' : 'habitTrackerData');
            }
        },
        
        migrateData(oldDataString, legacyKey = null) {
            const previousState = this.state;
            try {
                const oldState = JSON.parse(oldDataString);
                if (!oldState || typeof oldState !== 'object' || Array.isArray(oldState) || !Array.isArray(oldState.habits)) {
                    throw new Error('Legacy habit data has an invalid top-level structure.');
                }

                // 아주 오래된 데이터 형식(V1)인지 확인
                const isVeryOld = !oldState.version;
                const legacyKeyToRemove = legacyKey || (isVeryOld ? 'habitTrackerData' : 'habitTrackerDataV2');
                let migrationCandidate;

                if (isVeryOld) {
                    migrationCandidate = {
                        ...this.state,
                        habits: oldState.habits.map((habit, index) => ({
                            id: habit.id || Date.now() + index,
                            name: habit.name || 'Untitled',
                            type: 'check',
                            goal: 1,
                            frequency: { type: 'daily', days: [0, 1, 2, 3, 4, 5, 6] },
                            isArchived: false,
                            order: index,
                            createdAt: habit.id || Date.now() + index,
                            logs: Object.entries(habit.logs || {}).reduce((acc, [date, value]) => {
                                const wasCompleted = (habit.type === 'count' && habit.goal) ? (value >= habit.goal) : (value > 0);
                                acc[date] = { value: wasCompleted ? 1 : 0 };
                                return acc;
                            }, {}),
                        })),
                        settings: { ...this.state.settings, theme: oldState.settings?.theme || 'light' }
                    };
                } else {
                    // V2 데이터 마이그레이션 (기존 로직 유지)
                    migrationCandidate = {
                        ...this.state,
                        habits: oldState.habits,
                        achievements: oldState.achievements || {},
                        visitedViews: oldState.visitedViews || {},
                        filters: oldState.filters || { search: '', showArchived: false, sortBy: 'order' },
                        settings: { ...this.state.settings, theme: oldState.settings?.theme || 'light' }
                    };
                }

                // [CRITICAL BUG FIX] 레거시 구조가 손상된 경우 빈 정제본을 새 통합 키에 저장한 뒤
                // 유일한 구버전 원본까지 삭제하면 복구할 수 없는 데이터 유실이 발생합니다.
                // 후보 상태를 메모리 밖에서 검증하고, 모든 레코드가 구조 검사를 통과한 경우에만
                // 현재 상태 교체·신규 키 저장·레거시 키 삭제를 순서대로 수행합니다.
                let hasStructuralCorruption = false;
                const sanitizedCandidate = this.sanitizeLoadedState(migrationCandidate, {
                    onStructuralCorruption: () => { hasStructuralCorruption = true; }
                });
                if (hasStructuralCorruption) {
                    throw new Error('Legacy habit data contains malformed habit, frequency, or log records.');
                }

                this.state = { ...this.state, ...sanitizedCandidate, chartInstances: {} };
                if (this.saveData()) { // 새 키로 저장이 끝난 뒤에만 기존 키 제거
                    this._hasPersistedIntegratedData = true;
                    try {
                        // 두 레거시 키가 동시에 남아 있어도 향후 초기화 후 다시
                        // 오래된 데이터를 부활시키지 않도록, 검증된 신규 저장 후 모두 정리합니다.
                        localStorage.removeItem('habitTrackerDataV2');
                        localStorage.removeItem('habitTrackerData');
                    } catch (removeError) {
                        console.warn(`Failed to remove legacy habit tracker data after successful migration (${legacyKeyToRemove}).`, removeError);
                    }
                    this.showToast("데이터 구조가 최신 버전으로 업데이트되었습니다!", 'info');
                } else {
                    this.state = previousState;
                    this._hadDataLoadError = true;
                    this.showToast("데이터 구조 업데이트 중 저장에 실패했습니다. 기존 데이터를 유지했습니다.", 'error');
                }
            } catch (e) {
                // 마이그레이션이 실패한 세션에서 기본 샘플이나 후속 UI 저장이 신규 통합 키를
                // 만들어 레거시 원본을 가리는 일을 막습니다. 사용자가 명시적으로 초기화하기
                // 전까지 기존 키를 유일한 복구 원본으로 보존합니다.
                this.state = previousState;
                this._hadDataLoadError = true;
                console.error("Failed to migrate old data:", e);
                this.showToast("구버전 습관 데이터 구조를 확인할 수 없어 원본을 보존했습니다. 정상 백업을 복원하거나 명시적으로 초기화해주세요.", 'error');
            }
        },
        
        applySettings() {
            // [수정] body의 클래스를 직접 조작하는 대신 data-theme 속성을 사용
            if (this.state.settings.theme === 'dark') {
                document.body.classList.add('dark-mode');
            } else {
                document.body.classList.remove('dark-mode');
            }
            // 차트 색상 업데이트
            this.destroyCharts();
            this.render();
        },
        
        toggleTheme() {
            // 이 함수는 이제 postMessage를 통해서만 호출되므로 내부 로직은 불필요
        },

        // ----- RENDERING -----
        render() {
            this.updateActiveViewButton();
            this.renderFilters();
            
            this.destroyCharts();

            const viewRenderers = {
                calendar: this.renderCalendar,
                today: this.renderToday,
                stats: this.renderStats,
                timeline: this.renderTimeline,
                review: this.renderReview,
                archive: this.renderArchive,
            };
            
            const renderFunction = viewRenderers[this.state.currentView];
            if (renderFunction) {
                renderFunction.call(this);
            }
        },
        
        updateActiveViewButton() {
            this.elements.viewButtons.forEach(btn => {
                btn.classList.toggle('active', btn.id === `view-${this.state.currentView}`);
            });
        },

        renderFilters() {
            const showSort = ['today', 'stats'].includes(this.state.currentView);
            const sortOptions = `
                <label for="sort-by">정렬:</label>
                <select id="sort-by">
                    <option value="order" ${this.state.filters.sortBy === 'order' ? 'selected' : ''}>기본</option>
                    <option value="name_asc" ${this.state.filters.sortBy === 'name_asc' ? 'selected' : ''}>이름 (오름차순)</option>
                    <option value="name_desc" ${this.state.filters.sortBy === 'name_desc' ? 'selected' : ''}>이름 (내림차순)</option>
                    <option value="created_at" ${this.state.filters.sortBy === 'created_at' ? 'selected' : ''}>최신순</option>
                    <option value="streak" ${this.state.filters.sortBy === 'streak' ? 'selected' : ''}>현재 연속일순</option>
                    <option value="completion_rate" ${this.state.filters.sortBy === 'completion_rate' ? 'selected' : ''}>달성률순</option>
                </select>
            `;

            const html = `
                <div class="filters">
                    <input type="search" id="search-filter" placeholder="습관 검색 후 Enter..." value="${this.escapeHTML(this.state.filters.search)}">
                    <label>
                        <input type="checkbox" id="archived-filter" ${this.state.filters.showArchived ? 'checked' : ''}>
                        보관된 습관 보기
                    </label>
                    ${showSort ? sortOptions : ''}
                </div>`;

            this.elements.appFiltersContainer.innerHTML = (this.state.currentView !== 'archive' && this.state.currentView !== 'review') ? html : '';
            
            if (this.state.currentView !== 'archive' && this.state.currentView !== 'review') {
                const searchInput = document.getElementById('search-filter');
                searchInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        const search = String(e.target.value ?? '').slice(0, 120);
                        if (this.updateFilterPreference('search', search)) this.render();
                    }
                });
                searchInput.addEventListener('blur', (e) => {
                    const search = String(e.target.value ?? '').slice(0, 120);
                    if (this.updateFilterPreference('search', search)) this.render();
                });
                document.getElementById('archived-filter').addEventListener('change', (e) => {
                    if (this.updateFilterPreference('showArchived', Boolean(e.target.checked))) this.render();
                });
                if(showSort) {
                    document.getElementById('sort-by').addEventListener('change', (e) => {
                        if (this.updateFilterPreference('sortBy', e.target.value)) this.render();
                    });
                }
            }
        },
        
        getFilteredHabits() {
            const { sortBy, showArchived, search } = this.state.filters;
            const searchLower = search.toLowerCase();

            let filteredHabits = this.state.habits
                .filter(h => h.isArchived === showArchived)
                .filter(h => h.name.toLowerCase().includes(searchLower));

            if (['streak', 'completion_rate'].includes(sortBy)) {
                filteredHabits = filteredHabits.map(h => ({
                    ...h,
                    stats: this.calculateHabitStats(h)
                }));
            }

            return filteredHabits.sort((a, b) => {
                switch (sortBy) {
                    case 'name_asc': return a.name.localeCompare(b.name);
                    case 'name_desc': return b.name.localeCompare(a.name);
                    case 'created_at': return (b.createdAt || b.id) - (a.createdAt || a.id);
                    case 'streak': return (b.stats?.currentStreak || 0) - (a.stats?.currentStreak || 0);
                    case 'completion_rate': return (b.stats?.completionRate || 0) - (a.stats?.completionRate || 0);
                    case 'order':
                    default:
                        return (a.order || 0) - (b.order || 0);
                }
            });
        },
        
        renderEmptyState(view) {
            let message = {};
            const hasSearchTerm = this.state.filters.search.trim() !== '';

            if (this.state.habits.length === 0) {
                message = { title: "첫 습관을 만들어볼까요? 🌱", body: "'새 습관 추가' 버튼을 눌러 추적하고 싶은 첫 습관을 만들어보세요!", showAddButton: true };
            } else if (hasSearchTerm && this.getFilteredHabits().length === 0) {
                message = { title: "검색 결과 없음 🧐", body: `"${this.escapeHTML(this.state.filters.search)}"에 대한 검색 결과가 없습니다.`, showAddButton: false };
            } else if (view === 'today' || view === 'calendar') {
                 message = { title: "표시할 습관이 없어요 🤷", body: "이 날짜에는 예정된 습관이 없거나 필터와 일치하는 습관이 없습니다.", showAddButton: false };
            } else {
                message = { title: "표시할 습관이 없어요 🤷", body: "필터 설정을 확인하거나 새로운 습관을 추가해보세요.", showAddButton: false };
            }

            this.elements.appContent.innerHTML = `
                <div class="empty-state">
                    <h3>${message.title}</h3>
                    <p>${message.body}</p>
                    ${message.showAddButton ? '<button id="empty-add-habit-btn">💪 첫 습관 추가하기</button>' : ''}
                </div>
            `;
            if (message.showAddButton) {
                document.getElementById('empty-add-habit-btn').addEventListener('click', () => this.openHabitModal());
            }
        },

        // ----- VIEWS -----
        renderCalendar() {
            const date = this.state.currentDate;
            const year = date.getFullYear();
            const month = date.getMonth();
            const monthName = new Date(year, month).toLocaleString('ko-KR', { month: 'long' });

            const firstDayOfMonth = new Date(year, month, 1);
            const lastDayOfMonth = new Date(year, month + 1, 0);
            
            const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

            let html = `
                <div class="calendar-header">
                    <div class="calendar-nav">
                       <button id="prev-month">ᐊ</button>
                       <button id="calendar-go-to-today" class="secondary">오늘</button>
                       <button id="next-month">ᐅ</button>
                    </div>
                    <div class="calendar-title-wrapper">
                        <h2 id="calendar-title">${year}년 ${monthName}</h2>
                        <button id="calendar-date-picker-trigger-btn" class="secondary" title="날짜 선택" style="width: 40px; height: 40px; padding: 0; border-radius: 50%; font-size: 1.2em;">📅</button>
                    </div>
                </div>
                <div class="calendar-grid">
                    ${dayNames.map(day => `<div class="calendar-day-name">${day}</div>`).join('')}
            `;

            let startDayOffset = firstDayOfMonth.getDay();
            for (let i = 0; i < startDayOffset; i++) { html += `<div class="calendar-day other-month"></div>`; }
            
            for (let i = 1; i <= lastDayOfMonth.getDate(); i++) {
                const loopDate = new Date(year, month, i);
                const dateStr = this.getDateString(loopDate);
                const isToday = this.getDateString(new Date()) === dateStr;
                const habitsForDay = this.getFilteredHabits().filter(habit => this.isHabitCountableOnDate(habit, loopDate));
                
                const dayOfWeek = loopDate.getDay();
                let dayClass = '';
                if (dayOfWeek === 0) dayClass = 'sunday';
                else if (dayOfWeek === 6) dayClass = 'saturday';

                html += `
                    <div class="calendar-day ${isToday ? 'today' : ''}">
                        <div class="day-number ${dayClass}">${i}</div> 
                        <div class="calendar-habit-list">
                            ${habitsForDay.map(habit => this.getHabitHTMLForCalendar(habit, dateStr)).join('')}
                        </div>
                    </div>`;
            }
            html += `</div>`;
            this.elements.appContent.innerHTML = html;
        },
        
        renderToday() {
            const selectedDate = this.state.currentDate;
            const selectedDateStr = this.getDateString(selectedDate);
            
            const today = new Date();
            today.setHours(0,0,0,0);
            const todayStr = this.getDateString(today);
            
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = this.getDateString(yesterday);
            
            let title = selectedDate.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
            if (selectedDateStr === todayStr) title = '오늘';
            if (selectedDateStr === yesterdayStr) title = '어제';

            let headerHtml = `
                <div class="view-header" style="position: relative;">
                    <div class="today-nav">
                        <button id="prev-day">ᐊ</button>
                        <button id="go-to-today-btn" class="secondary">오늘</button>
                        <button id="next-day">ᐅ</button>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); margin: 0; cursor: pointer;">
                        <h2 id="today-view-date-title" style="margin: 0;">${title}</h2>
                        <button id="date-picker-trigger-btn" class="secondary" title="날짜 선택" style="width: 40px; height: 40px; padding: 0; border-radius: 50%; font-size: 1.2em;">📅</button>
                    </div>
                </div>`;

            let contentHtml = '';
            if (this.state.habits.length === 0) {
                contentHtml = `
                    <div class="empty-state">
                        <h3>첫 습관을 만들어볼까요? 🌱</h3>
                        <p>'새 습관 추가' 버튼을 눌러 추적하고 싶은 첫 습관을 만들어보세요!</p>
                        <button id="empty-add-habit-btn">💪 첫 습관 추가하기</button>
                    </div>
                `;
                this.elements.appContent.innerHTML = contentHtml; // 헤더 없이 전체를 덮어씀
                document.getElementById('empty-add-habit-btn').addEventListener('click', () => this.openHabitModal());
                return;
            }

            const habitsForDay = this.getFilteredHabits().filter(h => this.isHabitCountableOnDate(h, selectedDate));

            // --- MODIFICATION: Add summary text ---
            const totalHabits = habitsForDay.length;
            const completedHabits = habitsForDay.filter(h => this.isHabitCompletedOn(h, selectedDateStr)).length;
            let summaryHtml = '';
            if (totalHabits > 0) {
                summaryHtml = `
                    <div style="text-align: center; margin-bottom: 20px; color: var(--text-secondary-color);">
                        <p style="font-size: 1.2em; font-weight: 500;">
                            오늘의 목표: ${completedHabits} / ${totalHabits} 완료!
                        </p>
                    </div>
                `;
            }
            
            if (habitsForDay.length === 0) {
                contentHtml = `
                    <div class="empty-state" style="padding-top: 20px;">
                        <h3>표시할 습관이 없어요 🤷</h3>
                        <p>이 날짜에는 예정된 습관이 없거나 필터와 일치하는 습관이 없습니다.</p>
                    </div>
                `;
            } else {
                contentHtml = `<div id="habit-list-container">${habitsForDay.map(habit => this.getHabitHTMLForList(habit, selectedDateStr)).join('')}</div>`;
            }
            
            this.elements.appContent.innerHTML = headerHtml + summaryHtml + contentHtml;
        },
        
        renderStats() {
            const habits = this.state.habits.filter(h => !h.isArchived);
            if (habits.length === 0) {
                 this.renderEmptyState('stats');
                return;
            }
            let html = this.getReportHTML();
            html += this.getStatsDashboardHTML(habits);
            html += '<div class="stats-grid">';
            html += this.getFilteredHabits()
                .map(habit => this.getHabitStatCard(habit)).join('');
            html += '</div>';
            this.elements.appContent.innerHTML = html;
            this.renderStatsCharts(this.getFilteredHabits());
        },
        
        renderTimeline() {
            const habits = this.getFilteredHabits();
            if (this.state.habits.length === 0) {
                this.renderEmptyState('timeline');
                return;
            }

            let allLogs = [];
            habits.forEach(habit => {
                Object.keys(habit.logs).forEach(dateStr => {
                    const logData = habit.logs[dateStr];
                    const logDate = this.parseDateString(dateStr);
                    if (logData
                        && logData.value > 0
                        && this.getDateString(logDate) === dateStr
                        && this.isHabitCountableOnDate(habit, logDate)) {
                        allLogs.push({ date: logDate, habit, ...logData, isCompleted: this.isHabitCompletedOn(habit, dateStr) });
                    }
                });
            });
            
            if (allLogs.length === 0) {
                this.renderEmptyState('timeline');
                return;
            }
            allLogs.sort((a, b) => b.date - a.date);
            let html = '<div class="timeline-container">';
            html += allLogs.map((log, index) => this.getTimelineItem(log, index)).join('');
            html += '</div>';
            this.elements.appContent.innerHTML = html;
        },

        renderReview() {
            const getBtnClass = (p) => this.state.reviewPeriod === p ? 'active' : '';
            
            let headerHtml = `
                <div class="view-header">
                    <h2>🧐 주간/월간 리뷰</h2>
                    <div class="view-switcher" style="padding: 2px; border-radius: 8px;">
                        <button class="review-period-btn ${getBtnClass('weekly')}" data-period="weekly" style="padding: 4px 10px; font-size: 0.8em; border-radius: 6px;">지난 주</button>
                        <button class="review-period-btn ${getBtnClass('monthly')}" data-period="monthly" style="padding: 4px 10px; font-size: 0.8em; border-radius: 6px;">지난 달</button>
                    </div>
                </div>
            `;
            
            const contentHtml = this.getReviewHTML(this.state.reviewPeriod);
            this.elements.appContent.innerHTML = headerHtml + contentHtml;
        },

        renderArchive() {
            const archivedHabits = this.state.habits.filter(h => h.isArchived);
            if (archivedHabits.length === 0) {
                this.elements.appContent.innerHTML = `
                    <div class="empty-state">
                        <h3>📦 보관함이 비었어요</h3>
                        <p>습관 편집 메뉴에서 '보관' 버튼을 누르면 여기에 표시됩니다.</p>
                    </div>
                `;
                return;
            }
            
            const listHtml = archivedHabits.map(habit => `
                <div class="archive-item" data-habit-id="${habit.id}">
                    <div class="archive-item-header">
                        <span class="archive-item-title">${this.escapeHTML(habit.name)}</span>
                        <div class="archive-item-actions">
                            <button class="unarchive-btn" title="보관 취소">↩️</button>
                            <button class="delete-permanently-btn" title="영구 삭제">🗑️</button>
                        </div>
                    </div>
                </div>
            `).join('');

            this.elements.appContent.innerHTML = `<div id="archive-list-container">${listHtml}</div>`;
        },

        // ----- MODAL HANDLERS -----
        openModal(modalElement) {
            document.body.style.overflow = 'hidden';
            modalElement.classList.add('visible');
            this.trapFocus(modalElement);
        },

        closeModal(modalElement) {
            if (modalElement === this.elements.confirmModal) {
                this.clearPendingConfirmDialog();
            }
            document.body.style.overflow = '';
            modalElement.classList.remove('visible');
            if (modalElement._focusTrapHandler) {
                modalElement.removeEventListener('keydown', modalElement._focusTrapHandler);
                delete modalElement._focusTrapHandler;
            }
        },

        openHabitModal(habitId = null) {
            this.elements.habitForm.reset();
            this.elements.habitIdInput.value = '';
            this.elements.deleteHabitBtn.style.display = 'none';
            this.elements.archiveHabitBtn.style.display = 'none';
            this.elements.specificDaysGroup.style.display = 'none';

            if (habitId) {
                const habit = this.state.habits.find(h => h.id == habitId);
                if (habit) {
                    this.elements.modalTitle.textContent = '습관 편집 ✍️';
                    this.elements.habitIdInput.value = habit.id;
                    this.elements.habitNameInput.value = habit.name;
                    
                    const freq = habit.frequency || { type: 'daily', days: [0,1,2,3,4,5,6] };
                    this.elements.habitFrequencySelect.value = freq.type;
                    if(freq.type === 'specific_days') {
                        this.elements.specificDaysGroup.style.display = 'block';
                        document.querySelectorAll('input[name="specific-day"]').forEach(checkbox => {
                            checkbox.checked = freq.days.includes(parseInt(checkbox.value));
                        });
                    }

                    this.elements.deleteHabitBtn.style.display = 'inline-block';
                    this.elements.archiveHabitBtn.style.display = 'inline-block';
                    this.elements.archiveHabitBtn.textContent = habit.isArchived ? '📦 보관 취소' : '📦 보관';
                    this.elements.archiveHabitBtn.classList.toggle('warning', !habit.isArchived);
                    this.elements.archiveHabitBtn.classList.toggle('secondary', habit.isArchived);
                }
            } else {
                this.elements.modalTitle.textContent = '새 습관 만들기 💪';
            }
            this.openModal(this.elements.habitModal);
            setTimeout(() => this.elements.habitNameInput.focus(), 100);
        },
        
        openAchievementsModal() { 
            this.renderAchievements(); 
            this.openModal(this.elements.achievementsModal); 
        },

        // ----- HTML CHUNKS -----
        getHabitHTMLForCalendar(habit, dateStr) {
            const isCompleted = this.isHabitCompletedOn(habit, dateStr);
            const safeName = this.escapeHTML(habit.name);
            return `<div class="habit-on-calendar ${isCompleted ? 'completed' : ''}" data-habit-id="${habit.id}" data-date="${dateStr}">${safeName}</div>`;
        },
        
        getHabitHTMLForList(habit, dateStr) {
            const log = habit.logs[dateStr] || { value: 0 };
            const progress = log.value * 100;
            const safeName = this.escapeHTML(habit.name);
            const isDraggable = this.state.filters.sortBy === 'order';

            return `
                <div class="habit-list-item" ${isDraggable ? 'draggable="true"' : ''} data-habit-id="${habit.id}">
                    <div class="habit-header">
                        <span class="habit-title">${safeName}</span>
                        <div class="habit-actions">
                            <button class="edit-habit-btn" data-habit-id="${habit.id}" aria-label="습관 수정">✏️</button>
                        </div>
                    </div>
                    <div class="habit-progress" data-habit-id="${habit.id}" data-date="${dateStr}">
                        <input type="checkbox" class="habit-check" ${log.value === 1 ? 'checked' : ''}>
                    </div>
                    <div class="progress-bar-container"><div class="progress-bar" style="width: ${Math.min(100, progress)}%;"></div></div>
                </div>`;
        },
        
        getHabitStatCard(habit) {
            const stats = habit.stats && habit.stats.totalCompletions !== undefined ? habit.stats : this.calculateHabitStats(habit);
            const safeName = this.escapeHTML(habit.name);
            return `
                <div class="stat-card">
                    <h3 class="stat-card-title">${safeName}</h3>
                    <div class="stat-item"><span>🔥 현재 연속 달성</span><span>${stats.currentStreak}일</span></div>
                    <div class="stat-item"><span>🏆 최고 연속 달성</span><span>${stats.longestStreak}일</span></div>
                    <div class="stat-item"><span>🎯 총 달성일</span><span>${stats.totalCompletions}일</span></div>
                    <div class="stat-item"><span>✅ 전체 달성률</span><span>${stats.completionRate}%</span></div>
                    <div class="heatmap-container-wrapper"><h4>지난 1년 활동 기록</h4><br>${this.generateHeatmap(habit)}</div>
                </div>`;
        },
        
        getReportDateRange(period) {
            const today = new Date();
            today.setHours(0,0,0,0);
            let startDate = new Date(today);

            switch(period) {
                case 'this_week':
                    const dayOfWeek = today.getDay();
                    startDate.setDate(today.getDate() - dayOfWeek);
                    break;
                case 'this_month':
                    startDate.setDate(1);
                    break;
                case 'monthly':
                    startDate.setDate(today.getDate() - 29);
                    break;
                case 'yearly':
                    startDate = getPreviousCalendarYearRangeStart(today);
                    break;
                case 'weekly':
                default:
                    startDate.setDate(today.getDate() - 6);
                    break;
            }
            return { startDate, endDate: today };
        },

        calculateReportStats(startDate, endDate) {
            let totalPossible = 0;
            let totalCompleted = 0;
            const habits = this.state.habits.filter(h => !h.isArchived);

            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                const dateStr = this.getDateString(d);
                habits.forEach(habit => {
                    if (this.isHabitCountableOnDate(habit, d)) {
                        totalPossible++;
                        if (this.isHabitCompletedOn(habit, dateStr)) {
                            totalCompleted++;
                        }
                    }
                });
            }
            const rate = totalPossible > 0 ? Math.round((totalCompleted / totalPossible) * 100) : 0;
            return { totalPossible, totalCompleted, rate };
        },
        
        calculateHabitPerformance(habit, startDate, endDate) {
            let possible = 0;
            let completed = 0;
            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                if (this.isHabitCountableOnDate(habit, d)) {
                    possible++;
                    if (this.isHabitCompletedOn(habit, this.getDateString(d))) {
                        completed++;
                    }
                }
            }
            const rate = possible > 0 ? Math.round((completed / possible) * 100) : 0;
            return { possible, completed, rate };
        },

        getReportHTML() {
            const period = this.state.reportPeriod;
            const periodText = { 
                this_week: '이번 주',
                this_month: '이번 달',
                weekly: '지난 7일', 
                monthly: '지난 30일', 
                yearly: '지난 1년'
            }[period];

            const { startDate, endDate } = this.getReportDateRange(period);
            const currentStats = this.calculateReportStats(startDate, endDate);
            
            const activeHabits = this.state.habits.filter(h => !h.isArchived);

            const habitPerformances = activeHabits
                .map(habit => ({
                    habit,
                    performance: this.calculateHabitPerformance(habit, startDate, endDate)
                }))
                .filter(item => item.performance.possible > 0)
                .sort((a, b) => b.performance.rate - a.performance.rate || b.performance.completed - a.performance.completed);
            
            let mostMissedHabit = null;
            if (activeHabits.length > 0) {
                const missedCounts = activeHabits.map(habit => ({
                    habit,
                    missed: this.getMissedCount(habit, startDate, endDate)
                })).sort((a, b) => b.missed - a.missed);
                if (missedCounts[0].missed > 0) {
                    mostMissedHabit = missedCounts[0];
                }
            }
            
            let bestPerfHTML = `<div class="stat-item"><span>🥇 최고 성과 습관</span><span>-</span></div>`;
            let worstPerfHTML = `<div class="stat-item"><span>🧗‍♀️ 개선 필요 습관</span><span>-</span></div>`;
            let mostMissedHTML = mostMissedHabit ? `<div class="stat-item"><span>😥 가장 많이 놓친 습관</span><span>${this.escapeHTML(mostMissedHabit.habit.name)} (${mostMissedHabit.missed}회)</span></div>` : '';
            let individualPerfHTML = '';

            if (habitPerformances.length > 0) {
                const best = habitPerformances[0];
                bestPerfHTML = `<div class="stat-item"><span>🥇 최고 성과 습관</span><span>${this.escapeHTML(best.habit.name)} (${best.performance.rate}%)</span></div>`;

                if (habitPerformances.length > 1) {
                    const worst = habitPerformances[habitPerformances.length - 1];
                    worstPerfHTML = `<div class="stat-item"><span>🧗‍♀️ 개선 필요 습관</span><span>${this.escapeHTML(worst.habit.name)} (${worst.performance.rate}%)</span></div>`;
                }
                // --- MODIFIED: details/summary 태그 제거하고 항상 보이도록 변경 ---
                individualPerfHTML = `
                    <div style="margin-top: 24px;">
                        <h4 style="font-weight: 600; margin-bottom: 10px;">개별 습관 달성률</h4>
                        <div style="padding-left: 10px; border-left: 2px solid var(--border-color);">
                            ${habitPerformances.map(item => `
                                <div class="stat-item" style="padding: 6px 0;">
                                    <span>${this.escapeHTML(item.habit.name)}</span>
                                    <span style="color: ${item.performance.rate >= 80 ? 'var(--success-color)' : item.performance.rate < 50 ? 'var(--missed-color)' : 'inherit'};">
                                        ${item.performance.rate}% (${item.performance.completed}/${item.performance.possible})
                                    </span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }

            let prevStartDate, prevEndDate;
            const currentRangeDayOffset = this.getCalendarDayOffset(startDate, endDate);

            prevEndDate = new Date(startDate);
            prevEndDate.setDate(prevEndDate.getDate() - 1);
            prevStartDate = new Date(prevEndDate);
            prevStartDate.setDate(prevStartDate.getDate() - currentRangeDayOffset);
            
            if (period === 'this_month') {
                prevStartDate = new Date(startDate.getFullYear(), startDate.getMonth() - 1, 1);
                prevEndDate = new Date(startDate.getFullYear(), startDate.getMonth(), 0);
            } else if (period === 'this_week') {
                 prevStartDate = new Date(startDate);
                 prevStartDate.setDate(prevStartDate.getDate() - 7);
                 prevEndDate = new Date(startDate);
                 prevEndDate.setDate(prevEndDate.getDate() - 1);
            }
            
            const prevStats = this.calculateReportStats(prevStartDate, prevEndDate);
            
            const difference = currentStats.rate - prevStats.rate;
            let comparisonHTML = '';
            if (prevStats.totalPossible > 0) {
                let icon = '➖';
                let color = 'var(--text-secondary-color)';
                if (difference > 0) {
                    icon = `🔼`;
                    color = 'var(--success-color)';
                } else if (difference < 0) {
                    icon = `🔽`;
                    color = 'var(--missed-color)';
                }
                comparisonHTML = `<span style="font-size: 0.9em; color: ${color}; margin-left: 10px;">${icon} ${Math.abs(difference)}%</span>`;
            }

            const getBtnClass = (p) => this.state.reportPeriod === p ? 'active' : '';

            return `
                <div class="stat-card" style="margin-bottom: 30px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                        <h3 class="stat-card-title" style="margin-bottom:0; border:0; padding:0;">${periodText} 리포트 📈</h3>
                        <div class="view-switcher" style="padding: 2px; border-radius: 8px;">
                            <button class="report-period-btn ${getBtnClass('this_week')}" data-period="this_week" style="padding: 4px 10px; font-size: 0.8em; border-radius: 6px;">이번 주</button>
                            <button class="report-period-btn ${getBtnClass('this_month')}" data-period="this_month" style="padding: 4px 10px; font-size: 0.8em; border-radius: 6px;">이번 달</button>
                            <button class="report-period-btn ${getBtnClass('weekly')}" data-period="weekly" style="padding: 4px 10px; font-size: 0.8em; border-radius: 6px;">7일</button>
                            <button class="report-period-btn ${getBtnClass('monthly')}" data-period="monthly" style="padding: 4px 10px; font-size: 0.8em; border-radius: 6px;">30일</button>
                            <button class="report-period-btn ${getBtnClass('yearly')}" data-period="yearly" style="padding: 4px 10px; font-size: 0.8em; border-radius: 6px;">1년</button>
                        </div>
                    </div>
                    <div class="stat-item"><span>총 실천 가능 횟수</span><span>${currentStats.totalPossible}회</span></div>
                    <div class="stat-item"><span>총 완료 횟수</span><span>${currentStats.totalCompleted}회</span></div>
                    <div class="stat-item">
                       <span>평균 달성률</span>
                       <div style="display: flex; align-items: center;">
                         <span style="font-size: 1.5em; color: var(--primary-color);">${currentStats.rate}%</span>
                         ${comparisonHTML}
                       </div>
                    </div>
                    ${bestPerfHTML}
                    ${worstPerfHTML}
                    ${mostMissedHTML}
                    ${individualPerfHTML}
                </div>
            `;
        },

        getReviewHTML(period) {
            const today = new Date();
            today.setHours(0,0,0,0);
            let startDate, endDate;
            let periodTitle = '';

            if (period === 'weekly') {
                periodTitle = '지난 주';
                const dateForCalc = new Date(today);
                dateForCalc.setDate(dateForCalc.getDate() - dateForCalc.getDay() - 7);
                startDate = new Date(dateForCalc);
                endDate = new Date(startDate);
                endDate.setDate(startDate.getDate() + 6);
            } else { // monthly
                periodTitle = '지난 달';
                startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                endDate = new Date(today.getFullYear(), today.getMonth(), 0);
            }

            const stats = this.calculateReviewStats(startDate, endDate);
            const localeOpts = { year: 'numeric', month: 'short', day: 'numeric' };

            if (stats.totalPossible === 0) {
                return `
                    <div class="empty-state">
                        <h3>데이터가 부족해요 📊</h3>
                        <p>${periodTitle}(${startDate.toLocaleDateString('ko-KR', localeOpts)} ~ ${endDate.toLocaleDateString('ko-KR', localeOpts)})에 대한 기록이 없습니다. 습관을 꾸준히 기록해 주세요!</p>
                    </div>`;
            }

            let summaryMessage = `지난 주에는 평균 <span style="color:var(--primary-color); font-weight: bold;">${stats.completionRate}%</span>의 달성률을 보였어요. `;
            if (stats.completionRate >= 90) {
                summaryMessage += "정말 대단해요! 완벽에 가까운 한 주였습니다. ✨";
            } else if (stats.completionRate >= 70) {
                summaryMessage += "아주 잘하고 있어요! 꾸준함이 엿보이네요. 👍";
            } else if (stats.completionRate >= 50) {
                summaryMessage += "절반의 성공! 다음 주에는 조금 더 힘내봐요. 😊";
            } else {
                summaryMessage += "괜찮아요, 다시 시작하면 돼요! 이번 주 목표를 다시 세워볼까요? 💪";
            }

            return `
                <div class="stat-card">
                    <h3 class="stat-card-title">${periodTitle} 리뷰 (${startDate.toLocaleDateString('ko-KR', localeOpts)} ~ ${endDate.toLocaleDateString('ko-KR', localeOpts)})</h3>
                    <p style="font-size: 1.2em; text-align: center; margin: 20px 0;">${summaryMessage}</p>
                    <div class="stat-item">
                        <span>🏆 가장 잘 지킨 습관</span>
                        <span>${stats.bestHabit ? `${this.escapeHTML(stats.bestHabit.name)} (${stats.bestHabit.rate}%)` : '-'}</span>
                    </div>
                     <div class="stat-item">
                        <span>🧗‍♀️ 가장 아쉬웠던 습관</span>
                        <span>${stats.worstHabit ? `${this.escapeHTML(stats.worstHabit.name)} (${stats.worstHabit.rate}%)` : '-'}</span>
                    </div>
                    <div class="stat-item">
                        <span>✅ 총 달성률</span>
                        <span style="font-size: 1.5em; color: var(--primary-color);">${stats.completionRate}%</span>
                    </div>
                    <div class="stat-item">
                        <span>총 완료 / 가능 횟수</span>
                        <span>${stats.totalCompleted} / ${stats.totalPossible} 회</span>
                    </div>
                    <div style="margin-top: 16px;">
                        <h4 style="margin-bottom: 8px;">습관별 성과</h4>
                        ${stats.habitPerformances.map(item => `
                            <div class="stat-item" style="padding: 6px 0;">
                                <span>${this.escapeHTML(item.habit.name)}</span>
                                <span style="color: ${item.rate >= 80 ? 'var(--success-color)' : item.rate < 50 ? 'var(--missed-color)' : 'inherit'};">
                                    ${item.rate}% (${item.completed}/${item.possible})
                                </span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        },
        
        getStatsDashboardHTML(habits) {
            let totalHabitsForToday = 0, completedHabitsForToday = 0;
            const today = new Date();
            today.setHours(0,0,0,0);
            const todayStr = this.getDateString(today);

            habits.forEach(h => {
                if (this.isHabitCountableOnDate(h, today)) {
                    totalHabitsForToday++;
                    if (this.isHabitCompletedOn(h, todayStr)) completedHabitsForToday++;
                }
            });
            const todayCompletionRate = totalHabitsForToday > 0 ? Math.round((completedHabitsForToday / totalHabitsForToday) * 100) : 0;
            const totalActiveHabits = this.state.habits.filter(h => !h.isArchived).length;
            return `
                <div class="stats-dashboard">
                    <div class="dashboard-card"><div class="dashboard-card-title">오늘 달성률</div><div class="dashboard-card-value">${todayCompletionRate}%</div></div>
                    <div class="dashboard-card"><div class="dashboard-card-title">총 활성 습관</div><div class="dashboard-card-value">${totalActiveHabits}</div></div>
                    <div class="dashboard-card"><div class="dashboard-card-title">최고 연속 기록</div><div class="dashboard-card-value">${Math.max(0, ...habits.map(h => this.calculateHabitStats(h).longestStreak))}일</div></div>
                    <div class="dashboard-card" style="grid-column: 1 / -1;"><div class="dashboard-card-title">월별 전체 달성률</div><div class="chart-container" style="height: 250px;"><canvas id="main-stats-chart"></canvas></div></div>
                    <div class="dashboard-card" style="grid-column: 1 / -1;"><div class="dashboard-card-title">요일별 성공/실패 분석</div><div class="chart-container" style="height: 250px;"><canvas id="day-of-week-chart"></canvas></div></div>
                    <div class="dashboard-card" style="grid-column: 1 / -1;">
                        <div class="dashboard-card-title">전체 활동 히트맵 (지난 1년)</div>
                        <div class="heatmap-container-wrapper" style="margin-top: 0;">${this.generateOverallHeatmap()}</div>
                    </div>
                </div>`;
        },

        getTimelineItem(log, index) {
            const dateStr = log.date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
            const status = log.isCompleted ? '완료! 🎉' : '진행중...';
            const safeName = this.escapeHTML(log.habit.name);
            return `
                <div class="timeline-item">
                    <div class="timeline-date">${dateStr}</div>
                    <h4>${safeName} - <span style="font-weight: 400">${status}</span></h4>
                </div>`;
        },

        // ----- DYNAMIC EVENT LISTENERS (EVENT DELEGATION) -----
        addDelegatedEventListeners() {
            this.elements.appContent.addEventListener('click', (e) => {
                const habitCalendarItem = getClosestElement(e.target, '.habit-on-calendar');
                if (habitCalendarItem) {
                    const { habitId, date } = habitCalendarItem.dataset;
                    this.handleHabitClick(habitId, date, habitCalendarItem);
                    return;
                }

                const editBtn = getClosestElement(e.target, '.edit-habit-btn');
                if (editBtn) {
                    this.openHabitModal(editBtn.dataset.habitId);
                    return;
                }
                
                const datePickerTrigger = getClosestElement(e.target, '#date-picker-trigger-btn, #calendar-date-picker-trigger-btn, #today-view-date-title');
                if (datePickerTrigger) {
                    const picker = this.elements.datePickerInput;
                    const rect = datePickerTrigger.getBoundingClientRect();
                    
                    document.body.appendChild(picker);
                    picker.style.position = 'absolute';
                    picker.style.top = `${rect.bottom + window.scrollY + 5}px`;
                    picker.style.left = `${rect.left + window.scrollX + (rect.width / 2)}px`;
                    picker.style.transform = 'translateX(-50%)';
                    
                    if (getClosestElement(e.target, '#calendar-date-picker-trigger-btn')) {
                        picker.type = 'month';
                        picker.value = this.getDateString(this.state.currentDate).substring(0, 7);
                    } else {
                        picker.type = 'date';
                        picker.value = this.getDateString(this.state.currentDate);
                    }

                    try {
                        picker.showPicker();
                    } catch (err) {
                        console.warn("showPicker() is not supported by this browser.", err);
                    }
                    return;
                }

                if (e.target.id === 'prev-day') this.changeDay(-1);
                if (e.target.id === 'next-day') this.changeDay(1);
                if (e.target.id === 'go-to-today-btn' || e.target.id === 'calendar-go-to-today') { 
                    const today = new Date();
                    today.setHours(0,0,0,0);
                    this.state.currentDate = today;
                    this.render(); 
                }
                if (e.target.id === 'prev-month') this.changeMonth(-1);
                if (e.target.id === 'next-month') this.changeMonth(1);
                
                if (getClosestElement(e.target, '#calendar-title')) this.jumpToMonth();

                const unarchiveBtn = getClosestElement(e.target, '.unarchive-btn');
                if (unarchiveBtn) {
                    const habitId = unarchiveBtn.closest('.archive-item').dataset.habitId;
                    this.unarchiveHabit(habitId);
                    return;
                }
                const deletePermanentlyBtn = getClosestElement(e.target, '.delete-permanently-btn');
                if (deletePermanentlyBtn) {
                    const habitId = deletePermanentlyBtn.closest('.archive-item').dataset.habitId;
                    this.deleteHabitPermanently(habitId);
                    return;
                }
                const reportPeriodBtn = getClosestElement(e.target, '.report-period-btn');
                if (reportPeriodBtn) {
                    const reportPeriod = reportPeriodBtn.dataset.period;
                    if (this.state.reportPeriod !== reportPeriod) {
                        this.state.reportPeriod = reportPeriod;
                        this.saveData();
                        this.render();
                    }
                    return;
                }
                const reviewPeriodBtn = getClosestElement(e.target, '.review-period-btn');
                if (reviewPeriodBtn) {
                    const reviewPeriod = reviewPeriodBtn.dataset.period;
                    if (this.state.reviewPeriod !== reviewPeriod) {
                        this.state.reviewPeriod = reviewPeriod;
                        this.saveData();
                        this.render();
                    }
                    return;
                }
            });

            this.elements.appContent.addEventListener('change', (e) => {
                const habitCheck = getClosestElement(e.target, '.habit-check');
                if (habitCheck) {
                     const habitProgress = getClosestElement(e.target, '.habit-progress');
                    const { habitId, date } = habitProgress.dataset;
                    this.updateCheck(habitId, date, habitCheck.checked);
                    return;
                }
            });
            
            this.elements.appContent.addEventListener('dragstart', (e) => {
                if (e.target.classList.contains('habit-list-item') && e.target.draggable) {
                    draggedItem = e.target;
                    dropPlaceholder = document.createElement('div');
                    dropPlaceholder.className = 'drop-placeholder';
                    setTimeout(() => e.target.classList.add('dragging'), 0);
                }
            });

            // --- MODIFICATION START: Drag & Drop 버그 수정 ---
            this.elements.appContent.addEventListener('dragend', (e) => {
                // 드래그가 성공했든 취소됐든 항상 정리 작업을 수행합니다.
                if (draggedItem) {
                    draggedItem.classList.remove('dragging');
                }
                // 드롭이 취소된 경우 DOM에 남아있는 플레이스홀더를 제거합니다.
                if (dropPlaceholder && dropPlaceholder.parentNode) {
                    dropPlaceholder.parentNode.removeChild(dropPlaceholder);
                }
                // 상태 변수를 초기화합니다.
                draggedItem = null;
                dropPlaceholder = null;
            });

             this.elements.appContent.addEventListener('dragover', (e) => {
                e.preventDefault();
                const container = getClosestElement(e.target, '#habit-list-container');
                if(container && draggedItem) {
                    const afterElement = this.getDragAfterElement(container, e.clientY);
                    if (afterElement == null) {
                        container.appendChild(dropPlaceholder);
                    } else {
                        container.insertBefore(dropPlaceholder, afterElement);
                    }
                }
            });

            this.elements.appContent.addEventListener('drop', (e) => {
                e.preventDefault();
                const container = getClosestElement(e.target, '#habit-list-container');
                // 유효한 드롭 영역이고, 드래그 중인 아이템이 있을 때만 실행합니다.
                if (container && draggedItem && dropPlaceholder.parentNode) {
                    // 플레이스홀더를 실제 드래그한 아이템으로 교체하여 DOM 위치를 확정합니다.
                    dropPlaceholder.parentNode.replaceChild(draggedItem, dropPlaceholder);
                    // 성공적으로 드롭이 완료되었으므로, 변경된 순서를 저장합니다.
                    this.updateHabitOrder();
                }
            });
            // --- MODIFICATION END ---
        },
        
        // ----- FORM SUBMISSIONS & ACTIONS -----
        handleHabitFormSubmit(e) {
            e.preventDefault();
            
            const id = this.elements.habitIdInput.value;
            const frequencyType = this.elements.habitFrequencySelect.value;
            const selectedDays = Array.from(document.querySelectorAll('input[name="specific-day"]:checked')).map(cb => parseInt(cb.value));

            if (frequencyType === 'specific_days' && selectedDays.length === 0) {
                this.showToast('최소 하나 이상의 요일을 선택해야 합니다.', 'danger');
                return;
            }

            const frequencyMap = { 'daily': [0,1,2,3,4,5,6], 'weekdays': [1,2,3,4,5], 'weekends': [0,6] };
            
            const habitData = {
                name: this.elements.habitNameInput.value.trim(),
                type: 'check',
                goal: 1,
                frequency: { type: frequencyType, days: frequencyType === 'specific_days' ? selectedDays : frequencyMap[frequencyType] },
            };
            const previousState = this.createPersistableStateSnapshot();
            let shouldCheckHabitAchievements = false;

            if (id) {
                const index = this.state.habits.findIndex(h => h.id == id);
                if (index > -1) this.state.habits[index] = { ...this.state.habits[index], ...habitData };
            } else {
                const createdAt = Date.now();
                let habitId = createdAt;
                const usedHabitIds = new Set(this.state.habits.map(habit => String(habit.id)));
                while (usedHabitIds.has(String(habitId))) habitId += 1;
                const maxOrder = this.state.habits.reduce((max, h) => Math.max(max, h.order || 0), 0);
                this.state.habits.push({ ...habitData, id: habitId, logs: {}, isArchived: false, order: maxOrder + 1, createdAt });
                shouldCheckHabitAchievements = true;
            }

            if (!this.saveDataOrRollback(previousState)) return;
            if (shouldCheckHabitAchievements) {
                this.checkAchievement('first_habit');
                this.checkAchievement('5_habits');
                this.checkAchievement('10_habits');
            }
            this.render();
            this.closeModal(this.elements.habitModal);
        },
        
        handleDeleteHabit() {
            const id = this.elements.habitIdInput.value;
            if (!id) return;
            this.deleteHabitPermanently(id, () => {
                 this.closeModal(this.elements.habitModal);
            });
        },

        deleteHabitPermanently(habitId, callback) {
            this.showConfirmDialog('🗑️ 영구 삭제', '정말로 이 습관과 모든 기록을 영구적으로 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.', () => {
                const previousState = this.createPersistableStateSnapshot();
                this.state.habits = this.state.habits.filter(h => h.id != habitId);
                if (!this.saveDataOrRollback(previousState)) return;
                this.render();
                if (callback) callback();
            });
        },
        
        handleArchiveHabit() {
            const id = this.elements.habitIdInput.value;
            const habit = this.state.habits.find(h => h.id == id);
            if(habit) {
                const previousState = this.createPersistableStateSnapshot();
                habit.isArchived = !habit.isArchived;
                const shouldCheckArchivist = habit.isArchived;
                if (!this.saveDataOrRollback(previousState)) return;
                if (shouldCheckArchivist) {
                    this.checkAchievement('archivist');
                }
                this.render();
                this.closeModal(this.elements.habitModal);
            }
        },

        unarchiveHabit(habitId) {
            const habit = this.state.habits.find(h => h.id == habitId);
            if(habit) {
                const previousState = this.createPersistableStateSnapshot();
                habit.isArchived = false;
                if (!this.saveDataOrRollback(previousState)) return;
                this.render();
            }
        },
        
        // ----- HABIT LOGIC & HELPERS -----
        updateCheck(habitId, dateStr, isChecked) {
            const habit = this.state.habits.find(h => h.id == habitId);
            if (!habit) return;
            if (!this.isHabitDateWritable(habit, dateStr)) {
                this.showToast('습관은 생성일부터 오늘까지의 예정된 날짜에만 기록할 수 있습니다.', 'error');
                this.render();
                return;
            }
            const previousState = this.createPersistableStateSnapshot();
            if (!habit.logs[dateStr]) habit.logs[dateStr] = { value: 0 };
            habit.logs[dateStr].value = isChecked ? 1 : 0;
            
            if (!this.saveDataOrRollback(previousState)) {
                this.render();
                return;
            }
            this.checkComebackAchievement(habit, dateStr, isChecked);
            this.render(); // Re-render to update the summary text in 'today' view

            const habitItem = document.querySelector(`.habit-list-item[data-habit-id='${habitId}']`);
            if(habitItem) {
                const progressBar = habitItem.querySelector('.progress-bar');
                if (progressBar) {
                    progressBar.style.width = isChecked ? '100%' : '0%';
                }
                if(isChecked){
                    habitItem.classList.add('completed-animation');
                    setTimeout(() => habitItem.classList.remove('completed-animation'), 300);
                }
            }
            this.checkAllAchievements();
        },

        handleHabitClick(habitId, dateStr, element) {
            const habit = this.state.habits.find(h => h.id == habitId);
            if (!habit) return;
            if (!this.isHabitDateWritable(habit, dateStr)) {
                this.showToast('습관은 생성일부터 오늘까지의 예정된 날짜에만 기록할 수 있습니다.', 'error');
                this.render();
                return;
            }
            const previousState = this.createPersistableStateSnapshot();
            if (!habit.logs[dateStr]) habit.logs[dateStr] = { value: 0 };
            
            const isCompleted = habit.logs[dateStr].value === 1;
            habit.logs[dateStr].value = isCompleted ? 0 : 1;

            if (!this.saveDataOrRollback(previousState)) {
                element.classList.toggle('completed', isCompleted);
                return;
            }
            this.checkComebackAchievement(habit, dateStr, !isCompleted);
            
            element.classList.toggle('completed', !isCompleted);
            if (!isCompleted) {
                element.classList.add('completed-animation');
                setTimeout(() => element.classList.remove('completed-animation'), 300);
            }
            
            this.checkAllAchievements();
        },
        
        calculateHabitStats(habit) {
            const sortedDates = Object.keys(habit.logs)
                .filter(dateStr => {
                    const parsedDate = this.parseDateString(dateStr);
                    return !Number.isNaN(parsedDate.getTime())
                        && this.getDateString(parsedDate) === dateStr
                        && this.isHabitWithinTrackingRange(habit, parsedDate);
                })
                .sort();
            if (sortedDates.length === 0) return { currentStreak: 0, longestStreak: 0, totalCompletions: 0, completionRate: 0 };
            
            let totalCompletions = 0, longestStreak = 0;
            let currentLongestStreak = 0;
            let lastCompletionDate = null;
            
            sortedDates.forEach(dateStr => {
                if (this.isHabitCompletedOn(habit, dateStr)) {
                    totalCompletions++;
                    const currentDate = this.parseDateString(dateStr);
                    if (lastCompletionDate) {
                        let missedPracticeDay = false;
                        let checkDate = new Date(lastCompletionDate);
                        checkDate.setDate(checkDate.getDate() + 1);
                        
                        while(this.getDateString(checkDate) < this.getDateString(currentDate)) {
                            if (this.isHabitForDate(habit, checkDate)) {
                                missedPracticeDay = true;
                                break;
                            }
                            checkDate.setDate(checkDate.getDate() + 1);
                        }
                        currentLongestStreak = missedPracticeDay ? 1 : currentLongestStreak + 1;
                    } else {
                        currentLongestStreak = 1;
                    }
                    longestStreak = Math.max(longestStreak, currentLongestStreak);
                    lastCompletionDate = currentDate;
                }
            });
            
            let currentStreak = 0;
            const today = new Date();
            today.setHours(0,0,0,0);
            const createdDate = this.getHabitCreatedLocalDate(habit);

            for (let i = 0; i < 365 * 5; i++) { 
                let dateToCheck = new Date(today);
                dateToCheck.setDate(today.getDate() - i);

                if (createdDate && dateToCheck < createdDate) break;
                
                if (this.isHabitCountableOnDate(habit, dateToCheck)) {
                    if (this.isHabitCompletedOn(habit, this.getDateString(dateToCheck))) {
                        currentStreak++;
                    } else {
                        if(i > 0) break;
                    }
                }
            }

            const firstDate = this.parseDateString(sortedDates[0]);
            const totalDays = Math.ceil((new Date() - firstDate) / (1000 * 60 * 60 * 24));
            const completionRate = totalCompletions === 0 ? 0 : Math.round((totalCompletions / Math.max(1, totalCompletions + (this.getMissedCount(habit)))) * 100);
            return { currentStreak, longestStreak, totalCompletions, completionRate };
        },

        calculateReviewStats(startDate, endDate) {
            const habits = this.state.habits.filter(h => !h.isArchived);
            let totalPossible = 0;
            let totalCompleted = 0;
            
            const habitPerformances = habits.map(habit => {
                const perf = this.calculateHabitPerformance(habit, startDate, endDate);
                totalPossible += perf.possible;
                totalCompleted += perf.completed;
                return { habit, ...perf };
            })
            .filter(item => item.possible > 0)
            .sort((a, b) => b.rate - a.rate || b.completed - a.completed);

            const completionRate = totalPossible > 0 ? Math.round((totalCompleted / totalPossible) * 100) : 0;
            
            return {
                totalPossible,
                totalCompleted,
                completionRate,
                bestHabit: habitPerformances.length > 0 ? { name: habitPerformances[0].habit.name, rate: habitPerformances[0].rate } : null,
                worstHabit: habitPerformances.length > 1 ? { name: habitPerformances[habitPerformances.length - 1].habit.name, rate: habitPerformances[habitPerformances.length - 1].rate } : null,
                habitPerformances
            };
        },

        getMissedCount(habit, startDate = null, endDate = null) {
            let missed = 0;
            const sortedDates = Object.keys(habit.logs)
                .filter(dateStr => {
                    const parsedDate = this.parseDateString(dateStr);
                    return !Number.isNaN(parsedDate.getTime())
                        && this.getDateString(parsedDate) === dateStr
                        && this.isHabitWithinTrackingRange(habit, parsedDate);
                })
                .sort();
            if (sortedDates.length === 0 && !startDate) return 0;

            let firstDate = startDate
                ? this.normalizeLocalDate(startDate)
                : this.getHabitCreatedLocalDate(habit);
            const createdDate = this.getHabitCreatedLocalDate(habit);
            const today = this.normalizeLocalDate(new Date());
            let lastDate = endDate ? this.normalizeLocalDate(endDate) : today;

            if (!firstDate || !lastDate || !createdDate || !today) return 0;
            if (firstDate < createdDate) firstDate = new Date(createdDate);
            if (lastDate > today) lastDate = new Date(today);
            if (firstDate > lastDate) return 0;

            for(let d = new Date(firstDate); d <= lastDate; d.setDate(d.getDate() + 1)) {
                if (this.isHabitCountableOnDate(habit, d) && !this.isHabitCompletedOn(habit, this.getDateString(d))) {
                    missed++;
                }
            }
            return missed;
        },
        
        // ----- UTILITY & HELPERS (LOCAL TIME BASED) -----
        getDateString: (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        },
        parseDateString: (dateStr) => {
            const [year, month, day] = dateStr.split('-').map(Number);
            return new Date(year, month - 1, day);
        },
        normalizeLocalDate(date) {
            const normalized = date instanceof Date ? new Date(date.getTime()) : new Date(date);
            if (Number.isNaN(normalized.getTime())) return null;
            return this.parseDateString(this.getDateString(normalized));
        },
        getHabitCreatedLocalDate(habit) {
            const createdAt = Number(habit?.createdAt);
            if (!Number.isFinite(createdAt)) return null;
            return this.normalizeLocalDate(new Date(createdAt));
        },
        isHabitWithinTrackingRange(habit, date) {
            const targetDate = this.normalizeLocalDate(date);
            const createdDate = this.getHabitCreatedLocalDate(habit);
            const today = this.normalizeLocalDate(new Date());
            if (!targetDate || !createdDate || !today) return false;
            return targetDate >= createdDate
                && targetDate <= today;
        },
        isHabitCountableOnDate(habit, date) {
            const targetDate = this.normalizeLocalDate(date);
            return !!targetDate
                && this.isHabitWithinTrackingRange(habit, targetDate)
                && this.isHabitForDate(habit, targetDate);
        },
        isHabitDateWritable(habit, dateStr) {
            if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
            const parsedDate = this.parseDateString(dateStr);
            return !Number.isNaN(parsedDate.getTime())
                && this.getDateString(parsedDate) === dateStr
                && this.isHabitCountableOnDate(habit, parsedDate);
        },
        isHabitForDate: (habit, date) => (habit.frequency?.days || [0,1,2,3,4,5,6]).includes(date.getDay()),
        isHabitCompletedOn(habit, dateStr) {
            const log = habit.logs[dateStr];
            if (!log) return false;
            return log.value === 1;
        },
        changeMonth(offset) {
            const newDate = new Date(this.state.currentDate);
            newDate.setDate(1);
            newDate.setMonth(newDate.getMonth() + offset);
            this.state.currentDate = newDate;
            this.render();
        },
        jumpToMonth() {
            const picker = this.elements.datePickerInput;
            const rect = document.getElementById('calendar-title').getBoundingClientRect();
            
            document.body.appendChild(picker);
            picker.style.position = 'absolute';
            picker.style.top = `${rect.bottom + window.scrollY + 5}px`;
            picker.style.left = `${rect.left + window.scrollX + (rect.width / 2)}px`;
            picker.style.transform = 'translateX(-50%)';
            
            picker.type = 'month';
            picker.value = this.getDateString(this.state.currentDate).substring(0, 7);
            try {
                picker.showPicker();
            } catch (e) {
                console.warn("showPicker() is not supported by this browser.");
            }
        },
        handleDateJump(event) {
            const value = event.target.value;
            if (!value) return;

            if (event.target.type === 'month') {
                 const [year, month] = value.split('-').map(Number);
                if (!isNaN(year) && !isNaN(month)) {
                    this.state.currentDate = new Date(year, month - 1, 1);
                    this.render();
                }
            } else if (event.target.type === 'date') {
                // --- MODIFIED: Timezone 버그 방지를 위해 Date 객체 생성 방식 변경 ---
                const [year, month, day] = value.split('-').map(Number);
                const date = new Date(year, month - 1, day);
                if (!isNaN(date.getTime())) {
                    this.state.currentDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
                    this.render();
                }
            }
            event.target.style.cssText = '';
        },
        changeDay(offset) {
            const newDate = new Date(this.state.currentDate);
            newDate.setDate(newDate.getDate() + offset);
            this.state.currentDate = newDate;
            this.render();
        },
        escapeHTML(str) {
            if (window.MothNoteSanitizer?.escapeHtml) {
                return window.MothNoteSanitizer.escapeHtml(str);
            }
            if (typeof str !== 'string') return '';
            return str.replace(/[&<>'"]/g,
                tag => ({
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    "'": '&#39;',
                    '"': '&quot;'
                }[tag] || tag)
            );
        },

        // ----- DRAG & DROP -----
        getDragAfterElement(container, y) {
            const draggableElements = [...container.querySelectorAll('.habit-list-item:not(.dragging)')];
            return draggableElements.reduce((closest, child) => {
                const box = child.getBoundingClientRect();
                const offset = y - box.top - box.height / 2;
                return (offset < 0 && offset > closest.offset) ? { offset, element: child } : closest;
            }, { offset: Number.NEGATIVE_INFINITY }).element;
        },
        
        updateHabitOrder() {
            const habitElements = this.elements.appContent.querySelectorAll('#habit-list-container .habit-list-item');
            const orderedIds = Array.from(habitElements).map(el => String(el.dataset.habitId ?? ''));
            const previousState = this.createPersistableStateSnapshot();

            // 검색·보관·날짜 필터로 화면에서 숨겨진 습관은 기존 슬롯에 그대로 둡니다.
            // 보이는 일부 항목만 배열 앞으로 정렬하면 필터를 해제했을 때 숨은 습관의
            // 사용자 지정 순서까지 조용히 바뀌므로, 현재 화면이 차지한 슬롯만 교체합니다.
            const habitById = new Map(this.state.habits.map(habit => [String(habit.id), habit]));
            const seenOrderedIds = new Set();
            const uniqueOrderedIds = orderedIds.filter(id => {
                if (!id || seenOrderedIds.has(id) || !habitById.has(id)) return false;
                seenOrderedIds.add(id);
                return true;
            });
            const visibleIdSet = new Set(uniqueOrderedIds);
            const visibleHabitCount = this.state.habits.reduce(
                (count, habit) => count + (visibleIdSet.has(String(habit.id)) ? 1 : 0),
                0
            );

            // 오래된 DOM이나 중복 ID로 목록과 상태가 어긋난 경우에는 부분 순서를 저장하지 않습니다.
            if (uniqueOrderedIds.length !== orderedIds.length || visibleHabitCount !== uniqueOrderedIds.length) {
                this.render();
                return;
            }

            const reorderedVisibleHabits = uniqueOrderedIds.map(id => habitById.get(id));
            let visibleIndex = 0;
            this.state.habits = this.state.habits.map(habit => (
                visibleIdSet.has(String(habit.id))
                    ? reorderedVisibleHabits[visibleIndex++]
                    : habit
            ));

            this.state.habits.forEach((habit, index) => {
                habit.order = index;
            });
            
            if (!this.saveDataOrRollback(previousState)) {
                this.render();
            }
        },

        getCalendarDayOffset(startDate, endDate) {
            const startUtc = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
            const endUtc = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
            return Math.round((endUtc - startUtc) / 86400000);
        },

        getHeatmapDateRange() {
            const endDate = new Date();
            endDate.setHours(0, 0, 0, 0);

            const startDate = getPreviousCalendarYearRangeStart(endDate);

            // 표시 구간의 첫 날짜가 속한 일요일을 1열의 기준점으로 삼습니다.
            // 달력 연도가 바뀌어도 열 번호가 0으로 되돌아가지 않아 모든 날짜가
            // 과거에서 현재 순서로 정확히 한 칸씩 배치됩니다.
            const gridStartDate = new Date(startDate);
            gridStartDate.setDate(gridStartDate.getDate() - gridStartDate.getDay());
            const weekCount = Math.floor(this.getCalendarDayOffset(gridStartDate, endDate) / 7) + 1;

            return { startDate, endDate, gridStartDate, weekCount };
        },
        
        generateHeatmap(habit) {
            const { startDate, endDate, gridStartDate, weekCount } = this.getHeatmapDateRange();

            const dates = [];
            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                dates.push(new Date(d));
            }

            const cells = [];
            
            dates.forEach(date => {
                const dateStr = this.getDateString(date);
                const isCompleted = this.isHabitCompletedOn(habit, dateStr);
                const level = isCompleted ? 4 : 0;
                const dayOfWeek = date.getDay();
                
                const weekNumber = Math.floor(this.getCalendarDayOffset(gridStartDate, date) / 7);

                cells.push(`<div class="heatmap-cell" data-level="${level}" title="${dateStr}" style="grid-column: ${weekNumber + 1}; grid-row: ${dayOfWeek + 1};"></div>`);
            });

            return `<div class="heatmap-wrapper">
                <div class="heatmap-body">
                    <div class="heatmap-grid" style="grid-template-columns: repeat(${weekCount}, 16px);">${cells.join('')}</div>
                </div>
            </div>`;
        },

        generateOverallHeatmap() {
            const habits = this.state.habits.filter(h => !h.isArchived);
            if (habits.length === 0) return '<p>활성 습관이 없습니다.</p>';

            const { startDate, endDate, gridStartDate, weekCount } = this.getHeatmapDateRange();

            const dailyData = {};
            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                const dateStr = this.getDateString(d);
                let possible = 0;
                let completed = 0;
                habits.forEach(habit => {
                    if (this.isHabitCountableOnDate(habit, d)) {
                        possible++;
                        if (this.isHabitCompletedOn(habit, dateStr)) {
                            completed++;
                        }
                    }
                });
                dailyData[dateStr] = { possible, completed };
            }
            
            const cells = [];
            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                const dateStr = this.getDateString(d);
                const data = dailyData[dateStr];
                let level = 0;
                let title = `${dateStr}: 예정된 습관 없음`;

                if (data && data.possible > 0) {
                    const rate = data.completed / data.possible;
                    if (rate === 1) level = 4;
                    else if (rate >= 0.67) level = 3;
                    else if (rate >= 0.34) level = 2;
                    else if (rate > 0) level = 1;
                    title = `${dateStr}: ${data.completed} / ${data.possible}개 완료 (${Math.round(rate * 100)}%)`;
                }
                
                const dayOfWeek = d.getDay();
                const weekNumber = Math.floor(this.getCalendarDayOffset(gridStartDate, d) / 7);

                cells.push(`<div class="heatmap-cell" data-level="${level}" title="${this.escapeHTML(title)}" style="grid-column: ${weekNumber + 1}; grid-row: ${dayOfWeek + 1};"></div>`);
            }

            return `<div class="heatmap-wrapper">
                <div class="heatmap-body">
                    <div class="heatmap-grid" style="grid-template-columns: repeat(${weekCount}, 16px);">${cells.join('')}</div>
                </div>
            </div>`;
        },
        
        // ----- CHARTS -----
        destroyCharts() {
            Object.values(this.state.chartInstances).forEach(chart => chart.destroy());
            this.state.chartInstances = {};
        },
        renderStatsCharts(habits) {
            this.renderMainMonthlyChart(habits);
            this.renderDayOfWeekChart(habits);
        },
        renderMainMonthlyChart(habits) {
            const ctx = document.getElementById('main-stats-chart')?.getContext('2d');
            if (!ctx) return;
            
            const labels = [];
            const data = [];
            const today = new Date();
            today.setHours(0,0,0,0);
            
            for(let i=5; i>=0; i--) {
                const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
                labels.push(date.toLocaleString('ko-KR', { month: 'long' }));

                const year = date.getFullYear();
                const month = date.getMonth();
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                let totalPossible = 0;
                let totalCompleted = 0;

                for(let day=1; day<=daysInMonth; day++) {
                    const loopDate = new Date(year, month, day);
                    const dateStr = this.getDateString(loopDate);
                    habits.forEach(habit => {
                        if (this.isHabitCountableOnDate(habit, loopDate)) {
                            totalPossible++;
                            if (this.isHabitCompletedOn(habit, dateStr)) {
                                totalCompleted++;
                            }
                        }
                    });
                }
                data.push(totalPossible > 0 ? (totalCompleted / totalPossible) * 100 : 0);
            }
            
            this.state.chartInstances.main = new Chart(ctx, {
                type: 'bar',
                data: { labels, datasets: [{ label: '달성률 (%)', data, backgroundColor: 'rgba(var(--primary-rgb), 0.6)', borderColor: 'rgba(var(--primary-rgb), 1)', borderWidth: 1 }] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: 100,
                            ticks: { color: getComputedStyle(document.body).getPropertyValue('--text-color') }
                        },
                        x: {
                            ticks: { color: getComputedStyle(document.body).getPropertyValue('--text-color') }
                        }
                    },
                    plugins: {
                        legend: {
                            labels: { color: getComputedStyle(document.body).getPropertyValue('--text-color') }
                        }
                    }
                }
            });
        },
        renderDayOfWeekChart(habits) {
            const ctx = document.getElementById('day-of-week-chart')?.getContext('2d');
            if (!ctx) return;

            const possible = Array(7).fill(0);
            const completed = Array(7).fill(0);
            
            let firstLogDate = new Date();
            firstLogDate.setHours(0,0,0,0);

            if (habits.length > 0) {
                const allLogDates = habits.flatMap(h => Object.keys(h.logs)
                    .map(d => this.parseDateString(d))
                    .filter(d => !Number.isNaN(d.getTime()) && this.isHabitWithinTrackingRange(h, d)));
                if (allLogDates.length > 0) {
                    firstLogDate = new Date(Math.min(...allLogDates));
                }
            }
            
            const today = new Date();
            today.setHours(0,0,0,0);
            for (let d = new Date(firstLogDate); d <= today; d.setDate(d.getDate() + 1)) {
                const dayOfWeek = d.getDay();
                const dateStr = this.getDateString(d);
                habits.forEach(habit => {
                    if (this.isHabitCountableOnDate(habit, d)) {
                        possible[dayOfWeek]++;
                        if (this.isHabitCompletedOn(habit, dateStr)) {
                            completed[dayOfWeek]++;
                        }
                    }
                });
            }
            
            const missed = possible.map((p, i) => p - completed[i]);
            
            this.state.chartInstances.dayOfWeek = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: ['일', '월', '화', '수', '목', '금', '토'],
                    datasets: [
                        {
                            label: '성공',
                            data: completed,
                            backgroundColor: `rgba(${getComputedStyle(document.body).getPropertyValue('--success-rgb')}, 0.7)`
                        },
                        {
                            label: '실패',
                            data: missed,
                            backgroundColor: `rgba(${getComputedStyle(document.body).getPropertyValue('--missed-rgb')}, 0.5)`
                        }
                    ]
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    scales: { 
                        x: { 
                            stacked: true,
                            ticks: { color: getComputedStyle(document.body).getPropertyValue('--text-color') }
                        },
                        y: { 
                            stacked: true, 
                            beginAtZero: true,
                            ticks: { color: getComputedStyle(document.body).getPropertyValue('--text-color') }
                        } 
                    },
                    plugins: {
                        legend: {
                            labels: { color: getComputedStyle(document.body).getPropertyValue('--text-color') }
                        },
                        tooltip: {
                            callbacks: {
                                footer: function(tooltipItems) {
                                    let total = 0;
                                    tooltipItems.forEach(item => total += item.parsed.y);
                                    if (total > 0) {
                                        const completed = tooltipItems.find(i => i.dataset.label === '성공')?.parsed.y || 0;
                                        return `달성률: ${Math.round(completed / total * 100)}%`;
                                    }
                                    return '';
                                }
                            }
                        }
                    }
                }
            });
        },

        // ----- ACHIEVEMENTS -----
        checkAchievement(id, forceUnlock = false) {
            if (this.state.achievements[id]) return;
            const unlockConditions = {
                'first_habit': () => this.state.habits.length > 0,
                '5_habits': () => this.state.habits.filter(h => !h.isArchived).length >= 5,
                '10_habits': () => this.state.habits.filter(h => !h.isArchived).length >= 10,
                'perfect_day': () => {
                    const today = new Date();
                    today.setHours(0,0,0,0);
                    const todayStr = this.getDateString(today);
                    const habitsForToday = this.state.habits.filter(h => !h.isArchived && this.isHabitCountableOnDate(h, today));
                    return habitsForToday.length > 0 && habitsForToday.every(h => this.isHabitCompletedOn(h, todayStr));
                },
                'perfect_week': () => {
                    const today = new Date();
                    today.setHours(0,0,0,0);
                    const activeHabits = this.state.habits.filter(h => !h.isArchived);
                    const periodStart = new Date(today);
                    periodStart.setDate(today.getDate() - 6);
                    const hasFullObservationWindow = activeHabits.some(habit => {
                        const createdDate = this.getHabitCreatedLocalDate(habit);
                        return createdDate && createdDate <= periodStart;
                    });
                    if (!hasFullObservationWindow) return false;

                    let opportunityCount = 0;
                    for (let i = 0; i < 7; i++) {
                        const dateToCheck = new Date(today); dateToCheck.setDate(today.getDate() - i);
                        const dateStr = this.getDateString(dateToCheck);
                        const habitsForDay = activeHabits.filter(h => this.isHabitCountableOnDate(h, dateToCheck));
                        opportunityCount += habitsForDay.length;
                        if (habitsForDay.length > 0 && !habitsForDay.every(h => this.isHabitCompletedOn(h, dateStr))) {
                            return false;
                        }
                    }
                    return opportunityCount > 0;
                },
                'perfect_month': () => {
                    const activeHabits = this.state.habits.filter(h => !h.isArchived);
                    if (activeHabits.length === 0) return false;
                    
                    const allLogDates = activeHabits.flatMap(h => Object.keys(h.logs)
                        .filter(dateStr => {
                            const date = this.parseDateString(dateStr);
                            return !Number.isNaN(date.getTime()) && this.isHabitWithinTrackingRange(h, date);
                        }));
                    if (allLogDates.length === 0) return false;

                    const monthsToCheck = new Set(allLogDates.map(d => d.substring(0, 7)));
                    
                    for (const monthStr of monthsToCheck) {
                        const [year, month] = monthStr.split('-').map(Number);
                        const firstDay = new Date(year, month - 1, 1);
                        const lastDay = new Date(year, month, 0);
                        const today = this.normalizeLocalDate(new Date());
                        if (!today || lastDay > today) continue;
                        const hasFullObservationWindow = activeHabits.some(habit => {
                            const createdDate = this.getHabitCreatedLocalDate(habit);
                            return createdDate && createdDate <= firstDay;
                        });
                        if (!hasFullObservationWindow) continue;

                        let isMonthPerfect = true;
                        let opportunityCount = 0;

                        for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
                            const dateStr = this.getDateString(d);
                            const habitsForDay = activeHabits.filter(h => this.isHabitCountableOnDate(h, d));
                            opportunityCount += habitsForDay.length;
                            if (habitsForDay.length > 0) {
                                if (!habitsForDay.every(h => this.isHabitCompletedOn(h, dateStr))) {
                                    isMonthPerfect = false;
                                    break; 
                                }
                            }
                        }
                        if (isMonthPerfect && opportunityCount > 0) return true;
                    }
                    return false;
                },
                '7_day_streak': () => this.state.habits.some(h => this.calculateHabitStats(h).currentStreak >= 7),
                '30_day_streak': () => this.state.habits.some(h => this.calculateHabitStats(h).currentStreak >= 30),
                '180_day_streak': () => this.state.habits.some(h => this.calculateHabitStats(h).currentStreak >= 180),
                '365_day_streak': () => this.state.habits.some(h => this.calculateHabitStats(h).currentStreak >= 365),
                '100_completions': () => this.state.habits.some(h => this.calculateHabitStats(h).totalCompletions >= 100),
                '500_completions': () => this.state.habits.some(h => this.calculateHabitStats(h).totalCompletions >= 500),
                '1000_completions': () => this.state.habits.some(h => this.calculateHabitStats(h).totalCompletions >= 1000),
                'archivist': () => this.state.habits.some(h => h.isArchived),
                'explorer': () => Object.keys(this.state.visitedViews).length >= 6,
                'comeback_king': () => false,
                'data_guardian': () => false,
            };
            if (unlockConditions[id] && (forceUnlock || unlockConditions[id]())) {
                const previousState = this.createPersistableStateSnapshot();
                this.state.achievements[id] = { unlockedAt: new Date().toISOString() };
                if (!this.saveDataOrRollback(previousState)) return;
                const { title, description } = achievementList[id];
                this.showToast(`🏆 ${title}: ${description}`, 'success', 5000);
            }
        },
        checkAllAchievements() { Object.keys(achievementList).forEach(id => this.checkAchievement(id)); },
        
        checkComebackAchievement(habit, dateStr, isChecked) {
            if (!isChecked) return;
            
            const today = this.parseDateString(dateStr);
            let lastPracticeDate = null;
            const sortedLogs = Object.keys(habit.logs)
                .filter(d => d < dateStr && habit.logs[d].value > 0)
                .sort().pop();
            
            if(sortedLogs) {
                lastPracticeDate = this.parseDateString(sortedLogs);
                const diffDays = this.getCalendarDayOffset(lastPracticeDate, today);
                if (diffDays >= 7) {
                    this.checkAchievement('comeback_king', true);
                }
            }
        },

        renderAchievements() {
            this.elements.achievementsGrid.innerHTML = Object.entries(achievementList).map(([id, ach]) => `
                <div class="achievement-card ${this.state.achievements[id] ? 'unlocked' : ''}">
                    <div class="achievement-icon">${this.state.achievements[id] ? ach.icon : '❓'}</div>
                    <div class="achievement-title">${ach.title}</div>
                    <p class="achievement-desc">${ach.description}</p>
                </div>
            `).join('');
        },

        // ----- DATA MANAGEMENT (REMOVED) -----
        // exportData, importData, etc. functions are removed as they are now handled by MothNote.

        handleResetWithSample() {
            this.showConfirmDialog('🔄 샘플 데이터로 초기화', '현재 데이터를 모두 지우고 기본 샘플 습관으로 초기화하시겠습니까?', () => {
                const previousState = this.createPersistableStateSnapshot();
                this.state.habits = [];
                this.state.achievements = {};
                this.state.visitedViews = {};
                if (!this.setupDefaultHabits({ allowCorruptDataReplacement: true })) {
                    this.restorePersistableStateSnapshot(previousState);
                    return;
                }
                try {
                    localStorage.setItem('habitTrackerInitialized', 'true');
                } catch (error) {
                    console.error('Failed to persist habit tracker initialization flag.', error);
                }
                this.render();
                this.closeModal(this.elements.confirmModal);
                this.showToast('샘플 데이터로 초기화되었습니다. ✅', 'success');
            });
        },

        handleWipeAllData() {
            this.showConfirmDialog('🚨 완전 초기화', '정말로 모든 습관, 기록, 업적을 영구적으로 삭제하시겠습니까? 앱이 처음 상태(빈 화면)로 돌아갑니다.', () => {
                const previousState = this.createPersistableStateSnapshot();
                this.state.habits = [];
                this.state.achievements = {};
                this.state.visitedViews = {};
                if (!this.saveDataOrRollback(previousState, { allowCorruptDataReplacement: true })) return;
                try {
                    localStorage.setItem('habitTrackerInitialized', 'true');
                } catch (error) {
                    console.error('Failed to persist habit tracker initialization flag.', error);
                }
                this.render();
                this.closeModal(this.elements.confirmModal);
                this.showToast('모든 데이터가 초기화되었습니다. 🧹', 'info');
            });
        },

        clearPendingConfirmDialog() {
            const cleanup = this._activeConfirmCleanup;
            this._activeConfirmCleanup = null;
            if (typeof cleanup === 'function') cleanup();
        },

        showConfirmDialog(title, message, onConfirm) {
            // Backdrop/Escape로 이전 확인창을 닫은 경우에도 파괴적 콜백 리스너가
            // 다음 확인창까지 남지 않도록, 새 확인창을 열기 전에 먼저 정리합니다.
            this.clearPendingConfirmDialog();
            this.elements.confirmTitle.textContent = title;
            this.elements.confirmMessage.textContent = message;

            const onOkClick = () => {
                cleanup();
                this.closeModal(this.elements.confirmModal);
                onConfirm();
            };

            const onCancelClick = () => {
                cleanup();
                this.closeModal(this.elements.confirmModal);
            };

            const cleanup = () => {
                this.elements.confirmOkBtn.removeEventListener('click', onOkClick);
                this.elements.confirmCancelBtn.removeEventListener('click', onCancelClick);
                if (this._activeConfirmCleanup === cleanup) {
                    this._activeConfirmCleanup = null;
                }
            };

            this._activeConfirmCleanup = cleanup;
            this.elements.confirmOkBtn.addEventListener('click', onOkClick);
            this.elements.confirmCancelBtn.addEventListener('click', onCancelClick);

            this.openModal(this.elements.confirmModal);
        },
        
        trapFocus(modal) {
            const focusableElements = modal.querySelectorAll(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];

            const handleKeyDown = (e) => {
                if (e.key !== 'Tab') return;

                if (e.shiftKey) { 
                    if (document.activeElement === firstElement) {
                        lastElement.focus();
                        e.preventDefault();
                    }
                } else { 
                    if (document.activeElement === lastElement) {
                        firstElement.focus();
                        e.preventDefault();
                    }
                }
            };
            modal.addEventListener('keydown', handleKeyDown);
            modal._focusTrapHandler = handleKeyDown;
        },

        // ----- MOTIVATION & NOTIFICATION -----
        showToast(message, type = 'info', duration = 3000) {
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.textContent = message;
            this.elements.toastContainer.appendChild(toast);
            setTimeout(() => {
                toast.remove();
            }, duration);
        },

        showRandomQuote() {
            const quotes = ["성공의 비밀은 꾸준함에 있다. 💪", "오늘의 작은 실천이 내일의 큰 변화를 만든다. 🌱", "어제보다 나은 오늘을 만들자. ✨", "포기하지 않는 한, 실패는 없다. 🌟", "꾸준함이 재능을 이긴다. 🐢"];
            this.elements.motivationalQuote.textContent = quotes[Math.floor(Math.random() * quotes.length)];
        }
    };

    app.init();
});
