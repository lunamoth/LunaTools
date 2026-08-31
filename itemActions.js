// itemActions.js

// [설계 전제 / 수정 금지선]
// 이 앱은 여러 탭에서 동일한 문서를 동시에 편집하는 것 자체를 지원하지 않고, 가정하지도 않습니다.
// itemActions.js의 트랜잭션 경계는 단일 활성 문서에서 발생하는 저장/렌더/이름변경 순서를 안정화하기 위한 것입니다.
// cross-tab 동기화, 문서 컨텍스트 간 병합, localStorage lease lock, storage event 기반 조정 로직을 추가하지 않습니다.

// [버그 수정] 순환 참조 해결을 위해 generateUniqueId를 state.js에서 가져오도록 수정합니다.
import { state, setState, findFolder, findNote, CONSTANTS, buildNoteMap, generateUniqueId } from './state.js';
// [버그 수정] storage.js에 추가된 Promise 래퍼와 저장 데이터 무결성 검사 함수를 가져옵니다.
import { storageGet, storageSet, verifyAndSanitizeLoadedData, saveSession } from './storage.js';
import { withAppStateWriteLock } from './storageLock.js';
import {
    noteList, folderList, noteTitleInput, noteContentTextarea,
    showConfirm, showPrompt, showToast, sortNotes, showAlert, showFolderSelectPrompt,
    editorContainer,
    addNoteBtn,
    formatDate,
    noteContentView
} from './components.js';
// [버그 수정] 현재 UI에 표시된 노트 목록 캐시('sortedNotesCache')를 가져오기 위해 import 구문 수정
import { updateSaveStatus, clearSortedNotesCache, sortedNotesCache } from './renderer.js';
import { changeActiveFolder, changeActiveNote, confirmNavigation } from './navigationActions.js';

let autoSaveTimer = null; // 자동 저장을 위한 타이머
let pendingTransactionalUpdateCount = 0;

// CSS.escape가 없는 브라우저/테스트 환경에서도 data-id 선택자가 안전하게 동작하도록 폴백을 제공합니다.
const escapeCssAttributeValue = (value) => {
    const stringValue = String(value ?? '');
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(stringValue);
    }
    return stringValue
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/[\n\r\f]/g, ' ');
};

export const parseYYYYMMDDLocal = (value) => {
    if (typeof value !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return null;

    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, monthIndex, day);

    // 2026-02-31처럼 자동 보정되는 잘못된 날짜는 거부합니다.
    if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) {
        return null;
    }
    return date;
};

export const toYYYYMMDD = (dateInput) => {
    if (!dateInput) return null;
    const date = dateInput instanceof Date
        ? dateInput
        : (parseYYYYMMDDLocal(dateInput) || new Date(dateInput));
    if (isNaN(date.getTime())) return null;

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

export const updateNoteCreationDates = () => {
    state.noteCreationDates.clear();
    const allNotes = [...Array.from(state.noteMap.values()).map(e => e.note)];
    
    for (const note of allNotes) {
        if (note.createdAt) {
            const dateStr = toYYYYMMDD(note.createdAt);
            if (dateStr) {
                state.noteCreationDates.add(dateStr);
            }
        }
    }
};

let pendingRenamePromise = null;
let pendingRenameCompletionPromise = null;
let resolvePendingRename = null;
let pendingRenameCleanup = null;
let pendingRenameDraft = null;
let isStartingRename = false;

// beforeunload에서는 비동기 이름 변경을 끝낼 수 없습니다. 렌더 도중 편집 DOM이
// 교체되더라도 input 이벤트가 보존한 최신 초안을 비상 복구에 사용할 수 있게 합니다.
export const getPendingRenameEmergencySnapshot = () => {
    if (!pendingRenamePromise
        || !pendingRenameDraft
        || state.renamingItemId !== pendingRenameDraft.id) {
        return null;
    }

    const id = String(pendingRenameDraft.id ?? '');
    const type = pendingRenameDraft.type;
    const newName = String(pendingRenameDraft.newName ?? '').trim();
    const isSupportedType = type === CONSTANTS.ITEM_TYPE.FOLDER
        || type === CONSTANTS.ITEM_TYPE.NOTE;

    return id && isSupportedType && newName
        ? { id, type, newName }
        : null;
};

export const forceResolvePendingRename = () => {
    if (state.renamingItemId || pendingRenamePromise) {
        console.warn('Force resolving a pending rename operation due to external changes.');
    }
    if (pendingRenameCleanup) {
        pendingRenameCleanup();
        pendingRenameCleanup = null;
    }
    setState({ renamingItemId: null });
    if (resolvePendingRename) resolvePendingRename(false);
    resolvePendingRename = null;
    pendingRenamePromise = null;
    pendingRenameCompletionPromise = null;
    pendingRenameDraft = null;
};

// [BUG FIX] 이름 변경 중 다른 작업 실행 시, 변경 사항이 유실되는 'Major' 버그를 수정합니다.
// .blur() 이벤트에 의존하는 대신, 이름 변경 완료 로직을 직접 호출하여 이벤트 경합(Race Condition)을 원천적으로 차단합니다.
export const finishPendingRename = async () => {
    if (pendingRenameCompletionPromise) {
        return await pendingRenameCompletionPromise;
    }

    // 현재 이름 변경 작업이 진행 중인지 확인합니다.
    if (state.renamingItemId && pendingRenamePromise) {
        const id = state.renamingItemId;
        // [CRITICAL BUG FIX] DOMException 방지를 위해 CSS.escape()를 사용하여 ID를 안전하게 만듭니다.
        const safeId = escapeCssAttributeValue(id);
        // DOM에서 이름 변경 중인 li 요소를 찾습니다.
        const renamingElementWrapper = document.querySelector(`.item-list-entry[data-id="${safeId}"]`);
        
        if (!renamingElementWrapper) {
            // 렌더 갱신으로 편집 DOM이 교체돼도 input 이벤트에서 보존한 최신 초안을
            // 정상 이름 변경 경로로 커밋합니다. 초안까지 없을 때만 실패로 전달합니다.
            if (pendingRenameDraft?.id === id) {
                return await _handleRenameEnd(id, pendingRenameDraft.type, {
                    contentEditable: false,
                    isConnected: true,
                    textContent: pendingRenameDraft.newName
                }, true);
            }
            forceResolvePendingRename();
            return false;
        }

        const type = renamingElementWrapper.dataset.type;
        const nameSpan = renamingElementWrapper.querySelector('.item-name');

        if (nameSpan) {
            // 핵심 수정: .blur()를 호출하는 대신, _handleRenameEnd 함수를 직접 호출합니다.
            // 이렇게 하면 이벤트 발생 순서에 상관없이 변경 사항이 안정적으로 저장됩니다.
            // 'true'를 전달하여 변경 내용을 저장하도록 지시하며, _handleRenameEnd의 결과를 직접 반환합니다.
            return await _handleRenameEnd(id, type, nameSpan, true);
        } else {
            // 이름 입력 요소만 교체된 경우에도 캐시된 입력값으로 커밋합니다.
            if (pendingRenameDraft?.id === id) {
                return await _handleRenameEnd(id, pendingRenameDraft.type, {
                    contentEditable: false,
                    isConnected: true,
                    textContent: pendingRenameDraft.newName
                }, true);
            }
            forceResolvePendingRename();
            return false;
        }
    }
    // 렌더 직후 요소를 찾지 못한 과거 경합 상태가 남아 있더라도 앱을 잠그지 않습니다.
    if (state.renamingItemId && !pendingRenamePromise) {
        setState({ renamingItemId: null });
    }
    return true; // 이름 변경 중이 아니면 항상 성공
};

let calendarRenderer = () => {};
export const setCalendarRenderer = (renderer) => {
    calendarRenderer = renderer;
};


const EMERGENCY_BACKUP_CONTENT_KEYS = ['noteUpdate', 'itemRename'];

// beforeunload는 탭 충돌, 브라우저 강제 종료, 프로세스 종료에서 실행이 보장되지 않습니다.
// 편집 이벤트가 발생한 시점에 최소 변경분을 동기적으로 기록해 자동 저장 전의 짧은
// 구간에도 실제 복구 사본이 존재하도록 합니다. 두 편집 유형은 서로 덮어쓰지 않게 병합합니다.
export const persistEmergencyChangesBackupEntry = (entryKey, entryValue) => {
    if (typeof localStorage === 'undefined'
        || !EMERGENCY_BACKUP_CONTENT_KEYS.includes(entryKey)
        || !entryValue
        || typeof entryValue !== 'object'
        || Array.isArray(entryValue)) {
        return false;
    }

    const backupKey = CONSTANTS.LS_KEY_EMERGENCY_CHANGES_BACKUP;
    const backup = {};

    try {
        const rawBackup = localStorage.getItem(backupKey);
        if (rawBackup) {
            try {
                const parsed = JSON.parse(rawBackup);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    EMERGENCY_BACKUP_CONTENT_KEYS.forEach(key => {
                        const existingEntry = parsed[key];
                        if (existingEntry && typeof existingEntry === 'object' && !Array.isArray(existingEntry)) {
                            backup[key] = existingEntry;
                        }
                    });
                }
            } catch (error) {
                // 읽을 수 없는 과거 백업은 다음 시작에서도 복원할 수 없습니다. 현재의
                // 유효한 초안을 우선 보존하고, 손상 값은 새 최소 백업으로 교체합니다.
                console.warn('Malformed emergency backup was replaced with the current valid draft.', error);
            }
        }

        backup[entryKey] = entryValue;
        localStorage.setItem(backupKey, JSON.stringify(backup));
        return true;
    } catch (error) {
        // 입력 흐름을 막거나 토스트를 연속 표시하지 않습니다. 정상 자동 저장과
        // beforeunload의 최종 동기 백업이 계속 재시도할 수 있습니다.
        console.warn('Emergency draft backup could not be persisted.', error);
        return false;
    }
};

export const TRANSACTION_FAILURE_REASON = Object.freeze({
    NO_CHANGE: 'no-change',
    ERROR: 'error',
    IMPORT_IN_PROGRESS: 'import-in-progress'
});

const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const normalizeLastActiveNoteMap = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

    const normalized = {};
    Object.entries(value).forEach(([folderId, noteId]) => {
        const normalizedFolderId = String(folderId ?? '');
        const normalizedNoteId = String(noteId ?? '');
        if (!normalizedFolderId || !normalizedNoteId || UNSAFE_OBJECT_KEYS.has(normalizedFolderId)) return;
        normalized[normalizedFolderId] = normalizedNoteId;
    });
    return normalized;
};

