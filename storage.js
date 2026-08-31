// storage.js

// [설계 전제 / 수정 금지선]
// 이 앱은 여러 탭에서 동일한 문서를 동시에 편집하는 것 자체를 지원하지 않고, 가정하지도 않습니다.
// storage.js의 저장/로드/복구 경계는 단일 활성 문서의 데이터 무결성을 위한 것이며,
// cross-tab 동기화, 문서 컨텍스트 간 병합, localStorage lease lock, storage event 기반 조정으로 확장하지 않습니다.

// [보안 수정] 프로토타입 오염(Prototype Pollution)을 방지하기 위한 재귀적 객체 정제 함수입니다.
// 외부 JSON 데이터를 파싱한 직후 이 함수를 호출하여 '__proto__', 'constructor', 'prototype' 같은
// 위험한 키가 전역 Object 프로토타입을 오염시키는 것을 원천적으로 차단합니다.
const sanitizeObjectForPrototypePollution = (obj) => {
    if (obj === null || typeof obj !== 'object') {
        return false; // 객체가 아니면 재귀를 중단합니다.
    }

    let removedUnsafeKey = false;
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    for (const key of dangerousKeys) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            delete obj[key];
            removedUnsafeKey = true;
        }
    }

    // 객체의 모든 속성에 대해 재귀적으로 정제 함수를 호출합니다.
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            removedUnsafeKey = sanitizeObjectForPrototypePollution(obj[key]) || removedUnsafeKey;
        }
    }
    return removedUnsafeKey;
};

// [버그 수정] Chrome Storage API를 Promise 기반으로 사용하기 위한 래퍼 함수
// 브라우저/환경 간 호환성을 보장하고, chrome.runtime.lastError를 확인하여 모든 실패 사례를 처리합니다.
export const storageGet = (keys) =>
  new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve(result);
    });
  });

export const storageSet = (obj) =>
  new Promise((resolve, reject) => {
    chrome.storage.local.set(obj, () => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve();
    });
  });

export const storageRemove = (keys) =>
  new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve();
    });
  });

// [버그 수정] 순환 참조 해결을 위해 generateUniqueId를 state.js에서 가져오도록 수정합니다.
import { state, setState, buildNoteMap, CONSTANTS, generateUniqueId } from './state.js';
import { showToast, showConfirm, importFileInput, sortNotes, showAlert, showPrompt } from './components.js';
import { updateNoteCreationDates } from './itemActions.js';
// [수정] welcomeNote.js에서 환영 메시지 내용을 가져옵니다.
import { welcomeNoteContent } from './welcomeNote.js';
import { escapeHtml } from './sanitizer.js';
// [기능 추가] LunaFlowACT.js에서 노트 내용을 가져옵니다.
import { lunaFlowACTContent } from './LunaFlowACT.js';
import { withAppStateWriteLock } from './storageLock.js';
import {
    parseEmergencyBackupChanges,
    shouldDiscardEmergencyNoteUpdate,
    shouldDiscardEmergencyItemRename,
    matchesEmergencyBackupSnapshot
} from './emergencyRecoveryUtils.js';

// [기능 추가] 습관 트래커 데이터 키 상수
const HABIT_TRACKER_DATA_KEY = 'habitTrackerDataV2_integrated';
// [기능 추가] 다이어트 챌린지 데이터 키 상수
const DIET_CHALLENGE_DATA_KEY = 'diet_pro_records'; // dietChallenge.js의 STORAGE_KEY와 일치해야 함
const DIET_CHALLENGE_SETTINGS_KEY = 'diet_pro_settings'; // dietChallenge.js의 SETTINGS_KEY와 일치해야 함

// 파일 읽기·사용자 확인·적용·재시작을 하나의 가져오기 작업으로 취급합니다.
// 대용량 파일을 읽는 중 다른 파일을 다시 선택하면 두 FileReader 콜백이
// 각자의 롤백 백업과 재시작 타이머를 서로 덮어쓸 수 있으므로 single-flight로 제한합니다.
let importOperationInProgress = false;

// [CRITICAL FIX] 실제 데이터 ID가 가상 폴더 ID와 충돌하면 해당 항목을 선택/삭제/복원할 수 없게 됩니다.
// 로드/가져오기 시 폴더·노트 ID 형식과 예약 ID를 엄격히 검증해 앱 내부 참조 무결성을 보장합니다.
const RESERVED_ITEM_IDS = new Set(Object.values(CONSTANTS.VIRTUAL_FOLDERS).map(folder => folder.id));
const MAX_ITEM_ID_LENGTH = 160;

// 휴지통 항목은 구버전 백업에서 type이 없을 수 있고, 손상된 데이터에서는 type만
// 반대로 기록될 수 있습니다. type을 무조건 신뢰하면 본문이 있는 노트를 빈 폴더로
// 정규화할 수 있으므로, 실제 데이터 필드의 형태를 우선해 판별합니다.
const hasOwnDataField = (item, key) => Object.prototype.hasOwnProperty.call(item, key);
const hasFolderDataShape = item => hasOwnDataField(item, 'name') || hasOwnDataField(item, 'notes');
const hasNoteDataShape = item => hasOwnDataField(item, 'title') || hasOwnDataField(item, 'content');

const getTrashItemKind = item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;

    const hasFolderShape = hasFolderDataShape(item);
    const hasNoteShape = hasNoteDataShape(item);

    // 폴더·노트 필드가 동시에 있으면 어느 쪽이 원본인지 무손실로 판단할 수 없습니다.
    if (hasFolderShape && hasNoteShape) return 'ambiguous';
    if (hasFolderShape) return CONSTANTS.ITEM_TYPE.FOLDER;
    if (hasNoteShape) return CONSTANTS.ITEM_TYPE.NOTE;
    if (item.type === CONSTANTS.ITEM_TYPE.FOLDER) return CONSTANTS.ITEM_TYPE.FOLDER;
    if (item.type === CONSTANTS.ITEM_TYPE.NOTE) return CONSTANTS.ITEM_TYPE.NOTE;

    // [CRITICAL BUG FIX] 유형과 데이터 형태를 모두 알 수 없는 레코드를 노트로
    // 간주하면 빈 노트로 저장되면서 원래의 알 수 없는 필드가 영구 소실됩니다.
    return null;
};

// Number.isFinite만으로는 Date가 표현할 수 없는 1e300 같은 값도 통과합니다.
// 날짜 표시·정렬·달력 필터가 Invalid Date/NaN으로 오염되지 않도록 실제 Date 범위까지 확인합니다.
const toValidTimestamp = value => {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
    return Number.isNaN(new Date(timestamp).getTime()) ? null : timestamp;
};

const isReservedItemId = id => RESERVED_ITEM_IDS.has(String(id));

const normalizeFolderName = (value, fallback = '새 폴더') => {
    // 폴더 이름 입력은 길이를 제한하지 않으므로, 로드/가져오기에서도
    // 임의로 자르지 않습니다. 일치하지 않는 제한은 정상 저장된 이름을
    // 재시작·가져오기·롤백 시 조용히 손실시킬 수 있습니다.
    const normalized = String(value ?? fallback).trim();
    return normalized || fallback;
};

const getUniqueFolderName = (name, usedNameKeys) => {
    const baseName = normalizeFolderName(name);
    const baseKey = baseName.toLowerCase();
    if (!usedNameKeys.has(baseKey)) {
        usedNameKeys.add(baseKey);
        return baseName;
    }

    let counter = 2;
    while (counter < 10000) {
        const suffix = ` (${counter})`;
        const candidate = `${baseName}${suffix}`;
        const candidateKey = candidate.toLowerCase();
        if (!usedNameKeys.has(candidateKey)) {
            usedNameKeys.add(candidateKey);
            return candidate;
        }
        counter += 1;
    }

    const fallbackSuffix = ` (${Date.now()})`;
    const fallbackName = `${baseName}${fallbackSuffix}`;
    usedNameKeys.add(fallbackName.toLowerCase());
    return fallbackName;
};

const isValidItemIdForType = (id, prefix) => (
    typeof id === 'string'
    && id.length > 0
    && id.length <= MAX_ITEM_ID_LENGTH
    && id.startsWith(prefix)
    && !isReservedItemId(id)
);

const getFolderIdAfterSanitization = (folderId, folderIdUpdateMap = new Map()) => {
    if (folderId === undefined || folderId === null) return null;
    const normalizedId = String(folderId);
    // 가상 폴더 세션은 실제 폴더의 손상 ID 복구 맵과 충돌하지 않도록 그대로 유지합니다.
    return isReservedItemId(normalizedId)
        ? normalizedId
        : (folderIdUpdateMap.get(normalizedId) || normalizedId);
};


// [순환 참조 해결] generateUniqueId 함수를 state.js 파일로 이동시켰습니다.
// 이 파일에 있던 함수 정의를 완전히 삭제합니다.


// appState의 read-modify-write는 storageLock.js를 통해 현재 문서 컨텍스트 안의 비동기 작업 순서를 명확히 합니다.


// 세션 상태(활성 폴더/노트 등) 저장
// 초기화 중 임의의 중간 상태는 저장하지 않되, loadData()가 검증을 끝낸 최종 상태만 명시적으로 저장할 수 있습니다.
export const saveSession = ({ allowDuringInitialization = false } = {}) => {
    if (window.isInitializing && !allowDuringInitialization) return;
    try {
        localStorage.setItem(CONSTANTS.LS_KEY, JSON.stringify({
            f: state.activeFolderId,
            n: state.activeNoteId,
            s: state.noteSortOrder,
            l: state.lastActiveNotePerFolder
        }));
    } catch (e) {
        console.error("세션 저장 실패:", e);
    }
};


const buildDataReferenceContext = (data) => {
    const folders = Array.isArray(data?.folders) ? data.folders : [];
    const trash = Array.isArray(data?.trash) ? data.trash : [];
    const rawFavorites = data?.favorites instanceof Set
        ? Array.from(data.favorites)
        : (Array.isArray(data?.favorites) ? data.favorites : []);
    const favorites = new Set(rawFavorites.map(String));

    const noteIdsByFolder = new Map();
    const activeNoteIds = new Set();
    const trashItemIds = new Set();

    folders.forEach(folder => {
        if (!folder?.id) return;
        const folderId = String(folder.id);
        const noteIds = new Set();
        (Array.isArray(folder.notes) ? folder.notes : []).forEach(note => {
            if (!note?.id) return;
            const noteId = String(note.id);
            noteIds.add(noteId);
            activeNoteIds.add(noteId);
        });
        noteIdsByFolder.set(folderId, noteIds);
    });

    trash.forEach(item => {
        if (item?.id) trashItemIds.add(String(item.id));
    });

    return { noteIdsByFolder, activeNoteIds, trashItemIds, favorites };
};

const isValidLastActiveReference = (folderId, noteId, context) => {
    if (!folderId || !noteId) return false;

    const normalizedFolderId = String(folderId);
    const normalizedNoteId = String(noteId);

    if (context.noteIdsByFolder.has(normalizedFolderId)) {
        return context.noteIdsByFolder.get(normalizedFolderId).has(normalizedNoteId);
    }

    const { ALL, RECENT, FAVORITES, TRASH } = CONSTANTS.VIRTUAL_FOLDERS;
    if (normalizedFolderId === ALL.id || normalizedFolderId === RECENT.id) {
        return context.activeNoteIds.has(normalizedNoteId);
    }
    if (normalizedFolderId === FAVORITES.id) {
        return context.activeNoteIds.has(normalizedNoteId) && context.favorites.has(normalizedNoteId);
    }
    if (normalizedFolderId === TRASH.id) {
        return context.trashItemIds.has(normalizedNoteId);
    }
    return false;
};

const sanitizeLastActiveNoteMap = (rawMap, data, idUpdateMaps = {}, markChanged = null) => {
    const sourceMap = rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap) ? rawMap : {};
    if (sourceMap !== rawMap && typeof markChanged === 'function') markChanged();

    // 과거 호출부의 단일 Map도 허용하되, 새 경로에서는 폴더/노트 ID 맵을 분리해
    // 서로 다른 유형이 같은 손상 ID를 가진 경우에도 참조를 정확히 복구합니다.
    const legacyMap = idUpdateMaps instanceof Map ? idUpdateMaps : null;
    const folderIdUpdateMap = legacyMap || idUpdateMaps.folderIdUpdateMap || new Map();
    const noteIdUpdateMap = legacyMap || idUpdateMaps.noteIdUpdateMap || new Map();

    const context = buildDataReferenceContext(data);
    const cleaned = Object.create(null);

    for (const [folderId, noteId] of Object.entries(sourceMap)) {
        const normalizedFolderId = String(folderId);
        const normalizedNoteId = String(noteId);
        const newFolderId = getFolderIdAfterSanitization(normalizedFolderId, folderIdUpdateMap);
        const newNoteId = noteIdUpdateMap.get(normalizedNoteId) || normalizedNoteId;
        if (isValidLastActiveReference(newFolderId, newNoteId, context)) {
            cleaned[newFolderId] = newNoteId;
        } else if (typeof markChanged === 'function') {
            markChanged();
        }
    }

    return cleaned;
};

const parseSimplenoteTimestamp = (value, fallback) => {
    // 숫자형 Unix 타임스탬프는 Date 문자열 파싱보다 먼저 판별해야 합니다.
    // 그렇지 않으면 초 단위 값이 밀리초로 해석되어 1970년 날짜가 됩니다.
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
        return toValidTimestamp(numeric < 100000000000 ? numeric * 1000 : numeric) ?? fallback;
    }
    const parsed = new Date(value).getTime();
    return toValidTimestamp(parsed) ?? fallback;
};

const createUnrecoverableAppStateError = message => {
    const error = new Error(message);
    error.name = 'UnrecoverableAppStateError';
    return error;
};

/**
 * [CRITICAL FIX] 로드된 데이터의 무결성을 검증하고, 손상된 배열/객체/ID 참조를 자동 복구합니다.
 * 일반 폴더는 type 필드가 없으므로 notes 배열을 기준으로도 폴더를 판별합니다.
 * @param {object} data - chrome.storage.local에서 로드한 appState 객체
 * @returns {{sanitizedData: object, wasSanitized: boolean, shouldNotify: boolean, isTopLevelInvalid: boolean, idUpdateMap: Map<string, string>, folderIdUpdateMap: Map<string, string>, noteIdUpdateMap: Map<string, string>}}
 */
