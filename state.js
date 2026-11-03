// state.js

export const CONSTANTS = {
    ITEM_TYPE: { FOLDER: 'folder', NOTE: 'note' },
    MODAL_TYPE: { PROMPT: 'prompt', CONFIRM: 'confirm', ALERT: 'alert' },
    TOAST_TYPE: { SUCCESS: 'success', ERROR: 'error' },
    LS_KEY: 'newTabNoteLastSession_v11.0',
    LS_KEY_IMPORT_IN_PROGRESS: 'mothnote_import_in_progress_v1',
    // [버그 수정] 데이터 무결성을 파괴할 수 있는 위험한 전체 상태 비상 백업 키를 제거합니다.
    // 대신, 안전한 복원 절차를 위해 '변경사항'만 기록하는 새로운 키를 도입합니다.
    LS_KEY_EMERGENCY_CHANGES_BACKUP: 'mothnote_emergency_changes_backup_v1',
    
    // 설정 관련 상수
    LS_KEY_SETTINGS: 'newTabNoteSettings_v2',
    DEFAULT_SETTINGS: {
        layout: { col1: 10, col2: 10 },
        editor: { fontFamily: `-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Helvetica Neue", sans-serif`, fontSize: 17 },
        weather: { lat: 37.5660, lon: 126.9784 },
        zenMode: { maxWidth: 850 }
    },

    // 가상 폴더 및 UI 관련 상수
    VIRTUAL_FOLDERS: {
        ALL:    { id: 'all-notes-virtual-id', name: '모든 노트', displayName: '📚 모든 노트', icon: '📚', canAddNote: false, getNotes: (state) => Array.from(state.noteMap.values()).map(entry => entry.note) },
        // [수정] slice()를 제거하여 최근 10개가 아닌 전체 노트를 최신순으로 반환하도록 변경
        RECENT: { id: 'recent-notes-virtual-id', name: '최근 노트', displayName: '🕒 최근 노트', icon: '🕒', canAddNote: false, isSortable: false, getNotes: (state) => Array.from(state.noteMap.values()).map(entry => entry.note).sort((a,b) => b.updatedAt - a.updatedAt) },
        FAVORITES: { id: 'favorites-virtual-id', name: '즐겨찾기', displayName: '⭐ 즐겨찾기', icon: '⭐', canAddNote: false, isSortable: true, getNotes: (state) => Array.from(state.noteMap.values()).map(entry => entry.note).filter(note => state.favorites.has(note.id)) },
        TRASH:  { id: 'trash-virtual-id', name: '휴지통', displayName: '🗑️ 휴지통', icon: '🗑️', canAddNote: false, isSortable: false, getNotes: (state) => state.trash }
    },
    CLASSES: {
        DRAGGING: 'dragging',
        DROP_TARGET: 'drop-target',
        PINNED: 'pinned',
        ACTIVE: 'active',
        READONLY: 'readonly'
    },
    MODAL_TITLES: {
        NEW_FOLDER: '📁 새 폴더 만들기',
        PERM_DELETE: '💥 영구 삭제',
        EMPTY_TRASH: '🗑️ 휴지통 비우기',
        IMPORT_DATA: '⚠️ 데이터 가져오기',
        SHORTCUT_GUIDE: '⌨️ 단축키 안내',
        UNSAVED_CHANGES: '📝 저장되지 않은 변경사항',
        WEATHER_LOCATION: '🌦️ 날씨 지역 설정'
    },
    ID_PREFIX: {
        FOLDER: 'folder-',
        NOTE: 'note-'
    },
    DEBOUNCE_DELAY: {
        KEY_NAV: 200,
        SEARCH: 300,
        SAVE: 500,
        WEATHER_SEARCH: 500
    },
    EDITOR: {
        DOM_IDS: {
            container: 'editor-container',
            titleInput: 'note-title-input',
            contentTextArea: 'note-content-textarea',
            contentView: 'note-content-view',
            footer: 'editor-footer',
            updatedDate: 'updated-date',
            createdDate: 'created-date',
            wordCount: 'word-count',
            charCount: 'char-count',
            lineCount: 'line-count',
            saveStatus: 'save-status-indicator',
            placeholderIcon: 'placeholder-icon'
        }
    },
    DASHBOARD: {
        WEATHER_CACHE_KEY: 'weather_cache_v1',
        DOM_IDS: {
            digitalClock: 'digital-clock',
            analogClockCanvas: 'analog-clock',
            weatherContainer: 'weather-container',
            calendarGrid: 'calendar-grid',
            calendarMonthYear: 'calendar-month-year',
            prevMonthBtn: 'prev-month-btn',
            nextMonthBtn: 'next-month-btn',
        },
        WMO_MAP: {
            0: { icon: "☀️", text: "맑음" }, 1: { icon: "🌤️", text: "대체로 맑음" }, 2: { icon: "🌥️", text: "구름 조금" }, 3: { icon: "☁️", text: "흐림" }, 45: { icon: "🌫️", text: "안개" }, 48: { icon: "🌫️", text: "짙은 안개" }, 51: { icon: "🌦️", text: "가랑비" }, 53: { icon: "🌦️", text: "가랑비" }, 55: { icon: "🌦️", text: "강한 가랑비" }, 56: { icon: "🥶💧", text: "어는 가랑비" }, 57: { icon: "🥶💧", text: "강한 어는 가랑비" }, 61: { icon: "🌧️", text: "비" }, 63: { icon: "🌧️", text: "비" }, 65: { icon: "🌧️", text: "강한 비" }, 66: { icon: "🥶🌧️", text: "어는 비" }, 67: { icon: "🥶🌧️", text: "강한 어는 비" }, 71: { icon: "❄️", text: "눈" }, 73: { icon: "❄️", text: "눈" }, 75: { icon: "❄️", text: "강한 눈" }, 77: { icon: "🌨️", text: "싸락눈" }, 80: { icon: "🌧️", text: "소나기" }, 81: { icon: "🌧️", text: "소나기" }, 82: { icon: "⛈️", text: "강한 소나기" }, 85: { icon: "🌨️", text: "소낙눈" }, 86: { icon: "🌨️", "text": "강한 소낙눈" }, 95: { icon: "⛈️", text: "뇌우" }, 96: { icon: "⛈️🧊", text: "뇌우 (우박 동반)" }, 99: { icon: "⛈️🧊", text: "강한 뇌우 (우박 동반)" },
        }
    },
    AUTO_TITLE_LENGTH: 100,
    AUTO_TITLE_LENGTH_KOR: 50,
    RECENT_NOTES_COUNT: 10,
    TOAST_DURATION: 4000,
    PLACEHOLDER_EMOJIS: ['🦋', '💡', '✨', '✍️', '🌱', '🎨', '🧠', '🌟', '☕', '📖', '📝', '🧭', '🔭', '🗺️', '🤔', '🌿', '🌻', '🍃', '🌈', '🦉', '🪐', '🌌', '🧘', '🍵', '🪁', '🎈', '🚀', '💎', '🎯', '🔑', '🖋️', '✏️', '🖌️', '🎶', '💭', '🌳', '🌊', '🐚', '🌕', '🌙', '🏔️', '📚', '🔎', '📎', '🔗', '🧩', '🕯️', '🔮', '⏳', '♾️'],
    MESSAGES: {
        SUCCESS: {
            NOTE_PINNED: '📍 노트를 고정했습니다.', NOTE_UNPINNED: '📌 노트 고정을 해제했습니다.',
            NOTE_FAVORITED: '⭐ 노트를 즐겨찾기에 추가했습니다.', NOTE_UNFAVORITED: '⚝ 즐겨찾기에서 노트를 제거했습니다.',
            FOLDER_MOVED_TO_TRASH: name => `🗑️ '${name}' 폴더를 휴지통으로 이동했습니다.`,
            NOTE_MOVED_TO_TRASH: name => `🗑️ '${name}' 노트를 휴지통으로 이동했습니다.`,
            ITEM_RESTORED_FOLDER: name => `♻️ 📁 '${name}' 폴더와 노트를 복원했습니다.`,
            ITEM_RESTORED_NOTE: name => `♻️ 📝 '${name}' 노트를 복원했습니다.`,
            PERM_DELETE_ITEM_SUCCESS: '💥 항목을 영구적으로 삭제했습니다.', EMPTY_TRASH_SUCCESS: '🗑️ 휴지통을 비웠습니다.',
            NOTE_MOVED_SUCCESS: (noteTitle, folderName) => `✅ '${noteTitle}' 노트를 '${folderName}' 폴더로 이동했습니다.`,
            EXPORT_SUCCESS: '📤 데이터 내보내기 성공!', IMPORT_SUCCESS: '📥 데이터를 성공적으로 가져왔습니다!',
            SETTINGS_SAVED: '⚙️ 설정이 저장되었습니다.', SETTINGS_RESET: '⚙️ 설정이 기본값으로 복원되었습니다.',
            IMPORT_RELOAD: '✅ 데이터를 성공적으로 가져왔습니다! 앱을 다시 시작합니다.',
            WEATHER_LOCATION_UPDATED: '🌦️ 날씨 지역 정보가 업데이트되었습니다.'
        },
        ERROR: {
            FOLDER_EXISTS: name => `🤔 '${name}' 폴더는 이미 존재해요.`,
            ADD_NOTE_PROMPT: '💡 노트를 추가하려면 먼저 실제 폴더를 선택해주세요.',
            RESTORE_FAILED_NO_FOLDER: '🤔 원본 폴더를 찾을 수 없습니다. 먼저 폴더를 복원해주세요.',
            EMPTY_NAME_ERROR: '🤔 이름은 비워둘 수 없어요.',
            DUPLICATE_NAME_ERROR: name => `🤔 '${name}' 이름이 이미 존재합니다.`,
            EXPORT_FAILURE: '📤❌ 데이터 내보내기 실패.', IMPORT_FAILURE: err => `📥❌ 가져오기 실패: ${err.message}`,
            IMPORT_FILE_READ_FAILURE: '📥❌ 백업 파일을 읽을 수 없습니다.',
            INVALID_FONT_NAME: '🤔 유효하지 않은 글꼴 이름입니다. 기본값으로 복원됩니다.',
            WEATHER_CITY_NOT_FOUND: '🌦️ 도시를 찾을 수 없습니다. 다른 이름으로 검색해보세요.',
            INVALID_LATITUDE: '🤔 유효하지 않은 위도 값입니다. (-90 ~ 90)',
            INVALID_LONGITUDE: '🤔 유효하지 않은 경도 값입니다. (-180 ~ 180)',
            RESERVED_NAME: '🚫 시스템에서 사용하는 이름으로는 변경할 수 없습니다.',
            // --- [CRITICAL BUG FIX] START ---
            RENAME_CONFLICT_ON_RECOVERY: name => `'${name}'(으)로의 이름 변경을 복원할 수 없습니다. 해당 이름이 이미 다른 곳에서 사용 중입니다. 복원하려면 새 이름을 입력해주세요.`,
            RENAME_RECOVERY_CANCELED: '이름 변경 복원이 취소되었습니다.',
            // --- [CRITICAL BUG FIX] END ---
        },
        CONFIRM: {
            PERM_DELETE: name => `💥 '${name}' 항목을 영구적으로 삭제합니다. 이 작업은 되돌릴 수 없어요! 😱`,
            EMPTY_TRASH: count => `🗑️ 휴지통에 있는 모든 항목(${count}개)을 영구적으로 삭제할까요?`,
            IMPORT_DATA: '⚠️ 데이터를 가져오면 현재 모든 데이터가 교체됩니다. 계속하시겠습니까?',
        }
    }
};