// 트랜잭션 대기 중 사용자가 다른 노트로 이동했을 때, 저장 완료 후 오래된 스냅샷이
// 방금 바뀐 세션 선택을 다시 덮어쓰지 않도록 실제 변경된 키만 결과에 반영합니다.
const mergeConcurrentLastActiveChanges = (transactionMap, sessionSnapshot, currentSessionMap) => {
    const merged = { ...normalizeLastActiveNoteMap(transactionMap) };
    const before = normalizeLastActiveNoteMap(sessionSnapshot);
    const current = normalizeLastActiveNoteMap(currentSessionMap);
    const keys = new Set([...Object.keys(before), ...Object.keys(current)]);

    keys.forEach(key => {
        const existedBefore = Object.prototype.hasOwnProperty.call(before, key);
        const existsNow = Object.prototype.hasOwnProperty.call(current, key);
        if (existedBefore === existsNow && before[key] === current[key]) return;

        if (existsNow) merged[key] = current[key];
        else delete merged[key];
    });

    return merged;
};

export const clearEmergencyChangesBackupEntry = (entryKey, shouldClearEntry) => {
    if (typeof localStorage === 'undefined') return;

    const backupKey = CONSTANTS.LS_KEY_EMERGENCY_CHANGES_BACKUP;
    let rawBackup;
    try {
        rawBackup = localStorage.getItem(backupKey);
    } catch (error) {
        console.warn('Emergency changes backup could not be read; cleanup was skipped.', error);
        return;
    }
    if (!rawBackup) return;

    let backup;
    try {
        backup = JSON.parse(rawBackup);
    } catch (error) {
        console.warn('Emergency changes backup is malformed and will be removed.', error);
        try { localStorage.removeItem(backupKey); } catch (_) { /* noop */ }
        return;
    }

    if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
        try { localStorage.removeItem(backupKey); } catch (_) { /* noop */ }
        return;
    }

    const entry = backup[entryKey];
    if (!entry || (typeof shouldClearEntry === 'function' && !shouldClearEntry(entry))) {
        return;
    }

    delete backup[entryKey];

    try {
        const hasRemainingEmergencyData = EMERGENCY_BACKUP_CONTENT_KEYS.some(key => backup[key]);
        if (hasRemainingEmergencyData) {
            localStorage.setItem(backupKey, JSON.stringify(backup));
        } else {
            localStorage.removeItem(backupKey);
        }
    } catch (error) {
        // 유효한 백업의 일부를 정리하다 저장공간 부족 등의 일시적 오류가 발생하면
        // 원본 localStorage 값은 그대로 남아 있으므로 전량 삭제하지 않습니다.
        console.warn('Emergency changes backup cleanup failed. The valid backup was retained for a later retry.', error);
    }
};

const clearSavedNoteEmergencyBackup = (noteId, committedDraft = null, saveStartedAt = null) => {
    const normalizedNoteId = String(noteId ?? '');
    if (!normalizedNoteId) return;
    clearEmergencyChangesBackupEntry('noteUpdate', entry => {
        if (String(entry?.noteId ?? '') !== normalizedNoteId) return false;
        if (!committedDraft) return true;

        const matchesCommittedDraft = String(entry?.title ?? '') === String(committedDraft.title ?? '')
            && String(entry?.content ?? '') === String(committedDraft.content ?? '');
        if (matchesCommittedDraft) return true;

        // 저장이 성공한 뒤에도 과거 비상 백업이 남으면 다음 실행에서 최신 저장본을
        // 오래된 내용으로 되돌릴 수 있습니다. 저장 시작 전에 만들어진 백업과,
        // capturedAt 필드가 없던 구버전 백업은 현재 커밋보다 오래된 것으로 정리합니다.
        // 반대로 저장 도중/이후에 캡처된 백업은 더 최신 입력일 수 있으므로 보존합니다.
        const normalizedSaveStartedAt = Number(saveStartedAt);
        if (!Number.isFinite(normalizedSaveStartedAt) || normalizedSaveStartedAt <= 0) return false;

        const backupCapturedAt = Number(entry?.capturedAt);
        if (!Number.isFinite(backupCapturedAt) || backupCapturedAt <= 0) return true;
        return backupCapturedAt < normalizedSaveStartedAt;
    });
};

const clearRenameEmergencyBackup = (id, type) => {
    const normalizedId = String(id ?? '');
    if (!normalizedId) return;
    clearEmergencyChangesBackupEntry('itemRename', entry => {
        const sameId = String(entry?.id ?? '') === normalizedId;
        const sameType = !type || !entry?.type || entry.type === type;
        return sameId && sameType;
    });
};

// [설계 전제]
// performTransactionalUpdate는 단일 활성 문서의 저장 경계입니다.
// 현재 문서 컨텍스트 안의 연속 작업, 자동 저장, 이름 변경, 삭제/복원 흐름이
// 서로 어긋나지 않도록 read-modify-write 순서를 명확히 합니다.
// 멀티탭 동시 편집의 병합이나 상태 조정은 지원 범위가 아닙니다.
export const performTransactionalUpdate = async (updateFn) => {
    const getImportBlockedResult = () => {
        showToast('데이터 교체 가져오기가 진행 중이어서 대기 중이던 변경 작업을 취소했습니다.', CONSTANTS.TOAST_TYPE.ERROR);
        return {
            success: false,
            payload: null,
            failureReason: TRANSACTION_FAILURE_REASON.IMPORT_IN_PROGRESS
        };
    };

    // 편집/삭제 작업이 가져오기 전에 시작됐더라도 저장 큐에서
    // 교체 가져오기 뒤로 밀리면 새 appState를 오래된 UI 스냅샷으로 변경할 수 있습니다.
    if (typeof window !== 'undefined' && window.isReplacementImportActive) {
        return getImportBlockedResult();
    }

    const reportFailure = (error) => {
        console.error('Transactional update failed:', error);
        if (error && error.message && error.message.toLowerCase().includes('quota')) {
            showAlert({
                title: '💾 저장 공간 부족',
                message: '저장 공간이 가득 찼습니다. 더 이상 데이터를 저장할 수 없습니다.\n\n불필요한 노트를 휴지통으로 이동한 뒤, 휴지통을 비워 영구적으로 삭제하면 공간을 확보할 수 있습니다.',
                confirmText: '✅ 확인'
            });
        } else {
            showToast('오류가 발생하여 작업을 완료하지 못했습니다.', CONSTANTS.TOAST_TYPE.ERROR);
        }
    };

    // Web Lock 대기 시간도 작업 구간에 포함합니다. 대기 중 편집을 허용하면,
    // 트랜잭션이 오래된 DOM 스냅샷을 저장하고 화면을 전환하면서 새 입력을 잃을 수 있습니다.
    pendingTransactionalUpdateCount += 1;
    if (pendingTransactionalUpdateCount === 1) {
        setState({ isPerformingOperation: true });
    }

    try {
        return await withAppStateWriteLock(async () => {
            // 호출 시점에는 일반 작업이었어도 락 대기 중 가져오기가
            // 시작될 수 있으므로, 실제 저장 경계에 진입한 직후 다시 확인합니다.
            if (typeof window !== 'undefined' && window.isReplacementImportActive) {
                return getImportBlockedResult();
            }

            let resultPayload = null;

            try {
                const sessionLastActiveSnapshot = normalizeLastActiveNoteMap(state.lastActiveNotePerFolder);
                const memorySnapshot = {
                    folders: state.folders,
                    trash: state.trash,
                    favorites: Array.from(state.favorites),
                    lastSavedTimestamp: state.lastSavedTimestamp,
                    lastActiveNotePerFolder: sessionLastActiveSnapshot
                };

                // 저장 직전의 기준 appState를 읽어 연속 작업 간 read-modify-write 안정성을 유지합니다.
                const storedResult = await storageGet('appState');
                const hasStoredAppState = Object.prototype.hasOwnProperty.call(storedResult || {}, 'appState')
                    && storedResult.appState !== null
                    && storedResult.appState !== undefined;
                let baseData = memorySnapshot;
                let baseDataIsDetachedFromLiveState = false;

                if (hasStoredAppState) {
                    // [CRITICAL BUG FIX] 저장소에 appState가 있는데 구조가 손상된 경우 메모리 스냅샷으로
                    // 조용히 대체하면 다음 작업이 손상 원본을 덮어써 복구 기회를 없앱니다.
                    // 로드와 동일한 검사를 통과한 데이터만 트랜잭션 기준으로 사용하고,
                    // 복구 불가능한 구조는 저장 전에 중단하여 원본을 그대로 보존합니다.
                    const verification = verifyAndSanitizeLoadedData(
                        JSON.parse(JSON.stringify(storedResult.appState))
                    );
                    if (verification.isTopLevelInvalid) {
                        throw new Error('저장된 노트 데이터 구조가 손상되어 작업을 중단했습니다. 원본 데이터는 변경하지 않았습니다.');
                    }

                    const verifiedStoredData = verification.sanitizedData;
                    baseData = {
                        folders: verifiedStoredData.folders,
                        trash: verifiedStoredData.trash,
                        favorites: verifiedStoredData.favorites || [],
                        lastSavedTimestamp: verifiedStoredData.lastSavedTimestamp || 0,
                        // appState보다 localStorage 세션이 더 자주 갱신되므로, 현재 세션 값을 우선 병합합니다.
                        // 그렇지 않으면 다음 노트 저장/삭제 트랜잭션이 최신 폴더별 선택 기록을 과거 값으로 되돌립니다.
                        lastActiveNotePerFolder: {
                            ...normalizeLastActiveNoteMap(verifiedStoredData.lastActiveNotePerFolder),
                            ...sessionLastActiveSnapshot
                        }
                    };
                    // verifiedStoredData는 위 JSON 복제로 저장소/메모리 상태와 이미 분리되어 있습니다.
                    // 대용량 노트를 자동 저장할 때 전체 데이터를 한 번 더 복제하지 않도록 표시합니다.
                    baseDataIsDetachedFromLiveState = true;
                }

                const dataCopy = baseDataIsDetachedFromLiveState
                    ? baseData
                    : JSON.parse(JSON.stringify(baseData));
                const result = await updateFn(dataCopy);

                if (result == null) {
                    return { success: false, payload: null, failureReason: TRANSACTION_FAILURE_REASON.NO_CHANGE };
                }

                const { newData, successMessage, postUpdateState, payload } = result;
                if (!newData || !Array.isArray(newData.folders) || !Array.isArray(newData.trash)) {
                    throw new Error('트랜잭션 결과의 appState 형식이 올바르지 않습니다.');
                }

                resultPayload = payload ?? null;
                newData.lastSavedTimestamp = Date.now();
                canonicalizeDataBeforeSave(newData);

                await storageSet({ appState: newData });

                // 저장 I/O를 기다리는 동안 발생한 노트 이동은 세션 상태에만 있을 수 있습니다.
                // 트랜잭션 자체가 삭제/복원한 참조는 유지하되, 실제로 달라진 세션 키만 병합한 뒤
                // 현재 데이터에 존재하지 않는 참조는 다시 제거합니다.
                const stateDataForSessionMap = {
                    ...newData,
                    lastActiveNotePerFolder: mergeConcurrentLastActiveChanges(
                        newData.lastActiveNotePerFolder,
                        sessionLastActiveSnapshot,
                        state.lastActiveNotePerFolder
                    )
                };
                pruneLastActiveNoteMapForData(stateDataForSessionMap);

                setState({
                    folders: newData.folders,
                    trash: newData.trash,
                    favorites: new Set(newData.favorites || []),
                    lastSavedTimestamp: newData.lastSavedTimestamp,
                    lastActiveNotePerFolder: stateDataForSessionMap.lastActiveNotePerFolder || {},
                    totalNoteCount: newData.folders.reduce((sum, folder) => sum + (Array.isArray(folder.notes) ? folder.notes.length : 0), 0)
                });
                buildNoteMap();
                updateNoteCreationDates();
                clearSortedNotesCache();
                // 저장은 이미 영구 반영됐으므로, 부가 캘린더 갱신 실패가 트랜잭션
                // 전체의 실패로 보고되어 사용자가 토글 작업을 재시도하지 않게 합니다.
                if (calendarRenderer) {
                    try {
                        const calendarRenderResult = calendarRenderer(true);
                        if (calendarRenderResult && typeof calendarRenderResult.catch === 'function') {
                            calendarRenderResult.catch(error => {
                                console.error('Calendar refresh failed after a successful data commit.', error);
                            });
                        }
                    } catch (error) {
                        console.error('Calendar refresh failed after a successful data commit.', error);
                    }
                }

                if (postUpdateState) setState(postUpdateState);

                // [MAJOR BUG FIX] 삭제/복원/이동 트랜잭션은 activeFolderId/activeNoteId 또는
                // lastActiveNotePerFolder를 바꿀 수 있습니다. 영구 appState만 갱신하고 localStorage 세션을
                // 갱신하지 않으면 즉시 새로고침 시 삭제된 항목을 가리키는 오래된 선택 상태가 복원됩니다.
                // 저장이 성공한 최종 메모리 상태를 기준으로 세션도 같은 커밋 지점에서 동기화합니다.
                saveSession();

                if (successMessage) showToast(successMessage, CONSTANTS.TOAST_TYPE.SUCCESS, 6000);

                return { success: true, payload: resultPayload, failureReason: null };
            } catch (error) {
                reportFailure(error);
                return { success: false, payload: null, failureReason: TRANSACTION_FAILURE_REASON.ERROR };
            }
        });
    } catch (error) {
        // Web Locks 요청 자체가 실패하거나 중단된 경우도 동일하게 사용자에게 알립니다.
        reportFailure(error);
        return { success: false, payload: null, failureReason: TRANSACTION_FAILURE_REASON.ERROR };
    } finally {
        pendingTransactionalUpdateCount = Math.max(0, pendingTransactionalUpdateCount - 1);
        if (pendingTransactionalUpdateCount === 0) {
            setState({ isPerformingOperation: false });
        }
    }
};