export const verifyAndSanitizeLoadedData = (data) => {
    const emptyMaps = {
        idUpdateMap: new Map(),
        folderIdUpdateMap: new Map(),
        noteIdUpdateMap: new Map()
    };
    const now = Date.now();
    const createEmptySanitizedAppState = () => ({
        folders: [],
        trash: [],
        favorites: [],
        lastActiveNotePerFolder: {},
        activeFolderId: CONSTANTS.VIRTUAL_FOLDERS.ALL.id,
        activeNoteId: null,
        lastSavedTimestamp: now
    });
    const createInvalidStructureResult = () => ({
        sanitizedData: createEmptySanitizedAppState(),
        wasSanitized: true,
        shouldNotify: true,
        isTopLevelInvalid: true,
        ...emptyMaps
    });

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        console.warn('[Data Sanitization] Invalid top-level appState was detected. A non-persistable safe placeholder was created for validation only.');
        return createInvalidStructureResult();
    }

    // [CRITICAL FIX] 사용자 데이터를 담는 배열 자체나 그 안의 레코드가 손상된 경우,
    // 빈 배열로 정규화한 뒤 원본에 덮어쓰면 노트·휴지통 데이터가 영구 소실됩니다.
    // 손실 없이 복구할 수 없는 구조는 저장 가능한 정제본으로 취급하지 않고 원본을 보존합니다.
    const hasOwn = (target, key) => Object.prototype.hasOwnProperty.call(target, key);
    const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    const hasLossyTextField = (record, key) => (
        hasOwn(record, key)
        && record[key] !== null
        && typeof record[key] === 'object'
    );
    const hasInvalidNoteRecord = note => (
        !isRecord(note)
        || hasFolderDataShape(note)
        || hasLossyTextField(note, 'title')
        || hasLossyTextField(note, 'content')
    );
    const hasInvalidOptionalArray = key => hasOwn(data, key) && !Array.isArray(data[key]);
    const hasInvalidNoteCollection = folder => (
        hasOwn(folder, 'notes')
        && (!Array.isArray(folder.notes) || folder.notes.some(hasInvalidNoteRecord))
    );
    const hasInvalidFolderRecords = Array.isArray(data.folders) && data.folders.some(folder => (
        !isRecord(folder)
        || hasNoteDataShape(folder)
        || hasLossyTextField(folder, 'name')
        || hasInvalidNoteCollection(folder)
    ));
    const hasInvalidTrashRecords = Array.isArray(data.trash) && data.trash.some(item => {
        if (!isRecord(item)) return true;
        const itemKind = getTrashItemKind(item);
        if (!itemKind || itemKind === 'ambiguous') return true;
        return itemKind === CONSTANTS.ITEM_TYPE.FOLDER
            ? hasLossyTextField(item, 'name') || hasInvalidNoteCollection(item)
            : hasInvalidNoteRecord(item);
    });
    const hasUnrecoverableDataStructure = (
        !Array.isArray(data.folders)
        || hasInvalidOptionalArray('trash')
        || hasInvalidOptionalArray('favorites')
        || hasInvalidFolderRecords
        || hasInvalidTrashRecords
    );

    if (hasUnrecoverableDataStructure) {
        console.warn('[Data Sanitization] A malformed data container or record was detected. Automatic persistence was blocked to preserve the original appState.');
        return createInvalidStructureResult();
    }

    const unsafePrototypeKeysRemoved = sanitizeObjectForPrototypePollution(data);
    if (unsafePrototypeKeysRemoved) {
        console.warn('[Data Sanitization] Unsafe prototype-pollution keys were removed from appState.');
    }

    const folderIdUpdateMap = new Map();
    const noteIdUpdateMap = new Map();
    const seenOriginalFolderIds = new Set();
    const seenOriginalNoteIds = new Set();
    const usedIds = new Set(RESERVED_ITEM_IDS);
    let changesMade = false;
    let notifyChangesMade = false;

    const markChanged = (shouldNotify = true) => {
        changesMade = true;
        if (shouldNotify) notifyChangesMade = true;
    };
    const markMinorChanged = () => markChanged(false);
    const assignNormalizedValue = (target, key, value) => {
        if (!Object.is(target[key], value)) markMinorChanged();
        target[key] = value;
        return value;
    };
    if (unsafePrototypeKeysRemoved) markChanged();
    const ensureArray = (value) => {
        if (Array.isArray(value)) return value;
        // 누락된 필드도 메모리에만 기본값을 만들고 끝내면 다음 트랜잭션이 원본 손상 값을
        // 다시 읽습니다. 알림은 생략하되 정제본은 반드시 저장 대상으로 표시합니다.
        markChanged(value !== undefined);
        return [];
    };
    const ensureObject = (value) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
        markMinorChanged();
        return {};
    };
    const normalizeText = (value, fallback) => {
        const text = String(value ?? fallback ?? '').trim();
        return text;
    };
    const normalizeTimestamp = (value, fallback = now, shouldNotify = true) => {
        const timestamp = toValidTimestamp(value);
        if (timestamp !== null) return timestamp;
        markChanged(shouldNotify);
        return fallback;
    };

    const normalizeId = (item, prefix, itemType) => {
        const oldId = item.id === undefined || item.id === null ? '' : String(item.id);
        const isFolder = itemType === CONSTANTS.ITEM_TYPE.FOLDER;
        const seenIds = isFolder ? seenOriginalFolderIds : seenOriginalNoteIds;
        const updateMap = isFolder ? folderIdUpdateMap : noteIdUpdateMap;
        const wasSeenInSameType = Boolean(oldId && seenIds.has(oldId));
        const hasUnsafeFormat = !isValidItemIdForType(oldId, prefix);
        const collidesGlobally = Boolean(oldId && usedIds.has(oldId));
        let finalId = oldId;

        if (hasUnsafeFormat || collidesGlobally) {
            finalId = generateUniqueId(prefix, usedIds);
            item.id = finalId;

            // 다른 유형과 충돌한 첫 항목은 유형별 참조 맵으로 정확히 추적합니다.
            // 같은 유형 안의 중복은 어느 항목을 뜻하는지 모호하므로 첫 항목을 기준으로 유지합니다.
            if (oldId && !wasSeenInSameType && !updateMap.has(oldId)) {
                updateMap.set(oldId, finalId);
            }

            markChanged();
            console.warn(`[Data Sanitization] Unsafe, reserved, or duplicate ID fixed on load: ${oldId || '(empty)'} -> ${finalId}`);
        } else if (item.id !== finalId) {
            // 숫자형 등 문자열이 아닌 ID는 실제 데이터에도 문자열로 기록해 strict 비교 실패를 막습니다.
            item.id = finalId;
            markMinorChanged();
        }

        if (oldId) seenIds.add(oldId);
        usedIds.add(finalId);
        return finalId;
    };

    data.folders = ensureArray(data.folders);
    data.trash = ensureArray(data.trash);
    data.favorites = ensureArray(data.favorites);
    data.lastActiveNotePerFolder = ensureObject(data.lastActiveNotePerFolder);

    const normalizeNote = (rawNote, isTrash = false) => {
        if (!rawNote || typeof rawNote !== 'object' || Array.isArray(rawNote)) {
            markChanged();
            return null;
        }

        const note = rawNote;
        normalizeId(note, CONSTANTS.ID_PREFIX.NOTE, CONSTANTS.ITEM_TYPE.NOTE);
        assignNormalizedValue(note, 'title', normalizeText(note.title, '제목 없음') || '제목 없음');
        assignNormalizedValue(note, 'content', String(note.content ?? ''));
        assignNormalizedValue(note, 'createdAt', normalizeTimestamp(note.createdAt));
        assignNormalizedValue(note, 'updatedAt', normalizeTimestamp(note.updatedAt, note.createdAt));
        assignNormalizedValue(note, 'isPinned', Boolean(note.isPinned));

        if (isTrash) {
            assignNormalizedValue(note, 'type', CONSTANTS.ITEM_TYPE.NOTE);
            assignNormalizedValue(note, 'deletedAt', normalizeTimestamp(note.deletedAt, now, false));
            if (note.originalFolderId !== undefined && note.originalFolderId !== null) {
                assignNormalizedValue(note, 'originalFolderId', String(note.originalFolderId));
            }
            if ('wasFavorite' in note) assignNormalizedValue(note, 'wasFavorite', Boolean(note.wasFavorite));
        } else if (note.type !== undefined) {
            delete note.type;
            markChanged(false);
        }
        return note;
    };

    const normalizeFolder = (rawFolder, isTrash = false) => {
        if (!rawFolder || typeof rawFolder !== 'object' || Array.isArray(rawFolder)) {
            markChanged();
            return null;
        }

        const folder = rawFolder;
        normalizeId(folder, CONSTANTS.ID_PREFIX.FOLDER, CONSTANTS.ITEM_TYPE.FOLDER);
        assignNormalizedValue(folder, 'name', normalizeFolderName(folder.name));
        assignNormalizedValue(folder, 'createdAt', normalizeTimestamp(folder.createdAt));
        assignNormalizedValue(folder, 'updatedAt', normalizeTimestamp(folder.updatedAt, folder.createdAt));

        const rawNotes = ensureArray(folder.notes);
        folder.notes = rawNotes
            .map(note => normalizeNote(note, isTrash))
            .filter(Boolean);

        if (isTrash) {
            assignNormalizedValue(folder, 'type', CONSTANTS.ITEM_TYPE.FOLDER);
            assignNormalizedValue(folder, 'deletedAt', normalizeTimestamp(folder.deletedAt, now, false));
        } else if (folder.type !== undefined) {
            delete folder.type;
            markChanged(false);
        }
        return folder;
    };

    data.folders = data.folders
        .map(folder => normalizeFolder(folder, false))
        .filter(Boolean);

    const usedActiveFolderNameKeys = new Set();
    data.folders.forEach(folder => {
        const uniqueName = getUniqueFolderName(folder.name, usedActiveFolderNameKeys);
        if (folder.name !== uniqueName) {
            console.warn(`[Data Sanitization] Duplicate folder name fixed on load: ${folder.name} -> ${uniqueName}`);
            folder.name = uniqueName;
            folder.updatedAt = Math.max(Number(folder.updatedAt) || now, now);
            markChanged();
        }
    });

    data.trash = data.trash
        .map(item => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                markChanged();
                return null;
            }
            const itemKind = getTrashItemKind(item);
            return itemKind === CONSTANTS.ITEM_TYPE.FOLDER
                ? normalizeFolder(item, true)
                : normalizeNote(item, true);
        })
        .filter(Boolean);

    const activeNoteIds = new Set();
    data.folders.forEach(folder => folder.notes.forEach(note => activeNoteIds.add(String(note.id))));

    // 즐겨찾기는 노트 ID 맵만 적용해야 폴더/노트 간 손상 ID 충돌에서도 잘못된 유형으로 이동하지 않습니다.
    const originalFavorites = data.favorites;
    const normalizedFavorites = Array.from(new Set(originalFavorites
        .map(id => {
            const normalizedId = String(id);
            return noteIdUpdateMap.get(normalizedId) || normalizedId;
        })
        .filter(id => activeNoteIds.has(id))));
    if (normalizedFavorites.length !== originalFavorites.length
        || normalizedFavorites.some((id, index) => !Object.is(id, originalFavorites[index]))) {
        markMinorChanged();
    }
    data.favorites = normalizedFavorites;

    data.trash.forEach(item => {
        const applyOriginalFolderFix = (note) => {
            if (note?.originalFolderId !== undefined && note.originalFolderId !== null) {
                const normalizedId = String(note.originalFolderId);
                assignNormalizedValue(note, 'originalFolderId', folderIdUpdateMap.get(normalizedId) || normalizedId);
            }
        };
        if (item?.type === CONSTANTS.ITEM_TYPE.FOLDER) item.notes.forEach(applyOriginalFolderFix);
        else applyOriginalFolderFix(item);
    });

    const typedIdMaps = { folderIdUpdateMap, noteIdUpdateMap };
    // 실제 폴더뿐 아니라 가상 폴더 세션도 정상 참조로 인정합니다.
    data.lastActiveNotePerFolder = sanitizeLastActiveNoteMap(
        data.lastActiveNotePerFolder,
        data,
        typedIdMaps,
        markMinorChanged
    );

    if (data.activeFolderId !== undefined && data.activeFolderId !== null) {
        assignNormalizedValue(data, 'activeFolderId', getFolderIdAfterSanitization(data.activeFolderId, folderIdUpdateMap));
    }
    if (data.activeNoteId !== undefined && data.activeNoteId !== null) {
        const normalizedId = String(data.activeNoteId);
        assignNormalizedValue(data, 'activeNoteId', noteIdUpdateMap.get(normalizedId) || normalizedId);
    }
    assignNormalizedValue(data, 'lastSavedTimestamp', normalizeTimestamp(data.lastSavedTimestamp, now, false));

    // 기존 단일 맵 소비자를 위한 호환 맵입니다. 두 유형에서 동시에 쓰인 원본 ID는 모호하므로 제외합니다.
    const idUpdateMap = new Map();
    folderIdUpdateMap.forEach((newId, oldId) => {
        if (!seenOriginalNoteIds.has(oldId)) idUpdateMap.set(oldId, newId);
    });
    noteIdUpdateMap.forEach((newId, oldId) => {
        if (!seenOriginalFolderIds.has(oldId)) idUpdateMap.set(oldId, newId);
    });

    return {
        sanitizedData: data,
        wasSanitized: changesMade,
        shouldNotify: notifyChangesMade,
        isTopLevelInvalid: false,
        idUpdateMap,
        folderIdUpdateMap,
        noteIdUpdateMap
    };
};