export let state = {
    // --- 핵심 데이터 ---
    folders: [],
    trash: [],
    favorites: new Set(),
    lastSavedTimestamp: null,

    // --- UI/세션 상태 ---
    activeFolderId: null,
    activeNoteId: null,
    searchTerm: '',
    noteSortOrder: 'updatedAt_desc',
    lastActiveNotePerFolder: {},
    preSearchActiveNoteId: null,
    dateFilter: null,
    renamingItemId: null,
    isMarkdownView: false,

    // --- 파생/캐시 데이터 ---
    noteMap: new Map(),
    totalNoteCount: 0,
    noteCreationDates: new Set(),
    _virtualFolderCache: { all: null, recent: null, favorites: null, trash: null },

    // --- 실시간 상태 플래그 ---
    isDirty: false,
    dirtyNoteId: null,
    isPerformingOperation: false,
};

// --- 구독 및 상태 변경 알림 로직 ---
const subscribers = new Set();
export const subscribe = (callback) => {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
};
const notify = () => {
    subscribers.forEach(callback => {
        try {
            const result = callback();
            // async 구독자의 Promise 거부는 동기 try/catch로 잡히지 않습니다.
            // 처리하지 않은 Promise 거부가 전체 렌더 흐름을 불안정하게 만들지 않도록 별도로 관찰합니다.
            if (result && typeof result.catch === 'function') {
                result.catch(error => {
                    console.error("An async subscriber failed during notification:", error);
                });
            }
        } catch (error) {
            console.error("A subscriber failed during notification:", error);
        }
    });
};