// [BUG-C-CRITICAL 수정] 모달 확인 후에 변경사항을 저장하도록 `withConfirmation` 헬퍼 수정
async function withConfirmation(options, action) {
    const ok = await showConfirm(options);
    if (ok) {
        // 실제 액션을 실행하기 직전에, 모달이 떠있는 동안 발생했을 수 있는
        // 모든 변경사항을 저장 시도합니다.
        if (!(await saveCurrentNoteIfChanged())) {
            showToast("변경사항 저장에 실패하여 작업을 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
            return;
        }
        await action();
    }
}


// 저장 직전에 앱 데이터의 표준 형태를 맞춥니다.
// 삭제/복원처럼 정상적인 작업에서 생긴 휴지통 메타데이터나 세션 참조가
// 다음 실행 시 무결성 검사에 의해 "복구 대상"으로 오탐지되지 않도록 합니다.
const normalizeTimestampForStorage = (value, fallback) => {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
};

const pruneLastActiveNoteMapForData = (data) => {
    const folders = Array.isArray(data.folders) ? data.folders : [];
    const trash = Array.isArray(data.trash) ? data.trash : [];
    const favorites = new Set(Array.isArray(data.favorites) ? data.favorites.map(String) : []);

    const noteIdsByFolder = new Map();
    const activeNoteIds = new Set();

    folders.forEach(folder => {
        if (!folder?.id) return;
        const noteIds = new Set();
        (Array.isArray(folder.notes) ? folder.notes : []).forEach(note => {
            if (!note?.id) return;
            const noteId = String(note.id);
            noteIds.add(noteId);
            activeNoteIds.add(noteId);
        });
        noteIdsByFolder.set(String(folder.id), noteIds);
    });

    const trashItemIds = new Set();
    trash.forEach(item => {
        if (item?.id) trashItemIds.add(String(item.id));
    });

    const { ALL, RECENT, FAVORITES, TRASH } = CONSTANTS.VIRTUAL_FOLDERS;
    const isValidPair = (folderId, noteId) => {
        if (!folderId || !noteId) return false;
        const normalizedFolderId = String(folderId);
        const normalizedNoteId = String(noteId);

        if (noteIdsByFolder.has(normalizedFolderId)) {
            return noteIdsByFolder.get(normalizedFolderId).has(normalizedNoteId);
        }
        if (normalizedFolderId === ALL.id || normalizedFolderId === RECENT.id) {
            return activeNoteIds.has(normalizedNoteId);
        }
        if (normalizedFolderId === FAVORITES.id) {
            return activeNoteIds.has(normalizedNoteId) && favorites.has(normalizedNoteId);
        }
        if (normalizedFolderId === TRASH.id) {
            return trashItemIds.has(normalizedNoteId);
        }
        return false;
    };

    const cleaned = {};
    Object.entries(data.lastActiveNotePerFolder || {}).forEach(([folderId, noteId]) => {
        const normalizedFolderId = String(folderId);
        const normalizedNoteId = String(noteId);
        if (isValidPair(normalizedFolderId, normalizedNoteId)) {
            cleaned[normalizedFolderId] = normalizedNoteId;
        }
    });

    data.lastActiveNotePerFolder = cleaned;
};

const canonicalizeDataBeforeSave = (data) => {
    if (!data || typeof data !== 'object') return data;

    const now = Date.now();
    data.folders = Array.isArray(data.folders) ? data.folders : [];
    data.trash = Array.isArray(data.trash) ? data.trash : [];
    data.favorites = Array.isArray(data.favorites) ? data.favorites : [];
    data.lastActiveNotePerFolder = (data.lastActiveNotePerFolder && typeof data.lastActiveNotePerFolder === 'object' && !Array.isArray(data.lastActiveNotePerFolder))
        ? data.lastActiveNotePerFolder
        : {};

    data.folders.forEach(folder => {
        if (!folder || typeof folder !== 'object') return;
        delete folder.type;
        delete folder.deletedAt;
        delete folder.originalIndex;
        folder.notes = Array.isArray(folder.notes) ? folder.notes : [];
        folder.notes.forEach(note => {
            if (!note || typeof note !== 'object') return;
            delete note.type;
            delete note.deletedAt;
            delete note.originalFolderId;
            delete note.wasFavorite;
        });
    });

    data.trash.forEach(item => {
        if (!item || typeof item !== 'object') return;
        const isFolderLike = item.type === CONSTANTS.ITEM_TYPE.FOLDER || Array.isArray(item.notes);

        if (isFolderLike) {
            item.type = CONSTANTS.ITEM_TYPE.FOLDER;
            item.deletedAt = normalizeTimestampForStorage(item.deletedAt, now);
            item.notes = Array.isArray(item.notes) ? item.notes : [];
            item.notes.forEach(note => {
                if (!note || typeof note !== 'object') return;
                note.type = CONSTANTS.ITEM_TYPE.NOTE;
                note.deletedAt = normalizeTimestampForStorage(note.deletedAt, item.deletedAt || now);
                if (note.originalFolderId === undefined || note.originalFolderId === null) {
                    note.originalFolderId = item.id;
                }
            });
        } else {
            item.type = CONSTANTS.ITEM_TYPE.NOTE;
            item.deletedAt = normalizeTimestampForStorage(item.deletedAt, now);
        }
    });

    const activeNoteIds = new Set();
    data.folders.forEach(folder => {
        (Array.isArray(folder.notes) ? folder.notes : []).forEach(note => {
            if (note?.id) activeNoteIds.add(String(note.id));
        });
    });
    data.favorites = Array.from(new Set(data.favorites.map(id => String(id)).filter(id => activeNoteIds.has(id))));

    pruneLastActiveNoteMapForData(data);
    return data;
};

const getNextActiveNoteAfterDeletion = (deletedNoteId, notesInView) => {
    if (!notesInView || notesInView.length === 0) return null;
    const futureNotesInView = notesInView.filter(n => n.id !== deletedNoteId);
    if(futureNotesInView.length === 0) return null;

    const deletedIndexInOriginalView = notesInView.findIndex(n => n.id === deletedNoteId);
    if (deletedIndexInOriginalView === -1) return futureNotesInView[0].id;
    
    const nextItem = futureNotesInView[deletedIndexInOriginalView] || futureNotesInView[deletedIndexInOriginalView - 1];
    return nextItem?.id ?? null;
};

// [CRITICAL BUG FIX] ID 고유성 검사를 위해 시스템의 모든 ID를 수집하는 헬퍼 함수
const collectAllIds = () => {
    const allIds = new Set();

    // 1. 모든 활성 폴더 및 그 안의 노트를 순회하며 ID를 수집합니다.
    state.folders.forEach(folder => {
        allIds.add(folder.id);
        if (Array.isArray(folder.notes)) {
            folder.notes.forEach(note => allIds.add(note.id));
        }
    });

    // 2. 휴지통의 모든 아이템을 순회하며 ID를 수집합니다.
    // (휴지통의 폴더는 내부에 노트만 포함하므로, 1단계 깊이의 탐색만 필요합니다.)
    state.trash.forEach(item => {
        allIds.add(item.id);
        if (item.type === 'folder' && Array.isArray(item.notes)) {
            item.notes.forEach(note => allIds.add(note.id));
        }
    });
    
    // 3. 시스템에서 사용하는 가상 폴더의 ID도 충돌 방지를 위해 포함시킵니다.
    Object.values(CONSTANTS.VIRTUAL_FOLDERS).forEach(vf => allIds.add(vf.id));

    return allIds;
};

export const handleAddFolder = async () => {
    if (!(await finishPendingRename())) {
        showToast("이름 변경 저장에 실패하여 폴더 추가를 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        return;
    }
    
    const name = await showPrompt({
        title: CONSTANTS.MODAL_TITLES.NEW_FOLDER,
        placeholder: '📁 폴더 이름을 입력하세요',
        validationFn: (value) => {
            const trimmedValue = value.trim();
            if (!trimmedValue) return { isValid: false, message: CONSTANTS.MESSAGES.ERROR.EMPTY_NAME_ERROR };
            if (state.folders.some(f => f.name.toLowerCase() === trimmedValue.toLowerCase())) {
                return { isValid: false, message: CONSTANTS.MESSAGES.ERROR.FOLDER_EXISTS(trimmedValue) };
            }
            return { isValid: true };
        }
    });

    if (!name) return;

    if (!(await saveCurrentNoteIfChanged())) {
        showToast("변경사항 저장에 실패하여 폴더를 추가하지 않았습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        return;
    }

    const allIds = collectAllIds();
    const newFolderId = generateUniqueId(CONSTANTS.ID_PREFIX.FOLDER, allIds);
    const trimmedName = name.trim();

    const { success } = await performTransactionalUpdate((latestData) => {
        if (latestData.folders.some(f => f.name.toLowerCase() === trimmedName.toLowerCase())) {
            showAlert({ title: '오류', message: `'${trimmedName}' 폴더가 이미 존재합니다.`});
            return null;
        }

        const now = Date.now();
        const newFolder = { id: newFolderId, name: trimmedName, notes: [], createdAt: now, updatedAt: now };
        latestData.folders.push(newFolder);
        
        return {
            newData: latestData,
            successMessage: null,
            postUpdateState: { activeFolderId: newFolderId, activeNoteId: null }
        };
    });

    if (success) {
        await changeActiveFolder(newFolderId, { force: true });
        requestAnimationFrame(() => {
            // [CRITICAL BUG FIX] DOMException 방지를 위해 CSS.escape()를 사용하여 ID를 안전하게 만듭니다.
            const safeNewFolderId = escapeCssAttributeValue(newFolderId);
            const newFolderEl = folderList.querySelector(`[data-id="${safeNewFolderId}"]`);
            if (newFolderEl) {
                newFolderEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
                newFolderEl.focus();
            }
        });
    }
};

let addNoteLock = false;
export const handleAddNote = async () => {
    if (addNoteLock) return;
    addNoteLock = true;
    if(addNoteBtn) addNoteBtn.disabled = true;

    try {
        if (!(await finishPendingRename())) {
            showToast("이름 변경 저장에 실패하여 노트 추가를 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
            return;
        }
        if (!(await confirmNavigation())) return;

        const { ALL, RECENT, TRASH, FAVORITES } = CONSTANTS.VIRTUAL_FOLDERS;
        const currentActiveFolderId = state.activeFolderId;

        if (!currentActiveFolderId || [ALL.id, RECENT.id, TRASH.id, FAVORITES.id].includes(currentActiveFolderId)) {
            showToast(CONSTANTS.MESSAGES.ERROR.ADD_NOTE_PROMPT, CONSTANTS.TOAST_TYPE.ERROR);
            return;
        }
        
        const allIds = collectAllIds();
        const newNoteId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, allIds);
        const now = Date.now();

        const { success, payload } = await performTransactionalUpdate((latestData) => {
            const activeFolder = latestData.folders.find(f => f.id === currentActiveFolderId);
            if (!activeFolder) {
                 showAlert({ title: '오류', message: '노트를 추가하려던 폴더가 삭제되었습니다.'});
                 return null;
            }
            
            let baseTitle = `${formatDate(now)}의 노트`;
            let finalTitle = baseTitle;
            let counter = 2;
            while (activeFolder.notes.some(note => note.title === finalTitle)) {
                finalTitle = `${baseTitle} (${counter++})`;
            }

            const newNote = { id: newNoteId, title: finalTitle, content: "", createdAt: now, updatedAt: now, isPinned: false };
            
            activeFolder.notes.unshift(newNote);
            activeFolder.updatedAt = now;

            const newLastActiveMap = { ...(latestData.lastActiveNotePerFolder || {}), [currentActiveFolderId]: newNoteId };
            latestData.lastActiveNotePerFolder = newLastActiveMap;
            
            return {
                newData: latestData,
                successMessage: null,
                postUpdateState: {
                    isDirty: false,
                    dirtyNoteId: null,
                    searchTerm: '',
                },
                payload: { newNoteId: newNote.id } 
            };
        });
        
        if (success && payload?.newNoteId) {
            await changeActiveNote(payload.newNoteId);
            
            requestAnimationFrame(() => {
                if (noteTitleInput) {
                    noteTitleInput.focus();
                    noteTitleInput.select();
                }
            });
        }
    } finally {
        addNoteLock = false;
        if(addNoteBtn) addNoteBtn.disabled = false;
    }
};

const _withNoteAction = (noteId, actionFn) => {
    return performTransactionalUpdate(latestData => {
        let noteToUpdate = null, folderOfNote = null;
        for (const folder of latestData.folders) {
            const note = folder.notes.find(n => n.id === noteId);
            if (note) {
                noteToUpdate = note; folderOfNote = folder; break;
            }
        }
        if (!noteToUpdate) return null;
        return actionFn(noteToUpdate, folderOfNote, latestData);
    });
};

const ensurePendingEditorStateSaved = async (actionName) => {
    if (!(await saveCurrentNoteIfChanged())) {
        showToast(`변경사항 저장에 실패하여 ${actionName} 작업을 취소했습니다.`, CONSTANTS.TOAST_TYPE.ERROR);
        return false;
    }
    return true;
};

const prepareForImmediateNoteMutation = async (actionName) => {
    if (!(await finishPendingRename())) {
        showToast(`이름 변경 저장에 실패하여 ${actionName} 작업을 취소했습니다.`, CONSTANTS.TOAST_TYPE.ERROR);
        return false;
    }

    // 고정/즐겨찾기 변경도 appState 전체를 다시 렌더링합니다. 편집 버퍼를 먼저 저장하지 않으면
    // 저장 실패 직후 메타데이터 작업이 성공하면서 화면의 미저장 본문을 덮어쓸 수 있습니다.
    return ensurePendingEditorStateSaved(actionName);
};

export const handlePinNote = async (id) => {
    if (!(await prepareForImmediateNoteMutation('노트 고정'))) {
        return { success: false, payload: null };
    }

    return _withNoteAction(id, (note, folder, data) => {
        note.isPinned = !note.isPinned;
        const now = Date.now();
        note.updatedAt = now;
        folder.updatedAt = now;
        return {
            newData: data,
            successMessage: note.isPinned ? CONSTANTS.MESSAGES.SUCCESS.NOTE_PINNED : CONSTANTS.MESSAGES.SUCCESS.NOTE_UNPINNED,
            postUpdateState: {}
        };
    });
};

export const handleToggleFavorite = async (id) => {
    if (!(await prepareForImmediateNoteMutation('즐겨찾기'))) {
        return { success: false, payload: null };
    }

    return _withNoteAction(id, (note, folder, data) => {
        const now = Date.now();
        note.updatedAt = now;
        folder.updatedAt = now;
        
        const favoritesSet = new Set(data.favorites || []);
        const isNowFavorite = !favoritesSet.has(id);
        
        if (isNowFavorite) favoritesSet.add(id);
        else favoritesSet.delete(id);
        
        data.favorites = Array.from(favoritesSet);

        let postUpdateState = {};
        if (state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.FAVORITES.id && !isNowFavorite) {
            postUpdateState.searchTerm = '';
            postUpdateState.preSearchActiveNoteId = null;
        }

        return {
            newData: data,
            successMessage: isNowFavorite ? CONSTANTS.MESSAGES.SUCCESS.NOTE_FAVORITED : CONSTANTS.MESSAGES.SUCCESS.NOTE_UNFAVORITED,
            postUpdateState
        };
    });
};

export const handleDelete = async (id, type) => {
    if (!(await finishPendingRename())) {
        showToast("이름 변경 저장에 실패하여 삭제를 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        return;
    }

    if (!(await ensurePendingEditorStateSaved('삭제'))) return;
    
    const { item } = (type === CONSTANTS.ITEM_TYPE.FOLDER ? findFolder(id) : findNote(id));
    if (!item) return;

    const itemName = item.name || item.title || '제목 없음';
    const confirmMessage = type === CONSTANTS.ITEM_TYPE.FOLDER
        ? `📁 '${itemName}' 폴더와 포함된 모든 노트를 휴지통으로 이동할까요?`
        : `📝 '${itemName}' 노트를 휴지통으로 이동할까요?`;

    await withConfirmation(
        { title: '🗑️ 휴지통으로 이동', message: confirmMessage, confirmText: '🗑️ 이동' },
        () => performDeleteItem(id, type)
    );
};

export const performDeleteItem = (id, type) => {
    const currentNotesInView = sortedNotesCache.result || [];

    return performTransactionalUpdate(latestData => {
        const { folders, trash } = latestData;
        let successMessage = '', postUpdateState = {};
        const now = Date.now();

        if (state.renamingItemId === id) postUpdateState.renamingItemId = null;
        
        if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
            const folderIndex = folders.findIndex(f => f.id === id);
            if (folderIndex === -1) return null;
            
            const [folderToMove] = folders.splice(folderIndex, 1);
            folderToMove.type = CONSTANTS.ITEM_TYPE.FOLDER;
            folderToMove.originalIndex = folderIndex;
            folderToMove.deletedAt = now;
            folderToMove.updatedAt = now;
            
            const favoritesSet = new Set(latestData.favorites || []);
            folderToMove.notes = Array.isArray(folderToMove.notes) ? folderToMove.notes : [];
            folderToMove.notes.forEach(note => {
                note.type = CONSTANTS.ITEM_TYPE.NOTE;
                note.originalFolderId = folderToMove.id;
                note.deletedAt = now;
                if (favoritesSet.has(note.id)) note.wasFavorite = true;
                favoritesSet.delete(note.id);
            });
            latestData.favorites = Array.from(favoritesSet);
            trash.unshift(folderToMove);

            successMessage = CONSTANTS.MESSAGES.SUCCESS.FOLDER_MOVED_TO_TRASH(folderToMove.name);
            if (state.activeFolderId === id) {
                const nextFolderIndex = Math.max(0, folderIndex - 1);
                const nextFolder = folders.length > 0
                    ? (folders[folderIndex] ?? folders[nextFolderIndex])
                    : null;

                postUpdateState.activeFolderId = nextFolder?.id ?? CONSTANTS.VIRTUAL_FOLDERS.ALL.id;

                // [MAJOR BUG FIX] 활성 폴더 삭제 후 다음 폴더를 선택하면서 activeNoteId를 무조건 null로
                // 만들면, 다음 폴더에 노트가 있어도 편집기가 빈 화면으로 남습니다. 폴더 전환과 동일하게
                // 마지막 선택 노트를 우선하고, 없으면 현재 정렬 기준의 첫 노트를 선택합니다.
                if (nextFolder) {
                    const rememberedNoteId = latestData.lastActiveNotePerFolder?.[nextFolder.id];
                    const rememberedNoteExists = rememberedNoteId
                        && nextFolder.notes.some(note => note.id === rememberedNoteId);
                    const sortedNextNotes = sortNotes(nextFolder.notes, state.noteSortOrder);
                    postUpdateState.activeNoteId = rememberedNoteExists
                        ? rememberedNoteId
                        : (sortedNextNotes[0]?.id ?? null);
                } else {
                    postUpdateState.activeNoteId = null;
                }
            }
        } else { // NOTE
            let noteToMove, sourceFolder;
            for(const folder of folders) {
                const noteIndex = folder.notes.findIndex(n => n.id === id);
                if (noteIndex !== -1) {
                    [noteToMove] = folder.notes.splice(noteIndex, 1);
                    sourceFolder = folder;
                    break;
                }
            }
            if (!noteToMove) return null;

            noteToMove.type = CONSTANTS.ITEM_TYPE.NOTE;
            noteToMove.originalFolderId = sourceFolder.id;
            noteToMove.deletedAt = now;
            
            // --- [기능 개선] 즐겨찾기 상태 복원을 위해 삭제 시 상태 기록 ---
            const favoritesSet = new Set(latestData.favorites || []);
            if (favoritesSet.has(id)) {
                noteToMove.wasFavorite = true;
                favoritesSet.delete(id);
                latestData.favorites = Array.from(favoritesSet);
            }
            // --- [수정 끝] ---

            trash.unshift(noteToMove);
            sourceFolder.updatedAt = now;
            
            successMessage = CONSTANTS.MESSAGES.SUCCESS.NOTE_MOVED_TO_TRASH(noteToMove.title || '제목 없음');
            
            if (state.activeNoteId === id) {
                postUpdateState.activeNoteId = getNextActiveNoteAfterDeletion(id, currentNotesInView);
            }
        }
        
        return { newData: latestData, successMessage, postUpdateState };
    });
};

export const handleRestoreItem = async (id, type) => {
    if (!(await finishPendingRename())) {
        showToast("이름 변경 저장에 실패하여 복원을 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        return;
    }

    const itemToRestore = state.trash.find(item => item.id === id);
    if (!itemToRestore) return;

    let effectiveType = itemToRestore.type;
    if (!effectiveType) {
        effectiveType = Array.isArray(itemToRestore.notes) ? CONSTANTS.ITEM_TYPE.FOLDER : CONSTANTS.ITEM_TYPE.NOTE;
    }

    if (type !== effectiveType) {
        console.warn(`Type mismatch in handleRestoreItem: expected ${type}, but found ${effectiveType}. Proceeding with item's own type.`);
    }

    let finalFolderName = itemToRestore.name;
    let targetFolderId = null;

    const normalizeFolderNameForCompare = (name) => String(name ?? '').trim().toLowerCase();

    if (effectiveType === 'folder') {
        if (state.folders.some(f => normalizeFolderNameForCompare(f.name) === normalizeFolderNameForCompare(itemToRestore.name))) {
            const newName = await showPrompt({
                title: '📁 폴더 이름 중복',
                message: `'${itemToRestore.name}' 폴더가 이미 존재합니다. 복원할 폴더의 새 이름을 입력해주세요.`,
                initialValue: `${itemToRestore.name} (복사본)`,
                validationFn: (value) => {
                    const trimmedValue = value.trim();
                    if (!trimmedValue) return { isValid: false, message: CONSTANTS.MESSAGES.ERROR.EMPTY_NAME_ERROR };
                    if (state.folders.some(f => normalizeFolderNameForCompare(f.name) === normalizeFolderNameForCompare(trimmedValue))) return { isValid: false, message: CONSTANTS.MESSAGES.ERROR.FOLDER_EXISTS(trimmedValue) };
                    return { isValid: true };
                }
            });
            if (!newName) return; 
            finalFolderName = newName.trim();
        }
    } else if (effectiveType === 'note') {
        const originalFolder = state.folders.find(f => f.id === itemToRestore.originalFolderId);
        if (!originalFolder) {
            const newFolderId = await showFolderSelectPrompt({
                title: '🤔 원본 폴더를 찾을 수 없음',
                message: '이 노트의 원본 폴더가 없거나 휴지통에 있습니다. 복원할 폴더를 선택해주세요.'
            });
            if (!newFolderId) return;
            targetFolderId = newFolderId;
        } else {
            targetFolderId = originalFolder.id;
        }
    }

    if (!(await saveCurrentNoteIfChanged())) {
        showToast("변경사항 저장에 실패하여 복원 작업을 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        return;
    }

    const updateLogic = (latestData) => {
        const { folders, trash } = latestData;
        const itemIndexInTx = trash.findIndex(item => item.id === id);
        if (itemIndexInTx === -1) return null;

        const [itemToRestoreInTx] = trash.splice(itemIndexInTx, 1);
        
        let txEffectiveType = itemToRestoreInTx.type;
        if (!txEffectiveType) {
            txEffectiveType = Array.isArray(itemToRestoreInTx.notes) ? CONSTANTS.ITEM_TYPE.FOLDER : CONSTANTS.ITEM_TYPE.NOTE;
        }

        const now = Date.now();
        let hadIdCollision = false;
        const folderIdUpdateMap = new Map();
        const noteIdUpdateMap = new Map();

        if (txEffectiveType === 'folder') {
            const finalFolderNameKey = normalizeFolderNameForCompare(finalFolderName);
            if (folders.some(f => normalizeFolderNameForCompare(f.name) === finalFolderNameKey)) {
                showAlert({ title: '오류', message: `'${finalFolderName}' 폴더가 방금 다른 곳에서 생성되었습니다. 다른 이름으로 다시 시도해주세요.`});
                return null;
            }
            itemToRestoreInTx.name = finalFolderName;
            
            const allExistingIds = new Set();
            folders.forEach(f => {
                allExistingIds.add(f.id);
                f.notes.forEach(n => allExistingIds.add(n.id));
            });
            trash.forEach(item => {
                if (item.id !== id) {
                   allExistingIds.add(item.id);
                   if (item.type === 'folder' && Array.isArray(item.notes)) {
                       item.notes.forEach(note => allExistingIds.add(note.id));
                   }
                }
            });
            
            if (allExistingIds.has(itemToRestoreInTx.id)) {
                const oldId = itemToRestoreInTx.id;
                const newId = generateUniqueId(CONSTANTS.ID_PREFIX.FOLDER, allExistingIds);
                itemToRestoreInTx.id = newId;
                allExistingIds.add(newId);
                folderIdUpdateMap.set(oldId, newId);
                hadIdCollision = true;
            }

            const favoritesSet = new Set(latestData.favorites || []);
            const restoredNoteIds = new Set();
            
            (itemToRestoreInTx.notes || []).forEach(note => {
                if (restoredNoteIds.has(note.id) || allExistingIds.has(note.id)) {
                    const oldId = note.id;
                    const combinedExistingIds = new Set([...allExistingIds, ...restoredNoteIds]);
                    const newId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, combinedExistingIds);
                    note.id = newId;
                    noteIdUpdateMap.set(oldId, newId);
                    hadIdCollision = true;
                }
                
                restoredNoteIds.add(note.id);
                allExistingIds.add(note.id);
                
                const shouldRestoreFavorite = note.wasFavorite === true;
                delete note.deletedAt;
                delete note.type;
                delete note.originalFolderId;
                delete note.wasFavorite;
                if (shouldRestoreFavorite) favoritesSet.add(note.id);
            });
            latestData.favorites = Array.from(favoritesSet);
            
            delete itemToRestoreInTx.deletedAt;
            delete itemToRestoreInTx.type;
            itemToRestoreInTx.updatedAt = now;
            
            if (typeof itemToRestoreInTx.originalIndex === 'number' && itemToRestoreInTx.originalIndex >= 0) {
                folders.splice(itemToRestoreInTx.originalIndex, 0, itemToRestoreInTx);
            } else {
                folders.unshift(itemToRestoreInTx);
            }
            delete itemToRestoreInTx.originalIndex;

        } else if (txEffectiveType === 'note') {
            const targetFolderInTx = folders.find(f => f.id === targetFolderId);
            if (!targetFolderInTx) {
                 showAlert({ title: '오류', message: '노트를 복원하려던 폴더가 방금 삭제되었습니다.'});
                 return null;
            }
            
            const allExistingIds = new Set();
            folders.forEach(f => {
                allExistingIds.add(f.id);
                f.notes.forEach(n => allExistingIds.add(n.id));
            });
            trash.forEach(item => {
                if (item.id !== id) {
                   allExistingIds.add(item.id);
                   if (item.type === 'folder' && Array.isArray(item.notes)) {
                       item.notes.forEach(note => allExistingIds.add(note.id));
                   }
                }
            });
            
            if (allExistingIds.has(itemToRestoreInTx.id)) {
                 const oldId = itemToRestoreInTx.id;
                 const newId = generateUniqueId(CONSTANTS.ID_PREFIX.NOTE, allExistingIds);
                 itemToRestoreInTx.id = newId;
                 noteIdUpdateMap.set(oldId, newId);
                 hadIdCollision = true;
            }

            delete itemToRestoreInTx.deletedAt;
            delete itemToRestoreInTx.type;
            delete itemToRestoreInTx.originalFolderId;
            itemToRestoreInTx.updatedAt = now;

            // --- [BUG FIX] ID 변경이 완료된 후, 최종 ID를 사용하여 즐겨찾기 상태를 복원합니다. ---
            if (itemToRestoreInTx.wasFavorite) {
                const favoritesSet = new Set(latestData.favorites || []);
                // 여기서 사용되는 .id는 충돌 시 이미 새 ID로 교체된 값입니다.
                favoritesSet.add(itemToRestoreInTx.id);
                latestData.favorites = Array.from(favoritesSet);
                delete itemToRestoreInTx.wasFavorite; // 임시 속성 제거
            }
            // --- [수정 끝] ---

            targetFolderInTx.notes.unshift(itemToRestoreInTx);
            targetFolderInTx.updatedAt = now;
        }

        if ((folderIdUpdateMap.size > 0 || noteIdUpdateMap.size > 0) && latestData.lastActiveNotePerFolder) {
            const newLastActiveMap = {};
            for (const oldFolderId in latestData.lastActiveNotePerFolder) {
                const newFolderId = folderIdUpdateMap.get(oldFolderId) || oldFolderId;
                const oldNoteId = latestData.lastActiveNotePerFolder[oldFolderId];
                const newNoteId = noteIdUpdateMap.get(oldNoteId) || oldNoteId;
                newLastActiveMap[newFolderId] = newNoteId;
            }
            latestData.lastActiveNotePerFolder = newLastActiveMap;
        }

        if (txEffectiveType === 'folder') {
            return {
                newData: latestData,
                successMessage: CONSTANTS.MESSAGES.SUCCESS.ITEM_RESTORED_FOLDER(itemToRestoreInTx.name),
                postUpdateState: {},
                payload: { hadIdCollision }
            };
        } else if (txEffectiveType === 'note') {
            return {
                newData: latestData,
                successMessage: CONSTANTS.MESSAGES.SUCCESS.ITEM_RESTORED_NOTE(itemToRestoreInTx.title),
                postUpdateState: {},
                payload: { hadIdCollision }
            };
        }

        return null;
    };

    const { success, payload } = await performTransactionalUpdate(updateLogic);

    if (success && payload?.hadIdCollision) {
        showToast("일부 노트 또는 폴더의 ID가 충돌하여 자동으로 수정되었습니다.", CONSTANTS.TOAST_TYPE.SUCCESS, 8000);
    }
};

export const handlePermanentlyDeleteItem = async (id, type) => {
    if (!(await finishPendingRename())) {
        showToast("이름 변경 저장에 실패하여 영구 삭제를 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        return;
    }

    if (!(await ensurePendingEditorStateSaved('영구 삭제'))) return;

    const item = state.trash.find(i => i.id === id);
    if (!item) return;

    let effectiveType = item.type;
    if (!effectiveType) {
        effectiveType = Array.isArray(item.notes) ? CONSTANTS.ITEM_TYPE.FOLDER : CONSTANTS.ITEM_TYPE.NOTE;
    }
    
    if (type !== effectiveType) {
        console.warn(`Type mismatch in handlePermanentlyDeleteItem: expected ${type}, but found ${effectiveType}. Proceeding with item's own type.`);
    }
    
    const itemName = item.title ?? item.name;
    const message = CONSTANTS.MESSAGES.CONFIRM.PERM_DELETE(itemName);

    await withConfirmation(
        { title: CONSTANTS.MODAL_TITLES.PERM_DELETE, message: message, confirmText: '💥 삭제', confirmButtonType: 'danger' },
        () => performTransactionalUpdate(latestData => {
            const originalTrashItems = [...latestData.trash];
            const itemIndex = originalTrashItems.findIndex(i => i.id === id);
            
            if (itemIndex === -1) return null;
            
            const [deletedItem] = latestData.trash.splice(itemIndex, 1);
            
            let postUpdateState = {};
            if (state.renamingItemId === id) postUpdateState.renamingItemId = null;
            if (state.activeNoteId === id) {
                postUpdateState.activeNoteId = getNextActiveNoteAfterDeletion(id, originalTrashItems);
            }
            
            const favoritesSet = new Set(latestData.favorites || []);
            const initialSize = favoritesSet.size;
            
            let deletedItemType = deletedItem.type;
            if (!deletedItemType) {
                deletedItemType = Array.isArray(deletedItem.notes) ? 'folder' : 'note';
            }

            if (deletedItemType === 'note') {
                favoritesSet.delete(id);
            } else if (deletedItemType === 'folder' && Array.isArray(deletedItem.notes)) {
                deletedItem.notes.forEach(note => {
                    favoritesSet.delete(note.id);
                });
            }

            if (favoritesSet.size < initialSize) {
                latestData.favorites = Array.from(favoritesSet);
            }
            
            return {
                newData: latestData,
                successMessage: CONSTANTS.MESSAGES.SUCCESS.PERM_DELETE_ITEM_SUCCESS,
                postUpdateState
            };
        })
    );
};

export const handleEmptyTrash = async () => {
    if (!(await finishPendingRename())) {
        showToast("이름 변경 저장에 실패하여 휴지통 비우기를 취소했습니다.", CONSTANTS.TOAST_TYPE.ERROR);
        return;
    }
    if (!(await ensurePendingEditorStateSaved('휴지통 비우기'))) return;
    if (state.trash.length === 0) return;

    const message = CONSTANTS.MESSAGES.CONFIRM.EMPTY_TRASH(state.trash.length);

    await withConfirmation(
        { title: CONSTANTS.MODAL_TITLES.EMPTY_TRASH, message: message, confirmText: '💥 모두 영구적으로 삭제', confirmButtonType: 'danger' },
        () => performTransactionalUpdate(latestData => {
            let postUpdateState = {};

            const noteIdsInTrash = new Set();
            latestData.trash.forEach(item => {
                let itemType = item.type;
                if (!itemType) itemType = Array.isArray(item.notes) ? 'folder' : 'note';
                
                if (itemType === 'note') {
                    noteIdsInTrash.add(item.id);
                } else if (itemType === 'folder' && Array.isArray(item.notes)) {
                    item.notes.forEach(note => noteIdsInTrash.add(note.id));
                }
            });

            if (state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id) {
                const activeNotes = latestData.folders.flatMap(folder => (
                    Array.isArray(folder.notes) ? folder.notes : []
                ));
                const rememberedNoteId = latestData.lastActiveNotePerFolder?.[CONSTANTS.VIRTUAL_FOLDERS.ALL.id];
                const rememberedNoteExists = activeNotes.some(note => note.id === rememberedNoteId);
                const fallbackNoteId = sortNotes(activeNotes, state.noteSortOrder)[0]?.id ?? null;

                postUpdateState.activeFolderId = CONSTANTS.VIRTUAL_FOLDERS.ALL.id;
                // 휴지통 비우기 후 전체 노트로 이동하면서 유효한 선택까지 복원합니다.
                // 기존 구현은 활성 노트가 있어도 null로 만들어 편집기를 비웠습니다.
                postUpdateState.activeNoteId = rememberedNoteExists ? rememberedNoteId : fallbackNoteId;
            } 
            else if (state.activeNoteId && noteIdsInTrash.has(state.activeNoteId)) {
                postUpdateState.activeNoteId = null;
            }

            if (state.renamingItemId && state.trash.some(item => item.id === state.renamingItemId)) {
                postUpdateState.renamingItemId = null;
            }

            const favoritesSet = new Set(latestData.favorites || []);
            latestData.trash.forEach(item => {
                let itemType = item.type;
                if (!itemType) itemType = Array.isArray(item.notes) ? 'folder' : 'note';

                if (itemType === 'note') {
                    favoritesSet.delete(item.id);
                } else if (itemType === 'folder' && Array.isArray(item.notes)) {
                    item.notes.forEach(note => {
                        favoritesSet.delete(note.id);
                    });
                }
            });
            latestData.favorites = Array.from(favoritesSet);

            latestData.trash = [];
            return { newData: latestData, successMessage: CONSTANTS.MESSAGES.SUCCESS.EMPTY_TRASH_SUCCESS, postUpdateState };
        })
    );
};

const deriveFinalNoteTitle = (rawTitle, content) => {
    let finalTitle = String(rawTitle ?? '').trim();

    if (!finalTitle && content) {
        let firstLine = String(content).split('\n')[0].trim();
        if (firstLine) {
            const hasKorean = /[\uAC00-\uD7AF]/.test(firstLine);
            const limit = hasKorean ? CONSTANTS.AUTO_TITLE_LENGTH_KOR : CONSTANTS.AUTO_TITLE_LENGTH;
            if (firstLine.length > limit) {
                firstLine = firstLine.slice(0, limit) + '...';
            }
            finalTitle = firstLine;
        }
    }

    return finalTitle;
};

export async function saveCurrentNoteIfChanged() {
    if (!state.isDirty) {
        return true;
    }

    // 편집 버퍼의 소유자는 activeNoteId가 아니라 입력 시 기록한 dirtyNoteId입니다.
    // 두 값이 어긋난 상태에서 현재 DOM을 저장하면 다른 노트 내용으로 덮어쓸 수 있으므로 중단합니다.
    if (state.dirtyNoteId && state.activeNoteId !== state.dirtyNoteId) {
        console.error('Save aborted: the dirty note does not match the active editor.', {
            dirtyNoteId: state.dirtyNoteId,
            activeNoteId: state.activeNoteId
        });
        updateSaveStatus('dirty');
        showToast('저장할 노트와 현재 편집기가 일치하지 않아 저장을 중단했습니다. 페이지를 새로고침하기 전에 내용을 복사해 주세요.', CONSTANTS.TOAST_TYPE.ERROR);
        return false;
    }

    const noteIdToSave = state.dirtyNoteId || state.activeNoteId;
    const titleToSave = noteTitleInput?.value ?? '';
    const contentToSave = noteContentTextarea?.value ?? '';
    const saveStartedAt = Date.now();

    if (!noteIdToSave) {
        updateSaveStatus('dirty');
        showToast('저장할 노트를 식별할 수 없어 변경사항을 유지한 채 저장을 중단했습니다.', CONSTANTS.TOAST_TYPE.ERROR);
        return false;
    }

    updateSaveStatus('saving');

    const { success, payload } = await performTransactionalUpdate(latestData => {
        let noteToSave = null;
        let parentFolder = null;
        for (const folder of latestData.folders) {
            const note = (Array.isArray(folder.notes) ? folder.notes : []).find(n => n.id === noteIdToSave);
            if (note) {
                noteToSave = note;
                parentFolder = folder;
                break;
            }
        }

        if (!noteToSave) {
            console.error(`Save failed: Note with ID ${noteIdToSave} not found in storage.`);
            showToast('저장 실패: 노트를 찾을 수 없습니다.', CONSTANTS.TOAST_TYPE.ERROR);
            return null;
        }

        const finalTitle = deriveFinalNoteTitle(titleToSave, contentToSave);

        noteToSave.title = finalTitle;
        noteToSave.content = contentToSave;
        // 저장 완료 시각이 아니라 편집기 스냅샷을 캡처한 시각을 기록해야 합니다.
        // 저장 I/O 중 추가 입력이 발생하면 비상 복구 초안의 capturedAt이 이 값보다
        // 뒤에 오므로, 다음 시작 시 더 최신인 초안을 안전하게 복구할 수 있습니다.
        noteToSave.updatedAt = saveStartedAt;
        if (parentFolder) parentFolder.updatedAt = saveStartedAt;

        return {
            newData: latestData,
            successMessage: null,
            postUpdateState: {},
            payload: {
                savedNoteId: noteIdToSave,
                savedTitle: finalTitle,
                savedContent: contentToSave
            }
        };
    });

    if (!success) {
        updateSaveStatus('dirty');
        return false;
    }

    let liveTitle = noteTitleInput?.value ?? titleToSave;
    const liveContent = noteContentTextarea?.value ?? contentToSave;
    const titleChangedDuringSave = liveTitle !== titleToSave;
    const contentChangedDuringSave = liveContent !== contentToSave;
    const draftChangedDuringSave = titleChangedDuringSave || contentChangedDuringSave;
    const savedTitle = payload?.savedTitle ?? titleToSave;
    const savedContent = payload?.savedContent ?? contentToSave;

    // 제목 입력이 저장 중 바뀌지 않았다면 자동 생성된 최종 제목을 편집기에 반영합니다.
    // 이렇게 해야 빈 제목이 저장본과 계속 다르다고 판단되어 자동 저장이 반복되지 않습니다.
    if (!titleChangedDuringSave && noteTitleInput && liveTitle !== savedTitle) {
        noteTitleInput.value = savedTitle;
        liveTitle = savedTitle;
    }

    const activeEditorStillOwnsSavedNote = state.activeNoteId === noteIdToSave;
    const anotherNoteBecameDirty = state.isDirty && state.dirtyNoteId && state.dirtyNoteId !== noteIdToSave;

    if (anotherNoteBecameDirty) {
        // 저장 대기 중 사용자가 다른 노트를 편집하기 시작한 경우, 새 노트의 dirty 상태는 그대로 보존하고
        // 오래된 저장 호출에는 실패를 반환합니다. 그래야 이 호출을 기다리던 탐색/화면 전환이 계속 진행되지 않아
        // 새 노트의 미저장 DOM 버퍼를 렌더링으로 덮어쓰지 않습니다.
        updateSaveStatus('dirty');
        return false;
    }

    if (draftChangedDuringSave && activeEditorStillOwnsSavedNote) {
        // [CRITICAL BUG FIX]
        // 저장 요청이 진행되는 동안 추가 입력이 발생한 상태에서 호출자(노트 이동, 검색, 폴더 이동 등)가
        // 곧바로 화면을 전환하면, 아직 저장되지 않은 최신 DOM 버퍼가 다음 렌더에 의해 덮어써질 수 있습니다.
        // 따라서 dirty 상태만 남기고 비동기 자동 저장에 맡기지 않고, 현재 호출 흐름 안에서 최신 버퍼까지
        // 다시 저장한 뒤에만 성공을 반환합니다.
        setState({ isDirty: true, dirtyNoteId: noteIdToSave });
        updateSaveStatus('dirty');
        clearTimeout(autoSaveTimer);
        return await saveCurrentNoteIfChanged();
    } else {
        // 현재 dirty 상태가 방금 저장한 노트의 것일 때만 저장 완료로 정리합니다.
        // activeNoteId가 이미 바뀐 상태에서도 다른 노트의 변경 플래그를 건드리지 않습니다.
        if (!state.dirtyNoteId || state.dirtyNoteId === noteIdToSave) {
            setState({ isDirty: false, dirtyNoteId: null });
        }
        // setState()는 동기 구독 렌더를 실행합니다. 검색 중 저장된 노트가 결과에서 빠지면
        // 바로 위 dirty 해제 렌더가 activeNoteId와 편집기 바인딩을 다른 노트로 바꿀 수 있습니다.
        // 저장 전의 소유권 스냅샷을 사용하면 새 노트 편집기에 이전 노트 내용을 주입하게 되므로,
        // DOM을 쓰기 직전에 현재 소유자를 다시 확인합니다.
        if (state.activeNoteId === noteIdToSave) {
            if (noteTitleInput && noteTitleInput.value !== savedTitle) {
                noteTitleInput.value = savedTitle;
            }
            if (noteContentTextarea && noteContentTextarea.value !== savedContent) {
                noteContentTextarea.value = savedContent;
            }
        }
        updateSaveStatus(state.isDirty ? 'dirty' : 'saved');
    }

    // 최신 DOM 버퍼까지 성공적으로 커밋된 종료 경로에서만 비상 백업을 정리합니다.
    // 저장 중 추가 입력이 발생했다면 위 분기에서 재귀 저장을 먼저 완료합니다.
    clearSavedNoteEmergencyBackup(payload?.savedNoteId ?? noteIdToSave, {
        title: titleToSave,
        content: contentToSave
    }, saveStartedAt);

    return true;
}

export async function handleUserInput() {
    if (!state.activeNoteId) return;

    const { item: activeNote } = findNote(state.activeNoteId);
    if (!activeNote) return;

    const currentTitle = noteTitleInput.value;
    const currentContent = noteContentTextarea.value;
    const hasChanged = activeNote.title !== currentTitle || activeNote.content !== currentContent;

    if (hasChanged) {
        // 자동 저장 타이머나 beforeunload보다 먼저, 현재 입력 이벤트 자체에서 복구본을 만듭니다.
        // 비정상 프로세스 종료처럼 생명주기 이벤트가 생략되는 경우에도 마지막 초안을 복원할 수 있습니다.
        persistEmergencyChangesBackupEntry('noteUpdate', {
            noteId: activeNote.id,
            title: currentTitle,
            content: currentContent,
            capturedAt: Date.now()
        });

        if (!state.isDirty || state.dirtyNoteId !== state.activeNoteId) {
            setState({ isDirty: true, dirtyNoteId: state.activeNoteId });
        }
        updateSaveStatus('dirty');
    } else {
        if (state.isDirty && (!state.dirtyNoteId || state.dirtyNoteId === state.activeNoteId)) {
            setState({ isDirty: false, dirtyNoteId: null });
            clearTimeout(autoSaveTimer);
            updateSaveStatus('saved');
        }
        // 이탈 경고를 취소한 뒤 사용자가 저장된 내용으로 직접 되돌렸다면,
        // 이전 beforeunload가 남긴 초안은 이제 의도적으로 폐기된 상태입니다.
        // 그대로 두면 다음 실행에서 예전 초안을 다시 덮어쓸 수 있어 정리합니다.
        clearSavedNoteEmergencyBackup(activeNote.id);
        return;
    }

    clearTimeout(autoSaveTimer);

    autoSaveTimer = setTimeout(() => {
        if (state.isDirty && state.dirtyNoteId === state.activeNoteId) {
            void saveCurrentNoteIfChanged();
        }
    }, CONSTANTS.DEBOUNCE_DELAY.SAVE);
}

const _handleRenameEnd = async (id, type, nameSpan, shouldSave) => {
    if (pendingRenameCompletionPromise) {
        return await pendingRenameCompletionPromise;
    }

    if (state.renamingItemId !== id || !pendingRenamePromise) {
        return true;
    }

    const completionPromise = (async () => {
        let result = false;

        try {
            if (pendingRenameDraft?.id === id) {
                pendingRenameDraft.newName = String(nameSpan.textContent ?? '');
            }

            // contentEditable을 끄면 blur가 발생할 수 있으므로, 저장용 blur 리스너를 먼저 제거합니다.
            // Escape 취소가 blur 저장과 경합해 새 이름을 커밋하는 문제를 방지합니다.
            if (pendingRenameCleanup) {
                pendingRenameCleanup();
                pendingRenameCleanup = null;
            }
            nameSpan.contentEditable = false;

            if (!nameSpan.isConnected) {
                // [MAJOR BUG FIX] 이름을 입력하는 동안 다른 상태 변경으로 목록이 다시 렌더링되면
                // 기존 contentEditable 요소가 DOM에서 분리되며 blur가 발생할 수 있습니다.
                // 이때 성공으로만 처리하면 위에서 캡처한 최신 초안이 저장되지 않은 채 사라집니다.
                // 분리된 요소의 textContent는 여전히 읽을 수 있으므로 정상 커밋 경로를 계속 진행합니다.
                console.warn('Rename editor was detached during rendering. Committing the captured draft.');
            }

            const { item: currentItem } = (type === CONSTANTS.ITEM_TYPE.FOLDER ? findFolder(id) : findNote(id));
            if (!currentItem) {
                setState({ renamingItemId: null });
                result = true;
                return result;
            }

            const originalName = (type === CONSTANTS.ITEM_TYPE.FOLDER) ? currentItem.name : currentItem.title;
            const newName = nameSpan.textContent.trim();

            if (!shouldSave || newName === originalName) {
                clearRenameEmergencyBackup(id, type);
                setState({ renamingItemId: null });
                if (nameSpan) nameSpan.textContent = originalName;
                result = true;
                return result;
            }

            // 목록 이름 변경도 전체 상태를 다시 렌더링할 수 있으므로, 현재 편집 버퍼를 먼저 확정합니다.
            // 특히 검색 결과에서 제목을 바꾸면 활성 노트가 목록에서 사라질 수 있어 저장 실패 상태에서는 데이터 유실로 이어집니다.
            if (!(await saveCurrentNoteIfChanged())) {
                setState({ renamingItemId: null });
                if (nameSpan) nameSpan.textContent = originalName;
                showToast('변경사항 저장에 실패하여 이름 변경을 취소했습니다.', CONSTANTS.TOAST_TYPE.ERROR);
                result = false;
                return result;
            }

            const updateResult = await performTransactionalUpdate(latestData => {
                let itemToRename, parentFolder, isDuplicate = false;
                const now = Date.now();

                if (type === CONSTANTS.ITEM_TYPE.FOLDER) {
                    itemToRename = latestData.folders.find(f => f.id === id);
                    if (!itemToRename) return null;
                    isDuplicate = latestData.folders.some(f => f.id !== id && f.name.toLowerCase() === newName.toLowerCase());
                } else {
                    for (const folder of latestData.folders) {
                        const note = folder.notes.find(n => n.id === id);
                        if (note) { itemToRename = note; parentFolder = folder; break; }
                    }
                    if (!itemToRename) return null;
                }

                if (!newName) {
                    showToast(CONSTANTS.MESSAGES.ERROR.EMPTY_NAME_ERROR, CONSTANTS.TOAST_TYPE.ERROR);
                    return null;
                }
                if (isDuplicate) {
                    showToast(CONSTANTS.MESSAGES.ERROR.DUPLICATE_NAME_ERROR(newName), CONSTANTS.TOAST_TYPE.ERROR);
                    return null;
                }

                if (type === CONSTANTS.ITEM_TYPE.FOLDER) itemToRename.name = newName;
                else itemToRename.title = newName;

                itemToRename.updatedAt = now;
                if (parentFolder) parentFolder.updatedAt = now;

                return { newData: latestData, successMessage: null, postUpdateState: { renamingItemId: null } };
            });

            result = updateResult.success;
            if (result) {
                clearRenameEmergencyBackup(id, type);
            } else {
                setState({ renamingItemId: null });
                if (nameSpan) nameSpan.textContent = originalName;
            }

            return result;
        } catch (error) {
            console.error('Rename finalization failed:', error);
            showToast('이름 변경 저장 중 오류가 발생했습니다.', CONSTANTS.TOAST_TYPE.ERROR);
            result = false;
            return result;
        } finally {
            if (resolvePendingRename) {
                resolvePendingRename(result);
                resolvePendingRename = null;
            }
            pendingRenamePromise = null;
            if (pendingRenameDraft?.id === id) {
                pendingRenameDraft = null;
            }
        }
    })();

    pendingRenameCompletionPromise = completionPromise;

    try {
        return await completionPromise;
    } finally {
        // async IIFE가 첫 await 전에 조기 반환하더라도 바깥 할당이 null 정리를 덮어쓰지 않게 합니다.
        // 이후 이름 변경이 새 Promise를 설치한 경우에는 그 작업의 상태를 건드리지 않습니다.
        if (pendingRenameCompletionPromise === completionPromise) {
            pendingRenameCompletionPromise = null;
        }
    }
};

export const startRename = async (liElement, type) => {
    const id = liElement?.dataset.id;
    if (!id || isStartingRename || state.renamingItemId || state.activeFolderId === CONSTANTS.VIRTUAL_FOLDERS.TRASH.id) return;
    if (Object.values(CONSTANTS.VIRTUAL_FOLDERS).some(vf => vf.id === id)) return;
    if (state.isPerformingOperation) {
        showToast('다른 저장 작업이 끝난 뒤 이름 변경을 다시 시도해주세요.', CONSTANTS.TOAST_TYPE.ERROR);
        return;
    }

    isStartingRename = true;
    try {
        if (type === CONSTANTS.ITEM_TYPE.NOTE && state.activeNoteId !== id) {
            if (!(await changeActiveNote(id))) {
                showToast("노트 전환에 실패하여 이름 변경을 시작할 수 없습니다.", CONSTANTS.TOAST_TYPE.ERROR);
                return;
            }
        }

        // 편집기가 dirty인 채 contentEditable 모드에 들어가면, 포커스 이동으로 시작된 저장 렌더가
        // 이름 변경 DOM을 교체해 입력값과 pending promise를 고립시킬 수 있습니다.
        if (!(await saveCurrentNoteIfChanged())) {
            showToast('변경사항 저장에 실패하여 이름 변경을 시작하지 않았습니다.', CONSTANTS.TOAST_TYPE.ERROR);
            return;
        }

        // 저장을 기다리는 동안 항목이 삭제되었을 수 있으므로 현재 상태에서 다시 확인합니다.
        const { item: currentItem } = type === CONSTANTS.ITEM_TYPE.FOLDER ? findFolder(id) : findNote(id);
        // 위 await 구간 사이에 다른 트랜잭션이 시작됐다면, 그 완료 렌더가
        // contentEditable DOM을 교체하여 입력 중인 이름을 잃을 수 있으므로 시작하지 않습니다.
        if (!currentItem || state.renamingItemId || state.isPerformingOperation) {
            if (state.isPerformingOperation) {
                showToast('다른 저장 작업이 끝난 뒤 이름 변경을 다시 시도해주세요.', CONSTANTS.TOAST_TYPE.ERROR);
            }
            return;
        }
        
        // 상태가 먼저 바뀐 직후 다른 작업이 들어와도 finishPendingRename()이
        // 반드시 이 작업을 인식하도록 Promise를 타이머보다 먼저 생성합니다.
        const originalName = type === CONSTANTS.ITEM_TYPE.FOLDER ? currentItem.name : currentItem.title;
        pendingRenameDraft = { id, type, newName: String(originalName ?? '') };
        pendingRenamePromise = new Promise(resolve => { resolvePendingRename = resolve; });
        setState({ renamingItemId: id });

        setTimeout(() => {
            // 타이머가 실행되기 전에 다른 작업이 이름 변경을 끝냈거나 새 이름 변경이 시작됐다면
            // 오래된 콜백이 편집 모드를 되살리거나 새 작업의 상태를 지우지 않도록 중단합니다.
            if (state.renamingItemId !== id || !pendingRenamePromise) return;

            const safeId = escapeCssAttributeValue(id);
            const newLiElement = document.querySelector(`.item-list-entry[data-id="${safeId}"]`);
            const nameSpan = newLiElement?.querySelector('.item-name');

            if (!newLiElement || !nameSpan) {
                forceResolvePendingRename();
                return;
            }
            
            nameSpan.contentEditable = true;
            nameSpan.focus();
            document.execCommand('selectAll', false, null);

            const onInput = () => {
                if (pendingRenameDraft?.id === id) {
                    const rawName = String(nameSpan.textContent ?? '');
                    pendingRenameDraft.newName = rawName;
                    const newName = rawName.trim();

                    if (newName) {
                        persistEmergencyChangesBackupEntry('itemRename', {
                            id,
                            type,
                            newName,
                            capturedAt: Date.now()
                        });
                    } else {
                        // 빈 이름은 정상 커밋 대상이 아닙니다. 직전의 부분 입력이 다음 실행에서
                        // 되살아나지 않도록 이 이름 변경의 비상 사본만 정리합니다.
                        clearRenameEmergencyBackup(id, type);
                    }
                }
            };
            const onBlur = () => { void _handleRenameEnd(id, type, nameSpan, true); };
            const onKeydown = (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    void _handleRenameEnd(id, type, nameSpan, true);
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    void _handleRenameEnd(id, type, nameSpan, false);
                }
            };
            nameSpan.addEventListener('input', onInput);
            nameSpan.addEventListener('blur', onBlur, { once: true });
            nameSpan.addEventListener('keydown', onKeydown);
            pendingRenameCleanup = () => {
                nameSpan.removeEventListener('input', onInput);
                nameSpan.removeEventListener('blur', onBlur);
                nameSpan.removeEventListener('keydown', onKeydown);
            };
        }, 0);
    } finally {
        isStartingRename = false;
    }
};

const handleTextareaKeyDown = (e) => {
    if (e.key === 'Tab') {
        e.preventDefault();
        const textarea = e.target;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;

        if (start === end) {
            if (e.shiftKey) {
                const lineStart = text.lastIndexOf('\n', start - 1) + 1;
                const line = text.substring(lineStart, start);
                if (line.startsWith('\t')) {
                    textarea.value = text.substring(0, lineStart) + text.substring(lineStart + 1);
                    textarea.selectionStart = textarea.selectionEnd = start - 1;
                } else if (line.startsWith(' ')) {
                    const spaces = line.match(/^ */)[0].length;
                    const removeCount = Math.min(spaces, 4);
                    textarea.value = text.substring(0, lineStart) + text.substring(lineStart + removeCount);
                    textarea.selectionStart = textarea.selectionEnd = start - removeCount;
                }
            } else {
                textarea.value = text.substring(0, start) + '\t' + text.substring(end);
                textarea.selectionStart = textarea.selectionEnd = start + 1;
            }
        } else {
            const firstLineStart = text.lastIndexOf('\n', start - 1) + 1;
            
            let lastLineEnd = text.indexOf('\n', end);
            if (lastLineEnd === -1) lastLineEnd = text.length;
            if (end > firstLineStart && text[end - 1] === '\n') lastLineEnd = end - 1;

            const selectedBlock = text.substring(firstLineStart, lastLineEnd);
            const lines = selectedBlock.split('\n');
            
            let modifiedBlock;
            if (e.shiftKey) {
                modifiedBlock = lines.map(line => {
                    if (line.startsWith('\t')) return line.substring(1);
                    if (line.startsWith(' ')) {
                        const spaces = line.match(/^ */)[0].length;
                        return line.substring(Math.min(spaces, 4));
                    }
                    return line;
                }).join('\n');
            } else {
                modifiedBlock = lines.map(line => line.length > 0 ? '\t' + line : line).join('\n');
            }

            textarea.value = text.substring(0, firstLineStart) + modifiedBlock + text.substring(lastLineEnd);
            
            textarea.selectionStart = firstLineStart;
            textarea.selectionEnd = firstLineStart + modifiedBlock.length;
        }

        handleUserInput();
    }
};

export { handleTextareaKeyDown };