// [아키텍처 리팩토링] loadData에서 localStorage 기반 비상 백업 복구 로직을 완전히 제거하고,
// chrome.storage.local을 유일한 데이터 소스로 사용하도록 단순화합니다.
export const loadData = async () => {
    let recoveryMessage = null;
    let authoritativeData = null; // [버그 수정] 데이터 로딩 순서 제어를 위해 변수 위치 변경
    // 손상 ID 복구 시 폴더와 노트 참조를 서로 다른 맵으로 추적합니다.
    let folderIdUpdateMap = new Map();
    let noteIdUpdateMap = new Map();

    try {
        // 미완료 가져오기 복구는 같은 appState 저장 경계 안에서 판정·복원·정리합니다.
        // 목적은 초기화/복구 경로의 데이터 무결성을 지키는 것입니다.
        const importRecoveryMessage = await withAppStateWriteLock(async () => {
            const importStatus = localStorage.getItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
            const backupResult = await storageGet('appState_backup');
            const backupPayload = backupResult.appState_backup;

            if (importStatus === 'done') {
                if (backupPayload) {
                    // [CRITICAL BUG FIX] 완료 플래그는 저장 순서만 나타낼 뿐, 실제 appState의
                    // 무결성을 보장하지 않습니다. 가져온 데이터를 검증하기 전에 롤백 백업을
                    // 삭제하면 누락·손상된 결과만 남아 이전 노트를 복구할 수 없습니다.
                    const importedResult = await storageGet('appState');
                    const hasImportedAppState = Object.prototype.hasOwnProperty.call(importedResult, 'appState')
                        && importedResult.appState !== null
                        && importedResult.appState !== undefined;
                    const verification = hasImportedAppState
                        ? verifyAndSanitizeLoadedData(JSON.parse(JSON.stringify(importedResult.appState)))
                        : null;

                    if (!verification || verification.isTopLevelInvalid) {
                        console.warn('Completed import data failed integrity validation. Rolling back to the previous data.');
                        await restoreImportBackupPayload(backupPayload);
                        await storageRemove('appState_backup');
                        localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
                        return '가져온 데이터의 무결성 검사에 실패하여, 가져오기 이전 데이터로 안전하게 복구했습니다.';
                    }

                    // 복구 가능한 ID·메타데이터 문제는 백업을 버리기 전에 영구 저장합니다.
                    // 이 저장이 실패하면 예외가 전파되어 백업과 완료 플래그가 다음 재시도용으로 남습니다.
                    if (verification.wasSanitized) {
                        await storageSet({ appState: verification.sanitizedData });
                    }
                    await storageRemove('appState_backup');
                }
                // 성공 후 백업만 먼저 지워진 경우에도 완료 플래그가 영구히 남지 않게 정리합니다.
                localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
                return backupPayload ? CONSTANTS.MESSAGES.SUCCESS.IMPORT_SUCCESS : null;
            }

            if (importStatus === 'true' && backupPayload) {
                console.warn('Incomplete import detected. Rolling back to previous data.');
                // 롤백은 가져오기 직전 스냅샷을 그대로 복원해야 합니다. 복원 과정에서
                // 정제된 빈 상태로 바꾸면 손상 원본을 유일한 복구 사본까지 잃을 수 있습니다.
                await restoreImportBackupPayload(backupPayload);

                await storageRemove('appState_backup');
                localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
                return '데이터 가져오기 작업이 비정상적으로 종료되어, 이전 데이터로 안전하게 복구했습니다.';
            }

            if (importStatus === 'true' && !backupPayload) {
                console.warn("Inconsistent import state detected: flag is 'true' but no backup exists.");
                localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
                return '이전 데이터 가져오기 작업이 비정상적으로 중단되었습니다. 작업을 다시 시도해주세요.';
            }

            return null;
        });

        if (importRecoveryMessage) recoveryMessage = importRecoveryMessage;

        // 2. 주 저장소를 단일 활성 문서의 저장 경계 안에서 읽고, 무결성 보정이 필요하면 같은 경계 안에서 저장합니다.
        // 현재 문서 컨텍스트 안의 연속 작업 간 read-modify-write 안정성을 위한 처리입니다.
        const loadedResult = await withAppStateWriteLock(async () => {
            const mainStorageResult = await storageGet('appState');
            const hasStoredAppState = Object.prototype.hasOwnProperty.call(mainStorageResult, 'appState')
                && mainStorageResult.appState !== null
                && mainStorageResult.appState !== undefined;
            let loadedData = hasStoredAppState ? mainStorageResult.appState : null;
            let loadedFolderIdUpdateMap = new Map();
            let loadedNoteIdUpdateMap = new Map();
            let shouldShowRecoveryNotice = false;

            if (hasStoredAppState) {
                const verification = verifyAndSanitizeLoadedData(JSON.parse(JSON.stringify(loadedData)));
                if (verification.isTopLevelInvalid) {
                    throw createUnrecoverableAppStateError('저장된 노트 데이터의 최상위 구조가 손상되었습니다. 원본을 보존하기 위해 자동 초기화를 중단했습니다.');
                }
                loadedData = verification.sanitizedData;
                loadedFolderIdUpdateMap = verification.folderIdUpdateMap;
                loadedNoteIdUpdateMap = verification.noteIdUpdateMap;
                shouldShowRecoveryNotice = verification.shouldNotify;

                if (verification.wasSanitized) {
                    await storageSet({ appState: loadedData });
                    console.log('Sanitized data has been saved back to storage.');
                }
            }

            return {
                loadedData,
                loadedFolderIdUpdateMap,
                loadedNoteIdUpdateMap,
                shouldShowRecoveryNotice
            };
        });

        authoritativeData = loadedResult.loadedData;
        folderIdUpdateMap = loadedResult.loadedFolderIdUpdateMap;
        noteIdUpdateMap = loadedResult.loadedNoteIdUpdateMap;
        if (loadedResult.shouldShowRecoveryNotice) {
            const sanitizationMessage = '데이터 무결성 검사 중 문제를 발견하여 자동 복구했습니다. 앱이 정상적으로 동작합니다.';
            recoveryMessage = recoveryMessage ? `${recoveryMessage}\n${sanitizationMessage}` : sanitizationMessage;
        }

        // --- BUG-C-02 FIX START ---
        // 비정상 종료 데이터 복구 로직 (안전한 '변경사항' 기반 복구)
        const emergencyBackupJSON = localStorage.getItem(CONSTANTS.LS_KEY_EMERGENCY_CHANGES_BACKUP);
        if (emergencyBackupJSON) {
            let emergencyBackupValidated = false;
            let emergencyBackupRemoved = false;
            let expectedEmergencyBackupJSON = emergencyBackupJSON;
            const persistEmergencyBackupSnapshot = backupChanges => {
                const currentBackupJSON = localStorage.getItem(CONSTANTS.LS_KEY_EMERGENCY_CHANGES_BACKUP);
                if (currentBackupJSON !== expectedEmergencyBackupJSON) {
                    throw new Error('복구를 준비하는 동안 더 최신 비상 백업이 기록되어 기존 복구 작업을 중단했습니다.');
                }

                const nextBackupJSON = JSON.stringify(backupChanges);
                localStorage.setItem(CONSTANTS.LS_KEY_EMERGENCY_CHANGES_BACKUP, nextBackupJSON);
                expectedEmergencyBackupJSON = nextBackupJSON;
                emergencyBackupRemoved = false;
            };
            const removeEmergencyBackup = () => {
                const currentBackupJSON = localStorage.getItem(CONSTANTS.LS_KEY_EMERGENCY_CHANGES_BACKUP);
                if (currentBackupJSON !== expectedEmergencyBackupJSON) {
                    throw new Error('복구 처리 중 갱신된 최신 비상 백업은 삭제하지 않았습니다.');
                }
                localStorage.removeItem(CONSTANTS.LS_KEY_EMERGENCY_CHANGES_BACKUP);
                expectedEmergencyBackupJSON = null;
                emergencyBackupRemoved = true;
            };

            try {
                const backupChanges = parseEmergencyBackupChanges(emergencyBackupJSON);
                emergencyBackupValidated = true;
                
                // --- [버그 수정 시작] ---
                // 비상 복구를 실행하기 전에, 데이터 정제 과정에서 변경된 ID가 있다면 비상 백업 데이터의 ID를 먼저 업데이트합니다.
                // 이렇게 하지 않으면, ID가 변경된 노트를 찾지 못해 복구가 실패할 수 있습니다.
                if (folderIdUpdateMap.size > 0 || noteIdUpdateMap.size > 0) {
                    console.log("Applying typed ID updates from sanitization to emergency backup data before restoration.");
                    if (backupChanges.noteUpdate?.noteId) {
                        const oldNoteId = String(backupChanges.noteUpdate.noteId);
                        backupChanges.noteUpdate.noteId = noteIdUpdateMap.get(oldNoteId) || oldNoteId;
                        if (oldNoteId !== backupChanges.noteUpdate.noteId) {
                            console.warn(`Emergency backup noteId was updated due to sanitization: ${oldNoteId} -> ${backupChanges.noteUpdate.noteId}`);
                        }
                    }
                    if (backupChanges.itemRename?.id) {
                        const oldItemId = String(backupChanges.itemRename.id);
                        const renameMap = backupChanges.itemRename.type === CONSTANTS.ITEM_TYPE.FOLDER
                            ? folderIdUpdateMap
                            : noteIdUpdateMap;
                        backupChanges.itemRename.id = renameMap.get(oldItemId) || oldItemId;
                        if (oldItemId !== backupChanges.itemRename.id) {
                            console.warn(`Emergency backup rename itemId was updated due to sanitization: ${oldItemId} -> ${backupChanges.itemRename.id}`);
                        }
                    }
                }
                // --- [버그 수정 끝] ---

                const findNoteForEmergencyRecovery = (noteId, data) => {
                    const normalizedNoteId = String(noteId ?? '');
                    if (!normalizedNoteId || !data) return null;

                    const activeFolders = Array.isArray(data.folders) ? data.folders : [];
                    for (const folder of activeFolders) {
                        const note = (Array.isArray(folder.notes) ? folder.notes : [])
                            .find(item => String(item?.id ?? '') === normalizedNoteId);
                        if (note) return note;
                    }

                    const trashItems = Array.isArray(data.trash) ? data.trash : [];
                    for (const item of trashItems) {
                        if (String(item?.id ?? '') === normalizedNoteId && (!Array.isArray(item?.notes) || item.type === CONSTANTS.ITEM_TYPE.NOTE)) {
                            return item;
                        }
                        const nestedNote = Array.isArray(item?.notes)
                            ? item.notes.find(note => String(note?.id ?? '') === normalizedNoteId)
                            : null;
                        if (nestedNote) return nestedNote;
                    }

                    return null;
                };

                const findItemForEmergencyRecovery = (id, type, data) => {
                    const normalizedId = String(id ?? '');
                    if (!normalizedId || !data) return null;

                    if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
                        const activeFolders = Array.isArray(data.folders) ? data.folders : [];
                        const trashItems = Array.isArray(data.trash) ? data.trash : [];
                        return activeFolders.find(folder => String(folder?.id ?? '') === normalizedId)
                            || trashItems.find(item =>
                                String(item?.id ?? '') === normalizedId
                                && (item.type === CONSTANTS.ITEM_TYPE.FOLDER || Array.isArray(item?.notes))
                            )
                            || null;
                    }

                    return findNoteForEmergencyRecovery(normalizedId, data);
                };

                if (backupChanges.noteUpdate) {
                    const recoveryTarget = findNoteForEmergencyRecovery(backupChanges.noteUpdate.noteId, authoritativeData);
                    if (!recoveryTarget) {
                        console.warn('Emergency backup note target no longer exists. Dropping stale note recovery entry.');
                        delete backupChanges.noteUpdate;
                    } else if (shouldDiscardEmergencyNoteUpdate(backupChanges.noteUpdate, recoveryTarget)) {
                        console.warn('Emergency backup note entry is already saved or older than the committed note. Dropping stale recovery entry.');
                        delete backupChanges.noteUpdate;
                    }
                }
                if (backupChanges.itemRename) {
                    const recoveryTarget = findItemForEmergencyRecovery(
                        backupChanges.itemRename.id,
                        backupChanges.itemRename.type,
                        authoritativeData
                    );
                    if (!recoveryTarget) {
                        console.warn('Emergency backup rename target no longer exists. Dropping stale rename recovery entry.');
                        delete backupChanges.itemRename;
                    } else if (shouldDiscardEmergencyItemRename(backupChanges.itemRename, recoveryTarget)) {
                        console.warn('Emergency backup rename entry is already saved or older than the committed item. Dropping stale recovery entry.');
                        delete backupChanges.itemRename;
                    }
                }

                if (!backupChanges.noteUpdate && !backupChanges.itemRename) {
                    removeEmergencyBackup();
                    console.warn('Emergency backup had no applicable changes and was removed to prevent repeated recovery prompts.');
                } else {
                    // 데이터 정제에서 바뀐 ID와 위에서 제거한 오래된 항목을 복구 프롬프트 전에
                    // 원본 백업에도 반영합니다. 이 쓰기가 없으면 이번 복구 저장이 실패한 뒤 다음
                    // 실행에서는 이미 보정된 appState와 과거 ID의 백업을 다시 연결할 수 없습니다.
                    persistEmergencyBackupSnapshot(backupChanges);

                    let confirmMessage = "탭이 비정상적으로 종료되기 전, 저장되지 않은 변경사항이 발견되었습니다.<br><br>";
                    
                    if(backupChanges.noteUpdate) {
                        const safeTitle = escapeHtml(String(backupChanges.noteUpdate.title ?? '').slice(0, 20));
                        confirmMessage += `<strong>📝 노트 수정:</strong> '${safeTitle}...'<br>`;
                    }
                    if(backupChanges.itemRename) {
                        const itemTypeStr = backupChanges.itemRename.type === 'folder' ? '📁 폴더' : '📝 노트';
                        const safeNewName = escapeHtml(String(backupChanges.itemRename.newName ?? '').slice(0, 20));
                        confirmMessage += `<strong>✏️ 이름 변경:</strong> ${itemTypeStr} → '${safeNewName}...'<br>`;
                    }
                    confirmMessage += "<br>이 변경사항을 복원하시겠습니까?";

                    const userConfirmed = await showConfirm({
                        title: '📝 저장되지 않은 변경사항 복원',
                        message: confirmMessage,
                        isHtml: true,
                        confirmText: '✅ 예, 복원합니다',
                        cancelText: '❌ 아니요, 버립니다'
                    });

                    if (userConfirmed) {
                        // --- [CRITICAL BUG FIX] START ---
                        // 트랜잭션 실행 전, 이름 변경 충돌을 미리 확인하고 사용자에게 해결을 요청합니다.
                        if (backupChanges.itemRename) {
                            const { id, type, newName } = backupChanges.itemRename;
                            const foldersToCheck = authoritativeData?.folders || [];
                            const isConflict = foldersToCheck.some(f => 
                                (type === 'folder' && f.id !== id && f.name.toLowerCase() === newName.toLowerCase())
                            );

                            if (isConflict) {
                                const resolvedName = await showPrompt({
                                    title: '✏️ 이름 충돌 해결',
                                    message: CONSTANTS.MESSAGES.ERROR.RENAME_CONFLICT_ON_RECOVERY(newName),
                                    initialValue: `${newName} (복사본)`,
                                    validationFn: (value) => {
                                        const trimmedValue = value.trim();
                                        if (!trimmedValue) return { isValid: false, message: CONSTANTS.MESSAGES.ERROR.EMPTY_NAME_ERROR };
                                        if (foldersToCheck.some(f => f.name.toLowerCase() === trimmedValue.toLowerCase())) {
                                            return { isValid: false, message: CONSTANTS.MESSAGES.ERROR.FOLDER_EXISTS(trimmedValue) };
                                        }
                                        return { isValid: true };
                                    }
                                });

                                if (resolvedName) {
                                    // 사용자가 새 이름을 입력하면 백업 객체를 수정하여 복원을 계속합니다.
                                    backupChanges.itemRename.newName = resolvedName.trim();
                                } else {
                                    // 사용자가 취소하면 이름 변경 복원만 제외하고 나머지는 계속 진행합니다.
                                    showToast(CONSTANTS.MESSAGES.ERROR.RENAME_RECOVERY_CANCELED, CONSTANTS.TOAST_TYPE.ERROR);
                                    delete backupChanges.itemRename;
                                }
                            }
                        }
                        // --- [CRITICAL BUG FIX] END ---

                        if (!backupChanges.noteUpdate && !backupChanges.itemRename) {
                            removeEmergencyBackup();
                            showToast('복원할 수 있는 변경사항이 없어 비상 백업을 정리했습니다.', CONSTANTS.TOAST_TYPE.SUCCESS);
                        } else {
                            // 충돌 해결로 이름이 바뀌거나 한 항목의 복원을 취소한 결과도 즉시
                            // 백업에 반영해, 뒤이은 Storage 오류에서도 다음 실행이 같은 상태로 재시도하게 합니다.
                            persistEmergencyBackupSnapshot(backupChanges);

                            const recoverySnapshots = {
                                noteUpdate: backupChanges.noteUpdate ? { ...backupChanges.noteUpdate } : null,
                                itemRename: backupChanges.itemRename ? { ...backupChanges.itemRename } : null
                            };
                            const recoveryOutcome = {
                                noteUpdate: recoverySnapshots.noteUpdate ? 'pending' : 'not-requested',
                                itemRename: recoverySnapshots.itemRename ? 'pending' : 'not-requested'
                            };
                            const { performTransactionalUpdate, clearEmergencyChangesBackupEntry } = await import('./itemActions.js');
                            const transactionResult = await performTransactionalUpdate(latestData => {
                                const now = Date.now();
                                let changesApplied = false;
                                // 한 복구 묶음의 앞선 변경이 updatedAt을 갱신해 뒤 항목의
                                // 오래됨 판정을 왜곡하지 않도록, 모든 판정은 커밋 직전 상태의
                                // 읽기 전용 스냅샷을 기준으로 수행합니다.
                                const renameTargetBeforeRecovery = recoverySnapshots.itemRename
                                    ? findItemForEmergencyRecovery(
                                        recoverySnapshots.itemRename.id,
                                        recoverySnapshots.itemRename.type,
                                        latestData
                                    )
                                    : null;
                                const renameTargetSnapshot = renameTargetBeforeRecovery
                                    ? { ...renameTargetBeforeRecovery }
                                    : null;

                                // 1. 노트 내용 업데이트 복원
                                // [CRITICAL BUG FIX] 비상 복구 대상 검증은 활성 폴더와 휴지통을 모두 인정하지만,
                                // 실제 적용은 활성 폴더만 검색하고 있어 휴지통으로 이동된 노트의 미저장 내용이 사라질 수 있었습니다.
                                // 활성 폴더, 휴지통 최상위 노트, 휴지통 폴더 내부 노트까지 동일하게 복구합니다.
                                if (recoverySnapshots.noteUpdate) {
                                    const { noteId, title, content } = recoverySnapshots.noteUpdate;
                                    const normalizedNoteId = String(noteId ?? '');
                                    let noteToUpdate = null;
                                    let parentFolder = null;

                                    for (const folder of latestData.folders) {
                                        const note = (Array.isArray(folder.notes) ? folder.notes : []).find(n => String(n?.id ?? '') === normalizedNoteId);
                                        if (note) {
                                            noteToUpdate = note;
                                            parentFolder = folder;
                                            break;
                                        }
                                    }

                                    if (!noteToUpdate) {
                                        for (const trashItem of latestData.trash) {
                                            const isTopLevelTrashNote = String(trashItem?.id ?? '') === normalizedNoteId
                                                && (!Array.isArray(trashItem?.notes) || trashItem.type === CONSTANTS.ITEM_TYPE.NOTE);
                                            if (isTopLevelTrashNote) {
                                                noteToUpdate = trashItem;
                                                break;
                                            }

                                            if (Array.isArray(trashItem?.notes)) {
                                                const noteInTrashFolder = trashItem.notes.find(n => String(n?.id ?? '') === normalizedNoteId);
                                                if (noteInTrashFolder) {
                                                    noteToUpdate = noteInTrashFolder;
                                                    parentFolder = trashItem;
                                                    break;
                                                }
                                            }
                                        }
                                    }

                                    if (!noteToUpdate) {
                                        recoveryOutcome.noteUpdate = 'missing';
                                    } else if (shouldDiscardEmergencyNoteUpdate(recoverySnapshots.noteUpdate, noteToUpdate)) {
                                        // 확인 모달을 기다리는 동안 먼저 시작된 저장이 끝났을 수 있습니다.
                                        // 실제 커밋 기준 상태에서 다시 검사해 최신 저장본을 과거 초안으로 되돌리지 않습니다.
                                        recoveryOutcome.noteUpdate = 'stale';
                                    } else {
                                        noteToUpdate.title = String(title ?? '');
                                        noteToUpdate.content = String(content ?? '');
                                        noteToUpdate.updatedAt = now;
                                        if (parentFolder) parentFolder.updatedAt = now;
                                        recoveryOutcome.noteUpdate = 'applied';
                                        changesApplied = true;
                                    }
                                }

                                // [CRITICAL BUG FIX & COMMENT FIX] 2. 이름 변경 복원 (활성 폴더 및 휴지통 모두 검색)
                                if (recoverySnapshots.itemRename) {
                                    const { id, type, newName } = recoverySnapshots.itemRename;
                                    let itemToRename = null;
                                    let parentFolder = null;

                                    if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
                                        // 활성 폴더 또는 휴지통에서 폴더 찾기
                                        itemToRename = latestData.folders.find(f => f.id === id) || latestData.trash.find(item => item.id === id && item.type === 'folder');
                                        const hasLatestNameConflict = latestData.folders.some(folder => (
                                            folder.id !== id
                                            && String(folder.name ?? '').trim().toLowerCase() === String(newName ?? '').trim().toLowerCase()
                                        ));
                                        if (!itemToRename) {
                                            recoveryOutcome.itemRename = 'missing';
                                        } else if (shouldDiscardEmergencyItemRename(recoverySnapshots.itemRename, renameTargetSnapshot)) {
                                            recoveryOutcome.itemRename = 'stale';
                                        } else if (hasLatestNameConflict) {
                                            // 프롬프트 이후 실제 저장 직전에 생긴 충돌은 강제로 중복 이름을
                                            // 만들지 않고, 해당 이름 변경 백업만 다음 재시도용으로 보존합니다.
                                            recoveryOutcome.itemRename = 'conflict';
                                        } else {
                                            itemToRename.name = newName;
                                            itemToRename.updatedAt = now;
                                            recoveryOutcome.itemRename = 'applied';
                                            changesApplied = true;
                                        }
                                    } else if (type === CONSTANTS.ITEM_TYPE.NOTE) {
                                        // 활성 폴더들의 노트에서 먼저 검색
                                        for (const folder of latestData.folders) {
                                            const note = folder.notes.find(n => n.id === id);
                                            if (note) { itemToRename = note; parentFolder = folder; break; }
                                        }
                                        
                                        // 활성 폴더에 없으면 휴지통에서 검색 (휴지통의 최상위 또는 폴더 내부 노트)
                                        if (!itemToRename) {
                                            for (const trashItem of latestData.trash) {
                                                if (trashItem.id === id && (trashItem.type === 'note' || !trashItem.type)) {
                                                    itemToRename = trashItem;
                                                    break;
                                                }
                                                if (trashItem.type === 'folder' && Array.isArray(trashItem.notes)) {
                                                    const noteInTrashFolder = trashItem.notes.find(n => n.id === id);
                                                    if (noteInTrashFolder) {
                                                        itemToRename = noteInTrashFolder;
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                        
                                        if (!itemToRename) {
                                            recoveryOutcome.itemRename = 'missing';
                                        } else if (shouldDiscardEmergencyItemRename(recoverySnapshots.itemRename, renameTargetSnapshot)) {
                                            recoveryOutcome.itemRename = 'stale';
                                        } else {
                                            itemToRename.title = newName;
                                            itemToRename.updatedAt = now;
                                            if (parentFolder) parentFolder.updatedAt = now;
                                            recoveryOutcome.itemRename = 'applied';
                                            changesApplied = true;
                                        }
                                    }
                                }

                                if (changesApplied) {
                                    return {
                                        newData: latestData,
                                        successMessage: '✅ 변경사항이 성공적으로 복원되었습니다.',
                                        payload: { recoveryOutcome: { ...recoveryOutcome } }
                                    };
                                }
                                return null; // 적용할 변경이 없으면 업데이트 취소
                            });

                            // 적용되었거나 최신 저장본에 이미 반영된 항목만, 복구 시작 때의
                            // 정확한 스냅샷과 여전히 일치할 때 개별 정리합니다. 다른 항목의 실패나
                            // 저장 대기 중 생성된 더 최신 백업은 그대로 남깁니다.
                            const clearableWithoutCommit = new Set(['missing', 'stale']);
                            const clearRecoveredEntry = entryKey => {
                                const outcome = recoveryOutcome[entryKey];
                                const wasCommitted = transactionResult.success && outcome === 'applied';
                                if (!wasCommitted && !clearableWithoutCommit.has(outcome)) return;

                                const expectedEntry = recoverySnapshots[entryKey];
                                if (!expectedEntry) return;
                                clearEmergencyChangesBackupEntry(
                                    entryKey,
                                    currentEntry => matchesEmergencyBackupSnapshot(entryKey, currentEntry, expectedEntry)
                                );
                            };
                            clearRecoveredEntry('noteUpdate');
                            clearRecoveredEntry('itemRename');

                            const remainingEmergencyBackupJSON = localStorage.getItem(CONSTANTS.LS_KEY_EMERGENCY_CHANGES_BACKUP);
                            expectedEmergencyBackupJSON = remainingEmergencyBackupJSON;
                            emergencyBackupRemoved = remainingEmergencyBackupJSON === null;
                            const hasPendingConflict = Object.values(recoveryOutcome).includes('conflict');

                            if (transactionResult.success) {
                                if (hasPendingConflict) {
                                    showToast('폴더 이름 충돌로 적용하지 못한 이름 변경은 비상 백업에 보존했습니다.', CONSTANTS.TOAST_TYPE.ERROR);
                                }
                            } else if (transactionResult.failureReason === 'no-change' && !remainingEmergencyBackupJSON) {
                               showToast("복원 대상이 현재 데이터에 없거나 이미 저장되어 비상 백업을 정리했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
                            } else if (hasPendingConflict) {
                               showToast('최신 폴더 이름과 충돌하여 이름 변경을 적용하지 않았습니다. 비상 백업은 보존했습니다.', CONSTANTS.TOAST_TYPE.ERROR);
                            } else {
                               // 저장공간 부족, Storage API 오류, 잠금 실패 등에서는 유일한 미저장 사본을 보존합니다.
                               showToast("변경사항 복원 저장에 실패했습니다. 비상 백업은 보존되며 다음 실행에서 다시 복원할 수 있습니다.", CONSTANTS.TOAST_TYPE.ERROR);
                            }
                        }
                    } else {
                        // [CRITICAL BUG FIX] 사용자가 복원을 거부했으므로 비상 백업을 반드시 제거하여 무한 루프를 방지합니다.
                        removeEmergencyBackup();
                        showToast("저장되지 않았던 변경사항을 버렸습니다.", CONSTANTS.TOAST_TYPE.SUCCESS);
                    }
                }
                
                const updatedStorageResult = await storageGet('appState');
                authoritativeData = updatedStorageResult.appState;
                if (authoritativeData) {
                    const verification = verifyAndSanitizeLoadedData(JSON.parse(JSON.stringify(authoritativeData)));
                    if (verification.isTopLevelInvalid) {
                        throw createUnrecoverableAppStateError('비상 복구 결과의 최상위 구조가 올바르지 않아 원본 보존을 위해 저장을 중단했습니다.');
                    }
                    authoritativeData = verification.sanitizedData;
                    verification.folderIdUpdateMap.forEach((newId, oldId) => folderIdUpdateMap.set(oldId, newId));
                    verification.noteIdUpdateMap.forEach((newId, oldId) => noteIdUpdateMap.set(oldId, newId));

                    if (verification.wasSanitized) {
                        await storageSet({ appState: authoritativeData });
                        console.warn('[Emergency Recovery] Recovered data required additional sanitization and was saved back to storage.');
                    }
                    if (verification.shouldNotify) {
                        const sanitizationMessage = '복구된 데이터의 무결성 검사 중 문제를 발견하여 자동 복구했습니다.';
                        recoveryMessage = recoveryMessage ? `${recoveryMessage}\n${sanitizationMessage}` : sanitizationMessage;
                    }
                }

            } catch (e) {
                if (!emergencyBackupValidated) {
                    console.error("비상 백업 형식이 손상되어 안전하게 제거합니다.", e);
                    try { removeEmergencyBackup(); } catch (removeError) {
                        console.error('손상된 비상 백업을 제거하지 못했습니다.', removeError);
                    }
                    showToast("손상된 비상 백업을 읽을 수 없어 정리했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
                } else if (!emergencyBackupRemoved) {
                    // 유효한 백업을 읽은 뒤 발생한 Storage API/모달/런타임 오류는 일시적일 수 있습니다.
                    // 유일한 미저장 데이터 사본을 삭제하지 않고 다음 실행에서 재시도합니다.
                    console.error("비상 백업 복구 중 오류가 발생했습니다. 유효한 백업은 다음 재시도를 위해 보존됩니다.", e);
                    showToast("변경사항 복구 중 오류가 발생했습니다. 비상 백업은 보존되며 다음 실행에서 다시 시도됩니다.", CONSTANTS.TOAST_TYPE.ERROR);
                } else {
                    // 복원 성공/사용자 폐기/대상 없음 처리 뒤 후속 검증에서 실패한 경우입니다.
                    console.error("비상 백업 처리 후 저장 데이터 확인 중 오류가 발생했습니다.", e);
                    showToast("비상 백업 처리 후 데이터를 확인하는 중 오류가 발생했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
                }
            }
        }
        // --- BUG-C-02 FIX END ---
        
        // 3. 비상 백업 처리가 끝난 최신 appState를 기준으로 최종 세션 상태를 구성합니다.
        
        // 4. 최종 상태(state) 설정 및 UI 초기화
        let finalState = { ...state };
        
        if (authoritativeData && authoritativeData.folders) { // 데이터가 있는 경우
            Object.assign(finalState, authoritativeData);
            finalState.trash = finalState.trash || [];
            finalState.favorites = new Set(authoritativeData.favorites || []);
            const persistedLastActiveNotePerFolder = authoritativeData.lastActiveNotePerFolder || {};

            let lastSession = null;
            try {
                const sessionData = localStorage.getItem(CONSTANTS.LS_KEY);
                if (sessionData) {
                    lastSession = JSON.parse(sessionData);
                    sanitizeObjectForPrototypePollution(lastSession);
                }
            } catch (e) {
                console.warn("Could not parse last session from localStorage:", e);
                localStorage.removeItem(CONSTANTS.LS_KEY);
            }

            if (lastSession) {
                // 세션 ID도 문자열로 정규화하고, 폴더/노트 유형에 맞는 복구 맵을 각각 적용합니다.
                const correctedFolderId = getFolderIdAfterSanitization(lastSession.f, folderIdUpdateMap);
                const correctedNoteId = lastSession.n === undefined || lastSession.n === null
                    ? null
                    : (noteIdUpdateMap.get(String(lastSession.n)) || String(lastSession.n));

                finalState.activeFolderId = correctedFolderId;
                finalState.activeNoteId = correctedNoteId;
                finalState.noteSortOrder = lastSession.s ?? 'updatedAt_desc';
                
                // appState의 정상 기록을 기반으로 하되, 더 자주 갱신되는 localStorage 세션 값을 우선 병합합니다.
                // 구버전 세션처럼 l 필드가 없더라도 영구 저장된 폴더별 마지막 선택 기록을 잃지 않습니다.
                const sessionLastActiveNotePerFolder = lastSession.l && typeof lastSession.l === 'object' && !Array.isArray(lastSession.l)
                    ? lastSession.l
                    : {};
                finalState.lastActiveNotePerFolder = sanitizeLastActiveNoteMap(
                    {
                        ...persistedLastActiveNotePerFolder,
                        ...sessionLastActiveNotePerFolder
                    },
                    finalState,
                    { folderIdUpdateMap, noteIdUpdateMap }
                );
            } else {
                // 세션 저장소만 지워졌거나 가져오기 직후인 경우에는 appState의 유효한 선택 기록을 복원합니다.
                finalState.lastActiveNotePerFolder = sanitizeLastActiveNoteMap(
                    persistedLastActiveNotePerFolder,
                    finalState,
                    { folderIdUpdateMap, noteIdUpdateMap }
                );
            }

            finalState.totalNoteCount = finalState.folders.reduce((sum, f) => sum + (Array.isArray(f.notes) ? f.notes.length : 0), 0);
            
            setState(finalState);
            buildNoteMap();

            // 순환참조를 피하기 위해 동적 임포트 사용
            const { findFolder } = await import('./state.js'); 
            const folderExists = state.folders.some(f => f.id === state.activeFolderId) || Object.values(CONSTANTS.VIRTUAL_FOLDERS).some(vf => vf.id === state.activeFolderId);

            const getStartupNoteForFolder = (folderId) => {
                const { item: folder } = findFolder(folderId);
                let selectableNotes = Array.isArray(folder?.notes) ? folder.notes : [];

                if (folderId === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id) {
                    selectableNotes = [...selectableNotes].sort((a, b) => (b?.deletedAt ?? 0) - (a?.deletedAt ?? 0));
                } else if (folder?.isSortable !== false) {
                    selectableNotes = sortNotes(selectableNotes, state.noteSortOrder);
                }

                const rememberedNoteId = state.lastActiveNotePerFolder?.[folderId] ?? null;
                const rememberedNoteExists = rememberedNoteId
                    && selectableNotes.some(note => String(note?.id ?? '') === String(rememberedNoteId));
                return rememberedNoteExists ? rememberedNoteId : (selectableNotes[0]?.id ?? null);
            };

            if (!folderExists) {
                // [MAJOR BUG FIX] 성공한 가져오기는 이전 세션을 의도적으로 제거합니다. 이때 appState에는
                // activeFolderId/activeNoteId가 없으므로 기존 로직은 '모든 노트'로만 이동한 뒤 activeNoteId를
                // null로 남겨, 노트가 충분히 있어도 가져오기 직후 편집기가 빈 화면으로 시작했습니다.
                // 세션이 없거나 오래되어 폴더 참조가 무효인 경우에도 안전한 가상 폴더를 선택한 뒤
                // 기억된 노트 또는 현재 정렬 기준 첫 노트까지 함께 선택해 즉시 편집 가능한 상태를 복원합니다.
                const fallbackFolderId = CONSTANTS.VIRTUAL_FOLDERS.ALL.id;
                setState({
                    activeFolderId: fallbackFolderId,
                    activeNoteId: getStartupNoteForFolder(fallbackFolderId)
                });
            } else if (!isValidLastActiveReference(
                state.activeFolderId,
                state.activeNoteId,
                buildDataReferenceContext(state)
            )) {
                setState({ activeNoteId: getStartupNoteForFolder(state.activeFolderId) });
            }

        } else { // 데이터가 아예 없는 초기 실행
            const now = new Date().getTime();
            const allIds = new Set(); // 생성된 ID를 추적하여 중복 방지

            // [수정] 기본 생성 폴더 목록을 수정하고 5개의 새 폴더를 상단에 추가합니다.
            const defaultFolderNames = [
                'Inbox',
                'Today',
                'A1 (Must Have)',
                'B2 (Should Have)',
                'C3 (Could Have)',
                'Projects',
                'Areas',
                'Resources',
                'Archives',
                'Future Log',
                'Monthly Log',
                'Daily Log',
                'MothNote'
            ];
            
            // [수정] 가이드 노트 생성
            const welcomeNoteId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, allIds);
            allIds.add(welcomeNoteId);
            const welcomeNote = { 
                id: welcomeNoteId, 
                title: "MothNote 에 오신 것을 환영합니다! 🦋", 
                content: welcomeNoteContent, 
                createdAt: now, 
                updatedAt: now, 
                isPinned: false 
            };

            // [기능 추가] LunaFlowACT 노트 생성
            const lunaFlowNoteId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, allIds);
            allIds.add(lunaFlowNoteId);
            const lunaFlowNote = {
                id: lunaFlowNoteId,
                title: "LunaFlowACT",
                content: lunaFlowACTContent,
                createdAt: now,
                updatedAt: now,
                isPinned: true // 중요하므로 고정
            };
            
            // 폴더를 순서대로 생성
            const initialFolders = defaultFolderNames.map(name => {
                const folderId = generateUniqueId(CONSTANTS.ID_PREFIX.FOLDER, allIds);
                allIds.add(folderId);

                // 'MothNote' 폴더에만 두 개의 기본 노트를 추가
                const notesForFolder = (name === 'MothNote') ? [lunaFlowNote, welcomeNote] : [];

                return {
                    id: folderId,
                    name: name,
                    notes: notesForFolder,
                    createdAt: now,
                    updatedAt: now
                };
            });
            
            // 마지막 폴더('MothNote')의 ID를 활성 폴더로 설정
            const lastFolderId = initialFolders[initialFolders.length - 1].id;

            const initialAppState = {
                folders: initialFolders, 
                trash: [], 
                favorites: [], 
                lastSavedTimestamp: now
            };
            
            // 초기화/첫 저장도 같은 저장 경계를 사용해 현재 문서의 초기 데이터 생성 순서를 명확히 합니다.
            // 저장이 성공하기 전에 메모리 상태를 먼저 바꾸지 않아, 초기 저장 실패 시 '보이지만 저장되지 않은'
            // 기본 노트가 생기는 문제도 방지합니다.
            const initializationResult = await withAppStateWriteLock(async () => {
                const latestResult = await storageGet('appState');
                const hasLatestAppState = Object.prototype.hasOwnProperty.call(latestResult, 'appState')
                    && latestResult.appState !== null
                    && latestResult.appState !== undefined;
                if (!hasLatestAppState) {
                    await storageSet({ appState: initialAppState });
                    return { appState: initialAppState, createdHere: true };
                }

                // 저장 경계를 통과한 뒤 이미 영구 저장 데이터가 있으면 그 데이터를 권위 있는 값으로 채택합니다.
                const verification = verifyAndSanitizeLoadedData(JSON.parse(JSON.stringify(latestResult.appState)));
                if (verification.isTopLevelInvalid) {
                    throw createUnrecoverableAppStateError('초기화 중 발견한 기존 노트 데이터가 손상되어 원본 보존을 위해 새 데이터 생성을 중단했습니다.');
                }
                const latestData = verification.sanitizedData;
                if (verification.wasSanitized) await storageSet({ appState: latestData });
                return { appState: latestData, createdHere: false };
            });

            if (initializationResult.createdHere) {
                setState({
                    ...state,
                    ...initialAppState,
                    favorites: new Set(),
                    activeFolderId: lastFolderId,
                    activeNoteId: welcomeNoteId,
                    totalNoteCount: 2,
                    // [MAJOR BUG FIX] 최초 실행 직후 저장되는 세션의 마지막 활성 노트가 화면의 활성 노트와 달라
                    // 첫 새로고침에서 사용자가 보던 환영 노트가 다른 노트로 바뀌는 문제를 막습니다.
                    lastActiveNotePerFolder: { [lastFolderId]: welcomeNoteId }
                });
            } else {
                const latestData = initializationResult.appState;
                const folders = Array.isArray(latestData.folders) ? latestData.folders : [];
                const preferredFolder = [...folders].reverse().find(folder => Array.isArray(folder.notes) && folder.notes.length > 0)
                    || folders[0]
                    || null;
                const preferredNote = preferredFolder && Array.isArray(preferredFolder.notes)
                    ? preferredFolder.notes[0] || null
                    : null;

                setState({
                    ...state,
                    ...latestData,
                    folders,
                    trash: Array.isArray(latestData.trash) ? latestData.trash : [],
                    favorites: new Set(latestData.favorites || []),
                    activeFolderId: preferredFolder?.id || CONSTANTS.VIRTUAL_FOLDERS.ALL.id,
                    activeNoteId: preferredNote?.id || null,
                    lastActiveNotePerFolder: sanitizeLastActiveNoteMap(latestData.lastActiveNotePerFolder || {}, latestData),
                    totalNoteCount: folders.reduce((sum, folder) => sum + (Array.isArray(folder.notes) ? folder.notes.length : 0), 0)
                });
            }
        }

        updateNoteCreationDates();
        // [MAJOR BUG FIX] loadData()는 app.init의 isInitializing=true 구간에서 실행됩니다.
        // 일반 saveSession()은 중간 상태 저장을 막기 위해 이 구간에서 반환하므로, 최초 실행/복구 직후의
        // 최종 활성 폴더·노트가 세션에 기록되지 않았습니다. 무결성 검사가 끝난 이 지점에서만 예외적으로 저장합니다.
        saveSession({ allowDuringInitialization: true });

    } catch (e) { 
        // [CRITICAL BUG FIX] 저장소 로딩/복구가 실패했는데도 빈 상태로 앱을 계속 실행하면
        // 사용자가 실제 데이터를 잃어버린 것으로 오해하거나, 후속 저장이 기존 데이터를 덮어쓸 수 있습니다.
        // 초기화 단계의 전역 오류 처리로 실패를 전달해 안전하게 중단합니다.
        console.error("Error loading data:", e); 
        throw e;
    } 
    
    if (recoveryMessage) {
        return { recoveryMessage };
    }
    return { recoveryMessage: null };
};


// --- 데이터 가져오기/내보내기 및 정제 로직 ---

// [BUG FIX] chrome.downloads API 실패 시 일반 웹 다운로드 방식으로 대체하는 헬퍼 함수
const fallbackAnchorDownload = (url, filename) => {
    try {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        
        // DOM 정리 및 URL 해제는 다운로드가 시작될 시간을 확보한 후 비동기적으로 수행
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
        
        showToast(CONSTANTS.MESSAGES.SUCCESS.EXPORT_SUCCESS);
    } catch (e) {
        console.error("Fallback download failed:", e);
        showToast(CONSTANTS.MESSAGES.ERROR.EXPORT_FAILURE, CONSTANTS.TOAST_TYPE.ERROR);
        // 실패 시에도 메모리 누수 방지를 위해 URL을 즉시 해제
        URL.revokeObjectURL(url);
    }
};


const sanitizeContentData = data => {
    if (!data || !Array.isArray(data.folders)) {
        throw new Error("유효하지 않은 파일 구조입니다.");
    }

    // 누락된 구버전 선택 필드는 기본값으로 보완할 수 있지만, 필드가 존재하면서
    // 컨테이너 형식이 잘못된 백업은 일부 데이터만 조용히 버린 채 가져오면 안 됩니다.
    // 특히 notes/trash를 빈 배열로 바꾸고 가져오기를 완료하면 정상으로 보였던
    // 현재 데이터와 롤백 백업까지 다음 실행에서 영구적으로 사라질 수 있습니다.
    if (Object.prototype.hasOwnProperty.call(data, 'trash') && !Array.isArray(data.trash)) {
        throw new Error("휴지통 데이터가 배열 형식이 아닙니다.");
    }
    if (Object.prototype.hasOwnProperty.call(data, 'favorites') && !Array.isArray(data.favorites)) {
        throw new Error("즐겨찾기 데이터가 배열 형식이 아닙니다.");
    }

    sanitizeObjectForPrototypePollution(data);

    const usedIds = new Set(RESERVED_ITEM_IDS);
    const folderIdMap = new Map();
    const noteIdMap = new Map();
    const now = Date.now();

    const normalizeTimestamp = (value, fallback = now) => {
        return toValidTimestamp(value) ?? fallback;
    };

    const getUniqueId = (prefix, id, referenceMap) => {
        const oldId = id === undefined || id === null ? '' : String(id);
        // 가져오기 데이터의 ID는 전체 값이 현재 스키마와 일치할 때만 보존합니다.
        // 과도하게 긴 외부 ID를 잘라 보존하면 참조가 다른 항목으로 합쳐질 수 있어 새 ID를 발급합니다.
        let finalId = isValidItemIdForType(oldId, prefix) ? oldId : '';

        if (!finalId || usedIds.has(finalId)) {
            finalId = generateUniqueId(prefix, usedIds);
        }

        usedIds.add(finalId);
        // 같은 유형 안에서 중복된 ID는 첫 번째 항목을 기준 참조로 유지합니다.
        if (oldId && !referenceMap.has(oldId)) referenceMap.set(oldId, finalId);
        return finalId;
    };

    const assertRecord = (value, label) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error(`${label} 데이터가 올바르지 않습니다.`);
        }
    };

    const assertSafeTextField = (record, key, label) => {
        if (record[key] !== null && typeof record[key] === 'object') {
            throw new Error(`${label} 필드가 텍스트 형식이 아닙니다.`);
        }
    };

    const sanitizeNote = (rawNote, isTrash = false) => {
        assertRecord(rawNote, '노트');
        if (hasFolderDataShape(rawNote)) {
            throw new Error('노트 항목에 폴더 필드가 포함되어 있어 무손실로 가져올 수 없습니다.');
        }
        assertSafeTextField(rawNote, 'title', '노트 제목');
        assertSafeTextField(rawNote, 'content', '노트 본문');
        const noteId = getUniqueId(CONSTANTS.ID_PREFIX.NOTE, rawNote.id, noteIdMap);
        const createdAt = normalizeTimestamp(rawNote.createdAt);
        const updatedAt = normalizeTimestamp(rawNote.updatedAt, createdAt);
        const note = {
            id: noteId,
            // 현재 편집기가 허용하는 제목을 백업 복원에서도 손실 없이 보존합니다.
            title: String(rawNote.title ?? '제목 없는 노트'),
            content: String(rawNote.content ?? ''),
            createdAt,
            updatedAt,
            isPinned: Boolean(rawNote.isPinned),
        };

        if (isTrash) {
            note.type = CONSTANTS.ITEM_TYPE.NOTE;
            note.deletedAt = normalizeTimestamp(rawNote.deletedAt);
            if (rawNote.originalFolderId !== undefined && rawNote.originalFolderId !== null) {
                note.originalFolderId = String(rawNote.originalFolderId);
            }
            // 삭제 당시 즐겨찾기였는지를 보존해야 복원 시 즐겨찾기도 함께 복구됩니다.
            if ('wasFavorite' in rawNote) note.wasFavorite = Boolean(rawNote.wasFavorite);
        }
        return note;
    };

    const sanitizeFolder = (rawFolder, isTrash = false) => {
        assertRecord(rawFolder, '폴더');
        if (hasNoteDataShape(rawFolder)) {
            throw new Error('폴더 항목에 노트 필드가 포함되어 있어 무손실로 가져올 수 없습니다.');
        }
        assertSafeTextField(rawFolder, 'name', '폴더 이름');
        if (Object.prototype.hasOwnProperty.call(rawFolder, 'notes') && !Array.isArray(rawFolder.notes)) {
            throw new Error(`${isTrash ? '휴지통 폴더' : '폴더'}의 노트 목록이 배열 형식이 아닙니다.`);
        }
        const folderId = getUniqueId(CONSTANTS.ID_PREFIX.FOLDER, rawFolder.id, folderIdMap);
        const deletedAt = isTrash ? normalizeTimestamp(rawFolder.deletedAt) : null;
        const createdAt = normalizeTimestamp(rawFolder.createdAt, deletedAt || now);
        const updatedAt = normalizeTimestamp(rawFolder.updatedAt, createdAt);
        const folder = {
            id: folderId,
            name: normalizeFolderName(rawFolder.name),
            notes: Array.isArray(rawFolder.notes)
                ? rawFolder.notes.map(note => sanitizeNote(note, isTrash))
                : [],
            createdAt,
            updatedAt,
        };

        if (isTrash) {
            folder.type = CONSTANTS.ITEM_TYPE.FOLDER;
            folder.deletedAt = deletedAt;
            const originalIndex = Number(rawFolder.originalIndex);
            if (Number.isInteger(originalIndex) && originalIndex >= 0) {
                folder.originalIndex = originalIndex;
            }
        }
        return folder;
    };

    const usedActiveFolderNameKeys = new Set();
    const sanitizedFolders = data.folders.map(folder => {
        const sanitizedFolder = sanitizeFolder(folder, false);
        sanitizedFolder.name = getUniqueFolderName(sanitizedFolder.name, usedActiveFolderNameKeys);
        return sanitizedFolder;
    });

    const sanitizedTrash = Array.isArray(data.trash)
        ? data.trash.map(item => {
            // 손상된 휴지통 항목을 건너뛰고 성공 처리하면 사용자가 백업에
            // 포함됐다고 믿은 노트/폴더가 복원 과정에서 영구 누락됩니다.
            assertRecord(item, '휴지통 항목');
            // 구버전 백업은 type 필드가 없을 수 있고, 손상된 type 하나만 믿으면
            // 노트 본문을 빈 폴더로 바꿀 수 있습니다. 실제 필드 형태를 우선합니다.
            const effectiveType = getTrashItemKind(item);
            if (effectiveType === 'ambiguous') {
                throw new Error('휴지통 항목에 폴더와 노트 필드가 함께 있어 무손실로 판별할 수 없습니다.');
            }
            if (!effectiveType) {
                throw new Error('휴지통 항목의 유형을 판별할 수 없어 원본 보호를 위해 가져오기를 중단했습니다.');
            }

            return effectiveType === CONSTANTS.ITEM_TYPE.FOLDER
                ? sanitizeFolder(item, true)
                : sanitizeNote(item, true);
        })
        : [];

    // 모든 폴더 ID를 먼저 수집한 뒤 원본 폴더 참조를 보정합니다. 휴지통 배열의 순서와 무관하게 동작합니다.
    const remapOriginalFolderId = note => {
        if (note?.originalFolderId === undefined || note.originalFolderId === null) return;
        const oldFolderId = String(note.originalFolderId);
        note.originalFolderId = folderIdMap.get(oldFolderId) || oldFolderId;
    };
    sanitizedTrash.forEach(item => {
        if (item.type === CONSTANTS.ITEM_TYPE.FOLDER) {
            item.notes.forEach(remapOriginalFolderId);
        } else {
            remapOriginalFolderId(item);
        }
    });

    // 즐겨찾기는 활성 노트만 가리킬 수 있습니다. 휴지통 노트의 과거 상태는 wasFavorite로 보존합니다.
    const activeNoteIds = new Set();
    sanitizedFolders.forEach(folder => {
        folder.notes.forEach(note => activeNoteIds.add(note.id));
    });

    const sanitizedFavorites = (Array.isArray(data.favorites) ? data.favorites : [])
        .map(oldId => {
            const normalizedOldId = String(oldId);
            return noteIdMap.get(normalizedOldId) || normalizedOldId;
        })
        .filter(finalId => activeNoteIds.has(finalId));

    const sanitizedPayloadForReferences = {
        folders: sanitizedFolders,
        trash: sanitizedTrash,
        favorites: Array.from(new Set(sanitizedFavorites))
    };

    const sanitizedLastActiveNotePerFolder = sanitizeLastActiveNoteMap(
        data.lastActiveNotePerFolder || {},
        sanitizedPayloadForReferences,
        { folderIdUpdateMap: folderIdMap, noteIdUpdateMap: noteIdMap }
    );

    return {
        ...sanitizedPayloadForReferences,
        lastActiveNotePerFolder: sanitizedLastActiveNotePerFolder
    };
};
export const sanitizeSettings = (settingsData) => {
    const defaults = CONSTANTS.DEFAULT_SETTINGS;
    const sanitized = JSON.parse(JSON.stringify(defaults));
    const MIN_SIDE_PANEL_WIDTH = 10;
    const MAX_SIDE_PANEL_WIDTH = 50;
    const MAX_COMBINED_SIDE_PANEL_WIDTH = 70;

    if (!settingsData || typeof settingsData !== 'object') {
        return sanitized;
    }
    if (sanitizeObjectForPrototypePollution(settingsData)) {
        console.warn('[Settings Sanitization] Unsafe prototype-pollution keys were removed from settings data.');
    }

    const parseFiniteNumber = (value, defaultValue, isFloat = false) => {
        const parsed = isFloat ? Number.parseFloat(value) : Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : defaultValue;
    };
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const getClampedNumber = (value, defaultValue, min, max, isFloat = false) =>
        clamp(parseFiniteNumber(value, defaultValue, isFloat), min, max);
    const getNumberInRangeOrDefault = (value, defaultValue, min, max, isFloat = false) => {
        const parsed = parseFiniteNumber(value, defaultValue, isFloat);
        return parsed >= min && parsed <= max ? parsed : defaultValue;
    };

    if (settingsData.layout && typeof settingsData.layout === 'object') {
        let col1 = getClampedNumber(
            settingsData.layout.col1,
            defaults.layout.col1,
            MIN_SIDE_PANEL_WIDTH,
            MAX_SIDE_PANEL_WIDTH
        );
        let col2 = getClampedNumber(
            settingsData.layout.col2,
            defaults.layout.col2,
            MIN_SIDE_PANEL_WIDTH,
            MAX_SIDE_PANEL_WIDTH
        );

        // 두 사이드 패널이 화면 전체를 차지하면 1fr 편집 영역이 0에 가까워져
        // 노트를 읽거나 수정할 수 없습니다. 비율은 최대한 유지하면서 편집기에
        // 최소 30%의 가용 폭을 남깁니다.
        if (col1 + col2 > MAX_COMBINED_SIDE_PANEL_WIDTH) {
            const expandableWidth = MAX_COMBINED_SIDE_PANEL_WIDTH - (MIN_SIDE_PANEL_WIDTH * 2);
            const requestedExpandableWidth = (col1 - MIN_SIDE_PANEL_WIDTH) + (col2 - MIN_SIDE_PANEL_WIDTH);
            const scale = requestedExpandableWidth > 0
                ? expandableWidth / requestedExpandableWidth
                : 0;
            col1 = Math.round(MIN_SIDE_PANEL_WIDTH + ((col1 - MIN_SIDE_PANEL_WIDTH) * scale));
            col2 = MAX_COMBINED_SIDE_PANEL_WIDTH - col1;
        }

        sanitized.layout.col1 = col1;
        sanitized.layout.col2 = col2;
    }
    if (settingsData.zenMode && typeof settingsData.zenMode === 'object') {
        sanitized.zenMode.maxWidth = getClampedNumber(settingsData.zenMode.maxWidth, defaults.zenMode.maxWidth, 500, 2000);
    }
    if (settingsData.editor && typeof settingsData.editor === 'object') {
        const importedFontFamily = settingsData.editor.fontFamily;
        if (typeof importedFontFamily === 'string'
            && importedFontFamily.trim()
            && typeof CSS !== 'undefined'
            && typeof CSS.supports === 'function'
            && CSS.supports('font-family', importedFontFamily)) {
            sanitized.editor.fontFamily = importedFontFamily.trim().slice(0, 300);
        }
        sanitized.editor.fontSize = getClampedNumber(settingsData.editor.fontSize, defaults.editor.fontSize, 10, 30);
    }
    if (settingsData.weather && typeof settingsData.weather === 'object') {
        // 잘못된 좌표를 극값으로 강제 보정하면 엉뚱한 지역 날씨가 표시되므로 기본 위치로 되돌립니다.
        sanitized.weather.lat = getNumberInRangeOrDefault(settingsData.weather.lat, defaults.weather.lat, -90, 90, true);
        sanitized.weather.lon = getNumberInRangeOrDefault(settingsData.weather.lon, defaults.weather.lon, -180, 180, true);
    }

    return sanitized;
};

// 데이터 작업 전에 편집기와 인라인 이름 변경을 확실히 저장합니다.
// 실패를 무시한 채 백업/가져오기를 진행하면 방금 입력한 내용이 백업에서 빠지거나 덮어써질 수 있습니다.
const flushPendingChangesForDataOperation = async (operationName) => {
    const { saveCurrentNoteIfChanged, finishPendingRename } = await import('./itemActions.js');

    if (!(await finishPendingRename())) {
        showToast(`이름 변경 저장에 실패하여 ${operationName} 작업을 취소했습니다.`, CONSTANTS.TOAST_TYPE.ERROR);
        return false;
    }
    if (!(await saveCurrentNoteIfChanged())) {
        showToast(`노트 저장에 실패하여 ${operationName} 작업을 취소했습니다.`, CONSTANTS.TOAST_TYPE.ERROR);
        return false;
    }
    return true;
};

// [BUG FIX & 기능 추가] 습관 트래커 및 다이어트 챌린지 데이터를 포함하도록 handleExport 함수 수정
export const handleExport = async (settings) => {
    if (!(await flushPendingChangesForDataOperation('백업'))) {
        return false;
    }

    try {
        // 백업은 현재 메모리 스냅샷이 아니라 영구 저장 데이터를 기준으로 생성합니다.
        // 이를 통해 저장 직전의 기준 appState를 사용해 백업 누락 가능성을 줄입니다.
        const persistedResult = await withAppStateWriteLock(() => storageGet('appState'));
        const hasPersistedAppState = Boolean(persistedResult)
            && Object.prototype.hasOwnProperty.call(persistedResult, 'appState')
            && persistedResult.appState !== null
            && persistedResult.appState !== undefined;
        const rawExportState = hasPersistedAppState
            ? persistedResult.appState
            : {
                folders: state.folders,
                trash: state.trash,
                favorites: Array.from(state.favorites),
                lastActiveNotePerFolder: state.lastActiveNotePerFolder || {},
                lastSavedTimestamp: state.lastSavedTimestamp
            };

        // folders 하나만 확인하고 백업을 생성하면 trash/favorites/노트 레코드가 손상된
        // appState도 성공한 백업처럼 다운로드되어, 정작 복구 시 전체 파일이 거부될 수 있습니다.
        // 원본을 변경하지 않는 복제본을 전체 로드 경계와 동일한 검증기로 확인합니다.
        let exportVerification;
        try {
            exportVerification = verifyAndSanitizeLoadedData(JSON.parse(JSON.stringify(rawExportState)));
        } catch (validationError) {
            throw createUnrecoverableAppStateError(`백업 대상 데이터를 복제하거나 검증하지 못했습니다: ${validationError.message}`);
        }
        if (exportVerification.isTopLevelInvalid) {
            throw createUnrecoverableAppStateError('저장된 노트 데이터의 구조가 손상되어 안전한 백업을 만들 수 없습니다.');
        }
        const exportState = exportVerification.sanitizedData;

        // 핵심 노트 데이터는 chrome.storage.local에 있으므로, 부가 localStorage 한 항목의
        // 읽기 실패가 전체 백업을 막지 않게 각각 독립적으로 읽습니다.
        // 읽기 실패와 실제 값 null을 구분해, 실패한 부가 항목은 백업에서 생략합니다.
        const readOptionalLocalStorageForExport = (key, label) => {
            try {
                return { ok: true, value: localStorage.getItem(key) };
            } catch (readError) {
                console.warn(`${label} 데이터를 읽지 못해 해당 항목을 제외하고 핵심 백업을 계속합니다.`, readError);
                return { ok: false, value: null };
            }
        };

        let settingsToExport = sanitizeSettings(settings);
        const storedSettingsResult = readOptionalLocalStorageForExport(CONSTANTS.LS_KEY_SETTINGS, '설정');
        if (storedSettingsResult.ok && storedSettingsResult.value) {
            try { settingsToExport = sanitizeSettings(JSON.parse(storedSettingsResult.value)); }
            catch (settingsError) { console.warn('저장된 설정을 읽지 못해 현재 설정을 백업합니다.', settingsError); }
        }

        // [기능 추가] localStorage에서 습관 트래커 데이터 가져오기
        const habitTrackerResult = readOptionalLocalStorageForExport(HABIT_TRACKER_DATA_KEY, '습관 트래커');
        const habitTrackerData = habitTrackerResult.value;
        // [기능 추가] localStorage에서 다이어트 챌린지 데이터 가져오기
        const dietChallengeResult = readOptionalLocalStorageForExport(DIET_CHALLENGE_DATA_KEY, '다이어트 챌린지');
        const dietChallengeSettingsResult = readOptionalLocalStorageForExport(DIET_CHALLENGE_SETTINGS_KEY, '다이어트 챌린지 설정');
        const dietChallengeData = dietChallengeResult.value;
        const dietChallengeSettings = dietChallengeSettingsResult.value;
        let habitTrackerDataForExport = null;
        if (habitTrackerData) {
            try {
                habitTrackerDataForExport = JSON.parse(habitTrackerData);
                if (habitTrackerDataForExport && typeof habitTrackerDataForExport === 'object' && !Array.isArray(habitTrackerDataForExport)) {
                    const achievements = habitTrackerDataForExport.achievements && typeof habitTrackerDataForExport.achievements === 'object'
                        ? habitTrackerDataForExport.achievements
                        : {};
                    if (!achievements.data_guardian) {
                        achievements.data_guardian = { unlockedAt: new Date().toISOString() };
                        habitTrackerDataForExport.achievements = achievements;
                        // 백업에 포함할 뿐 아니라 습관 트래커를 다시 열었을 때도 업적이 유지되도록 저장합니다.
                        try {
                            localStorage.setItem(HABIT_TRACKER_DATA_KEY, JSON.stringify(habitTrackerDataForExport));
                        } catch (achievementSaveError) {
                            // 백업은 저장 공간 문제를 복구하기 위한 핵심 수단입니다.
                            // 부가 업적 기록 실패가 정상 노트·설정 백업 생성까지 막지 않게 합니다.
                            console.warn('데이터 지킴이 업적을 저장하지 못했지만 백업은 계속 진행합니다.', achievementSaveError);
                        }
                    }
                }
            } catch (habitDataError) {
                // 일부 데이터가 손상돼도 전체 노트 백업까지 막지 않고 원문을 보존합니다.
                console.warn('습관 트래커 데이터가 올바른 JSON이 아니어서 원문 그대로 백업합니다.', habitDataError);
                habitTrackerDataForExport = habitTrackerData;
            }
        }

        const runtimeVersion = (typeof chrome !== 'undefined'
            && chrome.runtime
            && typeof chrome.runtime.getManifest === 'function')
            ? chrome.runtime.getManifest().version
            : '23.5.1';

        // 폴더별 마지막 선택은 appState보다 localStorage 세션에서 더 자주 갱신됩니다.
        // 영구 저장본을 기준으로 백업하되, 현재 세션의 최신 선택을 덮어써서 오래된 탐색 상태가 내보내지지 않게 합니다.
        const lastActiveNotePerFolderForExport = sanitizeLastActiveNoteMap({
            ...((exportState.lastActiveNotePerFolder && typeof exportState.lastActiveNotePerFolder === 'object')
                ? exportState.lastActiveNotePerFolder
                : {}),
            ...((state.lastActiveNotePerFolder && typeof state.lastActiveNotePerFolder === 'object')
                ? state.lastActiveNotePerFolder
                : {})
        }, exportState);

        const dataToExport = {
            mothNoteVersion: runtimeVersion, // 실제 설치된 확장 프로그램 버전
            settings: settingsToExport,
            folders: exportState.folders || [],
            trash: exportState.trash || [],
            favorites: Array.isArray(exportState.favorites) ? exportState.favorites : [],
            lastActiveNotePerFolder: lastActiveNotePerFolderForExport,
            lastSavedTimestamp: exportState.lastSavedTimestamp || Date.now(),
            // localStorage 읽기 자체가 실패한 항목은 null로 가장하지 않고 키를 생략합니다.
            // 그래야 이 백업을 다시 가져올 때 정상적인 기존 부가 데이터를 잘못 지우지 않습니다.
            ...(habitTrackerResult.ok ? { habitTrackerData: habitTrackerDataForExport } : {}),
            ...(dietChallengeResult.ok ? { dietChallengeData: dietChallengeData } : {}),
            ...(dietChallengeSettingsResult.ok ? { dietChallengeSettings: dietChallengeSettings } : {})
        };
        const dataStr = JSON.stringify(dataToExport, null, 2);
        const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
        const blob = new Blob([bom, dataStr], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const now = new Date();
        const year = now.getFullYear().toString().slice(-2);
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const filename = `${year}${month}${day}_MothNote_Backup.json`;

        // chrome.downloads API가 사용 가능한지 확인하고 우선적으로 사용합니다.
        if (typeof chrome !== 'undefined' && chrome.downloads && typeof chrome.downloads.download === 'function') {
            chrome.downloads.download({
                url: url,
                filename: filename,
                saveAs: false
            }, (downloadId) => {
                // [핵심 수정] API 호출 후 lastError를 확인하여 실패 여부를 판단합니다.
                if (chrome.runtime.lastError) {
                    console.warn(`chrome.downloads.download API 실패: ${chrome.runtime.lastError.message}. 일반 다운로드로 전환합니다.`);
                    // API 실패 시, 권한이 없어도 동작하는 폴백(fallback) 함수를 호출합니다.
                    fallbackAnchorDownload(url, filename);
                } else {
                    // API 성공 시, 약간의 지연 후 URL을 해제하여 메모리 누수를 방지합니다.
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    showToast(CONSTANTS.MESSAGES.SUCCESS.EXPORT_SUCCESS);
                }
            });
        } else {
            // chrome.downloads API를 사용할 수 없는 환경(예: 일반 웹페이지)일 경우 즉시 폴백을 사용합니다.
            fallbackAnchorDownload(url, filename);
        }

        return true;
    } catch (e) {
        console.error("내보내기 준비 중 오류 발생:", e);
        const message = e?.name === 'UnrecoverableAppStateError'
            ? '저장된 노트 데이터의 무결성 검사에 실패하여 원본 보호를 위해 백업을 취소했습니다.'
            : CONSTANTS.MESSAGES.ERROR.EXPORT_FAILURE;
        showToast(message, CONSTANTS.TOAST_TYPE.ERROR);
        return false;
    }
};


export const handleImport = async () => {
    // 실제 동작은 app.js에서 처리하므로, 여기서는 클릭 이벤트만 트리거
    if (!importFileInput) {
        console.error('Import failed: import file input element was not found.');
        showToast('가져오기 입력 요소를 찾을 수 없어 작업을 시작하지 못했습니다.', CONSTANTS.TOAST_TYPE.ERROR);
        return;
    }
    if (importOperationInProgress || window.isImporting) {
        showToast('이미 데이터 가져오기가 진행 중입니다. 현재 작업이 끝난 뒤 다시 시도해주세요.', CONSTANTS.TOAST_TYPE.ERROR);
        return;
    }
    importFileInput.click();
};

const restoreLocalStorageValue = (key, value) => {
    if (typeof value === 'string') localStorage.setItem(key, value);
    else localStorage.removeItem(key);
};


const isPlainImportObject = value => (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
);

// JSON의 boolean/배열/객체는 Number(true) === 1, Number([70]) === 70처럼
// 유효한 숫자로 강제 변환될 수 있습니다. 가져오기 경계에서는 실제 숫자 또는
// 하위 호환용 숫자 문자열만 허용해 손상된 선택 데이터가 기존 값을 덮어쓰지 않게 합니다.
const parseFiniteImportNumber = value => {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

const parseIntegratedImportValue = (value, label) => {
    if (value === null) return null;
    if (typeof value !== 'string') return value;

    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error(`${label} 데이터가 비어 있습니다.`);
    }

    try {
        return JSON.parse(trimmed);
    } catch (error) {
        throw new Error(`${label} 데이터가 올바른 JSON 형식이 아닙니다.`);
    }
};


const normalizeAppSettingsImportValue = value => {
    if (!isPlainImportObject(value)) {
        throw new Error('설정 백업 구조가 올바르지 않습니다.');
    }

    sanitizeObjectForPrototypePollution(value);

    let currentSettings = JSON.parse(JSON.stringify(CONSTANTS.DEFAULT_SETTINGS));
    const storedCurrentSettings = localStorage.getItem(CONSTANTS.LS_KEY_SETTINGS);
    if (storedCurrentSettings) {
        try {
            const currentParsed = JSON.parse(storedCurrentSettings);
            if (isPlainImportObject(currentParsed)) {
                currentSettings = sanitizeSettings(currentParsed);
            }
        } catch (error) {
            console.warn('현재 설정을 읽지 못해 기본 설정을 기준으로 가져옵니다.', error);
        }
    }

    const candidate = JSON.parse(JSON.stringify(currentSettings));
    const requirePlainSection = sectionName => {
        if (!Object.prototype.hasOwnProperty.call(value, sectionName)) return null;
        const section = value[sectionName];
        if (!isPlainImportObject(section)) {
            throw new Error(`설정의 ${sectionName} 항목 형식이 올바르지 않습니다.`);
        }
        return section;
    };
    const readNumber = (section, key, min, max, label) => {
        if (!Object.prototype.hasOwnProperty.call(section, key)) return undefined;
        const rawValue = section[key];
        const numericValue = parseFiniteImportNumber(rawValue);
        if (numericValue === null || numericValue < min || numericValue > max) {
            throw new Error(`설정의 ${label} 값이 올바르지 않습니다.`);
        }
        return numericValue;
    };

    const layout = requirePlainSection('layout');
    if (layout) {
        const col1 = readNumber(layout, 'col1', 10, 50, '왼쪽 패널 너비');
        const col2 = readNumber(layout, 'col2', 10, 50, '오른쪽 패널 너비');
        if (col1 !== undefined) candidate.layout.col1 = col1;
        if (col2 !== undefined) candidate.layout.col2 = col2;
    }

    const zenMode = requirePlainSection('zenMode');
    if (zenMode) {
        const maxWidth = readNumber(zenMode, 'maxWidth', 500, 2000, '집중 모드 최대 너비');
        if (maxWidth !== undefined) candidate.zenMode.maxWidth = maxWidth;
    }

    const editor = requirePlainSection('editor');
    if (editor) {
        if (Object.prototype.hasOwnProperty.call(editor, 'fontFamily')) {
            const fontFamily = editor.fontFamily;
            const isSupportedFont = typeof fontFamily === 'string'
                && fontFamily.trim().length > 0
                && fontFamily.length <= 300
                && (typeof CSS === 'undefined'
                    || typeof CSS.supports !== 'function'
                    || CSS.supports('font-family', fontFamily));
            if (!isSupportedFont) {
                throw new Error('설정의 글꼴 값이 올바르지 않습니다.');
            }
            candidate.editor.fontFamily = fontFamily.trim();
        }
        const fontSize = readNumber(editor, 'fontSize', 10, 30, '글꼴 크기');
        if (fontSize !== undefined) candidate.editor.fontSize = fontSize;
    }

    const weather = requirePlainSection('weather');
    if (weather) {
        const lat = readNumber(weather, 'lat', -90, 90, '날씨 위도');
        const lon = readNumber(weather, 'lon', -180, 180, '날씨 경도');
        if (lat !== undefined) candidate.weather.lat = lat;
        if (lon !== undefined) candidate.weather.lon = lon;
    }

    // [MAJOR BUG FIX] 구버전/부분 백업에서 빠진 하위 설정은 현재 값을 유지하고,
    // 백업에 실제로 들어 있는 잘못된 값은 기본값으로 조용히 치환하지 않고 설정 필드 전체를 건너뜁니다.
    return sanitizeSettings(candidate);
};

const normalizeHabitTrackerImportValue = value => {
    const parsed = parseIntegratedImportValue(value, '습관 트래커');
    if (parsed === null) {
        // 통합 백업의 null은 "습관 데이터 없음"을 뜻합니다. 저장 키를
        // 삭제해 표현하면 다음 시작에서 최초 실행으로 오판하여 샘플 습관을
        // 다시 만들거나, 남아 있던 레거시 키를 다시 마이그레이션할 수 있습니다.
        // 유효한 빈 통합 상태를 저장해 가져온 빈 상태가 재시작 후에도 유지되게 합니다.
        return JSON.stringify({ habits: [] });
    }
    if (!isPlainImportObject(parsed) || !Array.isArray(parsed.habits)) {
        throw new Error('습관 트래커 백업 구조가 올바르지 않습니다. 기존 데이터를 보호하기 위해 가져오기를 중단했습니다.');
    }

    sanitizeObjectForPrototypePollution(parsed);
    const validFrequencyTypes = new Set(['daily', 'weekdays', 'weekends', 'specific_days']);
    const isValidHabitLogDate = dateText => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText ?? ''));
        if (!match) return false;
        const year = Number(match[1]);
        const monthIndex = Number(match[2]) - 1;
        const day = Number(match[3]);
        const date = new Date(year, monthIndex, day);
        return date.getFullYear() === year
            && date.getMonth() === monthIndex
            && date.getDate() === day;
    };
    const hasInvalidFrequency = frequency => (
        !isPlainImportObject(frequency)
        || (Object.prototype.hasOwnProperty.call(frequency, 'type')
            && !validFrequencyTypes.has(frequency.type))
        || (Object.prototype.hasOwnProperty.call(frequency, 'days')
            && (!Array.isArray(frequency.days)
                || frequency.days.length === 0
                || frequency.days.some(day => {
                    const numericDay = parseFiniteImportNumber(day);
                    return numericDay === null
                        || !Number.isInteger(numericDay)
                        || numericDay < 0
                        || numericDay > 6;
                })))
    );
    const hasInvalidLogs = logs => (
        !isPlainImportObject(logs)
        || Object.entries(logs).some(([dateText, entry]) => {
            if (!isValidHabitLogDate(dateText)) return true;
            const valueToCheck = isPlainImportObject(entry)
                ? entry.value
                : entry;
            return parseFiniteImportNumber(valueToCheck) === null;
        })
    );
    const hasInvalidHabit = parsed.habits.some(habit => (
        !isPlainImportObject(habit)
        // 습관명 객체/배열/null은 트래커 로더에서 문자열 "[object Object]" 또는
        // 기본명으로 강제 변환됩니다. 손상된 선택 데이터를 정상 백업으로 받아들여
        // 기존 습관 데이터를 덮어쓰기 전에 가져오기 경계에서 거부합니다.
        || (Object.prototype.hasOwnProperty.call(habit, 'name')
            && (habit.name === null || typeof habit.name === 'object'))
        || ('logs' in habit && hasInvalidLogs(habit.logs))
        || ('frequency' in habit && hasInvalidFrequency(habit.frequency))
    ));
    if (hasInvalidHabit) {
        throw new Error('습관 트래커 백업에 손상된 습관 항목이 있습니다. 기존 데이터를 보호하기 위해 가져오기를 중단했습니다.');
    }

    return JSON.stringify(parsed);
};