export const buildNoteMap = () => {
    state._virtualFolderCache = { all: null, recent: null, favorites: null, trash: null };
    state.noteMap.clear();

    let mappedNoteCount = 0;
    if (!Array.isArray(state.folders)) {
        state.totalNoteCount = 0;
        return;
    }

    for (const folder of state.folders) {
        if (!folder || !folder.id || !Array.isArray(folder.notes)) continue;
        for (const note of folder.notes) {
            if (!note || !note.id) continue;
            state.noteMap.set(note.id, { note, folderId: folder.id });
            mappedNoteCount += 1;
        }
    }

    // noteMap과 전체 노트 수는 같은 원본(folders)에서 함께 파생되어야 합니다.
    // folders만 갱신한 호출부가 totalNoteCount를 빠뜨려도 가상 폴더/카운터가 낡지 않도록 보장합니다.
    state.totalNoteCount = mappedNoteCount;
};

export const setState = (newState) => {
    if (!newState || typeof newState !== 'object' || Array.isArray(newState)) {
        console.warn('setState ignored an invalid state patch:', newState);
        return;
    }

    // [BUG FIX] folders 데이터가 업데이트되었는지 확인합니다.
    const foldersJustUpdated = 'folders' in newState;
    const trashJustUpdated = 'trash' in newState;
    const favoritesJustUpdated = 'favorites' in newState;

    Object.assign(state, newState);

    // [BUG FIX] folders가 변경되었다면, UI에 알리기(notify) 전에 noteMap을 먼저 재구축합니다.
    // 이렇게 하면 상태와 파생 데이터(noteMap)의 일관성이 항상 보장됩니다.
    if (foldersJustUpdated) {
        buildNoteMap();
    } else if (trashJustUpdated || favoritesJustUpdated) {
        // 휴지통/즐겨찾기 가상 폴더도 캐시를 사용하므로, 해당 원본 상태가 바뀌면 즉시 무효화합니다.
        state._virtualFolderCache = { all: null, recent: null, favorites: null, trash: null };
    }

    notify();
};