const parseDietImportDate = value => {
    const dateText = String(value ?? '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
    if (!match) return null;

    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, monthIndex, day);
    if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) {
        return null;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date > today ? null : dateText;
};

const roundDietImportNumber = value => Math.round((value + Number.EPSILON) * 10) / 10;

const normalizeDietRecordsImportValue = value => {
    const parsed = parseIntegratedImportValue(value, '다이어트 기록');
    if (parsed === null) return null;
    if (!Array.isArray(parsed)) {
        throw new Error('다이어트 기록 백업은 배열 형식이어야 합니다. 기존 데이터를 보호하기 위해 가져오기를 중단했습니다.');
    }

    const usedDates = new Set();
    const normalizedRecords = parsed.map(rawRecord => {
        if (!isPlainImportObject(rawRecord)) {
            throw new Error('다이어트 기록 백업에 손상된 항목이 있습니다.');
        }

        const date = parseDietImportDate(rawRecord.date);
        const weight = parseFiniteImportNumber(rawRecord.weight);
        if (!date || weight === null || weight < 30 || weight > 300 || usedDates.has(date)) {
            throw new Error('다이어트 기록 백업에 잘못된 날짜·체중 또는 중복 날짜가 있습니다.');
        }

        const normalized = { date, weight: roundDietImportNumber(weight) };
        const hasFat = rawRecord.fat !== undefined
            && rawRecord.fat !== null
            && String(rawRecord.fat).trim() !== '';
        if (hasFat) {
            const fat = parseFiniteImportNumber(rawRecord.fat);
            if (fat === null || fat < 1 || fat > 70) {
                throw new Error('다이어트 기록 백업에 잘못된 체지방률이 있습니다.');
            }
            normalized.fat = roundDietImportNumber(fat);
        }

        usedDates.add(date);
        return normalized;
    });

    normalizedRecords.sort((a, b) => a.date.localeCompare(b.date));
    return JSON.stringify(normalizedRecords);
};

const normalizeDietSettingsImportValue = value => {
    const parsed = parseIntegratedImportValue(value, '다이어트 설정');
    if (parsed === null) return null;
    if (!isPlainImportObject(parsed)) {
        throw new Error('다이어트 설정 백업 구조가 올바르지 않습니다. 기존 데이터를 보호하기 위해 가져오기를 중단했습니다.');
    }

    sanitizeObjectForPrototypePollution(parsed);
    const defaults = { height: 179, startWeight: 78.5, goal1: 70, intake: 1862 };
    let currentSettings = { ...defaults };
    const storedCurrentSettings = localStorage.getItem(DIET_CHALLENGE_SETTINGS_KEY);
    if (storedCurrentSettings) {
        try {
            const currentParsed = JSON.parse(storedCurrentSettings);
            if (isPlainImportObject(currentParsed)) {
                currentSettings = { ...currentSettings, ...currentParsed };
            }
        } catch (error) {
            console.warn('현재 다이어트 설정을 읽지 못해 유효한 기본값을 기준으로 가져옵니다.', error);
        }
    }

    const rules = {
        height: { min: Number.EPSILON, max: 300 },
        startWeight: { min: Number.EPSILON, max: 500 },
        goal1: { min: Number.EPSILON, max: 500 },
        intake: { min: 1, max: 10000, integer: true }
    };
    const getValidatedNumber = (source, propertyName, fallback) => {
        const rule = rules[propertyName];
        if (!Object.prototype.hasOwnProperty.call(source, propertyName)) return fallback;
        const rawValue = source[propertyName];
        const number = parseFiniteImportNumber(rawValue);
        if (number === null || number < rule.min || number > rule.max) {
            throw new Error(`다이어트 설정의 ${propertyName} 값이 올바르지 않습니다.`);
        }
        return rule.integer ? Math.round(number) : roundDietImportNumber(number);
    };

    // [MAJOR BUG FIX] 통합 백업이 구버전/부분 백업이라 일부 설정 키가 없을 때
    // 누락 항목을 내장 기본값으로 되돌리지 않고 현재 사용자의 유효한 값을 유지합니다.
    // 현재 값이 자체적으로 손상된 경우에만 해당 키의 안전한 기본값으로 폴백합니다.
    const normalizedCurrent = {};
    for (const propertyName of Object.keys(rules)) {
        try {
            normalizedCurrent[propertyName] = getValidatedNumber(
                currentSettings,
                propertyName,
                defaults[propertyName]
            );
        } catch (error) {
            normalizedCurrent[propertyName] = defaults[propertyName];
        }
    }

    return JSON.stringify({
        height: getValidatedNumber(parsed, 'height', normalizedCurrent.height),
        startWeight: getValidatedNumber(parsed, 'startWeight', normalizedCurrent.startWeight),
        goal1: getValidatedNumber(parsed, 'goal1', normalizedCurrent.goal1),
        intake: getValidatedNumber(parsed, 'intake', normalizedCurrent.intake)
    });
};