// --- 데이터 검색 헬퍼 ---
const _findNoteInState = (id) => {
    const entry = state.noteMap.get(id);
    if (!entry) return { item: null, folder: null, index: -1 };
    
    const { item: folder } = _findFolderInState(entry.folderId);
    if (!folder) return { item: null, folder: null, index: -1 };
    
    const index = folder.notes.findIndex(n => n.id === id);
    return { item: entry.note, folder, index };
};

const _findFolderInState = (id) => {
    const index = state.folders.findIndex(f => f.id === id);
    return { item: index >= 0 ? state.folders[index] : null, index };
};

const inferTrashItemType = (item) => {
    if (!item || typeof item !== 'object') return null;
    if (item.type === CONSTANTS.ITEM_TYPE.FOLDER || Array.isArray(item.notes)) return CONSTANTS.ITEM_TYPE.FOLDER;
    if (item.type === CONSTANTS.ITEM_TYPE.NOTE || 'content' in item || 'title' in item) return CONSTANTS.ITEM_TYPE.NOTE;
    return null;
};

const _findInTrash = (id, expectedType = null) => {
    const index = state.trash.findIndex(item => {
        if (!item || item.id !== id) return false;
        return !expectedType || inferTrashItemType(item) === expectedType;
    });
    return { item: index >= 0 ? state.trash[index] : null, index };
};