const normalizeIntegratedImportFields = importedData => {
    const normalized = {};
    const skippedFields = [];
    const optionalFields = [
        ['habitTrackerData', '습관 트래커', normalizeHabitTrackerImportValue],
        ['dietChallengeData', '다이어트 기록', normalizeDietRecordsImportValue],
        ['dietChallengeSettings', '다이어트 설정', normalizeDietSettingsImportValue]
    ];

    optionalFields.forEach(([propertyName, label, normalizer]) => {
        if (!Object.prototype.hasOwnProperty.call(importedData, propertyName)) return;

        try {
            normalized[propertyName] = normalizer(importedData[propertyName]);
        } catch (error) {
            // 선택 모듈 하나가 손상됐다는 이유로 정상 노트 백업 전체를 사용할 수 없게 하지 않습니다.
            // 건너뛴 필드는 적용 단계에서 현재 localStorage 값을 그대로 유지합니다.
            console.warn(`${label} 백업이 손상되어 해당 항목만 건너뜁니다.`, error);
            skippedFields.push(label);
        }
    });

    return { normalized, skippedFields };
};

const INTEGRATED_IMPORT_TARGETS = Object.freeze([
    {
        propertyName: 'habitTrackerData',
        label: '습관 트래커',
        storageKey: HABIT_TRACKER_DATA_KEY,
        isEmpty: value => {
            if (value === null) return true;
            const parsed = JSON.parse(value);
            return Array.isArray(parsed?.habits) && parsed.habits.length === 0;
        },
        hasMeaningfulCurrentData: value => {
            const parsed = JSON.parse(value);
            return Boolean(
                Array.isArray(parsed?.habits) && parsed.habits.length > 0
                || (parsed?.achievements && typeof parsed.achievements === 'object'
                    && Object.keys(parsed.achievements).length > 0)
                || (parsed?.visitedViews && typeof parsed.visitedViews === 'object'
                    && Object.keys(parsed.visitedViews).length > 0)
            );
        }
    },
    {
        propertyName: 'dietChallengeData',
        label: '다이어트 기록',
        storageKey: DIET_CHALLENGE_DATA_KEY,
        isEmpty: value => value === null || JSON.parse(value).length === 0,
        hasMeaningfulCurrentData: value => {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) && parsed.length > 0;
        }
    },
    {
        propertyName: 'dietChallengeSettings',
        label: '다이어트 설정',
        storageKey: DIET_CHALLENGE_SETTINGS_KEY,
        isEmpty: value => value === null,
        hasMeaningfulCurrentData: value => {
            const parsed = JSON.parse(value);
            return isPlainImportObject(parsed) && Object.keys(parsed).length > 0;
        }
    }
]);

const getIntegratedImportImpact = normalizedIntegratedFields => {
    const targetLabels = [];
    const clearedCurrentDataLabels = [];

    INTEGRATED_IMPORT_TARGETS.forEach(target => {
        if (!Object.prototype.hasOwnProperty.call(normalizedIntegratedFields, target.propertyName)) return;
        targetLabels.push(target.label);

        const importedValue = normalizedIntegratedFields[target.propertyName];
        if (!target.isEmpty(importedValue)) return;

        const currentValue = localStorage.getItem(target.storageKey);
        if (currentValue === null) return;

        // 현재 값이 손상돼 파싱할 수 없는 경우에도 유일한 복구 원본일 수 있으므로,
        // 빈 백업으로 덮어쓰기 전에 반드시 삭제 경고를 표시합니다.
        try {
            if (!target.hasMeaningfulCurrentData(currentValue)) return;
        } catch (error) {
            console.warn(`${target.label}의 현재 저장값을 확인하지 못해 삭제 대상으로 보수적으로 처리합니다.`, error);
        }
        clearedCurrentDataLabels.push(target.label);
    });

    return { targetLabels, clearedCurrentDataLabels };
};


const validateSimplenoteNotesCollection = (notes, fieldName, { optional = false } = {}) => {
    if (notes === undefined && optional) return [];
    if (!Array.isArray(notes)) {
        throw new Error(`Simplenote 백업의 ${fieldName} 항목은 배열이어야 합니다.`);
    }

    notes.forEach((note, index) => {
        if (!note || typeof note !== 'object' || Array.isArray(note)) {
            throw new Error(`Simplenote 백업의 ${fieldName}[${index}] 항목이 올바른 노트 객체가 아닙니다.`);
        }

        if (note.content !== undefined && note.content !== null && typeof note.content === 'object') {
            throw new Error(`Simplenote 백업의 ${fieldName}[${index}].content 형식이 올바르지 않습니다.`);
        }

        if (note.tags !== undefined && note.tags !== null) {
            if (!Array.isArray(note.tags)
                || note.tags.some(tag => tag !== null && typeof tag === 'object')) {
                throw new Error(`Simplenote 백업의 ${fieldName}[${index}].tags 형식이 올바르지 않습니다.`);
            }
        }

        if (note.pinned !== undefined && note.pinned !== null && typeof note.pinned !== 'boolean') {
            throw new Error(`Simplenote 백업의 ${fieldName}[${index}].pinned 형식이 올바르지 않습니다.`);
        }
    });

    return notes;
};

const normalizeSimplenoteContent = (note) => String(note?.content ?? '');

const getSimplenoteTitle = (content, createdAt) => {
    const firstNonEmptyLine = String(content ?? '').split('\n').find(line => line.trim() !== '');
    return (firstNonEmptyLine ? firstNonEmptyLine.trim().slice(0, 100) : null)
        || `가져온 노트 ${new Date(createdAt).toLocaleDateString()}`;
};

const appendSimplenoteTags = (content, tags) => {
    const safeTags = Array.isArray(tags)
        ? tags
            .map(tag => String(tag ?? '').trim())
            .filter(Boolean)
            .map(tag => tag.startsWith('#') ? tag : `#${tag}`)
        : [];

    if (safeTags.length === 0) return content;
    const tagString = safeTags.join(' ');
    return String(content ?? '').trim().length > 0
        ? `${content}\n\n${tagString}`
        : tagString;
};

const restoreImportBackupPayload = async (backupPayload) => {
    if (!backupPayload || typeof backupPayload !== 'object' || Array.isArray(backupPayload)) {
        throw new Error('가져오기 백업 데이터가 없습니다.');
    }

    const assertRestorableAppStateSnapshot = appStateSnapshot => {
        let verification;
        try {
            verification = verifyAndSanitizeLoadedData(
                JSON.parse(JSON.stringify(appStateSnapshot))
            );
        } catch (error) {
            throw new Error('가져오기 백업의 주 데이터를 검증할 수 없습니다.');
        }
        if (verification.isTopLevelInvalid) {
            throw new Error('가져오기 백업의 주 데이터 구조가 손상되었습니다.');
        }
    };

    // 이전 버전은 appState_backup에 래퍼가 아닌 appState 자체를 저장했습니다.
    // 이를 새 형식으로 해석하면 appState와 로컬 설정을 모두 삭제하게 되므로,
    // 원본 상태만 복원하고 당시 백업 대상이 아니었던 로컬 데이터는 유지합니다.
    const isLegacyRawAppStateBackup = Array.isArray(backupPayload.folders)
        && !Object.prototype.hasOwnProperty.call(backupPayload, 'appState')
        && !Object.prototype.hasOwnProperty.call(backupPayload, 'hadAppState');
    if (isLegacyRawAppStateBackup) {
        assertRestorableAppStateSnapshot(backupPayload);
        await storageSet({ appState: backupPayload });
        return;
    }

    const hasBackupField = propertyName =>
        Object.prototype.hasOwnProperty.call(backupPayload, propertyName);
    const hasHadAppStateField = hasBackupField('hadAppState');
    const hasAppStateField = hasBackupField('appState');

    // [CRITICAL BUG FIX] 불완전하거나 손상된 래퍼를 정상 백업으로 오인하면 appState를
    // undefined로 덮어쓰거나 삭제한 뒤 복구본까지 정리할 수 있습니다. 실제 복원에
    // 들어가기 전에 상태 표시와 주 데이터 스냅샷의 일관성을 먼저 확인합니다.
    if (!hasHadAppStateField && !hasAppStateField) {
        throw new Error('가져오기 백업에 주 데이터 상태 정보가 없습니다.');
    }
    if (hasHadAppStateField && typeof backupPayload.hadAppState !== 'boolean') {
        throw new Error('가져오기 백업의 주 데이터 상태 표시가 올바르지 않습니다.');
    }

    // 새 백업은 hadAppState를 기록합니다. 구버전 래퍼는 appState 존재 여부로 호환 처리합니다.
    const hadAppState = hasHadAppStateField
        ? backupPayload.hadAppState
        : backupPayload.appState != null;

    if (hadAppState && (!hasAppStateField || backupPayload.appState == null)) {
        throw new Error('가져오기 백업에서 복원할 주 데이터를 찾을 수 없습니다.');
    }
    if (!hadAppState && hasAppStateField && backupPayload.appState != null) {
        throw new Error('가져오기 백업의 주 데이터 상태가 서로 일치하지 않습니다.');
    }
    if (hadAppState) {
        assertRestorableAppStateSnapshot(backupPayload.appState);
    }

    const localStorageBackupFields = [
        ['session', CONSTANTS.LS_KEY],
        ['settings', CONSTANTS.LS_KEY_SETTINGS],
        ['habitTrackerData', HABIT_TRACKER_DATA_KEY],
        ['dietChallengeData', DIET_CHALLENGE_DATA_KEY],
        ['dietChallengeSettings', DIET_CHALLENGE_SETTINGS_KEY]
    ];

    // 모든 보조 스냅샷도 쓰기 전에 검증합니다. 내부 백업은 문자열 또는 null만
    // 기록하므로 다른 형식은 손상으로 간주하고, 부분 복원 대신 다음 재시도를 위해 중단합니다.
    localStorageBackupFields.forEach(([propertyName]) => {
        if (!hasBackupField(propertyName)) return;
        const value = backupPayload[propertyName];
        if (value !== null && typeof value !== 'string') {
            throw new Error(`가져오기 백업의 ${propertyName} 값이 올바르지 않습니다.`);
        }
    });

    if (hadAppState) {
        // 실패한 가져오기의 롤백은 직전 값을 바이트 의미상 그대로 되돌립니다.
        // 정제는 다음 정상 로드에서 수행하며, 복구 불가능한 최상위 값은 덮어쓰지 않고 중단합니다.
        await storageSet({ appState: backupPayload.appState });
    } else {
        await storageRemove('appState');
    }

    // 구버전 래퍼에 없던 보조 필드는 당시 백업 대상이 아니므로 현재 값을 보존합니다.
    // 캡처됐다고 명시된 필드만 원래 값으로 복원합니다.
    const capturedLocalStorageFields = localStorageBackupFields.filter(([propertyName]) => (
        hasBackupField(propertyName)
    ));

    // 대용량 가져오기가 중간에 실패했을 때 기존 값을 현재 가져온 값 위에
    // 하나씩 덮어쓰면, 최종 원본 크기는 한도 이내여도 복원 중의 임시 합계가
    // 한도를 넘어 롤백이 영구적으로 반복 실패할 수 있습니다. 캡처한 키만 먼저
    // 비워 임시 공간을 확보한 다음, 이미 검증한 원본 스냅샷을 순서대로 복원합니다.
    capturedLocalStorageFields.forEach(([, storageKey]) => {
        localStorage.removeItem(storageKey);
    });
    capturedLocalStorageFields.forEach(([propertyName, storageKey]) => {
        restoreLocalStorageValue(storageKey, backupPayload[propertyName]);
    });
};