const _findInVirtualFolders = (id) => {
    const virtualFolderDef = Object.values(CONSTANTS.VIRTUAL_FOLDERS).find(vf => vf.id === id);
    if (!virtualFolderDef) return null;

    const cacheKey = virtualFolderDef.id.split('-')[0];
    let notes = state._virtualFolderCache[cacheKey];
    if (!notes) {
        notes = virtualFolderDef.getNotes(state);
        state._virtualFolderCache[cacheKey] = notes;
    }
    
    return { 
        item: { ...virtualFolderDef, notes, isVirtual: true }, 
        index: -1 
    };
}

const findItem = (id, type) => {
    if (!id) return { item: null, index: -1, folder: null, isInTrash: false };

    if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
        const virtualResult = _findInVirtualFolders(id);
        if (virtualResult) return { ...virtualResult, isInTrash: false };
    }

    const { item: trashedItem, index: trashIndex } = _findInTrash(id, type);
    if (trashedItem) {
        return { item: trashedItem, index: trashIndex, folder: null, isInTrash: true };
    }

    if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
        const { item, index } = _findFolderInState(id);
        return { item, index, folder: null, isInTrash: false };
    }

    if (type === CONSTANTS.ITEM_TYPE.NOTE) {
        const { item, folder, index } = _findNoteInState(id);
        return { item, index, folder, isInTrash: false };
    }

    return { item: null, index: -1, folder: null, isInTrash: false };
};

export const findFolder = (id) => findItem(id, CONSTANTS.ITEM_TYPE.FOLDER);
export const findNote = (id) => findItem(id, CONSTANTS.ITEM_TYPE.NOTE);

// --- [버그 수정] 순환 참조 해결을 위해 storage.js에서 이동 ---
/**
 * 앱의 전체 상태(활성 노트, 휴지통)를 확인하여
 * 충돌하지 않는 고유한 ID를 생성하고 반환합니다.
 */
export const generateUniqueId = (prefix, existingIds) => {
    // [안정성 강화] existingIds가 유효한 Set이 아닌 경우(undefined, null 등) 예외를 방지하기 위한 방어 코드
    const checkSet = (existingIds && typeof existingIds.has === 'function') ? existingIds : new Set();

    // crypto.randomUUID가 있으면 사용 (더 강력한 고유성)
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        let id;
        do {
            // [BUG FIX] 생성된 UUID 앞에 prefix를 일관되게 추가합니다.
            id = `${prefix}${globalThis.crypto.randomUUID()}`;
        } while (checkSet.has(id));
        return id;
    }
    
    // Fallback: 기존 방식보다 고유성을 강화
    let id;
    do {
        id = `${prefix}${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    } while (checkSet.has(id));
    
    return id;
};