export const setupImportHandler = () => {
    if (!importFileInput) {
        console.error('Import handler was not registered: import file input element was not found.');
        return;
    }

    importFileInput.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;

        // 첫 번째 FileReader가 끝나기 전에 두 번째 파일이 선택되면
        // 서로 다른 확인 모달·롤백 백업·재시작 타이머가 겹칠 수 있습니다.
        if (importOperationInProgress) {
            showToast('이미 다른 데이터 가져오기가 진행 중이어서 새 파일을 열지 않았습니다.', CONSTANTS.TOAST_TYPE.ERROR);
            e.target.value = '';
            return;
        }
        importOperationInProgress = true;

        // 백업 파일 크기를 임의로 5MB로 제한하지 않습니다.
        // 핵심 노트 데이터는 chrome.storage.local에 저장되며, manifest의
        // unlimitedStorage 권한으로 기본 저장 용량 한도를 초과할 수 있습니다.
        // 실제 저장 실패 시에는 아래의 트랜잭션/롤백 로직이 기존 데이터를 보호합니다.
        const reader = new FileReader();
        reader.onload = async event => {
            let overlay = null;
            let importBackupCreated = false;
            let importMutationStarted = false;
            let importRollbackCompleted = false;
            let importRollbackFailed = false;
            let importCommitted = false;
            let importReloadScheduled = false;

            const scheduleImportReload = () => {
                const reloadTimer = setTimeout(() => {
                    try {
                        window.location.reload();
                    } catch (reloadError) {
                        console.error('Import completed, but the automatic reload failed.', reloadError);
                        window.isImportReloadPending = false;
                        window.isImporting = false;
                        window.isReplacementImportActive = false;
                        importOperationInProgress = false;
                        if (overlay?.parentElement) overlay.remove();
                        void showAlert({
                            title: '📥 가져오기 완료',
                            message: '데이터 적용은 완료되었지만 화면을 자동으로 다시 시작하지 못했습니다. 새 탭을 다시 열어주세요.',
                            confirmText: '✅ 확인'
                        });
                    }
                }, 500);

                // setTimeout 등록이 성공한 뒤에만 finally에서 화면 잠금을 유지합니다.
                if (reloadTimer !== undefined) {
                    importReloadScheduled = true;
                    window.isImportReloadPending = true;
                }
            };

            try {
                const importedData = JSON.parse(event.target.result);
                // [보안 수정] Prototype Pollution 방지를 위해 파일에서 읽어온 데이터를 정제합니다.
                sanitizeObjectForPrototypePollution(importedData);

                // [기능 추가] Simplenote 백업 파일인지 확인
                // [MAJOR BUG FIX] MothNote 백업에 activeNotes 확장 필드가 있어도 Simplenote로
                // 오인해 폴더 구조를 무시하고 병합하지 않도록 자사 백업 표식을 우선합니다.
                const isMothNoteBackup = isPlainImportObject(importedData)
                    && (Object.prototype.hasOwnProperty.call(importedData, 'mothNoteVersion')
                        || Array.isArray(importedData.folders));
                const isSimplenoteBackup = isPlainImportObject(importedData)
                    && !isMothNoteBackup
                    && Array.isArray(importedData.activeNotes);
                if (isSimplenoteBackup) {
                    // [MAJOR BUG FIX] 일부 손상 항목만 조용히 제외한 채 성공 처리하면 사용자가
                    // 백업 전체가 복원됐다고 오인할 수 있으므로, 변환 전에 두 목록을 모두 검증합니다.
                    const activeSimplenoteNotes = validateSimplenoteNotesCollection(
                        importedData.activeNotes,
                        'activeNotes'
                    );
                    const trashedSimplenoteNotes = validateSimplenoteNotesCollection(
                        importedData.trashedNotes,
                        'trashedNotes',
                        { optional: true }
                    );

                    if (activeSimplenoteNotes.length === 0 && trashedSimplenoteNotes.length === 0) {
                        showAlert({
                            title: '📥 Simplenote 가져오기 실패',
                            message: '가져올 수 있는 Simplenote 노트가 없습니다. 백업 파일의 activeNotes 또는 trashedNotes 항목을 확인해주세요.',
                            confirmText: '✅ 확인'
                        });
                        e.target.value = '';
                        return;
                    }

                    const confirmSimpleImport = await showConfirm({
                        title: '📥 Simplenote 백업 가져오기',
                        message: `Simplenote 백업 파일이 감지되었습니다. 가져올 수 있는 노트 ${activeSimplenoteNotes.length + trashedSimplenoteNotes.length}개를 변환할까요? (기존 데이터는 유지됩니다)`,
                        isHtml: true, confirmText: '📥 예, 가져옵니다', confirmButtonType: 'confirm'
                    });

                    if (!confirmSimpleImport) { e.target.value = ''; return; }
                    if (!(await flushPendingChangesForDataOperation('Simplenote 가져오기'))) return;

                    window.isImporting = true;
                    window.isImportReloadPending = false;
                    overlay = document.createElement('div');
                    overlay.className = 'import-overlay';
                    overlay.tabIndex = -1;
                    overlay.innerHTML = `<div class="import-indicator-box"><div class="import-spinner"></div><p class="import-message">Simplenote 데이터를 변환하는 중...</p></div>`;
                    document.body.appendChild(overlay);
                    overlay.focus({ preventScroll: true });

                    const { performTransactionalUpdate } = await import('./itemActions.js');
                    const { success } = await performTransactionalUpdate((latestData) => {
                        const now = Date.now();
                        const allExistingIds = new Set();
                        latestData.folders.forEach(f => {
                            allExistingIds.add(f.id);
                            f.notes.forEach(n => allExistingIds.add(n.id));
                        });
                        latestData.trash.forEach(item => {
                           allExistingIds.add(item.id);
                           if (item.type === 'folder' && Array.isArray(item.notes)) {
                               item.notes.forEach(note => allExistingIds.add(note.id));
                           }
                        });

                        // 1. 고유한 폴더 이름 찾기
                        const existingFolderNameKeys = new Set(
                            latestData.folders.map(folder => String(folder?.name ?? '').trim().toLowerCase())
                        );
                        let folderName = "Simplenote";
                        let counter = 1;
                        while (existingFolderNameKeys.has(folderName.toLowerCase())) {
                            folderName = `Simplenote (${counter++})`;
                        }

                        // 2. 새 폴더 생성
                        const newFolderId = generateUniqueId(CONSTANTS.ID_PREFIX.FOLDER, allExistingIds);
                        allExistingIds.add(newFolderId);
                        const newFolder = {
                            id: newFolderId,
                            name: folderName,
                            notes: [],
                            createdAt: now,
                            updatedAt: now
                        };

                        // 3. activeNotes를 새 폴더로 변환
                        activeSimplenoteNotes.forEach(note => {
                            let content = normalizeSimplenoteContent(note);
                            const createdAt = parseSimplenoteTimestamp(note.creationDate, now);
                            const updatedAt = parseSimplenoteTimestamp(note.lastModified, createdAt);
                            const title = getSimplenoteTitle(content, createdAt);
                            content = appendSimplenoteTags(content, note.tags);

                            const newNoteId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, allExistingIds);
                            allExistingIds.add(newNoteId);
                            
                            newFolder.notes.push({
                                id: newNoteId,
                                title: title,
                                content: content,
                                createdAt: createdAt,
                                updatedAt: updatedAt,
                                // [수정] 고정된 노트(Pinned Note) 상태 유지
                                isPinned: note.pinned === true
                            });
                        });

                        if (newFolder.notes.length > 0) {
                            latestData.folders.push(newFolder);
                        }

                        // 4. trashedNotes를 휴지통으로 변환
                        trashedSimplenoteNotes.forEach(note => {
                            let content = normalizeSimplenoteContent(note);
                            const createdAt = parseSimplenoteTimestamp(note.creationDate, now);
                            const updatedAt = parseSimplenoteTimestamp(note.lastModified, createdAt);
                            const title = getSimplenoteTitle(content, createdAt);
                            content = appendSimplenoteTags(content, note.tags);

                            const newNoteId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, allExistingIds);
                            allExistingIds.add(newNoteId);

                            latestData.trash.unshift({
                                id: newNoteId,
                                title: title,
                                content: content,
                                createdAt: createdAt,
                                updatedAt: updatedAt,
                                isPinned: note.pinned === true,
                                type: 'note',
                                deletedAt: now,
                                originalFolderId: null
                            });
                        });
                        
                        return { newData: latestData, successMessage: null };
                    });

                    if (success) {
                        showToast("✅ Simplenote 데이터를 성공적으로 가져왔습니다! 앱을 다시 시작합니다.", CONSTANTS.TOAST_TYPE.SUCCESS);
                        scheduleImportReload();
                    } else {
                        showAlert({ title: '오류', message: 'Simplenote 데이터를 가져오는 중 오류가 발생했습니다.' });
                    }
                    
                    return; // Simplenote 가져오기 로직 종료
                }
                
                // [기존 로직] MothNote 백업 파일 처리
                // 통합 백업의 부가 데이터도 주 노트 데이터와 동일하게 쓰기 전에 검증합니다.
                // 잘못된 선택 필드 하나가 정상 습관·다이어트 데이터를 빈 상태로 덮어쓴 뒤
                // 완료 백업까지 삭제하는 데이터 유실을 방지합니다.
                const {
                    normalized: normalizedIntegratedFields,
                    skippedFields: skippedIntegratedFields
                } = normalizeIntegratedImportFields(importedData);
                const sanitizedContent = sanitizeContentData(importedData);
                const {
                    targetLabels: integratedImportTargetLabels,
                    clearedCurrentDataLabels
                } = getIntegratedImportImpact(normalizedIntegratedFields);
                
                const hasOwnImportedField = (propertyName) => Object.prototype.hasOwnProperty.call(importedData, propertyName);
                const hasSettingsField = hasOwnImportedField('settings');
                let hasSettingsInFile = false;
                let sanitizedSettings = null;
                const skippedImportFields = [...skippedIntegratedFields];
                if (hasSettingsField) {
                    try {
                        sanitizedSettings = normalizeAppSettingsImportValue(importedData.settings);
                        hasSettingsInFile = true;
                    } catch (settingsError) {
                        // [MAJOR BUG FIX] settings 객체 자체뿐 아니라 내부 하위 필드가 손상된 경우에도
                        // 기본값으로 조용히 치환해 현재 설정을 잃지 않도록 해당 설정 복원만 건너뜁니다.
                        console.warn('설정 백업이 손상되어 해당 항목만 건너뜁니다.', settingsError);
                        skippedImportFields.unshift('설정');
                    }
                }

                const skippedImportFieldsWarning = skippedImportFields.length > 0
                    ? `<br><br><strong>⚠️ 손상된 부가 데이터는 건너뜁니다.</strong><br>${skippedImportFields.map(escapeHtml).join(', ')} 항목은 복원하지 않고 현재 데이터를 유지합니다.`
                    : '';
                const overwriteTargetLabels = [
                    '모든 노트',
                    ...(hasSettingsInFile ? ['설정'] : []),
                    ...integratedImportTargetLabels
                ];
                const overwriteTarget = overwriteTargetLabels.map(escapeHtml).join(', ');
                const clearedCurrentDataWarning = clearedCurrentDataLabels.length > 0
                    ? `<br><br><strong>🚨 현재 데이터가 비워지는 항목:</strong><br>${clearedCurrentDataLabels.map(escapeHtml).join(', ')}`
                    : '';

                const firstConfirm = await showConfirm({
                    title: CONSTANTS.MODAL_TITLES.IMPORT_DATA,
                    message: `가져오기를 실행하면 현재 데이터 중 <strong>${overwriteTarget}</strong> 항목을 파일 내용으로 교체합니다.${clearedCurrentDataWarning}${skippedImportFieldsWarning}<br><br>이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?`,
                    isHtml: true, confirmText: '📥 가져와서 덮어쓰기', confirmButtonType: 'danger'
                });

                if (!firstConfirm) { e.target.value = ''; return; }

                if (clearedCurrentDataLabels.length > 0) {
                    const clearIntegratedDataConfirm = await showConfirm({
                        title: '🚨 부가 데이터 삭제 경고',
                        message: `선택한 백업의 해당 항목이 비어 있어 현재의 <strong>${clearedCurrentDataLabels.map(escapeHtml).join(', ')}</strong> 데이터가 영구적으로 삭제됩니다.<br><br>정말로 이 데이터를 비우시겠습니까?`,
                        isHtml: true,
                        confirmText: '💥 예, 해당 데이터를 삭제합니다',
                        confirmButtonType: 'danger'
                    });
                    if (!clearIntegratedDataConfirm) {
                        showToast('데이터 가져오기 작업이 취소되었습니다.', CONSTANTS.TOAST_TYPE.ERROR);
                        e.target.value = '';
                        return;
                    }
                }

                if (sanitizedContent.folders.length === 0 && sanitizedContent.trash.length === 0) {
                    const finalConfirm = await showConfirm({
                        title: '⚠️ 빈 데이터 경고',
                        message: "가져올 파일에 노트나 폴더가 없습니다.<br><br>계속 진행하면 현재의 모든 데이터가 <strong>영구적으로 삭제되고 빈 상태로 초기화됩니다.</strong><br><br>정말로 모든 데이터를 지우시겠습니까?",
                        isHtml: true, confirmText: '💥 예, 모든 데이터를 삭제합니다', confirmButtonType: 'danger'
                    });
                    if (!finalConfirm) { showToast("데이터 가져오기 작업이 취소되었습니다.", CONSTANTS.TOAST_TYPE.ERROR); e.target.value = ''; return; }
                }
                
                if (!(await flushPendingChangesForDataOperation('데이터 가져오기'))) return;

                const importPayload = {
                    folders: sanitizedContent.folders,
                    trash: sanitizedContent.trash,
                    favorites: Array.from(new Set(sanitizedContent.favorites)),
                    lastActiveNotePerFolder: sanitizedContent.lastActiveNotePerFolder || {},
                    lastSavedTimestamp: Date.now()
                };

                // 최종 flush가 끝난 직후부터 편집·클릭을 차단합니다. 기존에는
                // 롤백 백업 생성을 기다린 뒤에야 오버레이가 열려, 그 사이에 생긴
                // 오래된 저장 작업이 가져온 appState에 뒤늦게 반영될 수 있었습니다.
                window.isReplacementImportActive = true;
                window.isImporting = true;
                window.isImportReloadPending = false;

                overlay = document.createElement('div');
                overlay.className = 'import-overlay';
                overlay.tabIndex = -1;
                overlay.innerHTML = `<div class="import-indicator-box"><div class="import-spinner"></div><p class="import-message">데이터를 적용하는 중입니다...</p></div>`;
                document.body.appendChild(overlay);
                overlay.focus({ preventScroll: true });

                // 가져오기 전체를 하나의 appState 저장 경계 안에서 수행합니다.
                // 실패 시 같은 경계 안에서 원본을 복원해 가져오기 실패 시 원본 복구 안정성을 유지합니다.
                const importApplied = await withAppStateWriteLock(async () => {
                    const currentDataResult = await storageGet('appState');
                    const hasCurrentAppState = Object.prototype.hasOwnProperty.call(currentDataResult, 'appState')
                        && currentDataResult.appState != null;
                    const backupPayload = {
                        hadAppState: hasCurrentAppState,
                        appState: hasCurrentAppState ? currentDataResult.appState : null,
                        session: localStorage.getItem(CONSTANTS.LS_KEY),
                        settings: localStorage.getItem(CONSTANTS.LS_KEY_SETTINGS),
                        habitTrackerData: localStorage.getItem(HABIT_TRACKER_DATA_KEY),
                        dietChallengeData: localStorage.getItem(DIET_CHALLENGE_DATA_KEY),
                        dietChallengeSettings: localStorage.getItem(DIET_CHALLENGE_SETTINGS_KEY)
                    };

                    try {
                        // 이전 정리 실패로 플래그 없이 이전 작업에서 남은 백업을 먼저 제거합니다.
                        // 이 단계를 생략하고 진행 플래그를 먼저 기록한 직후 탭이 종료되면,
                        // 다음 시작에서 과거 백업을 이번 가져오기의 복구본으로 오인하여
                        // 현재 전체 노트 데이터를 오래된 상태로 되돌릴 수 있습니다.
                        await storageRemove('appState_backup');

                        // 작업에서 남은 백업이 없는 상태에서 진행 플래그를 먼저 기록합니다. 이 쓰기가 실패하면 아직
                        // 어떤 사용자 데이터도 변경되지 않았으므로 파괴적인 롤백이 필요 없습니다.
                        // 플래그 뒤 새 백업 생성 중 종료되더라도 다음 시작은 '백업 없음' 상태를
                        // 안전하게 정리하고, 새 백업이 생성됐다면 기존 자동 복구가 동작합니다.
                        localStorage.setItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS, 'true');
                        await storageSet({ appState_backup: backupPayload });
                        importBackupCreated = true;
                    } catch (backupError) {
                        try {
                            localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
                        } catch (statusCleanupError) {
                            console.warn('Import preparation flag cleanup failed.', statusCleanupError);
                        }
                        console.error('Import failed: Could not prepare a recoverable backup.', backupError);
                        showAlert({
                            title: '📥 가져오기 실패',
                            message: '안전한 복구 백업을 준비하지 못했습니다. 기존 데이터는 변경되지 않았습니다.',
                            confirmText: '✅ 확인'
                        });
                        return false;
                    }

                    const restoreImportedLocalStorageValueIfPresent = (key, propertyName) => {
                        if (!Object.prototype.hasOwnProperty.call(normalizedIntegratedFields, propertyName)) return;
                        restoreLocalStorageValue(key, normalizedIntegratedFields[propertyName]);
                    };

                    try {
                        // 이 시점부터만 실제 사용자 데이터가 바뀔 수 있습니다. 준비 단계의
                        // UI/브라우저 오류를 데이터 변경 실패로 오인해 원본 localStorage를
                        // 지우며 롤백하지 않도록 별도로 추적합니다.
                        importMutationStarted = true;
                        await storageSet({ appState: importPayload });
                        // 설정 필드가 없거나 손상돼 건너뛴 백업은 현재 설정을 바이트 단위로 보존합니다.
                        // 정제본/기본값을 다시 쓰면 "현재 설정 유지" 안내와 달리 알 수 없는 필드나
                        // 복구 가능한 원본을 조용히 잃을 수 있습니다.
                        if (hasSettingsInFile) {
                            localStorage.setItem(CONSTANTS.LS_KEY_SETTINGS, JSON.stringify(sanitizedSettings));
                        }

                        restoreImportedLocalStorageValueIfPresent(HABIT_TRACKER_DATA_KEY, 'habitTrackerData');
                        restoreImportedLocalStorageValueIfPresent(DIET_CHALLENGE_DATA_KEY, 'dietChallengeData');
                        restoreImportedLocalStorageValueIfPresent(DIET_CHALLENGE_SETTINGS_KEY, 'dietChallengeSettings');

                        // 교체 가져오기 뒤에는 이전 화면의 세션을 재사용하지 않습니다. 남겨 두면
                        // 다음 로드에서 가져온 lastActiveNotePerFolder보다 기존 세션이 우선되어
                        // 복원 직후의 선택 상태가 가져오기 전 값으로 되돌아갈 수 있습니다.
                        localStorage.removeItem(CONSTANTS.LS_KEY);
                        localStorage.setItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS, 'done');
                        return true;
                    } catch (applyError) {
                        try {
                            await restoreImportBackupPayload(backupPayload);
                            await storageRemove('appState_backup');
                            localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
                            importRollbackCompleted = true;
                        } catch (restoreError) {
                            importRollbackFailed = true;
                            console.error('CRITICAL: Failed to restore import backup while lock was held.', restoreError);
                            // 백업과 진행 플래그를 남겨 다음 실행의 자동 복구가 다시 시도하도록 합니다.
                        }
                        throw applyError;
                    }
                });

                if (!importApplied) return;
                importCommitted = true;

                showToast(CONSTANTS.MESSAGES.SUCCESS.IMPORT_RELOAD, CONSTANTS.TOAST_TYPE.SUCCESS);
                scheduleImportReload();

            } catch (err) {
                console.error('Import failed critically:', err);

                if (importCommitted) {
                    // 데이터 적용은 완료됐고 성공 플래그도 기록되었습니다. UI 후처리 오류 때문에
                    // 이미 완료된 가져오기를 되돌리지 않고 재시작만 안내합니다.
                    showAlert({
                        title: '📥 가져오기 완료',
                        message: '데이터 적용은 완료되었지만 화면 갱신 중 오류가 발생했습니다. 새 탭을 다시 열어주세요.',
                        confirmText: '✅ 확인'
                    });
                } else if (importRollbackCompleted) {
                    let message = '가져오기 중 오류가 발생하여 이전 데이터로 안전하게 복원했습니다.';
                    if (err?.message?.toLowerCase().includes('quota')) {
                        message = '저장 공간 문제로 가져오기에 실패했으며, 이전 데이터로 안전하게 복원했습니다.';
                    }
                    showAlert({ title: '📥 가져오기 실패', message, confirmText: '✅ 확인' });
                } else if (importRollbackFailed) {
                    showAlert({
                        title: '‼️ 심각한 오류',
                        message: '가져오기 실패 후 즉시 복원하지 못했습니다. 복구 백업은 보존되어 있으며, 새 탭을 다시 열면 자동 복구를 다시 시도합니다.',
                        confirmText: '✅ 확인'
                    });
                } else if (importBackupCreated && importMutationStarted) {
                    // 잠금 내부 복구 전에 예외가 난 극단적 상황에 대한 최후의 안전망입니다.
                    try {
                        await withAppStateWriteLock(async () => {
                            const backupResult = await storageGet('appState_backup');
                            if (!backupResult.appState_backup) throw new Error('복구 백업을 찾을 수 없습니다.');
                            await restoreImportBackupPayload(backupResult.appState_backup);
                            await storageRemove('appState_backup');
                            localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
                        });
                        showAlert({
                            title: '📥 가져오기 실패',
                            message: '가져오기 중 오류가 발생하여 이전 데이터로 복원했습니다.',
                            confirmText: '✅ 확인'
                        });
                    } catch (restoreError) {
                        console.error('CRITICAL: Fallback import rollback failed.', restoreError);
                        showAlert({
                            title: '‼️ 심각한 오류',
                            message: '가져오기 복원에 실패했습니다. 복구 백업을 보존했으므로 새 탭을 다시 열어 자동 복구를 시도해주세요.',
                            confirmText: '✅ 확인'
                        });
                    }
                } else if (importBackupCreated) {
                    // 백업 이후 실제 데이터 쓰기 전에 실패한 경우입니다. 원본은 전혀
                    // 변경되지 않았으므로 복원 루틴(기존 localStorage 키 선삭제 포함)을
                    // 실행하지 않고 준비용 플래그와 백업만 정리합니다.
                    try {
                        await withAppStateWriteLock(async () => {
                            localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
                            await storageRemove('appState_backup');
                        });
                        showAlert({
                            title: '📥 가져오기 실패',
                            message: '가져오기 준비 중 오류가 발생했습니다. 기존 데이터는 변경되지 않았습니다.',
                            confirmText: '✅ 확인'
                        });
                    } catch (cleanupError) {
                        console.error('Import preparation cleanup failed. The original data was not mutated.', cleanupError);
                        showAlert({
                            title: '📥 가져오기 실패',
                            message: '가져오기 준비 중 오류가 발생했습니다. 기존 데이터는 변경되지 않았으며, 남은 복구 정보는 다음 실행에서 안전하게 확인됩니다.',
                            confirmText: '✅ 확인'
                        });
                    }
                } else {
                    try {
                        localStorage.removeItem(CONSTANTS.LS_KEY_IMPORT_IN_PROGRESS);
                    } catch (statusCleanupError) {
                        console.warn('Import status cleanup failed after a pre-mutation error.', statusCleanupError);
                    }
                    showAlert({
                        title: '📥 가져오기 실패',
                        message: `파일을 처리하지 못했습니다. 기존 데이터는 변경되지 않았습니다. (오류: ${err?.message || '알 수 없는 오류'})`,
                        confirmText: '✅ 확인'
                    });
                }
            } finally {
                if (importReloadScheduled) {
                    const importMessage = overlay?.querySelector('.import-message');
                    if (importMessage) importMessage.textContent = '데이터 적용을 완료했습니다. 앱을 다시 시작하는 중입니다...';
                } else {
                    window.isImportReloadPending = false;
                    window.isImporting = false;
                    window.isReplacementImportActive = false;
                    importOperationInProgress = false;
                    if (overlay?.parentElement) overlay.remove();
                }
                e.target.value = '';
            }
        };
        reader.onerror = () => {
            console.error('Backup file read failed:', reader.error);
            showToast(CONSTANTS.MESSAGES.ERROR.IMPORT_FILE_READ_FAILURE, CONSTANTS.TOAST_TYPE.ERROR);
            importOperationInProgress = false;
            window.isImportReloadPending = false;
            window.isImporting = false;
            window.isReplacementImportActive = false;
            e.target.value = '';
        };
        reader.onabort = () => {
            console.warn('Backup file read was aborted.');
            showToast(CONSTANTS.MESSAGES.ERROR.IMPORT_FILE_READ_FAILURE, CONSTANTS.TOAST_TYPE.ERROR);
            importOperationInProgress = false;
            window.isImportReloadPending = false;
            window.isImporting = false;
            window.isReplacementImportActive = false;
            e.target.value = '';
        };
        try {
            reader.readAsText(file);
        } catch (readStartError) {
            console.error('Backup file read could not be started:', readStartError);
            showToast(CONSTANTS.MESSAGES.ERROR.IMPORT_FILE_READ_FAILURE, CONSTANTS.TOAST_TYPE.ERROR);
            importOperationInProgress = false;
            window.isImportReloadPending = false;
            window.isImporting = false;
            window.isReplacementImportActive = false;
            e.target.value = '';
        }
    };
};
